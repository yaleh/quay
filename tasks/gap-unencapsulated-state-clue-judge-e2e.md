---
id: gap-unencapsulated-state-clue-judge-e2e
title: unencapsulated-state 端到端：线索器只产 candidate（真实仓库）+ recorded-verdict 判断器拒绝
  memoized/计数器/注册表误报 + Planner semantic-judged 路由（GOAL-911 AC-924）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-semantic-admission-contract-module
goal_ac: AC-924
---
## Proposal

**事实（立案当轮实测，2026-10-23，cwd=/data/home/yale/work/quay）**

1. AC-924 的判据今天红在「测试文件不存在」，不是断言不合格：

```
$ node --test plugin/test/unencapsulated-state-admission.test.mjs; echo exit=$?
Could not find 'plugin/test/unencapsulated-state-admission.test.mjs'
exit=1
```

2. 载体现状（逐字检查）：

```
MISSING docs/analysis/semantic-admission-contract.mjs      ← peer gap-semantic-admission-contract-module 承载（AC-919）
MISSING plugin/scripts/unencapsulated-state-clue.ts
MISSING plugin/scripts/unencapsulated-state-judge.ts
MISSING plugin/test/unencapsulated-state-admission.test.mjs
```

3. Planner 的 semantic 注入口**已存在但零生产传递**：`docs/analysis/ownership-active-limited-proposal.mjs` 的 `evaluateEntryBar(carrierRecords, opts)` 已支持 `opts.semanticAdmission(record, entry) => {admit, verdict, counterfactual}`，且 semantic-judged 路由在读取机械 delta **之前**短路（`evaluateSemanticAdmission`，:550-590）；但 `evaluateCarrier(carrier)`（:813）不接收 opts、`runProposalCli`（:1046 附近）也不传 ⇒ 该注入口今天只被测试文件消费，Planner 路径到不了它。

4. 注册表里的 `unencapsulated-state` 仍是 `mechanized:false` + `detector:"NOT LANDED — …"`（:433-441）；`evaluateEntryBar` 会在 C1 的 `NOT_YET_MECHANIZED` 处短路，到不了 admission 路由。注册表自己的头注释钉了解除条件：「a semantic-judged kind never becomes mechanized ... only by landing the judge」⇒ 本条把 judge 落地后，`mechanized`/`detector` 必须同步更新（⛔ 不是为了变绿而放宽；是机制自身的条件）。

5. 兄弟测试硬钉了 mechanized 集合：`plugin/test/ownership-active-limited-proposal.test.mjs:441` `assert.deepEqual(mechanized, ["design-evolution-regression","package-cycle"])` ⇒ 第 4 条的翻转会让它红，必须**显式**更新这条 pin，并把理由写进任务体（⛔ 不静默）。

**两段管线的交付物**

### A. 线索层 `plugin/scripts/unencapsulated-state-clue.ts`（生产入口，⛔ 不是 fixture-only）

- 机械谓词（只产线索、不做判断）：扫一个 root 下的源文件，数「有状态声明」——模块级 `let` 被重新赋值、`new Map/Set` 且同文件里被 `.set/.add/.delete/.clear` 修改、类实例/私有字段里的可变集合；代理读数 `{statefulDeclarations, mutationSites}`。≥2 ⇒ `state:"candidate"`；否则 `"clear"`；文件读不懂 ⇒ `"not-evaluated"`（硬规则 3b：读不懂不与「扫过且干净」同形）。
- 记录经契约模块的 `clueRecord({kind:"unencapsulated-state", subject, state, proxy_reading, evidence_ref})` 构造 ⇒ `state` 只能取 `CLUE_STATES` 里的值；线索词表里没有 `confirmed`，所以线索层在结构上不可能输出确认。
- CLI：`node --experimental-strip-types plugin/scripts/unencapsulated-state-clue.ts --root <root> --json`，输出 `{records:[...], summary:{candidate:N, clear:M, "not-evaluated":K, confirmed:0}}`；`subject` = root 相对路径。默认扫 `packages/quay/src` 与 `plugin/scripts`，排除 `node_modules` / `.git` / `dist` / worktrees / `plugin/fixtures` / `plugin/test`。

### B. 判断层 `plugin/scripts/unencapsulated-state-judge.ts`（recorded-verdict replay，⛔ 不调用真实 LLM、不 spawn 模型）

