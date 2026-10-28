# Release-gated self-update

The dashboard's Update button offers *releases* — tagged points on `main` that
carry a prose account of what changed — instead of whatever `main`'s tip
happens to be.

## Decisions

**D1 — A release is a `vX.Y.Z` tag on the canonical repo's `main`, cut by
`bin/release`, and the script refuses to cut one without notes.** "Notes"
means `CHANGELOG.md` opens with a non-empty `## vX.Y.Z` section for the
version being cut. The release commit (`release: vX.Y.Z`) carries the version
bumps *and* the notes, so `git show v0.3.0` is the whole story. The script
also refuses off `main` or behind `origin/main`, so a tag can never land on a
line the update can't fast-forward to.

**D2 — The Update button targets the newest release, never `main`'s tip.**
"Behind" becomes "commits between what's running and the newest release". A
checkout at or past the newest release sees nothing — including Tom's own
prod, which usually runs ahead of the last tag. That is the point: unreleased
commits reach other installs only when someone decides they're a release.

**D3 — The prose lives in `CHANGELOG.md`, newest first, and the popover
shows it instead of the commit list.** `## vX.Y.Z — YYYY-MM-DD` sections,
markdown. The popover renders every section newer than the release the
checkout is on (several, if an install skipped releases). The commit-subject
list goes away: at ~140 commits/week it had become a wall nobody read.

**D4 — "Meaningful" is the releaser's call; the gate is mechanical.** The
script enforces non-empty notes and at least one commit since the last tag.
Nothing infers the version number or the notes from commit messages — the
subjects here aren't conventional, and the point of the exercise is that a
human (or a Claude asked by one) writes a paragraph.

