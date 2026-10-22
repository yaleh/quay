---
id: gap-adr007-half1-selfcheck-probes-archived-and-gate-never-invoked
title: ADR-007 HALF 1 的 enforcement 指向一个确定性失败的仪器：git-lens-selfcheck.sh
  调用的三个探针已归档，7 例里 3 例因 MODULE_NOT_FOUND 的 exit 1 恰好等于期望值而打印 PASS；且 adr-007
  门只能按名手动调用，载体中 0 条事件
status: ready
labels:
  - gap
  - defect
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**事实一：仪器确定性失败，且失败形态与「探针判对了」同形**（2026-10-22 实测）。
`adr/ADR-007-instrument-the-dark-axes-lg-ld-ls.md` frontmatter `enforcement: "bash experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh"`。
命令 `bash experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh; echo EXIT=$?` ⇒ `EXIT=1`。7 个夹具用例里：
- **3 例打印 PASS**：`l-d/prose-heavy`、`l-g/cycle-repo`、`l-s/weak-module`——三者期望 exit 1，而 `node scripts/git-lens-l-*.ts` 因文件不存在抛 `MODULE_NOT_FOUND` 也是 exit 1。ADR-007 自己的注释（2026-09-13）只记了 prose-heavy 一例；实测是 3 例。
- **4 例 FAIL**：code-heavy、empty、clean-repo、strong-module（期望 0，得 1，输出均为 `Cannot find module …/experiments/quay-perpetual-stream/scripts/git-lens-l-*.ts`）。
- 三个探针 `git-lens-l-d-code-doc-ratio.ts` / `git-lens-l-g-structural-drift.ts` / `git-lens-l-s-behavior-variance.ts` 只剩 `archive/2026-09-07-zero-call-scripts/plugin/scripts/` 下的归档副本；experiments 下原有的悬空软链已被删（`ls experiments/quay-perpetual-stream/scripts/git-lens-*` 只剩 selfcheck 本身）。**归档副本也跑不起来**：`node --experimental-strip-types archive/2026-09-07-zero-call-scripts/plugin/scripts/git-lens-l-d-code-doc-ratio.ts --numstat-file fixtures/git-lens/l-d/code-heavy.numstat` ⇒ `ERR_MODULE_NOT_FOUND …/archive/…/gate-script-base.ts`，exit 1。
- 这就是硬规则 3b 的形态：判定脚本「读不懂输入（探针没加载）」时返回了与「探针检出」同形的值。

**事实二：`adr-007` 门从未产生过一条事件，原因是没有任何自动路径调用按名注册的配置门。**
- `.quay/config.yml` `gates.adr: ["ADR-001", "ADR-007"]` 经 `packages/quay/src/gate/config/loader.ts:404-408` 注册为 `adr-001` / `adr-007`（`makeAdrGate`，`packages/quay/src/gate/factories/adr.ts`）。
- 这类门只能按名取用（`packages/quay/src/gate/registry.ts:84`），调用面只有 `quay gate <task> --gate <name>`（`packages/quay/src/cli/gate.ts:164`）与 MCP `gate_run`（`packages/quay/src/mcp-handlers.ts:608`）。lifecycle 动词只跑 `acceptance` / `dark-axis` / `dod`（`lifecycle.ts:278/332/397/549`），`loop.gates: [acceptance]`（config.yml:114），机械 fan-in 不调用 `runGate`。
- 读数：`grep -c '"gate":"adr-007"' .quay/gate-events.jsonl` ⇒ 0（载体 619,083 行）。同一方法统计其它配置门：`adr-001`、`impl-row`、`line-budget`、`anti-gaming`、`tree-hygiene`、`ts-typecheck` 等 16 个 it0/fixed 门全部 0 条（`ts-typecheck` 由 `fan-in-ts-typecheck-gate.ts` 直接运行、不经门引擎，所以对它而言「0 事件」≠「从未运行」）。**来源完备性（硬规则 5）**：该载体首条记录是 2026-08-12T10:41:26Z，而 adr-007 门 2026-07-20 接线；2026-07-20 至 2026-08-12 之间的事件无从查证。
- 干跑确认门现在会判什么：MCP `gate_run {id:<任一任务>, gate:"adr-007", dryRun:true}` ⇒ `ok:false`，`acceptance failed (exit 1)`，且确认 dryRun 未追加事件（之后 grep 计数仍为 0）。

