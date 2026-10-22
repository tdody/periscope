"""Tests for periscope.tmux_persist — the ~/.tmux.conf line rules and the
healthz status built from live tmux options."""

import subprocess
import time
from pathlib import Path

import pytest

import periscope.tmux_persist as tp

REPO = Path("/opt/periscope")


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / ".config"))
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / ".local/share"))
    # The host's /etc/tmux.conf would land in every exact count below, and the
    # live server's config list would point the run count at the real ~/.tmux.conf.
    monkeypatch.setattr(tp, "SYSTEM_CONF", tmp_path / "etc/tmux.conf")
    monkeypatch.setattr(tp, "_live_config_files", list)
    return tmp_path


# --- ensure_sourced / remove_sourced ---------------------------------------


def test_source_line_inserted_above_existing_tpm_run(home):
    conf = home / ".tmux.conf"
    conf.write_text("set -g mouse on\nset -g @plugin 'tmux-plugins/tpm'\nrun '~/.tmux/plugins/tpm/tpm'\n")
    assert tp.ensure_sourced(conf) is True
    lines = conf.read_text().splitlines()
    assert lines[-2] == tp.source_line()
    assert lines[-1] == "run '~/.tmux/plugins/tpm/tpm'"
    assert lines[:2] == ["set -g mouse on", "set -g @plugin 'tmux-plugins/tpm'"]


def test_source_line_appended_with_tpm_run_when_absent(home):
    conf = home / ".tmux.conf"
    conf.write_text("set -g mouse on")  # no trailing newline
    assert tp.ensure_sourced(conf) is True
    assert conf.read_text() == f"set -g mouse on\n{tp.source_line()}\n{tp.TPM_RUN_LINE}\n"


def test_source_line_goes_above_a_sourced_tpm_run(home):
    # TPM's run line in a sourced file went unseen and a second one was
    # appended: TPM, and every plugin with it, ran twice.
    (home / "plugins.conf").write_text("set -g @plugin 'tmux-plugins/tpm'\n" + tp.TPM_RUN_LINE + "\n")
    conf = home / ".tmux.conf"
    conf.write_text("set -g mouse on\nsource-file ~/plugins.conf\n")
    assert tp.ensure_sourced(conf) is True
    assert conf.read_text() == f"set -g mouse on\n{tp.source_line()}\nsource-file ~/plugins.conf\n"
    assert tp.tpm_runs() == 1


def test_ensure_sourced_creates_missing_conf(home):
    conf = home / ".tmux.conf"
    assert tp.ensure_sourced(conf) is True
    assert conf.read_text() == f"{tp.source_line()}\n{tp.TPM_RUN_LINE}\n"


def test_ensure_sourced_is_idempotent(home):
    conf = home / ".tmux.conf"
    conf.write_text("run-shell ~/.tmux/plugins/tpm/tpm\n")
    tp.ensure_sourced(conf)
    before = conf.read_text()
    assert tp.ensure_sourced(conf) is False
    assert conf.read_text() == before


def test_source_line_recognised_with_quotes_and_tilde(home):
    conf = home / ".tmux.conf"
    conf.write_text('source-file -q "~/.config/periscope/tmux.conf"\nrun ~/.tmux/plugins/tpm/tpm\n')
    assert tp.is_sourced(conf) is True
    assert tp.ensure_sourced(conf) is False


def test_remove_sourced_round_trips_and_leaves_tpm_run(home):
    conf = home / ".tmux.conf"
    original = "set -g mouse on\nrun '~/.tmux/plugins/tpm/tpm'\n"
    conf.write_text(original)
    tp.ensure_sourced(conf)
    assert tp.remove_sourced(conf) is True
    assert conf.read_text() == original
    assert tp.remove_sourced(conf) is False


def test_ensure_sourced_round_trips_non_utf8_bytes(home):
    conf = home / ".tmux.conf"
    conf.write_bytes(b"# caf\xe9\nrun '~/.tmux/plugins/tpm/tpm'\n")
    assert tp.ensure_sourced(conf) is True
    assert conf.read_bytes() == b"# caf\xe9\n" + tp.source_line().encode() + b"\nrun '~/.tmux/plugins/tpm/tpm'\n"


def test_uninstall_removes_owned_file_and_line(home):
    tp.owned_conf().parent.mkdir(parents=True)
    tp.owned_conf().write_text("x\n")
    conf = home / ".tmux.conf"
    tp.ensure_sourced(conf)
    actions = tp.uninstall()
    assert len(actions) == 2
    assert not tp.owned_conf().exists()
    assert conf.read_text() == f"{tp.TPM_RUN_LINE}\n"


