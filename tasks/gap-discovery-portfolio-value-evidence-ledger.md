---
id: gap-discovery-portfolio-value-evidence-ledger
title: "Discovery Portfolio: join each Finding to fix, landing, recurrence,
  human rating and gateway cost; value = landed net-new fixes, not finding
  counts"
status: done
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
---
## Proposal
The user changed the evaluation target on 2026-10-12. The primary measure of Quay's self-bootstrapping discovery is no longer sealed-holdout hit rate. It is three things:
- **(A)** real net-new engineering value in open domains;
- **(B)** a Capability Coverage Map of the domains the user named;
- **(C)** Capability Gain before vs after learning: new findings, coverage, reliability, efficiency.

Nothing today records value end to end. The evidence store records verdicts; the Experience ledger records outcomes; tasks record fixes. Nothing joins a Finding to its fix, the fix's landing, a later recurrence, a human rating and the cost spent. So "value" can only be counted as Finding or Supported counts, which is easy to inflate.

An operator reconstruction (read-only, no model calls) at `/data/home/yale/work/quay-scratch/portfolio-demo/REPORT.md` (rows in `rows.tsv`) found 13 real items:
- 11 findings with landed fixes, verified via git: 6 of autonomous origin (F01–F03 from the production `semantic-dedup-scan` routine, F04–F06 from blind experiments), plus 5 operator-led, mechanical-instrument or production-reading items;
- 1 user-reported finding with no fix filed (F12, missed by 9 blind runs);
- 1 correct autonomous refutation (N01).

## Plan
1. **New module** `docs/analysis/discovery-portfolio.mjs` with a persistent shared-checkout carrier `.quay/discovery-portfolio.jsonl`. Reuse the carrier persistence (atomic append, dedup, shared-checkout resolution) from `docs/analysis/discovery-method-registry.mjs`/`discovery-experience-ledger.mjs`; do not re-implement it.
2. **One record per Finding:**
   ```
   {
     finding_id,
     origin: "autonomous-routine" | "autonomous-experiment" | "operator" | "user" | "mechanical-instrument",
     origin_ref,              // routine runId / experiment+cluster / session / task
     evidence_level: "teaching" | "transfer" | "independent" | "production-open",
     method_ref | null,
     claim,
     outcome: "supported" | "refuted" | "undetermined",
     fix_task | null,
     fix_landed_commit | null,
     recurred: bool | null,
     human_rating: { value: "high" | "medium" | "low" | "noise", by, ts } | null,
     cost: { model_calls, input_tokens, output_tokens, usd_gateway } | null,
     duplicate_of | null
   }
   ```
3. **Derivations, all from the record itself.** Never asserted by the caller:
   - `fix_landed_commit` is read from git: the last develop commit on `tasks/<fix_task>.md` whose subject marks it done.
   - `recurred` comes from later evidence-store outcomes on the same component set.
   - `cost` is computed from recorded usage × gateway rates (`GET http://127.0.0.1:26510/model_group/info`); missing ⇒ `null`, never 0.
4. **Value metrics, anti-gaming by construction:**
   - `net_new_value` counts records that are `supported` ∧ fix landed ∧ not `duplicate_of` an earlier record or open task ∧ human_rating ≠ `noise`, split by origin.
   - Finding count and supported count are reported only as context, never as the headline.
   - `noise` ratings, refuted claims and duplicates are reported as negative or zero value.
   - `cost_per_valuable_finding` uses gateway cost.
5. **Backfill the 13 real rows** from `rows.tsv` via the module's ingest function. Every row must resolve its origin_ref in a real carrier or task, else it is refused. `human_rating` stays `null`: the worker never invents ratings.
6. Human ratings are written only through `rateFinding({finding_id, value, by})` with `by` naming a human session. A worker call is refused.

## Acceptance Criteria
- [x] `node --test plugin/test/discovery-portfolio.test.mjs` exits 0:
  - (a) `fix_landed_commit` comes from a fixture git repo, not from caller input;
  - (b) a caller-supplied `fix_landed_commit` that disagrees with git is refused;
  - (c) a duplicate (same component set and claim as an earlier record) gets `duplicate_of` and is excluded from `net_new_value`;
  - (d) `noise` reduces `net_new_value`;
  - (e) missing usage ⇒ `cost:null`, and cost-per-value reports an unmeasured count;
  - (f) a worker `rateFinding` is refused;
  - (g) adding 10 refuted records leaves `net_new_value` unchanged (the anti-inflation control).
- [x] Real backfill: paste all 13 records, `net_new_value` split by origin (expected 11 with fixes landed; autonomous 6), and the list of rows with `cost:null`. Every origin_ref must resolve.
- [x] Mutation control: make `net_new_value` count supported findings instead of landed fixes, and show case (g) goes red. Paste, then revert.

