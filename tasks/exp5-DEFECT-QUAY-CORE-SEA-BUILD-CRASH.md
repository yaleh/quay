---
id: exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH
title: "defect: quay Core SEA binary crashes at startup (gate/registry.ts
  import.meta.url incompatible with CJS bundle) — DIR-004 Distribution urgent"
status: done
labels:
  - milestone-candidate
  - defect
  - milestone:M-121
parent: null
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH
    experiments/quay-perpetual-stream/charters/M121-sea-build-crash-fix.md
    /tmp/m121-absorb-entry.md
---
## Proposal

Found while testing the SEA (Single Executable Application) build path at M116 (a due-diligence check
while migrating `packages/quay/bin/quay.js` → `.ts` — not part of that task's own scope, but
discovered by actually running `build-sea.sh` rather than assuming it still worked): **quay Core's SEA
binary crashes on startup** for any command that reaches the gate subsystem (confirmed via `--version`,
which touches `gate/engine.ts` → `gate/registry.ts` at module-init time):

```
$ ./packages/quay/dist-sea/quay --version
TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string or an instance of URL. Received undefined
    at fileURLToPath (node:internal/url:1611:11)
    at src/gate/registry.ts (.../quay-bundle.cjs:40094:85)
```

**Root cause:** `packages/quay/src/gate/registry.ts` line 21:
```ts
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```
`esbuild-sea.mjs` bundles quay Core to `format: "cjs"` (Node SEA does not support ESM main modules —
see that script's own header comment). In a CJS bundle, `import.meta.url` is `undefined` (esbuild
itself warns about this during the build: *"You need to set the output format to 'esm' for
'import.meta' to work correctly"* — a warning that's been silently ignored, presumably because nobody
has run the SEA build since `gate/registry.ts` was TS-migrated at M84, `13c1ee3`). `__dirname` is used
to compute `REPO_ROOT` (line 25: `path.resolve(__dirname, "..", "..", "..", "..")`), which the gate
subsystem likely uses to resolve gate-script paths.

**Confirmed pre-existing, not introduced by M116:** `git log -- packages/quay/src/gate/registry.ts`
shows this file untouched by M116's own changes (bin-entrypoint rename only); the last touch was M84
(TS migration) then an M93 refactor (`8c7ba6f`). This SEA-incompatibility has evidently been present
and unexercised since M84 — the quay-native SEA build (a SEPARATE binary, no gate subsystem dependency)
was verified working at M116 (manifest shim redirect confirmed live-tested), but quay Core's has been
silently broken for ~30 milestones.

**Why this matters (DIR-004 urgency):** `docs/proposals/quay-proposal.md` / OUTER-LOOP.md both flag
DIR-004 Distribution as URGENT. A broken Core SEA binary is a real gap in that goal, not a cosmetic one
— the entire point of the SEA build is a portable, no-Node-runtime-needed executable, and it currently
cannot run past module-init for any gate-touching command (i.e., almost the entire CLI surface, since
`registry.ts` is a load-bearing import for most `quay` subcommands).

**Deeper structural note — RESOLVED at M121 (see Plan below):** the fear that `REPO_ROOT`-relative
gate-script path resolution is fundamentally SEA-incompatible turned out to be based on an incorrect
assumption. `grep -n REPO_ROOT packages/quay/src/gate/registry.ts` shows `REPO_ROOT` is used ONLY to
compute `DOCUMENTS_DIR = REPO_ROOT/docs-managed` for the product-owned D1 `doc-*` gates — NOT for the
research/experiment gate scripts (those resolve via `.quay/gates.yml`'s own
`discoverWorkspaceRoot`/`loadWorkspaceGates` path in `factories/loader.ts`, untouched by this bug).

## Plan
N/A — resolved directly (`experiments/quay-perpetual-stream/charters/M121-sea-build-crash-fix.md`), a
mechanical, single-file fix once the structural question above was actually investigated (no design
decision needed): make `registry.ts`'s `__dirname` computation dual-mode safe (prefer the real CJS
`__dirname` binding present in the SEA/esbuild-CJS bundle context, fall back to
`fileURLToPath(import.meta.url)` otherwise) — mirrors the existing `src/version.ts` /
`scripts/version-sea-shim.js` dual-mode precedent (M01-dist). The D1 doc-gate's `docs-managed/`
dependency degrades to a graceful FAIL (not a crash) when unavailable — real evidence:
`./dist-sea/quay gate DIR-038 --gate doc-quay-directive-skill` → `FAIL — no such document: DOC-001`,
exit 1, no crash. This is the AC2 resolution: documented graceful-degrade, not a silent gap.

