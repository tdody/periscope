// Pure helpers for the review walkthrough: the mdast-side parser of the
// walkthrough.md convention (spec D3), ref→hunk matching against the branch
// diff, and the queue sort (D6). The backend has a line-based twin for the
// header/stop count; both agree on ATX headings and plain metadata quotes.
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { linearTicket } from "../split/linearTicket.js";
import { metaPairs, parseCite, refTokens } from "../split/mdMeta.js";

const KINDS = new Set(["new-subsystem", "extension", "reuse", "system-touch", "behavior"]);

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "stop";
}

function textOf(node) {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  return (node.children || []).map(textOf).join("");
}

export function parseWalkthrough(text) {
  const src = String(text || "");
  const tree = fromMarkdown(src, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const blocks = tree.children;
  let title = "";
  let header = null;
  let problem = "";
  const stops = [];
  const ids = new Map();

  let i = 0;
  if (blocks[i]?.type === "heading" && blocks[i].depth === 1) {
    title = textOf(blocks[i]);
    i++;
    const pairs = blocks[i]?.type === "blockquote" ? metaPairs(blocks[i], src) : null;
    if (pairs) {
      const o = Object.fromEntries(pairs);
      if (o.branch && o.head) {
        header = { branch: o.branch, head: o.head, pr: /^\d+$/.test(o.pr || "") ? Number(o.pr) : null, repo: o.repo ?? null };
      }
      i++;
    }
    if (blocks[i]?.type === "paragraph") { problem = textOf(blocks[i]); i++; }
  }

  for (; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== "heading" || b.depth !== 2) continue;
    const stopTitle = textOf(b);
    let kind = null;
    let refs = [];
    let bodyStart = b.position.end.offset;
    const q = blocks[i + 1];
    const pairs = q?.type === "blockquote" ? metaPairs(q, src) : null;
    if (pairs) {
      const o = Object.fromEntries(pairs);
      kind = o.kind ?? null;
      refs = refTokens(o.refs || "").map(parseCite).filter(Boolean);
      bodyStart = q.position.end.offset;
      i++;
    }
    let j = i + 1;
    while (j < blocks.length && !(blocks[j].type === "heading" && blocks[j].depth === 2)) j++;
    const bodyEnd = j < blocks.length ? blocks[j].position.start.offset : src.length;
    const base = slug(stopTitle);
    const n = (ids.get(base) || 0) + 1;
    ids.set(base, n);
    stops.push({
      id: n === 1 ? base : `${base}-${n}`,
      title: stopTitle,
      kind,
      knownKind: kind != null && KINDS.has(kind),
      refs,
      bodyMarkdown: src.slice(bodyStart, bodyEnd),
    });
    i = j - 1;
  }
  return { title, header, problem, stops };
}

// New-side span of a hunk: new_start through new_start + ctx/add lines − 1.
function newEnd(h) {
  const n = (h.lines || []).filter((l) => l.kind === "ctx" || l.kind === "add").length;
  return h.new_start + Math.max(n, 1) - 1;
}

export function matchRefs(refs, diffFiles) {
  const byPath = new Map((diffFiles || []).map((f) => [f.path, f]));
  return refs.map((ref) => {
    const file = byPath.get(ref.path) || null;
    if (!file) return { ref, file: null, hunks: [], generated: false };
    const hunks = ref.start == null
      ? file.hunks
      : file.hunks.filter((h) => h.new_start <= ref.end && newEnd(h) >= ref.start);
    // `generated`: the server kept the entry but dropped its hunks (bundle, lockfile).
    return { ref, file: file.path, hunks, generated: !!file.generated };
  });
}

// Merged rows sink to the bottom of the readiness order and of every column
// sort, and their comments stop counting toward the header badge.
const isMerged = (r) => r.pr?.state === "merged";

// Readiness first — a live pane, then a checkout on disk, then nothing local —
// and within a tier the D6 order: unresolved comments, review-requested, a PR
// with no walkthrough yet, the rest, local work with no PR. Merged last.
function group(r) {
  if (isMerged(r)) return 99;
  const tier = r.owner ? 0 : r.worktree ? 10 : 20;
  if (r.unresolved > 0) return tier;
  if (r.role === "review-requested") return tier + 1;
  if (r.pr && !r.walkthrough) return tier + 2;
  if (r.role === "local") return tier + 4;
  return tier + 3;
}

// The queue's sortable columns (THI-444): the value a header click orders by,
// null where the cell shows "—". Nulls sort last both ways — flipping a column
// must not float a block of dashes to the top. `first` is the first click's
// direction: the end of the column you'd act on.
export const SORT_COLUMNS = {
  branch: { first: "asc", value: (r) => r.branch },
  pr: { first: "desc", value: (r) => r.pr?.number ?? null },
  // Staleness, not stop count: most stale first is "what needs re-preparing".
  // stale_by is null when there's no worktree to count commits in.
  walkthrough: { first: "desc", value: (r) => r.walkthrough?.stale_by ?? null },
  // 0 renders "—", so it ranks with the empties.
  comments: { first: "desc", value: (r) => r.unresolved || null },
  who: { first: "asc", value: (r) => r.owner?.name || r.pr?.author || null },
};

const compareValues = (a, b) => (typeof a === "string" ? a.localeCompare(b) : a - b);

// `sort` is {key, dir} from a header click, or null for the readiness order.
// The readiness sort runs first and Array.sort is stable, so rows a column ties
// keep that order and don't swap places on every 10 s poll. Merged rows stay at
// the bottom whatever the column.
export function sortRows(rows, sort = null) {
  const ready = [...(rows || [])].sort((a, b) =>
    group(a) - group(b)
    || (b.pr?.number || 0) - (a.pr?.number || 0)
    || a.branch.localeCompare(b.branch));
  const col = sort && SORT_COLUMNS[sort.key];
  if (!col) return ready;
  const sign = sort.dir === "asc" ? 1 : -1;
  return ready.sort((a, b) => {
    const va = col.value(a);
    const vb = col.value(b);
    return isMerged(a) - isMerged(b)
      || (va === null) - (vb === null)
      || (va === null ? 0 : sign * compareValues(va, vb));
  });
}

// A header click: a new column starts in its `first` direction, the second
// click flips it, the third returns to the readiness order (null).
export function nextSort(sort, key) {
  const first = SORT_COLUMNS[key].first;
  if (sort?.key !== key) return { key, dir: first };
  if (sort.dir === first) return { key, dir: first === "asc" ? "desc" : "asc" };
  return null;
}

// The queue's search box (THI-442): every whitespace-separated term must occur,
// case-insensitively, in one of the searched fields — branch, repo, #N, PR title,
// PR author, owner pane name, the ticket id the row shows (linearTicket's pick,
// so the two can't disagree) and a linked ticket's title. "fdy thi" narrows to
// fdy rows tied to a THI ticket. Fields join on a space, so a term never spans two.
export function filterRows(rows, query) {
  const terms = (query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return rows || [];
  return (rows || []).filter((r) => {
    const hay = [
      r.branch, r.repo, r.pr ? `#${r.pr.number}` : null, r.pr?.title, r.pr?.author, r.owner?.name,
      linearTicket(r)?.id, r.linked_linear_title,
    ].filter(Boolean).join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export function unresolvedTotal(rows) {
  return (rows || []).filter((r) => !isMerged(r)).reduce((n, r) => n + (r.unresolved || 0), 0);
}
