# Reviews Queue Improvements (THI-442) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Reviews queue's PR link reads like every other PR ref, a search box filters its rows, and each row links its Linear ticket when one is known.

**Architecture:** The server decides each row's ticket (`periscope/reviews.py`), by the rule pane chips use: the owning pane's `link_linear` ticket, else `git_pr.linear_ticket_for` over the row's branch and PR title. Rows carry the pane payload's five ticket field names, so the frontend's existing `linearTicket()` renders them unchanged. Search is a pure client-side filter (`filterRows`) over the rows already in the `reviews` signal, driven by a transient `reviewsQuery` signal. Spec: `docs/superpowers/specs/2026-10-27-reviews-queue-improvements-design.md`.

**Tech Stack:** Python 3.14 / FastAPI / pytest (server), Preact + `@preact/signals` / Vite / vitest (frontend), plain CSS in `static/styles.css`.

---

## Before you start

- Work in the worktree `.claude/worktrees/thi-442-reviews-tab-improvements` on branch `thibaultdody/thi-442-reviews-tab-improvements`. Never edit the prod checkout.
- Read `docs/testing.md`: tests must never start real background threads that touch the activity DB. Every `list_reviews` test below mocks `cached_open_prs`, which would otherwise start a `_bg` thread.
- Commit after every task, straight onto the branch, as one-line messages. End each commit with the trailer shown.
- `static/dist/` is committed and CI checks that it's fresh: rebuild it whenever `static/src/` changes (Task 4).
- Don't push. Shipping goes through a fork PR (`fork` → `tomplex/periscope`, title `THI-442: …`), and the user approves each push.

## File map

| File | Change |
|---|---|
| `periscope/reviews.py` | `TicketFields` TypedDict; `ReviewRow` inherits it; `_ticket_fields()` helper; `list_reviews(..., team_keys)` fills the five fields |
| `periscope/routes/reviews.py` | `reviews_list` passes `settings.linear_team_keys` as `team_keys` |
| `static/src/review/walkthrough.js` | `filterRows(rows, query)` beside `sortRows` |
| `static/src/store.js` | `reviewsQuery` signal |
| `static/src/review/ReviewsQueue.jsx` | `PrCell` (PR link class + ticket link), search input, filtered count, no-match state |
| `static/styles.css` | `.rq-pr-link`, `.rq-linear`, `.rq-search`; `.rq-pr-link` joins the shared merged/closed rules |
| `docs/channels.md` | `link_linear` bullet names the Reviews queue |
| `tests/test_reviews.py` | ticket-field cases for `list_reviews` |
| `tests/routes/test_reviews.py` | `/api/reviews` uses the settings' team keys |
| `static/src/review/__tests__/walkthrough.test.js` | `filterRows` cases |
| `static/dist/` | rebuilt |

---

### Task 1: Review rows carry a Linear ticket

**Files:**
- Modify: `periscope/reviews.py` (`ReviewRow` at ~line 199, `list_reviews` at ~line 457, the `rows.append({...})` at ~line 521)
- Test: `tests/test_reviews.py` (append at the end of the file)

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_reviews.py`. `_win` is the existing window fixture near line 134; the autouse `_dir` fixture already points `REVIEWS_DIR` at `tmp_path` and resets `_DEFAULT_BRANCH` / `_GH_SLUG`.

```python
def _pr(number, branch, title="T", role="mine"):
    return {
        "number": number,
        "title": title,
        "branch": branch,
        "draft": False,
        "ci": None,
        "role": role,
        "author": "sam",
    }


def _rows_by_branch(mocker, prs, wins, team_keys=frozenset()):
    # Every gh/git call stubbed; cached_open_prs would otherwise start a _bg thread (docs/testing.md).
    mocker.patch("periscope.reviews.cached_open_prs", return_value=prs)
    mocker.patch("periscope.reviews.gitutil.detect_default_branch", return_value="main")
    mocker.patch("periscope.reviews.gitutil.github_slug", return_value="tom/fdy")
    mocker.patch("periscope.worktrees._cached_worktrees", return_value=[])
    mocker.patch("periscope.reviews.stale_by", return_value=None)
    return {r["branch"]: r for r in reviews.list_reviews(wins, ["/dev/fdy"], team_keys)}


_NO_TICKET = {
    "linked_linear": None,
    "linked_linear_title": None,
    "linked_linear_status": None,
    "linear_ticket": None,
    "linear_ticket_source": None,
}


