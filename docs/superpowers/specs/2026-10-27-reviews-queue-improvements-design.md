# Reviews queue: PR link color, search, Linear ticket (THI-442)

Three changes to the Reviews queue (`static/src/review/ReviewsQueue.jsx`, the
"◉ reviews" selection): its PR link stops rendering in the browser's default
link blue, a search box filters the rows, and each row links the Linear ticket
its branch is for when one is known. Builds on the queue from
`2026-10-26-review-walkthrough-design.md` (D1, D2, D6 unchanged) and the
derived-ticket rule from THI-441 (`git_pr.linear_ticket_for`).

## Problem

- **PR link color.** The `#N` link in the PR column (ReviewsQueue.jsx:51) has
  no class, and `static/styles.css` has no `a` rule, so it renders in the
  user agent's default link blue — purple once visited — on a dark theme.
  Every other PR ref in periscope (pane pill, walkthrough meta chip, detail
  header) is mono in `--fg-1`, violet when merged, struck through when closed.
- **No search.** The queue lists every open PR that is mine or awaits my
  review across every discovered repo, plus local branches and orphan review
  dirs. Finding one row means scanning the table.
- **No ticket.** A pane shows its Linear ticket (linked by Claude, or derived
  from its PR title or a Linear-shaped branch); the queue row for the same
  branch does not.

## Decisions

### D1. The ticket is decided on the server, by the rule pane chips use

`list_reviews` puts the five ticket fields a pane payload already carries on
each row — `linked_linear`, `linked_linear_title`, `linked_linear_status`,
`linear_ticket`, `linear_ticket_source` — so the frontend renders a row with
the existing `linearTicket(row)` (`static/src/split/linearTicket.js`)
unchanged: same href, same tooltip wording, same "derived" note.

Precedence, per row:
1. The owner pane (`owner_for`: the channel-attached Claude on that repo +
   branch) has `linked_linear` → copy `linked_linear`, `linked_linear_title`,
   `linked_linear_status`; `linear_ticket` and `linear_ticket_source` are
   `None`. Same as a pane payload: a link replaces a derived ticket.
2. Otherwise `git_pr.linear_ticket_for(row["branch"], pr_title, team_keys)` →
   `linear_ticket`, `linear_ticket_source` (`"pr_title"` | `"branch"`); the
   three `linked_*` fields are `None`.
3. Neither → all five `None`.

The derived ticket is read from the **row's** branch (the PR's `headRefName`)
and PR title, never from the owner window's own `linear_ticket`: a PR checked
out as `pr-45` (`projects.fetch_pr_into_worktree`) puts its pane on a branch
that names no ticket.

`pr_title` is `row["pr"]["title"]` when the row has a PR. A row whose PR came
from a walkthrough header (merged, closed, or dropped from
`review-requested:@me`) has an empty title, so it derives from the branch
alone; a `local` row has no PR and does the same.

Revised after review (`reviews._ticket_title`): when the row has no title, the
owner pane's `pr_title` stands in — but only if the owner's PR is the row's
(or the row has none), so a pane linked to another PR can't lend its title. A
teammate's PR you've reviewed leaves `review-requested:@me` while still open;
without this its row lost the ticket the pane card still showed. A merged PR
with no pane on its branch still derives from the branch alone.

One builder, `git_pr.linear_ticket_fields(linked, branch, pr_title,
team_keys) -> TicketFields`, makes the five fields for the pane payloads
(`window_view`, `/api/pane`) and the queue rows alike. The first cut copied
the rule into `reviews.py`, a third builder of one contract right after
THI-441's review had folded two into one.

Rejected: deriving in the browser. It needs a JS copy of
`_TITLE_TICKET_RE` / `_BRANCH_TICKET_RE` / `_NOT_TEAM_KEYS` and the
`linear_team_keys` setting — two copies of one rule that will drift.

### D2. `reviews.py` takes the team keys as an argument