- `replayVerdict(candidate, corpus)` 按 `subject` 查 recorded-verdict corpus，经 `judgeRecord({candidate_ref, verdict, rationale, counterfactual})` 构造 ⇒ verdict ∈ `JUDGE_VERDICTS`；`confirmed` 必带非空 `counterfactual`（硬规则 4 推论四：「若不为真则结果不同」），否则具名拒绝。
- 查不到该 subject ⇒ `verdict:"needs-more-evidence"`（⛔ 不默认确认；硬规则 6/3b：没有记录 ≠ 确认）。
- `semanticAdmissionFromJudge(corpus)` 返回 Planner 注入口用的 `(record, entry) => ({admit, verdict, counterfactual})`，`admit = verdict === "confirmed"`。
- corpus 落 `plugin/fixtures/unencapsulated-state/recorded-verdicts.json`，每条 `{subject, verdict, rationale, provenance}`，confirmed 条额外带 `counterfactual`。

### C. Planner 传递 `docs/analysis/ownership-active-limited-proposal.mjs`

- `evaluateCarrier(carrier, opts = {})` 把 `opts.semanticAdmission` 原样传给 `evaluateEntryBar(group, {semanticAdmission})`。
- `runProposalCli` 接受 `deps.semanticAdmission` 并传给 `evaluateCarrier`（真实 CLI body；测试在进程内驱动，不 spawn 模型）。
- ⛔ 不要求 CLI 默认加载判断器：注入方是调用方（recorded-verdict replay 本来就是注入式的）。未注入时该路由必须落在 `CONDITION_1_SEMANTIC_NOT_EVALUATED`（独立取值、fail closed），测试把这条臂也断言出来，⛔ 不静默。

### D. 四个样本 fixture `plugin/fixtures/unencapsulated-state/`（每个文件头写 provenance 指向真实来源）

- `true-state-cluster.ts` — 真状态簇：serve-dashboard 封装前的 snapshot 簇形状（多个 Map + 1 个 `let` 钩子 + clear/rebuild 生命周期函数；来源 `tasks/gap-dashboard-snapshot-store-encapsulate-state.md` 的实测清单；该簇已被 `DashboardSnapshotStore` 收拢 ⇒ 这里 vendored 的是历史真实形状）。
- `memoized-probe.ts` — 误报：memoized 探针（对照 `packages/quay/src/gate/config/loader.ts:61 cachedSink`、`packages/quay/src/observation.ts:387 taskStatusRefCache`）。
- `diagnostic-counter.ts` — 误报：只增不减的诊断计数器（对照 `packages/quay/src/observation.ts:397 singleTaskGitSpawnCount`）。
- `encapsulated-registry.ts` — 误报：已封装注册表（私有字段 + 生命周期方法的 class，对照封装后的 `DashboardSnapshotStore`；以及 `CONCERN_KIND_REGISTRY` 这类 frozen 表）。

### E. 端到端测试 `plugin/test/unencapsulated-state-admission.test.mjs`（顶部 `// @test-group engine`）

- 字面期望表写死在测试里（⛔ 不从 corpus / 模块常量推导，否则同一处改动能同时改绿两边）：`{"memoized-probe":"refuted","diagnostic-counter":"refuted","encapsulated-registry":"refuted","true-state-cluster":"confirmed"}`。
- 断言四件事 + 一条 fail-closed 臂：真实仓库线索；四样本判决；confirmed 的 counterfactual；Planner 路由；未知 subject ⇒ needs-more-evidence。

### 词表的单一正源与静态 import 的安全条件

新脚本**不得**声明第二份 `CLUE_STATES`/`JUDGE_VERDICTS`（AC-919 的 AC6 要求声明恰 1 处）。它们从 `docs/analysis/semantic-admission-contract.mjs` **静态 import**（纯 ESM、零运行时依赖、无 `process.argv[1]` entry guard ⇒ esbuild 会把它内联进 bundle，`build-plugin-dist` 的 `findEntryGuardHijacks` 是这条安全性的 fail-closed 守门）。测试必须钉住这条前提：契约模块源码不含 entry guard（`assert.doesNotMatch(src, /process\.argv\[1\]/)`）——⛔ 若将来契约模块长出 entry guard，先改成 runtime 解析再动 import 形态。

<!-- dedup-ref -->**与同 goal 其它验收面的关系（去重声明）**：`gap-semantic-admission-contract-module`（`goal_ac: AC-919`，ready）只交付契约模块本身、明确「本任务不实现管线」；`gap-c1-admission-dispatch-by-admission-token`（done，AC-918）、`gap-c1-entry-bar-rejects-illegal-admission-value`（done，AC-923）、`gap-concern-kind-registry-admission-field`（done，AC-921）分别只做分派、admission 合法性、注册表字段；`gap-goal911-exit-condition3-unencapsulated-e2e-uncovered`（ready）是立项提案，不实现管线。全库 `grep -rl "goal_ac: AC-924" tasks/*.md` 零命中；`grep -rl "unencapsulated-state" tasks/*.md` 只回到上述**别的验收面**任务与提案 ⇒ 无重复立案。**Touches 去重**：`task-granularity-advice.ts` 对本案 substantive 输入（`docs/analysis/ownership-active-limited-proposal.mjs`）返回 `peers: []`（只有 `mentions: gap-semantic-admission-contract-module`，非 Touches 重叠）⇒ 无 merge 候选，保持独立。