def _ticket(row):
    return {k: row[k] for k in _NO_TICKET}


def test_row_ticket_is_the_owner_panes_link_over_a_derived_one(mocker):
    wins = [
        _win(
            branch="thibaultdody/thi-442-x",
            linked_linear="THI-9",
            linked_linear_title="Other",
            linked_linear_status="In Progress",
        )
    ]
    rows = _rows_by_branch(mocker, [_pr(45, "thibaultdody/thi-442-x", title="THI-442: queue")], wins)
    assert _ticket(rows["thibaultdody/thi-442-x"]) == {
        **_NO_TICKET,
        "linked_linear": "THI-9",
        "linked_linear_title": "Other",
        "linked_linear_status": "In Progress",
    }


def test_row_ticket_from_the_pr_title_then_the_branch(mocker):
    prs = [
        _pr(45, "feat/queue", title="THI-442: queue search"),
        _pr(46, "thibaultdody/thi-443-colors", title="colors"),
        _pr(47, "feat/plain", title="plain"),
    ]
    rows = _rows_by_branch(mocker, prs, [])
    assert _ticket(rows["feat/queue"]) == {**_NO_TICKET, "linear_ticket": "THI-442", "linear_ticket_source": "pr_title"}
    assert _ticket(rows["thibaultdody/thi-443-colors"]) == {
        **_NO_TICKET,
        "linear_ticket": "THI-443",
        "linear_ticket_source": "branch",
    }
    assert _ticket(rows["feat/plain"]) == _NO_TICKET


def test_row_ticket_respects_linear_team_keys(mocker):
    rows = _rows_by_branch(mocker, [_pr(46, "thibaultdody/thi-443-colors", title="colors")], [], frozenset({"FDY"}))
    assert _ticket(rows["thibaultdody/thi-443-colors"]) == _NO_TICKET


def test_row_ticket_reads_the_prs_branch_not_its_pr_n_checkout(mocker):
    # The owner pane sits on `pr-45`, which names no ticket; the row's headRefName does.
    wins = [_win(pid="rv", branch="pr-45", cwd="/wt/pr-45")]
    prs = [_pr(45, "thibaultdody/thi-442-x", title="queue", role="review-requested")]
    row = _rows_by_branch(mocker, prs, wins)["thibaultdody/thi-442-x"]
    assert row["owner"]["pid"] == "rv"
    assert _ticket(row) == {**_NO_TICKET, "linear_ticket": "THI-442", "linear_ticket_source": "branch"}


def test_local_and_header_rows_derive_from_the_branch_alone(mocker):
    mocker.patch("periscope.reviews.git_pr.cached_linked_pr_state", return_value={"pr_state": "merged", "ci": None})
    p = reviews.walkthrough_path("fdy", "thibaultdody/thi-400-old")
    p.parent.mkdir(parents=True)
    p.write_text("# T\n\n> branch: thibaultdody/thi-400-old · head: abc1234 · pr: 500\n")
    rows = _rows_by_branch(mocker, [], [_win(branch="thibaultdody/thi-441-local")])
    old, local = rows["thibaultdody/thi-400-old"], rows["thibaultdody/thi-441-local"]
    assert old["pr"]["title"] == "" and _ticket(old)["linear_ticket"] == "THI-400"
    assert local["pr"] is None and _ticket(local)["linear_ticket"] == "THI-441"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_reviews.py -q -k "ticket or header_rows"`
Expected: 5 failed, each with `TypeError: list_reviews() takes 2 positional arguments but 3 were given`.

- [ ] **Step 3: Add `TicketFields` and make `ReviewRow` inherit it**

In `periscope/reviews.py`, replace the line `class ReviewRow(TypedDict):` (~line 199) with:

```python
class TicketFields(TypedDict):
    """A row's Linear ticket under the pane payload's field names, so the
    frontend's linearTicket() renders a queue row as it renders a pane (THI-442)."""

    linked_linear: str | None
    linked_linear_title: str | None
    linked_linear_status: str | None
    linear_ticket: str | None
    linear_ticket_source: str | None