**约束（不随方案而变）**：`gates.adr` 中的 `ADR-007` 声明同时是 HALF 2（per-milestone dark-axis 判定）的开关（`lifecycle.ts:261` `workspaceEnforcesDarkAxis`）。**不能用「从 gates.adr 删掉 ADR-007」来退役 HALF 1**——那会同时关掉 HALF 2。另外 `.quay/config.yml` 被 gitignore（`.gitignore:587`），本任务的改动不应依赖修改它。

<!-- dedup-ref -->
**立案检查**：按机制 grep 了 `tasks/*.md` 中 status ≠ done 的任务（`git-lens-selfcheck`、`adr-007`、`gates.adr`），没有在开任务修这个仪器。最近的在开任务是通用的仪器暗态检测器（`gap-instrument-decay-check-unwired-and-blind-to-content-dark`），它把本仪器的腐烂当作历史先例引用，不修它——机制不同，分开立案。合并判断（`task-granularity-advice.ts --touches …` 实测）：peers 为它与 `gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts`，共享文件仅 `plugin/scripts/quality-gate-driver.ts`；机制不同，结论 separate，由调度器按 Touches 串行。

## Plan

1. **selfcheck 改为三态**：每个用例在调用探针前先确认探针入口可解析，并在输出里区分 `PASS` / `FAIL` / `NOT-EVALUATED(probe-not-loaded: <path>)`。退出码：全 PASS ⇒ 0；有 FAIL ⇒ 1；无 FAIL 但有 NOT-EVALUATED ⇒ 2。⛔ 不允许「探针未加载」的 exit 1 被计作期望 exit 1 的 PASS。
2. **把 L_D、L_G 用例改指向活着的仪器**（不复活归档探针）：
   - L_D：`plugin/scripts/phase-declare.ts` 的 `parseNumstat` + `computeRatio`（gap-adr008-phase-state-mechanization-minimal 时逐字重实现的同一规则，`ratio>3.0 ∧ docLines>20` 为 flagged）。给它加一个只读模式 `--ld-reading --numstat-file <f> --json`（不写 `.quay/two-phase-state.json`），让三个既有 l-d 夹具对它运行。
   - L_G：`plugin/scripts/archguard-runner.ts` 的 `readDirectoryCycleReading(root, workDir)`，传入夹具 workDir（`<workDir>/query/manifest.json` + `<workDir>/query/<hash>/arch.json` 的形状，一个 moduleGraph 有环、一个无环）。⚠️ 汇总值要求全部 6 个 SCOPES 都评估成功，夹具只造一个 scope 时汇总必为 `evaluated:false`——所以 selfcheck 读返回值里**该 scope 的分项**（`scopes[]` 中 source 匹配的那一条），不读汇总。只读、不 spawn archguard，不改 archguard-runner.ts。
   - L_S：本仓库**没有**针对产品代码的活仪器（`checker-mutation-check` 变异的是检查器，不是产品代码）。L_S 用例改为显式 `NOT-EVALUATED(axis-retired: no living product-code L_S instrument)`，并在 ADR-007 的 enforcement 注释里写明；⛔ 不为了让 selfcheck 变绿而删用例。
