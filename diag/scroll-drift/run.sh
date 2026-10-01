#!/usr/bin/env bash
# Diagnostic for the rail "creeps downward, hover lands above the pointer" bug
# (docs/tauri-shell.md, "Scroll anchoring is off app-wide").
#
# Question: on THIS machine's WebKit, does the compositor's scroll offset stay
# equal to layout's while rows come and go above the viewport and the rail's
# box-shadow pulses run?
#   - LOCKED (exit 0) -> paint and hit-testing agree; hover lands where you point.
#   - DRIFT  (exit 1) -> the scroller creeps on screen while scrollTop stays put.
#
# Page script cannot see the compositor's offset, so this builds a rail out of
# the checkout's real static/styles.css in an off-screen WKWebView and reads
# WebKit's UI-side scrolling tree. No window appears; the server need not run.
#
# Usage:
#   diag/scroll-drift/run.sh               # the stylesheet as shipped — expect LOCKED
#   diag/scroll-drift/run.sh --anchoring   # force scroll anchoring back on: DRIFT
#                                          # means WebKit still has the bug, LOCKED
#                                          # means anchoring is safe to re-enable
#   diag/scroll-drift/run.sh --cycles 200  # more add/remove cycles (default 60)
#
# Exit 2 = the harness could not measure (SPI missing, or timed out).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT

swiftc -O -suppress-warnings "$here/harness.swift" -o "$build/harness"
"$build/harness" "$here/page.html" "$here/../../static/styles.css" "$@"