class ReviewRow(TicketFields):
```

Leave the body of `ReviewRow` (`repo`, `branch`, … `worktree`) unchanged.

- [ ] **Step 4: Add the `_ticket_fields` helper**

In `periscope/reviews.py`, directly above `def list_reviews(`, add:

```python
def _ticket_fields(owner: dict | None, branch: str, pr_title: str | None, team_keys: frozenset[str]) -> TicketFields:
    """The owner pane's linked ticket, else the one the PR title or the row's
    branch names (git_pr.linear_ticket_for). The row's branch, not the owner's:
    a PR checked out as `pr-<N>` puts its pane on a branch that names nothing."""
    if owner and owner.get("linked_linear"):
        return {
            "linked_linear": owner["linked_linear"],
            "linked_linear_title": owner.get("linked_linear_title"),
            "linked_linear_status": owner.get("linked_linear_status"),
            "linear_ticket": None,
            "linear_ticket_source": None,
        }
    derived = git_pr.linear_ticket_for(branch, pr_title, team_keys)
    return {
        "linked_linear": None,
        "linked_linear_title": None,
        "linked_linear_status": None,
        "linear_ticket": derived[0] if derived else None,
        "linear_ticket_source": derived[1] if derived else None,
    }
```

`git_pr` is already imported at the top of `reviews.py`.

- [ ] **Step 5: Thread `team_keys` through `list_reviews`**

Replace the signature and docstring:

```python
def list_reviews(windows: list[dict], repos: list[str], team_keys: frozenset[str] = frozenset()) -> list[ReviewRow]:
    """Queue rows: GitHub PRs (mine, review-requested) per known repo, then
    live (repo, branch) pairs with no PR, then review dirs matching neither.
    `team_keys` is settings.linear_team_keys, passed in so this module reads no
    settings."""
```

In the `rows.append({...})` at the end of the loop, add one entry after `"worktree": worktree,`:

```python
                "worktree": worktree,
                **_ticket_fields(owner, branch, pr["title"] if pr else None, team_keys),
            }
        )
```

`owner` here is still the full window dict (it's trimmed only inside the `"owner"` entry), so `linked_linear*` are readable.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `uv run pytest tests/test_reviews.py -q`
Expected: all pass (the 5 new ones and every existing case).

- [ ] **Step 7: Lint and type-check**

Run: `bin/check`
Expected: ends with no failures (ruff, ruff format, biome, ty all clean). If ruff format complains, run `bin/check --fix` and re-run `bin/check`.

- [ ] **Step 8: Commit**

```bash
git add periscope/reviews.py tests/test_reviews.py
git commit -m "reviews: a queue row carries its Linear ticket — the owner pane's link, else what its PR title or branch names (THI-442)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `/api/reviews` derives with the configured team keys

**Files:**
- Modify: `periscope/routes/reviews.py:68-74` (`reviews_list`)
- Test: `tests/routes/test_reviews.py` (add after `test_list`, ~line 74)

- [ ] **Step 1: Write the failing test**

Add to `tests/routes/test_reviews.py` after `test_list`. `clean_state` is the autouse conftest fixture; assigning `clean_state["settings"]` is how `tests/test_window_view.py` sets `linear_team_keys`.

```python
def test_list_derives_tickets_with_the_settings_team_keys(client, clean_state, monkeypatch):
    clean_state["settings"] = {"linear_team_keys": ["FDY"]}
    wins = [_win(pid="a", branch="tdody/fdy-8562-x"), _win(pid="b", branch="tdody/thi-442-y")]
    monkeypatch.setattr(state_hub, "_last_blob", json.dumps({"windows": wins}))
    rows = {r["branch"]: r for r in client.get("/api/reviews").json()["rows"]}
    assert rows["tdody/fdy-8562-x"]["linear_ticket"] == "FDY-8562"
    assert rows["tdody/thi-442-y"]["linear_ticket"] is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/routes/test_reviews.py -q -k team_keys`
Expected: FAIL with `AssertionError: assert 'THI-442' is None`. With no keys passed, `THI` still passes the shape rule.

- [ ] **Step 3: Pass the team keys from settings**

In `periscope/routes/reviews.py`, replace `reviews_list` with:

```python
@router.get("/api/reviews")
async def reviews_list():
    # The keys the pane payload derives with (window_view.linear_ticket_fields).
    team_keys = frozenset(store.get_settings().get("linear_team_keys") or ())

    def load():
        return reviews.list_reviews(_windows(), sorted(open_ops.discover_repos()), team_keys)  # a set

    rows = await asyncio.to_thread(load)
    return {"rows": rows}
```