3. **ADR-007 文本**：经 `quay adr` / `adr_write` 修订 enforcement 注释里的 HALF 1 段落，写明新的仪器指向、L_S 已退役的事实，并把「3 例假 PASS」更正进 KNOWN ROT 记录。frontmatter 的 `enforcement:` 命令字串可以保持不变（脚本路径不变）。
4. **让 adr 门有调用者**：在 `plugin/scripts/quality-gate-driver.ts` 增加一个只读的声明式例程（同 arch_cycle_report 一族，缺省间隔 1440m），对工作区 `gates.adr` 中每个 accepted 且带 `enforcement` 的 ADR 经门引擎 `runGate` 运行一次，写 GateEvent（actor 标为该例程），并在 quality-round 写一个 Fact（状态在 PASS / FAIL / NOT-EVALUATED 三值中取一，与 selfcheck 退出码一一对应）。⛔ 不进 fan-in 热路径。
5. **未处理的同族现象只记录不修**：16 个 it0/fixed 配置门同样 0 事件。在本任务 Evidence 里列出这份清单与读数，作为观察项交给人裁定，不在本任务里接线。

## Acceptance Criteria

- [x] AC1 假 PASS 消失（负对照）：在一个临时副本里把 selfcheck 用到的任一探针入口改名（模拟探针未加载），`bash experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh` 对该轴打印 `NOT-EVALUATED(probe-not-loaded…)`，输出中**没有**任何一行 `PASS:` 属于该轴，退出码为 2。改动前的同一操作得到 `PASS: l-d/prose-heavy`（贴出改动前后两次输出与退出码）。
- [x] AC2 L_D 指向活仪器且能判对两个方向：在真实仓库运行 selfcheck，`l-d/prose-heavy` 为 PASS（期望 flagged），`l-d/code-heavy` 与 `l-d/empty` 为 PASS（期望 not flagged）；把 `phase-declare.ts` 的 `computeRatio` 阈值临时改成恒不 flagged（临时副本中），`l-d/prose-heavy` 变 FAIL（贴出三次输出）。
- [x] AC3 L_G 指向活仪器且能判对两个方向：有环夹具 PASS（检出 ≥1 个目录环并列出成员），无环夹具 PASS（0 环）；把有环夹具的 moduleGraph 删掉后，该用例报 `NOT-EVALUATED` 而不是 PASS 或「0 环」（贴出三次输出）。
- [x] AC4 selfcheck 在真实仓库上的整体读数：L_D 3 例与 L_G 2 例全 PASS，L_S 2 例为 `NOT-EVALUATED(axis-retired…)`，退出码为 2；同一次运行的 stdout 中 `MODULE_NOT_FOUND` 出现 0 次（贴出完整输出）。
- [ ] AC5 门引擎产出真实事件（生产载体）：在主检出上由 `plugin/scripts/quality-gate-driver.ts --root /data/home/yale/work/quay --once` 跑一轮且新例程 due（未 due 时贴出 `.quay/routine-last-run.json` 中该键的读数，等下一个常驻轮次产出后再取），`.quay/gate-events.jsonl` 中 `"gate":"adr-007"` 的条数由 0 变为 ≥1，该事件的 verdict 与 AC4 的退出码一致（2 ⇒ 非 pass 且 reason 含 NOT-EVALUATED），同轮 `.quay/quality-round.jsonl` 有一条对应 Fact。贴出跑之前的 grep 计数、事件行与 Fact 行。（待外部）
- [x] AC6 HALF 2 未被连带关掉：`node --experimental-strip-types -e` 调 `workspaceEnforcesDarkAxis("/data/home/yale/work/quay")` 仍返回 `true`；`grep -n '"ADR-007"' .quay/config.yml` 仍命中（贴出两条输出）。

## Definition of Done

- [ ] 六条 AC 全绿，`scripts/test.sh` 相关泳道（含 `--for-task` scoped 静态检查）通过，合并进 develop。（待外部）
- [x] 归档目录 `archive/2026-09-07-zero-call-scripts/` 未被改动或复活；L_S 的退役是显式记录，不是删用例。
- [x] ADR-007 的 KNOWN ROT 段落已更正（3 例假 PASS，不是 1 例），并写明 HALF 1 的新仪器指向；新例程不在 fan-in 路径上运行。
- [x] 16 个 0 事件的 it0/fixed 配置门清单与读数写入 `## Evidence`，作为观察项，未在本任务中接线。

