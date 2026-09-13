---
id: gap-adr007-per-milestone-dark-axis-enforcement-gate
title: 兑现 ADR-007 的 per-milestone 暗轴记录承诺——todo→ready/ready→done 门加机械检查
status: ready
labels:
  - gap
  - finding
parent: null
children: []
extra:
  schema: finding
---
**type:** finding

## Finding

`adr/ADR-007-instrument-the-dark-axes-lg-ld-ls.md` 的 enforcement 注释自 2026-07-20 起写明「per-milestone predicate」(检查里程碑/任务的 DoD 是否记录了一次 L_D/L_G 读数、或显式的"该轴仍暗"声明,三者皆缺则 fail-closed)仍是 **STILL FUTURE WORK**——两个月过去从未落地。

`experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh` 自 2026-07-22 起未再被改动,它只验证"仪器自身没腐烂"(RED/GREEN fixture 回归),从未验证"某个具体任务真的看过它"。`exp5-M-CRYST-G1`(已 done)证明了三个探针脚本(`plugin/scripts/git-lens-l-d-code-doc-ratio.ts` / `git-lens-l-g-structural-drift.ts` / `git-lens-l-s-behavior-variance.ts`)本身可用、且已回收进 `plugin/scripts/`(`gap-experiment-legacy-reclaim-and-touches-heuristic`),`gap-archguard-zero-production-calls` 也证明了 archguard 现在能真实调用并产出结构信号——但**这两组已落地的工作只解决了"仪器能用",从未解决"todo→ready / ready→done 的门是否强制要求任务体记录过一次读数"**。立案前搜索(`task_list` 搜 "ADR-007"/"per-milestone"/"dark axes"/"per-milestone predicate")均未命中覆盖这个具体机制缺口的任务。

`docs/references/维度边界与结晶——从熔融实现中发现原则.md` §10.3/§10.4 进一步指出:量化读数如果不接进一个会 fail-closed 的判据,就永远停留在"仪器学论文"层面,不会真正影响任务能否落地。

**更正(2026-09-13 实现落地时实测):** 上面「三个探针已回收进 `plugin/scripts/`」这一句已不再成立,且与本题的读法有关——三个探针于 2026-09-07 被移入 `archive/2026-09-07-zero-call-scripts/plugin/scripts/`,`experiments/quay-perpetual-stream/scripts/git-lens-*.ts` 已成**悬空符号链接**,`git-lens-selfcheck.sh` 现在 exit 1(其 prose-heavy L_D fixture 仍打印 PASS,因为 MODULE_NOT_FOUND 也 exit 1、恰好等于该 case 的期望码——硬规则 3b 的形态:读不懂输入退回了与合格同形的值)。归档副本也无法直跑(其依赖 `gate-script-base.ts` 未被一并归档)。⇒ 本题按 ADR 原文允许的**两条路**实现(读数 **或** 显式声明),读数改用仍然活着的 L_D/L_G 仪器 `plugin/scripts/archguard-runner.ts`。探针本身的修复是另一个任务的范围,本题只在 ADR 注释里记录,不静默吸收。

## Acceptance Criteria

- [x] AC1: 新增一个可独立调用的检查器(建议 `plugin/scripts/dark-axis-record-check.ts`,登记进 `plugin/scripts/capability-catalog.sh`),对给定任务 id 输出三态之一:`RECORDED`(任务体含可解析的 L_D/L_G 读数,须打印解析到的具体数值)、`DISCLAIMED`(任务体含显式"该轴仍暗,理由:..."声明)、`MISSING`(两者皆无)。命令:`node --experimental-strip-types plugin/scripts/dark-axis-record-check.ts <task-id>`;`RECORDED`/`DISCLAIMED` → exit 0,`MISSING` → exit 1。
- [x] AC2(负控制): 该检查接入 ready→done 的落地路径(`packages/quay/src/gate/registry.ts` 新注册一个 named gate,或接入 `packages/quay/src/gate/lifecycle.ts` 的 `runComplete`/`runPromote` 路径)。造一个 `status: ready`、任务体既无暗轴读数也无"该轴仍暗"声明的任务,对它调用 `lifecycle_complete`(或等效 `quay complete <id>` / `gate_run --gate <新门名>`)必须返回 `ok:false`,且 `task_get` 读回其 `status` 仍是 `ready`(未被写成 `done`)。
- [x] AC3(正控制): 同一任务补一条真实 L_D/L_G 读数(例如粘贴一次 `git-lens-l-g-structural-drift.ts` 或 archguard 的实际输出数值)或补一条显式"该轴仍暗,理由:..."声明后,同样的 gate 调用必须返回 `ok:true` 并成功写 `status: done`。
- [ ] AC4(生产载体读数,防 fixture-only 满足): 落地后,至少 1 个真实(非本任务自身、非测试 fixture)任务经由该 gate 完成过 ready→done 转换,且其记录的暗轴读数/声明产生时刻晚于本任务实现落地的 commit——验证:比较该任务体读数段落引用的 commit/时间戳与 `git log -1 --format=%H -- packages/quay/src/gate/registry.ts`(或实际改动的实现文件)的落地 SHA,且 `.quay/gate-events.jsonl` 中存在一条该任务的 complete/promote GateEvent,其时间戳晚于落地时刻。若把该 gate 检查关掉后同一 AC 仍能被满足(即读数是靠 fixture/注入数据单独撑起来的),则本 AC 判假(呼应 `gap-phase-boundary-differential-accounting` 的教训——不能只让 fixture 注入满足)。（待外部）

