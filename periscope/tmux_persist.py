"""Provision and verify the tmux side of continuation-over-reboot.

`bin/periscope install` already wires periscope's half (the pane-session hook
and the launchd job) but continuation also needs TPM + tmux-resurrect +
tmux-continuum installed and a handful of tmux options set — most critically
`@resurrect-hook-post-save-layout` pointing at THIS checkout's
`bin/periscope resurrect-rewrite`. Left to hand configuration, the hook path
rots when the checkout moves and a fresh machine silently never saves
(`resurrect.save_now` degrades quietly when continuum is absent).

Periscope owns a sourced file, `<config_dir>/tmux.conf`, regenerated wholesale
on every install, and adds exactly one `source-file` line to the user conf
(`~/.tmux.conf`, or `$XDG_CONFIG_HOME/tmux/tmux.conf` when TPM would read that).
TPM scans sourced files for `@plugin` lines, so the plugin list lives in the
owned file too. The source line must precede TPM's `run` line — TPM only
installs plugins declared before it runs — so it is inserted directly above the
line that runs TPM (directly, or by sourcing a file that does), or appended
together with one. tmux itself executes EVERY user conf that exists, so install
moves its own lines out of the one TPM ignores.

Each plugin must be declared EXACTLY ONCE across everything TPM reads. TPM
does not dedupe: a plugin the user already declares in ~/.tmux.conf, declared
again here, has its `*.tmux` run twice — and twice-run continuum starts two
background restores that race through the same save file. A restore that
checks "pane missing, window present" while the other is mid-create splits
the window again, leaving an extra shell pane per restore; once a Claude is
resumed in it, the next save records it and the window grows every restart
(observed: one window at three panes, all `--resume`-ing one session). So the
owned file omits plugins declared elsewhere, the prod worker re-derives that
omission when those files change (`heal`), and healthz counts declarations
(over what TPM reads) and TPM run lines (over what tmux executes).

Import discipline: stdlib + `periscope.config` only. The shell verb runs this
under plain `python3`, outside the uv environment.
"""

import glob
import json
import os
import re
import shlex
import subprocess
import sys
import time
from collections import Counter
from collections.abc import Iterable, Iterator, Mapping
from pathlib import Path

from periscope import config

TPM_REPO = "https://github.com/tmux-plugins/tpm"
REQUIRED_PLUGINS = ("tpm", "tmux-resurrect", "tmux-continuum")
TPM_RUN_LINE = "run '~/.tmux/plugins/tpm/tpm'"
# TPM's, not tmux's: TPM cats /etc/tmux.conf whatever SYSCONFDIR tmux was
# built with (Homebrew's reads /opt/homebrew/etc). A constant so tests can
# keep the host's out of their counts.
SYSTEM_CONF = Path("/etc/tmux.conf")
_DEFAULT_SAVE_INTERVAL_MIN = 15

_TPM_RUN_RE = re.compile(r"^\s*run(-shell)?\b.*tpm/tpm")
# TPM's own match (tpm_plugins_list_helper's awk): `set[-option] -g @plugin X`.
_PLUGIN_RE = re.compile(r"""^\s*set(-option)?\s+-g\s+@plugin\s+['"]?([^'"\s]+)""")
# TPM's _sourced_files sed: everything after `source[-file] [-q]` up to a
# quote, spaces included — the caller word-splits it, as TPM's `for` does.
_SOURCE_RE = re.compile(r"""^\s*source(-file)?\s+(-q+\s+)?['"]?(?P<path>[^'"]+)['"]?""")


def plugins_dir() -> Path:
    return Path.home() / ".tmux/plugins"


def user_conf() -> Path:
    """The user conf TPM reads (_get_user_tmux_conf): the XDG one when it
    exists, else ~/.tmux.conf. TPM scans only this one for `@plugin`, so the
    source line must live here or TPM never sees the owned file's plugins."""
    xdg = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "tmux/tmux.conf"
    return xdg if xdg.is_file() else Path.home() / ".tmux.conf"


