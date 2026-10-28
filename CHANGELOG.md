# Changelog

What changed in each periscope release, newest first. The dashboard's Update
button installs releases, and its popover shows these sections.

## v0.2.0 — 2026-10-28

The first tagged release. From here on the Update button installs releases
rather than whatever is on `main`: the header pill names the release
(`↑ v0.3.0`) and its popover shows these notes. To run unreleased code,
`git pull` and `bin/periscope restart` as before.

Highlights from the last two weeks:

- **Reviews.** A Reviews view (header button, or ⌘K) lists every open PR that
  is yours or waiting on your review, with the pane working on it joined on.
  *Prepare* spawns a Claude that writes a walkthrough of the PR — fetching it
  into a worktree first if nothing has it checked out — and the walkthrough
  opens in periscope with its diff, citations and comments. Merge stays
  blocked until the comments are resolved. This replaces the LGTM integration.
- **Banner buttons.** In the macOS app, notifications act directly: Allow or
  Deny a permission prompt, reply to a question, or ask the agent to fix
  what failed — each re-checked against the pane when pressed. Settings →
  Notifications toggles each kind of banner.
- **Pane detection.** A pane counts as Claude whenever its composer sits at the
  bottom, whatever the status line prints; a permission dialog reads as
  needs-input; a stream cut's `API Error` flags the pane.
- **Smaller things.** Linear tickets show from the PR title or branch name
  without `link_linear`. Settings has a fonts picker. Mermaid blocks render as
  diagrams in previews. A split window no longer shows a frozen screen under
  the live one. The Tamagotchi critters gained hats, props, instruments and a
  stride.
