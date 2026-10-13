---
id: gap-discovery-toolchain-depends-on-unshipped-docs-analysis-and-ts-sources-never-works-off-quay-repo
title: "all 3 discovery routines
  (open-semantic-discovery/discovery-method/arch-discovery) resolve
  docs/analysis/*.mjs, which is not shipped in the plugin artifact and itself
  transitively imports plugin/scripts/*.ts SOURCE files — confirmed on 0.19.0
  cache and a fresh develop build: no host project other than quay's own live
  checkout has ever produced a discovery round"
status: ready
labels:
  - gap
  - defect
  - discovery-method
  - packaging
parent: null
children: []
extra: {}
---
## Proposal
**Discovered 2026-10-13 while enabling `open_semantic_discovery` on ClaudeCodeUI (first-ever deployment outside quay's own dev checkout).** All three semantic/architecture discovery routines (`open-semantic-discovery-routine.ts`, `discovery-method-routine.ts`, `arch-discovery-routine.ts`) resolve their engine modules from `docs/analysis/*.mjs` (`resolveEngineModule`, `open-semantic-discovery-routine.ts:1358`: tries `<kernel-root>/docs/analysis/<file>` then `<project-root>/docs/analysis/<file>`). **`docs/analysis/` is not part of the shipped plugin artifact** — confirmed by direct inspection of two real builds:
- the currently-installed cache `~/.claude/plugins/cache/quay/quay/0.19.0/` has no `docs/` directory at all (and that version predates this routine's code, so it was never reachable even in principle);
- a fresh build of develop via the project's own `build-plugin-dist.mjs` (the private 0.20.0-dev trial build) also produces no `docs/` directory.

A conservative, additive-only workaround was applied to the TRIAL build only (`/data/home/yale/work/quay-scratch/private-dist-020-dev/docs/analysis/*` + `plugin/scripts/*.ts`, copied from quay's own checkout, never touching claudecodeui's business code or quay's own repo) and the dependency chain still does not resolve cleanly:

1. `arch-hypothesis-generation.mjs` imports a SIBLING `docs/analysis/architecture-evidence-store.mjs` — none of the 4 modules `loadOpenDiscoveryModules` needs are self-contained; the real dependency graph is wider than its own 4-file list.
2. Copying the WHOLE `docs/analysis/` directory (131 files) still fails: `arch-hypothesis-generation.mjs` then imports `plugin/scripts/import-graph-check.ts` — a TypeScript SOURCE file, not a compiled `scripts/dist/*.js` file. **The discovery toolchain under `docs/analysis/` is written to run against a live quay SOURCE checkout (where `plugin/scripts/*.ts` sits beside `docs/analysis/`), not against a built plugin artifact that ships only `scripts/dist/*.js`.**
3. Copying `plugin/scripts/*.ts` (288 files) wholesale still does not cleanly resolve (a module-level initialization error appeared, likely a missing runtime context the live quay repo normally supplies — e.g. an env var, a relative resource, or additional source subdirectories not yet copied) — not fully diagnosed, left for this task.

**Consequence:** `open_semantic_discovery` (and by the same code shape, `discovery_method` and `arch_discovery`) can be ENABLED (config accepted, routine assembled, log line printed) in ANY host project's `.quay/config.yml`, but the round itself fails `engine modules unresolved` every time, for EVERY project using the normal, officially-distributed plugin install — this is not specific to ClaudeCodeUI or to this trial's private build; it would reproduce identically on quay-fleet, archguard, cantus, meta-cc, or any future host, with any officially-released plugin version that includes this code. **This is why no host project other than quay's own live dev checkout has ever produced a single discovery round, independent of whether its config declares the section.**

## Plan
1. **Decide the fix shape from evidence, not a guess**, between (at least) these two:
   - (a) make the plugin build ship the full transitive closure the discovery toolchain needs (`docs/analysis/*` + whatever of `plugin/scripts/*` it imports) as part of the normal dist artifact — bounded by actually walking the import graph (reuse `import-graph-check.ts`'s own capability, since that is literally one of the things that needs shipping) rather than copying everything;
   - (b) refactor the discovery toolchain so it depends only on the SAME compiled kernel surface every other shipped routine already uses (`scripts/dist/*.js` exports), removing the live-source-checkout assumption at the root.
   (b) is architecturally cleaner (no more "this code only works in quay's own repo" asymmetry) but is a larger refactor; (a) is a smaller, bounded packaging fix. State which was chosen and why, with the import-graph evidence from THIS task's own investigation (not reused from the trial's informal file-copy attempts).
2. Whichever shape, the acceptance proof must be a FRESH plugin build (via the project's own `build-plugin-dist.mjs`, not a hand-copied scratch tree) that runs a real `open_semantic_discovery` round to completion against a project OTHER than quay's own repo.

## Acceptance Criteria
- [x] AC1: the full import graph `docs/analysis/*.mjs` (as used by the three discovery routines) actually needs, computed mechanically (not asserted), is pasted — file count and whether any of it is itself a `.ts` source file.

  **Computed mechanically over a clean `develop` extract** (`git archive develop plugin docs/analysis packages | tar -x -C /tmp/disc-pre`, `git init` there), walking the static import graph of the 7 engine modules the three routines' manifests name, using `import-graph-check.ts`'s OWN `extractImports` / `resolveSpecifier` over `gitLsFiles` (硬规则 1 — no second parser, no new mask):
  ```
  PRE-FIX closure total: 69 byExt: {'.mjs': 9, '.ts': 60} unresolved: {}
  ts sources: 60   (50 plugin/scripts/*.ts + 10 packages/quay/src/**/*.ts)
  mjs: docs/analysis/{arch-hypothesis-generation,architecture-evidence-store,arch-discovery-space,
       arch-discovery-time,discovery-portfolio,discovery-method-registry,discovery-experience-ledger,
       discovery-reflection}.mjs + plugin/scripts/workflow-event-schema.mjs
  ```
  ⇒ **69 files, 60 of them `.ts` SOURCE files**; 0 unresolved relative specifiers, so the graph is complete (no silent gap).

  **Second mechanical pass for runtime-CONSTRUCTED `.ts` references** (which a static walker structurally cannot see — they are built with `path.join` and handed to `import()`): 10 literal hits, 7 of them prose/comments, and **3 real runtime loads of `plugin/scripts/enum-surface-parity-check.ts` in `arch-discovery-space.mjs` (`:494`, `:495` — the `--pre`/`--post` pinned trees; `:541` — scan mode)**; `arch-hypothesis-generation.mjs` additionally runtime-loads `plugin/scripts/driver-runtime.ts`.

  **Post-fix** the same walker on this branch returns **8 `.mjs`, 0 `.ts`**, and `build-plugin-dist.mjs` now REFUSES the build on any non-`.mjs` edge (fail-closed — see `discoveryEngineClosure`).

- [x] AC2: the decision ((a) ship the closure / (b) refactor off source-file dependence) is stated with the evidence basis.

  **Chosen: (b) at the root, carried by (a)'s shipping mechanism — remove the engine's source-file dependence, which makes the engine a PURE-`.mjs` graph, and ship THAT closure verbatim into the artifact.**

  Why not the literal (a) ("ship the closure" as raw files): **60 of the 69 closure files are `.ts`**, and the artifact deliberately deletes raw plugin `.ts` at pack time (`packages/quay/scripts/package.sh`) because it must run on a bare Node ≥20 with NO `--experimental-strip-types`. Shipping raw `.ts` would trade a resolution failure for 60 type-stripping dependencies on the consumer's Node — the exact thing the artifact exists to avoid.

  Why not (a)-compiled (esbuild-bundle the engine): (i) the two instruments carry **URL-equality entry guards** (`arch-discovery-space.mjs:712`, `arch-discovery-time.mjs`) — esbuild inlines a module into any bundle that imports it, so bundling `arch-hypothesis-generation.mjs` (which imports `Sink` from `arch-discovery-space.mjs`) would inline that guard and run the instrument's `main` inside the hypothesis-generation bundle: exactly the hijack `findEntryGuardHijacks` refuses; (ii) `arch-discovery-space.mjs:541`'s checker load is built at runtime from a computed path, which esbuild cannot see or inline at all.

  Evidence basis = AC1's own closure (60/69 are sources) + the measured artifact (a fresh `develop` build ships no `docs/` at all, and ships no `scripts/dist/import-graph-check.js` either). The result is (b)'s architecture — no "only works in quay's own repo" asymmetry remains — reached with (a)'s bounded, mechanical derivation.

- [x] AC3: a FRESH `build-plugin-dist.mjs` run produces an artifact that, installed into a scratch project with NO quay source checkout alongside it, runs `open_semantic_discovery --once --root <scratch>` to a real `scan-round` record (not a RED/failed one) in that scratch project's own carrier. Paste the command and the carrier line.

  **Fresh artifact**: staged exactly as `package.sh` does (`cp -R plugin/. packages/quay/plugin/` → `build-plugin-dist.mjs <dest>` → delete raw `.ts` → `--rewrite`), i.e. a real `build-plugin-dist.mjs` run, not a hand-copied tree:
  ```
  build-plugin-dist: 115 bundled entrypoints → .../packages/quay/plugin/scripts/dist (+ gate-scripts/dist)
  build-plugin-dist: discovery engine staged → .../packages/quay/plugin/docs/analysis (8 .mjs + 5 data file(s), verbatim)
  $ md5sum packages/quay/plugin/docs/analysis/arch-hypothesis-generation.mjs docs/analysis/arch-hypothesis-generation.mjs
    f9b025e680824c25c8a15328b6ea3627   (identical — the engine ships verbatim)
  ```
  **Installed copy**: `/tmp/disc-host/node_modules/quay/` = that artifact's `plugin/` + `package.json` + a `yaml` dependency. Nothing else — **no quay source checkout alongside it** (`ls /tmp/disc-host/node_modules/` → `quay  yaml`).
  **Scratch project**: `/tmp/disc-scratch2`, a plain git repo (`develop` @ `db9dc3494e0f10c1b92e68fc799b1ca30dd2671f`) holding three `.ts` files, its own `.quay/config.yml` (only `loop.open_semantic_discovery` enabled) and `.quay/profiles.yml`.
  **Command** (the SHIPPED production entry — the OSD routine is inlined into `quality-gate-driver.js`'s routine table, so this IS `open_semantic_discovery --once --root <scratch>`):
  ```
  $ node /tmp/disc-host/node_modules/quay/plugin/scripts/dist/quality-gate-driver.js --once --root /tmp/disc-scratch2 --json
  ```
  **Fact**: `state:"verified"`, reason `round ran (invoked_by:resident-driver, interval 360m): investigator read the pin with Read,Grep,Glob, 5 cluster(s) from 1 run(s), 2 verified, 0 CONFIRMED after independent refutation, 3 model call(s) costing $0.0432, wall 87698ms; appended 1 scan-round + 2 cluster record(s) to .quay/open-semantic-discovery-findings.jsonl`.
  **Carrier line** — `.quay/open-semantic-discovery-findings.jsonl`, record 1 of 4, the file's single `kind:"scan-round"` line (10,270 bytes raw; projected):
  ```json
  {"kind":"scan-round","routine":"open-semantic-discovery","invoked_by":"resident-driver",
   "ts":"2026-10-13T09:41:23.908Z","interval":{"minutes":360,"declared_minutes":360,"reverted":false,"until":null},
   "pin":{"rev":"db9dc3494e0f10c1b92e68fc799b1ca30dd2671f","dir":"../osd-pin-db9dc349-FJZtXo"},
   "inventory":{"ok":true,"entries":3,"unavailable":null,"scope":"plugin/scripts"},
   "clusters":{"total":5,"verified":2,"beyond_cap":3},"confirmed":{"count":0,"claims":[]},
   "attribution":{"verified":2,"confirmed":0,"determinate":2,"determinate_rate":1,
     "blocked":{"verifier":0,"refuter":0},"causes":{},"healthy":true,
     "basis":"2/2 verified clusters judged; 0 lost to a non-naming cause, 0 carrying no attribution block at all"},
   "reservations":{"cap":12,"used_at_start":0,"granted":3,"refused":0,"mid_round_refusal":null,
     "usd_cap":8,"usd_used_at_start":0,"ledger":".quay/open-semantic-discovery-model-budget.jsonl"}}
  ```
  **Negative control (the defect, on a FRESH build of `develop`)** — same staging, `git archive develop plugin packages/quay/{src,scripts}`, same scratch project copied clean:
  ```
  state: "failed"
  reason: "engine modules unresolved — OPEN_DISCOVERY_MODULES_UNRESOLVED — arch-hypothesis-generation.mjs —
    not found at /tmp/disc-prefix/plugin/docs/analysis/arch-hypothesis-generation.mjs or
    /tmp/disc-scratch-before/docs/analysis/arch-hypothesis-generation.mjs; discovery-portfolio.mjs — …;
    discovery-experience-ledger.mjs — …; discovery-method-registry.mjs — … (nothing appended, last-run not advanced)"
  ```
  and `/tmp/disc-scratch-before/.quay/` holds **no carrier file at all** — the round never appended. (`ls /tmp/disc-prefix/plugin/docs` → `No such file or directory`; `ls .../scripts/dist | grep import-graph` → none.)

- [x] AC4: the SAME artifact still fails cleanly (not a crash) when a project root is genuinely empty of the project's own code, with a NOT-EVALUATED-shaped reason (hard rule 3b) — negative control.

  **Command** — the same shipped artifact, same section enabled, root = `/tmp/disc-empty` (an EMPTY directory holding only `.quay/config.yml` + `.quay/profiles.yml`, not a git repo):
  ```
  $ node /tmp/disc-host/node_modules/quay/plugin/scripts/dist/quality-gate-driver.js --once --root /tmp/disc-empty --json
  ```
  **Reading**:
  ```
  state: "not-evaluated"
  reason: "pin basis unavailable — `git -C /tmp/disc-empty rev-parse develop` failed:
    Command failed: git -C /tmp/disc-empty rev-parse develop
    fatal: not a git repository (or any of the parent directories): .git
    (nothing spawned, nothing appended, last-run not advanced; not-evaluated:no-develop-ref)"
  ```
  `ls /tmp/disc-empty/.quay/` after the run → `config.yml  profiles.yml  quality-round.jsonl` — **no carrier, nothing appended**, and the driver process exited 0 (it completed a round; it did not crash). The reason carries its own `not-evaluated:no-develop-ref` token, so "nothing could be evaluated" never shares a shape with "evaluated, found 0" (硬规则 3b).

  **This WAS a crash before the fix.** The round's step ⑤ called `developTip` (an unguarded `execFileSync("git", ["-C", root, "rev-parse", "develop"])`) and the pin materialiser unguarded, so a root that could not be pinned threw straight out of `runOpenSemanticDiscovery`, past every `failed` Fact. Measured directly on the empty root:
  ```
  $ node --experimental-strip-types /tmp/disc-closure/pin-throw.mjs
  developTip THROWS (uncaught in the pre-fix step ⑤): Command failed: git -C /tmp/disc-empty rev-parse develop | fatal: not a git repository …
  $ git show develop:plugin/scripts/open-semantic-discovery-routine.ts | grep -n 'developTip)(root)'
  3526:  const rev = (opts.revFn ?? developTip)(root);      ← no try/catch
  ```
  On the pre-fix `develop` artifact this was masked by the engine failing first (step ④ precedes step ⑤); the engine now resolves, so the pin step is reached and must be — and is — clean.

- [x] AC5: `scripts/test.sh --for-task <this task>` green.
  ```
  $ bash scripts/test.sh --for-task gap-discovery-toolchain-depends-on-unshipped-docs-analysis-and-ts-sources-never-works-off-quay-repo --allow-thin
  ℹ tests 279  ℹ pass 279  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0  ℹ todo 0
  ```
  and the directly-affected artifact suite, run separately because it is the one that exercises `deriveEntries`/`closureMissing`:
  ```
  $ node --test packages/quay/test/build-plugin-dist.test.mjs
  ℹ tests 44  ℹ pass 44  ℹ fail 0
  ```
  Also green on the staged artifact: `node --experimental-strip-types packages/quay/scripts/build-plugin-dist.mjs --verify-closure-dir packages/quay/plugin plugin` → `dist-closure gate OK (directory): 115 referenced dist bundles all present`.

## Definition of Done
- [x] AC1-AC5 checked with pasted evidence.
- [x] The fix is proven on a FRESH official-shaped build, not on the ad-hoc scratch copy this finding was discovered through.

## Resolution
Root cause, stated as the single fact both halves share: **the discovery engine is co-located with quay's SOURCE tree and was never part of the plugin's build output** — `docs/analysis/` was not shipped at all, and the engine statically depended on 60 raw `.ts` sources the artifact deletes.

What landed:
1. **The engine's three source-tree dependencies are resolved at RUNTIME** from a two-layout candidate pair (source checkout first, the shipped `scripts/dist/<name>.js` second), each refusing BY NAME when neither exists: the import parser + launcher in `docs/analysis/arch-hypothesis-generation.mjs` (`IMPORT_PARSER_CANDIDATES`, `loadDriverRuntimeDefault`), and the enum-surface checker in `docs/analysis/arch-discovery-space.mjs` (`loadChecker` for scan mode, `loadTreeChecker` for the `--pre`/`--post` experiment's pinned trees). This is what makes the engine a pure-`.mjs` graph.
2. **Each routine exports `<X>_ENGINE_MODULES`** (`OPEN_DISCOVERY_ENGINE_MODULES`, `DISCOVERY_METHOD_ENGINE_MODULES`, `ARCH_DISCOVERY_ENGINE_MODULES`) — the packaging SINGLE SOURCE. `build-plugin-dist.mjs` derives the artifact's engine closure from those arrays and never from a hand list; a routine present without a parsable manifest is refused, not skipped.
3. **`build-plugin-dist.mjs` walks that closure, refuses any non-`.mjs` edge, and copies it + its prompt data verbatim into `<pluginRoot>/docs/analysis/`.** It also reverse-looks-up the `scripts/dist/<name>.js` the engine's own source names (the existing `dist/<name>.js` scan shape), so `import-graph-check.js`, `enum-surface-parity-check.js` and `driver-runtime.js` are bundled as entries. The engine bundle refs are derived the same way, so the engine can never name a bundle the build does not ship.
4. **`arch-discovery-routine.ts` resolves its instruments from the PLUGIN root first, then the workspace** (`resolveInstrument`), and refuses with both tried paths instead of handing `node` a nonexistent file — the same off-repo defect, in the third routine.
5. **The round's pin step is wrapped**: a root that cannot be pinned now returns `not-evaluated` with its own token instead of throwing out of the round.

Also recorded so it is not re-discovered: the two instruments' entry guards are URL-equality (`import.meta.url === pathToFileURL(process.argv[1]).href`), which is (i) why the engine may not be esbuild-bundled and (ii) itself crashes under `node -e` (argv[1] undefined). They ship verbatim, so this does not bite the artifact; it is noted rather than changed, since these files are outside this task's declared Touches.

## Touches
- tasks/gap-discovery-toolchain-depends-on-unshipped-docs-analysis-and-ts-sources-never-works-off-quay-repo.md
- packages/quay/scripts/build-plugin-dist.mjs
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/scripts/discovery-method-routine.ts
- plugin/scripts/arch-discovery-routine.ts
- docs/analysis/arch-hypothesis-generation.mjs
- docs/analysis/arch-discovery-space.mjs