def _user_confs() -> list[Path]:
    """The user confs in tmux's default list, in its order: ~/.tmux.conf,
    $XDG_CONFIG_HOME/tmux/tmux.conf, ~/.config/tmux/tmux.conf. tmux (3.6a)
    drops a repeat of the same path STRING only, so one file reached by two
    paths (~/.tmux.conf symlinked to the XDG conf) runs twice — a realpath
    dedupe counted it once while TPM ran twice. TPM reads just one of them."""
    home, xdg = Path.home(), os.environ.get("XDG_CONFIG_HOME")
    paths = [f"{home}/.tmux.conf", *([f"{xdg}/tmux/tmux.conf"] if xdg else []), f"{home}/.config/tmux/tmux.conf"]
    return [Path(p) for p in dict.fromkeys(paths)]


def owned_conf() -> Path:
    return config.config_dir() / "tmux.conf"


def hook_command(repo: Path) -> str:
    return f"{repo}/bin/periscope resurrect-rewrite"


def source_line() -> str:
    return f"source-file {shlex.quote(str(owned_conf()))}"


def plugin_name(spec: str) -> str:
    """`tmux-plugins/tmux-continuum`, a git URL, or `x#branch` → `tmux-continuum`
    (TPM's plugin_name_helper)."""
    name = spec.split("#", 1)[0].rstrip("/").rsplit("/", 1)[-1]
    return name.removesuffix(".git")


def declared_plugins(text: str) -> list[str]:
    return [plugin_name(m.group(2)) for line in text.splitlines() if (m := _PLUGIN_RE.match(line))]


def _source_words(line: str) -> list[str]:
    """A `source-file` line's paths as TPM reads them (_sourced_files +
    _manual_expansion): the rest of the line split on whitespace, with a
    leading `~` or `$HOME` expanded and nothing else."""
    m = _SOURCE_RE.match(line)
    if not m:
        return []
    home = str(Path.home())
    words = []
    for w in (m.group("path") + line[m.end() :]).split():
        if w.startswith("~"):
            w = home + w[1:]
        elif w.startswith("$HOME"):
            w = home + w[5:]
        words.append(w)
    return words


def _source_targets(line: str) -> list[Path]:
    """The files a `source-file` line makes TPM read. Its `cat $(…)` is
    unquoted, so each word is globbed; one matching nothing stays literal (and
    then fails to read, silently)."""
    return [Path(p) for w in _source_words(line) for p in (sorted(glob.glob(w)) or [w])]


def _with_sources(roots: list[Path]) -> list[Path]:
    """`roots` and every file each sources, one level deep, repeats included."""
    files = list(roots)
    for root in roots:
        for line in _scan_text(root).splitlines():
            files += _source_targets(line)
    return files


def _tpm_conf_files() -> list[Path]:
    """Every file TPM reads for `@plugin` (_tmux_conf_contents "full"), repeats
    included: /etc/tmux.conf, the user conf, and every file either of those
    sources, one level deep as TPM does. The owned file is among them once
    sourced. A path resolved differently from TPM is a declaration miscounted:
    a `$HOME/…` or glob source read as a literal path hid the user's continuum,
    and install declared it a second time."""
    return _with_sources([SYSTEM_CONF, user_conf()])


def _tmux_roots() -> list[Path]:
    """The conf files tmux loads at server start, before what they source —
    not TPM's set: tmux runs every user conf where TPM reads one, so a run
    line in ~/.tmux.conf next to an XDG conf ran TPM a second time that a
    count over TPM's files never saw. The live server's `#{config_files}`
    when one answers (the system conf tmux was built with — Homebrew's
    /opt/homebrew/etc/tmux.conf, not TPM's /etc — or `-f`'s file), instead of
    tmux's default list, not added to it: a `-f` server never ran the user
    confs."""
    return _live_config_files() or [SYSTEM_CONF, *_user_confs()]


