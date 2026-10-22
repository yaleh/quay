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

- [ ] AC1 假 PASS 消失（负对照）：在一个临时副本里把 selfcheck 用到的任一探针入口改名（模拟探针未加载），`bash experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh` 对该轴打印 `NOT-EVALUATED(probe-not-loaded…)`，输出中**没有**任何一行 `PASS:` 属于该轴，退出码为 2。改动前的同一操作得到 `PASS: l-d/prose-heavy`（贴出改动前后两次输出与退出码）。
- [ ] AC2 L_D 指向活仪器且能判对两个方向：在真实仓库运行 selfcheck，`l-d/prose-heavy` 为 PASS（期望 flagged），`l-d/code-heavy` 与 `l-d/empty` 为 PASS（期望 not flagged）；把 `phase-declare.ts` 的 `computeRatio` 阈值临时改成恒不 flagged（临时副本中），`l-d/prose-heavy` 变 FAIL（贴出三次输出）。
- [ ] AC3 L_G 指向活仪器且能判对两个方向：有环夹具 PASS（检出 ≥1 个目录环并列出成员），无环夹具 PASS（0 环）；把有环夹具的 moduleGraph 删掉后，该用例报 `NOT-EVALUATED` 而不是 PASS 或「0 环」（贴出三次输出）。
- [ ] AC4 selfcheck 在真实仓库上的整体读数：L_D 3 例与 L_G 2 例全 PASS，L_S 2 例为 `NOT-EVALUATED(axis-retired…)`，退出码为 2；同一次运行的 stdout 中 `MODULE_NOT_FOUND` 出现 0 次（贴出完整输出）。
- [ ] AC5 门引擎产出真实事件（生产载体）：在主检出上由 `plugin/scripts/quality-gate-driver.ts --root /data/home/yale/work/quay --once` 跑一轮且新例程 due（未 due 时贴出 `.quay/routine-last-run.json` 中该键的读数，等下一个常驻轮次产出后再取），`.quay/gate-events.jsonl` 中 `"gate":"adr-007"` 的条数由 0 变为 ≥1，该事件的 verdict 与 AC4 的退出码一致（2 ⇒ 非 pass 且 reason 含 NOT-EVALUATED），同轮 `.quay/quality-round.jsonl` 有一条对应 Fact。贴出跑之前的 grep 计数、事件行与 Fact 行。
- [ ] AC6 HALF 2 未被连带关掉：`node --experimental-strip-types -e` 调 `workspaceEnforcesDarkAxis("/data/home/yale/work/quay")` 仍返回 `true`；`grep -n '"ADR-007"' .quay/config.yml` 仍命中（贴出两条输出）。

## Definition of Done

- [ ] 六条 AC 全绿，`scripts/test.sh` 相关泳道（含 `--for-task` scoped 静态检查）通过，合并进 develop。
- [ ] 归档目录 `archive/2026-09-07-zero-call-scripts/` 未被改动或复活；L_S 的退役是显式记录，不是删用例。
- [ ] ADR-007 的 KNOWN ROT 段落已更正（3 例假 PASS，不是 1 例），并写明 HALF 1 的新仪器指向；新例程不在 fan-in 路径上运行。
- [ ] 16 个 0 事件的 it0/fixed 配置门清单与读数写入 `## Evidence`，作为观察项，未在本任务中接线。

## Touches

- tasks/gap-adr007-half1-selfcheck-probes-archived-and-gate-never-invoked.md
- experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh
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