## Evidence

**Dark-axis record（本任务自己的 ADR-007 HALF 2 判据，2026-10-22 实测）**
- L_D phase-declare takeLdReading（worktree，range=HEAD~50..HEAD）：docLines=1248 codeLines=1414 ratio=0.883 flagged=false
- L_G archguard-runner readDirectoryCycleReading（主检出 .archguard/query）：evaluated scopes=4/6；src cycles=0；scripts cycles=0；quay-native-src cycles=0；experiments-scripts cycles=0；quay-github-src / quay-backlog-src 的 arch.json 无 extensions.tsAnalysis.moduleGraph ⇒ 汇总 totalCycleCount=null（硬规则 3b：⛔ 不把「读不出」记成 0 环）

**AC1（假 PASS 消失，负对照）**
改动前（develop 的旧 selfcheck；探针文件不存在——与真实仓库同形；用 develop 的脚本 + 本仓库夹具在临时副本中跑）：
```
PASS: l-d/prose-heavy — exit 1 (expected 1)          ← 假 PASS
FAIL: l-d/code-heavy — exit 1 but EXPECTED 0 … Cannot find module '…/git-lens-l-d-code-doc-ratio.ts'
PASS: l-g/cycle-repo — exit 1 (expected 1)           ← 假 PASS
FAIL: l-g/clean-repo — exit 1 but EXPECTED 0 … Cannot find module '…/git-lens-l-g-structural-drift.ts'
FAIL: l-s/strong-module — exit 1 but EXPECTED 0 … Cannot find module '…/git-lens-l-s-behavior-variance.ts'
PASS: l-s/weak-module — exit 1 (expected 1)          ← 假 PASS
EXIT=1
```
⇒ 实测正是 **3 例假 PASS**（Proposal 的读数；ADR-007 旧注释只记了 1 例）。

改动后（新 selfcheck，把 `plugin/scripts/phase-declare.ts` 在临时副本中改名以模拟探针未加载）：
```
NOT-EVALUATED(probe-not-loaded: …/plugin/scripts/phase-declare.ts) l-d/prose-heavy
NOT-EVALUATED(probe-not-loaded: …/plugin/scripts/phase-declare.ts) l-d/code-heavy
NOT-EVALUATED(probe-not-loaded: …/plugin/scripts/phase-declare.ts) l-d/empty
…
EXIT=2
```
⇒ 该轴 0 行 `PASS:`，退出码 2；「探针没加载」再也不可能落进「期望 exit 1」的 PASS 分支。
（另有一条自动化负对照：`plugin/test/git-lens-selfcheck.test.mjs` — 探针缺失 + moduleGraph 缺失两个 shadow，断言无 PASS、exit 2。）

**AC2（L_D 活仪器，两个方向）**
- 真实仓库：`PASS: l-d/prose-heavy — exit 1 (expected 1)`、`PASS: l-d/code-heavy — exit 0 (expected 0)`、`PASS: l-d/empty — exit 0 (expected 0)`（见 AC4 全文）。
- 临时副本把 `computeRatio` 的阈值改成恒不 flagged（`FLAG_THRESHOLD = 1e9`）：
```
FAIL: l-d/prose-heavy — exit 0 but EXPECTED 1. Output: { … "docLines": 240, "codeLines": 7,
  "ratio": 34.285714285714285, "verdict": "PASS", "flagged": false }
PASS: l-d/code-heavy — exit 0 (expected 0)
PASS: l-d/empty — exit 0 (expected 0)
```
⇒ 读数真的跟着阈值走（不是恒真/恒假的自证）。