# What tmux EXECUTES, which is not what TPM reads: tmux follows `source-file`
# to any depth and takes its flags, where TPM's sed reads one level and treats
# `-F` as a path. Counting runs with TPM's resolver missed a run line two
# sources deep, or behind `-F '#{d:current_file}/…'`: install appended a
# second one, and healthz counted that one alone.


def _tmux_words(text: str) -> list[str]:
    """`text`'s words as tmux's parser yields them, as far as a path needs:
    quotes removed, a leading `~` and `$VAR` expanded — except inside single
    quotes, where tmux expands neither (`source-file '~/x'` names a file `~`
    in the cwd; TPM's sed expands it). A word starting with `#` begins a
    comment; an unclosed quote is a line tmux rejects."""
    lex = shlex.shlex(text, posix=False)
    lex.whitespace_split, lex.commenters = True, "#"
    try:
        raw = list(lex)
    except ValueError:
        return []
    words = []
    for w in raw:
        if len(w) > 1 and w[0] == w[-1] == "'":
            words.append(w[1:-1])
        else:
            w = w[1:-1] if len(w) > 1 and w[0] == w[-1] == '"' else w
            words.append(os.path.expandvars(os.path.expanduser(w)))
    return words


_TMUX_SOURCE_RE = re.compile(r"\s*source(-file)?\s")


def _tmux_sources(line: str, current: Path) -> list[Path]:
    """The files a `source-file [-Fnqv] [-t pane] path …` line makes tmux
    execute (cmd-source-file.c): none with `-n` (parse only); with `-F`,
    `#{current_file}` / `#{d:current_file}` expanded against the file being
    read (any other format needs a live server, and is skipped); each path
    globbed, one matching nothing an error rather than a file."""
    if not _TMUX_SOURCE_RE.match(line):
        return []
    words, flags = _tmux_words(line)[1:], ""
    while words and words[0].startswith("-") and words[0] != "-":
        opts = words.pop(0)[1:]
        if opts == "-":
            break
        if "t" in opts:  # -t's target pane is the rest of the word, or the next one
            if opts.endswith("t") and words:
                words.pop(0)
            opts = opts[: opts.index("t")]
        flags += opts
    if "n" in flags:
        return []
    paths = []
    for w in words:
        if "F" in flags:
            w = w.replace("#{current_file}", str(current)).replace("#{d:current_file}", str(current.parent))
            if "#{" in w:
                continue
        paths += [Path(p) for p in sorted(glob.glob(w))]
    return paths


# tmux's CMD_SOURCE_FILE_DEPTH_LIMIT: a conf that sources itself runs 51 times
# (probed on 3.6a). Followed as far, so a run line in one reads as 51, not 1.
_SOURCE_DEPTH_LIMIT = 50


def _executed(files: Iterable[Path], depth: int = 0) -> Iterator[tuple[Path, int, str]]:
    """(file, line number, line) for each line tmux executes from `files`, in
    its order: a `source-file` line's targets run at that line. A file is
    counted once per path it runs under, repeats included."""
    for f in files:
        for n, line in enumerate(_scan_text(f).splitlines(), 1):
            yield f, n, line
            if depth < _SOURCE_DEPTH_LIMIT:
                yield from _executed(_tmux_sources(line, f), depth + 1)


def _declarations(files: Iterable[Path]) -> list[tuple[str, Path]]:
    """(plugin, file) for each `@plugin` line TPM will see in `files`, repeats
    included."""
    return [(name, f) for f in files for name in declared_plugins(_scan_text(f))]


def plugins_declared_elsewhere() -> dict[str, Path]:
    """Each plugin declared outside the owned file -> the first file that does."""
    out: dict[str, Path] = {}
    for name, f in _declarations(f for f in _tpm_conf_files() if f != owned_conf()):
        out.setdefault(name, f)
    return out


def plugin_declarations() -> dict[str, int]:
    """How many times TPM will see each required plugin declared. Anything but
    1 is broken: 0 never loads it, 2 runs it twice (the racing restores)."""
    counts = Counter(name for name, _ in _declarations(_tpm_conf_files()))
    return {p: counts[p] for p in REQUIRED_PLUGINS}


