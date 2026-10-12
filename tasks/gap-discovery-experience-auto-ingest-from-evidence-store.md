---
id: gap-discovery-experience-auto-ingest-from-evidence-store
title: "Discovery Method: no automatic Experience ingestion; watermarked,
  quota-bounded, killable ingester from evidence-store outcomes via one unified
  entry"
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-carriers-ephemeral-in-worktree
---
## Proposal
The read-only audit found that no Experience is ever ingested automatically. `ingestFromEvidenceStoreOutcome` (`docs/analysis/discovery-experience-ledger.mjs`) has no caller outside its test. In the only real run, the 5 system-sourced entries were chosen by a worker, and their `role`/`components`/`summary` were hand-written — and the summaries stated the answer ("paired with two divergent keys", "REQUIRED_FIELDS declared twice"), which then went verbatim into the reflection prompt.

The user's requirement is that every system-produced Finding enters through the SAME controlled entry as user feedback: one function, two sources. It must not require a human to pick records or describe them.

## Plan
1. **Unified entry.** `ingestExperience(root, { source: "system" | "user", ... })`. `ingestFeedback` and the evidence-store adapter become thin callers of it. One validator, one dedup, one carrier.
2. **Automatic batch ingester.** `ingestNewOutcomes(root, { maxPerRun, enabled })` scans `.quay/architecture-evidence-store.jsonl` for `kind:"outcome"` records past a persisted watermark: `{ line, line_sha256 }` in the shared-checkout `.quay/discovery-ingest-watermark.json`, written atomically.
   - **Derived fields.** The ingester derives everything from the record itself; nothing is caller-written.
     - `role` comes from `verdict`: supported → `found-unresolved`; refuted → `confirmed-negative`; undetermined → `undetermined`. Add `found-unresolved` and `undetermined` to the role vocabulary. `found-and-fixed` / `recurred-after-fix` only when the record names a task id whose develop status is `done` (and, for recurrence, a later outcome on the same `subject_key`).
     - `components` come from `subject_key`.
     - `summary` is the record's own `experiment_ref`/statement text, truncated.
   - **Pin.** `evaluation_pin` comes from the record's experiment pre-registration when resolvable (`prereg` path → `pin`); otherwise `null`, and `validateGeneralization` will refuse to use that Experience as a held-out.
3. **Controls.**
   - `maxPerRun` quota, with the remainder reported.
   - `enabled:false` ⇒ zero reads and zero writes (kill switch).
   - Dedup by `source_ref`.
4. **Fail-closed.**
   - Unreadable store ⇒ refuse.
   - The watermark line's sha256 no longer matches (store rewritten or truncated) ⇒ refuse with `WATERMARK_MISMATCH`. Never silently restart from line 0.
   - A malformed outcome line is counted and skipped, and the watermark does not advance past an unparsed line.
5. No model calls in ingestion.

## Acceptance Criteria
- [x] `node --test plugin/test/discovery-experience-ledger.test.mjs` exits 0, with new cases:
  - (a) a fixture store with 3 outcomes ⇒ 3 Experiences, watermark at the last line;
  - (b) a second run ⇒ 0 ingested;
  - (c) `maxPerRun:2` ⇒ 2 ingested, the remainder reported, the next run ingests the rest;
  - (d) `enabled:false` ⇒ zero file writes;
  - (e) a rewritten store (watermark sha mismatch) ⇒ `WATERMARK_MISMATCH`, nothing written;
  - (f) `summary`/`components` equal the values derived from the record, and a caller-supplied summary is rejected for `source:"system"`;
  - (g) a user-sourced Experience goes through the same `ingestExperience` and lands in the same carrier.
- [x] Real run against the real evidence store, in the persistent shared-checkout location (requires `gap-discovery-carriers-ephemeral-in-worktree`). Paste:
  - the outcome count scanned, Experiences ingested, duplicates skipped, and the watermark;
  - the derived records for the fan-in lock (`E-DT-1-Hp cluster 11`), REQUIRED_FIELDS (`E-HYPGEN-AB-1-B cluster 8`), C5 (`E-HYPGEN-ACCEPT-1 cluster 5`) and C7 (`E-HYPGEN-ACCEPT-1 cluster 7`, which must be `confirmed-negative`) outcomes;
  - a second run showing 0 new.
