# Linting & type-checking

One gate, two languages. `bin/check` is the single entrypoint (`--fix`
applies safe autofixes); `.pre-commit-config.yaml` runs the same checks on
commit (install once with `uv tool run pre-commit install`), and
`.github/workflows/ci.yml` runs it on every push/PR alongside vitest, a
`static/dist` freshness check, and pytest (macOS — the channel-shim reconnect
tests time out on Linux). The gate is kept at **zero violations** — keep it
there.

```sh
bin/check            # ruff check + ruff format --check + ty + biome, report-only
bin/check --fix      # ruff --fix + ruff format + biome --write, then check
uv run ruff check .  # Python lint (Astral)
uv run ruff format . # Python format (Astral)
uv run ty check      # Python types (Astral, pre-1.0)
npm run lint         # UI lint (Biome); npm run lint:fix to autofix
```

Rule choices and *why* (config in `pyproject.toml` `[tool.ruff]` /
`[tool.ty.*]` and `biome.json`):

- **ruff** — deep set (`E,F,W,I,UP,B,SIM,C4,PIE,RET,PERF`). `E501`
  (line length) and `E701`/`E702` (terse multi-statement lines) are OFF:
  that terse style is deliberate here. Tests per-file-ignore `E402`
  (section-divider import grouping) and `E731` (lambda fixtures).
- **ruff format** is ON for Python, gated by `ruff format --check`.
  `line-length = 120`, not ruff's 88: it was adopted late over code written
  wide and terse, and 120 was the least-churn width (~8.3k changed lines vs
  ~10.9k at 88). The reformat commit is listed in `.git-blame-ignore-revs`
  (`git config blame.ignoreRevsFile .git-blame-ignore-revs` to skip it
  locally). E701/E702 stay off in the linter, though the formatter splits
  those lines anyway.
- **ty** checks source AND tests. Source is fully strict. Tests stay in the
  gate so real test-code bugs (undefined names, bad imports, syntax) are
  caught, but six rules that *only* fire as noise on mock-heavy
  (`MagicMock`) / monkeypatched / happy-path test code are silenced there
  via `[[tool.ty.overrides]]` (`unresolved-attribute`, `invalid-argument-type`,
  `not-subscriptable`, `invalid-assignment`, `unsupported-operator`,
  `not-iterable`) — they stay strict on source. `build_icons.py` is excluded
  (`[tool.ty.src] exclude`): a manual icon script with an undeclared optional
  dep (Pillow). One inline `# ty: ignore[unresolved-attribute]` exists in
  `channels.py` for `asyncio.Server.close_clients()` (real since 3.13; ty's
  typeshed lags).
- **Biome** is a **linter only — the formatter is OFF**. An opinionated
  formatter fights the hand-written terse UI style, so we keep lint + `organizeImports` without
  reformatting. Four interaction/semantic a11y rules are off
  (`useButtonType`, `useKeyWithClickEvents`, `noStaticElementInteractions`,
  `useSemanticElements`): this is a personal dev dashboard, not an a11y
  target — `onClick` lives on divs/cards by design and there is no `<form>`.
  Scope is `static/src/**` (the Preact app); the legacy `/history` SPA,
  vendored xterm, and the built bundle are excluded.

`ruff` and `ty` are pinned in the `dev` dependency group; Biome is a
`devDependency` (`@biomejs/biome`).
