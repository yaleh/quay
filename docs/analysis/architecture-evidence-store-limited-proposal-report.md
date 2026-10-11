# Limited proposal mode — phase C of the end-to-end architecture self-bootstrap

Task: `gap-ownership-active-limited-proposal-mode`.
Code: `docs/analysis/ownership-active-limited-proposal.mjs` (new; imports nothing from the shadow loop).
Tests: `plugin/test/ownership-active-limited-proposal.test.mjs` (25 = 18 original + 7 regression tests added by
`gap-entry-bar-c3-passes-on-absent-or-unreadable-decision-memory`, §5 below).
Depends on: `gap-architecture-evidence-store-and-decision-memory` (decision memory `isKnownExemption`,
quantitative readings `computeRunMetrics`, the evidence-store carrier) — consumed, **not** re-implemented.

## 0. Why this task exists

`gap-ownership-active-investigation-loop-shadow` (done) ends at `ownership-active-replay.md` §6: the loop is a
**structural sandbox** that only ever writes a shadow carrier (`plugin/test/ownership-active-loop.test.mjs`
pins that red line), and §6 names four *suggested entry conditions* under which — and only under which — a
proposal may leave the carrier. Those conditions were written down and never implemented. This task implements
them, and stops at the first thing the mechanism is allowed to produce: **one `draft` Goal, for a human to
approve or reject.** It never activates anything.

## 1. What was built

| piece | role |
|---|---|
| `evaluateEntryBar(carrierRecords)` | PURE. The four §6 conditions over one candidate's records; returns `{eligible, reason, matchedConditions, conditions, streak}`. A refusal names **which** condition failed and **why** — never one generic "not eligible". |
| `proposeDraftGoal(rec, existingGoalIds, deps)` | PURE policy + one injected write seam. Computes the next `GOAL-0NN` from the supplied ids, writes the exit-condition AC **first** (the goal write surface refuses a draft GOAL with zero ACs — AC-217), then exactly **one** `status: "draft"` GOAL. |
| `createGoalStoreWrite(store)` | The real write seam over a goal store, passed IN so the module never statically imports the Core tree. |
| CLI (`--carrier … [--write]`) | A real (non-fixture) reading over a production carrier; `--write` performs the constrained write only for eligible candidates. |

The four conditions are taken **verbatim** from §6 (a)–(d):

1. `concern_kind === "package-cycle"` — the only kind with a computable, falsifiable delta;
2. the delta was **computed** by the ArchGuard `slice-delta` primitive, its **negative control is falsified**,
   and `provenanceConsistency === "match"`;
3. the decision memory says **`not-known`** — a recorded `exempted` or a `known-not-yet-filed` item must not be
   re-wrapped as a new Goal (it has its own path, or a human already ruled);
4. **≥ N=3 consecutive production live runs** on the same candidate carry a **consistent** computed delta.

Three decisions worth naming, because each is a place a weaker implementation looks fine:

- **`evaluateEntryBar` is an enum, not a boolean (硬规则 3).** An unreadable `concern_kind` is reported as
  `CONDITION_1_UNDETERMINED` — its own state — never silently folded into "not package-cycle". The four
  refusal reasons are asserted pairwise **distinct**.
- **"Not computed" and "computed but the control did not falsify" are different facts (硬规则 3b).** Each
  sub-reading of condition 2 (presence / computed / control / provenance) produces its own reason.
- **No id is hard-coded (硬规则 8).** `nextGoalId` reads the id set it is given; a test asserts the module
  source contains no concrete `GOAL-0NN` literal, and that the *same* dynamic computation drives the write.

## 2. AC5 — the production dry run (honest, no fabrication)

**Result: NOT satisfied. `eligible: false` for every candidate; the mechanism produced NO Goal this round.**

Reading taken with the module's own CLI (`--carrier`, dry run — no write) against the live production carrier:

