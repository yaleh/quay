---
id: gap-ownership-active-repair-legal-dirs-lost-on-archguard-refusal
title: "proposal-repair never engages on ArchGuard-origin refusals:
  computeSliceDelta drops the graph's legal-dir list on the not-evaluated path,
  so repair abstains at attempt 0 (NO_RECORDED_LEGAL_DIRS) for the only class
  that reaches ArchGuard"
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

Quay+ArchGuard 联合回归(2026-10-11,用户批准)在当前干净 commit `ec00fcc00`(= develop 尖端)上跑了一次全新、有界、盲测的 `ownership-active-loop.mjs --live --repair --rounds 1`(默认解析路径 = 已发布 `@yalehwang/archguard@0.1.39`,`snapshot_matches_ref:true`、`tracked_changes_in_scope:[]`)。投研轮独立重新发现了 gate 四包环,产出 package-cycle `proposed_slice`(3 个 move:`gate->kernel`×2、`gate/config->gate`),在 ArchGuard 侧被拒为 `切法覆盖不足`(边 ` -> gate`)。`attemptRepair` 正确分类为 `invalid_move`(`INVALID_MOVE:COVERAGE_INSUFFICIENT`),**但在 attempt 0 以 `NO_RECORDED_LEGAL_DIRS` 弃权,judge 调用 0 次**——修复环根本没有启动。

**根因(按位置核实,非推测)**:`docs/analysis/ownership-active-proposal-repair.mjs` 的 `recordedLegalDirs(candidateRecord)` 只读 `slice_delta.detail.valid_dirs`。`docs/analysis/ownership-active-slice-adapter.mjs` 的 `computeSliceDelta` **只在 Quay 自己的 pre-flight 拒绝**(`buildSliceInput` 返回 `bad(...)`,携带 `valid_dirs`)时填 `detail`;在**ArchGuard 自己拒绝**的分支(`first.report.status !== "evaluated"`,约 `:280-289`)返回 `{status, reason, provenance, stays_*}`,**不带 `detail`**——尽管同一函数在几行之前已经亲手构建并持有那张图(`built.json…moduleGraph`,`internalNodes(graph)` 正是 `valid_dirs` 的来源)。这是"量没有穿过中间层"(硬规则 4c):合法目录清单在 adapter 返回时被丢掉了。

**后果**:repair 唯一能启动的是 Quay pre-flight 拒绝(`NO_EDGE_EXPLAINED_BY_MOVES` / `MOVE_TO_NOT_AN_INTERNAL_DIR`);而**真正到达 ArchGuard 的那一类**(`切法覆盖不足`——修复环最主要的目标)**结构上永远在 attempt 0 弃权**。

**发生率(硬规则 12,查历史而非等下一轮)**:2/2。① `gap-ownership-active-proposal-repair-loop` 的 pre-merge live 盲测(`docs/analysis/ownership-active-proposal-repair-replay.md` §4a,约第 155-166/235 行:"abstained with ZERO judge calls, because the ArchGuard-origin refusal…")已观察到并记为限制,未修;② 本次 post-merge 独立 live 盲测(run_id `live:2026-10-11T09-28-34-622Z:1`,carrier `.quay/ownership-shadow-proposals.jsonl` 第 91 条)再次复现。单测之所以全绿,是因为 3 处测试**手工注入了 `detail.valid_dirs`**(`grep -c valid_dirs plugin/test/ownership-active-proposal-repair.test.mjs` = 3)——只能被 fixture 注入满足的判据不是测量(硬规则 4 推论三)。

<!-- dedup-ref -->
去重已查:`tasks/*.md` 中 todo/ready/needs-human 状态对 `proposed_slice`/`preflight`/`newDirs`/`vacuous`/`slice-delta`/`ownership-active` 零命中;`task-granularity-advice` 对本 Touches 无 peer。承接 `gap-ownership-active-proposal-repair-loop`(done)与 `gap-ownership-active-slice-adapter-stays-declaration`(done),不改它们的已勾 AC。

