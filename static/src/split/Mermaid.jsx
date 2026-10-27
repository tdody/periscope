// A ```mermaid fence → inline SVG. mermaid is ~3 MB and lives in its own
// vite chunk (vite.config.js mermaidOnly), pulled in by this dynamic import
// on the first diagram only. Until it lands the host is empty; if the import
// or the source fails, the fence shows as text so nothing is ever lost.
import { useEffect, useRef, useState } from "preact/hooks";

let mermaidP = null;
function loadMermaid() {
  if (!mermaidP) {
    mermaidP = import("mermaid").then((m) => {
      const mermaid = m.default;
      // The dashboard has one (dark) theme; following prefers-color-scheme
      // would draw a light diagram on the dark UI whenever macOS is light.
      // Without suppressErrorRendering, render() on bad source draws the "Syntax
      // error" bomb SVG into a temp div on document.body and throws before
      // removing it, leaving a stray error diagram on the dashboard.
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "strict",
        suppressErrorRendering: true,
      });
      return mermaid;
    }).catch((e) => {
      // Don't cache a failed chunk fetch (a restart can swap dist under an open tab).
      mermaidP = null;
      throw e;
    });
  }
  return mermaidP;
}

let seq = 0;

export function Mermaid({ code }) {
  const host = useRef(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    setError(null);
    loadMermaid()
      .then((mermaid) => mermaid.render(`md-mermaid-${++seq}`, code))
      .then(({ svg }) => { if (alive && host.current) host.current.innerHTML = svg; })
      .catch((e) => {
        if (!alive) return;
        if (host.current) host.current.innerHTML = "";
        setError(String(e?.message || e));
      });
    return () => { alive = false; };
  }, [code]);
  return (
    <div class="md-mermaid">
      {/* innerHTML is only ever mermaid's own SVG output, never document text.
          The source can be any previewed markdown; strict mode runs DOMPurify
          on the SVG — the one exception to convention #8. */}
      <div ref={host} class="md-mermaid-svg" />
      {error ? <pre class="md-code md-mermaid-err">{code}{"\n\n"}{error}</pre> : null}
    </div>
  );
}
