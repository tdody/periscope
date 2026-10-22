// The split-view surface: the #split-view container holding <Rail> (left) and
// <Detail> (right). This is the only view (grid retired).
import { computed, effect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { startNotifyFeed } from "../notify/feed.js";
import { startPolling } from "../poll.js";
import { getPaneWidth } from "../prefs.js";
import { startAlertFeed } from "./alertFeed.js";
import { Detail } from "./Detail.jsx";
import { railHidden, sideHidden } from "./panels.js";
import { PANE_WIDTHS, storedWidth } from "./paneResize.js";
import { Rail } from "./Rail.jsx";
import { ResizeHandle } from "./ResizeHandle.jsx";

export function Split() {
  // Own the single /api/state poll loop that feeds the `windows` signal — the
  // Rail + Detail render off it. startNotifyFeed turns it into native banners
  // and the dock badge; startAlertFeed takes an older shell's banner clicks.
  useEffect(() => { startPolling(); startAlertFeed(); startNotifyFeed(); }, []);

  useEffect(() => {
    // Mirror the view onto the body attribute (legacy CSS still keys some
    // selectors off body[data-view]="split"). One-shot at mount.
    if (!document.body.dataset.view) document.body.dataset.view = "split";
  }, []);

  // Stored splitter widths → CSS vars on #split-view, set from an effect
  // rather than a style prop so a prefs change doesn't re-render Split (and
  // with it the whole rail and detail). One computed per column, so an
  // effect re-runs only when ITS width changes — an unrelated prefs write
  // mid-drag must not snap the column back to its stored width.
  const ref = useRef(null);
  useEffect(() => {
    const disposers = Object.values(PANE_WIDTHS).map((spec) => {
      const px = computed(() => storedWidth(getPaneWidth(spec.pref)));
      return effect(() => {
        const v = px.value;
        if (v == null) ref.current?.style.removeProperty(spec.cssVar);
        else ref.current?.style.setProperty(spec.cssVar, `${v}px`);
      });
    });
    return () => { for (const dispose of disposers) dispose(); };
  }, []);

  // Panel visibility as attributes for styles.css (the navigator collapses its
  // grid column; the context column's width var drops to 0). Imperative for
  // the same reason as the widths: no Split re-render.
  useEffect(() => effect(() => {
    ref.current?.toggleAttribute("data-rail-hidden", railHidden.value);
    ref.current?.toggleAttribute("data-side-hidden", sideHidden.value);
  }), []);

  return (
    <div id="split-view" ref={ref}>
      <Rail />
      <ResizeHandle which="rail" />
      <Detail />
    </div>
  );
}