| reading | value |
|---|---|
| carrier | `.quay/ownership-shadow-proposals.jsonl` (the live shadow-proposal carrier, gitignored runtime state) |
| carrier sha256 | `86efb78217534123795f0c5db64a94e0f50cd2c3579ae06703c570fbe35fd656` |
| records | **89** |
| candidates (grouped by structural file set, else the loop's `concern_key`) | **20** |
| eligible | **0** |
| maximum run-streak | **0 / 3** |

Where the 20 candidates fall, by **first** failing condition:

| first failing condition | candidates | meaning |
|---|---|---|
| `CONDITION_2_NOT_MET` (delta not computed) | **10** | reached C1 (a real `package-cycle` candidate) and stopped here |
| `CONDITION_1_NOT_MET` (kind ≠ package-cycle) | 3 | `other-boundary` ×1, `canonicalization` ×2 — out of scope by §6(d) |
| `CONDITION_1_UNDETERMINED` (record has no run shape) | 7 | older benchmark/replay-shaped rows in the same carrier; the concern kind cannot be read |

The 10 C1-passing candidates are the gate-core cycle proposals. **All 10 carry `slice_delta.status =
"not-evaluated"`** — the primitive refused to compute a cut (`NO_EDGE_EXPLAINED_BY_MOVES`,
`MOVE_TO_NOT_AN_INTERNAL_DIR`, `切法覆盖不足`). Since the delta is not computed, there is no negative control
and no `provenanceConsistency` to check. So the shortfall is not a near-miss: **not one production run has ever
produced a computed, falsifiable slice on this repository.**

That is the same zero that `ownership-active-replay.md` §3 (`0 of 3`) and
`architecture-evidence-store-replay.md` §4 (`0 of 3`, 7 rounds / 6 requests each) recorded — now reading as a
quantified **0 of 20 candidates, max run-streak 0/3** over the whole committed carrier. **Per AC5 this is a
legal terminal: "未满足,还差 3 轮" (and today not even 1 of those 3 rounds has a computable delta).**
No synthetic record was manufactured to make the number look better; the honest reading is recorded as it came
out, and no Goal was created.

## 3. Carrier choice — an honest limit of the dependency's schema

The task's Plan names `.quay/architecture-evidence-store.jsonl` as the input, but the four record kinds that
store persists do **not** carry the readings the entry bar needs:

- the `outcome` record carries `verdict`, `run_id`, `subject_key`, `subject_files`, `concern_key`, `gate_ok`
  and `metrics` — but **no `concern_kind`, no computed delta, no `provenanceConsistency`**;
- those readings live on the **run record**, whose verbatim carrier is
  `.quay/ownership-shadow-proposals.jsonl` (the loop appends each run there, and it is what "leaves the
  carrier" per §6(c)).

So `evaluateEntryBar` consumes **run records** and derives `concern_kind` **structurally** — a non-null
`slice_delta` implies `package-cycle` by construction of the loop (the primitive is only called for that kind),
and a non-cycle run names its own kind as a machine-written `concern_kind=<kind>` token in its envelope. Had the
entry bar read only the evidence store, it would have been **structurally dead** (condition 2 could never be
evaluated). This is recorded as a limit, not papered over; if the store is to become the sole input, its
`outcome` record must first be extended to carry the delta and its provenance.

## 4. Limits, and what was NOT done

- **No Goal was created or activated; no goal branch was opened; no code was refactored.** The production dry
  run was read-only; because it was not eligible, `proposeDraftGoal` was never invoked in production.
- The unit tests exercise the write end-to-end against a **real** goal store in a temp dir (AC4 reads the
  created GOAL back with `store.get` and asserts `status === "draft"`), but N is small and the eligible path is
  not yet reachable in production — the mechanism is built and gated, not yet used.
- The streak semantics: replay/holdout records neither count toward nor break the production streak (§6(c)
  counts *production* live runs); the first production run that fails to qualify ends it. This is a declared
  reading, not a derived one.
- The run-streak only counts the **tail**: three qualifying runs that are followed by a non-qualifying
  production run are not eligible — deliberately, since the point is to propose from the *current* state.

## 5. Condition 3 fails OPEN on an absent / unreadable decision memory — fixed

Task: `gap-entry-bar-c3-passes-on-absent-or-unreadable-decision-memory` (2026-10-11), a 硬规则 5b sibling sweep
of the "读不到 ⇒ 返回空/默认值 ⇒ 调用方读成实质结论" shape, taken on the entry bar itself.

### 5.1 The defect (by position)

1. `decisionMemoryStatus(rec)` returned the loop's **default** `"not-known"` when the record carried no
   `decision_memory` field, and ignored `architecture-decision-memory.mjs`'s `unreadable_input` flag entirely
   (it copied only `status` across the call boundary — 硬规则 4c: the guarantee did **not** survive the layer).
2. `isKnownExemption` returns `{status:"not-known", …, unreadable_input:true}` for an unreadable input, with a
   comment saying unreadable input must NOT be shaped like "nothing matched" — but the value it returns **is**
   the "nothing matched" value. The distinction lived only in a side flag the caller never read.
3. So `evaluateEntryBar`'s condition 3 passed **both** "the memory was never consulted" and "the memory could
   not read its input" as *"已查过、非已知豁免"* — a direct 硬规则 6 violation (缺值 = 未查, 不是「为假」). The
   `CONDITION_3_UNDETERMINED` branch already existed for unrecognised statuses; these two cases never reached it.
4. The CLI's carrier read was `JSON.parse … catch { return null }` + `.filter(Boolean)` — **silently dropping**
   unparseable lines, with no count. A dropped line is fail-open in the worst place: if it is the
   non-qualifying production run that would have *broken* a run-streak, the streak looks un-broken and
   condition 4's input is falsified.

### 5.2 The fix

| change | effect |
|---|---|
| `MEMORY_NOT_EVALUATED = "not-evaluated"` + `decisionMemoryReading(rec)` | an absent field, `unreadable_input:true`, a non-object, and a present-but-unreadable status all return their own value with an enumerated `cause` (`absent` / `unreadable`); a *read* status is copied verbatim |
| condition 3 | the two unread states fail closed through the existing `CONDITION_3_UNDETERMINED` branch; the reason names **缺席** vs **不可读** |
| `readCarrier(file)` | returns `{records, malformed_lines, exists}` — non-JSON and non-record lines are **counted**, never dropped (same field name as `architecture-evidence-store.mjs`) |
| `evaluateCarrier(carrier)` | if `malformed_lines > 0`, **every** candidate is forced `eligible:false` with `reason` starting `MALFORMED_CARRIER_LINES:` naming the count — a bad line cannot be attributed to a candidate, so no streak can be trusted |

⛔ No threshold was touched: `ENTRY_BAR_STREAK = 3`, conditions 1/2/4, the condition **evaluation order**, the
`draft`-only write surface and the never-active red line are all unchanged. `--write` cannot fire on a
malformed carrier because every candidate is already `eligible:false`.

### 5.3 Production reading (AC4)

Frozen snapshot of the live carrier (the loop is appending, so a moving target is not a reading):

| reading | value |
|---|---|
| carrier | `.quay/ownership-shadow-proposals.jsonl` |
| sha256 | `2cec3f53d354d0a5f7357a171df98262c749531d20daf12e214344a977a56456` |
| lines / records / `malformed_lines` | 93 / 93 / **0** |
| candidates (grouped as before) | 24 |

Dry-run (`node docs/analysis/ownership-active-limited-proposal.mjs --carrier <frozen>`, no `--write`),
**before** (the `develop` module) vs **after**:

| first failing condition | before | after |
|---|---|---|
| `CONDITION_2_NOT_MET` (delta not computed) | 14 | 14 |
| `CONDITION_1_UNDETERMINED` (no run shape) | 7 | 7 |
| `CONDITION_1_NOT_MET` (kind ≠ package-cycle) | 3 | 3 |
| eligible | 0 | 0 |

**Per-candidate top-level `reason` changes: 0 of 24.** That is the expected result and not a null one: the
first failing condition is still reported in the existing order, and **no production candidate reaches
condition 3** (all 24 stop at C1 or C2 — the delta is never computed, §2). The fix is invisible at the
top-level bucket level *today* and decisive the moment a candidate clears C2 — which is now reachable, since
`@yalehwang/archguard@0.1.40` can compute a falsifiable delta (the Finding's "条件 2 不再必然挡住").

The condition-3 reading itself, taken directly on each candidate's head record:

| C3 reading of the candidate head | candidates |
|---|---|
| `not-known` → **`not-evaluated`** (`cause:absent`) | **20** |
| `not-known` → `not-known` (`cause:read`) | 4 |
| `unreadable_input:true` | 0 |

Cross-tabulated with the first failing condition: `CONDITION_2_NOT_MET | C3=absent` **10**,
`CONDITION_2_NOT_MET | C3=read` 4, `CONDITION_1_UNDETERMINED | C3=absent` 7, `CONDITION_1_NOT_MET | C3=absent` 3.

So **20 of 24 candidates previously cleared condition 3 on a record that never carried a decision-memory
verdict** — i.e. they were 10 gate-core `package-cycle` candidates plus 10 out-of-scope ones, all of which
would have been *passed* by C3 had they reached it. They are now refused as UNDETERMINED(缺席) until a run
actually records a consulted, readable decision memory.

### 5.4 What was NOT done

No Goal was created or activated; no goal branch was opened; no code was refactored; no decision-memory seed
was taken from `GOAL-034` (Holdout B); the production run above was read-only (`--write` not passed). The
malformed-line path is exercised by tests against temp carriers (§AC3 of the task) plus a CLI spawn that
asserts an empty goal store — the production carrier currently has **0** malformed lines, so that branch has
no production reading to report yet, and none is claimed.