## AC

- [ ] **AC1｜AC-924 criterion 逐字绿 + 红基线可复现。** 用 `node --experimental-strip-types packages/quay/bin/quay.ts goal get AC-924 --json` 取出 `criterion`，把该字符串**逐字**交给 `bash`（⛔ 不手抄、⛔ 不朴素 join），cd 任务 worktree ⇒ exit 0；同一命令在改前载体上的基线是 exit 1 且 stderr 含 `Could not find 'plugin/test/unencapsulated-state-admission.test.mjs'`。三项都贴：提取命令、criterion 全文、exit code + 逐字输出。
- [ ] **AC2｜真实仓库臂（生产入口，非 fixture）。** `node --experimental-strip-types plugin/scripts/unencapsulated-state-clue.ts --root <任务 worktree> --json` exit 0；断言 ① 每条 `record.state` ∈ 从 `docs/analysis/semantic-admission-contract.mjs` import 的 `CLUE_STATES`（⛔ 不用字面字符串子集判断）；② `summary.confirmed === 0`；③ `summary.candidate >= 1`。贴出命令、exit、summary 与 `candidate` 的前 3 条 subject（硬规则 2：计数要配内容）。
- [ ] **AC3｜四样本判决 + 字面期望表 + fail-closed 默认。** `node --test plugin/test/unencapsulated-state-admission.test.mjs` exit 0，且测试文件内的字面期望表是 `{"memoized-probe":"refuted","diagnostic-counter":"refuted","encapsulated-registry":"refuted","true-state-cluster":"confirmed"}`（⛔ 不由 corpus/模块常量推导）；断言 ① 线索器对四个样本都输出 `candidate`（⛔ 无一条 `confirmed`）；② 判断器判决等于字面表；③ 每条 `confirmed` 的 `counterfactual` 非空；④ 未知 subject ⇒ `needs-more-evidence`（⛔ 不是 `confirmed`）。贴测试输出尾部与四条判决原文。
- [ ] **AC4｜Planner 的 semantic-judged 路由（真实 CLI body）。** 测试在进程内调 `runProposalCli({argv, repoRoot, deps:{semanticAdmission: semanticAdmissionFromJudge(corpus)}})`，断言 ① confirmed 候选 `eligible:true`、`reason` 同时含 `admission=semantic-judged` / `verdict=confirmed` / `counterfactual=`；② 其 `matchedConditions` 深等于 `[CONDITIONS.KIND]`（⛔ 不含 DELTA/STREAK/MEMORY）；③ 三个 refuted 样本 ⇒ `reason` 以 `CONDITION_1_SEMANTIC_REFUSED` 开头且含 `verdict=refuted`；④ 该候选的 record 携带一个**完美的机械 `slice_delta` 诱饵**，仍走语义路由（证明机械 delta 从未被读）；⑤ 不注入判断器 ⇒ `CONDITION_1_SEMANTIC_NOT_EVALUATED`（独立取值）。贴五条 reason 原文。
- [ ] **AC5｜反向臂（能取假，实跑，⛔ 不用 `git checkout --` 恢复）。** 先 `cp` 备份，逐条注入并跑 AC1 的 criterion：① 把 corpus 里 memoized 样本的 recorded verdict 从 `refuted` 改成 `confirmed` **并补非空 counterfactual**（绕过 schema 具名拒绝）⇒ 测试必须在「期望 refuted / 实得 confirmed」上红，⛔ 不是红在 schema 校验；② 让线索器对某条记录输出 `state:"confirmed"`（在 `clueRecord` 校验之后注入，绕过构造期拒绝）⇒ 测试在 `state ∈ CLUE_STATES` 断言上红，⛔ 不是红在抛错；③ 删掉测试文件 ⇒ criterion exit 1。三条都贴 exit code 与红在哪个断言；`cp` 回拷后 AC1 复跑 exit 0。
- [ ] **AC6｜注册表解除 + 兄弟 pin 显式更新。** `unencapsulated-state` 条目改 `mechanized:true`、`detector` 指向真实落点（`plugin/scripts/unencapsulated-state-clue.ts` + `plugin/scripts/unencapsulated-state-judge.ts`，⛔ 不再含 `NOT LANDED`）；`plugin/test/ownership-active-limited-proposal.test.mjs:441` 的 mechanized 集合显式加入 `"unencapsulated-state"`；`node --test plugin/test/ownership-active-limited-proposal.test.mjs` exit 0。把翻转理由（注册表头「only by landing the judge」+ 本条已落地 judge）写进任务体 Evidence。
- [ ] **AC7｜注册与 scoped 门。** 两个新 `plugin/scripts/*.ts` 在 `plugin/scripts/capability-catalog-declarations.json` 的 QUESTION / CADENCE / INVALIDATION / LAST_REAFFIRMED / MATCHING 五表各有一条；`bash plugin/scripts/capability-catalog.sh --json` exit 0 且 `unclassified == 0`；`docs/proposals/quay-product-outline.md` 追加一行带日期的 changelog；`bash scripts/test.sh --for-task <本任务 id>` exit 0。贴各命令 exit 与 catalog 的 unclassified 计数。
- [ ] **AC8｜词表单一正源 + 静态 import 的安全前提。** `grep -rn "JUDGE_VERDICTS[[:space:]]*=" docs/analysis plugin/scripts --include=*.mjs --include=*.ts` 命中**恰好 1 处**（契约模块；贴命中数与第 1 条实际内容，硬规则 2）；新脚本里没有任何 `CLUE_STATES`/`JUDGE_VERDICTS` 的第二份声明；测试断言契约模块源码不含 entry guard（`assert.doesNotMatch(src, /process\.argv\[1\]/)`），并贴该断言。