`list_reviews(windows, repos, team_keys: frozenset[str] = frozenset())`. The
route passes `store.linear_team_keys()`, the getter the pane payloads use too.
`reviews.py` and `git_pr.linear_ticket_fields` read no settings, and tests
pass keys directly.

### D3. The ticket sits next to the PR number

PR column, first line: `#45 · THI-442 draft open ✓`. No new column. A row with
no PR but a derived ticket (a local `thibaultdody/thi-442-…` branch) shows the
ticket alone in that cell instead of `—`.

### D4. Search is a client-side filter over the rows already fetched

`/api/reviews` already returns every row; the queue holds them in the
`reviews` signal. Filtering is a pure function over that list — no new route,
no server query.

Match rule (`filterRows(rows, query)`):
- the query is lowercased and split on whitespace; an empty query returns the
  rows unchanged
- a row matches when **every** term is a substring of its haystack
- the haystack, lowercased and space-joined: `branch`, `repo`, `#<pr.number>`,
  `pr.title`, `pr.author`, `owner.name`, the ticket id (`linked_linear` or
  `linear_ticket`), `linked_linear_title`
- null / missing fields contribute nothing

So `fdy THI` finds fdy rows tied to a THI ticket, `#45` finds PR 45, and
`tom` finds PRs Tom opened and rows whose owner pane is named "tom…".

### D5. The query outlives the view, not the page

The query is a `reviewsQuery` signal in `store.js` (transient signals, not
`prefs.js`): opening a walkthrough from the queue and coming back keeps the
filter; a reload clears it. The "◉ reviews" header badge
(`unresolvedTotal(reviews.value)`) is unaffected — the filter only narrows
what the table shows.

## Mechanics

### Server

`periscope/git_pr.py`
- `TicketFields` (the five fields, all `str | None`) and
  `linear_ticket_fields(linked, branch, pr_title, team_keys)` beside
  `linear_ticket_for` — the one builder (D1).

`periscope/store.py`
- `linear_team_keys() -> frozenset[str]`, the settings read every caller
  shares (D2).

`periscope/reviews.py`
- `ReviewRow` inherits `git_pr.TicketFields`.
- `list_reviews` gains the `team_keys` parameter (D2) and spreads
  `git_pr.linear_ticket_fields(owner, branch, _ticket_title(pr, owner),
  team_keys)` in the row loop, from the full `owner` window dict (before it
  is trimmed to `pid`/`pane_id`/`session`/`index`/`name` for the payload).
- No new gh or git calls: one regex pass per row.

`periscope/routes/reviews.py`
- `reviews_list` passes `store.linear_team_keys()` (D2).

`periscope/window_view.py`, `periscope/routes/pane.py`
- Spread the same builder in place of their own linked-trio copy and
  derived-pair helper.

### Frontend

`static/src/review/walkthrough.js`
- `export function filterRows(rows, query)` beside `sortRows` (D4).

`static/src/store.js`
- `export const reviewsQuery = signal("")` (D5).

`static/src/review/ReviewsQueue.jsx`
- **PR link.** `#N` becomes
  `<a class={`rq-pr-link ${prStateMeta(row.pr.state).cls}`} …>` (a `<span>`
  with the same classes when `row.pr.url` is missing). `prStateMeta` is in
  `static/src/util.js`. Revised after review: a landed PR (merged / closed)
  drops its CI glyph, as the pane pill and detail header do. The
  walkthrough header's `PR #N` link takes the same classes.
- **Ticket.** `const lin = linearTicket(row)`; when set, ` · ` then
  `<a class="rq-linear" href={lin.href} target="_blank" rel="noopener"
  title={lin.tip}>{lin.id}</a>` after the PR number (D3). With no PR, the
  cell shows just the ticket link.
- **Search.** In the `wt-head`: `<input type="search" class="rq-search"
  placeholder="filter branches, PRs, people, tickets">`, bound to
  `reviewsQuery`. Rows render as `filterRows(sortRows(rows),
  reviewsQuery.value)`. Revised after review: the box sits between the title
  and the count (after the count, it slid sideways as the count's width
  changed); its `aria-label` is its placeholder text; `filterRows` takes the
  ticket id from `linearTicket(row)`.
