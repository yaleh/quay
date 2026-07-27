# M186 / DIR-120 — iteration-0 adversarial acceptance audit

**Audit session id:** 13efe277-45ff-4563-bcfe-fd2c3db3e2a5

**Task:** `DIR-120` (config-surface crystallization: invariant + Phase 0/1 decided values)
**Charter:** `experiments/quay-perpetual-stream/charters/M186-dir120-config-crystallization-phase0-1.md`
**Build commit under audit:** `949f3c7` ("M186/DIR-120 Phase 0+1: config-wiring-check invariant + land
decided real values + checkHalt fail-closed")
**Stance:** adversarial, refute-first, fresh context (no prior exposure to the build transcript).

## Verdict

**REFUTED**

The Phase 0/1 implementation itself is real, independently re-verified, and solid. The REFUTED verdict
is driven by a disposition-vs-evidence mismatch: the drafted ABSORB entry (`/tmp/m186-absorb-entry.md`)
declares Backlog-row status **DONE**, but `tasks/DIR-120.md`'s own Acceptance Criteria checklist has 3
items that are genuinely, honestly unmet (Phase 2/3, explicitly deferred by the charter) — and the
mechanical `it0-dod-check.sh` HARD-blocks on exactly this (`clause0-ac-dod-present`, non-zero exit,
confirmed both before and after supplying the clause1/clause2 disposition text this audit was asked to
add). Per the audit's own instructions, a non-zero mechanical-gate exit is REFUTED by construction.

A live-command mechanical-gate run is what makes this REFUTED rather than a softer CONCERNS: the AC gap
is not a subjective quality judgment, it is exactly the condition `it0-dod-check.sh` itself is built to
hard-block on.

## 1. AC satisfaction (per `tasks/DIR-120.md` ## Acceptance Criteria)

| # | AC | Verdict | Evidence |
|---|---|---|---|
| 1 | `config-wiring-check` exists, runnable, distinguishes the 3 issue classes; selfcheck ≥80% coverage, passes | **CONFIRMED** (with a CONCERN, see §3) | `bash experiments/quay-perpetual-stream/scripts/config-wiring-selfcheck.sh` → `15 passed, 0 failed` (independently re-run). `node plugin/scripts/config-wiring-check.ts --driver both` independently re-run against the real repo → 7 `NOT_CONSUMED_BY_DRIVER` findings, `routines` OK, matching the claimed post-Phase-1 state. `NODE_V8_COVERAGE` sampled around an independent `--selftest` run → byte-range coverage ≈95.8% (exceeds the 80% floor). |
| 2 | RED evidence pasted before Phase 1 (concurrency/stop/gates/policy FAIL, `gates:[it0-set]` UNRESOLVABLE_VALUE) | **CONFIRMED** | `milestones/M186/iterations/iteration-0.md`'s pasted RED output (8/8 fields FAIL, `gates` carries both `NOT_CONSUMED_BY_DRIVER` and `UNRESOLVABLE_VALUE`) is structurally consistent with an independent live re-run of the post-Phase-1 state (`gates`'s `UNRESOLVABLE_VALUE` now absent; the 7 `NOT_CONSUMED_BY_DRIVER` findings persist unchanged). |
| 3 | Phase 1's 4 decided values landed with diffs (`gates:[acceptance]`, `concurrency:4` + DIR-049 tension note preserved, routines unchanged at `on(checkpoint)`, `execution`/`audit` added) | **CONFIRMED** | `git show 949f3c7 -- .quay/config.yml` and the current file content match the claim exactly. `git diff ece7a2a -- tasks/DIR-120.md` confirms the DIR-049 tension prose predates this milestone's commit (only the frontmatter `acceptance:` key was added by `949f3c7`) — the tension text was not silently dropped. `experiments/quay-perpetual-stream/.quay/loop.yml` confirmed untouched, still `on(checkpoint)`. |
| 4 | Root `.quay/gates.yml`/`.quay/loop.yml` deleted + loader fallback branches removed | **UNMET (by design, Phase 2 deferred)** | `ls .quay/gates.yml .quay/loop.yml` — both still present. `grep -n "gates.yml\|loop.yml" packages/quay/src/gate/config/loader.ts packages/quay/src/loop-params.ts` — fallback branches fully intact. Charter explicitly excludes Phase 2 from this milestone's scope. |
| 5 | exp5 loop config downgraded to profile fragment (RED+GREEN fixtures) | **UNMET (by design, Phase 3 deferred)** | `experiments/quay-perpetual-stream/.quay/loop.yml` unchanged; no schema restriction added. |
| 6 | `checkHalt()` fail-closed | **CONFIRMED** | Independently constructed an EISDIR scenario (`.halt` is a directory) and called `checkHalt()` directly: `{"halt":true,"reason":"FAIL-CLOSED: could not read .halt sentinel at .../.halt: EISDIR: illegal operation on a directory, read"}`. ENOENT scenario (no `.halt` file) unchanged: `{"halt":false,"reason":""}`. |
| 7 | Existing test suite fully green, no gate-engine regression | **CONFIRMED (after isolating a load artifact)** | An independent, un-timeout-wrapped `scripts/test.sh` run reported **529 pass / 5 fail / 3 skip** — 4 MORE failures than the build's claimed 533/1/3. Isolated re-runs of the two implicated files resolved the discrepancy: `node --test packages/quay/test/delivery-standalone-smoke-gate.test.mjs` → 7/7 pass; `node --test packages/quay/test/build-dist-smoke.test.mjs` → 4/4 pass. The 4 extra failures were `acceptance timed out after 60000ms` errors — a concurrent-host-load artifact (this host was running multiple other heavy Claude/Codex sessions during the full-suite run), not a functional regression; confirmed unrelated to any file DIR-120 touched. The 5th failure (`plugin-packaging.test.mjs`'s byte-identical assertion) is confirmed genuinely pre-existing: `diff experiments/.../task-schema.ts plugin/scripts/task-schema.ts` shows real drift introduced by commit `3f28b4e` (M178/DIR-113), already on `master` before this milestone; DIR-120's commit never touches `task-schema.ts`. |
| 8 | `drivable-workspaces.yml` layering fix, file not merged into `config.yml` | **UNMET (by design, Phase 3 deferred)** | `find . -iname drivable-workspaces.yml` → still only at `experiments/quay-perpetual-stream/drivable-workspaces.yml`, read by the product-level `plugin/scripts/drivable-workspace-check.sh` (the inversion Finding #4 describes) — layering not corrected. Not merged into `config.yml` (that half of the AC is trivially true). |

Checkbox write-back applied directly to `tasks/DIR-120.md` (AC 1/2/3/6/7 ticked with inline evidence
citations; AC 4/5/8 left unticked with an explicit "not done, deferred by charter" note).

## 2. DoD satisfaction

| DoD item | Verdict | Evidence |
|---|---|---|
| All changes really committed to `master` | **CONFIRMED** | `git log -1` shows `949f3c7` on `master`; `git status --porcelain` shows a clean tree relative to HEAD (only two pre-existing, unrelated untracked `.halt` files). |
| Phase 0 RED and final GREEN both pasted | **CONFIRMED** | Same evidence as AC2 above. |
| After legacy-file deletion, a real `quay gate` call and a real loop dispatch both work | **N/A this round** | The literal premise ("after deleting legacy files") does not hold — Phase 2 deletion was not attempted this milestone (by charter design). Not evaluable until a follow-on Phase-2 milestone. |
| Milestone executed under `human-steered` discipline (halt/golden-replay/independent audit), no autonomous SELECT | **CONFIRMED (structural)** | `tasks/DIR-120.md` itself carries `label: human-steered`; `human-steered-classify.ts`/`OUTER-LOOP.md`'s `label:human-steered` convention structurally excludes such tasks from autonomous SELECT. This audit itself constitutes the required independent-audit step. |

Checkbox write-back applied to `tasks/DIR-120.md`'s Definition of Done list on the same basis.

## 3. Findings

### Finding 1 (CONCERN) — `config-wiring-check.ts` silently no-ops via its own shipped mirror path

Independently reproduced and root-caused. Invoking the check via the "natural" path that ships alongside
it — `experiments/quay-perpetual-stream/scripts/config-wiring-check.ts` (a symlink to the real
`plugin/scripts/config-wiring-check.ts`, both listed under this task's own `## Touches`) — silently
produces **zero output and exit 0**, regardless of the real repo's actual wiring state:

```
$ node experiments/quay-perpetual-stream/scripts/config-wiring-check.ts --driver both
$ echo $?
0
```

versus invoking the real path:

```
$ node plugin/scripts/config-wiring-check.ts --driver both
config-wiring-check — workspace=... drivers=[bespoke,generic]
...
FAIL: 7 issue(s) across 8 field(s)
$ echo $?
1
```

Root cause: the module's `isDirect` CLI-entrypoint guard is
`process.argv[1] === fileURLToPath(import.meta.url)`. `fileURLToPath(import.meta.url)` always resolves
through the symlink to the real file's absolute path; `process.argv[1]` is never resolved through the
symlink (verified: it stays exactly as typed on the command line). The two can therefore **never** be
equal when the script is invoked via the mirror path — under any combination of relative/absolute
argv — so `main()` never runs and the process falls through to a clean, silent exit 0.

This is honestly disclosed in `milestones/M186/iterations/iteration-0.md`'s own prose ("a direct CLI
invocation through the symlink silently no-ops... mirrors the existing repo convention") and does match
an existing precedent in this repo (`concurrent-batch-scheduler.ts`, always invoked via its
`plugin/scripts/` path by `OUTER-LOOP.md`, never via the mirror). It is not fabricated or hidden. But it
is also **not guarded against** — there is no test asserting that the mirror path fails loudly (or at
least non-silently) rather than silently passing, and Requested Action item 1 explicitly names "接进 CI
或 `.quay/config.yml` 的 gate 集" as an intended next step for this exact tool. If a future gate-wiring
pass adds this check to `.quay/config.yml`'s `gates:` set using the path that already lives under
`experiments/quay-perpetual-stream/scripts/` (the natural choice for an exp5-authored gate), it would
silently, permanently report "0 issues" regardless of the real config state — the exact
"authoritative-looking-but-dead" failure shape `gap-halt-sentinel-path-mismatch` demonstrated and that
DIR-120 exists to eliminate. Recommended follow-up: either make the mirror symlink re-exec the real file
(so both paths behave identically), or have the CLI entrypoint check fail loudly (non-zero exit + stderr
message) whenever it detects it was loaded as a module but never reached `main()` via any recognized
path, rather than silently doing nothing.

### Finding 2 (root cause of REFUTED) — ABSORB entry's `DONE` disposition is not supported by the task's own AC/DoD

`/tmp/m186-absorb-entry.md`'s Backlog row (as drafted, before this audit's required disposition append)
declared:

```
| DIR-120 | Phase 0/1 of config-surface crystallization: ... | DONE | - | directive, human-steered, surface:method-infra |
```

`tasks/DIR-120.md` is still `status: todo` on `master`, and its own AC/DoD checklist requires Phase 2/3
work (root file deletion, profile-fragment schema, `drivable-workspaces.yml` layering) that this
milestone's charter explicitly, correctly deferred. `iteration-0.md` itself is transparent about this
deferral. But nothing in the ABSORB-entry draft reconciles "Phase 2/3 knowingly not attempted" with
declaring the row `DONE` — and the mechanical gate's own `clause0-ac-dod-present` is designed to hard-block
exactly this combination (a `done`-shaped disposition over an incompletely-checked AC list), routing a
genuinely partial milestone through `clause9-split-or-commit`'s `needs-human` path instead. Confirmed live:

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-120 \
    experiments/quay-perpetual-stream/charters/M186-dir120-config-crystallization-phase0-1.md \
    /tmp/m186-absorb-entry.md
...
FAIL: clause0-ac-dod-present: checklist-form AC has 3 unchecked item(s) remaining (REFUTED-equivalent, HARD-blocks exactly as an unmet criterion does): ...
FAIL: DoD check failed — 1 clause violation(s) found (see above).
EXIT=1
```

(Run after this audit's own required clause1/clause2 disposition append — those two clauses now PASS;
clause0 is the sole remaining, structural failure.) Recommended resolution: either change the ABSORB
entry's Backlog-row status to `needs-human` (partial landing, follow-on milestone required for Phase
2/3) rather than `DONE`, or split DIR-120 into a Phase-0/1-scoped sub-task whose own AC matches exactly
what this milestone delivered.

## 4. Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-120 \
    experiments/quay-perpetual-stream/charters/M186-dir120-config-crystallization-phase0-1.md \
    /tmp/m186-absorb-entry.md
EXIT=1
```

Non-zero exit → REFUTED by construction, per this audit's own charge. (First run, before this audit's
disposition append, additionally failed clause1/clause2 for missing disposition text; those two now pass
after the append documented in §5 below — clause0 alone remains, and is not fixable by disposition text,
only by either completing Phase 2/3 or correcting the declared disposition.)

