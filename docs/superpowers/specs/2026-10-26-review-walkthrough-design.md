# Review queue + native walkthrough

A "Reviews" surface in periscope listing every branch waiting on review, and a
native stop-by-stop walkthrough per branch — structural claims with the hunks
as evidence — authored by the pane that owns the branch, commented on from
periscope, with comments landing back in that pane. Replaces the LGTM
integration and, with the render-time doc enrichment it introduces, the
doc-enricher pipeline.

## Smallest version

**Problem:** After a sprint, the branches waiting on review aren't visible in
one place, and reviewing one means reading code instead of a structural tour
whose feedback reaches the pane that wrote it.

**Seams:** four, all present today —
- review surface: the rail's per-track `review` row + its detail view (one
  producer, one renderer; gated today on an LGTM session)
- document rendering: `renderMarkdown` — 3 call sites (transcript ×2, preview ×1)
- message into a pane: `_deliver(pane_id, message, sender)` — what `send_to` uses
- branch hunks: `GET /api/fs/diff?scope=branch` — what the Changes tab renders

**Minimal version (~18 files + dist; 6 new, 12 edited, plus removals and tests):** the review row appears when a
walkthrough file exists for the branch and opens a native stop-by-stop view; a
"Reviews" selection in the detail area lists every branch with its
PR/CI/walkthrough/comment state; comments append to a sidecar file and are
delivered to the owning pane; prepare/merge are messages to that pane, never
git operations periscope runs.

Left out, and what it costs:
- refs whose lines moved after the tour was written → chip renders "no hunk";
  recovery: prepare again
- a merge that fails (conflict, red CI) → reported by the pane in its
  transcript, not on the queue row
- a walkthrough for a branch whose worktree is gone → the row shows the tour
  but no hunks (the diff needs a checkout); recovery: open the branch (⌘K)

Accepted consequences:
- the tour can be stale — the file records the head it was written at; the
  view says "N commits since" and leaves it to you
- walkthroughs and comments live outside the repo, so they are not shared
  with the team
- mermaid is a ~1 MB lazy chunk, loaded on first diagram

Additions:
- **picked** +2 files → removes "no live pane on the branch": prepare spawns a
  Claude on the track when none is live, through the existing spawn path
- not picked → periscope runs the merge itself (moves a git mutation across
  the trust boundary for one click saved)
- later, own spec → decision log: same renderer, a `decision` convention
  beside `stop`

Dropped:
- a periscope DB table for walkthroughs/comments — the files are the store
- stacked-PR modeling — not in use

File budget: 20 (18 + the spawn addition). Stop and report at 40. Removals and tests don't count.

## Decisions

### D1. Periscope never mutates git or GitHub

Prepare, re-prepare, merge, and "address comments" are all messages to the
pane that owns the branch. The dashboard stays a lens; the pane is the actor.
This is also the ownership story: a review belongs to a pane, a pane to a
track, a track to a branch — nothing is nebulous about who holds it.

### D2. The walkthrough is a file on disk, not periscope state

`~/.claude/reviews/<repo>/<branch-slug>/walkthrough.md` plus `comments.md`
beside it. Outside the repo: no gitignore or exclude dance, nothing the team
sees, and it survives worktree removal — a cleaned-up branch still shows its
tour until it merges. The authoring skill owns the path; periscope reads it
by convention. `<repo>` is the repo's basename; `<branch-slug>` is the branch
with `/` → `--`.

One writer per file: the pane writes `walkthrough.md`; periscope only ever
appends to `comments.md`; the pane edits `comments.md` only to flip
`resolved`.

### D3. Markdown with three conventions, each degrading to plain markdown

```markdown
# <title>

> branch: feat/x · head: 3f2a1c9 · pr: 1234 · repo: fdy
> base: main

<one-paragraph problem statement, no code vocabulary>

## Adds a per-pane cost-pressure gauge
> kind: new-subsystem · refs: periscope/cost_pressure.py, static/src/split/ctxBand.js:1-40

<prose: what it is, what it owns, what it depends on>

```mermaid
flowchart LR
  poll --> ctxBand --> Rail
```

## Reuses the PR cache for CI state
> kind: reuse · refs: periscope/git_pr.py:223-276

<prose: which existing thing, and why it is the right one>
```

- **Header block:** the first blockquote after the title; `key: value` pairs
  separated by ` · `. Required: `branch`, `head`. Optional: `pr`, `base`,
  `repo`.
- **Stop:** every `##` heading. The blockquote directly under it carries
  `kind` (one of `new-subsystem`, `extension`, `reuse`, `system-touch`,
  `behavior`) and `refs` (comma-separated `path` or `path:a-b`). A `##`
  without a conforming blockquote is still a stop, with no kind and no refs.
