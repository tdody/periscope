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
    expect(parseCite("x.md")).toEqual({ path: "x.md", start: null, end: null, raw: "x.md" });
    expect(parseCite("periscope/reviews.py:12")).toMatchObject({ path: "periscope/reviews.py", start: 12, end: 12 });
  });
  it("rejects addresses and abbreviations", () => {
    expect(parseCite("127.0.0.1:17374")).toBeNull();
    expect(parseCite("e.g")).toBeNull();
    expect(parseCite("i.e")).toBeNull();
    expect(parseCite("hello")).toBeNull();
  });
});

describe("splitCites", () => {
  it("interleaves text and cites", () => {
    expect(splitCites("see a/b.py:3-9 and x.md.")).toEqual([
      "see ", { path: "a/b.py", start: 3, end: 9, raw: "a/b.py:3-9" }, " and ",
      { path: "x.md", start: null, end: null, raw: "x.md" }, ".",
    ]);
  });
  it("returns the text alone when nothing matches", () => {
    expect(splitCites("plain words at 127.0.0.1:17374")).toEqual(["plain words at 127.0.0.1:17374"]);
  });
});