- [x] Negative control: copy the store, delete its first line, point the ingester at the copy with the real watermark, and show `WATERMARK_MISMATCH`. Paste.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-experience-auto-ingest-from-evidence-store` green.

## Touches
- tasks/gap-discovery-experience-auto-ingest-from-evidence-store.md
- docs/analysis/discovery-experience-ledger.mjs
- plugin/test/discovery-experience-ledger.test.mjs

## Evidence

### AC1 — `node --test plugin/test/discovery-experience-ledger.test.mjs` exits 0 (37 tests, 0 fail)

```
$ node --test plugin/test/discovery-experience-ledger.test.mjs
✔ INGEST(a): a store with 3 outcomes ⇒ 3 Experiences with derived roles, watermark at the last line
✔ INGEST(b): a second run ingests 0 and leaves the carriers byte-identical
✔ INGEST(c): maxPerRun:2 ⇒ 2 ingested with the remainder reported; the next run ingests the rest
✔ INGEST(d): enabled:false ⇒ zero reads and zero writes — the switch is answered before any I/O
✔ INGEST(e): a rewritten store ⇒ WATERMARK_MISMATCH, and NOTHING is written
✔ INGEST(f): summary/components equal the values DERIVED from the record; a caller-supplied summary is refused
✔ INGEST(f): the case_id of a derived entry is deterministic and chosen by nobody
✔ the pin: `evaluation_pin` is the prereg's `pin` when it resolves, and null (never a guess) otherwise
✔ INGEST(g): a user-sourced Experience goes through the same ingestExperience and lands in the same carrier
✔ an ownership-loop verdict is SKIPPED and REPORTED — never coerced into a finding role
✔ a malformed line is COUNTED, and the watermark does not advance past it
✔ dedup by source_ref: losing the watermark does not duplicate the ledger
✔ the role elevation reads DEVELOP's task status, and only a `done` task makes a finding 'fixed'
✔ the ingester reads the store at the SHARED checkout — a worktree root still sees the main store
ℹ tests 37
ℹ pass 37
ℹ fail 0
EXIT=0
```

The new cases are labelled `INGEST(a)`–`INGEST(g)` rather than `AC1(a)`–`AC1(g)`: the file already
carried an `AC1(a)`–`AC1(h)` block from the ledger's first task (`gap-discovery-teaching-case-ledger-
feedback-ingestion`), and two differently-sourced case sets under one label is exactly the
"缺席伪装成在场" shape 硬规则 8 forbids. The mapping is 1:1 with the AC letters.

What each new case pins, beyond the literal AC text:

- `INGEST(a)` also asserts the three roles are the VERDICT's (`found-unresolved` / `confirmed-negative`
  / `undetermined`) and that the watermark holds exactly `{line, line_sha256}` and reads back through
  the shared checkout.
- `INGEST(d)` carries its own negative control on the same predicate: `enabled:true` on the SAME root
  ingests 3 and writes the watermark, so the zeros are the kill switch and not a fixture that
  structurally cannot produce a non-zero.
- `INGEST(e)` tests THREE rewrites, because "rewritten" has more than one shape: truncation (the line
  is gone), an in-place rewrite with the SAME line count (only the sha256 can catch it), and a corrupt
  watermark file (its OWN refusal — reading it as "no watermark" would silently restart at line 0).
- `the role elevation reads DEVELOP's task status` is the derivation's control set: `done` ⇒
  `found-and-fixed`; a real task at `todo` ⇒ unchanged; a task id develop cannot resolve ⇒ unchanged
  ("I could not check" must never become "it is fixed"); a later outcome on the same `subject_key`
  ⇒ `recurred-after-fix`; and the SAME two-outcome store WITHOUT a done task ⇒ no elevation at all.
- `an ownership-loop verdict is SKIPPED and REPORTED` pins that `abstained` never becomes a finding.
- `dedup by source_ref` is the safety net under the watermark: with the watermark deleted, all three
  outcomes are re-examined, all three are recognised, and the ledger is byte-identical.

### AC2 — real run against the real evidence store, from inside this task's worktree

```
=== RUN 1 ===
caller root (inside the task worktree): /data/home/yale/work/quay-worktrees/gap-discovery-experience-auto-ingest-from-evidence-store
{
 "ok": true, "enabled": true,
 "store": "/data/home/yale/work/quay/.quay/architecture-evidence-store.jsonl",
 "watermark_file": "/data/home/yale/work/quay/.quay/discovery-ingest-watermark.json",
 "scanned": 121, "ingested": 116, "duplicates": 0,
 "skipped_not_ingestible": 5, "malformed_lines": 0, "stopped_at_malformed_line": null,
 "remainder": 0, "advanced_to": 270,
 "watermark": {"line": 270, "line_sha256": "7549bc6ef14496997861f9c82ec47cfa8d0b60577e005f5b0736b99388ad4b39"}
}
ledger lines: 2 -> 118
watermark on disk: {"line":270,"line_sha256":"7549bc6ef14496997861f9c82ec47cfa8d0b60577e005f5b0736b99388ad4b39"}
watermark read back through the WORKTREE root: {"line":270,"line_sha256":"7549bc6ef14496997861f9c82ec47cfa8d0b60577e005f5b0736b99388ad4b39"}

=== RUN 2 (immediately after) ===
{
 "ok": true, "enabled": true,
 "scanned": 0, "ingested": 0, "duplicates": 0, "skipped_not_ingestible": 0,
 "malformed_lines": 0, "remainder": 0, "advanced_to": 270,
 "watermark": {"line": 270, "line_sha256": "7549bc6ef14496997861f9c82ec47cfa8d0b60577e005f5b0736b99388ad4b39"}
}
ledger lines: 118 -> 118
```