## Definition of Done

- 一个真实机件(gate registry/lifecycle 路径)对 todo→ready 或 ready→done 强制要求暗轴读数或显式声明,fail-closed;AC1-4 全部勾选,AC4 的生产载体读数必须来自实现落地**之后**的真实调用,不能只由本任务自己的测试 fixture 满足;
- `adr/ADR-007-instrument-the-dark-axes-lg-ld-ls.md` 的 enforcement 注释从"STILL FUTURE WORK"改写为指向本任务落地的真实文件/函数;
- 涉及改动的测试套件(`scripts/test.sh`)在改动后至少连续 2 次绿。

### 落地证据(2026-09-13)

- **机件**:唯一判定 `classifyDarkAxisRecord` 落在 `packages/quay/src/gate/dark-axis-record.ts`(Core,纯函数、无 I/O);三个面共用它——(i) 内置门 `dark-axis`(`packages/quay/src/gate/registry.ts`);(ii) **ready→done 强制点** `enforceDarkAxis`(`packages/quay/src/gate/lifecycle.ts`,`runComplete` 与 `runCompleteLoop` 都在 acceptance 计量之前跑它,fail-closed);(iii) 独立 CLI `plugin/scripts/dark-axis-record-check.ts` + `ready-pool-check.ts` 池报告里的 `dark_axis` 三态清单。
- **开关**:工作区自己的 `gates.adr` 声明 `ADR-007`(与已有的 instrument-integrity 半边同一处声明,`workspaceEnforcesDarkAxis`)。本仓库 `.quay/config.yml` 已声明它 ⇒ 本题在本工作区**生效**;测试套件构造的临时工作区不声明任何 ADR ⇒ 既有 lifecycle 用例不受影响。
- **三态与 3b**:`RECORDED`(轴 token 在行首 + 同行/缩进续行内有**数值**量) / `DISCLAIMED`(显式「该轴仍暗,理由:…」,**必须带理由**) / `MISSING`;不可读的 body 给独立取值 `NOT-EVALUATED`(exit 2,门的 fail 理由里可区分),不与 MISSING 或 RECORDED 共用输出。
- **按位置不按关键词**(硬规则 2):~51 个任务体已有 L_G/L_D **散文**提及。负控制实测:`L_G (ADR-007) 未测`、`L_G 记录于 2026-09-13 12:30 尚未测量`、`本任务未记录 L_G: cycles=0`、`L_G 是最暗的轴（见 ADR-007 §5）` **全部 MISSING**;而真实探针输出 `L_D code:doc — docLines=812 codeLines=6500 ratio=1:8 verdict=PROSE_HEAVY` → RECORDED `[812,6500,1,8]`。
- **AC2 实测**(在声明 ADR-007 的临时工作区跑真 CLI):`quay complete T-norecord` → `FAIL — dark-axis …: MISSING`,exit 1,`status: ready` 未变,`.quay/gate-events.jsonl` 追加一条 `dark-axis fail`。
- **AC3 实测**(同一任务):补显式声明 → `PASS — status=done`(exit 0);另一任务补真实读数(`- [x] L_G structural-drift … cycles found: 0 god-modules found: 0`,复选框前缀的 DoD 条目形态)→ 同样 `PASS — status=done`。事件序列 `dark-axis fail → dark-axis pass → acceptance pass → complete pass`。
- **本任务自己的暗轴读数**(活仪器 `plugin/scripts/archguard-runner.ts`,本次实测):`packages/quay/src` sccCount=0 entities=633 relations=1229 maxInDegree=200 maxOutDegree=67;`plugin/scripts` sccCount=0 entities=2842 relations=2670 maxInDegree=122 maxOutDegree=84;`quay-native-src`/`quay-github-src`/`quay-backlog-src`/`experiments-scripts` 全 sccCount=0 ⇒ verdict **PASS(无依赖环)**。即 ADR-007 问的 L_D/L_G「无新环」这一条,在本改动上为真。
- **已知不覆盖(明写而非含糊)**:机械 fan-in 的翻 done 由 `worker-driver.ts` 自己改 frontmatter、不走 lifecycle 动词 ⇒ 它仍可让一个没记录任何暗轴内容的任务落地。这是 driver 侧的改动,属另一个任务范围;已写进 ADR 注释。
- **新增前置的发生率读数**(硬规则 12):落地当时池报告 `dark_axis` = recorded 0 / disclaimed 0 / **missing 6**(6 个 ready 任务),即该前置目前会让 6 个在飞任务在 `quay complete` 上被拒;它们各自补一行声明即可通过(设计如此:ADR 原文的「or an explicit 'axis still dark' note」)。

## Touches

- adr/ADR-007-instrument-the-dark-axes-lg-ld-ls.md
- plugin/scripts/dark-axis-record-check.ts
- plugin/scripts/capability-catalog.sh
- packages/quay/src/gate/dark-axis-record.ts
- packages/quay/src/gate/registry.ts
- packages/quay/src/gate/lifecycle.ts
- plugin/scripts/ready-pool-check.ts
- plugin/test/dark-axis-record-check.test.mjs
- tasks/gap-adr007-per-milestone-dark-axis-enforcement-gate.md
