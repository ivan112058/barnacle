# Browser invariant harness (`tests/browser/`)

`scripts/verify*.mjs` check that the **bytes** of the artifact are right. These tests check what
a browser actually **computes** from those bytes: real system Chrome, `getComputedStyle`, no
screenshots. They are the evidence ticket 09 needs to say "the interaction contract was
extracted and nothing observable changed".

```console
npm run build          # the tests measure static/*, so build first
npm run test:browser   # 11 tests, ~5 s
npm run test:browser:mutations   # is the suite able to fail at all? (~1 min, read-only)
```

`npm run test:browser` runs `node --test --test-force-exit --test-concurrency=2 tests/browser/`:

- the path is explicit, because a bare `node --test` recursively discovers every `*.test.*` in
  the repository and would pull in unrelated directories;
- `--test-force-exit` is the second line of defence behind `after()`'s `browser.close()`: a live
  Chrome keeps the test process alive forever and `--test-timeout` does not help;
- `--test-concurrency=2` bounds the number of concurrent Chrome instances (memory, not ports:
  every file binds `127.0.0.1:0`).

## Baseline

| | |
| --- | --- |
| Browser | system Chrome **155.0.8059.82**, driven with `channel: 'chrome'`, `headless: true` |
| Driver | `playwright-core@1.64.1` (exact, devDependency) — **no browser is ever downloaded** |
| Node | v26.10.0 |
| Baseline taken | 2026-02 (evidence in ticket 08's `## Answer`) |

`channel: 'chrome'` is not a preference, it is the only way this machine can run the suite:
`chromium.launch()` wants revision 1248 and `%LOCALAPPDATA%\ms-playwright` only holds 1223
(installed by an unrelated repository). `launchChrome()` says all of that in its failure message.
Do **not** "fix" a launch failure with `npx playwright install` — that makes the suite measure a
different browser than the machine's.

Computed values are Chrome's normalised serialisations. A Chrome major upgrade may respell one,
which is why the baseline is recorded here. The strings the assertions use:

| declaration | computed value |
| --- | --- |
| `box-shadow: 4px 4px 0 0 #000` | `rgb(0, 0, 0) 4px 4px 0px 0px` |
| `transform: translate(-2px, -2px)` | `matrix(1, 0, 0, 1, -2, -2)` |
| `outline: 3px solid #74B9FF` | `outlineStyle: solid`, `outlineWidth: 3px`, `outlineColor: rgb(116, 185, 255)` |
| `transition` with four 150 ms properties | `transitionDuration: 0.15s, 0.15s, 0.15s, 0.15s` |
| no transition declared | `transitionDuration: 0s` |

## The three anti-flake rules (implemented in `harness.mjs`, do not work around them)

1. **Freeze `transition`/`animation` before asserting.** Unfrozen, `page.hover()` then an
   immediate read returned the *pre-transition* value in 30/30 samples — a test that lies
   consistently rather than intermittently. `sleep` cannot replace it (the delay + duration come
   from the CSS under test). The freeze goes in through `addInitScript`, i.e. before `goto`.
2. **Focus is reached with a real keyboard `Tab`.** `element.focus()` happens to match
   `:focus-visible` on a fresh page, but it bypasses the tab order and passes for elements no
   keyboard user can reach. Never assert a focus ring on a `<div>`: a `<div>` is not focusable.
3. **Every `:hover` read happens in one `evaluate`**, which also carries `matches(':hover')` as
   self-evidence so a resting value cannot pass as an end state.

Two more traps that cost real time:

- **`outline: none` still computes `outline-width: 3px`** (the initial `medium`). The focus
  assertion therefore checks `outlineStyle` and `outlineColor` as well — width alone is vacuous.
- **The freeze makes any `transition-*` read tautological** (`transition: none !important`).
  `motion.test.mjs` is the one test that runs with `freeze: false`, and it also asserts the
  *opposite* direction (the default context reports 0.15 s), so "no transition" cannot pass for
  an artifact that simply forgot to declare one.

## Files

| file | what it holds |
| --- | --- |
| `expectations.mjs` | every expected value, derived from spec §3/§6/§7 and ADR-0003/0004/0006 — **never** recomputed from the CSS |
| `harness.mjs` | static server (subpath mounts, `listen(0)`), Chrome launch, the freeze, console/pageerror collection, the assertion helpers, hover/Tab/token driving |
| `fixtures/*.html` | markup only; every style comes from `/barnacle/static/barnacle.css`, every script from `/barnacle/static/barnacle.js` |
| `shadow.test.mjs` | spec §3.2 (zero blur/spread), §3.3 (displacement = shadow growth), §3.7 (hover never changes a border width) |
| `focus.test.mjs` | spec §7 — a real Tab, a complete outline, the hard shadow still painted |
| `motion.test.mjs` | spec §7 — the reduced-motion guard, with the default context as its control |
| `theme.test.mjs` | ADR-0004 (system dark changes nothing), §6/ADR-0003 (one token rescales three tiers, on `:root` only), orchestrator §8 (`data-theme` on `<html>` vs `<body>`) |
| `cascade.test.mjs` | ADR-0006 — unlayered user CSS wins, the layered control, and the artifact provenance read back out of the live document |
| `mutation-sweep.mjs` | runs these same test files against 11 deliberately broken copies of the artifact and requires each to go red **and** name its invariant. It copies the artifact to a temp directory (`BARNACLE_ARTIFACT_DIR`) and never touches `static/` |

## Reminders for later tickets

The assertions most likely to break when a component changes, and why that is the point:

- **Any new `box-shadow`** — every shadow assertion is a full computed string, so a new blur,
  spread, colour or offset fails immediately. That is deliberate: the hard shadow's zero blur and
  zero spread are spec §3 invariant 2.
- **`--_shadow-rest` / `--_shadow-hover` are the only place a state's tier may be chosen.** When
  ticket 09 moves the interaction contract around, `shadow.test.mjs` and `theme.test.mjs` read
  the *tiers*, not the file they live in, so a refactor is fine and a changed value is not.
- **`--bn-shadow-lift` must stay `calc(var(--bn-shadow-x) / 2)`.** The equation
  (`displacement === shadow growth`) is asserted from three independent readings against the
  spec value, so writing the lift as a literal fails even when the numbers happen to agree.
- **The transition list is asserted exactly** (`transform, box-shadow, background-color,
  border-color`; 0.15 s; inside `prefers-reduced-motion: no-preference`). A new animated property
  is a new decision, not a detail.
- **Focus: never `outline: none`, and never move the ring onto `box-shadow`.** The ring must
  coexist with the hard shadow; that is the whole reason it is an outline.
- **`data-theme` belongs on `<html>`.** `theme.test.mjs` pins both halves, so moving the theme
  tokens or un-deriving the shadow chain fails loudly instead of quietly losing the dark shadow.