**AC3（L_G 活仪器，两个方向 + 读不懂）**
- 真实仓库：`PASS: l-g/cycle-repo — exit 1 (expected 1) — count=1 members=["packages/quay/src/cycle-a.ts -> packages/quay/src/cycle-b.ts"]`
- 真实仓库：`PASS: l-g/clean-repo — exit 0 (expected 0) — count=0 members=[]`
- 临时副本删掉有环夹具的 `extensions.tsAnalysis.moduleGraph`：`NOT-EVALUATED(reading-unavailable: … has no extensions.tsAnalysis.moduleGraph … — directory-level cycles are NOT evaluated (not "0 cycles")) l-g/cycle-repo`（⛔ 既不是 PASS 也不是「0 环」）

**AC4（真实仓库整体读数，完整 stdout）**
```
== L_D code:doc ratio ==
PASS: l-d/prose-heavy — exit 1 (expected 1)
PASS: l-d/code-heavy — exit 0 (expected 0)
PASS: l-d/empty — exit 0 (expected 0)

== L_G structural-drift (directory-level moduleGraph cycles) ==
PASS: l-g/cycle-repo — exit 1 (expected 1) — count=1 members=["packages/quay/src/cycle-a.ts -> packages/quay/src/cycle-b.ts"]
PASS: l-g/clean-repo — exit 0 (expected 0) — count=0 members=[]

== L_S behavior-variance ==
NOT-EVALUATED(axis-retired: no living product-code L_S instrument (the archived behavior-variance probe is not revived)) l-s/strong-module
NOT-EVALUATED(axis-retired: no living product-code L_S instrument (the archived behavior-variance probe is not revived)) l-s/weak-module

NOT-EVALUATED: at least one axis could not be judged (see the NOT-EVALUATED lines above).
      This is NOT 'all fixtures passed' — exit 2 is the ADR-007 enforcement contract for it.
EXIT=2
```
`grep -c MODULE_NOT_FOUND` 同一输出 ⇒ **0**。

**AC5（门引擎真实事件）— 待外部**
- 跑前读数：主检出 `/data/home/yale/work/quay/.quay/gate-events.jsonl` 619,734 行，`grep -c '"gate":"adr-007"'` ⇒ **0**。
- 生产代码路径（真 kernel：loader → makeAdrGate → runAcceptance → appendGateEvent，无替身）已在 worktree 端到端跑通（`quality-gate-driver.ts --root <worktree> --once`）：
  - 装配行：`adr-enforcement-report 例程已装配（enabled, interval=1440m，未声明 loop.adr_enforcement_report ⇒ 缺省节奏（default-on…）；report-only…）`
  - 引擎写的 GateEvent：`{"gate":"adr-007","actor":"adr-enforcement-report","verdict":"fail","payload":{"reason":"acceptance failed (exit 2) — … NOT-EVALUATED: at least one axis could not be judged …"}}`（verdict=非 pass；reason 含 NOT-EVALUATED，与 AC4 的 exit 2 一一对应）
  - 同轮 quality-round Fact：`{"name":"adr-enforcement-report","state":"not-evaluated","reason":"not-evaluated:selfcheck-exit-2 — ADR-007 …"}`，value.gates=[ADR-001 pass, ADR-007 exitCode=2]
- ⛔ **为什么不在主检出上取这条读数**：主检出（author）跑的是 develop 的代码；本任务的 selfcheck 只存在于本分支/worktree。gate 的 `enforcement:` 命令是在**被测工作区自己的 cwd** 里执行的，所以在主检出上跑一轮只会得到旧 selfcheck 的 exit 1（reason 里没有 NOT-EVALUATED）——把那一行贴成 AC5 的事件就是伪造生产证据（硬规则 4 推论三：不能把「实现了、测试绿了」当「生产跑了」）。真实读数只能在本任务落地（fan-in ff develop）且 promotion-driver 的 `syncDevelopToDoc` 把主检出快进到 develop 之后出现。
- 承接者（自动，无需人打开开关）：`adr-enforcement-report` 例程 **DEFAULT-ON**、间隔 1440m。调度状态是**进程内内存**（不落 `.quay/routine-last-run.json`——那是 probe 轨道的载体），所以主检出上任意一次 `quality-gate-driver --once` 或常驻轮次都 **due**。落地后的核对命令：
  `node --experimental-strip-types plugin/scripts/quality-gate-driver.ts --root /data/home/yale/work/quay --once`
  然后 `grep -c '"gate":"adr-007"' /data/home/yale/work/quay/.quay/gate-events.jsonl`（应 ≥1）与 `tail -1 /data/home/yale/work/quay/.quay/quality-round.jsonl`（facts 里应有 `adr-enforcement-report`）。

