---
id: gap-open-discovery-findings-into-portfolio-experience
title: "P1: open-discovery confirmed findings → novelty check → Experience +
  Portfolio (production-open), corrections via append-only fold"
status: done
labels:
  - gap
  - discovery-method
  - open-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-open-semantic-discovery-routine-track
  - gap-discovery-portfolio-append-only-correction-fold
---
## Proposal
**Governing principle — SEMANTIC FIRST, MECHANIZE LATER** (user ruling, 2026-10-12): the first phase builds an end-to-end SEMANTIC loop. The model reads source and context, explores openly, builds and refutes hypotheses, verifies independently, assesses engineering value, and reflects on successes and failures into Discovery Methods / meta-methods that steer the next round.
- Mechanical code is limited to scheduling, state/provenance persistence, dedup *assistance*, safety isolation, budget and tool wrapping. It never replaces a semantic judgment, never gates whether the model may look, and "no mechanical change" never suppresses a semantic round.
- Hard-coded rules, classifiers, fingerprints or pattern tables for *finding* problems are out of scope. Crystallizing a step into code comes later, only for high-repetition, low-ambiguity, stable steps after the loop has shown real findings, reviewable reasoning, method reuse and measured gain — and always keeps a semantic fallback, a baseline comparison and degradation monitoring.
- **Building the automation is not success. A semantic round that ran on real source and produced reviewable reasoning is.**

After `gap-open-semantic-discovery-routine-track` lands, `confirmed` clusters exist only in that routine's carrier. They are not in the Discovery Portfolio (the value metric), not in the Experience ledger (what Discovery Method learns from), and not deduplicated against what is already known.

Without this step, continuous discovery cannot be measured by `valueMetrics`/`coverageMap`, and Discovery Method still learns only from hand-run experiments.

## Plan
1. In the open-discovery routine, add a post-round step that takes each `confirmed` cluster and runs a **novelty check** against existing knowledge:
   - Portfolio findings (same component set or overlapping set with a matching claim, via `findDuplicate`/`sameComponentSet`);
   - `.quay/routine-findings.jsonl`;
   - `.quay/arch-discovery-findings.jsonl` subject keys;
   - task bodies and Touches on develop (a done or open task naming the same components and invariant).
   **The novelty verdict is semantic.** Mechanical lookup only RETRIEVES candidates (same or overlapping components, matching task Touches). One bounded model call then reads the confirmed claim, the retrieved candidates and the relevant source, and decides novel vs duplicate-of-X vs restatement. It reserves budget like any other call.
   - With no mechanical candidate, the claim still gets the semantic check against a broader retrieval (task titles and Portfolio claims). "No mechanical match" never auto-labels a finding novel.
   - Exception, recorded as such: byte-identical component set plus claim from a previous round's own record may be deduped mechanically.
1b. **Failures are learning material too.** Refuted clusters, duplicates and verifier `undetermined` results are ingested as Experiences with their own roles (`confirmed-negative` / `duplicate` / `undetermined`) and the reasoning that decided them. Discovery Method reflection then learns from what did not work as well as from what did.
2. **Novel** ⇒ ingest as an Experience (`ingestExperience`, `reported_by:"system"`, `source_ref` = carrier record id) and as a Portfolio finding (`origin:"autonomous-routine"`, `evidence_level:"production-open"`, `outcome:"supported"`, `fix_task:null`).
   **Duplicate** ⇒ record it in the Portfolio with `duplicate_of` set (or not at all), and never count it as new.
3. Later status changes go only through the append-only correction records from `gap-discovery-portfolio-append-only-correction-fold`: refuted on recheck, duplicate found later, or fix task landed.
4. **No human rating, no Goal, no task creation.** Filing a fix task stays the operator's decision; the routine may list a candidate fix title in its record. The provenance chain carrier record → Experience → Portfolio must be resolvable both ways.