- **Diagrams:** ` ```mermaid ` fences.
- **Citations:** bare `path:line` or `path:a-b` tokens anywhere in prose
  (path must contain a `/` or a `.`; this is the review-map chip rule).

Stops are ordered by damage-if-wrong; the file order is the tour order.

### D4. Enrichment happens at render time, for every document

The shared markdown renderer gains three opt-in behaviors — mermaid fences →
SVG, a heading's metadata blockquote → a badge row, citation tokens → chips.
The transcript skin leaves them off and renders exactly as today. The
preview tab turns them on for every `.md`, so specs get diagrams and chips
with no second artifact. That is what retires the doc-enricher: the author
writes one markdown file; the look is periscope's job and improves for all
docs at once.

### D5. The walkthrough view is the renderer plus three things

Stops as cards (kind badge, anchor), the referenced hunks from the branch
diff collapsed under each stop — rendered by the Changes tab's existing hunk
component, intraline highlighting included — and a comment box per stop. A
staleness chip when the branch head differs from the header's `head`.

### D6. The Reviews queue is a detail-area selection, one row per branch

Rows come from the live windows grouped by track/branch, plus any
`~/.claude/reviews/<repo>/<slug>` with no live window (so cleaned-up
branches still appear). Columns: PR (number, state, CI glyph), walkthrough
(none / N stops / stale), comments (M unresolved), owning pane (live /
none). Sort: unresolved comments, then PR-without-walkthrough, then the
rest, each group by PR number desc. Row click selects that branch's review
row. Actions: **prepare** (message the owning pane to run the `walkthrough`
skill; spawns one on the track if none is live), **merge** (message the
owning pane to merge; disabled with a reason when no pane is live).

### D7. Comments are an append plus a channel message

A comment appends one entry to `comments.md` and delivers the same text to
the owning pane as a channel message naming the stop:

```markdown
## 2026-10-26T09:14 · Adds a per-pane cost-pressure gauge
> resolved: no

Why does this bypass the signals store? The rail reads it straight from poll.
```

The pane acts and flips `resolved: no` → `yes`. The queue counts unresolved
entries; the walkthrough view lists each stop's comments under it.

### D8. The LGTM integration is removed in this change

It is the thing being replaced; leaving it means two review rows. Removed:
`lgtm.py`, `routes/lgtm.py`, the refresh task and SSE tasks in `app.py`, the
`lgtm` field in the window view, the iframe `ReviewDetail`/`ReviewStart` and
the `👁 review` chip, their tests, `docs/lgtm.md`, the CLAUDE.md row.

### D9. The doc-enricher retires separately

After the renderer lands and one spec has been read through it: delete the
`doc-enricher` agent, `~/.claude/tools/doc-enrich`, and the "Document review"
section of the operator prompt; `open_document` the `.md` directly. Outside
this repo, so outside this spec's budget.

## Mechanics

### Server

**`periscope/reviews.py`** (new, pure; no HTTP)

- `reviews_dir()` → `~/.claude/reviews`. Not periscope state, so prod and dev
  read the same tree (no `instance_file` split).
- `slug_for(branch)` — `/` → `--`.
- `walkthrough_path(repo_name, branch)` / `comments_path(...)`.
- `parse_header(text)` → `{branch, head, pr, base, repo}` from the first
  blockquote after the H1.
- `count_stops(text)` → number of `##` headings.
- `parse_comments(text)` → `[{ts, stop, resolved, body}]`; `unresolved(text)`.
- `append_comment(repo_name, branch, stop, body, ts)` — append-only; creates
  the file with no header if absent.
- `list_reviews(windows)` → the queue rows: for each live window with a
  branch, merged with every reviews-dir entry with no live window. Each row:
  `{repo, branch, slug, pr: {...} | None, walkthrough: {stops, head,
  stale_by} | None, unresolved, owner: {pid, session, index} | None,
  worktree: path | None}`. `stale_by` = `git rev-list --count <head>..HEAD`
  in the worktree when one exists, else `None`.

**`periscope/routes/reviews.py`** (new)

- `GET /api/reviews` → `{rows: [...]}` (list_reviews over the current window
  view).
- `GET /api/reviews/walkthrough?repo=&branch=` → `{text, comments: [...],
  head_now, stale_by}`; 404 when no file.
- `POST /api/reviews/comment` `{repo, branch, stop, body}` → appends, then
  `_deliver(owner_pane, "<review comment on stop '…'>\n\n<body>\n\n(in
  ~/.claude/reviews/<repo>/<slug>/comments.md)", "periscope")`; 409 when no
  owning pane is live (the append still happens — the comment is not lost;
  the response says it was not delivered).
- `POST /api/reviews/prepare` `{repo, branch}` → `_deliver` the prepare
  prompt to the owning pane; when none is live, spawn one on the branch's
  track with that prompt as the initial message (the picked addition) via
  the existing `window_new` resume/plain path with the worktree as cwd.
- `POST /api/reviews/merge` `{repo, branch}` → `_deliver` the merge prompt;
  409 with reason when no pane is live.

The prepare prompt: "Run the `walkthrough` skill for this branch and write
it to `<path>`." The merge prompt: "This branch has been reviewed. Merge it
(your normal path — local merge or `gh pr merge` as the repo's convention
says), then report."

**`window_view.py`** — the `lgtm` field is removed. No new per-window field:
the queue reads the reviews dir itself, and the rail's review row is gated
on the queue payload (below).

