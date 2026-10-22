# Ownership / architecture ACTIVE INVESTIGATION loop — shadow capability

Task: `gap-ownership-active-investigation-loop-shadow` (no Goal). Raw data:
`ownership-active-replay-results.json`. Code: `ownership-active-{contract,executor,slice-adapter,loop}.mjs`.
Tests: `plugin/test/ownership-active-loop.test.mjs` (48) + the shared-gate file `ownership-shadow-proposer.test.mjs` (17).

## 1. What it is

```
initial mechanical facts (git: commit, subject, top dirs; + optional recorded detector TRIGGER)
  -> judge (NO tools) returns ONE step: request_evidence | investigate_more | abstain | propose_slice
  -> deterministic gate: kind allow-list, path scope/deny, regex dialect, budgets, dedup
  -> bounded READ-ONLY executor: read_file / grep (pinned to the commit) / archguard_query (CLI)
  -> evidence appended WITH provenance (tool, ref commit, path+range | scope+flags, ts, sha256)
  -> repeat until terminal
  -> propose_slice(package-cycle): installed `archguard slice-delta` computes the delta + negative control
  -> existing deterministicGate (schema / evidence resolution / domain / forbidden / cap / dedup) + 24h quota
  -> ONE record appended to the shadow carrier (.quay/ownership-shadow-proposals.jsonl, gitignored)
```

Reused, not rebuilt: the shadow envelope and `deterministicGate` of `ownership-shadow-proposer.mjs`. The model
only chooses the next request, revises its hypothesis, says whether evidence suffices, and proposes a slice;
every schema/budget/scope/dedup/quota/admission decision is plain JS (ADR-033).

| module | role | pure? |
|---|---|---|
| `…-contract.mjs` | request schemas, hard budgets, path scope + deny list, step validation, ERE dialect rule | yes |
| `…-executor.mjs` | bounded read-only executor; `capability_gap` for unreachable ArchGuard surfaces | I/O via injectable deps |
| `…-slice-adapter.mjs` | builds the explicit slice, calls the **released** `archguard slice-delta`, normalises + records provenance | I/O via injectable deps |
| `…-loop.mjs` | state machine, prompt, terminal→envelope, quota/dedup, carrier append, `--live` / `--replay` CLI | judge injected |

Budgets (hard): 8 rounds, 6 tool requests, 90 KB evidence, 9 KB per result, 160 read lines, 50 grep hits.
Exhaustion ⇒ terminal **abstain** (`not-enough-evidence:*`). A judge that never produced a usable judgment
(launcher unavailable / unreadable output / repeated invalid steps) ⇒ **`not-evaluated`**, which has no
envelope, cannot enter dedup history and is not counted against the quota (see §4, defect 6).

## 2. ArchGuard surface: published product only

| check (read-only, this session) | result |
|---|---|
| installed runtime | `@yalehwang/archguard` **0.1.39** (`npm-cache`), plugin cache dir `0.1.39`; `node …/dist/cli/index.js --version` → `0.1.39`; `npm view` latest `0.1.39`. `archguard` is **not on PATH** — the CLI is invoked by its installed path |
| CLI | `archguard slice-delta --slice --arch --root --scope --observed --json --project-root`; exit 0 evaluated+guards clean / 1 evaluated, guard triggered / 2 not evaluated |
| MCP | `archguard_simulate_refactor_slice` **is registered in this session**. Schema: `slice` (object, required), `scope`, `projectRoot`, `observed` (optional). Minimal call: `{slice:{subject, proposedCut:{moves:[{file,from,to,symbols}]}, negativeControl:{restoreEdges:[{from,to}]}}, projectRoot, scope}` |
| formal dependency chosen | **CLI**, because with `--root` it returns `provenanceConsistency` = `match`/`mismatch`; the MCP twin returns `not-checked` (no git probe) |

