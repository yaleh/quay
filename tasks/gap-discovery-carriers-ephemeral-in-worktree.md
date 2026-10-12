---
id: gap-discovery-carriers-ephemeral-in-worktree
title: "Discovery Method: ledger/registry/attempt carriers die with the
  worktree; persist to shared checkout atomically, quarantine the invalidly
  promoted method"
status: done
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-method-record-tool-vs-subject-leak
---
## Proposal
The read-only audit found that all Discovery Method runtime state is lost when a worktree is torn down:
- `.quay/discovery-experience-ledger.jsonl`, `.quay/discovery-method-registry.jsonl` and `.quay/discovery-reflection-attempts.jsonl` resolve relative to the CALLER's root.
- Every real run so far happened inside a task worktree, so on 2026-10-12 `ls /data/home/yale/work/quay/.quay/discovery-*` is empty.
- The Phase 2 run had to rebuild the registry because the Phase 0/1 carriers were already gone.
- The only `active` method ever recorded (`method-afe5ac899aa54241`, `shared-contract-divergence` v2) was promoted on invalid evidence (see `gap-discovery-method-generalization-lineage-and-temporal-binding`), and now exists nowhere.

Its absence is accidental, not a decision. Once persistence exists it must be retired explicitly and must not be re-promoted on that evidence.

## Plan
1. **Persistent location.** All three carriers resolve to the SHARED checkout via `resolveSharedCheckout` (`plugin/scripts/per-task-suite-record.ts`, git-common-dir based). This holds whatever the caller's cwd/root, including from a task worktree. An unresolvable shared checkout ⇒ refuse (`SHARED_CHECKOUT_UNRESOLVED`), never fall back to the worktree.
2. **Atomic, idempotent append.**
   - Each record is serialized with a deterministic `id`.
   - The append takes an exclusive lock file and writes one `O_APPEND` line followed by an fsync.
   - A record whose `id` already exists is skipped and reported (`DUPLICATE_ID`), not appended twice.
3. **Recovery.**
   - Readers report a torn or unparseable trailing line as `malformed_lines: N`; a malformed carrier is never shown as empty or clean.
   - A `repairCarrier(root, name)` function backs up the file, truncates ONLY a torn final line, and reports what it removed.
4. **Quarantine.**
   - Append a `status:"retired"` record for `shared-contract-divergence`. Its `retirement_reason` cites the invalid promotion: lineage leak (held-out was the v1 seed) and temporal mismatch (graded post-fix code against a pre-fix label).
   - `activeMethods(root)` returns only methods whose latest version is `active`.
   - Any transition to `active` must carry a `generalization_evidence` ref to a recorded `validateGeneralization` verdict that passed the lineage and temporal checks. Without it ⇒ `PROMOTION_WITHOUT_VALID_GENERALIZATION`.
5. Carriers stay gitignored. Declare them in `docs/carrier-registry.json` only if that registry covers `docs/analysis` producers; check, and state the result.

## Acceptance Criteria
- [x] `node --test plugin/test/discovery-experience-ledger.test.mjs plugin/test/discovery-method-registry.test.mjs plugin/test/discovery-reflection.test.mjs` exits 0, with new cases:
  - (a) writing from a fixture git worktree lands in the fixture's MAIN checkout `.quay/`;
  - (b) an unresolvable shared checkout ⇒ refusal, no file written;
  - (c) re-appending the same record ⇒ `DUPLICATE_ID`, the file is byte-identical;
  - (d) a carrier with a torn last line reads as `malformed_lines: 1` and `repairCarrier` restores a parseable file with a backup;
  - (e) two concurrent appenders produce two whole lines, never an interleaved one;
  - (f) promotion to `active` without valid `generalization_evidence` ⇒ refused.
- [x] Real: from inside this task's worktree, append one Experience and one method record. Then show they exist under `/data/home/yale/work/quay/.quay/` (paste `ls -la` and the lines), and do NOT exist under the worktree's `.quay/`.
- [x] Quarantine, real: write the retirement record for `shared-contract-divergence` to the persistent registry. Paste it. Paste `activeMethods()` output showing it absent. Paste an attempted re-promotion citing the old evidence being refused.
- [x] Mutation control: make the resolver fall back to the caller's root and show case (a) goes red. Paste, then revert.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-carriers-ephemeral-in-worktree` green.

## Touches
- tasks/gap-discovery-carriers-ephemeral-in-worktree.md
- docs/analysis/discovery-experience-ledger.mjs
- docs/analysis/discovery-method-registry.mjs
- docs/analysis/discovery-reflection.mjs
- plugin/test/discovery-experience-ledger.test.mjs
- plugin/test/discovery-method-registry.test.mjs
- plugin/test/discovery-reflection.test.mjs

## Evidence

### AC1 — the three test files, exit 0 (81 tests, 0 fail)

```
$ node --test plugin/test/discovery-experience-ledger.test.mjs plugin/test/discovery-method-registry.test.mjs plugin/test/discovery-reflection.test.mjs
ℹ tests 81
ℹ pass 81
ℹ fail 0
EXIT=0
```

