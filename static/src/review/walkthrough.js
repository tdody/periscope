// Pure helpers for the review walkthrough: the mdast-side parser of the
// walkthrough.md convention (spec D3), ref→hunk matching against the branch
// diff, and the queue sort (D6). The backend has a line-based twin for the
// header/stop count; both agree on ATX headings and plain metadata quotes.
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { metaPairs, parseCite } from "../split/mdMeta.js";

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
    const pairs = blocks[i]?.type === "blockquote" ? metaPairs(blocks[i]) : null;
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
    const pairs = q?.type === "blockquote" ? metaPairs(q) : null;
    if (pairs) {
      const o = Object.fromEntries(pairs);
      kind = o.kind ?? null;
      refs = (o.refs || "").split(",").map((s) => parseCite(s.trim())).filter(Boolean);
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
    if (!file) return { ref, file: null, hunks: [] };
    const hunks = ref.start == null
      ? file.hunks
      : file.hunks.filter((h) => h.new_start <= ref.end && newEnd(h) >= ref.start);
    return { ref, file: file.path, hunks };
  });
}

// D6 order: unresolved comments, review-requested, a PR with no walkthrough
// yet, the rest, local work with no PR, merged.
function group(r) {
  if (r.pr?.state === "merged") return 5;
  if (r.unresolved > 0) return 0;
  if (r.role === "review-requested") return 1;
  if (r.pr && !r.walkthrough) return 2;
  if (r.role === "local") return 4;
  return 3;
}

export function sortRows(rows) {
  return [...(rows || [])].sort((a, b) =>
    group(a) - group(b)
    || (b.pr?.number || 0) - (a.pr?.number || 0)
    || a.branch.localeCompare(b.branch));
}

export function unresolvedTotal(rows) {
  return (rows || []).filter((r) => r.pr?.state !== "merged").reduce((n, r) => n + (r.unresolved || 0), 0);
}
