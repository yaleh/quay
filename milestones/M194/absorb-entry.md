## M194 ABSORB entry

**Milestone id:** M194
**Task:** DIR-120-B (DIR-120 Phase 3b)
**Charter:** experiments/quay-perpetual-stream/charters/M194-dir120b-drivable-workspace-check-fix.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| DIR-120-B | DIR-120 Phase 3b: fix drivable-workspace-check.ts's layering inversion (remove DEFAULT_REGISTRY_PATH, require --registry, symlink experiments mirror, fix selftest silent-skip risk) | TBD | - | directive, human-steered, surface:method-infra |

## Adversarial audit disposition (M194)

adversarial-audit disposition: NO REFUTATION FOUND — all 8 Acceptance Criteria and both Definition
of Done items independently re-verified via real command output (registry unmoved, DEFAULT_REGISTRY_PATH
absent, exit-2 usage error, symlinks confirmed via `ls -la`, selftest per-check visibility, both
consumer tests green, out-of-glob test run directly green, plugin-packaging leak test green).

V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated carry-forward

## ABSORB gate run (M194, post-audit)

Ran the standard ABSORB gate set. 4 of 5 gates PASS; 1 HARD BLOCK on DIR-120-B itself.

| Gate | Result | Detail |
|---|---|---|
| vmeta-lag-check | PASS | `experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 191 experiments/quay-perpetual-stream/v-meta-ledger.md` (counter=192 from dashboard.md line 4, minus 1 = 191). Exit 0 — no confirmed-unconsolidated row past K(=2) without a dated carry-forward. Both ledger rows evaluated ok (one "consolidated" — lag gate N/A; one "proposed" — not past phi threshold, no lag gate). No ALARM, no HARD BLOCK. |
| dashboard line-budget | PASS | `/home/yale/work/quay/experiments/quay-perpetual-stream/dashboard.md` — 728 lines (cap 1200). Exit 0. Within budget, no hard block. |
| tree-hygiene-check | PASS | `/home/yale/work/quay/plugin/scripts/tree-hygiene-check.sh` from repo root. Output: "tree-hygiene: clean — no un-gitignored scratch left in the main tree." Exit 0. No hard block. |
| worktree-branch-hygiene-check | PASS | `/home/yale/work/quay/plugin/scripts/worktree-branch-hygiene-check.sh` from repo root. Exit 0. Output: "worktree-branch-hygiene: clean — no orphaned milestone evidence in un-merged iteration branches." plus info line: prunable merged iteration branches=0; registered iteration worktrees=0. No HARD BLOCK — clean. |
| split-or-commit | **HARD BLOCK (exit 1)** | See below. |

### split-or-commit gate — HARD BLOCK detail

Command run: `node packages/quay/bin/quay.ts gate DIR-120-B --gate split-or-commit` (equivalent to
`quay gate --gate split-or-commit DIR-120-B`; `packages/quay/bin/quay.js` does not exist in this
checkout — the CLI entrypoint is the TS source `packages/quay/bin/quay.ts`, run directly since
Node 26.5 supports type-stripping).

CLI output: `FAIL — acceptance failed (exit 1)` (generic wrapper message — the `split-or-commit`
gate is wired in `.quay/config.yml` under `gates.testPass` as a fixed workspace-wide command
`node plugin/scripts/it0-split-or-commit-check.ts .`, whose real per-check verdict is not
templated with the task id and gets surfaced through the generic acceptance-runner reason string).

Underlying real violation (from running `node plugin/scripts/it0-split-or-commit-check.ts .`
directly for the actual detail):

```
FAIL: 1 split-or-commit violation(s) found:
  - PARENT-DONE-IFF-CHILDREN: task "DIR-120" is done but has 1 non-done child(ren): DIR-120-B (status: todo) — a done parent requires ALL children done (DIR-026)
```

Confirmed directly against the task files: `tasks/DIR-120.md` has `status: done`,
`tasks/DIR-120-B.md` had `status: todo`, and DIR-120-B is listed under DIR-120's `children:`. This
is the PARENT-DONE-IFF-CHILDREN branch of DIR-026 SPLIT-OR-COMMIT (parent marked done while a
child is still open) — not a SELECT-split, child-link-symmetry, or needs-human-reason violation.
No `.quay/gate-events.jsonl` append check was needed beyond the CLI's own run (the CLI appends one
GateEvent per invocation as usual).

**Disposition:** DIR-120-B set to `status: needs-human` (via `quay task edit DIR-120-B --status
needs-human`) rather than forced to `done` or `todo` without human input — the underlying tension
(DIR-120 marked done at Phase 1 landing while Phase 3b work items, including this one, remained
open as separate child tasks) needs a human call on whether DIR-120 itself should be reopened,
whether DIR-120-B should be de-parented, or whether DIR-120-B should simply be completed next, not
a mechanical fix from this ABSORB pass. `needs-human` is a legal terminal status in
`packages/quay/src/gate/lifecycle.ts`'s state machine and unblocks nothing else in this milestone's
touches — it is recorded here as the accountable resolution of the HARD BLOCK, not as a bypass of
it.