The new cases are `AC2(a)`–`AC2(e)` in `discovery-experience-ledger.test.mjs`, `AC2(f)`/`AC3` in
`discovery-method-registry.test.mjs`, and `AC2(a)`/`AC2(f)` in `discovery-reflection.test.mjs`.
`AC2(a)` in the ledger file also PINS the duplicated resolver against the canonical one: it imports
`resolveSharedCheckout` from `plugin/scripts/per-task-suite-record.ts` and asserts both name the same
directory for the same fixture. (The copy is deliberate — `docs/analysis/*.mjs` is loaded by plain
`node`, and a `.ts` specifier needs type-stripping it does not do; the equivalence is an executable
invariant instead of a promise.)

### AC2 — real: written from INSIDE this task's worktree, they land in the shared checkout

```
caller root (the task worktree): /data/home/yale/work/quay-worktrees/gap-discovery-carriers-ephemeral-in-worktree
resolved shared checkout:       /data/home/yale/work/quay
cwd:                            /data/home/yale/work/quay-worktrees/gap-discovery-carriers-ephemeral-in-worktree

appendExperienceRecord -> {"ok":true,"id":"experience-5e20efdfaaf99116","file":"/data/home/yale/work/quay/.quay/discovery-experience-ledger.jsonl"}
appendMethodRecord     -> {"ok":true,"id":"method-28c9704c88309949","file":"/data/home/yale/work/quay/.quay/discovery-method-registry.jsonl"}

--- read back THROUGH the worktree root ---
readExperienceLedger(WT).records: 1 file: /data/home/yale/work/quay/.quay/discovery-experience-ledger.jsonl
readMethodRegistry(WT).latest:    carrier-persistence-check file: /data/home/yale/work/quay/.quay/discovery-method-registry.jsonl

--- does the WORKTREE have its own carriers? ---
.quay/discovery-experience-ledger.jsonl under the worktree exists? false
.quay/discovery-method-registry.jsonl under the worktree exists? false
```

```
$ ls -la /data/home/yale/work/quay/.quay/discovery-*
-rw-rw-r-- 1 yale yale 570 Oct 12 15:39 /data/home/yale/work/quay/.quay/discovery-experience-ledger.jsonl
-rw-rw-r-- 1 yale yale 881 Oct 12 15:39 /data/home/yale/work/quay/.quay/discovery-method-registry.jsonl

$ ls -la <worktree>/.quay/discovery-*
ls: cannot access '.../gap-discovery-carriers-ephemeral-in-worktree/.quay/discovery-*': No such file or directory
```

The lines (verbatim from the shared checkout):

```
{"kind":"experience","id":"experience-5e20efdfaaf99116","case_id":"EXP-carriers-ephemeral-in-worktree","ts":"2026-10-12T00:00:00.000Z","role":"found-and-fixed","reported_by":"user","source_ref":null,"evidence":[{"ref":"tasks/gap-discovery-carriers-ephemeral-in-worktree.md","sha256":"d239d4e75069ad24effcc81da4fe8408ef212e5bf161a66318c66b0b9cb3ee97"}],"components":["docs/analysis/discovery-method-registry.mjs"],"summary":"every Discovery Method carrier resolved against the caller's root, so every run inside a task worktree lost its whole runtime state on teardown"}
{"kind":"method","id":"method-28c9704c88309949","method_id":"carrier-persistence-check","version":1,"ts":"2026-10-12T00:00:00.000Z","provenance_evidence":["experience-5e20efdfaaf99116"],"applicability":{"domain_signals":["runtime state written relative to the caller's root instead of a shared location"],"preconditions":["the writer runs from a linked checkout that is later removed"]},"operation":{"steps":["ask git for the common dir","write under its parent","refuse when it cannot be resolved"],"tools":["import-graph-check.ts"]},"expected_invariant":"a record written from any checkout is readable from every other checkout and survives teardown","falsification":"the resolved location differs between two checkouts of the same repository","cost_budget":{"max_candidates":1,"max_model_calls":0,"max_wall_ms":1000},"status":"draft","retirement_reason":null,"supersedes":null}
```

**Post-gate re-reading (the same claim, after the scoped gate ran).** `scripts/test.sh` runs
`refresh-worktree-quay.sh`, which bulk-copies main's `.quay/` INTO the worktree — so "not present in the
worktree" is a statement about a MIRROR that can be re-created at any time. The reading that cannot be
confounded is that a write ISSUED from the worktree moves the shared copy and leaves the worktree's
alone; measured immediately after the gate:

```
AFTER the scoped gate (which mirrors main/.quay -> worktree/.quay):
  main     : exists=true lines=1 bytes=570
  worktree : exists=false lines=0 bytes=-1   <- not even the mirror brought them over
append from the worktree -> ok=true file=/data/home/yale/work/quay/.quay/discovery-experience-ledger.jsonl
  main     : lines=2 bytes=1117   <- GREW
  worktree : lines=0 bytes=-1   <- UNCHANGED
reads resolve to: /data/home/yale/work/quay/.quay/discovery-experience-ledger.jsonl
records visible from the worktree: 2
```