**AC6（HALF 2 未被连带关掉）**
```
workspaceEnforcesDarkAxis(/data/home/yale/work/quay) = true
64:    - "ADR-007"   # dark-axis instrument regression gate (git-lens-selfcheck); wired 2026-07-20
```

**观察项：其它 0 事件的配置门（未在本任务接线，交人裁定）**
2026-10-22 主检出 `.quay/gate-events.jsonl`（619,7xx 行）按 `"gate"` 计数，`gates:` 里声明的 **16 个非 ADR 门**全部 0 条：
- it0（6）：impl-row 0 · line-budget 0 · vmeta-lag 0 · audit-independence 0 · dogfood-evidence 0 · drivable-workspace 0
- fixed（6）：delivery-standalone-smoke 0 · anti-gaming 0 · loadbearing-test 0 · tree-hygiene 0 · worktree-branch-hygiene 0 · build-evidence 0
- testPass（4）：it0-dod-check-tests 0 · ts-typecheck 0 · split-or-commit 0 · enforcement-with-design 0
另有 `adr-001` 0 / `adr-007` 0（本任务的新例程覆盖 adr 一族）。注意 `ts-typecheck` 由 `fan-in-ts-typecheck-gate.ts` 直接运行、不经门引擎 ⇒ 对它「0 事件」≠「从未运行」；其余各门是否也有别处的直接调用者，仍是待判的观察项。

**本轮（第 2 轮）suite-red 修复 — 两条 task-introduced red（2026-10-22）**
上一轮机械 fan-in 的 suite 在 baseline A/B 里读出 `added=plugin/test/probe-routine.test.mjs,plugin/test/sh-census-check.test.mjs`。两条都不是环境抖动：重跑复现，且各自都能追到本分支的一次真实变更。
1. `plugin/test/probe-routine.test.mjs` — 该用例把 driver 的默认例程表**钉成一个字面清单**（当时五条）。本任务新增的 `adr-enforcement-report` 是 **DEFAULT-ON 的第六条**（这正是它的设计：段缺席也装配），所以清单必须跟着它走。断言改为六条（`adr-enforcement-report` 排在 `sort()` 后的首位），注释写明第六条及其在空 fixture root（无 `gates.adr`）上的形态 = 一条 `not-evaluated` 读数。⇒ 该文件 32/32 绿。
2. `plugin/test/sh-census-check.test.mjs` AC6 — 判据是「**已提交基线 == 活体读数**」，不是「≤」。本任务把 L_D/L_G 的读数搬进 `git-lens-instrument.mjs` 之后，`git-lens-selfcheck.sh` 不再在**命令位置**调用解释器 ⇒ 它**离开**了 embedded-interpreter 轴（65 → 0 计行数；同时该文件本身 65 → 87 物理代码行，所以不是压行作弊）。基线按只降不升的棘轮规矩**下调** 6566 → 6501，逐项归因写进 `_reanchorLog`。非手拟合证据：用 checker 自己的 `countCodeLines`/`extractEmbeddedInterpreters` 跑 `git show develop:experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh` 得 65 计行数 + `embedded:[node]`，**正好等于 6566 − 6501**。⇒ 该文件 22/22 绿。
- 这两条新写入（`plugin/test/probe-routine.test.mjs`、`plugin/sh-census-baseline.json`）已按纪律声明进 `## Touches`，不是「跑红了再补声明」以外的手工绕过。
- 合并 develop 时 `adr-enforcement-report` 与 develop 新增的 `instrument-decay` 例程在同一个 options 接口 / 例程表 / 测试文件上冲突 ⇒ 按**语义并集**解决：两条例程同时保留（`adrEnforcementRoutine` = 第十四类，`instrumentDecayRoutine` = 第十五类），测试文件保留两侧用例块。合并后 `plugin/test/quality-gate-driver.test.mjs` 114/114 绿。
- 合并后 scoped gate：`bash scripts/test.sh --for-task gap-adr007-half1-selfcheck-probes-archived-and-gate-never-invoked --allow-thin` ⇒ `GATE_EXIT=0`（**180 tests / 180 pass / 0 fail**）。