## Evidence

### AC1 — the test file, exit 0

```
$ node --test plugin/test/discovery-portfolio.test.mjs
✔ (a) fix_landed_commit is READ FROM GIT, never taken from the caller (71.550626ms)
✔ (b) a caller-supplied landing that DISAGREES with git is refused; an agreeing one is accepted (56.308641ms)
✔ (c) a duplicate (same component set AND claim) gets duplicate_of and leaves net_new_value (87.339770ms)
✔ (d) a `noise` rating reduces net_new_value, and is not the same value as `unrated` (96.559044ms)
✔ (e) missing usage ⇒ cost:null and an unmeasured count; recorded usage × gateway rates ⇒ USD (99.955727ms)
✔ (f) a worker's rateFinding is refused; only an operator session may rate (92.813611ms)
✔ (g) adding 10 refuted records leaves net_new_value unchanged (the anti-inflation control) (165.456184ms)
✔ an origin_ref that resolves in no carrier is refused; a resolvable one names its carrier (46.205971ms)
✔ a re-ingest of the same finding_id is a no-op, not a second record (the carrier is append-only) (97.201254ms)
✔ recurred is read from later evidence-store outcomes; an unknown component set ⇒ null, not false (46.305508ms)
✔ the frozen backfill table is well-formed and every row's origin_ref is a resolvable SHAPE (0.611926ms)
ℹ tests 11
ℹ pass 11
ℹ fail 0
EXIT CODE = 0
```

Cases (a)–(g) are the first seven tests; the remaining four pin the parts the AC names only by implication — a re-ingest is a `DUPLICATE_ID` no-op (the id keys on the FINDING, not the clock), an unresolvable `origin_ref` is refused, `recurred` distinguishes "checked, nothing came back" (`false`) from "could not check" (`null`), and the frozen 13-row table is well-formed with `human_rating: null` and no `usage` on every row.

Every refusal arm has its positive control in the same test, so no case can pass by refusing everything (硬规则 3): (b) accepts an AGREEING landing, (d) restores value with a second `high` rating, (e) computes a real USD figure from a recorded usage, (f) accepts an `operator-session` rating.

### AC2 — the real 13-row backfill (every `origin_ref` resolved; `refused = []`)

```
$ node --input-type=module -e 'import {backfill} from ".../docs/analysis/discovery-portfolio.mjs"; ...backfill(process.cwd())'
carrier = /data/home/yale/work/quay/.quay/discovery-portfolio.jsonl
ingested = F01,F02,F03,F04,F05,F06,F07,F08,F09,F10,F11,F12,N01
already_present = []
refused = []
ok = true
$ wc -l .quay/discovery-portfolio.jsonl
13 .quay/discovery-portfolio.jsonl
```

```
F01  | autonomous-routine     | .quay/routine-findings.jsonl               | landed=e8453216d | recurred=false | dup=null | cost=null
F02  | autonomous-routine     | .quay/routine-findings.jsonl               | landed=07d807c1f | recurred=false | dup=null | cost=null
F03  | autonomous-routine     | .quay/routine-findings.jsonl               | landed=ca3346c14 | recurred=false | dup=null | cost=null
F04  | autonomous-experiment  | .quay/discovery-experience-ledger.jsonl    | landed=af268d6d5 | recurred=false | dup=null | cost=null
F05  | autonomous-experiment  | .quay/discovery-experience-ledger.jsonl    | landed=706545794 | recurred=false | dup=null | cost=null
F06  | autonomous-experiment  | .quay/discovery-experience-ledger.jsonl    | landed=fb9ff3994 | recurred=false | dup=null | cost=null
F07  | operator               | tasks/gap-routine-quota-window-ms-parsed-but-inert.md | landed=60597759e | recurred=false | dup=null | cost=null
F08  | operator               | tasks/gap-errorsignature-merges-different-exit-codes.md | landed=dcf7a5816 | recurred=false | dup=null | cost=null
F09  | operator               | .quay/discovery-experience-ledger.jsonl    | landed=28ede6e3f | recurred=false | dup=null | cost=null
F10  | mechanical-instrument  | plugin/scripts/capability-catalog-declarations.json | landed=c9b140609 | recurred=false | dup=null | cost=null
F11  | operator               | tasks/gap-in-round-suite-rerun-never-executed-in-production.md | landed=be11203fa | recurred=false | dup=null | cost=null
F12  | user                   | .quay/discovery-experience-ledger.jsonl    | landed=null | recurred=false | dup=null | cost=null
N01  | autonomous-experiment  | .quay/discovery-experience-ledger.jsonl    | landed=null | recurred=false | dup=null | cost=null
```