## Acceptance Criteria
- [x] Unit tests exit 0, covering:
  - (a) a confirmed cluster duplicating an existing Portfolio finding ⇒ not counted in `net_new_value`, `duplicate_of` set;
  - (b) a novel cluster ⇒ Experience plus Portfolio records with `production-open` and a resolvable `origin_ref`;
  - (c) a cluster refuted by the routine's refuter ⇒ never ingested as supported;
  - (d) the same cluster seen in two rounds ⇒ one Portfolio record, not two;
  - (e) no `rateFinding` call, no task or Goal write (static control);
  - (f) a confirmed cluster with NO mechanical candidate still gets a semantic novelty call (a stub records the call) and is not auto-labelled novel;
  - (g) refuted and undetermined clusters are ingested as Experiences with their reasoning, and never as Portfolio `supported`.
  **Evidence.** `node --experimental-strip-types --test plugin/test/discovery-experience-ledger.test.mjs plugin/test/discovery-portfolio.test.mjs plugin/test/open-semantic-discovery-routine.test.mjs` ⇒ **136 tests / 136 pass / 0 fail (exit 0)**. Per AC:
  - (a) `ingestion (a)` — `duplicate_of === <the seeded finding_id>`, the row is in `zero_or_negative.duplicates` and NOT in `supported_but_not_landed`, `net_new_value.total` unchanged while `context.supported` grows by 1. Plus `ingestion (a2)`: a duplicate that is a **task Touches overlap** — the shape the Portfolio's own mechanical rule CANNOT see — where `duplicate_of` names the task and resolves.
  - (b) `ingestion (b)` — `origin:"autonomous-routine"`, `evidence_level:"production-open"`, `fix_task:null`, `human_rating:null`, `origin_ref === <the cluster record's own record_id>`, `origin_carrier === .quay/open-semantic-discovery-findings.jsonl`; and `resolveOriginRef` **resolves** it (this is also the anti-drift check between the ref prefix the routine mints and the one the portfolio module recognises). The Experience's `source_ref` is the same id and its `evidence[0].sha256` is the digest of the carrier LINE (located by PARSING, not substring — the scan-round line also mentions the id).
  - (c) `ingestion (c)` — refuted ⇒ `portfolioRecords.length === 0`, ZERO novelty calls (no unconfirmed cluster is checked), and ONE Experience with role `confirmed-negative` carrying the refuter's counterexample.
  - (d) `ingestion (d)` — two rounds, two cluster records, **ONE** Portfolio record and ONE Experience; the second round's disposition is `mechanical-duplicate` naming the earlier `record_id`, with ZERO novelty calls.
  - (e) `case (i)` — the static control (judged BY POSITION on the source) now also names the human-only rating verb: `doesNotMatch(src, /…|rateFinding/)`, with a mutation control for BOTH injected symbols and a check that the `PortfolioModule` interface declares no rating member; the runtime half asserts `tasks/` and `goals/` are byte-identical after a full round.
  - (f) `ingestion (f)` — an orphan component (`nowhere/zzz-unheard-of.ts`) ⇒ `retrieved === 0` yet `noveltyCalls().length === 1`; the prompt the subprocess really received contains `none retrieved — this does NOT mean the finding is new` and the `WIDER CONTEXT` section; disposition is `restatement` (the MODEL's label) and **zero** Portfolio rows.
  - (g) `ingestion (g)` — one refuted + one `undetermined` cluster ⇒ zero Portfolio rows; two Experiences with roles `confirmed-negative` / `undetermined`, each ≥40 non-whitespace chars of the deciding reasoning; the `kind:"ingestion"` carrier line names each verdict and why no Portfolio row was written.
  Supporting cases: `CARRIER(a)–(f)` in `plugin/test/discovery-experience-ledger.test.mjs` (verdict DERIVED from the record and never from a caller `verdict` key; role/verdict contradiction refused with the derivation printed; a record with no id refused; every narration guard its own code; the summary floor applies here too) and two new `discovery-portfolio.test.mjs` cases (the ref arm resolves the record and NAMES the carrier; the routine-findings arm still resolves its own shape; a missing ref is refused naming where it looked; an end-to-end ingest lands `production-open` with `duplicate_of:null`).

- [x] Negative control: disable the novelty check in a scratch copy ⇒ (a)/(d) go red. Paste the output.
  ```
  $ node --experimental-strip-types --test --test-name-pattern="NEGATIVE CONTROL \(ingestion\)" plugin/test/open-semantic-discovery-routine.test.mjs
      NEGATIVE CONTROL (ingestion): mutant called a Portfolio duplicate disposition=novel (role found-unresolved), left duplicate_of=null for the task-Touches duplicate, and wrote 2 Portfolio rows for one cluster seen twice (claims were «duplicate», «duplicate_of set» and «one row»)
  ✔ NEGATIVE CONTROL (ingestion) — disable the novelty check in a scratch copy ⇒ the (a) and (d) claims go RED (553.6ms)
  ℹ tests 1 / pass 1 / fail 0
  ```
  The scratch copy is built by `scratchModule(mutate)`: a temp tree whose `plugin/scripts/*` and `docs/analysis` are SYMLINKED to this worktree (so the module's relative imports still resolve) plus a symlinked `node_modules`, with only the module under test written as a mutated REAL file. The mutation is EXACTLY "the novelty check is disabled": `findMechanicalRepeat(...)` becomes `const repeat = null;` and the verdict branch becomes `disposition = "novel";`, so every confirmed cluster counts as new. It changes nothing else — the retrieval, the writes and both ledgers still run.
  - (a) The claim that goes red is the one the mutation really falsifies, and the control SAYS so: against a duplicate **of a Portfolio row**, `ingestFinding`'s own duplicate rule sets `duplicate_of` even with the verdict forced to `novel` (a second line of defence, not a substitute) — so case (a)'s `disposition === "duplicate"` and role assertions are falsified (mutant: `disposition=novel`, role `found-unresolved`).
  - (a2) The literal `duplicate_of` claim IS falsified on the shape only the semantic check can see: the mutant leaves `duplicate_of=null` for the task-Touches duplicate, where the real module writes the task id.
  - (d) `2` Portfolio rows for one cluster seen twice, where the real module writes `1`.
  ⛔ Recorded honestly rather than papered over: the double protection above means a reader must not credit the novelty check with the Portfolio-duplicate arm of (a) alone.

- [x] Replay on real data: run the ingestion step over the existing production carrier records of `gap-open-semantic-discovery-routine-track` (whatever rounds exist at implementation time) and paste novel / duplicate / refuted counts and records. If the carrier has no confirmed cluster yet, say so and paste the fixture run only.
  **The production carrier does not exist yet — stated as NOT-READ, not as zero.** Measured at implementation time:
  ```
  $ ls -la /data/home/yale/work/quay/.quay/open-semantic-discovery-findings.jsonl
  ls: cannot access '.../open-semantic-discovery-findings.jsonl': No such file or directory
  ```
  So there are **no production cluster records to replay** — the routine landed (its scan-round AC is itself （待外部）) but no RESIDENT quality-driver round has written a line. The population is UNMEASURED, not measured-empty (硬规则 3b), and the counts below are therefore the **fixture run only**, as this AC provides for:
  ```
  # fixture run (the routine's own real ingestion path, stub spawn): novel / duplicate / refuted
  ingestion (b)  novel        ⇒ 1 Experience (found-unresolved) + 1 Portfolio row (production-open, origin_ref resolved)
  ingestion (a2) duplicate    ⇒ 1 Experience (duplicate) + 1 Portfolio row with duplicate_of=<task id>
  ingestion (c)  refuted      ⇒ 0 Portfolio rows, 1 Experience (confirmed-negative)
  ingestion (g)  undetermined ⇒ 0 Portfolio rows, 2 Experiences (confirmed-negative + undetermined)
  ingestion (d)  repeat       ⇒ disposition mechanical-duplicate, 0 writes of either kind
  ```
  ⛔ No production round was manufactured to produce a non-zero replay: the first real one is the first RESIDENT quality-driver round after this delta lands on `develop` AND the anchor self-refresh reloads `quality-driver.ts`.

- [ ] Production reading: the first resident round after landing that has a confirmed cluster — paste the chain (carrier record → Experience → Portfolio) and the `valueMetrics` / `coverageMap` before and after. （待外部）
  **未读到（待外部）.** Two things must exist before this can be read, and neither does: (i) the delta must land on `develop` and the develop→main-checkout sync must put the new `quality-gate-driver.ts` on disk, so the anchor's self-refresh reloads the routine; (ii) a RESIDENT round must then run and produce ≥1 `confirmed` cluster — which the carrier does not yet hold (see the AC above). The chain to read is `record_id` → `source_ref`/`case_id` on the Experience → `origin_ref` on the Portfolio row, and the metrics are `valueMetrics(readPortfolio(root).records)` + `coverageMap(root)` read before and after the ingestion step. ⛔ Nothing here manufactures those readings, and no round will be re-run to chase a non-zero result.

## Definition of Done
- All AC ticked with output pasted (production AC may stay （待外部）).
- `scripts/test.sh --for-task gap-open-discovery-findings-into-portfolio-experience` green.
  **Evidence:** the scoped gate is run in this worktree after `git merge develop` and recorded on the scoped-gate cache; the three files the ACs live in were also run directly (136/136, exit 0). See the fan-in run for the final reading.
- The provenance chain carrier record → Experience → Portfolio resolves BOTH ways.
  **Evidence:** every row written by this delta is keyed on the carrier record's own `record_id`. Forward: the Experience's `source_ref` IS that id and its `evidence[0].sha256` is the digest of the carrier LINE's bytes (asserted against the bytes really on disk in `ingestion (b)`); the Portfolio's `origin_ref` IS that id and `origin_carrier` names the carrier. Backward: `resolveOriginRef(root, {origin:"autonomous-routine", origin_ref: record_id})` resolves it (asserted in `ingestion (b)` and in the portfolio module's own new case), and the Experience is found by `source_ref === origin_ref`. The Experience's `case_id` is `EXP-<record_id>`, so no second index is needed in either direction.
- No mechanical finding logic (classifier, fingerprint gate, pattern table) added; any mechanical piece is listed with its role.
  **Evidence — every mechanical piece this delta adds, with its role:**
  1. `retrieveNoveltyCandidates` — **dedup ASSISTANCE only**: it gathers candidate records (Portfolio rows, `.quay/routine-findings.jsonl`, `.quay/arch-discovery-findings.jsonl` subject keys, task Touches on develop) plus an always-supplied wider context (Portfolio claims, task titles). It labels nothing, ranks nothing, rejects nothing, and returns candidates even when there are none. A per-source count plus an `absent` list plus an error list lets an empty retrieval be decomposed rather than read as "no existing knowledge".
  2. `findMechanicalRepeat` — the ONE mechanical LABEL, and it is only ever about THIS routine's OWN earlier cluster record (byte-identical component set AND claim). It is recorded as `disposition:"mechanical-duplicate"` and writes nothing to either ledger.
  3. `gitGrepPaths` / `taskIdFromPath` / `componentsFromSubjectKey` — **retrieval**. `TASK_TITLE_GREP_PATTERN` is a literal handed to `git` to pull task frontmatter titles; it classifies no defect. The module still carries no constructed regex, no `match`/`test`/`exec` (case (l)), and `taskIdFromPath` now accepts BOTH `git grep` output shapes so a parser gap cannot masquerade as "no task mentions this".
  4. `ingestRoundClusters` — **persistence**. Append-only; the carrier is re-read so the evidence digest is of the bytes really on disk, and a record whose line cannot be found is refused by name rather than ingested with a digest of something else.
  5. The novelty step's `reservingStep("novelty-check", …)` — **budget**: hard, atomic, pre-spawn, under the routine's own cap, with an explicit `--max-turns` and the read-only `Read,Grep` envelope.
  6. `clusterVerdict` (in the ledger module) — the derivation from the record's OWN fields, fail-closed in both directions (`confirmed !== true` never yields `supported`). It only says which role the entry may claim; it never says whether a finding is real.
  **One edit to a sibling module, named because it is outside the new file:** `resolveOriginRef`'s `autonomous-routine` arm in `docs/analysis/discovery-portfolio.mjs` gains a second carrier, selected by the ref's own `open-semantic-discovery@` prefix. Role: **provenance resolution** — without it a routine-ingested row's `origin_ref` would name no carrier and `ingestFinding` would refuse it. The prefix constant is repeated there (the module must not import the routine — the edge would be a cycle); the agreement is checked by a test, not by a comment.

## Touches
- tasks/gap-open-discovery-findings-into-portfolio-experience.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
- docs/analysis/discovery-portfolio.mjs
- docs/analysis/discovery-experience-ledger.mjs
- plugin/test/discovery-portfolio.test.mjs
- plugin/test/discovery-experience-ledger.test.mjs