Adapter changes: resolves the installed CLI, probes `--version` (must be ≥ 0.1.39, numeric compare; unreadable ⇒
not acceptable) and the `slice-delta` subcommand; each reading records `archguard_version`, `cli_path`,
`command`, `arch_sha256`, `slice_sha256`, `report_sha256`, `graph_sha256`, exit code, the tool's own
`provenance.tool` and `provenanceConsistency`. A `mismatch` downgrades a proposal. Missing/old ArchGuard ⇒
`unavailable` + capability gap (with the installed version), never an estimated delta.
**Retired and test-enforced absent**: any path under the ArchGuard source repo, its `docs/experiments/…` script,
and the `ARCHGUARD_SLICE_DELTA` variable. Fixtures are Quay-owned copies in
`plugin/fixtures/ownership-active-slice/` (sha256 in the results file).

### GOAL-033 cross-repo, installed 0.1.39

| path | before → after | left | negative control | guards |
|---|---|---|---|---|
| CLI on vendored fork-point fixture | **6 → 4** `['', gate, gate/config, gate/factories]` | `cli`, `fan-in` | `falsified: true`, `subjectBackInScc: true` | clean |
| CLI, through the Quay adapter (structured cut from the slice file) | 6 → 4 | `cli`, `fan-in` | falsified | clean; `provenanceConsistency: match` |
| MCP on the real T1 tree (`1025ab951`, full-path ids) | 6 → 4 | `…/cli`, `…/fan-in` | `falsified: true` | clean; `not-checked` |

The human-written prediction (6 → 5) is reported by the tool as a *separate* reading and `diverges` from the
computed 4 — the same disagreement the original goal recorded (observed 6 → 4).

## 3. Behaviour on the benchmark (replays) and on this repository (live)

Every sample, across code versions, is in the results file (25 replay records, 9 live). "Cell" = case × stage.
Discovery = no hint; "triggered" = a recorded duplicate-detector reading given as a provenance-carrying input.

| cell | samples (infra-failed) | requested `package_cycles` / `package_edges` / `duplicates` | computed deltas (negative control) | outcomes |
|---|---|---|---|---|
| GOAL-033 · T0 discovery | 3 (0) | 2/3 · 3/3 · 0/3 | **6→4, 6→5, 6→4** (all falsifiable) | 3× propose-goal with a computed delta |
| GOAL-033 · T1 discovery | 3 (0) | 3/3 · 3/3 · 1/3 | none | 3× investigate (cut explained no edge / names not covered); the `duplicates` request returned an explicit gap |
| GOAL-032 · T0 discovery | 3 (0) | 3/3 · 3/3 · 0/3 | 6→6 (control **not** falsified) | proposals on other concerns |
| GOAL-032 · T1 discovery | 3 (0) | 1/3 · 1/3 · 0/3 | none | proposals on other concerns |
| GOAL-032 · T0 triggered | 7 (1) | 0/6 · 1/6 · 0/6 | none | 6× propose-goal; gaps exposed at proposal time |
| GOAL-032 · T1 triggered | 6 (1) | 0/5 · 1/5 · 0/5 | one 6→5 (probe relocation, falsifiable) | 5× propose-goal |

What this establishes:

1. **GOAL-033 — the loop requests the package-level cycle query by itself**: 5 of 6 discovery samples issued
   `package_cycles` (three of them as the very first request), and 6 of 6 reached `package_edges`. At T0 it
   independently arrived at the real cut (relocate the driver vocabulary + `runDriver` core; computed **6→4**)
   twice and at a valid alternative (move the fan-in probe; computed 6→5) once.
2. **It is not stable at T1** (0 of 3 produced a computed slice): the model chased the inner gate sub-cycle, and
   the primitive correctly refused to compute cuts whose symbols do not cover an edge's imported names.
3. **GOAL-032 — no search wandering**: no sample hit a limit (forced terminals: 0). But the duplicate
   instrument was **never requested** in discovery (0/6) and 0/11 evaluated samples when triggered; the model prefers to chase
   what it can *measure* (cycles/edges). So the gap is not exposed by the model asking — it is exposed
   **deterministically at proposal time**: a `duplicate`/`canonicalization` proposal records
   `archguard.duplicates` (and `archguard.literal_dispersion`) as capability gaps, keeps the delta
   `UNVERIFIED declared`, caps confidence at medium, and appends the re-measurement gap to the envelope.
   When the model *did* request it (`GOAL-033 · T1`, 1 sample) it received an explicit `capability_gap`, charged to
   no tool budget, and stopped with `investigate_more`.