```json
{
 "ok": true,
 "evaluated": 13,
 "context": { "findings": 13, "supported": 12 },
 "net_new_value": {
  "total": 11,
  "by_origin": { "autonomous-routine": 3, "autonomous-experiment": 3, "operator": 4, "mechanical-instrument": 1 },
  "finding_ids": ["F01","F02","F03","F04","F05","F06","F07","F08","F09","F10","F11"]
 },
 "zero_or_negative": {
  "refuted": ["N01"], "noise_rated": [], "duplicates": [], "supported_but_not_landed": ["F12"]
 },
 "ratings": { "rated": 0, "unrated": 13 },
 "cost": {
  "measured": 0,
  "unmeasured": 13,
  "unmeasured_finding_ids": ["F01","F02","F03","F04","F05","F06","F07","F08","F09","F10","F11","F12","N01"],
  "usd_gateway_total": null,
  "cost_per_valuable_finding": null,
  "cost_per_valuable_finding_reason": "NO_MEASURED_COST"
 }
}
```

`net_new_value.total = 11`, autonomous = **6** (autonomous-routine 3 + autonomous-experiment 3 = F01–F06), matching the reconstruction's expected split. The two rows that do not count and why: `F12` is `supported` with no fix landed (`supported_but_not_landed`), `N01` is a correct REFUTATION (`refuted`) — an honest negative, kept in the record as zero value rather than dropped.

`cost` is `null` on all 13 rows and that is the measurement, not a gap in the code: the reconstruction recorded no per-finding usage (REPORT.md gives a **dollar range** for one experiment, `≈$1.2–2.6` for 72 calls, which is not a recorded usage and cannot be multiplied by a rate). The null path is exercised for real in AC1(e), where a recorded usage × the gateway's published rates produces a figure.

`recurred=false` on all 13 is likewise measured, not defaulted: for each row the question was asked against the evidence store from the later of (fix landing time, origin record time), and no later `supported` outcome shares its component set. A row whose components were unknown would have been `null` — a different value, tested in AC1.

`origin_ref` resolution, per origin class (`refused = []` above is the answer, these are the carriers it resolved into): F01–F03 → `<runId>#<findingId>` in `.quay/routine-findings.jsonl`; F04/F05/F06/N01 → `<experiment> cluster <n>` in the Experience ledger; F07/F08/F11 → the fix task itself, read from `develop` (`git cat-file -e develop:tasks/<id>.md`), with components from its own `## Touches`; F09/F12 → the Experience that recorded the report; F10 → a real capability-catalog entry, with the three surfaces it flagged supplied explicitly because a "which surfaces" finding carries no subject files in the catalog.

### AC3 — mutation control: count supported findings instead of landed fixes ⇒ (g) goes red

The mutation is one clause — `landed(r) &&` removed from `valueMetrics`'s `valuable()` predicate — i.e. `outcome === "supported" && auditable(r)` instead of `outcome === "supported" && landed(r) && auditable(r)`.

```
$ node --test --test-name-pattern="anti-inflation" plugin/test/discovery-portfolio.test.mjs
✖ (g) adding 10 refuted records leaves net_new_value unchanged (the anti-inflation control) (115.455207ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  3 !== 2

      at TestContext.<anonymous> (file:///data/home/yale/work/quay-worktrees/gap-discovery-portfolio-value-evidence-ledger/plugin/test/discovery-portfolio.test.mjs:296:10)
  actual: 3,
  expected: 2,
  operator: 'strictEqual'
```

```
$ node --test plugin/test/discovery-portfolio.test.mjs   # whole file, under the mutation
ℹ tests 11
ℹ pass 8
ℹ fail 3
✖ (c) ... actual: [ 'F-A', 'F-B', 'F-C' ] / expected: [ 'F-A', 'F-B' ]
✖ (d) ... actual: 3 / expected: 2
✖ (g) ... actual: 3 / expected: 2
```

The red is on the ABSOLUTE value, which is what makes this control work: F-C is `supported` with NO fix landed, so under "count supported findings" the fixture yields 3 instead of 2, and adding the ten refuted records cannot mask it. A before/after-delta-only assertion would have stayed green under this mutation — both counts rise together — so the assertion is on the number, not on the change. (c) and (d) go red as well, because they assert the same absolute values.

Reverted; the module is byte-identical to its pre-mutation state (`diff /tmp/portfolio-predst.mjs docs/analysis/discovery-portfolio.mjs` → no output, `IDENTICAL TO PRE-MUTATION`), and the file is green again:

```
$ node --test plugin/test/discovery-portfolio.test.mjs
ℹ tests 11
ℹ pass 11
ℹ fail 0
```

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-portfolio-value-evidence-ledger` green.
- Report-only: no task, goal or driver writes.

## Touches
- tasks/gap-discovery-portfolio-value-evidence-ledger.md
- docs/analysis/discovery-portfolio.mjs (new)
- plugin/test/discovery-portfolio.test.mjs (new)
