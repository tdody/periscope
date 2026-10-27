import { fromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, it } from "vitest";
import { metaPairs, parseCite, splitCites } from "../mdMeta.js";

const quote = (md) => fromMarkdown(md).children[0];

describe("metaPairs", () => {
  it("splits on ' · ' and newlines", () => {
    expect(metaPairs(quote("> branch: feat/x · head: abc\n> repo: fdy"))).toEqual([
      ["branch", "feat/x"], ["head", "abc"], ["repo", "fdy"],
    ]);
  });
  it("rejects markup and prose", () => {
    expect(metaPairs(quote("> **For agentic workers:** REQUIRED"))).toBeNull();
    expect(metaPairs(quote("> just a quote"))).toBeNull();
    expect(metaPairs(quote("> a: 1\n>\n> b: 2"))).toBeNull(); // two paragraphs
  });
});

describe("parseCite", () => {
  it("accepts paths with a slash or a letter extension", () => {
    expect(parseCite("a/b.py:3-9")).toEqual({ path: "a/b.py", start: 3, end: 9, raw: "a/b.py:3-9" });
    expect(parseCite("docs/x.md")).toEqual({ path: "docs/x.md", start: null, end: null, raw: "docs/x.md" });
    expect(parseCite("reviews.py:12")).toEqual({ path: "reviews.py", start: 12, end: 12, raw: "reviews.py:12" });
    expect(parseCite("reviews.py:12-40")).toEqual({ path: "reviews.py", start: 12, end: 40, raw: "reviews.py:12-40" });
    expect(parseCite("periscope/reviews.py")).toMatchObject({ path: "periscope/reviews.py", start: null });
    expect(parseCite("periscope/reviews.py:12")).toMatchObject({ path: "periscope/reviews.py", start: 12, end: 12 });
  });
  it("rejects addresses and abbreviations", () => {
    expect(parseCite("127.0.0.1:17374")).toBeNull();
    expect(parseCite("e.g")).toBeNull();
    expect(parseCite("i.e")).toBeNull();
    expect(parseCite("hello")).toBeNull();
    for (const t of ["os.path", "self.foo", "node.js", "Next.js", "reviews.py"]) expect(parseCite(t)).toBeNull();
  });
});

describe("splitCites", () => {
  it("interleaves text and cites", () => {
    expect(splitCites("see a/b.py:3-9 and docs/x.md.")).toEqual([
      "see ", { path: "a/b.py", start: 3, end: 9, raw: "a/b.py:3-9" }, " and ",
      { path: "docs/x.md", start: null, end: null, raw: "docs/x.md" }, ".",
    ]);
  });
  it("returns the text alone when nothing matches", () => {
    expect(splitCites("plain words at 127.0.0.1:17374")).toEqual(["plain words at 127.0.0.1:17374"]);
  });
});
