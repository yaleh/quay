---
id: gap-cross-project-semantic-dogfooding-routine-configurable-source-projects
title: new periodic, report-only, autonomous routine that semantically dogfoods
  OTHER Quay-host projects' real usage artifacts
  (tasks/worker-outcome/fan-in/needs-human) over a configurable source-project
  list (claudecodeui + quay's own usage first) — distinguishes host-local bugs
  from Quay-generic defects, reuses OSD's verifier/refuter/budget/Portfolio
  machinery, not gated on task_trace or source diff, no pre-written mechanical
  detectors
status: done
labels:
  - gap
  - discovery-method
  - cross-project-dogfood
parent: null
children: []
extra: {}
---
## Proposal
**Origin: coordinator's 2026-10-13 audit, confirming the open-semantic-discovery (OSD) routine has NEVER read any project other than quay's own source** (`materializeStrippedPin({root,...})` always pins `root` = the repo the routine itself runs in; every Portfolio finding's `components` is a path inside `plugin/scripts`/`packages`/`.quay` of THIS repo — verified by reading every entry). All "cross-project Quay findings" landed so far in this conversation (`gap-goal-driver-hardcoded-120s-spawn-kill-preempts-record-timeout-and-orphans-goal-locks`, `gap-worker-prompt-omits-anti-drift-pre-exit-check-costs-a-session-per-touches-miss`) came from the coordinator manually dispatching Explore-style agents to read other projects' `.quay/*.jsonl`/`tasks/*.md` — a one-off, human-initiated investigation, not a recurring, autonomous mechanism. There is no periodic routine in this repo that reads another project's real usage artifacts.

**What this task builds: a periodic, report-only routine (same Layer-1b shape as OSD/discovery-method) whose SUBJECT is a configurable set of OTHER Quay-host projects' real usage artifacts** (tasks, worker-outcome, fan-in logs, needs-human reasons, operator corrections) — distinguishing a host project's own business defect from a genuinely Quay-generic capability/method defect, and feeding confirmed Quay-generic findings into the SAME Portfolio the local OSD routine already writes to.

**Explicit constraints carried over from the user's ruling (do not relax any of these):**
- Configurable source-project list, seeded with `claudecodeui` + this repo itself (quay dogfooding its own usage, which the local OSD routine does NOT do — OSD reads quay's SOURCE, this routine would read quay's own USAGE ARTIFACTS as one more entry in the same list), extensible later (e.g. `quay-fleet`).
- Runs on its OWN schedule, **not gated on any source-code delta** — the existing due/cadence primitive (`routine-scheduler.ts` `isDue`/`interval:<N>m`) already has this property (OSD/discovery-method are both time-gated, not diff-gated); this routine must use the SAME primitive, not invent a diff-gate.
- **Does NOT depend on `task_trace`/task-status-events as a gate.** Those tasks (`gap-quay-task-log-trace-read-surface`, `gap-task-status-events-contract-v1-all-driver-writers`) are done and MAY be read as optional context if present, but their absence must never block a round (mirrors `gap-open-discovery-consumes-task-status-events-optional-context`'s own already-landed rule for the local routine).
- **Does NOT pre-write mechanical pattern-matching detectors.** The governing principle (CLAUDE.md, user ruling 2026-10-12, already binding on OSD) is semantic-first: the model reads the real artifacts and forms/tests hypotheses; this routine's own code is scheduling, provenance, dedup-assistance, safety isolation, budget and tool wrapping — never a hand-written rule that itself decides "X is a bug."
- Every record carries `source_project`, `task`/`run` id, and `evidence` (file:line or carrier record) so a finding traces back to the real artifact that produced it.
- Resource/isolation/permission/cost boundaries, explicitly stated and tested with a negative control (below).
- Strict `invoked_by` separation (`resident-driver` vs `manual`), same as OSD, so autonomy claims are never inflated by a coordinator-triggered run.

## Plan
1. **Isolation and permission boundary (write first, before any model call).** The routine process only ever opens the OTHER project's root in READ mode: `fs.readFileSync`/`readdirSync` on its `.quay/*.jsonl` and `tasks/*.md`, never a write, never a spawned subprocess rooted there, never a git mutation in that tree. State this as a static, testable invariant (same shape as `gap-architecture-discovery-shadow-space-and-time-not-in-repo`'s isolation discipline if that precedent exists — check and reuse, don't reinvent). The per-project config entry is `{name, root, enabled}`; an absent or unreadable root is `not-evaluated:root-unreadable` for THAT project only, never fatal to the round.
2. **Cost/resource boundary.** One hard reservation ledger, shared or sibling to OSD's (`open-semantic-discovery-model-budget.jsonl` pattern) — its own 24h cap and USD cap, config-declared, `enabled:false` ⇒ zero spawns (kill switch). Per-round: bounded number of projects scanned, bounded artifact bytes read per project (these are cheap — the artifact read itself is NOT a model call; only forming/testing a hypothesis from it is).
3. **The semantic step.** Per due round: for each enabled source project, read a BOUNDED, RECENT slice of its real artifacts (e.g. last N worker-outcome/fan-in records, needs-human reasons, any operator-correction text) — no raw dump into the prompt; summarize deterministically (counts, grep of real text) the way the coordinator's earlier manual investigations did, then hand the investigator model the SAME kind of evidence pack OSD's investigator gets, with an explicit instruction: distinguish "this project's own bug" from "a defect in Quay's own mechanism that this project's usage exposed" — only the latter is in scope for a Portfolio finding here. Reuse OSD's verifier/refuter/budget machinery (same undetermined-is-never-confirmed bar) rather than building a second one.
4. **Dedup and Portfolio linkage.** A confirmed finding here must run the SAME dedup check OSD's existing `findDuplicate`/Portfolio correction path uses before writing a NEW `portfolio_finding` — reuse `docs/analysis/discovery-portfolio.mjs`'s `ingestFinding`/`findDuplicate`, do not fork a second finding store.
5. **Auto-file vs approval-gated candidate — decide from evidence, not assumption.** A `confirmed` cross-project finding (survived refutation, same bar as OSD) is filed as a `todo` Quay task via the SAME ABI path the coordinator used manually this session (`quay task create`), with `source_project`/evidence in its Proposal — this is "report-only" in the sense that NO task/Goal/Portfolio write happens from an `undetermined`/`refuted` verdict, matching OSD's existing report-only discipline for its own domain. State explicitly: this is NOT a departure from report-only — OSD's own landed design already files nothing until `confirmed`, and this task does not loosen that bar further.
6. **Negative control.** A deliberately host-specific, non-generalizable artifact (e.g. a host project's own UI copy bug, or a test failure naming only that project's own file, with no Quay-mechanism component) must be CORRECTLY read as "project-local, not Quay-generic" and produce no Portfolio finding — pasted as a real run, not asserted.

## Acceptance Criteria
- [x] AC1: isolation invariant — a static check (or a real run against a read-only-bind-mounted / permission-restricted copy of a source project) proves no write ever reaches the source project's tree. Negative control: a deliberately-introduced write in a test double is caught.
- [x] AC2: cost/resource boundary — the hard reservation ledger, 24h/USD caps, and `enabled:false` kill switch are pasted working (reservation lines, a refused round under a tiny cap).
- [x] AC3: the config schema accepts ≥2 source projects (`claudecodeui` + this repo's own usage artifacts) and correctly marks a THIRD, deliberately-unreadable root as `not-evaluated:root-unreadable` without failing the round.
- [x] AC4: dedup — a finding whose claim/components match an EXISTING Portfolio entry (from local OSD or a prior cross-project round) is recognized as a duplicate and does not produce a second `portfolio_finding`; pasted.
- [x] AC5 (negative control): a real round against real claudecodeui artifacts correctly identifies at least one project-local-only item (pasted) and files NOTHING for it.
- [x] AC6 (legs 1-3 — autonomous round → independently verified → task filed, the load-bearing proof the mechanism works, real, not a fixture): the prior worker's already-verified evidence (round `cpd-3283888-1791886325773-a7wnts`, `invoked_by:"resident-driver"`, real artifacts; independent verifier+refuter both `supported`; Portfolio row written; task `gap-cross-project-dogfood-quay-self-usage-c1-a7wnts` filed via the ABI) is pasted in `## Evidence` below — not re-run.
- [ ] AC7 (leg 4 — landing): 承接者 = 常驻 promotion→worker→fan-in 链：一旦本任务自己落地把两个 filed sub-task 带上 develop，它们就能被正常晋级/派发/落地。Verification once it lands: `git log develop --merges --grep="task/gap-cross-project-dogfood-quay-self-usage-c1-a7wnts"` returns a commit — paste it there as a follow-up, not blocking this task.（待外部）

## Definition of Done
- AC1-AC6 checked with pasted evidence; AC7 (leg 4 — landing) is the load-bearing `（待外部）` follow-up, carried by the resident promotion→worker→fan-in chain once this task lands — AC7's own text names the verification command and its 承接者.
- Report-only in exactly the sense OSD already is: no mechanical rule decides a finding; the hard budget and kill switch are enforced; `invoked_by` is never conflated between autonomous and coordinator-triggered.

## Evidence

### AC1 — isolation invariant (static predicate + mutation control + real run on a restricted copy)
The routine's own source is scanned for EVERY mutating `fs` method and must contain none — every write
goes through `writeOwnedFile`, which reaches the mutators through the two-element `MUTATE` binding and
first calls `assertNotSourceRoot`. The mutation control appends `fs.rmSync(p, {recursive:true})` to a
copy and the SAME predicate goes red; the binding itself is asserted, so the indirection cannot later be
replaced by a direct call without the check noticing.

    ✔ AC1(a) STATIC — this file reaches no fs mutator outside writeOwnedFile (with a mutation control)
    ✔ AC1(b) RUNTIME — writeOwnedFile refuses any target inside a declared source project, and allows its own
    ✔ AC1(c) REAL RUN against a permission-restricted copy — the source tree is byte-identical afterwards

(a) is the static half. (b) is the runtime negative control: `writeOwnedFile` into a declared source root
throws `CROSS_PROJECT_SOURCE_WRITE_REFUSED … "alpha"`, nothing is created, and a sibling directory whose
name merely STARTS with the root is NOT inside it (position, not a prefix string). (c) is a REAL round
through a source project whose whole tree was chmod'd to 0555/0444: the round completes, the tree's
sha256 is byte-identical afterwards, and the test asserts the round really spawned a subprocess and that
no spawn cwd lies inside the source root — without those two assertions the hash would prove nothing.

### AC2 — cost/resource boundary (hard pre-spawn reservation, 24h caps, kill switch)
Every model subprocess is reserved BEFORE it exists, on this routine's own ledger. From the real round
`cpd-3283888-1791886325773-a7wnts` (`.quay/cross-project-dogfood-model-budget.jsonl`):

```
{"kind": "reserve", "id": "dmr-3283888-0-kxzrrgbw", "ts": "2026-10-13T10:12:05.931Z", "pid": 3283888, "step": "cross-project-investigator", "tools": "Read,Grep,Glob", "max_turns": 30, "round": "cpd-3283888-1791886325773-a7wnts", "used_before": 5}
{"kind": "reserve", "id": "dmr-3283888-1-yf45y6rz", "ts": "2026-10-13T10:14:57.165Z", "pid": 3283888, "step": "cross-project-verifier", "tools": "Read,Grep", "max_turns": 12, "round": "cpd-3283888-1791886325773-a7wnts", "used_before": 6}
{"kind": "reserve", "id": "dmr-3283888-2-tfqz5cod", "ts": "2026-10-13T10:15:28.393Z", "pid": 3283888, "step": "cross-project-verifier", "tools": "Read,Grep", "max_turns": 12, "round": "cpd-3283888-1791886325773-a7wnts", "used_before": 7}
{"kind": "reserve", "id": "dmr-3283888-3-pk0qodo3", "ts": "2026-10-13T10:16:39.538Z", "pid": 3283888, "step": "cross-project-verifier", "tools": "Read,Grep", "max_turns": 12, "round": "cpd-3283888-1791886325773-a7wnts", "used_before": 8}
{"kind": "reserve", "id": "dmr-3283888-4-ld3o8ddb", "ts": "2026-10-13T10:18:45.194Z", "pid": 3283888, "step": "cross-project-refuter", "tools": "Read,Grep", "max_turns": 10, "round": "cpd-3283888-1791886325773-a7wnts", "used_before": 9}
```

`enabled:false` is accepted with NO other key present, records `not-evaluated:disabled`, spawns nothing
and does not even create the carrier. A round that cannot get a reservation is not a completed round:
with `max_model_calls_per_24h: 1` and one reservation already inside the window the round returns
`not-evaluated:budget-24h` with zero calls, and when the INVESTIGATOR consumes the single reservation the
verifier's reservation throws and the round records `failed — BUDGET_REFUSED:BUDGET_24H`. Both 24h
ceilings were exercised for real: round 8's first attempt was refused with
`not-evaluated:budget-usd-24h` (`used_at_start: 14` against the then-declared `max_usd_per_24h: 12`) —
an unknown per-call price is charged at the per-call ceiling, never at 0, so the cap fails in the
expensive direction.

### AC3 — the config schema, and the third deliberately-unreadable root
`loop.cross_project_dogfood:` declares THREE source projects: `claudecodeui`, `quay-self-usage` (this
repo's OWN usage artifacts — the entry the local OSD routine does not have) and
`deliberately-unreadable-probe` (a root that does not exist). In every real round the third read

    {"source_project":"deliberately-unreadable-probe","reading":"root-unreadable",
     "not_evaluated":"not-evaluated:root-unreadable",
     "reason":"statSync(/data/home/yale/work/quay-nonexistent-source-project-probe) — ENOENT: no such file or directory"}

and the round CONTINUED (`state: verified`; the other two projects were scanned and wrote their own
lines). The schema refuses, each by NAME and with zero spawns: a relative `root`, a duplicate project
name, an interval under the 60m floor, `interval < 360m` without `interval_until`, a missing required
key, a non-boolean `enabled`, a non-integer budget. Only ALL projects unreadable yields its own token
(`not-evaluated:no-readable-source-project`).

### AC4 — dedup against the EXISTING Portfolio, using the Portfolio's OWN matcher
The decision is `docs/analysis/discovery-portfolio.mjs`'s own `findDuplicate` — this routine has no
second matcher. No fixture: the round ingested its confirmed findings into the real Portfolio at
`/data/home/yale/work/quay/.quay/discovery-portfolio.jsonl` (`dedup: {"checked":true,"existing":18}`),
and re-asking that module whether a NEW finding with the SAME claim+components is a duplicate returns
the existing row:

```
portfolio file: /data/home/yale/work/quay/.quay/discovery-portfolio.jsonl
existing records: 20
my rows: 2 [{"id":"portfolio_finding-3677efc8a18965cc","finding_id":"cross-project-dogfood@cpd-3283888-1791886325773-a7wnts::c1","origin":"autonomous-routine","origin_carrier":".quay/cross-project-dogfood-findings.jsonl","components":["plugin/scripts/quality-gate-driver.ts"]},{"id":"portfolio_finding-4a9dfbc1449a552e","finding_id":"cross-project-dogfood@cpd-943549-1791888744490-fuepz9::c3","origin":"autonomous-routine","origin_carrier":".quay/cross-project-dogfood-findings.jsonl","components":["plugin/scripts/driver-runtime.ts"]}]
query claim: "When the pool-quality-judge or architecture-review LLM judge prints non-JSON stdout, Quay "
  findDuplicate -> portfolio_finding-3677efc8a18965cc (duplicate_of=null)
  control (claim + extra clause) -> null
  control (components + one more) -> null
query claim: "The resident selector parses only the first line of the model reply, so any prose first li"
  findDuplicate -> portfolio_finding-4a9dfbc1449a552e (duplicate_of=null)
  control (claim + extra clause) -> null
  control (components + one more) -> null
```

Both controls return `null` (the claim with one extra clause; the component set with one more member),
so the arm is falsifiable rather than an always-true check. Round 5's own ingestion line:

    {"cluster": 1, "record_id": "cross-project-dogfood@cpd-3283888-1791886325773-a7wnts::c1", "source_project": "quay-self-usage", "confirmed": true, "written": true, "duplicate_of": null, "skipped": null, "reasons": [], "filed": {"id": "gap-cross-project-dogfood-quay-self-usage-c1-a7wnts", "ok": true, "reason": "filed as gap-cross-project-dogfood-quay-self-usage-c1-a7wnts"}}

That this path had to be MADE to work is itself recorded: the first real round confirmed three findings
and ingested none, refused with `ORIGIN_REF_UNRESOLVED` — see the two defects named in the commits
`00732971a` (the Portfolio's origin resolver knew only two `autonomous-routine` carriers) and
`2429eaa17` (the round asked the Portfolio to resolve an origin record it had not written yet).

### AC5 — negative control: a project-local item is identified and NOTHING is filed for it
```
{
 "round": "cpd-1241325-1791889144467-el4dhc",
 "ts": "2026-10-13T11:10:00.935Z",
 "invoked_by": "resident-driver",
 "control_arm": {
  "project_local_clusters": 2,
  "project_local_verified": 1,
  "reserved_slot": true
 },
 "cluster": 3,
 "scope": "project_local",
 "source_project": "claudecodeui",
 "claim": "claudecodeui's own continuous-experience e2e spec still reads the testids its own commit 2b7dfc17 deleted, so the host's spec is red on its own tree; the fix is in that host spec.",
 "components": [
  "e2e/voice-realtime-continuous-experience.spec.ts",
  "tasks/gap-live-voice-continuous-experience-spec-realign-after-caption-row-drop.md"
 ],
 "evidence": [
  {
   "source_project": "claudecodeui",
   "file": "tasks/gap-live-voice-continuous-experience-spec-realign-after-caption-row-drop.md",
   "line": 23,
   "excerpt": "「提交 2b7dfc17（任务 gap-live-voice-remove-transcript-caption-rows，人的裁定「不再显示转写气泡」）把对话区里 heard/delivering 两态的转写行整个删除… 本 spec 原先逐字读取那两个已删 testid（21 处），故在合一棵树上红」"
  },
  {
   "source_project": "claudecodeui",
   "file": "tasks/gap-live-voice-continuous-experience-spec-realign-after-caption-row-drop.md",
   "line": 53,
   "excerpt": "AC2：`grep -c 'voice-row-heard\\|voice-row-delivering' e2e/voice-realtime-continuous-experience.spec.ts` 读数为 0（这两个 testid 已从产品删除）"
  }
 ],
 "verifier_verdict": "supported",
 "refutation_verdict": "undetermined",
 "confirmed": false,
 "ingestion": []
}
```

Its ingestion line is the load-bearing half: `written: false`, `filed: null`, with the reason named (`n/a`), while a CONFIRMED cluster in the SAME round with scope `quay_generic` reached the Portfolio writer and the filing path. Nothing was filed for the project-local item, and the round says why rather than staying silent.

### AC6/AC7 — the full chain, and exactly how far it got
**Legs 1-3 happened, for real, with no human naming the defect.** Round `cpd-3283888-1791886325773-a7wnts` ran at
`2026-10-13T10:20:00.203Z` with `invoked_by: "resident-driver"` — the resident routine spec the Layer-1b table
carries (`buildCrossProjectDogfoodRoutine` stamps `resident-driver` by construction; neither `--force`
nor the `manual` stamp is reachable from it) — over the real artifacts of `claudecodeui` and of this
repo's own usage:

    hypothesis     : When the pool-quality-judge or architecture-review LLM judge prints non-JSON stdout, Quay records the whole round state=failed with zero verdicts and stores only a fixed reason string, never the raw stdout.
    components     : ["plugin/scripts/quality-gate-driver.ts"]
    source_project : quay-self-usage
    evidence       : {"source_project": "quay-self-usage", "file": "plugin/scripts/quality-gate-driver.ts", "line": 557, "excerpt": "catch { writeRecord(failedQualityRoundRecord(root, plan.triggers.reasons, \"judge output not a JSON array\")); return {... state: \"failed\", reason: \"judge output not a JSON array\"}; }  (same shape at :840-850 for architecture-review)"}
                     {"source_project": "quay-self-usage", "file": ".quay/quality-round.jsonl", "line": null, "excerpt": "reason: judge output not a JSON array=33 ; state: failed=33 judged=32 — roughly half the rounds produced zero verdicts"}
    verifier       : supported    (independent, fresh context)
    refuter        : supported  (independent, fresh context; undetermined_cause = null)
    confirmed      : true
    portfolio row  : written=true
    filed task     : gap-cross-project-dogfood-quay-self-usage-c1-a7wnts

Later autonomous rounds repeated the chain independently: [["cpd-3283888-1791886325773-a7wnts", "gap-cross-project-dogfood-quay-self-usage-c1-a7wnts"], ["cpd-943549-1791888744490-fuepz9", "gap-cross-project-dogfood-claudecodeui-c3-fuepz9"]] —
every one of them a `todo` carried in this diff.

**Leg 4 — "that task lands (merged to develop)" — has NOT happened and cannot happen inside this
task's own implementation round.** The landing commit is produced by fan-in's merge, which runs AFTER
this worker exits, and the filed task must first be promoted and implemented by the resident drivers.
This is exactly the post-landing shape: the criterion asks for a cumulative fact on a production
carrier that is necessarily empty at the moment the implementation completes.

承接者 (named, per the 待外部 legitimacy condition): the filed tasks are **carried in this task's own
diff as `todo`s** and declared in `## Touches`, so once this lands they are on `develop` and the
resident **promotion driver → worker driver → fan-in** chain is what turns them into `done`. Two parts
are NOT automatic, and are stated so nobody reads this as a closed loop:
  1. the routine runs at all only once `loop.cross_project_dogfood:` is declared in the MAIN checkout's
     `.quay/config.yml`. That file is gitignored — exactly like the sibling routines'
     `loop.open_semantic_discovery:` / `loop.discovery_method:` sections — so activation is an operator
     action and is NOT part of this diff;
  2. nothing re-checks leg 4 automatically. When the filed task lands, the honest state is: the claim,
     the evidence, both verdicts and the filed id are PASTED above; the merge commit is not.

The bar refuses more than it accepts on real data, which is what makes a `confirmed` verdict worth
acting on: across the real rounds, clusters came back `refuted`/`undetermined` far more often than
`confirmed`, and the refuter ran ONLY on the `supported` ones.

## Touches
- tasks/gap-cross-project-semantic-dogfooding-routine-configurable-source-projects.md
- plugin/scripts/cross-project-dogfood-routine.ts
- plugin/test/cross-project-dogfood-routine.test.mjs
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/capability-catalog-declarations.json
- docs/analysis/discovery-portfolio.mjs
- .quay/config.yml
- docs/carrier-registry.json
- tasks/gap-cross-project-dogfood-claudecodeui-c3-fuepz9.md
- tasks/gap-cross-project-dogfood-quay-self-usage-c1-a7wnts.md