def tpm_runs() -> int:
    """How many `run … tpm/tpm` lines tmux will execute at server start.
    Anything but 1 is broken: each run sources every plugin, so two run
    continuum twice — the racing restores, with every declaration at 1."""
    return sum(bool(_TPM_RUN_RE.match(line)) for _, _, line in _executed(_tmux_roots()))


def owned_conf_text(repo: Path, declared_elsewhere: Mapping[str, Path]) -> str:
    # No default: "declared nowhere else" is the pre-fix text that put every
    # plugin in TPM's list twice — a caller must say what it found.
    plugins = "".join(
        f"set -g @plugin 'tmux-plugins/{p}'\n"
        if p not in declared_elsewhere
        else f"# @plugin {p}: declared in {declared_elsewhere[p]}; TPM must see it once (re-declared here if that goes)\n"
        for p in REQUIRED_PLUGINS
    )
    return (
        "# Generated by `bin/periscope install` — regenerated on every install/update.\n"
        "# The minimum tmux-resurrect/continuum setup for Claude panes to resume\n"
        "# their session after a reboot. Personal settings belong in ~/.tmux.conf.\n"
        + plugins
        + "set -g @continuum-restore 'on'\n"
        "set -g @resurrect-processes '~claude'\n"
        f"set -g @resurrect-hook-post-save-layout {shlex.quote(hook_command(repo))}\n"
    )


def heal(repo: Path) -> bool:
    """Regenerate the owned file when TPM would no longer see each plugin
    exactly once. Its plugin list is a snapshot of the other conf files taken
    at install, so an edit there moves under it: drop a declaration this file
    deferred to and the plugin is declared nowhere (no auto-restore after the
    next reboot, silently); add one and it is declared twice. Never creates
    the file — that is install's opt-in — and never re-sources: plugins load
    at server start, the only time the list matters. True if written."""
    if not owned_conf().exists() or all(n == 1 for n in plugin_declarations().values()):
        return False
    return _write_owned(repo)


def _write_owned(repo: Path) -> bool:
    """Regenerate the owned file from what the other conf files declare —
    install's step and heal's, one copy. Writes only when the text differs, so
    a count regenerating can't fix doesn't rewrite it every tick. True if
    written."""
    conf = owned_conf()
    text = owned_conf_text(repo, plugins_declared_elsewhere())
    if conf.exists() and _scan_text(conf) == text:
        return False
    conf.write_text(text)
    return True


# --- ~/.tmux.conf line management -----------------------------------------


def _sources_owned(line: str) -> bool:
    """`line` makes tmux read the owned file, resolved as every count here is.
    Matching its first word only read a glob or multi-path line as unsourced:
    install added a second source line, every plugin declared twice."""
    return owned_conf() in _source_targets(line)


def _is_source_line(line: str) -> bool:
    """Periscope's own line: the owned file, by path, and nothing else. Only
    this is ever removed — a user's glob or multi-path line that covers the
    owned file also sources their own."""
    return [Path(w) for w in _source_words(line)] == [owned_conf()]


def _scan_text(path: Path) -> str:
    """A conf file's text for reading only, "" when unreadable. TPM's `cat …
    2>/dev/null` is as tolerant, and a raise here 500'd all of /api/healthz
    (which `bin/periscope update` polls) over one unreadable /etc/tmux.conf or
    a Latin-1 comment in a sourced file. Bad bytes are replaced, so the
    `@plugin` lines around them still count."""
    try:
        return path.read_text(errors="replace")
    except OSError:
        return ""


# The user conf is rewritten in place: surrogateescape round-trips bytes that
# aren't UTF-8 instead of raising on them (or replacing them on write-back).
def _read_lines(path: Path) -> list[str]:
    return path.read_text(errors="surrogateescape").splitlines() if path.exists() else []


