import render from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { Hunk, langFor } from "../ChangesTab.jsx";

const hunk = {
  header: "def f",
  new_start: 10,
  lines: [
    { kind: "ctx", text: "a = 1" },
    { kind: "del", text: "b = 2" },
    { kind: "add", text: "b = 3" },
  ],
};

describe("Hunk", () => {
  it("renders every line with its kind class and the intraline mark", () => {
    const out = render(<Hunk hunk={hunk} lang="py" hl={null} onOpen={null} />);
    expect(out).toContain('class="dl dl-ctx"');
    expect(out).toContain('class="dl dl-del"');
    expect(out).toContain('class="dl dl-add"');
    expect(out).toContain("dl-intra");
    expect(out).toContain("@@ 10");
    expect(out).toContain("def f");
  });
  it("disables the head button without onOpen", () => {
    expect(render(<Hunk hunk={hunk} lang="py" hl={null} onOpen={null} />)).toContain("disabled");
    expect(render(<Hunk hunk={hunk} lang="py" hl={null} onOpen={() => {}} />)).not.toContain("disabled");
  });
  it("langFor maps extensions", () => {
    expect(langFor("a/b.py")).toBe("py");
    expect(langFor("x.unknown")).toBe("");
  });
});