`store` is already imported in this file (`from periscope import channels, ..., store, tracks`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/routes/test_reviews.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add periscope/routes/reviews.py tests/routes/test_reviews.py
git commit -m "reviews route: the queue derives tickets with settings.linear_team_keys (THI-442)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `filterRows` — the search rule

**Files:**
- Modify: `static/src/review/walkthrough.js` (after `sortRows`, ~line 118)
- Test: `static/src/review/__tests__/walkthrough.test.js`

- [ ] **Step 1: Write the failing tests**

In `static/src/review/__tests__/walkthrough.test.js`, change the import on line 2 to:

```js
import { filterRows, matchRefs, parseWalkthrough, sortRows, unresolvedTotal } from "../walkthrough.js";
```

Then append at the end of the file:

```js
describe("filterRows", () => {
  const rows = [
    { repo: "fdy", branch: "feat/restack", pr: { number: 8818, title: "Outcome restack", author: "sam" },
      owner: { name: "gauge-pane" }, linear_ticket: "FDY-8562" },
    { repo: "periscope", branch: "feat/queue", pr: { number: 45, title: "Queue search", author: "tdody" },
      owner: null, linked_linear: "THI-442", linked_linear_title: "Reviews tab improvements" },
    { repo: "periscope", branch: "feat/local", pr: null, owner: null },
  ];
  const branches = (q) => filterRows(rows, q).map((r) => r.branch);

  it("keeps every row, in order, for an empty or blank query", () => {
    expect(filterRows(rows, "")).toEqual(rows);
    expect(filterRows(rows, "   ")).toEqual(rows);
    expect(filterRows(null, "x")).toEqual([]);
  });
  it("matches each field the row shows", () => {
    expect(branches("feat/local")).toEqual(["feat/local"]);              // branch
    expect(branches("periscope")).toEqual(["feat/queue", "feat/local"]); // repo
    expect(branches("#8818")).toEqual(["feat/restack"]);                 // PR number
    expect(branches("search")).toEqual(["feat/queue"]);                  // PR title
    expect(branches("sam")).toEqual(["feat/restack"]);                   // PR author
    expect(branches("gauge")).toEqual(["feat/restack"]);                 // owner pane name
    expect(branches("fdy-8562")).toEqual(["feat/restack"]);              // derived ticket id
    expect(branches("thi-442")).toEqual(["feat/queue"]);                 // linked ticket id
    expect(branches("improvements")).toEqual(["feat/queue"]);            // linked ticket title
  });
  it("ignores case and needs every term", () => {
    expect(branches("QUEUE")).toEqual(["feat/queue"]);
    expect(branches("periscope local")).toEqual(["feat/local"]);
    expect(branches("periscope xyz")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run static/src/review/__tests__/walkthrough.test.js`
Expected: the 3 `filterRows` tests FAIL with `filterRows is not a function`; the existing tests pass.

- [ ] **Step 3: Implement `filterRows`**

In `static/src/review/walkthrough.js`, add directly after the `sortRows` function:

```js
// The queue's search box (THI-442): every whitespace-separated term must occur,
// case-insensitively, in something the row shows — so "fdy thi" narrows to fdy
// rows tied to a THI ticket. Fields join on a space, so a term never spans two.
export function filterRows(rows, query) {
  const terms = (query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return rows || [];
  return (rows || []).filter((r) => {
    const hay = [
      r.branch, r.repo, r.pr ? `#${r.pr.number}` : null, r.pr?.title, r.pr?.author, r.owner?.name,
      r.linked_linear || r.linear_ticket, r.linked_linear_title,
    ].filter(Boolean).join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run static/src/review/__tests__/walkthrough.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add static/src/review/walkthrough.js static/src/review/__tests__/walkthrough.test.js
git commit -m "review queue: filterRows — every search term must occur in something the row shows (THI-442)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The queue view — PR link, ticket link, search box

**Files:**
- Modify: `static/src/store.js` (after `export const reviews = signal(null);`, line 18)
- Modify: `static/src/review/ReviewsQueue.jsx`
- Modify: `static/styles.css` (~lines 2929–2930 and after `.rq-actions button`, ~line 3934)
- Rebuild: `static/dist/`

No component test harness exists for `ReviewsQueue`. The logic lives in `filterRows` (Task 3) and `linearTicket` (already tested), and the view is checked by hand in Task 6.

- [ ] **Step 1: Add the `reviewsQuery` signal**

In `static/src/store.js`, directly after `export const reviews = signal(null);`:

