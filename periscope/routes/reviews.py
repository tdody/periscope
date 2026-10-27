"""/api/reviews* — the review queue and the native walkthrough.

Periscope never mutates git or GitHub here (spec D1): prepare and merge are
channel messages to the pane that owns the branch; the only filesystem
writes are an append to comments.md and the explicit clear of a review dir.
All handlers are async because delivery goes through channels._deliver;
blocking git/file work runs in a thread so the event loop (every pane
mirror, every MCP connection) never stalls.
"""

import asyncio
import json
import os
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from periscope import channels, gitdiff, open_ops, reviews, state_hub, tracks

router = APIRouter()


def _windows() -> list[dict]:
    blob = state_hub._last_blob
    return json.loads(blob).get("windows", []) if blob else []


def _roots() -> dict[str, str]:
    """repo label → main-checkout path, for every repo periscope knows. The
    queue and the routes must find worktrees the same way, or the queue
    enables prepare on a row the click then 409s."""
    return {os.path.basename(r.rstrip("/")): r for r in open_ops.discover_repos()}


def _check(repo: str, branch: str) -> None:
    """repo and branch become path segments under ~/.claude/reviews — refuse
    anything that could climb out of it."""
    # "." as a branch would make clear_review remove the whole repo dir.
    if (
        not repo
        or "/" in repo
        or repo in (".", "..")
        or not branch
        or branch.startswith("/")
        or any(seg in (".", "..") for seg in branch.split("/"))
    ):
        raise HTTPException(400, "bad repo/branch")


class ReviewRef(BaseModel):
    repo: str
    branch: str


class CommentBody(ReviewRef):
    stop: str
    body: str


@router.get("/api/reviews")
async def reviews_list():
    def load():
        return reviews.list_reviews(_windows(), sorted(open_ops.discover_repos()))  # a set

    rows = await asyncio.to_thread(load)
    return {"rows": rows}


@router.get("/api/reviews/walkthrough")
async def reviews_walkthrough(repo: str, branch: str):
    _check(repo, branch)

    def load():
        text = reviews._read(reviews.walkthrough_path(repo, branch))
        if not text:
            return None
        wins = _windows()
        worktree = reviews.worktree_for(wins, repo, branch, roots=_roots())
        header = reviews.parse_header(text)
        diff = None
        if worktree:
            base = gitdiff.branch_base(worktree)
            diff = gitdiff.diff_for(worktree, base) if base else None
        return {
            "text": text,
            "comments": reviews.parse_comments(reviews._read(reviews.comments_path(repo, branch))),
            "head_now": reviews.head_sha(worktree) if worktree else None,
            "stale_by": reviews.stale_by(worktree, header["head"]) if header and worktree else None,
            "diff": diff,
        }

    body = await asyncio.to_thread(load)
    if body is None:
        raise HTTPException(404, f"no walkthrough for {repo} {branch}")
    return body


async def _deliver_or_409(owner: dict | None, message: str) -> None:
    if not owner:
        raise HTTPException(409, "not delivered: no owning pane on this branch")
    res = await channels._deliver(owner["pane_id"], message, "periscope")
    if not res.get("ok"):
        raise HTTPException(409, f"not delivered: {res.get('error')}")


@router.post("/api/reviews/comment")
async def reviews_comment(body: CommentBody):
    _check(body.repo, body.branch)
    ts = datetime.now().strftime("%Y-%m-%dT%H:%M")
    # Append BEFORE delivery: a comment with no pane to hear it is still kept,
    # and the next pane to prepare the branch is told to read the file.
    await asyncio.to_thread(reviews.append_comment, body.repo, body.branch, body.stop, body.body, ts)
    owner = reviews.owner_for(_windows(), body.repo, body.branch)
    msg = (
        f'Review comment on "{body.stop}" (branch {body.branch}; saved in '
        f"{reviews.comments_path(body.repo, body.branch)}):\n\n{body.body.strip()}"
    )
    await _deliver_or_409(owner, msg)
    return {"ok": True, "delivered": True}


def _prepare_prompt(repo: str, branch: str) -> str:
    return (
        f"Run the `walkthrough` skill for branch `{branch}` and write it to "
        f"`{reviews.walkthrough_path(repo, branch)}`; read "
        f"`{reviews.comments_path(repo, branch)}` first if it exists."
    )


@router.post("/api/reviews/prepare")
async def reviews_prepare(body: ReviewRef):
    _check(body.repo, body.branch)
    wins = _windows()
    owner = reviews.owner_for(wins, body.repo, body.branch)
    prompt = _prepare_prompt(body.repo, body.branch)
    if owner:
        await _deliver_or_409(owner, prompt)
        return {"ok": True, "mode": "delivered"}
    worktree = await asyncio.to_thread(
        lambda: reviews.worktree_for(wins, body.repo, body.branch, fresh=True, roots=_roots())
    )
    if not worktree:
        raise HTTPException(409, "no pane on this branch and no worktree on disk — open the branch first")
    anchored = await asyncio.to_thread(open_ops.resolve_worktree_session, worktree)
    if not anchored:
        raise HTTPException(409, f"{worktree} is not inside a git repo")
    session, project = anchored
    try:
        spawned = await channels.spawn_claude_with_prompt(
            worktree, tracks.repo_default_track(project["repo"]), prompt, session=session
        )
    except channels.SpawnFailed as e:
        raise HTTPException(502, f"spawn failed: {e}") from e
    if not spawned["pid"]:
        # Stamping failed: the window exists but has no identity to return.
        raise HTTPException(500, "spawned a window but could not stamp its pane id")
    return {"ok": True, "mode": "spawned", **spawned}


@router.post("/api/reviews/merge")
async def reviews_merge(body: ReviewRef):
    _check(body.repo, body.branch)
    owner = reviews.owner_for(_windows(), body.repo, body.branch)
    msg = (
        f"This branch (`{body.branch}`) has been reviewed in periscope and the comments in "
        f"`{reviews.comments_path(body.repo, body.branch)}` are resolved. Merge it by this "
        "repo's convention, then report."
    )
    await _deliver_or_409(owner, msg)
    return {"ok": True}


@router.post("/api/reviews/clear")
async def reviews_clear(body: ReviewRef):
    _check(body.repo, body.branch)
    await asyncio.to_thread(reviews.clear_review, body.repo, body.branch)
    return {"ok": True}