### AC3 — real quarantine: retirement written, `activeMethods()` shows it absent, re-promotion refused

```
=== 1. the recorded verdict for the evidence the ORIGINAL promotion was based on ===
recorded: {"ok":true,"id":"generalization_verdict-9015f19c07ec161c"}

=== 3. THE QUARANTINE: the retirement record, appended to the persistent registry ===
append: {"ok":true,"id":"method-cce03a8020968adb","appended":true}
ON DISK: {
 "kind": "method", "id": "method-cce03a8020968adb", "method_id": "shared-contract-divergence",
 "ts": "2026-10-12T00:00:00.000Z", "provenance_evidence": ["outcome-bb12a6858838e74b"],
 "operation": { "steps": ["extract each declaration's field names","diff the two extracted sets"],
                "tools": ["ac56-recommended-deordered-check.ts"] },
 "retirement_reason": "promoted on INVALID evidence (verdict generalization_verdict-9015f19c07ec161c): LINEAGE LEAK — the held-out case was the v1 seed (the same evidence-store record the method was fitted on), and TEMPORAL MISMATCH — the verifier read post-fix code while the case's label is pre-fix. Retired; it must not be re-promoted on this evidence.",
 "version": 2, "status": "retired" }

=== 4. activeMethods() — the quarantined method is ABSENT ===
{ "ok": true, "methods": [], "evaluated": 2, "malformed_lines": 0,
  "file": "/data/home/yale/work/quay/.quay/discovery-method-registry.jsonl" }

=== 5. attempted RE-PROMOTION citing that same old evidence ===
{ "ok": false, "appended": false, "reasons": [
  "PROMOTION_WITHOUT_VALID_GENERALIZATION:VERDICT_NOT_PASSED:generalization_verdict-9015f19c07ec161c-recorded-outcome=not-evaluated-correct=null-refusal_code=HELD_OUT_SHARES_LINEAGE-lineage_ok=false-temporal_ok=false" ] }

=== 6. …and a re-promotion citing NO evidence at all ===
[ "PROMOTION_WITHOUT_VALID_GENERALIZATION:EVIDENCE_MISSING:status=active-must-carry-generalization_evidence.verdict_ref-naming-a-recorded-validateGeneralization-verdict" ]

=== 7. after the two refusals ===
history length: 3
activeMethods().methods: []
```

### AC4 — mutation control: the resolver falls back to the caller's root ⇒ case (a) goes RED, then reverted

Mutation (temporary, one line — `carrierFile` returning `path.join(root, rel)`, i.e. the pre-fix
behaviour):

```
✖ AC2(a): a write from a linked git worktree lands in the fixture's MAIN checkout, not the worktree
  AssertionError [ERR_ASSERTION]: …and the path accessor resolves there too, from the worktree
  + actual - expected
  + '/tmp/discovery-experience-ledger-dJZD9u/wt/.quay/discovery-experience-ledger.jsonl'
  - '/tmp/discovery-experience-ledger-ev8Xrb/.quay/discovery-experience-ledger.jsonl'
ℹ tests 1  ℹ pass 0  ℹ fail 1
```

Reverted by `cp` from a backup taken outside the repo, then the SAME case:

```
md5 after revert: 52d42606e9bb8dcc42040ee3e602e5b4  (HEAD copy: 52d42606e9bb8dcc42040ee3e602e5b4)
$ git diff --stat -- docs/analysis/discovery-experience-ledger.mjs     # (no output — byte-identical)
✔ AC2(a): a write from a linked git worktree lands in the fixture's MAIN checkout, not the worktree
ℹ tests 1  ℹ pass 1  ℹ fail 0
EXIT=0
```

### DoD — scoped gate

```
$ bash scripts/test.sh --for-task gap-discovery-carriers-ephemeral-in-worktree --allow-thin
... scoped static checks: all PASS / NOT-EVALUATED ...
ℹ tests 81  ℹ pass 81  ℹ fail 0
EXIT=0
```

### Plan item 5 — checked, and the result stated

- `docs/carrier-registry.json`: **NOT** the place. Its completeness/staleness contract
  (`plugin/test/carrier-registry-completeness.test.mjs`) has the corpus `packages/*/src/**/*.ts` +
  `plugin/scripts/**/*.ts` only, so a `docs/analysis/` producer is outside it and an entry would red
  the staleness arm. No entry added (same answer the evidence store's carrier gets).
- **"Carriers stay gitignored" does NOT hold today** — measured: `git check-ignore
  .quay/discovery-experience-ledger.jsonl` (and the other three) exits 1. quay's `.gitignore` uses
  per-file lines and carries no single wildcard over `.quay`. `.gitignore` is outside this task's
  declared `## Touches`, so the lines are REPORTED rather than added silently; the follow-up is one
  per-carrier `**/.quay/discovery-*.jsonl` entry (or one wildcard) for the four carriers.