## Acceptance Criteria
- [x] `./packages/quay/dist-sea/quay --version` (and other gate-touching commands) run without crashing. — Independently re-verified by the M121 adversarial audit (fresh build via `build-sea.sh`, then `./dist-sea/quay --version` → `0.3.9` exit 0, `task list` exit 0, `gate DIR-038` → clean FAIL exit 1, no crash). See `milestones/M121/audits/iteration-0-adversarial-audit.md`.
- [x] The REPO_ROOT-relative gate-path SEA-compatibility question (structural note above) is explicitly resolved one way or another (embed / disable-in-SEA / other), not left as a silent gap. — Independently re-verified: `grep -n REPO_ROOT packages/quay/src/gate/registry.ts` shows exactly one use site (`DOCUMENTS_DIR` at line 75), no other file under `packages/quay/src/gate/` references `REPO_ROOT`; `./dist-sea/quay gate DIR-038 --gate doc-quay-directive-skill` → `FAIL — no such document: DOC-001`, exit 1 (graceful, not a crash). See audit report.
- [x] `bash packages/quay/scripts/build-sea.sh && ./packages/quay/dist-sea/quay --version` (and a `task list`/`gate` smoke command) pasted as real evidence, not asserted. — Independently re-run by the audit from a fresh worktree checkout; matches the milestone's own pasted transcript. See audit report.

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [x] All 3 AC items above verified true with pasted command output. — see AC ticks above; independently re-confirmed with real command output by the M121 adversarial audit, not merely re-asserted.
- [x] it0 DoD meta-enforcer passes all clauses. — Follow-up re-audit pass (same audit session, after the orchestrator wrote the real ABSORB entry to `/tmp/m121-absorb-entry.md`, corrected the charter's Done-when-3 wording, fixed this task's `## Plan` to the required `N/A — ` form, and logged `DEV-12` in `inherited-core.md`): the audit synced those orchestrator-side edits into its own isolated worktree and independently re-ran `it0-dod-check.sh` and `quay gate` itself — both PASS, exit 0, with a real distinct GateEvent (timestamp 2026-07-23T09:57:21.644Z, alongside the orchestrator's own 09:54:31.391Z run). See audit report for full detail.

## Not selected (M119)

Not selected M119 — exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH selected instead: smaller, cleanly
bounded (one-line regex fix), no open design question. This task is real and DIR-004-urgent, but its
own Plan explicitly admits it "needs investigation" into an unresolved structural question (SEA
gate-path compatibility) — per the sizing gauge (inherited-core.md, "does the proposed scope let
iteration-0 land ALL Done-when in one pass"), this is NOT yet cleanly sized for one milestone.
Recommend a future SELECT either (a) time-box a short investigation-only pass first to resolve the
structural question and re-scope the AC/DoD accordingly, or (b) apply DIR-026 split-or-commit to
separate "fix the import.meta.url crash" (mechanical, bounded) from "resolve gate-path SEA-compat"
(design decision, may itself need its own milestone) before dispatch. Good next high-priority pick
once sized.

## Selected (M121)

Selected — direct exploit pick. M119's own recommendation option (a) applied: a short investigation
(this milestone's own iteration-0) resolved the structural question in-pass (REPO_ROOT is scoped to
the product-owned `docs-managed/` D1 doc-gate only, not the research gate scripts the task's authoring
had feared) — no split needed, single-file mechanical fix. This is also the explicit next step DIR-064-B
named for demonstrating a real chart-2 Δv (S1 Distribution-reliability cov flip 0.20→0.80 on the SEA
rows). See `experiments/quay-perpetual-stream/charters/M121-sea-build-crash-fix.md`.

## Execution record (M121 ABSORB, 2026-07-23)

**Milestone:** M121 · **Iterations:** 1 (single-pass development-class fix) · **Realized chart-2 Δv:**
+6.0 (S1 cov 0.20→0.40, weight 30) — not the full +18.0/0.80 originally predicted; residual tracked by
`exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY` (filed this milestone). **Merge commits:** `3bab1a4`
(crash fix), `6216596` (chart-2 Δv registration). **Adversarial-audit verdict:** CONCERNS (non-blocking
— see `milestones/M121/audits/iteration-0-adversarial-audit.md`; logged as `DEV-12` in
`inherited-core.md`, status `verified-eliminated`, corrected same-ABSORB). **DoD meta-enforcer:** PASS
(`quay gate exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH`, GateEvent `2026-07-23T09:54:31.391Z` orchestrator +
`2026-07-23T09:57:21.644Z` independent audit re-run, both PASS). **Real release evidence:** v0.3.9,
https://github.com/yaleh/quay/actions/runs/29995456654 — `sea-verify-node-free` green (was the failing
job pre-fix on run 29981401108). One-line outcome: quay Core's SEA binary crash (DIR-004-urgent,
silently broken ~30 milestones) is fixed and independently re-verified; the charter's own quantified
chart-2 prediction was only 1/3 met, honestly caught by the mandatory audit and corrected same-ABSORB
rather than silently accepted.