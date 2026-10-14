---
id: gap-discovery-method-evidence-store-never-autonomously-populated
title: discovery_method 的 EVIDENCE_STORE_MISSING 不是启动期暂态——没有任何常驻 routine 会写
  architecture-evidence-store.jsonl
status: done
labels:
  - gap
parent: null
children: []
extra: {}
---
## Proposal
**Found 2026-10-14 while planning safe enablement of `arch_discovery`/`discovery_method` on ClaudeCodeUI, as part of the "Quay architecture analysis as a shipped capability" follow-through.** `discovery-method-routine.ts`'s ingest step refuses every round with `EVIDENCE_STORE_MISSING` on any host where `.quay/architecture-evidence-store.jsonl` does not yet exist (`docs/analysis/discovery-experience-ledger.mjs:1392/1775/1992`). This was already observed once in `gap-quay-architecture-analysis-shipped-capability-cleanroom-acceptance`'s AC1 evidence on a fresh clean-room host and recorded there as a legible, correctly-fail-closed, "not the fix's concern" condition for THAT task's scope. This task investigates the condition itself: **is a fresh host's missing evidence store a transient startup gap that autonomous operation closes on its own, or does it stay missing forever without a manual step?**

**Confirmed by code-reading every write path to the store** (`docs/analysis/architecture-evidence-store.mjs`'s `appendRecord`/`appendEvidenceRecord`/`appendHypothesisRecord`/`appendOutcomeRecord`/`appendCounterexampleRecord`, and the ONE production call site, `arch-hypothesis-generation.mjs:1979`'s `appendRecord(root, kind, rec)` inside `emit(records, {writeStore, root, ...})`): `writeStore` defaults to `false`, and the ONLY place anything ever passes `writeStore: true` is `arch-hypothesis-generation.mjs`'s own manual CLI subcommands (`verify`/`match`/`review`, gated behind an explicit `--write-store` flag a human/worker types — `arch-hypothesis-generation.mjs:2453/2489/2523`). **None of the three resident, driver-invoked routines that load this engine — `open-semantic-discovery-routine.ts`, `discovery-method-routine.ts`, `cross-project-dogfood-routine.ts` — call `emit()` with `writeStore` at all** (confirmed: zero occurrences of `emit(`/`writeStore`/`EVIDENCE_STORE`/`appendRecord` in any of the three routine files). `arch-discovery-routine.ts` doesn't load this engine at all (it only spawns the mechanical space/time instruments, which import validation helpers from the store module but never call an append function).