def test_owned_conf_carries_this_checkouts_hook():
    text = tp.owned_conf_text(REPO, ())
    assert "set -g @resurrect-hook-post-save-layout '/opt/periscope/bin/periscope resurrect-rewrite'" in text
    assert "set -g @resurrect-processes '~claude'" in text
    assert "set -g @continuum-restore 'on'" in text
    # TPM is run from ~/.tmux.conf, after this file is sourced — never here.
    assert not any(line.startswith("run") for line in text.splitlines())


# --- plugin declarations: exactly once across what TPM reads -------------

USER_PLUGINS = (
    "set -g @plugin 'tmux-plugins/tpm'\n"
    "set -g @plugin 'tmux-plugins/tmux-resurrect'\n"
    "set -g @plugin 'tmux-plugins/tmux-continuum'\n"
)


def test_declared_plugins_matches_tpms_parse():
    text = (
        "set -g @plugin 'tmux-plugins/tpm'\n"
        'set-option -g @plugin "https://github.com/x/tmux-continuum.git#v3"\n'
        "# set -g @plugin 'tmux-plugins/tmux-resurrect'\n"
    )
    assert tp.declared_plugins(text) == ["tpm", "tmux-continuum"]


def test_owned_conf_omits_plugins_the_user_already_declares(home):
    # Regression: the user's own @plugin lines + ours made TPM run continuum
    # twice, and two racing restores split a window into an extra pane.
    (home / ".tmux.conf").write_text(USER_PLUGINS)
    text = tp.owned_conf_text(REPO, tp.plugins_declared_elsewhere())
    assert tp.declared_plugins(text) == []
    assert "@continuum-restore 'on'" in text  # options are still ours


def test_owned_conf_declares_plugins_nobody_else_does(home):
    (home / ".tmux.conf").write_text("set -g @plugin 'tmux-plugins/tmux-continuum'\n")
    text = tp.owned_conf_text(REPO, tp.plugins_declared_elsewhere())
    assert tp.declared_plugins(text) == ["tpm", "tmux-resurrect"]


def _install(home, monkeypatch):
    """tp.install with TPM and the live server stubbed: rc 1 skips TPM's
    install_plugins and the re-source."""
    monkeypatch.setattr(tp.subprocess, "run", lambda args, **kw: subprocess.CompletedProcess(args, 1))
    for p in tp.REQUIRED_PLUGINS:
        (home / ".tmux/plugins" / p).mkdir(parents=True, exist_ok=True)
    return tp.install(REPO)


def test_install_omits_declared_plugins_and_converges(home, monkeypatch):
    # The root-cause fix is install's own call: the helpers above pinned
    # nothing about it, and owned_conf_text(REPO) there re-declared all three.
    (home / ".tmux.conf").write_text(USER_PLUGINS + tp.TPM_RUN_LINE + "\n")
    _install(home, monkeypatch)
    assert tp.declared_plugins(tp.owned_conf().read_text()) == []
    assert f"tmux-continuum: declared in {home / '.tmux.conf'}" in tp.owned_conf().read_text()
    assert tp.plugin_declarations() == dict.fromkeys(tp.REQUIRED_PLUGINS, 1)
    # Sourced now, the owned file must not count as "elsewhere" the second time.
    assert not any(a.startswith("wrote") for a in _install(home, monkeypatch))


def test_heal_redeclares_a_plugin_the_user_conf_dropped(home, monkeypatch):
    # The owned file's list is a snapshot of the user's conf at install: drop a
    # line it deferred to and TPM saw continuum nowhere — no auto-restore after
    # the next reboot, and only a healthz field nothing reads to say so.
    conf = home / ".tmux.conf"
    conf.write_text(USER_PLUGINS + tp.TPM_RUN_LINE + "\n")
    _install(home, monkeypatch)
    assert tp.heal(REPO) is False  # nothing drifted
    conf.write_text(conf.read_text().replace("set -g @plugin 'tmux-plugins/tmux-continuum'\n", ""))
    assert tp.plugin_declarations()["tmux-continuum"] == 0
    assert tp.heal(REPO) is True
    assert tp.plugin_declarations() == dict.fromkeys(tp.REQUIRED_PLUGINS, 1)
    assert tp.heal(REPO) is False