## 5. Disposition append (gap-absorb-entry-clause-disposition-sequencing / M180 convention)

Appended to `/tmp/m186-absorb-entry.md`, in this order, after reaching the verdict above:

1. `adversarial-audit disposition: REFUTED` line with the reasoning above.
2. `V_meta consolidation-lag:` line with the verbatim tail of a real
   `bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 186
   experiments/quay-perpetual-stream/v-meta-ledger.md` run (exit 0, `PASS: no confirmed-unconsolidated
   row past K without a dated carry-forward`).

## 6. Deviation-log write-back (dashboard.md, DIR-017 Step 3 table)

Two rows appended to the "Deviation rows" table:
- `REFUTED | machine | M186` — this audit's own finding (the DONE-vs-AC mismatch + the
  config-wiring-check mirror-path silent no-op), full text in the table.
- `CONCERNS | human | M186` — transcribing (not originating) `iteration-0.md`'s own disclosure that
  Phase 2/3 was deliberately left out of scope this round.

## 7. Supporting environment checks (context, not part of the AC/DoD grading)

- `tree-hygiene-check.sh` → clean.
- `worktree-branch-hygiene-check.sh` → clean.
- `it0-ceiling-line-budget-check.sh` against the charter → PASS.
- `touches-orthogonality-check.ts` M186 vs M187 charters → DISJOINT (confirms the concurrent-dispatch
  claim in both charters' "Concurrency note" sections).
- A root-level `.halt` sentinel (untracked, 0 bytes, mtime 2026-07-27 05:51) predates this milestone's
  build commit (09:07:52) — noted for completeness; not itself scored as an AC/DoD item, and consistent
  with a human-directed session working during a halt window per DIR-027 hygiene (the task is
  `human-steered` and this very audit is part of that directed activity).