def _write_lines(path: Path, lines: list[str]) -> None:
    path.write_text("\n".join(lines) + "\n", errors="surrogateescape")


def is_sourced(path: Path) -> bool:
    return any(_sources_owned(line) for line in _scan_text(path).splitlines())


def _runs_tpm(line: str, current: Path) -> bool:
    """`line`, read from `current`, runs TPM: it is TPM's run line, or a source
    of a file holding one, at any depth (_executed). Matching the conf's own
    lines only appended a second run line for a user whose TPM setup lives in
    a sourced file: TPM ran twice."""
    return bool(_TPM_RUN_RE.match(line)) or any(
        _TPM_RUN_RE.match(sub) for _, _, sub in _executed(_tmux_sources(line, current), 1)
    )


def ensure_sourced(path: Path) -> bool:
    """Add the source line to `path` per the ordering rule. True if written."""
    lines = _read_lines(path)
    if any(_sources_owned(line) for line in lines):
        return False
    tpm_at = next((i for i, line in enumerate(lines) if _runs_tpm(line, path)), None)
    if tpm_at is None:
        lines += [source_line(), TPM_RUN_LINE]
    else:
        lines.insert(tpm_at, source_line())
    _write_lines(path, lines)
    return True


def remove_sourced(path: Path, *, with_run: bool = False) -> bool:
    """Drop periscope's source line (_is_source_line) from `path` — with
    `with_run`, and the verbatim TPM_RUN_LINE right under it: the pair
    ensure_sourced appends. True if written."""
    lines = _read_lines(path)
    kept = [
        line
        for i, line in enumerate(lines)
        if not _is_source_line(line) and not (with_run and line == TPM_RUN_LINE and i and _is_source_line(lines[i - 1]))
    ]
    if len(kept) == len(lines):
        return False
    _write_lines(path, kept)
    return True


# --- install / uninstall ----------------------------------------------------


def _tmux_server_running() -> bool:
    try:
        return (
            subprocess.run(
                ["tmux", "list-sessions"],
                capture_output=True,
                check=False,
            ).returncode
            == 0
        )
    except OSError:
        return False


def install(repo: Path) -> list[str]:
    """Provision everything; returns the actions taken, for the verb to print.
    Raises on a failure that leaves continuation broken."""
    actions: list[str] = []
    owned_conf().parent.mkdir(parents=True, exist_ok=True)
    if _write_owned(repo):
        actions.append(f"wrote {owned_conf()}")
    # Every install before XDG support appended source + run to ~/.tmux.conf.
    # TPM ignores that file once the XDG one exists, but tmux still executes
    # it: left there, TPM (and continuum's racing restores) ran twice. A user's
    # own verbatim run line in that spot reads the same and goes too; nothing
    # is lost, ensure_sourced below gives the conf TPM reads its run line.
    actions += [
        f"moved periscope's lines from {other} to {user_conf()}, the conf TPM reads"
        for other in _user_confs()
        if os.path.realpath(other) != os.path.realpath(user_conf()) and remove_sourced(other, with_run=True)
    ]
    if ensure_sourced(user_conf()):
        actions.append(f"added source line to {user_conf()}")

    tpm = plugins_dir() / "tpm"
    if not tpm.is_dir():
        tpm.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "clone", "--depth", "1", TPM_REPO, str(tpm)],
            check=True,
            capture_output=True,
            text=True,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
        actions.append(f"cloned tpm into {tpm}")
    # TPM reports a failed clone only as text, never via exit code — verify the
    # directories ourselves.
    subprocess.run([str(tpm / "bin/install_plugins")], check=True, capture_output=True)
    missing = [p for p in REQUIRED_PLUGINS if not (plugins_dir() / p).is_dir()]
    if missing:
        raise RuntimeError(f"tpm failed to install: {', '.join(missing)}")
    actions.append("tmux plugins present: " + ", ".join(REQUIRED_PLUGINS))

    if _tmux_server_running():
        subprocess.run(
            ["tmux", "source-file", str(user_conf())],
            check=True,
            capture_output=True,
            text=True,
        )
        actions.append(f"re-sourced {user_conf()} on the running server")
    return actions


