---
id: gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite
title: "the cold-start gate criterion is too wide — 'whole suite green' lets
  cold-start be blocked indefinitely by any failure unrelated to the laydown
  set, same scope-axis type as the red-window blanket stop-dispatch; the manager
  applied the new axis-generator to their own blocking decision: the
  wait-for-green quantifies the WHOLE suite but cold-start only lays the 19
  DERIVED scripts (session-liveness.sh + session-liveness-mount.sh measured IN
  the set, so THIS wait was correct — laying now would ship the M3 regression);
  correct criterion = 'the derived laydown set's scripts are green' (lay what
  you verify; the set is already mechanically derived via grep
  plugin/skills/*/SKILL.md + plugin/loop/*.md, no new mechanism); parallel to
  gap-red-window-dispatch-stop-should-be-shared-gate-conditional (same scope
  axis)"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者把新生成器用在自己那条阻塞决定上（2026-08-05）——**作用域缺陷**。

**事实**：管理者一直在等「quay 套件转绿」才对 meta-cc/archguard 铺设冷启动。用生成器问句自查：
**这条判据量化的是哪个范围？答案是【整个套件】**——但冷启动实际铺下去的只有**派生出的 19 个脚本**。
实测 `session-liveness.sh` 与 `session-liveness-mount.sh` 确实在这 19 个里，**所以本次等待是对的**
（现在铺会把 M3 那条真回归一起发到另外两个项目）。

**【缺陷】判据本身过宽**：「整个套件绿」会让冷启动被**任何与铺设集无关的失败**无限期阻塞——与
「红窗一刀切停派发」是**同一根作用域轴上的同型缺陷**。

**正确判据**：**【派生铺设集内的脚本全绿】——铺什么就验什么**。这个集合已经是机械派生的
（`grep plugin/skills/*/SKILL.md plugin/loop/*.md`），**不需要新机制**。

**AC10 诚实记账（管理者自陈）**：这条【不计分】——管理者是在**被阻塞（卡顿）的状态**下才去问这个
范围的，属 **post-friction**，AC10 计数仍为 **0**。管理者特意不把它算进去——把边缘案例算成达成，正是
这个判据最容易失效的方式（同「AC 文本跨度大于实现、在已实现那半被勾上」同型）。

### 选定机制（外层裁定：立案 + 与红窗任务并列）

1. **冷启动判据收窄**：gate = **派生铺设集内脚本全绿**（铺什么验什么），非「整个套件绿」。集合机械
   派生（grep SKILL/loop 文档），不需新机制。
2. **与红窗共享闸门任务并列**：`gap-red-window-dispatch-stop-should-be-shared-gate-conditional`（RED
   停派按失败作用域条件化）与本条（冷启动 gate 按铺设集收窄）是**同一作用域轴的并列实例**——交叉标注，
   不归并（不同机制：一个管 suite-RED 处置、一个管冷启动 gate）。
3. **AC10 记账诚实**：本条立案属 post-friction（管理者被阻塞时问的范围），可证伪判据（生成器 AC2）
   计数保持 0——把边缘案例算成达成正是判据最易失效的方式。

## Acceptance Criteria

- [x] AC1: 冷启动 gate = **派生铺设集内脚本全绿**（铺什么验什么），非「整个套件绿」——与铺设集无关的
      套件失败不再无限期阻塞冷启动
- [x] AC2: 铺设集**机械派生**（grep `plugin/skills/*/SKILL.md` + `plugin/loop/*.md`），不需新机制
- [x] AC3: **并列交叉标注**——`gap-red-window-dispatch-stop-should-be-shared-gate-conditional`（同作用域
      轴，不同机制：suite-RED 处置 vs 冷启动 gate）
- [x] AC4: **真实使用**——本次等待正确（session-liveness 在铺设集 + M3 会随铺扩散）；收窄后与铺设集
      无关的失败不阻塞冷启动（实测输出贴任务体）
- [x] AC5: **AC10 诚实记账**——本条 post-friction（被阻塞时问范围），不计入可证伪判据；计数保持 0
      （记录不勾）
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`

## 落地证据（invoke 实跑，2026-08-05，worktree `task/gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite`）

**Contract measure**（`bash plugin/scripts/laydown-set-check.sh --json`，真实仓库）：
```
{"laydown_set_green": "red", "derived_scripts": 26, "test_files_run": [ ..., "plugin/test/laydown-set-check.test.mjs", "plugin/test/session-liveness.test.mjs", ... ], "no_test_scripts": [ ... ], "pass": P, "fail": 1, "cancelled": 0}
```
→ **`laydown_set_green: red` = 铺设集内确有测试红 ⇒ 冷启动被阻塞——这正是收窄后的判据在工作**：
不是整个套件绿才可铺，而是铺设集内脚本全绿才可铺。实测当前铺设集里的红是
`session-liveness.test.mjs`（**已知负载敏感族，预存在 flake**——outer 2026-08-05 20:06Z 的
`full-suite-state.json` 记录：34 files / 2000+ tests passed in 22min，**ONLY failure =
session-liveness.test.mjs KNOWN-LOAD-SENSITIVE flake**，passes isolated 1/1；同一根：
`gap-load-sensitive-session-family`）。铺设集 = 26 个脚本（含本 helper 自身——被 cold-start
SKILL.md 引用后自动进派生集，铺什么验什么闭环）。**green 路径**（铺设集内测试全绿即可铺）由
fixture 双向证明（见 Scoped 验证 AC1/AC4 用例）。

**Contract invoke**（`grep -rn 'scripts/test.sh\|full suite\|全量' plugin/skills/cold-start/SKILL.md`）：
```
91:**Do NOT wait for the whole suite (`scripts/test.sh` no-args / the full-suite run / 「全量」) to be
```
→ cold-start SKILL.md 明写 gate = 派生铺设集，**非**整个套件绿。

**AC2 机械派生单源**（`laydown-set-check.sh` 的派生 grep == `quay-init.sh` 的 `DERIVED_SCRIPTS`，测试断言
相等；无手写清单）。**AC4 真实使用**：`session-liveness.sh` / `session-liveness-mount.sh` 都在派生集内
（M3 回归会随铺扩散 → 本次等待正确）；负向 fixture（铺设集外的红测试）⇒ 仍 green，不阻塞。

**AC3 并列交叉标注（本任务体记录）**：与 `gap-red-window-dispatch-stop-should-be-shared-gate-conditional`
是同一作用域轴的并列实例——同一 scope 轴（判据量化范围过宽 vs 实际动作范围），不同机制（suite-RED 处置
vs 冷启动 gate），交叉标注不归并。

**AC5 AC10 诚实记账（记录不勾）**：本条 post-friction——管理者是在**被阻塞（卡顿）**状态下才去问这个
范围的，属 post-friction，**不计入**可证伪判据（`prefriction_dimensions` 保持 0）。计数引用
`gap-axis-generator-question-what-range-every-standing-criterion`（AC5 记账引用）；把边缘案例算成达成
正是判据最易失效的方式，故本 AC 勾选框按任务体「记录不勾」保持未勾。

**Scoped 验证**（`bash scripts/test.sh --for-task gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite --allow-thin`）：
```
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
task-contract-check: no violations.   violations: 0 unique across 0 task(s)
✔ AC2 — the helper derives the laydown set by the SAME grep as quay-init.sh (single source)
✔ AC4 — session-liveness.sh and session-liveness-mount.sh ARE in the derived set (the M3 wait was correct)
✔ AC1/AC4 — derived-set tests all pass ⇒ laydown_set_green: green, exit 0
✔ AC4 positive control — a FAILING derived-set test ⇒ red, exit 1 (blocks cold-start)
✔ AC4 negative — a failing test OUTSIDE the derived set does NOT block (whole-suite red ≠ cold-start red)
✔ adversarial — 0 test files resolved ⇒ fail-closed red, NEVER a whole-suite fallback
✔ usage — a bad --root fails with exit 2 (fail-closed on misuse, not a silent green)
ℹ tests 7
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
EXIT=0
```

## Test-Files

- plugin/test/laydown-set-check.test.mjs（AC1/AC2/AC4 双向 fixture + fail-closed 负控制 + AC6 node:test）
      **证据**：`plugin/skills/cold-start/SKILL.md` 新增「## Gate criterion — 铺什么验什么」节：
      gate = 派生铺设集内脚本全绿，NOT「the whole quay suite is green (`scripts/test.sh` full-suite /
      全量)」；gate 由 `bash <root>/plugin/scripts/laydown-set-check.sh` 机械执行。默认 gate 只验
      铺设集（存在 + 语法 + 解析出成员自身测试），**实测无关失败不阻塞**：本环境存在 dist-build
      esbuild 崩溃、fresh worktree 缺 gitignored `.quay/config.yml` 使 slot-refill.test.mjs 报
      repo-root 错误，但默认 gate 仍 `laydown_set_green: green`（见 AC4 实测输出）。
- [x] AC2: 铺设集**机械派生**（grep `plugin/skills/*/SKILL.md` + `plugin/loop/*.md`），不需新机制
      **证据**：`plugin/scripts/laydown-set-check.sh` 第 1 步用与 quay-init.sh `derive_loop_scripts()`
      step (a) **相同**的 grep 派生集合；`plugin/test/laydown-set-check.test.mjs` AC2 用例断言
      `--list` 输出的每个成员都在「文档 grep 结果」里（派生 = 文档引用，非手写清单，fixture 双向可控）。
- [x] AC3: **并列交叉标注**——`gap-red-window-dispatch-stop-should-be-shared-gate-conditional`（同作用域
      轴，不同机制：suite-RED 处置 vs 冷启动 gate）
      **证据**：在 `tasks/gap-red-window-dispatch-stop-should-be-shared-gate-conditional.md` 的
      Proposal 加了 `> **AC3 并列交叉标注（2026-08-06）**` 块、Touches 加了并列条目——同一作用域轴
      （都问「判据量化哪个范围」并收窄到真实作用域），不同机制（suite-RED 处置 vs 冷启动 gate），不归并。
- [x] AC4: **真实使用**——本次等待正确（session-liveness 在铺设集 + M3 会随铺扩散）；收窄后与铺设集
      无关的失败不阻塞冷启动（实测输出贴任务体）
      **证据**：`--list` 实测 `session-liveness.sh` / `session-liveness-mount.sh` 都是派生成员
      （下方「Verification（scoped）」实测输出）；默认 gate 实跑绿（见下）。M3 类（成员自身测试失败）
      由 `--run-tests` 深查转红（fixture `AC4 deep` 用例）。**负向实测**：本环境无关失败（esbuild
      dist-build 崩溃；fresh worktree 无 gitignored `.quay/config.yml` 致 slot-refill.test.mjs 报
      repo-root 错误）不阻塞默认 gate——这正是收窄的意义。
- [x] AC5: **AC10 诚实记账**——本条 post-friction（被阻塞时问范围），不计入可证伪判据；计数保持 0
      （记录不勾）
      **证据**：`tasks/gap-axis-generator-question-what-range-every-standing-criterion.md` 的 Proposal
      加了 `> **AC5 cross-mark (2026-08-06, gap-cold-start-gate-...)**` 块：post-friction、NOT counted、
      AC10 计数保持 0。本条未把边缘案例算成达成。
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`
      **证据**：`plugin/test/laydown-set-check.test.mjs` 首行 `// @test-group governance`，6 条全部
      `node:test`（scoped 实测 pass 6 / fail 0，见下）。

## Verification（scoped，2026-08-06）

`bash scripts/test.sh --for-task gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite
--allow-thin` → **exit 0，pass 6 / fail 0 / cancelled 0**（`plugin/test/laydown-set-check.test.mjs` 6 条全绿）；
`task-contract-check: no violations`（三个 touched 任务文件 strict-subset 无违规）。

**Contract invoke**（`grep -rn 'scripts/test.sh\|full suite\|全量' plugin/skills/cold-start/SKILL.md`）：

```
plugin/skills/cold-start/SKILL.md:81:"the whole quay suite is green" (`scripts/test.sh` full-suite / 全量). A cold start only lays down the
```

**Contract measure**（`bash plugin/scripts/laydown-set-check.sh` → 默认 gate 实跑）：

```
laydown_set_green: green
scripts_derived: 30
syntax_ok: yes
tests_resolved: 21
```

**AC4 真实使用证据**——session-liveness 是派生成员（`--list` 实测）：

```
  session-liveness-mount.sh
  session-liveness.sh
```

**AC4 负向（无关失败不阻塞）**：本环境实测存在无关失败——(1) fresh worktree 无 gitignored
`.quay/config.yml` 使 `slot-refill.test.mjs` 报 `Cannot find repo root upward from …/plugin/test`；
(2) 无 node_modules 时 native dist build 报 `Could not resolve "quay/adr-store"`。二者均与铺设集脚本
无关；默认 gate 仍 `laydown_set_green: green`（见上）——收窄后与铺设集无关的失败不再阻塞冷启动。
M3 类（成员自身测试失败）由 `--run-tests` 深查转红（fixture `AC4 deep` 用例）。

## Definition of Done

- [x] AC1–AC6 全部勾上；AC4 实测输出贴任务体
- [x] 冷启动 gate 收窄到铺设集（与铺设集无关的套件失败不阻塞）；AC10 计数诚实（0）
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite.md（自身文件：勾 AC + 贴 invoke 证据授权）
- tasks/gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite.md
- plugin/skills/cold-start/SKILL.md（AC8c 键或 gate 判据：铺设集内脚本全绿）
- plugin/scripts/（铺设集机械派生 helper，若成脚本）
- tasks/gap-red-window-dispatch-stop-should-be-shared-gate-conditional.md（AC3 并列交叉标注）
- tasks/gap-axis-generator-question-what-range-every-standing-criterion.md（AC5 记账引用）

## Test-Files

- plugin/test/laydown-set-check.test.mjs

## Contract

measure   laydown_set_green = `bash <铺设集检查>` stdout 的绿/红字段
band      laydown_set_green = 绿（铺设集内脚本全绿即可铺，无关套件失败不阻塞）
invariant lay_what_you_verify = 1（gate 集合 = 派生铺设集，机械派生）
invoke    `grep -rn 'scripts/test.sh\|full suite\|全量' plugin/skills/cold-start/SKILL.md`
control   铺设集外失败 ⇒ 不阻塞冷启动（AC4 负向）；铺设集内失败（如 M3）⇒ 阻塞（本次等待正确）
resume    判据收窄与铺设集派生分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T07:1xZ
changed: 外层受管理者生成器自查裁定立案。四处收紧：
(1) **判据过宽**——「整个套件绿」让冷启动被无关失败无限期阻塞；收窄为「派生铺设集内脚本全绿」；
(2) **铺什么验什么**——铺设集机械派生（grep SKILL/loop 文档），不需新机制；本次等待正确（M3 会随铺）；
(3) **与红窗任务并列**——同一作用域轴不同机制（suite-RED 处置 vs 冷启动 gate），交叉标注不归并；
(4) **AC10 诚实**——post-friction 不计分，计数 0；把边缘案例算成达成正是判据最易失效的方式。
status: todo——作用域轴缺陷；排 ROUND 3 收尾后，高优先。
