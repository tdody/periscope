// Render-path test for <ReviewsQueue> (THI-442): the wiring filterRows' unit
// cases can't see — which rows the table maps, the PR cell's link/ticket/CI
// choices, the count and the empty states. render-to-string runs no effects, so
// the mount-time refreshReviews() never fetches.

import render from "preact-render-to-string";
import { afterEach, describe, expect, it } from "vitest";
import { reviews, reviewsQuery } from "../../store.js";
import { ReviewsQueue } from "../ReviewsQueue.jsx";

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

  it("names the search box by the words it shows", () => {
    reviews.value = [];
    const html = render(<ReviewsQueue />);
    expect(html).toContain('placeholder="filter branches, PRs, people, tickets"');
    expect(html).toContain('aria-label="filter branches, PRs, people, tickets"');
  });
});
