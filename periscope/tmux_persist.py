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
from collections.abc import Iterable, Mapping
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
    """Every user conf tmux executes at server start, in its order: its default
    list is ~/.tmux.conf, $XDG_CONFIG_HOME/tmux/tmux.conf, then
    ~/.config/tmux/tmux.conf, each that exists. TPM reads just one of them."""
    xdg = os.environ.get("XDG_CONFIG_HOME")
    return _distinct(
        [
            Path.home() / ".tmux.conf",
            *([Path(xdg) / "tmux/tmux.conf"] if xdg else []),
            Path.home() / ".config/tmux/tmux.conf",
        ]
    )


def _distinct(paths: Iterable[Path]) -> list[Path]:
    """`paths` with later repeats of one file dropped, as tmux drops them from
    its default list."""
    seen: dict[str, Path] = {}
    for p in paths:
        seen.setdefault(os.path.realpath(p), p)
    return list(seen.values())


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


def _tmux_conf_files() -> list[Path]:
    """Every file tmux EXECUTES at server start — not TPM's set: tmux runs both
    user confs where TPM reads one, so a run line in ~/.tmux.conf next to an
    XDG conf ran TPM a second time that a count over TPM's files never saw.
    The live server's list adds the system conf tmux was built with
    (Homebrew's /opt/homebrew/etc/tmux.conf, not TPM's /etc)."""
    return _with_sources(_distinct([SYSTEM_CONF, *_live_config_files(), *_user_confs()]))


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
    return sum(bool(_TPM_RUN_RE.match(line)) for f in _tmux_conf_files() for line in _scan_text(f).splitlines())


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
    conf = owned_conf()
    if not conf.exists() or all(n == 1 for n in plugin_declarations().values()):
        return False
    text = owned_conf_text(repo, plugins_declared_elsewhere())
    if _scan_text(conf) == text:
        return False
    conf.write_text(text)
    return True


# --- ~/.tmux.conf line management -----------------------------------------


def _sources_owned(line: str) -> bool:
    words = _source_words(line)
    return bool(words) and Path(words[0]) == owned_conf()


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


def _runs_tpm(line: str) -> bool:
    """TPM's run line, or a source of a file holding one (one level, as far as
    TPM scans). Matching the conf's own lines only appended a second run line
    for a user whose TPM setup lives in a sourced file: TPM ran twice."""
    if _TPM_RUN_RE.match(line):
        return True
    return any(
        _TPM_RUN_RE.match(sub) for f in _source_targets(line) if f != owned_conf() for sub in _scan_text(f).splitlines()
    )


def ensure_sourced(path: Path) -> bool:
    """Add the source line to `path` per the ordering rule. True if written."""
    lines = _read_lines(path)
    if any(_sources_owned(line) for line in lines):
        return False
    tpm_at = next((i for i, line in enumerate(lines) if _runs_tpm(line)), None)
    if tpm_at is None:
        lines += [source_line(), TPM_RUN_LINE]
    else:
        lines.insert(tpm_at, source_line())
    _write_lines(path, lines)
    return True


def remove_sourced(path: Path, *, with_run: bool = False) -> bool:
    """Drop the source line from `path` — with `with_run`, and the verbatim
    TPM_RUN_LINE right under it: the pair ensure_sourced appends. True if
    written."""
    lines = _read_lines(path)
    kept = [
        line
        for i, line in enumerate(lines)
        if not _sources_owned(line) and not (with_run and line == TPM_RUN_LINE and i and _sources_owned(lines[i - 1]))
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
    conf = owned_conf()
    conf.parent.mkdir(parents=True, exist_ok=True)
    text = owned_conf_text(repo, plugins_declared_elsewhere())
    if not conf.exists() or _scan_text(conf) != text:
        conf.write_text(text)
        actions.append(f"wrote {conf}")
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
