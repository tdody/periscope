// The two small conventions the markdown renderer recognizes on top of
// CommonMark (spec D3): a metadata blockquote (`> key: value · key: value`)
// and citation tokens (`path`, `path:line`, `path:a-b`). Pure; shared by the
// renderer and the walkthrough parser.

const PAIR_RE = /^([a-z-]+): (.+)$/;

// A blockquote whose every line, after its `>` marker, is ` · `-separated
// `key: value` pieces. Reads the RAW source (the Python twin in
// periscope/reviews.py does too): mdast would parse `periscope/__init__.py`
// as emphasis and a backticked ref as code. Prose and markup fail the key
// regex, which keeps a superpowers plan's `> **For agentic workers:** …`
// under its H1 from becoming a chip row. A blank `>` line is an empty piece
// and fails too.
export function metaPairs(node, src) {
  if (node?.type !== "blockquote" || typeof src !== "string") return null;
  const raw = src.slice(node.position.start.offset, node.position.end.offset);
  const pairs = [];
  for (const line of raw.split("\n")) {
    for (const piece of line.replace(/^\s*> ?/, "").split(" · ")) {
      const m = PAIR_RE.exec(piece.trim());
      if (!m) return null;
      pairs.push([m[1], m[2].trim()]);
    }
  }
  return pairs.length ? pairs : null;
}

// A `refs:` value → cite tokens: comma-split, trimmed, surrounding backticks
// dropped (authors code-format paths).
export function refTokens(value) {
  return value.split(",").map((s) => s.trim().replace(/^`+|`+$/g, ""));
}

// Slashed repo-relative paths (`a/b.py`, `docs/x.md`) chip bare or with
// `:line` / `:a-b`. Slashless file names chip only WITH a line suffix
// (`reviews.py:12`): bare, `os.path` / `node.js` / `self.foo` are code, not
// files. A trailing `/` and `./`, `../`, `~/`, absolute paths never chip.
// A slashed path with an extensionless leaf (`bin/check`) chips only two
// directories deep (`a/b/c`) or with a line suffix (`bin/check:3`); bare
// `and/or` is prose. A path needs at least one letter, so dates (`10/26/2026`)
// and fractions (`1/2`) never chip.
// Three-segment prose like `read/write/exec` does chip (accepted).
const TOKEN_RE = /^([\w.-]*[\w-]\/[\w./-]*[\w-]|[\w-]+(?:\.[\w-]+)*\.[A-Za-z][A-Za-z0-9]{1,5})(?::(\d+)(?:-(\d+))?)?$/;

export function parseCite(token) {
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  const path = m[1];
  if (!/[A-Za-z]/.test(path)) return null;
  if (!path.includes("/") && m[2] == null) return null;
  const leaf = path.split("/").pop();
  if (m[2] == null && path.includes("/") && !/\.[A-Za-z][A-Za-z0-9]{0,5}$/.test(leaf) && !/^[\w.-]+\/[\w.-]+\//.test(path)) return null;
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