def test_heal_drops_a_plugin_the_user_conf_added(home, monkeypatch):
    conf = home / ".tmux.conf"
    conf.write_text(tp.TPM_RUN_LINE + "\n")
    _install(home, monkeypatch)
    conf.write_text("set -g @plugin 'tmux-plugins/tmux-continuum'\n" + conf.read_text())
    assert tp.plugin_declarations()["tmux-continuum"] == 2
    assert tp.heal(REPO) is True
    assert tp.plugin_declarations() == dict.fromkeys(tp.REQUIRED_PLUGINS, 1)


# heal runs on every 30s worker tick: a state it cannot fix must not write
# (and log a drift warning) on every one of them, ~2,880 times a day.


def test_heal_leaves_a_drift_it_cannot_fix(home, monkeypatch):
    # The user's own files declare continuum twice: regenerating the owned file
    # changes nothing, so writing it would repeat forever.
    (home / "plugins.conf").write_text("set -g @plugin 'tmux-plugins/tmux-continuum'\n")
    (home / ".tmux.conf").write_text(USER_PLUGINS + "source-file ~/plugins.conf\n" + tp.TPM_RUN_LINE + "\n")
    _install(home, monkeypatch)
    before = tp.owned_conf().read_text()
    assert tp.plugin_declarations()["tmux-continuum"] == 2
    assert tp.heal(REPO) is False
    assert tp.heal(REPO) is False
    assert tp.owned_conf().read_text() == before


def test_heal_leaves_an_unsourced_owned_file_alone(home, monkeypatch):
    # The user removed the source line: every count is 0, and the owned file
    # already says what regenerating would — re-sourcing is install's call.
    conf = home / ".tmux.conf"
    conf.write_text(tp.TPM_RUN_LINE + "\n")
    _install(home, monkeypatch)
    tp.remove_sourced(conf)
    assert tp.plugin_declarations() == dict.fromkeys(tp.REQUIRED_PLUGINS, 0)
    assert tp.heal(REPO) is False


def test_heal_leaves_an_undrifted_file_alone(home):
    # Every count at 1: nothing to heal, even though this checkout's hook path
    # differs — repointing the hook is install's job, not a tick's.
    tp.ensure_sourced(home / ".tmux.conf")
    tp.owned_conf().parent.mkdir(parents=True)
    text = tp.owned_conf_text(Path("/elsewhere/periscope"), {})
    tp.owned_conf().write_text(text)
    assert tp.plugin_declarations() == dict.fromkeys(tp.REQUIRED_PLUGINS, 1)
    assert tp.heal(REPO) is False
    assert tp.owned_conf().read_text() == text


def test_heal_never_creates_the_owned_file(home):
    (home / ".tmux.conf").write_text(USER_PLUGINS)
    assert tp.heal(REPO) is False
    assert not tp.owned_conf().exists()


def test_system_conf_is_read_like_the_user_conf(home):
    tp.SYSTEM_CONF.parent.mkdir()
    tp.SYSTEM_CONF.write_text("set -g @plugin 'tmux-plugins/tpm'\n")
    assert tp.plugins_declared_elsewhere() == {"tpm": tp.SYSTEM_CONF}
    assert tp.plugin_declarations()["tpm"] == 1


def test_plugin_declarations_follow_sourced_files(home):
    extra = home / "plugins.conf"
    extra.write_text("set -g @plugin 'tmux-plugins/tpm'\n")
    (home / ".tmux.conf").write_text(f"source-file {extra}\n")
    assert "tpm" in tp.plugins_declared_elsewhere()


@pytest.mark.parametrize(
    "line",
    [
        "source-file $HOME/plugins.conf",
        "source-file -q '~/plugins.conf'",
        "source ~/plug*.conf",
    ],
)
def test_sourced_paths_resolve_as_tpm_does(home, monkeypatch, line):
    # TPM expands a leading ~ or $HOME and globs each word (its `cat $(…)` is
    # unquoted). A literal Path() read nothing for these, so install declared
    # continuum a second time and healthz, equally blind, still counted 1.
    (home / "plugins.conf").write_text("set -g @plugin 'tmux-plugins/tmux-continuum'\n")
    (home / ".tmux.conf").write_text(f"{line}\n{tp.TPM_RUN_LINE}\n")
    assert "tmux-continuum" in tp.plugins_declared_elsewhere()
    assert tp.plugin_declarations()["tmux-continuum"] == 1
    _install(home, monkeypatch)
    assert tp.plugin_declarations() == dict.fromkeys(tp.REQUIRED_PLUGINS, 1)


