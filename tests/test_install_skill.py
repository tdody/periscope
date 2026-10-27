"""`bin/periscope install-skill` / `uninstall-skill`: the vendored skills under
`skills/` are symlinked into every account config dir's `skills/`, with the
same repoint rule as the hooks — never steal another live checkout's link."""

import os
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
VENDORED = REPO / "skills" / "walkthrough"


def _periscope(home: Path, *args: str) -> subprocess.CompletedProcess:
    # HOME redirects both ~/.claude and the state.json the account list comes from.
    return subprocess.run(
        ["sh", str(REPO / "bin" / "periscope"), *args],
        text=True,
        capture_output=True,
        env={**os.environ, "HOME": str(home)},
        timeout=60,
    )


def test_install_links_each_vendored_skill_and_uninstall_removes_only_ours(tmp_path):
    claude = tmp_path / ".claude"
    claude.mkdir()
    link = claude / "skills" / "walkthrough"

    r = _periscope(tmp_path, "install-skill")
    assert r.returncode == 0, r.stderr
    assert link.is_symlink() and link.resolve() == VENDORED.resolve()
    assert (link / "SKILL.md").read_text().startswith("---\nname: walkthrough")

    r = _periscope(tmp_path, "install-skill")
    assert r.returncode == 0 and "already linked" in r.stdout

    r = _periscope(tmp_path, "uninstall-skill")
    assert r.returncode == 0, r.stderr
    assert not link.exists() and not link.is_symlink()


def test_install_repoints_a_dangling_link_but_keeps_a_live_foreign_one_and_a_real_dir(tmp_path):
    claude = tmp_path / ".claude"
    skills = claude / "skills"
    skills.mkdir(parents=True)
    link = skills / "walkthrough"

    # A link left behind by a removed worktree: dead, so ours replaces it.
    link.symlink_to(tmp_path / "gone" / "walkthrough")
    assert _periscope(tmp_path, "install-skill").returncode == 0
    assert link.resolve() == VENDORED.resolve()

    # Another checkout's live link (prod's, when installing from a worktree): kept.
    other = tmp_path / "other-checkout" / "skills" / "walkthrough"
    other.mkdir(parents=True)
    link.unlink()
    link.symlink_to(other)
    r = _periscope(tmp_path, "install-skill")
    assert r.returncode == 0 and "left alone" in r.stderr
    assert link.resolve() == other.resolve()
    assert _periscope(tmp_path, "uninstall-skill").returncode == 0
    assert link.is_symlink()  # not ours, not removed

    # The user's own directory: kept too.
    link.unlink()
    link.mkdir()
    (link / "SKILL.md").write_text("mine")
    r = _periscope(tmp_path, "install-skill")
    assert r.returncode == 0 and "not a link" in r.stderr
    assert (link / "SKILL.md").read_text() == "mine"
