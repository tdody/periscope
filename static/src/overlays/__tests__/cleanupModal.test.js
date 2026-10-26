// The cleanup modal's scoped load: a notification's "Clean up worktree" asks
// /api/cleanup/candidates about its worktree only (?paths=), so the modal
// opens in seconds instead of walking every worktree.
import { describe, expect, it } from "vitest";
import { candidatesUrl, scopeOf } from "../CleanupModal.jsx";

describe("candidatesUrl", () => {
  it("asks for every candidate without a scope", () => {
    expect(candidatesUrl(null)).toBe("/api/cleanup/candidates");
    expect(candidatesUrl([])).toBe("/api/cleanup/candidates");
  });

  it("repeats paths=, encoded, for a scope", () => {
    expect(candidatesUrl(["/wt/a b", "/wt/c"])).toBe("/api/cleanup/candidates?paths=%2Fwt%2Fa%20b&paths=%2Fwt%2Fc");
  });
});

describe("scopeOf", () => {
  it("keeps 'no scope' as null", () => {
    expect(scopeOf(undefined)).toBe(null);
    expect(scopeOf(null)).toBe(null);
  });

  it("keeps an empty scope empty, distinct from no scope", () => {
    expect(scopeOf([])).toEqual([]);
  });

  it("drops empty/falsy entries", () => {
    expect(scopeOf(["", undefined, "/wt/a"])).toEqual(["/wt/a"]);
  });

  it("copies, so mutating the input doesn't change the result", () => {
    const paths = ["/wt/a"];
    const out = scopeOf(paths);
    paths.push("/wt/b");
    expect(out).toEqual(["/wt/a"]);
  });
});