def test_sourced_glob_reads_every_match(home):
    d = home / ".config/tmux/conf.d"
    d.mkdir(parents=True)
    (d / "a.conf").write_text("set -g @plugin 'tmux-plugins/tmux-resurrect'\n")
    (d / "b.conf").write_text("set -g @plugin 'tmux-plugins/tmux-continuum'\n")
    (home / ".tmux.conf").write_text("source-file ~/.config/tmux/conf.d/*.conf\n")
    assert set(tp.plugins_declared_elsewhere()) == {"tmux-resurrect", "tmux-continuum"}
    assert tp.plugin_declarations() == {"tpm": 0, "tmux-resurrect": 1, "tmux-continuum": 1}


def test_user_conf_is_the_one_tpm_reads(home, monkeypatch):
    # TPM's _get_user_tmux_conf: $XDG_CONFIG_HOME/tmux/tmux.conf INSTEAD of
    # ~/.tmux.conf when it exists — a source line in the other is invisible to it.
    assert tp.user_conf() == home / ".tmux.conf"
    xdg = home / ".config/tmux/tmux.conf"
    xdg.parent.mkdir(parents=True)
    xdg.write_text(USER_PLUGINS + tp.TPM_RUN_LINE + "\n")
    (home / ".tmux.conf").write_text("set -g mouse on\n")
    assert tp.user_conf() == xdg
    _install(home, monkeypatch)
    assert tp.is_sourced(xdg)
    assert tp.plugin_declarations() == dict.fromkeys(tp.REQUIRED_PLUGINS, 1)
    assert (home / ".tmux.conf").read_text() == "set -g mouse on\n"


def test_user_conf_falls_back_to_dot_config_without_xdg_config_home(home, monkeypatch):
    # The launchd job runs with no XDG_CONFIG_HOME, and TPM's
    # ${XDG_CONFIG_HOME:-$HOME/.config} still picks ~/.config/tmux/tmux.conf: a
    # source line put in ~/.tmux.conf instead is one TPM never reads.
    monkeypatch.delenv("XDG_CONFIG_HOME")
    xdg = home / ".config/tmux/tmux.conf"
    xdg.parent.mkdir(parents=True)
    xdg.write_text(USER_PLUGINS)
    assert tp.user_conf() == xdg
    _install(home, monkeypatch)
    assert tp.owned_conf() == home / ".config/periscope/tmux.conf"
    assert tp.is_sourced(xdg) and not (home / ".tmux.conf").exists()
    assert tp.plugin_declarations() == dict.fromkeys(tp.REQUIRED_PLUGINS, 1)
    assert tp.tpm_runs() == 1


# Base's install appended exactly this pair to ~/.tmux.conf, XDG conf or not.
LEGACY_HOME_CONF = "set -g mouse on\n{source}\n" + tp.TPM_RUN_LINE + "\nset -g status-left x\n"


def _legacy_install(home, xdg_text):
    """The state every install since 2026-08 left a user with an XDG conf in:
    the owned file declaring all three, sourced (and TPM run) from ~/.tmux.conf."""
    tp.owned_conf().parent.mkdir(parents=True, exist_ok=True)
    tp.owned_conf().write_text(tp.owned_conf_text(REPO, {}))
    (home / ".tmux.conf").write_text(LEGACY_HOME_CONF.format(source=tp.source_line()))
    xdg = home / ".config/tmux/tmux.conf"
    xdg.parent.mkdir(parents=True, exist_ok=True)
    xdg.write_text(xdg_text)
    return xdg


def test_tpm_runs_counts_every_conf_tmux_loads(home, monkeypatch):
    # tmux executes ~/.tmux.conf AND the XDG conf (TPM reads only the latter):
    # a run line in each ran TPM — and continuum's racing restores — twice
    # while the count, over TPM's one file, said 1.
    (home / ".tmux.conf").write_text(tp.TPM_RUN_LINE + "\n")
    xdg = home / ".config/tmux/tmux.conf"
    xdg.parent.mkdir(parents=True)
    xdg.write_text("run-shell ~/.tmux/plugins/tpm/tpm\n")
    assert tp.tpm_runs() == 2
    # The system conf tmux was built with (Homebrew's /opt/homebrew/etc, not
    # TPM's /etc) comes from the live server's list.
    sysconf = home / "brew/etc/tmux.conf"
    sysconf.parent.mkdir(parents=True)
    sysconf.write_text(tp.TPM_RUN_LINE + "\n")
    monkeypatch.setattr(tp, "_live_config_files", lambda: [sysconf, home / ".tmux.conf", xdg])
    assert tp.tpm_runs() == 3


