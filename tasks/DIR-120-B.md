---
id: DIR-120-B
title: "DIR-120 Phase 3b: fix drivable-workspace-check.ts's layering inversion —
  remove DEFAULT_REGISTRY_PATH, require explicit --registry, symlink the
  experiments mirror, fix selftest's silent-skip risk"
status: todo
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-120
children: []
extra:
  dirStatus: applied
  schema: v1
---

**type:** execution

## Proposal

`plugin/scripts/drivable-workspace-check.ts`'s `DEFAULT_REGISTRY_PATH = path.join(__dirname, "..",
"drivable-workspaces.yml")` is a directory-relative guess correct from only one of its two live
locations. From `plugin/scripts/` it resolves to `plugin/drivable-workspaces.yml`, confirmed
absent — the real registry lives only at `experiments/quay-perpetual-stream/
drivable-workspaces.yml`, one directory up from the (currently non-symlinked, byte-identical)
copy at `experiments/quay-perpetual-stream/scripts/drivable-workspace-check.ts`, where the same
relative expression happens to resolve correctly by accident of location, not by design. This is
latent, not actively broken in production, because no real task in this repo's history sets
`extra.drivableWorkspaceArgs` (`grep -rl drivableWorkspaceArgs tasks/` matches only prose).

Fix: remove `DEFAULT_REGISTRY_PATH` entirely (not relocate it — relocating just re-encodes the same
one-fixed-path assumption at the currently-correct answer instead of the currently-wrong one).
`--registry <path>` becomes a required CLI flag; an omitted `--registry` becomes a clean usage
error (exit 2), replacing today's latent `ENOENT`-shaped `DrivableCheckEnvError`. Convert
`experiments/quay-perpetual-stream/scripts/drivable-workspace-check.{ts,sh}` to real symlinks
pointing at the `plugin/scripts/` originals (the same shape `config-wiring-check.ts` already uses,
confirmed real symlink today). Because the constant's removal has two independent, structurally
different downstream consumers, each needs its own fix and its own AC line (DIR-117 mechanism-claim
discipline — folding them into one "stays green" claim would let either half regress unnoticed):

- `experiments/quay-perpetual-stream/scripts/select-preflight.ts` imports `DEFAULT_REGISTRY_PATH`
  but never uses the binding (a dead import, confirmed via grep) — removing the export turns this
  into a **compile-time** `SyntaxError` the instant the module graph loads, breaking every SELECT
  cycle. Fix: delete the dead import.
- `experiments/quay-perpetual-stream/scripts/human-steered-classify.ts`'s `main()` does `let
  registryPath = DEFAULT_REGISTRY_PATH` as a live **runtime** default when `--registry` is omitted
  — removing the export turns this into `undefined`, surfacing only at call time. Fix: require an
  explicit `--registry` before calling `loadRegistry`, matching `drivable-workspace-check.ts`'s own
  new required-flag behavior.

Separately, `drivable-workspace-check.ts`'s own `selftest()` gates its three "real-registry-*"
assertions behind `fs.existsSync(DEFAULT_REGISTRY_PATH)` today — once that constant is removed,
this guard must be re-derived so a run can prove each of the three actually executed (not silently
skipped while an aggregate "all fixture cases PASS" line still reports success over strictly less
real coverage).

Finally, `experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs` — confirmed
**not** covered by `scripts/test.sh`'s glob (`packages/*/test/*.test.mjs plugin/test/*.test.mjs`) —
currently relies on `DEFAULT_REGISTRY_PATH` resolving correctly only because this copy's
`__dirname` happens to sit one directory below the real registry; once it becomes a symlink,
`__dirname` resolves to `plugin/scripts/` and this breaks regardless of the constant's removal. All
of the above (symlink conversion, constant removal, both consumer fixes, this test's own rewrite)
must land in one atomic change and this file must be re-run directly, since no existing canonical
suite run is evidence for it.

`.quay/config.yml`'s `gates.it0` list already registers a real `drivable-workspace` gate entry
(`argsKey: drivableWorkspaceArgs`) — wired, not dead configuration, but never fed by any real task.
This milestone records an explicit sign-off that this chain stays end-to-end-unexercised (no real
task sets `drivableWorkspaceArgs`; manufacturing one solely to poke this path is the same
self-celebratory-fixture pattern this repo's own convention rejects elsewhere), not a silent
omission.

## Plan

N/A — directive resolved via a human-steered milestone. Split from `tasks/DIR-120.md` (DIR-026
SPLIT-OR-COMMIT, 2026-07-28) after 5+ independent, real findings across `prepare-milestone.js`'s
actual ProposalReview rounds all traced to this same sub-area — a self-contained unit of work
(fix one script's layering inversion plus its two downstream consumers plus its own out-of-glob
test), distinct in kind from Phase 2/3a's "delete legacy config files" scope, which DIR-120 itself
keeps.

## Finding

Carried over from `tasks/DIR-120.md`'s own original Finding #4 ("层次倒置: `drivable-workspaces.yml`
实际位于 `experiments/quay-perpetual-stream/` 下，但读它的 `drivable-workspace-check.sh` 是
`plugin/scripts/` 里的产品级 gate") plus real code reads performed during this session's
`prepare-milestone.js` dispatches against DIR-120 (before the Phase 3b split) — see the Proposal
above for the grounded, line-cited detail (all independently re-verified across multiple real
review rounds, not speculation).

## Requested action

1. Remove `DEFAULT_REGISTRY_PATH` (export + computation) from `plugin/scripts/
   drivable-workspace-check.ts`; make `--registry` a required flag; omitted `--registry` → clean
   usage error, exit 2.
2. Convert `experiments/quay-perpetual-stream/scripts/drivable-workspace-check.{ts,sh}` to real
   symlinks pointing at the `plugin/scripts/` originals.
3. Re-derive `selftest()`'s three `real-registry-*` assertions to run unconditionally against the
   real checked-in registry path (a `selftest`-internal constant, never re-exported), each
   individually named/counted so a run can prove each actually executed.
4. `select-preflight.ts`: remove the dead `DEFAULT_REGISTRY_PATH` import. Own tests re-run green as
   independent evidence from item 5.
5. `human-steered-classify.ts`: replace the `DEFAULT_REGISTRY_PATH` runtime default with a
   required-`--registry` check before any `loadRegistry` call. Own tests re-run green as
   independent evidence from item 4.
6. `experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs`: rewrite every
   assertion to pass an explicit `--registry`/injected `Registry` object; run directly (`node
   --test`) with real pasted output, since `scripts/test.sh` does not cover this file.
7. Record an explicit sign-off that `.quay/config.yml`'s `gates.it0` `drivable-workspace` entry
   stays end-to-end-unexercised this milestone (no real task sets `drivableWorkspaceArgs`).
8. Items 1-6 land atomically — any subset alone leaves a different one of the four affected files
   broken by an independent mechanism.

## Acceptance Criteria

- [ ] `drivable-workspaces.yml` stays at `experiments/quay-perpetual-stream/drivable-workspaces.yml`
  (`ls` proof, unmoved); `DEFAULT_REGISTRY_PATH` removed from `drivable-workspace-check.ts`;
  omitting `--registry` gives a clean usage error, exit 2 — real command output pasted, not
  asserted.
- [ ] `experiments/quay-perpetual-stream/scripts/drivable-workspace-check.{ts,sh}` are real
  symlinks to the `plugin/scripts/` originals — `ls -la` proof pasted.
- [ ] `selftest()`'s three "real-registry-*" checks are shown to individually execute and pass
  post-change (each check ID visible in output), not just an aggregate "all fixture cases PASS"
  line that could mask a silently-skipped check.
- [ ] `select-preflight.ts`'s dead `DEFAULT_REGISTRY_PATH` import is removed — its own existing
  tests re-run green, real output pasted, independent of the next item.
- [ ] `human-steered-classify.ts`'s CLI default-registry logic requires an explicit `--registry` —
  its own existing tests re-run green, real output pasted, independent of the item above (a
  structurally different, runtime-class defect from the compile-time import fix — do not combine
  into one checkbox).
- [ ] `experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs` (not covered by
  `scripts/test.sh`'s glob) passes an explicit `--registry` in every assertion and has been run
  directly (`node --test experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs`)
  with real, pasted GREEN output.
- [ ] `.quay/config.yml`'s `gates.it0` `drivable-workspace` entry's continued end-to-end
  non-exercise is explicitly signed off (reason: no real task sets `drivableWorkspaceArgs`;
  manufacturing one to poke this path is rejected) — not a silent omission.
- [ ] `plugin/test/plugin-packaging.test.mjs`'s exp5-label-leak test (which names
  `drivable-workspace-check.ts`/`.sh` as shipped files) is re-run and confirmed unaffected by the
  symlink conversion.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, source code and prose claims alone are necessary but insufficient — real command output
is required for every item above.

- [ ] All items above landed on `master` under human-steered discipline, with real evidence, not
  asserted.
- [ ] A fresh independent audit confirms each real symlink, each independent consumer fix, the
  selftest's per-check visibility, and the out-of-glob test's direct real re-run.

## Human verification when exp5 marks this DIR done

1. Are `experiments/quay-perpetual-stream/scripts/drivable-workspace-check.ts`/`.sh` really
   symlinks now (`ls -la`), not regular files?
2. Does `--selftest`'s output show each of the three "real-registry-*" checks individually, not
   just an aggregate pass line?
3. Were `select-preflight.ts` and `human-steered-classify.ts` fixed and verified independently of
   each other?
4. Is `experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs` actually run
   directly (not just assumed covered by `scripts/test.sh`)?

## Touches

- plugin/scripts/drivable-workspace-check.ts
- plugin/scripts/drivable-workspace-check.sh
- experiments/quay-perpetual-stream/scripts/drivable-workspace-check.ts
- experiments/quay-perpetual-stream/scripts/drivable-workspace-check.sh
- experiments/quay-perpetual-stream/drivable-workspaces.yml
- experiments/quay-perpetual-stream/scripts/select-preflight.ts
- experiments/quay-perpetual-stream/scripts/human-steered-classify.ts
- experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs
- plugin/test/plugin-packaging.test.mjs