**Real-host corroboration:** quay's own repo's evidence store (300 lines) was last modified 2026-10-12T22:07:27+08:00 — a SINGLE write event, not an accumulating trickle from resident rounds (OSD alone has run 187+ resident/manual rounds on this repo in the same window; if OSD's own operation wrote evidence, the store would show many distinct timestamps spread across that history, not one). ClaudeCodeUI — which has run real OSD resident rounds since 2026-10-11 and, as of today, real architecture-review rounds — has **zero** `.quay/architecture-evidence-store.jsonl` (confirmed: file does not exist). This is consistent with the code reading: the store is a manual-research artifact, not a production side effect, on EITHER host.

**Why this matters beyond ClaudeCodeUI specifically (it's a Quay-generic wiring gap, not a host config issue):** `discovery_method` is part of the shipped, documented Method/Portfolio/Experience capability. On ANY fresh deployment — a new project, or an existing one whose evidence store was never seeded — enabling `discovery_method` produces an indefinite `failed: EVIDENCE_STORE_MISSING` with no autonomous path to a different outcome, because nothing in its own resident pipeline (or any sibling resident routine's) ever bootstraps the prerequisite it declares. This is the SAME class of defect as Task D's packaging gap and the architecture-review detector-shipping gap — "a capability's own resident operation cannot reach the state its own gate requires" — just one layer upstream (data bootstrap, not code/packaging).

## Plan
1. **Decide the fix shape — do not do both** (hard rule: give a reason, don't hedge): either (a) have ONE of the evidence-producing resident routines (most naturally `arch-discovery-routine.ts`, since its space/time instruments already compute archguard-sourced readings that resemble `kind:"evidence"` records, or `open-semantic-discovery-routine.ts`, since its investigator/verifier/refuter already produce exactly the hypothesis/outcome shapes the store wants) call `emit(..., {writeStore:true, root})` on its own real output as a normal part of its resident round; or (b) have `discovery-method-routine.ts`'s own ingest step bootstrap-create an EMPTY, valid, schema-correct store file on first encounter (changing the semantics from "missing ⇒ refuse" to "missing ⇒ create empty, then proceed with zero records to ingest") so the gate stops being a permanent dead end while still being honest that there is nothing to ingest yet.
2. Whichever is chosen, it must not retroactively fabricate evidence for records that were never actually observed — a bootstrap-created empty store is honest; synthesizing plausible-looking evidence records to "seed" it is not and must not be done.
3. Negative control: on a host with the fix, `discovery_method`'s ingest no longer reads `failed: EVIDENCE_STORE_MISSING` purely because the file never existed; it still correctly reads some other state (e.g. "0 new outcomes to ingest") when there is genuinely nothing new, and still fails closed on a GENUINELY corrupt/unreadable store (not just an absent one).
4. No change to `discovery_method`'s own budget/call-count enforcement, and no change to the manual CLI tool's `--write-store` semantics (that path stays available for research use).

## Acceptance Criteria
- [x] AC1: the claim above — zero production call sites pass `writeStore:true` — is re-verified at implementation time against the then-current source (grep count pasted) before any fix, so the fix targets a condition still true, not a stale reading.
- [x] AC2: after the fix, a genuinely fresh host (no pre-existing evidence store, no quay source checkout, same clean-room methodology as the cleanroom-acceptance task) with `discovery_method` enabled produces a real round whose state is NOT `failed: EVIDENCE_STORE_MISSING` — pasted.
- [x] AC3: the same fresh host, BEFORE the fix (on the current/pre-fix build), is shown to still fail with `EVIDENCE_STORE_MISSING` — the negative control proving the fix changes something real, not host coincidence.
- [x] AC4: a genuinely corrupt/unreadable (not merely absent) store still fails closed with a legible reason distinct from the absent-file case — the two "nothing usable" conditions remain distinguishable (硬规则 3b: don't collapse "wasn't there" and "was there but broken" into the same reading).
- [x] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence.
- No fabricated/synthetic evidence records are ever written by this fix — only a real resident routine's own real output (option a) or an honestly-empty bootstrap (option b).
- `.quay/config.yml` budget ceilings on any host touched by verification are unchanged.

## Fix shape — (b), one of the two, with the reason for rejecting (a)

**Chosen: (b)** — the batch ingester bootstraps an EMPTY, valid, schema-correct store when it is
genuinely absent, instead of refusing. Implemented as `ensureEvidenceStore(root)` in
`docs/analysis/discovery-experience-ledger.mjs`, called from `ingestNewOutcomes` immediately before the
old `existsSync` refusal.

**Why not (a)** (having ONE resident routine `emit(..., {writeStore:true, root})` its own real output),
three reasons, the third of which is decisive:

1. **(a) is a much larger change than the gate it would unblock.** Neither the `arch-discovery` nor the
   `open-semantic-discovery` routine has any path to `emit()` today (AC1(3): zero occurrences in every
   resident routine file). Wiring one in means a whole hypothesis-generation round — investigator,
   pre-registration, verifier, refuter, budget reservations — not a one-line call.
2. **(a) risks exactly what the DoD forbids.** A resident routine under pressure to make its own gate
   open is the one actor most likely to write a plausible-looking record that asserts a reading nobody
   took. **(b) is structurally incapable of doing that: the only bytes it can write are none.**
3. **(b) is upstream of (a), so (a) cannot replace it.** Even with a producer wired in, the FIRST
   encounter with a fresh host is still an absent store, and the round still has to answer "nothing has
   been recorded yet" with something other than a permanent refusal. The producer is optional and
   separately scoped; the bootstrap is required either way.

So: **(b) alone. (a) explicitly not done, and not needed for any AC.** Nothing in this change alters
`discovery_method`'s budget/call-count enforcement, and the manual CLI's `--write-store` semantics are
untouched (Plan item 4).

## Evidence host

Both legs run on ONE genuinely fresh host, `/data/home/yale/work/quay-scratch/dm-bootstrap-host`,
built by the cleanroom-acceptance task's own methodology: `git init -b develop` scratch repo (README,
`src/a.ts`, `scripts/test.sh`), `quay init --root <host> --test-command "bash scripts/test.sh"` run FROM
the official artifact, `.quay/plugin` linked by that init to the artifact (never to a quay source
checkout), then one real `quality-gate-driver --once` round. Only `discovery_method` is enabled; the
other three routines are off, so a round is attributable to exactly one routine.

```
$ readlink -f /data/home/yale/work/quay-scratch/dm-bootstrap-host/.quay/plugin
/data/home/yale/work/quay-scratch/official-dist-acceptance-fixed-r3      # BEFORE leg
/data/home/yale/work/quay-scratch/dm-artifact-fixed                      # AFTER leg
$ ls <host>/.quay/ | grep -i evidence                                    # pre-round, both legs
ABSENT
```

The AFTER artifact is built from **this task branch** by the repo's own publisher
(`bash plugin/scripts/publish-dist-branch.sh --branch dist-plugin-dm-bootstrap-fix` → orphan
`12ea8bdf0d`), materialised as a `.git`-free plain copy so the clean-room premise holds. The one
variable between the two legs is the artifact:

```
$ grep -c ensureEvidenceStore <AFTER>/docs/analysis/discovery-experience-ledger.mjs      -> 5
$ grep -c ensureEvidenceStore <BEFORE>/docs/analysis/discovery-experience-ledger.mjs     -> 0
$ grep -rl store_bootstrapped <AFTER>/scripts/dist/                                      -> quality-gate-driver.js, ...
$ grep -rl store_bootstrapped <BEFORE>/scripts/dist/                                     -> (none)
```

## AC1 — PASS

The claim was re-verified against the PRE-FIX source (`develop` = `b1a9a7d8a`) **before** the fix was
written, by `git grep` over the pre-fix tree:

```
== every occurrence of `writeStore` (excl node_modules/artifacts) — 3 file(s) ==
docs/analysis/arch-hypothesis-generation.mjs:1971  export function emit(records, { out, writeStore = false, ... })
docs/analysis/arch-hypothesis-generation.mjs:2453  ... writeStore: has(args, "--write-store") ...   // verify
docs/analysis/arch-hypothesis-generation.mjs:2489  ... writeStore: has(args, "--write-store") ...   // match
docs/analysis/arch-hypothesis-generation.mjs:2523  ... writeStore: has(args, "--write-store") ...   // review
plugin/test/arch-hypothesis-generation.test.mjs:320 ... writeStore: true ...                        // TEST

== the three resident routines: occurrences of emit( | writeStore | EVIDENCE_STORE | appendRecord ==
plugin/scripts/open-semantic-discovery-routine.ts   => 0
plugin/scripts/discovery-method-routine.ts          => 0
plugin/scripts/cross-project-dogfood-routine.ts     => 0
```

**The claim holds: 3 production call sites pass `writeStore:true`, and all 3 are `arch-hypothesis-
generation.mjs`'s own manual CLI subcommands, each gated behind a `--write-store` flag a human types.
Zero resident routines call `emit()` at all.** `arch-discovery-routine.ts` does not load the engine
(0 hits).

**硬规则 5b — the same grep run over the whole carrier found the Proposal's "ONE production call site"
is an under-count, and the correction strengthens the diagnosis** (it does not change it):
`docs/analysis/ownership-active-loop.mjs:360` (`persistRunRecords`) and
`docs/analysis/ownership-active-proposal-repair.mjs:581` (`appendRepairAttemptRecord`) are two more
writers — and **neither is reachable from `plugin/scripts/` at all** (0 references), i.e. they too are
manual CLI runs. (`promotion-driver.ts:804`'s same-named `appendOutcomeRecord` is a DIFFERENT function
writing the promotion outcome log, not this store.) So the conclusion is unchanged and now
better-supported: **nothing resident can write this store on any host.**

## AC2 — PASS (same fresh host, POST-fix artifact)

```
$ node <AFTER>/scripts/dist/quality-gate-driver.js --once --root <host> --run-id dm-postfix-r1 --json
discovery-method => verified | round ran (invoked_by:resident-driver, interval 360m): ingested 0
  experience(s), reflected 0 unit(s), minted 0 candidate(s), 0 evaluated verdict(s) (0 correct),
  0 promotion(s), 0 retirement(s), 0 model call(s), wall 36ms; appended 1 scan-round line to
  .quay/discovery-method-findings.jsonl and advanced the production last-run

$ ls -l <host>/.quay/architecture-evidence-store.jsonl
-rw-rw-r-- 1 yale yale 0 ... architecture-evidence-store.jsonl          # 0 bytes
```

The round's own carrier line, read back off the host:

```json
{"kind":"scan-round","routine":"discovery-method","invoked_by":"resident-driver",
 "ts":"2026-10-14T03:05:51.705Z","wall_ms":36,
 "ingested":{"experiences":0,"scanned":0,"duplicates":0,"advanced_to":0,"store_bootstrapped":true},
 "reflection_launcher":null,"reflected":null,"candidates":{"minted":0,"persisted":0,"records":[]},
 "verdicts":{"total":0,"evaluated":0,"correct":0,"not_evaluated":0,"skipped_budget":0,"records":[]},
 "model_calls":0,"model_id":null,"cost_usd":null}
```

`state` is `verified`, the reason contains no `EVIDENCE_STORE_MISSING`, and `ingested.store_bootstrapped`
is `true` — the line itself says THIS round created the store. **0 model calls**: with nothing to ingest
the reflection step never ran, so no seam, no subprocess, no cost. The store the round created holds
**0 bytes** — an empty JSONL carrier is a valid carrier with no records; no evidence record was
fabricated.

## AC3 — PASS (the SAME host, BEFORE the fix, on the PRE-fix artifact)

```
$ node <BEFORE>/scripts/dist/quality-gate-driver.js --once --root <host> --run-id dm-prefix-r3 --json
discovery-method => failed | ingest refused — EVIDENCE_STORE_MISSING:.quay/architecture-evidence-store.jsonl-not-present-under-/data/home/yale/work/quay-scratch/dm-bootstrap-host (nothing appended, last-run not advanced)

  value.enabled   : true
  value.ingest.ok : false
  value.ingest.reasons: ["EVIDENCE_STORE_MISSING:.quay/architecture-evidence-store.jsonl-not-present-under-/data/home/yale/work/quay-scratch/dm-bootstrap-host"]

$ ls <host>/.quay/ | grep -i evidence     # AFTER the round
STILL ABSENT
```

Side by side, **identical host, identical content, identical config, one variable (the artifact)**:

| | BEFORE (`official-dist-acceptance-fixed-r3`, develop `9ac168ba9`) | AFTER (`dm-artifact-fixed`, this branch) |
|---|---|---|
| `discovery-method` state | **`failed`** | **`verified`** |
| reason | `ingest refused — EVIDENCE_STORE_MISSING:...` | `round ran ... ingested 0 experience(s) ... 0 model call(s)` |
| store after the round | still absent | present, **0 bytes** |
| experiences ingested | 0 (refused) | 0 (honest zero-work round) |

This is the negative control the AC asks for: the pre-fix build still fails on the same host, in the
predicted way, so the AFTER pass is attributable to the fix and not to host coincidence. The store was
still absent going into the AFTER leg (the refused round creates nothing, and the failed round does not
advance the last-run), so the AFTER leg really is the fresh-host condition.

## AC4 — PASS (a second fresh host, store THERE BUT BROKEN)

Built by the identical recipe, POST-fix artifact, with a **directory** placed where the store must be —
present, so the bootstrap must NOT fire, and unreadable, so the round must still fail closed:

```
$ ls -ld <host2>/.quay/architecture-evidence-store.jsonl
drwxrwxr-x 2 yale yale 10 ... architecture-evidence-store.jsonl        # a DIRECTORY, not absent

$ node <AFTER>/scripts/dist/quality-gate-driver.js --once --root <host2> --run-id dm-corrupt-r1 --json
discovery-method => failed | ingest refused — EVIDENCE_STORE_UNREADABLE:.quay/architecture-evidence-store.jsonl:EISDIR (nothing appended, last-run not advanced)
  value.ingest.store_bootstrapped: null                                 # and NOT falsely reported as bootstrapped
```

The two "nothing usable" conditions stay **distinguishable**, which is the whole point of 硬规则 3b:

| condition | code | state |
|---|---|---|
| the store **wasn't there** | (no longer a failure) → created empty | `verified` |
| the store **was there but broken** | `EVIDENCE_STORE_UNREADABLE:...:EISDIR` | `failed` |

and `store_bootstrapped` is three-valued on the record: `true` (this round created it) / `false` (it was
already there) / `null` (its existence was never established — a disabled round, an unresolvable shared
checkout, or a refusal that happened first), so "we made it exist" never reaches a reader wearing the
same shape as "it was already empty". The unit tests pin all three arms plus the directory arm.

## AC5 — PASS

```
$ bash scripts/test.sh --for-task gap-discovery-method-evidence-store-never-autonomously-populated --allow-thin
...
ℹ tests 273
ℹ pass 273
ℹ fail 0
exit=0
```

Scoped static-check tier green (25 change-relevant checkers), and the discovery family ran in the
selected shards including both files this task touched
(`discovery-experience-ledger.test.mjs`, `discovery-method-routine.test.mjs`). Scoped-gate cache
recorded against develop `b1a9a7d8a`. Anti-drift Touches pre-merge gate:
`ANTI-DRIFT OK: ... 4 actual file(s), all within declared Touches (8 glob(s))`.

## Definition of Done

- AC1–AC5 checked, each with pasted evidence above.
- **No fabricated/synthetic evidence record is written anywhere by this fix.** The store the bootstrap
  creates holds **0 bytes** (verified on the host), and the two unit tests assert exactly that
  (`readRecords(file)` → `{records: [], malformed_lines: 0}`). The only write this change can perform is
  an empty file.
- **`.quay/config.yml` budget ceilings declared on this task's Touches are UNCHANGED.** Directly
  measured on the AC4 host: `md5sum <host2>/.quay/config.yml` = `aa59ebd269bbc5021b9cb68800e102c6`
  before the round and `aa59ebd269bbc5021b9cb68800e102c6` after it. On the AC2/AC3 host, `diff` of the
  config against the snapshot taken before any round ran reports a single hunk — the deliberate
  `interval: 60m → 360m` edit made while BRINGING THE HOST UP, before round 1 — with every ceiling line
  (`max_experiences`, `max_model_calls`, `verify_reserve`, `max_wall_ms`) byte-identical. No round wrote
  the config on either host.
- Plan item 2 (never fabricate): upheld structurally, not by promise.
- Plan item 3 (negative controls): AC3 is the before/after control on one host; AC4 is the
  present-but-broken control; both live, not fixture-only.
- Plan item 4 (no budget/call-count change): the routine's budget path is untouched — the only routine
  edit is one field added to the round record's `ingested` block.

## Touches
- tasks/gap-discovery-method-evidence-store-never-autonomously-populated.md
- plugin/scripts/discovery-method-routine.ts
- docs/analysis/discovery-experience-ledger.mjs
- docs/analysis/architecture-evidence-store.mjs
- plugin/scripts/arch-discovery-routine.ts
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/discovery-method-routine.test.mjs
- plugin/test/discovery-experience-ledger.test.mjs