4. **A no-op cut is reported as a computed negative**: GOAL-032 · T0 produced a cut that the tool computes as
   6→6 with an unfalsifiable control — surfaced as `guard-violated: NEGATIVE_CONTROL_NOT_FALSIFIED`, not as a failure.
5. **The loop uses its whole request budget** (max 6/6 in every evaluated run, terminal at round 7–8). It
   never stops early on a sufficient reading; the budget is acting as the stopping rule, not a ceiling.

### Live shadow on the Quay repository (HEAD at run time, ArchGuard 0.1.39)

Nine live investigations were recorded over the session, three with the final code
(`431a9368`: `package_edges`+`grep`, 5–6 requests each). The live repo's cycle is the **4-member gate core**
(`quay/src ↔ gate ↔ gate/config ↔ gate/factories`; `package_cycles` size 4). Final-code outcomes:
3 × `investigate`, `gate_ok=true`, no proposal created, `executed:false`. Each proposed relocating
`gate/config/loader.ts` (or extracting a new `gate/core` leaf); the primitive returned `not-evaluated`
(`NO_EDGE_EXPLAINED_BY_MOVES` ×2, `MOVE_TO_NOT_AN_INTERNAL_DIR:"gate/core"` ×1) — so **no live delta was
computed**, honestly. Earlier-code live runs produced one `propose-goal` that re-proposed canonicalising
`packages/quay-github/src/github-client.ts` status literals, an item an earlier goal had explicitly exempted
(no decision memory — see §6).

## 4. Defects found by running it (each fixed, each pinned by a test)

| # | defect | evidence | fix |
|---|---|---|---|
| 1 | gate validated regexes with JS `RegExp`, the executor runs `git grep -E` — a `(?:…)` pattern passed the gate and failed in the tool | GOAL-033 replay, round 4 | `PATTERN_NOT_ERE` refused at the gate; error text carries git's message |
| 2 | `dependencies` / `used_by` return `(none)` for an unknown entity **and for a package directory**, same as "exists, no edges" | model concluded "gate/factories has zero dependencies" | explicit `ENTITY_NOT_FOUND` pointing at the directory-level query; new `package_edges` kind reads ArchGuard's own module graph |
| 3 | negative-control derivation only recognised "importer is the destination dir"; a redirect cut (probe moved out of fan-in, importer `cli`) was `NO_EDGE_EXPLAINED` although the tool computes it | live + replay | restore edges derived by the primitive's own coverage rule (union of moved symbols ⊇ imported names) |
| 4 | derived `untouchedDirs` included the importer dir that loses the edge ⇒ spurious guard violation | tool reported `untouched-dir-changed: cli` | involved dirs include both ends of every removed edge |
| 5 | the shared gate flagged `FORBIDDEN_ACTION:merge` on a proposal that named `ff-merge.ts`, then on "Merge gate/config/loader.ts into …" (merging **modules**) | live carrier | forbidden actions matched by form: hyphenated tokens must not continue into a path; `merge` only as an instruction to merge a git/goal object; `recommended_next_action` exact |
| 6 | an infrastructure failure (launcher exit 127) was recorded as an **abstain** and a later run was blocked by `DUPLICATE_CONCERN` on it | live carrier, three records at the same millisecond | `not-evaluated` terminal: no envelope, `gate_ok:null`, excluded from dedup and quota |
| 7 | the primitive reports the cycle *as seen from `subject`*; with `subject=fan-in` (the leaver) the text read "size 6 → 1, left [everyone else]" | GOAL-033 T0 | headline reading uses a canonical surviving subject by rule; the model's own view is kept and labelled |
| 8 | a re-measurement gap was exposed only if the model happened to request the instrument | single-trigger replays | proposal-time check maps `duplicate` / `canonicalization` → required instruments |

Mutation controls (copy-backup, md5-restored) each turned exactly the intended test red: dropping the
`reference.json` deny pattern, charging a gap to the request budget, allowing a self-declared delta, removing
the unavailable-primitive downgrade, reading the working tree instead of the commit.

## 5. Guarantees (tests)