- **Count.** `N branches` with no query; `M of N branches` while filtering.
- **Empty states.** No rows at all → `nothing open` (as today). Rows but no
  match → `no branches match "<query>"`.
- Esc and the clear button come from `type="search"` (WebKit and Chromium
  both clear a search field on Esc); no key handler of our own.

`static/styles.css` (next to the `.rq-*` rules, ~3929)
- `.rq-pr-link { color: var(--fg-1); font-family: var(--mono); text-decoration: none; }`,
  `a.rq-pr-link { color: var(--accent); }` and
  `a.rq-pr-link:hover { text-decoration: underline; }`. Revised after the
  first look: in `--fg-1` a linked PR number didn't read as clickable among
  the table's plain text, so a linked one takes the accent (an unlinked
  `<span>` stays `--fg-1`)
- add `.rq-pr-link.is-merged` and `.rq-pr-link.is-closed` to the shared
  merged / closed selector lists (~2929–2930), so the queue follows the same
  lifecycle colors as every other PR badge
- `.rq-linear { color: oklch(0.7 0.13 280); font-family: var(--mono); text-decoration: none; }`
  with the same hover underline — the violet `.pane-pill-linear` and
  `.header-linear` use
- `.rq-search` by the title in the flex `wt-head` (the head's `gap`
  spaces it), sized and colored like the app's other inputs. Revised after
  the first look: pushed right, it sat under the header's critter (`.tama`),
  which overhangs the detail area's top-right corner by ~28px
- `.rq-search::placeholder` in `--fg-2`, not the app's usual `--fg-4`
  (~1.7:1 on `--bg-1`): the placeholder is the box's only visible label

`static/dist/` rebuilt (`npm run build`) and committed.

### Docs

`docs/channels.md` — the `link_linear` bullet that says where periscope shows
a ticket without a link also names the Reviews queue rows.

## Tests

`tests/test_reviews.py` (extend the existing `list_reviews` cases, `_win`
fixture):
- owner window with `linked_linear` + title + status → the row carries all
  three, derived fields `None` — even when the PR title also names a ticket
- no link, PR title `THI-442: …` → `linear_ticket="THI-442"`,
  `linear_ticket_source="pr_title"`
- no link, branch `thibaultdody/thi-442-reviews` → `"THI-442"`, `"branch"`
- `team_keys=frozenset({"FDY"})` with a `THI-…` branch → no ticket
- an open PR checked out as `pr-45` (owner window on branch `pr-45`) still
  derives from the PR's `headRefName`
- a row with nothing ticket-shaped → all five fields `None`

`static/src/review/__tests__/walkthrough.test.js` — `filterRows`:
- empty and whitespace-only queries return every row, in order
- matches on each haystack field (branch, repo, `#N`, PR title, author,
  owner name, ticket id, linked ticket title)
- case-insensitive; multi-term AND (`fdy thi` vs `fdy xyz`)
- a row with no PR, no owner, no ticket matches only on branch / repo

Added after review:
- `tests/test_git_pr.py` — `linear_ticket_fields`: a link replaces the
  derived ticket; no link (`None`, `{}`, an explicit `None` id) derives, and
  team keys narrow it
- `tests/test_reviews.py` — a header row takes its owner pane's PR title only
  when the owner's PR is the row's
- `static/src/review/__tests__/reviewsQueueRender.test.jsx` — loading /
  nothing open, a linked open PR with ticket and CI, a merged unlinked PR
  without CI, the ticket-only and `—` cells, the count with and without a
  query, the no-match state, the box's accessible name

Manual, on the dev server (:17375): link colors for open / merged / closed
PRs, a ticket on a Linear-shaped branch and on a `THI-…:`-titled PR, the
filter and its counts, and the Esc clear in the Tauri webview.

## Out of scope

- a ticket chip in the walkthrough view's meta line
- a `/` shortcut to focus the search box
- searching server-side, or keeping the query across reloads