## DoD

1. **真实落地**：线索器在**本仓库真实树**上跑过（生产入口，⛔ 不是 fixture 回显）；四个样本经**真实判断器**判决；confirmed 候选经**真实 `runProposalCli`** 进入 semantic-judged 路由 —— 三层都是生产入口，⛔ 没有测试自造的第二份实现。
2. **判据能取假**：AC5 的三条反向臂实跑并留痕（corpus 改 confirmed ⇒ 红在字面期望；线索输出 confirmed ⇒ 红在词表断言；删测试文件 ⇒ exit 1），⛔ 不以「测试文件存在」或「测试全绿」自证。
3. **单一词表**：`CLUE_STATES`/`JUDGE_VERDICTS` 只在 `docs/analysis/semantic-admission-contract.mjs` 声明一次，两个新脚本 import 使用；契约模块的「无 entry guard」前提被测试钉住。
4. **注册表解除有据且兄弟 pin 同步**：`unencapsulated-state` 的 `mechanized`/`detector` 更新到真实落点，`:441` 的 pin 显式更新，理由写进 Evidence（⛔ 不静默改断言）。
5. **suite**：`bash scripts/test.sh --for-task <本任务 id>` 绿；fan-in 后全量 suite 绿（⛔ 一次 scoped 绿不是全量证据）。
6. **交付落 develop**（fan-in 标准路径），⛔ 不直推 develop。

## Dark Axis

该轴仍暗,理由: 本任务只新增两个叶子脚本 + 四个 fixture + 一条测试，并给既有 Planner 传一个注入口；结构侧唯一新增的边是两条指向**零依赖纯 ESM** 契约模块的边（`plugin/scripts/*` → `docs/analysis/semantic-admission-contract.mjs`），不构成环、不改变包粒度或 god-package 读数；L_D/L_G 无新增可采差分，按 ADR-007 记为仍暗。若 fan-in 后 archguard 报出环或 god-package 变化，另立任务处置，⛔ 不以本段免责。

## Touches

- `plugin/scripts/unencapsulated-state-clue.ts` (new)
- `plugin/scripts/unencapsulated-state-judge.ts` (new)
- `plugin/test/unencapsulated-state-admission.test.mjs` (new)
- `plugin/fixtures/unencapsulated-state/true-state-cluster.ts` (new)
- `plugin/fixtures/unencapsulated-state/memoized-probe.ts` (new)
- `plugin/fixtures/unencapsulated-state/diagnostic-counter.ts` (new)
- `plugin/fixtures/unencapsulated-state/encapsulated-registry.ts` (new)
- `plugin/fixtures/unencapsulated-state/recorded-verdicts.json` (new)
- `docs/analysis/ownership-active-limited-proposal.mjs`
- `plugin/test/ownership-active-limited-proposal.test.mjs`
- `plugin/scripts/capability-catalog-declarations.json`
- `docs/proposals/quay-product-outline.md`
- `tasks/gap-unencapsulated-state-clue-judge-e2e.md`

⛔ `docs/analysis/semantic-admission-contract.mjs` **不在**本任务 Touches：它由 peer `gap-semantic-admission-contract-module`（AC-919）交付，本条只消费、不改写（写它就与 peer 的验收面重叠）。