schema (3 kinds, bounds, dialect) · budget (requests/bytes/duplicates/rounds, refusals never reach the executor,
exhaustion ⇒ abstain) · tool allow-list (a fourth kind is refused; the executor throws if the gate were bypassed)
· provenance (commit-pinned `git show`/`git grep`, hashes, ArchGuard version/command/hashes) · no-write guard
(no filing/lifecycle imports or forbidden-action values; exactly one append site; temp writes only under
`os.tmpdir()`; the judge is launched with `--tools ""`) · leakage guard (reference/outcome/benchmark paths and
`.quay/.git/.archguard` are unreadable; rows from denied paths are dropped and counted) · deterministic gate
(dedup, quota, ungrounded/gap evidence cannot support a proposal, self-declared delta refused) · ArchGuard adapter
(released CLI only; version/subcommand probe; cross-repo GOAL-033 6→4; redirect cut; partial cover not
pro-rated) · abstain-on-unreachable-evidence · private source-path ban.

## 6. Still missing / readiness for a limited proposal mode

ArchGuard tool surface still absent for production use:

1. **CLI `query` for duplicates** — exists only as MCP `archguard_detect_duplicates`.
2. **CLI `query` for literal dispersion** — MCP only, and its default-source run can be silently empty.
3. **A first-class package-edge query** — `package_edges` here is derived from the `analyze` module graph.
4. **Unknown-entity vs no-edges** — `--deps-of/--used-by` print `(none)` for both; `--entity` is the workaround.
5. **`--cycles` defaults to entity level** and reports "none" on a repository with a size-6 package cycle;
   `--output-scope package` is required. (`slice-delta` itself is fine.)
6. **`slice-delta` models only symbol moves between existing directories**: no new directory, no
   dependency-inversion/injection, no file-level graph, no partial-cover pro-rating — the live proposals for the
   gate core fall exactly there. The MCP twin does no git-consistency check.

Readiness: **the mechanism prerequisites for limited-proposal mode are met** (declarative requests, hard budgets,
provenance, computed deltas with a falsifiable control, no-write guard, deterministic gate, not-evaluated vs
abstain). **The evidence prerequisites are not**: live runs on the current repository produced no computed
slice (0 of 3), T1 discovery is unstable (0/3), and there is no decision memory (an explicitly exempted item was
re-proposed). Suggested entry conditions: (a) restrict limited proposals to `concern_kind=package-cycle` with a
computed, falsifiable delta and `provenanceConsistency: match`; (b) add a prior-decision index (exemptions,
non-goals of landed goals) that the gate consults; (c) require ≥ N consecutive shadow runs with a computed delta
before any proposal leaves the carrier; (d) do not enable non-cycle kinds until (1)/(2) exist.

## 7. Limits and incidents

Small n (3 per discovery cell); samples span code versions (fingerprints in each record) because defects were
fixed between batches. The launcher disappeared mid-run several times (exit 127; same environment churn as the
benchmark); those runs are `not-evaluated`, excluded from every count above, and re-run. The judge is the
current Flash configuration; the resolved launcher/model is recorded per record (`runtime`) and escalation is a
declared seam, off. No task/goal was created and no code edited by the loop; the only persisted output is the
carrier.

## 8. amend 2026-10-22 — 准入从单常量扩成 concern-kind 注册表

> 本段是 **dated amendment**，⛔ 不改写 §1–§7 的任何原文（§6 是本实现引用的历史契约）。它记录的是
> `evaluateEntryBar` 的条件 (1) 从**一个字面常量**变成**一张注册表**这件事，以及它为什么没有放宽准入。

### 8.1 改了什么

条件 (1) 原本是 `concern_kind === "package-cycle"`，注释写的是「the only kind with a computable,
falsifiable delta」。那句话对**仪器**成立，对**concern**不成立：`plugin/scripts/design-evolution-readings.ts`
已经把第二类信号端到端地机械化了（探测器、可计算的 delta、能把信号熄掉的修复方向）。
现在条件 (1) 读 `CONCERN_KIND_REGISTRY`（`docs/analysis/ownership-active-limited-proposal.mjs`），每条登记项带五键：