Outcome count scanned **121**, Experiences ingested **116**, duplicates skipped **0**, remainder **0**,
malformed **0**, watermark `{"line":270,"line_sha256":"7549bc6e…"}`. The 5 scanned-but-not-ingested are
the ownership loop's verdicts (`proposed`), which have no discovery role; they are COUNTED
(`skipped_not_ingestible: 5`) and passed, never coerced into findings. A second run ingests **0 new**.

The store and both carriers are the SHARED checkout's — the run was issued from inside the task
worktree (root = the worktree, store = `/data/home/yale/work/quay/.quay/...`) and nothing was written
under the worktree's own `.quay/`.

The four derived records the AC names (read back OFF DISK, not from the return value):

```
E-HYPGEN-ACCEPT-1 cluster 5   line 137  stored verdict "supported"  ⇒ role found-unresolved
  components ["checker-io.ts","checker-mechanical-spine-check.ts","driver-result.ts","outer-anchor-check.ts"]
  evaluation_pin e3163e51915cef83880c7202dcd0212627cf04fa   source_ref outcome-696a9770477e60e0
  summary "E-HYPGEN-ACCEPT-1 cluster 5: verifier verdict \"supported\" on subject hypgen:invariant|checker-io.ts,…"

E-HYPGEN-ACCEPT-1 cluster 7   line 140  stored verdict "refuted"    ⇒ role confirmed-negative   ← the AC's requirement
  components ["fan-in-ts-typecheck-gate.ts","prepare-admission-check.ts","select-tests-for-touches.ts","touches-orthogonality-check.ts","touches-parser.ts"]
  evaluation_pin e3163e51915cef83880c7202dcd0212627cf04fa   source_ref outcome-ee63601cc7031e95
  summary "E-HYPGEN-ACCEPT-1 cluster 7: verifier verdict \"refuted\" on subject hypgen:identity|fan-in-ts-typecheck-gate.ts,…"

E-HYPGEN-AB-1-B cluster 8    line 185  stored verdict "supported"  ⇒ role found-unresolved   (REQUIRED_FIELDS)
  components ["plugin/scripts/per-task-suite-record-check.ts","plugin/scripts/per-task-suite-record.ts"]
  evaluation_pin e3163e51915cef83880c7202dcd0212627cf04fa   source_ref outcome-bb12a6858838e74b
  summary "E-HYPGEN-AB-1-B cluster 8: verifier verdict \"supported\" on subject hypgen:invariant|plugin/scripts/per-task-suite-record-check.ts,…"

E-DT-1-Hp cluster 11         line 234  stored verdict "supported"  ⇒ role found-unresolved   (the fan-in lock)
  components ["plugin/scripts/direct-to-develop-bypass-check.ts","plugin/scripts/fan-in-ff-protocol-check.ts","plugin/scripts/fan-in-queueing-model.ts"]
  evaluation_pin f2432d17849e7bd375dbfa573ae55ea4efad171d   source_ref outcome-31fc82ad5d6c1f86
  summary "E-DT-1-Hp cluster 11: verifier verdict \"supported\" on subject hypgen:identity|plugin/scripts/direct-to-develop-bypass-check.ts,plugin/scripts/fan-in-ff-protocol-check.ts,plugin/scripts/fan-in-queueing-model.ts"
```

The `E-DT-1-Hp` pin `f2432d178…` is `dt1/prereg.json`'s; the three `E-HYPGEN` records resolve
`e3163e519…` from their own `prereg.json` — the pin is read from EACH record's OWN pre-registration,
not from one global source.

### AC3 — negative control: copy the store, delete its first line, point the ingester at the copy

