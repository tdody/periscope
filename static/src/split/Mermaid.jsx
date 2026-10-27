// A ```mermaid fence → inline SVG. mermaid is ~3 MB and lives in its own
// vite chunk (vite.config.js mermaidOnly), pulled in by this dynamic import
// on the first diagram only. Until it lands — or if the source doesn't parse
// — the fence shows as text so nothing is ever lost.
import { useEffect, useRef, useState } from "preact/hooks";

let mermaidP = null;
function loadMermaid() {
  if (!mermaidP) {
    mermaidP = import("mermaid").then((m) => {
      const mermaid = m.default;
      // The dashboard has one (dark) theme; following prefers-color-scheme
      // would draw a light diagram on the dark UI whenever macOS is light.
      mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
      return mermaid;
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
      .catch((e) => { if (alive) setError(String(e?.message || e)); });
    return () => { alive = false; };
  }, [code]);
  return (
    <div class="md-mermaid">
      {/* innerHTML is only ever mermaid's own sanitized SVG (securityLevel
          strict), never document text — the one exception to convention #8. */}
      <div ref={host} class="md-mermaid-svg" />
      {error ? <pre class="md-code md-mermaid-err">{code}{"\n\n"}{error}</pre> : null}
    </div>
  );
}