| 键 | 含义 |
|---|---|
| `detector` | 产出该 concern 的**机制**在哪（路径 + 函数 / 尚缺时指向任务 id）——不是散文承诺 |
| `deltaComputable` | 是否存在**可计算**的 delta（而非模型自述） |
| `negativeControl` | 是否存在一个「信号必须熄掉」的方向（真可证伪） |
| `occurrenceThreshold` | 该 concern 必须**发生过几次**才可离开 carrier（DIR-133 裁定 1：2）。由判定读取，⛔ 不是字面量 |
| `mechanized` | 上面三条是否**已落地**。`false` ⇒ 该 kind 报 `NOT_YET_MECHANIZED`，⛔ 不准入 |

四态互斥（硬规则 3b——「读不懂」与「判过且合格」不能同形）：

- `UNDETERMINED` — 记录的 concern_kind 读不出（无字段、无 slice_delta、无 dupKind、无机器写的 `concern_kind=` token）；
- `NOT_MET` — 该 kind **不在**注册表里，继续留在 shadow；
- `NOT_YET_MECHANIZED` — 在表里、但 `mechanized:false`：探测器/delta/负对照未落地，**这是它自己的态**，⛔ 不是 `NOT_MET`；
- `IN_SCOPE` — 在表里且已机械化，此时才轮到条件 (2)–(4)。

### 8.2 两条 `NOT_YET_MECHANIZED` 登记位（各自指向的探测器任务）

- **`spine-without-extension-point`** → `tasks/gap-worker-fan-in-cross-cutting-hooks-not-covered-by-extension-point.md`。
  它落地之前，没有一个可判定的「主干步骤未注册到扩展点」信号，因此本类只登记、不准入。
- **`god-file-size`** → **尚无探测器任务**，且**事件定义未定**（「发生什么算一次 god file」没有答案）。
  行数阈值是硬规则 4 推论（成本结构未测前不设数值阈值）的禁区，故本任务只立注册位；
  事件定义与历史发生率读数必须先于任何阈值，属于未来探测器任务的范围。

### 8.3 新准入的 `design-evolution-regression`：三件套齐备才登记

1. **探测器**：`design-evolution-readings.ts` 的 `evolutionFindings()` → `.quay/routine-findings.jsonl`
   （`dupKind:"evolution-regression"`, `trigger:"share-up"`）。本模块只**读**它写下的数字，⛔ 不重造探测器。
2. **可计算、可取假的 delta，口径写死为净口径**：`share = centralΔ / (centralΔ + nonCentralΔ)`，
   回归窗口 ⇔ `deltaCentral > 0 ∧ deltaDenominator > 0`（即读数机制自己声明的 `share-up` 边界）。
   ⛔ 不是「只计新增」口径——同一窗口两种口径实测差出 serve 1.31% / 2.25%，不写死口径的登记项不可复跑。
3. **负对照**：修复方向（新代码落到中心文件**之外**）把 `Δcentral` 压到 ≤ 0 ⇒ 同一判据返回 `hit=false`，
   信号熄掉。另有内建 regression/repair 双样本自检（`predicate-selfcheck-failed`），
   一条「不会说不」的判据不许判真记录（硬规则 4 推论二）。

### 8.4 与 §6(d) 的关系（为什么不算违反）

§6(d) 原文是「do not enable non-cycle kinds **until (1)/(2) exist**」，其中 (1)/(2) 指的是
`duplicate` / `literal_dispersion` 两条**缺失的 CLI 查询**。本次准入的 `design-evolution-regression`
不是那两类里的任何一个，它的仪器已经存在；§6(d) 背后的**原则**——「没有可计算、可取假 delta 的种类不准入」
——被完整保留，并第一次变成**机器可读的一列**（`mechanized`），而不再是一句散文。
`duplicate` / `canonicalization` 依旧 `NOT_MET`。

### 8.5 落点

- 实现：`docs/analysis/ownership-active-limited-proposal.mjs`（`CONCERN_KIND_REGISTRY` / `concernKindState` /
  `designEvolutionRegression` / `designEvolutionDeltaEvidence` / `designEvolutionPredicateSelfCheck`）
- 判据：`plugin/test/ownership-active-limited-proposal.test.mjs`（AC1–AC5、AC7 与生产记录 parity 各一条）
- 任务：`tasks/gap-planner-admission-widen-beyond-package-cycle.md`