def uninstall() -> list[str]:
    # Every user conf: tmux executes each, and a line left behind sources a
    # deleted file.
    actions = [f"removed source line from {path}" for path in _user_confs() if remove_sourced(path)]
    conf = owned_conf()
    if conf.exists():
        conf.unlink()
        actions.append(f"removed {conf}")
    return actions


# --- status (healthz) ---------------------------------------------------------


def _live_option(name: str) -> str | None:
    """Value of a global tmux option on the running server; None when there
    is no server. `-q` makes an unset option print empty rather than error."""
    try:
        out = subprocess.run(
            ["tmux", "show-options", "-gqv", name],
            capture_output=True,
            text=True,
            check=False,
            timeout=2.0,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    return out.stdout.rstrip("\n")


def _live_config_files() -> list[Path]:
    """The config files the running server loaded at start (`#{config_files}`):
    its built-in system conf, or `-f`'s. [] when there is no server."""
    try:
        out = subprocess.run(
            ["tmux", "display-message", "-p", "#{config_files}"],
            capture_output=True,
            text=True,
            check=False,
            timeout=2.0,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if out.returncode != 0:
        return []
    return [Path(p) for p in out.stdout.strip().split(",") if p]


def _resurrect_dir(live_override: str | None) -> Path:
    # Mirrors tmux-resurrect's own resolution order (scripts/helpers.sh).
    if live_override:
        return Path(os.path.expanduser(live_override))
    legacy = Path.home() / ".tmux/resurrect"
    if legacy.is_dir():
        return legacy
    base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    return Path(base) / "tmux/resurrect"


def status(repo: Path) -> dict:
    plugins = {p: (plugins_dir() / p).is_dir() for p in REQUIRED_PLUGINS}
    conf_sourced = is_sourced(user_conf())
    declarations = plugin_declarations()
    runs = tpm_runs()

    restore = _live_option("@continuum-restore")
    live = restore is not None
    processes = (_live_option("@resurrect-processes") or "") if live else ""
    hook = (_live_option("@resurrect-hook-post-save-layout") or "") if live else ""
    interval_raw = _live_option("@continuum-save-interval") if live else None
    try:
        interval_min = int(interval_raw) if interval_raw else _DEFAULT_SAVE_INTERVAL_MIN
    except ValueError:
        interval_min = _DEFAULT_SAVE_INTERVAL_MIN

    last = _resurrect_dir(_live_option("@resurrect-dir") if live else None) / "last"
    last_save_at: int | None = None
    if last.exists():
        last_save_at = int(last.stat().st_mtime)
    stale = last_save_at is not None and time.time() - last_save_at > 2 * interval_min * 60

    checks = {
        "restore_on": restore == "on",
        "processes_ok": "~claude" in processes.split(),
        "hook_current": os.path.expanduser(hook) == hook_command(repo),
    }
    return {
        "ok": (
            all(plugins.values())
            and conf_sourced
            and all(checks.values())
            and not stale
            and all(n == 1 for n in declarations.values())
            and runs == 1
        ),
        "plugins": plugins,
        "conf_sourced": conf_sourced,
        "plugin_declarations": declarations,
        "tpm_runs": runs,
        **checks,
        "last_save_at": last_save_at,
        "last_save_stale": stale,
    }


def main(argv: list[str]) -> int:
    verb = argv[0] if argv else ""
    if verb == "install" and len(argv) == 2:
        for a in install(Path(argv[1]).resolve()):
            print(a)
        return 0
    if verb == "uninstall":
        for a in uninstall():
            print(a)
        return 0
    if verb == "status" and len(argv) == 2:
        print(json.dumps(status(Path(argv[1]).resolve()), indent=2))
        return 0
    print("usage: python -m periscope.tmux_persist {install <repo>|uninstall|status <repo>}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