```
fixture root: /tmp/gap-ingest-negctl-gTSs83
real watermark (copied verbatim): {"line":270,"line_sha256":"7549bc6ef14496997861f9c82ec47cfa8d0b60577e005f5b0736b99388ad4b39"}
real store: 270 lines ; copy before the edit: 270 lines
ledger under the fixture root before: architecture-evidence-store.jsonl discovery-ingest-watermark.json

--- CONTROL A (the predicate must NOT fire on a true sample): the copy UNCHANGED ---
{"ok":true,"scanned":0,"ingested":0,"duplicates":0,
 "watermark":{"line":270,"line_sha256":"7549bc6ef14496997861f9c82ec47cfa8d0b60577e005f5b0736b99388ad4b39"},"reasons":null}

copy after deleting line 1: 269 lines (the watermark still names line 270)

--- CONTROL B (the negative control itself): the same copy with line 1 deleted ---
{
 "ok": false, "scanned": 0, "ingested": 0, "duplicates": 0, "advanced_to": 270,
 "watermark": {"line": 270, "line_sha256": "7549bc6ef14496997861f9c82ec47cfa8d0b60577e005f5b0736b99388ad4b39"},
 "reasons": [
  "WATERMARK_MISMATCH:.quay/discovery-ingest-watermark.json-names-line-270-but-the-store-now-has-only-269-line(s)-so-it-was-truncated"
 ]
}
files under the fixture .quay/ after the refusal: architecture-evidence-store.jsonl discovery-ingest-watermark.json

--- and the REAL shared checkout is untouched by the negative control ---
real ledger lines: 118  (was 118 after run 1)
real watermark:    {"line":270,"line_sha256":"7549bc6ef14496997861f9c82ec47cfa8d0b60577e005f5b0736b99388ad4b39"}
```

Control A is the other half of 硬规则 2: the predicate is run against a sample known to be TRUE (the
copy with its first line intact) and does NOT fire — so Control B's `WATERMARK_MISMATCH` is a reading,
not a predicate that can only be true. No ledger was created under the fixture root by either control.

### Plan item 5 — no model calls

`ingestNewOutcomes` reaches no model: it reads one file, parses JSON, calls `git show` once per task id
named by a record (none of the 121 outcomes names one), appends lines, and renames a tmp file. There is
no `spawn` of an agent, no HTTP, and no imported model seam anywhere in `docs/analysis/discovery-
experience-ledger.mjs`.

### Boundary stated rather than papered over

`appendExperienceRecord` remains exported: it is the ONE carrier append that `ingestExperience`,
`ingestFeedback` and `ingestFromEvidenceStoreOutcome` all funnel through. A caller that appends a
record through it directly still bypasses the derivation contract — but it cannot bypass the ONE
validator or the ONE content-addressed dedup, and the module's structural sandbox forbids adding a
detector for it. `ingestFromEvidenceStoreOutcome` likewise survives as the PINNED single-record adapter
(its `narration` form), deliberately: a caller that must name one specific case still cannot claim a
role the record's stored `verdict` contradicts. Both boundaries are documented in the module header.

### A carrier this task created is NOT gitignored — measured, reported, not silently fixed

```
$ for f in .quay/discovery-experience-ledger.jsonl .quay/discovery-ingest-watermark.json .quay/discovery-method-registry.jsonl; do
    printf '%-48s ' "$f"; git check-ignore -q "$f" && echo IGNORED || echo "NOT ignored"; done
.quay/discovery-experience-ledger.jsonl          NOT ignored
.quay/discovery-ingest-watermark.json            NOT ignored
.quay/discovery-method-registry.jsonl            NOT ignored
$ wc -lc .quay/discovery-experience-ledger.jsonl .quay/discovery-ingest-watermark.json
  118  94369 .quay/discovery-experience-ledger.jsonl
    1     94 .quay/discovery-ingest-watermark.json
```

The real run left 118 records (94 KB) in the ledger and a new `discovery-ingest-watermark.json` on
disk, and NEITHER is gitignored — quay's `.gitignore` carries per-file lines and no wildcard over
`.quay`, exactly what `gap-discovery-carriers-ephemeral-in-worktree` measured for the other four
Discovery carriers. This task therefore adds a FIFTH unignored runtime file to that family, and says so
instead of adding a `.gitignore` line: `.gitignore` is outside this task's declared `## Touches`, and a
delta outside Touches is what the fan-in delta judgment flags. The follow-up is the one the sibling
task already named — a per-carrier (or one wildcard) `.quay/discovery-*` entry covering all of them.

### DoD — the scoped gate

```
$ bash /data/home/yale/work/quay-worktrees/gap-discovery-experience-auto-ingest-from-evidence-store/scripts/test.sh \
    --for-task gap-discovery-experience-auto-ingest-from-evidence-store --allow-thin
== scoped static checks (change-relevant tier) ==   … all PASS / NOT-EVALUATED (1: it0-split-or-commit --changed, no task file in the delta) …
ℹ tests 37   ℹ pass 37   ℹ fail 0
EXIT=0
```
