// Compares where LAYOUT thinks each scroller is (JS scrollTop) with where the
// COMPOSITOR has it (the overflow nodes in WebKit's UI-process scrolling tree),
// on the system WebKit, in an off-screen WKWebView. Driven by run.sh — the
// question it answers and the usage live there.
//
// Private SPI, all WebKit testing hooks:
//   _scrollingTreeAsText                  the only readout of the compositor's offset
//   _setWindowOcclusionDetectionEnabled:  NO, or an off-screen window is treated
//                                         as hidden and animations never run
//   _setOverrideDeviceScaleFactor:        2, to match a Retina shell

import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count >= 3 else {
  print("usage: harness <page.html> <styles.css> [--anchoring] [--cycles N]")
  exit(2)
}
let anchoring = args.contains("--anchoring")
var cycles = 60
if let i = args.firstIndex(of: "--cycles"), i + 1 < args.count, let n = Int(args[i + 1]) { cycles = n }

let extra = anchoring ? "* { overflow-anchor: auto !important; }" : ""
let html = try! String(contentsOfFile: args[1], encoding: .utf8)
  .replacingOccurrences(of: "/*STYLES*/", with: try! String(contentsOfFile: args[2], encoding: .utf8))
  .replacingOccurrences(of: "/*EXTRA*/", with: extra)

// The y of every overflow node's "(scroll position (x,y))", or nil when the
// SPI is gone. "last committed" and "related overflow" lines are not it.
func compositorPositions(_ w: WKWebView) -> [Double]? {
  let sel = Selector(("_scrollingTreeAsText"))
  guard w.responds(to: sel), let tree = w.perform(sel)?.takeUnretainedValue() as? String else { return nil }
  var out: [Double] = []
  var inOverflow = false
  for raw in tree.split(separator: "\n") {
    let line = raw.trimmingCharacters(in: .whitespaces)
    if line.hasPrefix("(overflow scrolling node") { inOverflow = true }
    if inOverflow, line.hasPrefix("(scroll position ("),
       let y = line.trimmingCharacters(in: CharacterSet(charactersIn: ")")).split(separator: ",").last.flatMap({ Double($0) }) {
      out.append(y)
      inOverflow = false
    }
  }
  return out
}

func after(_ s: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: f) }

// Layout vs compositor offsets, each sorted so scrollers pair up by position.
func sample(_ w: WKWebView, _ done: @escaping ([Double], [Double]) -> Void) {
  w.evaluateJavaScript("positions()") { r, _ in
    guard let ui = compositorPositions(w) else {
      print("cannot read the scrolling tree: _scrollingTreeAsText is unavailable on this WebKit")
      exit(2)
    }
    done(((r as? [Double]) ?? []).sorted(), ui.sorted())
  }
}

class Driver: NSObject, WKNavigationDelegate {
  func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
    after(0.5) {
      w.evaluateJavaScript("setup()") { _, _ in
        after(0.5) {
          let progress = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in
            sample(w) { layout, ui in print("  layout \(layout)  compositor \(ui)") }
          }
          w.callAsyncJavaScript("return await churn(\(cycles))", arguments: [:], in: nil, in: .page) { _ in
            progress.invalidate()
            after(1.0) {
              sample(w) { layout, ui in
                let gaps = zip(layout, ui).map { $1 - $0 }
                let drifted = layout.count != ui.count || gaps.contains { abs($0) > 1 }
                print("final: layout \(layout)  compositor \(ui)")
                print(drifted
                  ? "DRIFT — compositor is off from layout by \(gaps) px after \(cycles) cycles"
                  : "LOCKED — compositor and layout agree after \(cycles) cycles")
                exit(drifted ? 1 : 0)
              }
            }
          }
        }
      }
    }
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let frame = NSRect(x: 0, y: 0, width: 760, height: 640)
let window = NSWindow(contentRect: frame.offsetBy(dx: -4000, dy: -4000), styleMask: [.borderless], backing: .buffered, defer: false)
let webView = WKWebView(frame: frame)
let occlusion = Selector(("_setWindowOcclusionDetectionEnabled:"))
if webView.responds(to: occlusion) { webView.perform(occlusion, with: nil) }
let scale = Selector(("_setOverrideDeviceScaleFactor:"))
if webView.responds(to: scale) {
  typealias SetScale = @convention(c) (AnyObject, Selector, CGFloat) -> Void
  unsafeBitCast(webView.method(for: scale), to: SetScale.self)(webView, scale, 2.0)
}
let driver = Driver()
webView.navigationDelegate = driver
window.contentView = webView
window.orderFrontRegardless()
webView.loadHTMLString(html, baseURL: nil)
after(600) { print("timed out"); exit(2) }
app.run()
