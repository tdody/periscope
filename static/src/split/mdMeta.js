// The two small conventions the markdown renderer recognizes on top of
// CommonMark (spec D3): a metadata blockquote (`> key: value · key: value`)
// and citation tokens (`path`, `path:line`, `path:a-b`). Pure; shared by the
// renderer and the walkthrough parser.

const PAIR_RE = /^([a-z-]+): (.+)$/;

// A blockquote whose only child is one paragraph of plain text, every
// ` · `/newline-separated piece being `key: value`. Anything else → null.
// The plain-text check is what keeps a superpowers plan's
// `> **For agentic workers:** …` under its H1 from becoming a chip row.
export function metaPairs(node) {
  if (node?.type !== "blockquote" || node.children?.length !== 1) return null;
  const p = node.children[0];
  if (p.type !== "paragraph" || !p.children.every((c) => c.type === "text")) return null;
  const text = p.children.map((c) => c.value).join("");
  const pairs = [];
  for (const piece of text.split(/\n| · /)) {
    const m = PAIR_RE.exec(piece.trim());
    if (!m) return null;
    pairs.push([m[1], m[2].trim()]);
  }
  return pairs.length ? pairs : null;
}

// Slashed repo-relative paths (`a/b.py`, `docs/x.md`) chip bare or with
// `:line` / `:a-b`. Slashless file names chip only WITH a line suffix
// (`reviews.py:12`): bare, `os.path` / `node.js` / `self.foo` are code, not
// files. A trailing `/` and `./`, `../`, `~/`, absolute paths never chip.
// Three-segment prose like `read/write/exec` does chip (accepted).
const TOKEN_RE = /^([\w.-]*[\w-]\/[\w./-]*[\w-]|[\w-]+(?:\.[\w-]+)*\.[A-Za-z][A-Za-z0-9]{1,5})(?::(\d+)(?:-(\d+))?)?$/;

export function parseCite(token) {
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  const path = m[1];
  if (!path.includes("/") && m[2] == null) return null;
  const leaf = path.split("/").pop();
  if (path.includes("/") && !/\.[A-Za-z][A-Za-z0-9]{0,5}$/.test(leaf) && !/^[\w.-]+\/[\w.-]+\//.test(path)) return null;
  const start = m[2] != null ? Number(m[2]) : null;
  return { path, start, end: m[3] != null ? Number(m[3]) : start, raw: token };
}

// Split prose into text segments and cites, in order. Candidates are
// whitespace-delimited words with leading/trailing punctuation trimmed, so
// `(periscope/x.py)` and `a/b.py,` both chip.
export function splitCites(text) {
  const out = [];
  let buf = "";
  const WORD_RE = /\S+/g;
  let last = 0;
  for (let m = WORD_RE.exec(text); m; m = WORD_RE.exec(text)) {
    const word = m[0];
    const lead = (word.match(/^[(["']+/) || [""])[0];
    const core = word.slice(lead.length).replace(/[.,;:)\]"']+$/, "");
    const cite = core ? parseCite(core) : null;
    if (!cite) {
      buf += text.slice(last, m.index) + word;
    } else {
      buf += text.slice(last, m.index) + lead;
      if (buf) out.push(buf);
      buf = word.slice(lead.length + core.length);
      out.push(cite);
    }
    last = m.index + word.length;
  }
  buf += text.slice(last);
  if (buf) out.push(buf);
  return out;
}