```js
// The Reviews queue's search text (THI-442): it survives opening a walkthrough
// and coming back; a reload clears it.
export const reviewsQuery = signal("");
```

- [ ] **Step 2: Update the imports in `ReviewsQueue.jsx`**

Replace the import block (lines 4–9) with:

```js
import { useEffect, useState } from "preact/hooks";
import { confirmDialog } from "../overlays/Dialog.jsx";
import { refreshReviews } from "../poll.js";
import { selectReview } from "../split/alertFeed.js";
import { linearTicket } from "../split/linearTicket.js";
import { reviews, reviewsQuery } from "../store.js";
import { prStateMeta } from "../util.js";
import { filterRows, sortRows } from "./walkthrough.js";
```

- [ ] **Step 3: Add `PrCell`**

In `ReviewsQueue.jsx`, add above `function Row({ row }) {`:

```jsx
// PR refs read like every other one in periscope (mono, fg-1, violet when merged,
// struck when closed): unstyled, this link was the UA's default blue. The ticket
// follows the number; with no PR it fills the cell alone.
function PrCell({ row }) {
  const lin = linearTicket(row);
  const linLink = lin && <a class="rq-linear" href={lin.href} target="_blank" rel="noopener" title={lin.tip}>{lin.id}</a>;
  if (!row.pr) return linLink || "—";
  const cls = `rq-pr-link ${prStateMeta(row.pr.state).cls}`;
  return <>
    {row.pr.url ? <a class={cls} href={row.pr.url} target="_blank" rel="noopener">#{row.pr.number}</a> : <span class={cls}>#{row.pr.number}</span>}
    {linLink ? <> · {linLink}</> : null}
    {row.pr.draft ? " draft" : ""} {row.pr.state || ""} {row.pr.ci || ""}<div class="rq-repo">{row.pr.title}</div></>;
}
```

- [ ] **Step 4: Use `PrCell` in `Row`**

In `Row`, replace the whole PR cell:

```jsx
      <td class="rq-pr">{row.pr ? <>
        {row.pr.url ? <a href={row.pr.url} target="_blank" rel="noopener">#{row.pr.number}</a> : `#${row.pr.number}`}
        {row.pr.draft ? " draft" : ""} {row.pr.state || ""} {row.pr.ci || ""}<div class="rq-repo">{row.pr.title}</div></> : "—"}</td>
```

with:

```jsx
      <td class="rq-pr"><PrCell row={row} /></td>