**本次回归的其余读数(供核对,证据目录 `.quay/joint-regress-2026-10-11/`)**:
- 默认路径(已发布 0.1.39)对本次真实 `proposed_slice`:`not-evaluated` exit 2,`stays_declared:[gate:12]`、`stays_ignored_by_tool:true`(已发布构建无 `stays` 子句)。
- 前瞻读数(archguard 源码 `develop` `8e634bad`,**未发布**,`--version` 同为 0.1.39):同一 slice `evaluated` exit 0,SCC 4→3(`gate/config` 离环),负对照 `falsified:true`,guards 0。**这是首个能算出、且负对照可证伪的 live 候选——但只在没有任何消费者会拿到的构建上成立**,不计入准入。
- 受限提案准入(默认路径):91 条 / 22 候选,0 eligible,max streak 0/3;`goal_list --status draft` 为空,未创建任何 Goal。

## AC

- [x] AC1 根因修复:`computeSliceDelta` 在**图已构建之后**的每一个 `not-evaluated` 返回分支(含 ArchGuard 自身拒绝分支)都携带 `detail.valid_dirs`,其值 = 同一次构建的 `internalNodes(graph)` 排序结果(与 pre-flight 分支同源、同函数);图构建失败/不可用分支保持不带(不编造)。单测断言:构造 ArchGuard 返回 `not-evaluated` 的 stub `runCli`,返回值 `detail.valid_dirs` 深等于该图的内部节点。
- [x] AC2 生产形状回归(不注入 `valid_dirs`):把本次真实 carrier 记录(run_id `live:2026-10-11T09-28-34-622Z:1`)的 `proposed_slice` 与 commit `ec00fcc00` 下 `packages/quay/src` 的 package 图(`git archive` + `archguard analyze`,vendored 为 `plugin/fixtures/ownership-active-slice/live-ec00fcc00-coverage-gap.json`,记录 sha256)作为输入,经修复后的 `computeSliceDelta`(stub CLI 复现已发布 0.1.39 的 `切法覆盖不足` 拒绝)产出记录,再喂给 `attemptRepair`(stub judge):断言 attempt 记录中**不出现** `NO_RECORDED_LEGAL_DIRS`,且第一轮 `judge_called === true`。
- [x] AC3 负对照(fail-closed 不退化):图构建失败(`analyzePackageGraph` 抛错 / 返回 null)时,返回值仍不带 `detail.valid_dirs`,`attemptRepair` 仍以 `NO_RECORDED_LEGAL_DIRS` 弃权、0 次 judge 调用——证明修复没有把"真的没有"变成"编一个"。
- [x] AC4 既有 3 处手工注入 `detail.valid_dirs` 的测试保留,另新增 AC2 这条**不注入**的测试;`recordedLegalDirs` 的读取位置与语义不变(仍只读 `detail.valid_dirs`,仍不自行 find/grep)。
- [x] AC5 门限不变:`evaluateEntryBar` 四条件、`deterministicGate`/`quotaGate`、run-streak=3、Goal 只写 draft 的既有回归(`plugin/test/ownership-active-loop.test.mjs`、`plugin/test/ownership-active-limited-proposal.test.mjs`、`plugin/test/ownership-active-proposal-repair.test.mjs`、`plugin/test/ownership-active-slice-adapter.test.mjs`)全绿,本任务 diff 不触碰其判据代码。
- [x] AC6 读数记录(记录,不设 pass/fail 门槛):在本任务 worktree 内跑一次 `node --experimental-strip-types docs/analysis/ownership-active-loop.mjs --live --repair --rounds 1`(默认解析路径),把 repair 结果(outcome / judge_calls / attempts 的 matched 序列)原样追加到 `docs/analysis/ownership-active-proposal-repair-replay.md` 新节;若该轮投研未终于 package-cycle `propose_slice`(修复环按设计不启动)也如实记"未触发"。
- [x] AC7 全量回归绿:`bash scripts/test.sh --for-task gap-ownership-active-repair-legal-dirs-lost-on-archguard-refusal` exit 0。

### AC 逐条核对读数(实现后写,供评审)

