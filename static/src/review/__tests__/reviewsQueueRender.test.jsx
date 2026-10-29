// Render-path test for <ReviewsQueue> (THI-442): the wiring filterRows' unit
// cases can't see — which rows the table maps, the PR cell's link/ticket/CI
// choices, the count and the empty states. render-to-string runs no effects, so
// the mount-time refreshReviews() never fetches.

import render from "preact-render-to-string";
import { afterEach, describe, expect, it } from "vitest";
import { reviews, reviewsQuery, reviewsSort } from "../../store.js";
import { ReviewsQueue, SortHeader } from "../ReviewsQueue.jsx";

const row = (o) => ({
  repo: "fdy", role: "mine", pr: null, walkthrough: null, unresolved: 0, comments: 0, owner: null, worktree: null,
  linked_linear: null, linked_linear_title: null, linked_linear_status: null, linear_ticket: null, linear_ticket_source: null,
  ...o,
});
const OPEN = row({
  branch: "tdody/fdy-8562-restack", linear_ticket: "FDY-8562", linear_ticket_source: "branch",
  pr: { number: 8818, title: "restack", draft: false, state: "open", ci: "✓", author: "tdody", url: "https://github.com/o/fdy/pull/8818" },
});
const MERGED = row({
  branch: "old/thing", role: "local",
  pr: { number: 500, title: "", draft: false, state: "merged", ci: "✗", author: null, url: null },
});
const LOCAL = row({ branch: "thibaultdody/thi-442-x", role: "local", linear_ticket: "THI-442", linear_ticket_source: "branch" });
const BARE = row({ branch: "feat/plain", role: "local" });

// The PR cell of the row whose branch cell names `branch`.
const prCell = (html, branch) => html.split(`>${branch}<`)[1].split('<td class="rq-pr">')[1].split("</td>")[0];

afterEach(() => {
  reviews.value = null;
  reviewsQuery.value = "";
  reviewsSort.value = null;
});

