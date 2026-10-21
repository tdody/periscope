// The context chip's band, shared by the rail rows and Clawd (chrome/clawdDuty.js),
// so the header mascot sweats over exactly the panes the rail paints red.

// Today's context-window ramp: auto-compact proximity, a different hazard
// from cost pressure ("this is about to lose history" vs "this is expensive
// to keep carrying"). The two compose — this band still paints when cost
// pressure has nothing to say (band "none" or no session), so a pane sitting
// at 90% of its window keeps its red warning even though clearing it
// wouldn't pay off yet.
function pctBand(p) {
  if (p == null) return "";
  if (p >= 80) return " ctx-hot";
  if (p >= 60) return " ctx-warn";
  return "";
}

// The server sends "none" | "warn" | "hot", and omits the key entirely when it
// has nothing to say. Cost pressure wins only when it actually has something
// to say (warn/hot); "none" and absent both fall through to the percent
// bands, so the auto-compact warning isn't silenced for the common case of a
// classified pane that just isn't cost-pressured.
export function ctxClass(w) {
  if (w.ctx_class && w.ctx_class !== "none") return ` ctx-${w.ctx_class}`;
  return pctBand(w.context_pct);
}