@pytest.mark.parametrize(
    "xdg_text",
    [USER_PLUGINS + tp.TPM_RUN_LINE + "\n", USER_PLUGINS, "set -g mouse on\n"],
    ids=["xdg-runs-tpm", "xdg-declares-only", "xdg-neither"],
)
def test_install_moves_its_lines_out_of_the_conf_tpm_ignores(home, monkeypatch, xdg_text):
    # Upgrading such a user left base's source + run pair in ~/.tmux.conf and
    # added another to the XDG conf: tmux ran TPM twice, healthz said 1.
    xdg = _legacy_install(home, xdg_text)
    _stub_live(monkeypatch, HEALTHY)
    for p in tp.REQUIRED_PLUGINS:
        (home / ".tmux/plugins" / p).mkdir(parents=True, exist_ok=True)
    assert tp.status(REPO)["ok"] is False  # 2 runs, or the owned file unseen by TPM
    _install(home, monkeypatch)
    assert (home / ".tmux.conf").read_text() == "set -g mouse on\nset -g status-left x\n"
    assert tp.is_sourced(xdg)
    assert tp.tpm_runs() == 1
    assert tp.plugin_declarations() == dict.fromkeys(tp.REQUIRED_PLUGINS, 1)
    assert tp.status(REPO)["ok"] is True
    assert not any(a.startswith(("wrote", "moved", "added")) for a in _install(home, monkeypatch))


def test_install_leaves_the_users_own_run_line(home, monkeypatch):
    # Only install's verbatim pair moves. A run line of the user's own under
    # the source line stays put, and the count says TPM now runs twice.
    xdg = _legacy_install(home, USER_PLUGINS)
    legacy = home / ".tmux.conf"
    legacy.write_text(f"{tp.source_line()}\nrun-shell -b ~/.tmux/plugins/tpm/tpm\n")
    _install(home, monkeypatch)
    assert legacy.read_text() == "run-shell -b ~/.tmux/plugins/tpm/tpm\n"
    assert tp.is_sourced(xdg)
    assert tp.tpm_runs() == 2


def test_uninstall_removes_the_source_line_from_both_user_confs(home):
    # tmux loads both: a source line left in ~/.tmux.conf named a deleted file.
    xdg = _legacy_install(home, USER_PLUGINS)
    tp.ensure_sourced(xdg)
    tp.uninstall()
    assert not tp.is_sourced(home / ".tmux.conf") and not tp.is_sourced(xdg)
    assert not tp.owned_conf().exists()


def test_status_flags_a_plugin_declared_twice(home, monkeypatch):
    _healthy_home(home)
    _stub_live(monkeypatch, HEALTHY)
    conf = home / ".tmux.conf"
    conf.write_text(USER_PLUGINS + conf.read_text())
    s = tp.status(REPO)
    assert s["plugin_declarations"] == dict.fromkeys(tp.REQUIRED_PLUGINS, 2)
    assert s["ok"] is False


def test_status_flags_tpm_run_twice(home, monkeypatch):
    # Two run lines source every plugin twice — the same racing restores as a
    # doubled @plugin, with every declaration still counting 1.
    _healthy_home(home)
    _stub_live(monkeypatch, HEALTHY)
    assert tp.status(REPO)["tpm_runs"] == 1
    conf = home / ".tmux.conf"
    conf.write_text(conf.read_text() + "run-shell ~/.tmux/plugins/tpm/tpm\n")
    s = tp.status(REPO)
    assert s["tpm_runs"] == 2
    assert s["plugin_declarations"] == dict.fromkeys(tp.REQUIRED_PLUGINS, 1)
    assert s["ok"] is False


def test_status_flags_no_tpm_run(home, monkeypatch):
    # No run line: TPM never runs, nothing restores after a reboot — yet every
    # declaration counts 1 and the live options come from the owned file's own
    # `set -g` lines. tpm_runs is the only term of `ok` that sees it.
    _healthy_home(home)
    _stub_live(monkeypatch, HEALTHY)
    conf = home / ".tmux.conf"
    conf.write_text(conf.read_text().replace(tp.TPM_RUN_LINE + "\n", ""))
    s = tp.status(REPO)
    assert s["tpm_runs"] == 0
    assert s["plugin_declarations"] == dict.fromkeys(tp.REQUIRED_PLUGINS, 1)
    assert s["ok"] is False