```

- [ ] **Step 5: Add the search box, filtered count and no-match state**

Replace the whole `ReviewsQueue` function with:

```jsx
export function ReviewsQueue() {
  useEffect(() => { refreshReviews(); }, []);
  const rows = reviews.value;
  if (rows === null) return <div class="wt-empty">loading…</div>;
  const sorted = sortRows(rows);
  const query = reviewsQuery.value;
  const shown = filterRows(sorted, query);
  const noun = `branch${sorted.length === 1 ? "" : "es"}`;
  return (
    <div class="reviews-queue">
      <header class="wt-head">
        <h2>Reviews</h2>
        <span class="wt-sub">{query.trim() ? `${shown.length} of ${sorted.length} ${noun}` : `${sorted.length} ${noun}`}</span>
        {/* type=search: WebKit and Chromium clear it on Esc and draw the ✕ themselves. */}
        <input type="search" class="rq-search" placeholder="filter branches, PRs, people, tickets" aria-label="filter reviews"
          value={query} onInput={(e) => { reviewsQuery.value = e.currentTarget.value; }} />
      </header>
      {sorted.length === 0 ? <div class="wt-empty">nothing open</div>
        : shown.length === 0 ? <div class="wt-empty">no branches match "{query.trim()}"</div> : (
        <table class="rq-table">
          <thead><tr><th>branch</th><th>PR</th><th>walkthrough</th><th>comments</th><th>who</th><th></th></tr></thead>
          <tbody>{shown.map((r) => <Row key={`${r.repo}/${r.branch}`} row={r} />)}</tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Add `.rq-pr-link` to the shared PR lifecycle rules**

In `static/styles.css` (~lines 2929–2930), replace:

```css
.pane-pill-pr.is-merged, .wt-meta-pr.is-merged, .header-pr.is-merged { color: var(--worktree); }
.pane-pill-pr.is-closed, .wt-meta-pr.is-closed, .header-pr.is-closed { color: var(--fg-3); text-decoration: line-through; }
```

with:

```css
.pane-pill-pr.is-merged, .wt-meta-pr.is-merged, .header-pr.is-merged, .rq-pr-link.is-merged { color: var(--worktree); }
.pane-pill-pr.is-closed, .wt-meta-pr.is-closed, .header-pr.is-closed, .rq-pr-link.is-closed { color: var(--fg-3); text-decoration: line-through; }
```

- [ ] **Step 7: Add the queue's link and search styles**

In `static/styles.css`, directly after `.rq-actions button { margin-right: 6px; }` (~line 3934):

```css
/* Refs in the queue read like the pane pill / wt-meta chip / detail header ones;
   the PR link was the UA's default blue before (THI-442). */
.rq-pr-link, .rq-linear { font-family: var(--mono); text-decoration: none; }
.rq-pr-link { color: var(--fg-1); }
.rq-linear { color: oklch(0.7 0.13 280); }
a.rq-pr-link:hover, .rq-linear:hover { text-decoration: underline; }
.rq-search {
  margin-left: auto; width: 240px; box-sizing: border-box;
  font: inherit; font-size: 12px; color: var(--fg-1);
  background: var(--bg-1); border: 1px solid var(--line-soft); border-radius: var(--r-sm);
  padding: 3px 8px;
}
.rq-search::placeholder { color: var(--fg-4); }
.rq-search:focus { outline: none; border-color: var(--accent); }
```

- [ ] **Step 8: Run the frontend tests and lint**

Run: `npm test`
Expected: all vitest suites pass.

Run: `bin/check`
Expected: no failures. Biome lints `static/src`; its formatter is off, so the terse JSX style above stays as written.

- [ ] **Step 9: Commit the source**

```bash
git add static/src/store.js static/src/review/ReviewsQueue.jsx static/styles.css
git commit -m "review queue: PR link styled like every PR ref, a Linear ticket beside it, a search box over the rows (THI-442)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 10: Rebuild and commit `static/dist/`**

Run: `npm run build`
Expected: vite reports the build written to `static/dist/` with no errors.

```bash
git add static/dist
git commit -m "build: static/dist" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Document where the queue's ticket comes from

**Files:**
- Modify: `docs/channels.md:13-18` (the `link_linear` bullet)

- [ ] **Step 1: Extend the `link_linear` bullet**

In `docs/channels.md`, replace:

```markdown
  `settings.linear_team_keys` narrows it to known keys); a link replaces
  that. Optional `title`/`status` metadata renders on the card and in the
  modal; each call fully describes the link.
```

with:

```markdown
  `settings.linear_team_keys` narrows it to known keys); a link replaces
  that. Optional `title`/`status` metadata renders on the card and in the
  modal; each call fully describes the link. The Reviews queue shows the
  same ticket per row: the owning pane's link, else what the row's PR title
  or branch names (`reviews._ticket_fields`).
```

- [ ] **Step 2: Commit**

```bash
git add docs/channels.md
git commit -m "docs: channels.md says the Reviews queue shows a row's Linear ticket (THI-442)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Full verification

- [ ] **Step 1: Full Python suite**

Run: `uv run pytest -q`
Expected: all pass. If `tests/test_channel_shim.py` fails spuriously, run `uv sync` and re-run (docs/testing.md).

- [ ] **Step 2: Full frontend suite and gate**

Run: `npm test && bin/check`
Expected: all vitest suites pass; `bin/check` reports no failures.

- [ ] **Step 3: `static/dist` is fresh**

Run: `npm run build && git status --short static/dist`
Expected: no output (the committed bundle matches the source).

- [ ] **Step 4: Check it by hand on the dev server**

Run (background): `PERISCOPE_PORT=17375 PERISCOPE_DEV=1 uv run server.py`
Open `http://127.0.0.1:17375/`, click "◉ reviews" in the header, and confirm:
- an open PR's `#N` is mono in the normal text color (not blue/purple), underlined on hover; a merged one is violet, a closed one dimmed and struck through
- a row whose PR title opens `THI-…:` or whose branch is `<user>/thi-…-…` shows ` · THI-…` in violet after the number, with a tooltip saying where it came from; a local Linear-shaped branch with no PR shows the ticket alone in the PR column
- typing in the search box narrows the rows and the count reads `M of N branches`; a query with no hits shows `no branches match "…"`; Esc clears it
- open a walkthrough from the queue and come back: the query is still there; reload: it's gone

Stop the dev server when done.