**`app.py`** — drop the lgtm tasks and router; add the reviews router.

### Frontend

**`split/markdown.jsx`** — `renderMarkdown(text, {mermaid, meta, cite})`:
- `mermaid: true` → a ` ```mermaid ` fence renders `<Mermaid code=…/>` from
  the lazy preview chunk; falls back to the plain fence while loading or on
  a mermaid parse error (error text under the fence).
- `meta: true` → a blockquote whose only paragraph is `key: value · key:
  value` pairs, directly following a heading, renders as `<div
  class="md-meta">` of `<span class="md-meta-kv">` chips.
- `cite: (ref) => vnode | null` → path tokens matching the chip rule are
  passed to it; `null` leaves the text as is. The preview tab passes a chip
  that opens the file tab at that line; the walkthrough passes one that
  scrolls to the matching hunk.

**`preview/Mermaid.jsx`** (new, in the lazy chunk) — `mermaid.render` into an
inline SVG, theme from `prefers-color-scheme`; `mermaid` added to
`package.json`.

**`preview/PreviewTabInner.jsx`** — the `.md` branch passes `{mermaid: true,
meta: true, cite}`.

**`review/walkthrough.js`** (new, pure) — `parseWalkthrough(text)` →
`{header, problem, stops: [{id, title, kind, refs, bodyMarkdown}]}`;
`matchRefs(refs, diffFiles)` → hunks per ref (`path` → every hunk in that
file; `path:a-b` → hunks whose new-side range intersects).

**`review/Walkthrough.jsx`** (new) — fetches `/api/reviews/walkthrough` and
`/api/fs/diff?scope=branch` for the owning pane (skipped when no worktree);
renders the header + staleness chip, the problem paragraph, then each stop:
badge row, prose via `renderMarkdown` (all three opts on), the matched hunks
collapsed (reusing `ChangesTab`'s `FileHunks` component), the stop's
comments, and a comment box posting to `/api/reviews/comment`.

**`review/ReviewsQueue.jsx`** (new) — fetches `/api/reviews` on mount and
every 10 s while selected; renders the table from D6 with the prepare/merge
buttons.

**`split/Detail.jsx`** — `ReviewDetail`/`ReviewStart` and the iframe go;
`review:<key>` selections render `<Walkthrough>`; a new `reviews` selection
renders `<ReviewsQueue>`.

**`split/Rail.jsx` / `RailRows.jsx`** — `reviewRowFor(trackId)` gates on the
queue payload (a walkthrough exists for the track's branch) instead of
`w.lgtm`; the row's key is `review:<repo>/<slug>`. The queue payload is
fetched once per poll alongside `/api/state` (`poll.js`) into a signal, so
the rail and the queue share it.

**`chrome/Header.jsx`** — a "Reviews" button (badge = total unresolved)
selecting `reviews`; `open/classify.js` gets a `reviews` omnibox entry.

**CSS** — `md-meta`, stop cards, queue table, staleness chip, in the existing
stylesheet.

**Removed:** the `lgtm` references in `Detail.jsx`, `Rail.jsx`,
`RailRows.jsx`, `attention.test.js`.

### Skill

**`~/.claude/skills/walkthrough/SKILL.md`** replaces `review-map`. Same
comprehension stance (problem statement with no code vocabulary; ranked by
damage-if-wrong; written from the diff and live code, never from the PR
body), but the output is D3's format at D2's path. It carries: the five
kinds with a one-line test for each; the rule that a stop is a structural
claim and refs are evidence, not prose; "reuse" stops must name the existing
thing and why it is the right one (the #8867 check); a mermaid diagram on
any stop that introduces or crosses a boundary; and the closing step — read
`comments.md`, address, flip `resolved`. Out of this repo's file budget; the
plan carries it as its own task.

### Tests

vitest:
- `review/__tests__/walkthrough.test.js` — header parse, stop parse with and
  without a conforming blockquote, unknown kind kept as text, ref matching
  (whole file, intersecting range, no match).
- `split/__tests__/markdown.test.js` — the meta blockquote only triggers
  directly under a heading and only with `meta: true`; a mermaid fence is a
  plain fence with `mermaid: false`; cite callback receives path tokens and
  not prose.
- queue sort (pure, exported from `ReviewsQueue.jsx` or a sibling).

pytest:
- `tests/test_reviews.py` — path/slug mapping, header/comment parsing,
  `append_comment` creates and appends, `list_reviews` merges live windows
  with orphan review dirs and computes `stale_by` against a temp git repo.
- `tests/routes/test_reviews.py` — comment route appends then delivers
  (patch `_deliver`, assert pane and message), 409 path still appends;
  prepare with no live pane calls the spawn path; merge with no pane is 409.
- removal: `test_lgtm.py`, `tests/routes/test_lgtm.py`, and the lgtm cases
  in `test_window_view.py` / `test_app.py` / `test_state.py` go.

The rendered walkthrough and queue are checked in the browser at :17375
with a hand-written walkthrough for this branch.