def test_status_flags_a_plugin_declared_nowhere(home, monkeypatch):
    _healthy_home(home)
    _stub_live(monkeypatch, HEALTHY)
    tp.owned_conf().write_text(tp.owned_conf_text(REPO, {"tmux-continuum": home / "x.conf"}))
    s = tp.status(REPO)
    assert s["plugin_declarations"]["tmux-continuum"] == 0
    assert s["ok"] is False


def test_unreadable_or_non_utf8_conf_files_never_raise(home, monkeypatch):
    # TPM's `cat … 2>/dev/null` shrugs these off. A raise here 500'd all of
    # /api/healthz, which `bin/periscope update` polls for the new SHA.
    _healthy_home(home)
    _stub_live(monkeypatch, HEALTHY)
    extra = home / "latin1.conf"
    extra.write_bytes(b"# caf\xe9\nset -g @plugin 'tmux-plugins/tmux-continuum'\n")
    conf = home / ".tmux.conf"
    conf.write_text(f"source-file {extra}\n" + conf.read_text())
    assert tp.status(REPO)["plugin_declarations"]["tmux-continuum"] == 2  # still counted
    conf.chmod(0)
    try:
        s = tp.status(REPO)
    finally:
        conf.chmod(0o644)
    assert s["conf_sourced"] is False and s["ok"] is False


# --- status ----------------------------------------------------------------


def _stub_live(monkeypatch, options):
    """options=None simulates no tmux server."""

    def live(name):
        if options is None:
            return None
        return options.get(name, "")

    monkeypatch.setattr(tp, "_live_option", live)


def _healthy_home(home):
    for p in tp.REQUIRED_PLUGINS:
        (home / ".tmux/plugins" / p).mkdir(parents=True)
    tp.ensure_sourced(home / ".tmux.conf")
    tp.owned_conf().parent.mkdir(parents=True, exist_ok=True)
    tp.owned_conf().write_text(tp.owned_conf_text(REPO, ()))


HEALTHY = {
    "@continuum-restore": "on",
    "@resurrect-processes": "~claude",
    "@resurrect-hook-post-save-layout": "/opt/periscope/bin/periscope resurrect-rewrite",
    "@continuum-save-interval": "10",
}


def test_status_ok_when_everything_lines_up(home, monkeypatch):
    _healthy_home(home)
    _stub_live(monkeypatch, HEALTHY)
    s = tp.status(REPO)
    assert s["ok"] is True
    assert s["last_save_at"] is None and s["last_save_stale"] is False


def test_status_reads_live_server_not_file(home, monkeypatch):
    _healthy_home(home)
    _stub_live(
        monkeypatch, {**HEALTHY, "@resurrect-hook-post-save-layout": "~/old/periscope/bin/periscope resurrect-rewrite"}
    )
    s = tp.status(REPO)
    assert s["conf_sourced"] is True
    assert s["hook_current"] is False
    assert s["ok"] is False


def test_status_accepts_tilde_hook_path(home, monkeypatch):
    _healthy_home(home)
    _stub_live(
        monkeypatch, {**HEALTHY, "@resurrect-hook-post-save-layout": "~/periscope/bin/periscope resurrect-rewrite"}
    )
    assert tp.status(home / "periscope")["hook_current"] is True


def test_status_no_server_fails_live_checks(home, monkeypatch):
    _healthy_home(home)
    _stub_live(monkeypatch, None)
    s = tp.status(REPO)
    assert s["plugins"] == dict.fromkeys(tp.REQUIRED_PLUGINS, True)
    assert s["restore_on"] is False and s["hook_current"] is False
    assert s["ok"] is False


def test_status_stale_save_flips_ok(home, monkeypatch):
    _healthy_home(home)
    _stub_live(monkeypatch, HEALTHY)
    d = home / ".local/share/tmux/resurrect"
    d.mkdir(parents=True)
    target = d / "tmux_resurrect_old.txt"
    target.write_text("")
    (d / "last").symlink_to(target.name)
    stale_at = time.time() - 3 * 10 * 60  # 3 intervals at the live 10-min setting
    import os

    os.utime(target, (stale_at, stale_at))
    s = tp.status(REPO)
    assert s["last_save_stale"] is True
    assert s["ok"] is False
    fresh = time.time() - 60
    os.utime(target, (fresh, fresh))
    s = tp.status(REPO)
    assert s["last_save_stale"] is False
    assert s["ok"] is True
