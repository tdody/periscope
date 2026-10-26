// The cleanup modal's scoped load: a notification's "Clean up worktree" asks
// /api/cleanup/candidates about its worktree only (?paths=), so the modal
// opens in seconds instead of walking every worktree.
import { describe, expect, it } from "vitest";
import { candidatesUrl } from "../CleanupModal.jsx";

describe("candidatesUrl", () => {
  it("asks for every candidate without a scope", () => {
    expect(candidatesUrl(null)).toBe("/api/cleanup/candidates");
    expect(candidatesUrl([])).toBe("/api/cleanup/candidates");
  });

  it("repeats paths=, encoded, for a scope", () => {
    expect(candidatesUrl(["/wt/a b", "/wt/c"])).toBe("/api/cleanup/candidates?paths=%2Fwt%2Fa%20b&paths=%2Fwt%2Fc");
  });
});