describe("<ReviewsQueue>", () => {
  it("says loading until the first fetch lands, then nothing open", () => {
    expect(render(<ReviewsQueue />)).toContain("loading…");
    reviews.value = [];
    expect(render(<ReviewsQueue />)).toContain("nothing open");
  });

  it("links an open PR in the accent class, with its ticket and CI glyph after it", () => {
    reviews.value = [OPEN];
    const cell = prCell(render(<ReviewsQueue />), OPEN.branch);
    expect(cell).toMatch(/<a class="rq-pr-link\s*" href="https:\/\/github.com\/o\/fdy\/pull\/8818"[^>]*>#8818<\/a>/);
    expect(cell).toContain(' · <a class="rq-linear" href="https://linear.app/issue/FDY-8562"');
    expect(cell).toContain('title="Linear FDY-8562 (from the branch name)"');
    expect(cell).toContain("open ✓");
  });

  it("drops a merged PR's CI glyph and leaves an unlinked one a span", () => {
    reviews.value = [MERGED];
    const cell = prCell(render(<ReviewsQueue />), MERGED.branch);
    expect(cell).toContain('<span class="rq-pr-link is-merged">#500</span>');
    expect(cell).toContain("merged");
    expect(cell).not.toContain("✗");
  });

  it("fills a PR-less row's cell with its ticket, else a dash", () => {
    reviews.value = [LOCAL, BARE];
    const html = render(<ReviewsQueue />);
    expect(prCell(html, LOCAL.branch)).toMatch(/^<a class="rq-linear"[^>]*>THI-442<\/a>$/);
    expect(prCell(html, BARE.branch)).toBe("—");
  });

  it("counts every row with no query and M of N while filtering", () => {
    reviews.value = [OPEN, MERGED, LOCAL];
    expect(render(<ReviewsQueue />)).toContain(">3 branches<");
    reviewsQuery.value = "   ";
    expect(render(<ReviewsQueue />)).toContain(">3 branches<");
    reviewsQuery.value = "thi-442";
    const html = render(<ReviewsQueue />);
    expect(html).toContain(">1 of 3 branches<");
    expect(html).toContain(`>${LOCAL.branch}<`);
    expect(html).not.toContain(`>${OPEN.branch}<`);
  });

  it("says nothing matches rather than nothing open", () => {
    reviews.value = [OPEN];
    reviewsQuery.value = " zzz ";
    const html = render(<ReviewsQueue />);
    expect(html).toContain("no branches match &quot;zzz&quot;");
    expect(html).toContain(">0 of 1 branch<");
    expect(html).not.toContain("rq-table");
  });

  it("makes each data header a sort button, none marked until one is picked (THI-444)", () => {
    reviews.value = [OPEN];
    const html = render(<ReviewsQueue />);
    for (const label of ["branch", "PR", "walkthrough", "comments", "who"]) {
      expect(html).toMatch(new RegExp(`<th><button type="button" class="rq-sort"[^>]*>${label}</button></th>`));
    }
    expect(html).toContain('title="sort by staleness"');
    expect(html).not.toContain("aria-sort");
  });

  it("orders rows by the picked column and marks its header with the direction", () => {
    const FEW = row({ branch: "few", unresolved: 1 });
    const MANY = row({ branch: "many", unresolved: 4 });
    reviews.value = [FEW, MANY];
    reviewsSort.value = { key: "comments", dir: "desc" };
    let html = render(<ReviewsQueue />);
    expect(html.indexOf(">many<")).toBeLessThan(html.indexOf(">few<"));
    expect(html).toMatch(/<th aria-sort="descending"><button type="button" class="rq-sort is-active"[^>]*>comments<span class="rq-sort-dir" aria-hidden="true">▼<\/span><\/button><\/th>/);
    reviewsSort.value = { key: "comments", dir: "asc" };
    html = render(<ReviewsQueue />);
    expect(html.indexOf(">few<")).toBeLessThan(html.indexOf(">many<"));
    expect(html).toContain('<th aria-sort="ascending">');
    expect(html).toContain(">▲<");
    // comments starts descending, so from ascending the next click resets.
    expect(html).toContain('title="back to the default order"');
  });

  // Spelled out, not read from SORT_COLUMNS, so a header wired to the wrong
  // column or started in the wrong direction fails here.
  const HEADERS = [
    ["branch", "branch", "asc"], ["PR", "pr", "desc"], ["walkthrough", "walkthrough", "desc"],
    ["comments", "comments", "desc"], ["who", "who", "asc"],
  ];
  const flip = { asc: "desc", desc: "asc" };

  it("pressing a header sorts by it, reverses on the second press, and resets on the third", () => {
    // render-to-string fires no events, so press the button the way hunk.test.jsx
    // does: call the component and invoke the button's onClick.
    const press = (col) => SortHeader({ col }).props.children.props.onClick();
    for (const [, col, first] of HEADERS) {
      press(col);
      expect(reviewsSort.value).toEqual({ key: col, dir: first });
      press(col);
      expect(reviewsSort.value).toEqual({ key: col, dir: flip[first] });
      press(col);
      expect(reviewsSort.value).toBeNull();
    }
  });

  it("titles each header by what its next press does", () => {
    reviews.value = [OPEN];
    reviewsSort.value = { key: "comments", dir: "desc" };
    let html = render(<ReviewsQueue />);
    expect(html).toMatch(/title="reverse the order">comments</);
    expect(html).toMatch(/title="sort by PR number">PR</);
    reviewsSort.value = { key: "comments", dir: "asc" };
    html = render(<ReviewsQueue />);
    expect(html).toMatch(/title="back to the default order">comments</);
  });

  it("marks the header whose label names the sorted column", () => {
    reviews.value = [OPEN];
    for (const [label, col] of HEADERS) {
      reviewsSort.value = { key: col, dir: "asc" };
      const active = render(<ReviewsQueue />).match(/class="rq-sort is-active"[^>]*>([^<]+)</);
      expect(active?.[1]).toBe(label);
    }
  });

  it("names the search box by the words it shows", () => {
    reviews.value = [];
    const html = render(<ReviewsQueue />);
    expect(html).toContain('placeholder="filter branches, PRs, people, tickets"');
    expect(html).toContain('aria-label="filter branches, PRs, people, tickets"');
  });
});
