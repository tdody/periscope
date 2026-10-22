// The live terminal's sizing glue — the mount's hint, the size handler, the
// reconnect — driven through the REAL terminalCore against stub xterm /
// WebSocket / ResizeObserver globals. sizing.test.js pins the rules; these pin
// the call sites that apply them, each a one-line revert that left every rule
// test green while the bug it fixed came back. The browser is a bad oracle
// here: each case needs a server announcing a resize nobody in the page made.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let env; // what the stubs read (the box, hidden) and record (sockets, sends)

const stubEl = () => ({
  parentElement: null,
  appendChild(child) { child.parentElement = this; },
  remove() { this.parentElement = null; },
  addEventListener() {},
  removeEventListener() {},
  classList: { add() {}, remove() {} },
});

class StubTerminal {
  constructor() {
    this.cols = 80;
    this.rows = 24;
    this.unicode = {};
    this.buffer = { active: { viewportY: 0, baseY: 0 } };
    env.term = this;
  }
  resize(cols, rows) { this.cols = cols; this.rows = rows; }
  open() {} loadAddon() {} registerLinkProvider() {} focus() {} reset() {}
  attachCustomWheelEventHandler() {} attachCustomKeyEventHandler() {}
  onData() {} onBell() {} write() {} writeln() {} scrollToBottom() {}
}

class StubSocket {
  static OPEN = 1;
  constructor(url) {
    this.readyState = StubSocket.OPEN;
    const q = new URL(url).searchParams;
    env.sockets.push({ hint: q.has("cols") ? { cols: +q.get("cols"), rows: +q.get("rows") } : null });
    env.ws = this;
    setTimeout(() => this.onopen?.(), 0);
  }
  send(data) { env.sent.push(JSON.parse(data)); }
  close() {}
}

const NoopAddon = class { onContextLoss() {} dispose() {} };

let core;
beforeEach(async () => {
  env = { box: { cols: 143, rows: 36 }, hidden: false, sockets: [], sent: [], ws: null, ro: null, term: null };
  vi.useFakeTimers();
  vi.stubGlobal("Terminal", StubTerminal);
  vi.stubGlobal("WebSocket", StubSocket);
  vi.stubGlobal("FitAddon", { FitAddon: class {
    // Under a display:none host the real FitAddon proposes NaN cols.
    proposeDimensions() { return env.hidden ? { cols: NaN, rows: NaN } : { ...env.box }; }
  } });
  vi.stubGlobal("WebglAddon", { WebglAddon: NoopAddon });
  vi.stubGlobal("SearchAddon", { SearchAddon: NoopAddon });
  vi.stubGlobal("Unicode11Addon", { Unicode11Addon: NoopAddon });
  vi.stubGlobal("ResizeObserver", class { constructor(cb) { env.ro = cb; } observe() {} disconnect() {} });
  vi.stubGlobal("document", { createElement: stubEl });
  vi.stubGlobal("location", { protocol: "http:", host: "periscope.test" });
  vi.stubGlobal("requestAnimationFrame", (cb) => setTimeout(cb, 16));
  // A fresh module per test: the pin and the last measurement are page-lifetime state.
  vi.resetModules();
  core = await import("../terminalCore.js");
});

afterEach(() => {
  core.unmountTerminal();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mount = async (pane) => {
  core.mountTerminal(stubEl(), pane);
  await vi.advanceTimersByTimeAsync(400); // the deferred refit + scroll
};
const announce = async (cols, rows) => { // the reconcile's {type:"size"}
  env.ws.onmessage({ data: JSON.stringify({ type: "size", cols, rows }) });
  await vi.advanceTimersByTimeAsync(100); // the fit's debounce
};
const resizeBox = async (cols, rows) => {
  env.box = { cols, rows };
  env.ro();
  await vi.advanceTimersByTimeAsync(100);
};
const dropSocket = async () => {
  env.ws.onclose({});
  await vi.advanceTimersByTimeAsync(300); // the first reconnect backoff
};

describe("terminal sizing glue", () => {
  it("asks a pane announced taller than the container back down to it, rows only", async () => {
    // Regression: a sibling closed under a 30-row container and the pane came
    // back 40 rows. Nothing else asks (the container didn't change, so no fit
    // runs), and capped at 30 the pane's rows past it painted onto its last,
    // hiding the prompt behind the status line.
    env.box = { cols: 143, rows: 30 };
    await mount("%1");
    await announce(143, 30);
    expect(env.sent).toEqual([]);
    await announce(143, 40);
    expect(env.term.rows).toBe(30);
    expect(env.sent).toStrictEqual([{ type: "resize", rows: 30 }]);
  });

  it("sends a container shrink below the pane as rows only", async () => {
    // With the pin in it, the shrink also set a shared window's width.
    await mount("%1");
    await announce(143, 36);
    await resizeBox(143, 28);
    expect(env.term.rows).toBe(28);
    expect(env.sent).toStrictEqual([{ type: "resize", rows: 28 }]);
  });

  it("hints a hidden mount with the container's last measurement", async () => {
    // Regression: a pane selected in transcript mode mounts into a display:none
    // host and can't measure. Unhinted, tmux kept the window's width (another
    // viewer's 230), the capture came in wider than the pin, and every frame
    // autowrapped a junk line into scrollback.
    await mount("%1");
    env.hidden = true;
    await mount("%2");
    expect(env.sockets.map((s) => s.hint)).toEqual([{ cols: 143, rows: 36 }, { cols: 143, rows: 36 }]);
  });

  it("sends no hint before anything has been measured", async () => {
    // A pane only ever shown hidden: no dims of ours to ask for, and the
    // xterm's would be the pane's — tmux's view stands.
    env.hidden = true;
    await mount("%1");
    expect(env.sockets[0].hint).toBe(null);
  });

  it("hints a reconnect on a left/right split with the container, not the pane", async () => {
    // Regression: the xterm holds the pane's dims, a slice of the window.
    // Echoed back as the reconnect hint, they resized the WINDOW to them, and
    // it halved on every retry (143 → 71 → 35 cols).
    await mount("%1");
    await announce(71, 36);
    expect(env.term.cols).toBe(71);
    await dropSocket();
    await dropSocket();
    expect(env.sockets.map((s) => s.hint)).toEqual([
      { cols: 143, rows: 36 }, { cols: 143, rows: 36 }, { cols: 143, rows: 36 },
    ]);
  });
});