- **AC1** — `legalDirs()` = `[...internalNodes(graph)].sort()`,挂在 `NO_REPORT` 与 ArchGuard 自身拒绝两条分支;`PACKAGE_GRAPH_BUILD_FAILED` / `ARCHGUARD_CLI_NOT_FOUND` / `NO_MODULE_GRAPH_IN_ARCHJSON` 三条保持不带。新测 `AC1: ArchGuard's OWN refusal carries detail.valid_dirs …` 断言深等于 `["","a","b","core"]`,**并与 pre-flight 分支的 `valid_dirs` 逐项相等**(证同源同函数);`AC1: the no-report branch …` 覆盖第二条。突变对照:把这一行修复回退后,恰有 2 条定向测试转红(33 条仍绿)⇒ 该测是测量而非回声。
- **AC2** — fixture 的 `moduleGraph` sha256 = `a3946f0828a93ecba114457e1c0586ee17718cc9efa3e910ae3a46829158c9a2`,**等于 carrier 自己记录的 `graph_sha256`**(故可证是生产所判的那张图,非"同 commit 另建一张");`tree_sha` 亦相等;file sha256 = `68e93d1a516e581212dd6843e0297da39a8162863b0670b09897ad86a424f50c`。pre-fix 对照(`detail:null`)→ `abstained` / 0 judge calls / `NO_RECORDED_LEGAL_DIRS`;修复后同一记录 → `attempts[0].judge_called === true`、3 次 judge 调用、3 次重跑 primitive、`NO_RECORDED_LEGAL_DIRS` 不出现。
- **AC3** — 本条按字面是**两条分支**的合成;实测:`attemptRepair` 对上述三种 reason 按**既有分类表**归 `tool_limitation`,在 attempt 0 **按分类**终止(0 judge calls、0 rounds、不带 `detail`);字面的 `NO_RECORDED_LEGAL_DIRS` 分支是**另一条**(可修类拒绝 + 记录无清单),由既有测试 `AC3: a record with NO recorded legal dirs abstains instead of recomputing a list of its own` 覆盖。两条都 fail-closed、都是 0 judge calls。⛔ 未为凑字面而把三种 reason 改判为可修(那正是 DoD 禁止的放宽门限)。详见 replay 报告 §7.3。
- **AC4** — `grep -c valid_dirs plugin/test/ownership-active-proposal-repair.test.mjs` 仍 = 3(三处既有手工注入原样保留;新测一处不注入);`ownership-active-proposal-repair.mjs` 不在本任务 diff 中,`recordedLegalDirs` 一字未改。
- **AC5** — 四文件同跑:110 tests / 0 fail / 4 skip(4 skip 是既有的 `stays`-clause 门控跳过,与本任务无关)。
- **AC6** — 共 5 次 live draw(指定 1 次 + 追加 4 次),**0/5 触发修复环**;5 次的 `envelope.concern_kind` 全为 `null`,`proposed_slice` 全为 `null`,故按设计不启动。已如实记"未触发"。附带读数:其中 4/5 次的 `envelope.concern` 指向**本任务自身的缺陷**——因为 loop 的证据读取用 `git show <run-start commit>:<path>`,`b287ad904` 上修复尚未提交,judge 一直在重新发现未修源码。详见 replay 报告 §7.5。
- **AC7** — `bash scripts/test.sh --for-task gap-ownership-active-repair-legal-dirs-lost-on-archguard-refusal --allow-thin` exit 0(39 tests / 35 pass / 0 fail / 4 skip),scoped-gate cache 已按最终树写下。

## DoD

`docs/analysis/ownership-active-proposal-repair-replay.md` 追加一节"post-merge 独立盲测 + legal-dirs 修复":记录 2026-10-11 联合回归的 post-merge 读数(本 Finding 所列,含 `gap-ownership-active-proposal-repair-loop` AC10 post-merge 半的实测结果:`abstained` / 0 judge calls / `NO_RECORDED_LEGAL_DIRS`)、根因位置、修复后 AC2 的生产形状读数与 AC6 live 读数。⛔ 不改 ArchGuard/archguard 仓库,不放宽任何准入门限或 fail-closed 行为,不让 repair 自行 find/grep 目录,不创建/激活任何 Goal。

## Touches

- docs/analysis/ownership-active-slice-adapter.mjs
- docs/analysis/ownership-active-proposal-repair-replay.md
- plugin/test/ownership-active-slice-adapter.test.mjs
- plugin/test/ownership-active-proposal-repair.test.mjs
- plugin/fixtures/ownership-active-slice/live-ec00fcc00-coverage-gap.json (new)
- tasks/gap-ownership-active-repair-legal-dirs-lost-on-archguard-refusal.md