**DoD 读数**
- `bash scripts/test.sh --for-task gap-adr007-half1-selfcheck-probes-archived-and-gate-never-invoked --allow-thin` ⇒ `GATE_EXIT=0`（**180 tests / 180 pass / 0 fail**；scoped 静态检查全 PASS，含 `sh-census-check`：embeddedInterpreterLines=**6501 == 6501**——基线已按 AC6 的「相等」语义同轮下调，不再是「≤ 6566」）。
- `anti-drift-touches-check.ts --task <id> --worktree <wt> --merge-target develop` ⇒ `ANTI-DRIFT OK — … actual file(s), all within declared Touches`（修 red 前它报的正是那 2 个未声明文件，逐条枚举，⛔ 不是一句光秃秃的 HARD FAIL）。⚠️ actual 计数跟着 develop 走（本次两次实测 17 → 再合并最新 develop 后 16），**不变量是「全部落在声明的 Touches 内」**，⛔ 不要把 16/17 当常量。
- `git diff develop -- archive/` 为空；`archive/2026-09-07-zero-call-scripts/` 未被改动或复活。
- L_S 两个用例仍在（各自 NOT-EVALUATED），未被删除。
- `grep -rn 'adr-enforcement' plugin/scripts/worker-fan-in.ts` ⇒ 0 命中（新例程不在 fan-in 路径上）。
- 仪器实现说明：读数逻辑在 `experiments/quay-perpetual-stream/scripts/git-lens-instrument.mjs`（程序文件），`.sh` 只保留夹具表——因为 `plugin/sh-census-baseline.json` 是只降不升的棘轮，把 ~25 行 `node -e` 内嵌进 tracked `.sh` 会让它回升。

## Touches

- tasks/gap-adr007-half1-selfcheck-probes-archived-and-gate-never-invoked.md
- experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh
- experiments/quay-perpetual-stream/scripts/git-lens-instrument.mjs
- experiments/quay-perpetual-stream/fixtures/git-lens/l-g-archguard/cycle/query/manifest.json
- experiments/quay-perpetual-stream/fixtures/git-lens/l-g-archguard/cycle/query/fixture01/arch.json
- experiments/quay-perpetual-stream/fixtures/git-lens/l-g-archguard/clean/query/manifest.json
- experiments/quay-perpetual-stream/fixtures/git-lens/l-g-archguard/clean/query/fixture02/arch.json
- adr/ADR-007-instrument-the-dark-axes-lg-ld-ls.md
- plugin/scripts/phase-declare.ts
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/capability-catalog-declarations.json
- plugin/test/phase-declare.test.mjs
- plugin/test/quality-gate-driver.test.mjs
- plugin/test/git-lens-selfcheck.test.mjs
- packages/quay/test/adr-gate.test.mjs
- plugin/test/probe-routine.test.mjs
- plugin/sh-census-baseline.json

## Blocker

**2026-10-22T03:14:32.832Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: at least one bin is under-sampled (otherwise the rule is vacuous) [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/probe-routine.test.mjs,plugin/test/sh-census-check.test.mjs changed=-]
- run_id：wk-prod-anchor