**D5 — Developers reach unreleased code the way Tom does today: `git pull`
+ `bin/periscope restart`.** The Update button gets no "track tip" mode
(priced below; I'd skip it).

### Questions for Tom

- **Q1 (T1, needs confirming):** Thibault's prod checkout fetches from
  `tomplex/periscope`, not from his fork? Tags travel with `git fetch` only
  from the remote his `main` tracks. `docs/updating.md` describes his setup
  as "a fork checkout that can't push to `origin/main`", which says origin
  *is* the canonical repo — if so, nothing to do.
- **Q2 (T2):** GitHub's Releases page — carry the changelog section as the
  release body (+1 file), or leave the dmg boilerplate? I'd take it; it's a
  shell step in the workflow.
- **Q3:** First release. Landing this makes the Update button inert until a
  tag exists. I'd cut `v0.2.0` in the same session, notes drafted from
  `git log` since whatever point you call the start.

## Smallest version

**Problem:** An install's self-update offers whatever is on `main` right now —
hundreds of commits with no account of what changed — instead of a
deliberate, described release.

**Seam pair:** the target ref the updater measures against and fast-forwards
to. Reader: `updater.check()` (Python, hourly, feeds the pill). Writer:
`bin/periscope update` (shell, does the fast-forward). Both hardcode `@{u}`
today — 2 sites, and they must agree or the pill arms a button that does
something else. Producer: `bin/release`.

**Minimal version** (~9 files): both sides of the seam resolve the target as
"newest `v*` tag reachable from upstream" instead of upstream's tip, and the
popover shows the changelog sections between the running release and the
target, read from the target tag's `CHANGELOG.md`. `bin/release` refuses
without a non-empty section for the version being cut.

Left out, and what it costs:
- GitHub Releases page keeps its boilerplate body — anyone browsing releases
  on GitHub; reads `CHANGELOG.md` instead.
- No Update-button path to unreleased commits — a developer wanting tip on
  prod; `git pull` + `bin/periscope restart`, plus `install-hook` /
  `install-skill` if the pulled change touched provisioning (what Tom does
  now).
- Notes aren't drafted for you — the releaser, every release; the refusal
  message prints the subjects since the last tag as raw material, and Claude
  turns them into prose when asked.

Accepted consequences:
- Until the first tag is pushed the verb refuses ("no release to update to")
  and the pill stays hidden — cutting a release is part of landing this.
- A checkout whose tracked remote isn't the canonical repo never sees a tag,
  so never sees the pill (Q1).
- Notes are proofread by nobody but the releaser; a typo fixed after tagging
  appears in the *next* release's popover, since the popover reads the target
  tag's file.
- Release discipline past the gate (cadence, semver choice) is convention.

Additions (each is Tom's to pick):
- +1 file (`.github/workflows/release.yml`) → removes "GitHub Releases page
  shows boilerplate": a step extracts the tag's changelog section into
  `releaseBody`.
- +0 files (~6 lines in `bin/periscope`) → removes "no Update-button path to
  tip": `bin/periscope update --tip` fast-forwards to `@{u}` as today. It's a
  mode no dashboard caller passes; I'd skip it.

Dropped:
- Annotated-tag message as the notes' home — `CHANGELOG.md` is browsable and
  PR-reviewable; a second copy in the tag removes no hazard.
- A persisted "channel" setting (`release` / `main`) — every install has one
  value; a flag no caller varies is a constant.
- A `release` field on `/api/healthz` — the update verb's SHA poll already
  proves what's serving.
- Version inference from commit messages — subjects aren't conventional
  here; the releaser picks the number.

File budget: 9 (+ picked additions). Stop and report at 18.

## Mechanics

### `bin/release X.Y.Z`

In order, each a refusal with the reason on stderr:

1. `X.Y.Z` is semver and sorts above the newest existing `v*` tag.
2. On `main`; after `git fetch`, `origin/main` is an ancestor of `HEAD`
   (ahead is fine — the script pushes; behind means the tag would sit beside
   `main`, not on it).
3. Working tree clean *except* `CHANGELOG.md`, which may be modified — it is
   the one input the script expects to find fresh.
4. `CHANGELOG.md`'s first `## ` heading is `## vX.Y.Z` (date suffix
   optional) and the section body has at least one non-blank line.
5. At least one commit since the newest existing tag (none → "nothing to
   release"); on refusal 4, print `git log <last-tag>..HEAD --format='- %s'`
   so the raw material is in front of the releaser.

Then as today: bump the three version fields, re-sync `Cargo.lock`, stage
those plus `CHANGELOG.md`, commit `release: vX.Y.Z`, tag, push `HEAD` and the
tag.

### `bin/periscope update`

After the existing dirty-tree check and `git fetch --quiet --tags`:

```sh
TARGET="$(git -C "$REPO" tag --list 'v*' --sort=-v:refname --merged '@{u}' | head -1)"
[ -n "$TARGET" ] || { echo "no release to update to — nothing tagged on origin" >&2; exit 1; }
git -C "$REPO" merge --ff-only "$TARGET" || { ...same divergence message, naming $TARGET... }
```

`--merged '@{u}'` ignores any tag not on the upstream line (a stray local
tag, a tag cut off a branch). `-v:refname` sorts `v0.10.0` above `v0.9.0`.
Everything after the merge — plist, bootout/bootstrap, hooks, the healthz SHA
poll — is unchanged; the SHA it waits for is `$TARGET`'s.

### `periscope/updater.py`

`check()` resolves the same target with the same two git calls, then:

- `behind` / `ahead` = `rev-list --count --left-right <target>...HEAD`.
- `target` = the tag name (new field on `summary()`, rides `/api/state` — one
  short string, replaces nothing).
- `releases` replaces `_commits`: the sections of `<target>:CHANGELOG.md`
  newer than the running release, where "running release" is `git describe
  --tags --abbrev=0 --match 'v*'` at HEAD (absent → every section). Parsed
  by splitting on lines starting `## `; each entry is `{version, body}`.
  Same keep-last-answer rule as the commit list: a failed read leaves the
  previous list standing.

`status()` carries `releases` instead of `commits`; `COMMITS_LIMIT` goes.

### `static/src/chrome/UpdatePill.jsx`

- Pill label `↑ v0.3.0` (the version, not a commit count — the count is
  noise to the person deciding). `behind` stays on the wire for the
  `blocked` warning, which is unchanged.
- Popover head: `v0.3.0 — N commits since v0.2.0` (or "since the start" when
  no tag is behind HEAD).
- `CommitList` becomes `ReleaseNotes`: one block per release, heading +
  `renderMarkdown(body)` (`split/markdown.jsx`, already in the bundle). Same
  three fallbacks (loading / request failed / nothing recorded).
- Button copy unchanged.

### Tests

- `tests/test_updater.py`: the target-resolution tests replace the
  `commit subjects` ones — no tag → no update info and the last answer
  stands; tag off the upstream line ignored; sections parsed newest-first and
  cut at the running version; a failed changelog read keeps the last list.
- `updatePillRender.test.jsx`: label shows the version; notes render as
  markdown; the three fallbacks.
- `bin/release` is shell with `cargo` and `git push` in it — exercised by
  cutting the first release, not by a test.

### Docs

`docs/updating.md` gets a "What an update targets" section (the tag
resolution, why `--merged @{u}`, the first-release consequence) and the
`CHANGELOG.md` convention; `CLAUDE.md`'s Releases paragraph names the
changelog gate.
