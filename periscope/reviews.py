"""The review walkthrough convention: files under ~/.claude/reviews that the
`walkthrough` skill writes and periscope renders. Periscope only ever appends
to comments.md and removes a whole review dir on an explicit clear — the pane
is the sole writer of walkthrough.md (spec D2).

Two parsers read this format: this line-based one (header, stop count,
comments — cheap enough to run per queue refresh) and the frontend's mdast one
(the view). They agree on ATX headings and plain-text metadata blockquotes,
which is all the skill emits.
"""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import TypedDict

REVIEWS_DIR = Path(os.path.expanduser("~/.claude/reviews"))

# A metadata pair: lowercase dashed key, a space, any value. Anything with
# markup (bold, links) fails this, which is the "plain text only" rule
# without a markdown parser.
_PAIR_RE = re.compile(r"^([a-z-]+): (.+)$")
_COMMENT_HEAD_RE = re.compile(r"^## (\d{4}-\d\d-\d\dT\d\d:\d\d) · (.+)$")
_RESOLVED_RE = re.compile(r"^> resolved: (yes|no)$")


class Header(TypedDict):
    branch: str
    head: str
    pr: int | None
    repo: str | None


class Comment(TypedDict):
    ts: str
    stop: str
    resolved: bool
    body: str


# --- paths -----------------------------------------------------------------


def slug_for(branch: str) -> str:
    return branch.replace("/", "--")


def review_dir(repo: str, branch: str) -> Path:
    return REVIEWS_DIR / repo / slug_for(branch)


def walkthrough_path(repo: str, branch: str) -> Path:
    return review_dir(repo, branch) / "walkthrough.md"


def comments_path(repo: str, branch: str) -> Path:
    return review_dir(repo, branch) / "comments.md"


# --- parse -----------------------------------------------------------------


def meta_pairs(lines: list[str]) -> dict[str, str] | None:
    """The D3 pair rule over the stripped lines of one blockquote: every
    ` · `- or newline-separated piece must be `key: value`. None means it is
    an ordinary blockquote."""
    out: dict[str, str] = {}
    for line in lines:
        for piece in line.split(" · "):
            m = _PAIR_RE.match(piece.strip())
            if not m:
                return None
            out[m.group(1)] = m.group(2).strip()
    return out or None


def _quote_after_title(text: str) -> list[str]:
    """Stripped lines of the blockquote directly after the first `# ` line."""
    lines = text.splitlines()
    i = 0
    while i < len(lines) and not lines[i].startswith("# "):
        i += 1
    i += 1
    while i < len(lines) and not lines[i].strip():
        i += 1
    quote: list[str] = []
    while i < len(lines) and lines[i].startswith(">"):
        quote.append(lines[i][1:].strip())
        i += 1
    return quote


def parse_header(text: str) -> Header | None:
    pairs = meta_pairs(_quote_after_title(text))
    if not pairs or "branch" not in pairs or "head" not in pairs:
        return None
    pr = pairs.get("pr")
    return {
        "branch": pairs["branch"],
        "head": pairs["head"],
        "pr": int(pr) if pr and pr.isdigit() else None,
        "repo": pairs.get("repo"),
    }


def count_stops(text: str) -> int:
    """ATX `## ` lines outside fenced code."""
    n = 0
    fence: str | None = None
    for line in text.splitlines():
        s = line.strip()
        if fence:
            if s.startswith(fence):
                fence = None
            continue
        if s.startswith(("```", "~~~")):
            fence = s[:3]
            continue
        if line.startswith("## "):
            n += 1
    return n


def parse_comments(text: str) -> list[Comment]:
    """An entry starts at `## <ts> · <stop>` followed by `> resolved: yes|no`.
    A body line that merely starts with `## ` stays body."""
    lines = text.splitlines()
    out: list[Comment] = []
    i = 0
    while i < len(lines):
        m = _COMMENT_HEAD_RE.match(lines[i])
        r = _RESOLVED_RE.match(lines[i + 1]) if m and i + 1 < len(lines) else None
        if not (m and r):
            i += 1
            continue
        body: list[str] = []
        j = i + 2
        while j < len(lines):
            m2 = _COMMENT_HEAD_RE.match(lines[j])
            if m2 and j + 1 < len(lines) and _RESOLVED_RE.match(lines[j + 1]):
                break
            body.append(lines[j])
            j += 1
        out.append(
            {"ts": m.group(1), "stop": m.group(2), "resolved": r.group(1) == "yes", "body": "\n".join(body).strip()}
        )
        i = j
    return out


def unresolved(text: str) -> int:
    return sum(1 for c in parse_comments(text) if not c["resolved"])


# --- files -----------------------------------------------------------------


def append_comment(repo: str, branch: str, stop: str, body: str, ts: str) -> None:
    path = comments_path(repo, branch)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(f"## {ts} · {stop}\n> resolved: no\n\n{body.strip()}\n\n")


def clear_review(repo: str, branch: str) -> None:
    d = review_dir(repo, branch).resolve()
    if not d.is_relative_to(REVIEWS_DIR.resolve()) or d == REVIEWS_DIR.resolve():
        raise ValueError(f"refusing to remove {d}: outside the reviews dir")
    shutil.rmtree(d, ignore_errors=True)
