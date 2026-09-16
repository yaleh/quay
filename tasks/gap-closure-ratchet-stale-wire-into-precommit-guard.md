---
id: gap-closure-ratchet-stale-wire-into-precommit-guard
title: quay-init 棘轮陈旧检测（--check-stale）从未接入 precommit-guard——漏改 baseline 能顺利
  commit+push，靠远端 CI 才暴露
status: ready
needs_human_cause: human-adjudication
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**实证（2026-09-16，manager 会话，真实 release cut）**：执行 v0.8.0 release cut——切
`release/v0.8.0`、把 15 处版本字面量（含 `plugin/.claude-plugin/plugin.json`）从
`0.8.0-dev` 改成 `0.8.0`、合回 develop、打 tag、随后又把 develop bump 到 `0.9.0-dev`
（同样改了 `plugin.json`）。这两次 `git commit` 在本地都顺利通过（`.git/hooks/pre-commit`
只跑了「文档类检查 + Touches 单路径 + goal_ac 写入面」三项，全部放行），直接 push 到了
origin/develop。

结果：远端 CI 上两条 develop 的 run（35100733320 / 35100607207）都在约 1-2 分钟内失败
（不是真的跑了测试套件），日志里是 `STATIC_CHECK_FAILED: quay-init-closure-ratchet-stale
exit=1`——因为 `plugin/.claude-plugin/plugin.json` 是 `plugin/scripts/quay-init-closure-
ratchet.ts` 追踪的 laydown 源文件之一（`LAYDOWN_SOURCES` 常量，该脚本 `:75-80`），改了它
却没有同步跑 `--reanchor`，导致 committed baseline（`docs/analysis/quay-init-closure-
ratchet.baseline.json`）的 fingerprint 过期。后来手工跑 `--gate` 确认是 shrink-only
（footprint 没有真实膨胀，只是文件内容变了导致指纹变化）、再手工跑 `--reanchor`、再手动提交
推送，CI 才转绿。

**根因（已读代码定位，不是猜测）**：`.git/hooks/pre-commit` 的实际内容——它只 exec
`plugin/scripts/precommit-guard.ts`，而该脚本 `judge()`（`:483-561`）目前只做三件事：
① `runDocChecks`（文档类检查）、② `runTouchesChecks`（Touches 一条目一路径）、
③ `runGoalAcChecks`（goal_ac 写入面）。**完全不含 closure-ratchet 的陈旧检测。**
`--check-stale` 这个检测（`quay-init-closure-ratchet.ts:45-48`，"CHEAP (hashes the source
tree, no real laydown)"）目前只活在 `scripts/test.sh` 的 `@static-tier change` 静态检查
集合里——即只有**跑一次完整测试套件**（本地 `scripts/test.sh` 或远端 CI 的 `test` job）时
才会被评估到；而 `git commit` 这个更早、更便宜的检查点完全没有覆盖它。这正是这次代价的机制：
改动能顺利 commit + push，直到远端 CI 跑测试套件才暴露，浪费了一整轮 CI（约 1-2 分钟 ×2 次，
且污染了 AC-265「develop 上 CI 首次 decisive 绿」判据要求的「相邻 decisive run」序列——这两条
failure record 会成为后续判据的相邻对照噪音）。

<!-- dedup-ref -->
**不是重复立案**：已查 `tasks/gap-quay-init-closure-ratchet-manual-reanchor-recurs.md`
（status: done），它解决的是判定逻辑本身的问题——把棘轮基线从写死字面量改成 committed
baseline file + `--check-stale` 相对现算，并且有单测覆盖"改了 laydown 内文件但未同步基线"
这个场景会被检出（其 AC3：「构造一个『改了 laydown 内文件但未同步基线』的场景，在该改动自己
的提交/门上就被挡，而不是在下一个无关任务的 fan-in 上才红（单测断言）」）。**但它的落点是
`scripts/test.sh` 静态检查段（测试套件运行时才评估），从未接入本地 `precommit-guard`**
（`.git/hooks/pre-commit` 现在的三项检查里没有它——`judge()` 只有①②③，无 closure-ratchet）。
本任务要做的是把这个已经存在、已经判定正确的检测**前移一层**，接到 `git commit` 这个更早的
门上——这是本仓库硬规则 1「用机件，不手搓」（`--check-stale` 已经是现成机件，不必重造）与
硬规则 9「可见性 ≠ 执行：一条规则若『守』与『不守』在记录上无法区分，它就只能靠意志——该给它
造产物」的直接应用。本任务依赖/承接旧任务的判定逻辑，但不重复它——旧任务交付了判定本身
（`--check-stale`/`--gate`/`--reanchor` 三个模式），本任务交付的是把判定接到 `git commit`
写入面这一个新的调用点，两者是不同的交付面。

precommit-guard.ts 自身已有先例形态可循：③ goal_ac 写入面判定的头注释（`:58-80`）逐字记录了
同一个模式——「检测器已经存在、判定正确，但只在事后（goal 层每轮跑）生效，规则只有事后检测
这一半」，随后被 `gap-ac190-goal-ac-rule-not-enforced-at-filing`（done）接到 precommit-guard
的写入面。本任务是同一形状在 closure-ratchet 检测上的重演。

## Plan

在 `plugin/scripts/precommit-guard.ts` 里新增第 ④ 项检查（`judge()` 内、在①②③之后）：

1. 若本次暂存（staged）改动命中 `quay-init-closure-ratchet.ts` 自己定义的 laydown 源文件
   集合（该脚本现有 `LAYDOWN_SOURCES` 常量目前未 `export`——实现者需先给它加 `export`，或改为
   复用已导出的 `collectSourceEntries(root)` 的返回集合派生文件名列表；⛔ 不要在
   precommit-guard.ts 里手抄一份 `plugin/scripts/quay-init.sh` / `plugin/.quay/profiles.yml` /
   `plugin/.claude/launch.settings.json` / `plugin/.claude-plugin/plugin.json` 这四个路径——
   两处集合一旦不同步就会有一边漏检，硬规则 5b），才触发下面的动作；完全没碰这个集合的普通
   提交不受影响、不产生额外开销（`--check-stale` 本身虽 cheap，但仍应门控在"命中才跑"，
   保持与②③一致的"staged 内容决定是否触发"风格）。
2. 命中时跑一次 `--check-stale`（复用 `readBaseline` / `collectSourceEntries` / `fingerprintOf`
   三个已导出函数现算，不必 `spawnSync` 子进程再跑一次脚本——precommit-guard 对其余三项检查
   均走内进程函数调用而非 shell 出子进程，本项应保持同一风格）：
   - **新鲜**（当前 staged 内容的 fingerprint 与 committed baseline 一致）⇒ 放行，不做任何事。
   - **陈旧** ⇒ 再跑一次 `--gate`（`runLaydown` 真实铺设 + `checkClosureRatchet` 比较）：
     - 若确认是 **shrink-only**（`checkClosureRatchet` 返回 `ok:true`，即未真实膨胀，只是
       内容变化导致 fingerprint 过期）⇒ 倾向性建议：自动跑一次等价于 `--reanchor` 的写入
       （`writeBaseline`），并把更新后的 baseline 文件（`docs/analysis/quay-init-closure-
       ratchet.baseline.json`）用 `git add` 一并加入本次提交的暂存区，让 commit 顺手带上
       重锚结果，不需要人/agent 二次提交（这正是这次人工做的动作，机械化后不该再依赖人记得）。
       若实现者认为在 precommit 钩子里做写操作 + `git add` 风险过高（例如与 hook 的幂等性/
       并发写冲突），退化方案是：直接拒绝提交并报错提示运行 `--reanchor`（类似现有 Touches
       检测器"发现问题就拒绝、不代劳"的做法）——两种做法均可接受，由实现者按现有
       precommit-guard 的既有风格决定，并在实现时把选择理由写进代码注释或提交信息（不是必须
       写回本任务体，但要可查）。
     - 若 `--gate` 显示**真实膨胀**（`checkClosureRatchet` 返回 `overFiles` 或 `overBytes`
       为 true）⇒ **必须拒绝提交**，`reason` 用新值（如 `closure-ratchet-stale-or-grown`
       或拆成两个更精确的 reason），报出膨胀的具体文件与字节数——沿用现有 `Verdict` 接口形态
       （新增一个 `closureRatchetCheckOutput: string | null` 字段，与 `docCheckOutput` /
       `touchesCheckOutput` / `goalAcCheckOutput` 并列）。⛔ 不允许自动放行，否则棘轮形同虚设。
3. `--install-hook` 生成的 hook shim 注释（`hookShim()` / `preMergeCommitShim()`）与
   `USAGE` 字符串需同步补上第 ④ 项的说明（precommit-guard.ts 现有 ①②③ 均在这两处各有一段，
   新增项照样式补齐，避免"守卫做了什么"与"文档说了什么"脱节）。

## Acceptance Criteria

- [x] AC1：构造一个"改了 laydown 内某个源文件（如 `plugin/.claude-plugin/plugin.json`）但未
      同步 reanchor"的真实场景，**走一次真实的本地 `git commit`**（安装的 pre-commit 钩子，
      不是单测里直接调用 `judge()` 函数、不是跑 `scripts/test.sh`）——验证这个错误在 commit
      那一刻就被挡住或自动补全，不需要等到测试套件/CI 才发现。这是与旧任务
      `gap-quay-init-closure-ratchet-manual-reanchor-recurs` 的 AC3（单测断言形态）的关键
      区别，必须真跑一次 `git commit` 流程（可参照 `precommit-guard.test.mjs` 里已有的
      `installHookFromScratch` e2e 先例写法）。
- [x] AC2（负控制1，可证伪）：构造一个真实膨胀（非 shrink-only）的 laydown 改动，验证提交
      依然被拒绝，不能被自动放行——证明这不是把棘轮放宽成恒真。
- [x] AC3（负控制2，性能/范围）：一个完全不触碰 laydown 源文件集合的普通提交，
      precommit-guard 的行为与耗时不受影响——附前后耗时读数（例如用 `Date.now()` 或 `time`
      包一次 judge() 调用），证明没有对所有提交都跑一次全量 laydown 现算。
- [x] AC4：若采用"自动重锚并入提交"方案，验证重锚后的 baseline 文件确实进了**同一次**提交
      （`git show <sha> --stat` 里能看到 `docs/analysis/quay-init-closure-ratchet.baseline.json`
      被改动），不是留下一处未暂存的改动；若采用"拒绝并提示"方案，本条改为验证拒绝信息里含
      可执行的修复命令（`--reanchor` 的完整调用形式）。
- [x] AC5：`LAYDOWN_SOURCES`（或其等价派生）在 precommit-guard.ts 与
      quay-init-closure-ratchet.ts 之间是单源复用（`export` + `import`），不是两份手抄清单——
      证据 = precommit-guard.ts 里对应的 `import` 行。
- [x] AC6：`bash scripts/test.sh --for-task gap-closure-ratchet-stale-wire-into-precommit-guard`
      退出 0。

## Definition of Done

**验收对象是『改动 laydown 源文件但漏重锚』这类错误在 `git commit` 这一步就被挡住或自动
补全，不再依赖任何人/agent 记得手动跑 `--check-stale`/`--reanchor`，也不再需要一整轮测试
套件/CI 才发现——不是『新增了一段检查代码』就算完成。**

生产工作树上必须同时成立：① 一次真实的本地 `git commit`（走安装的 pre-commit 钩子，非单测
直调）能在"改了 laydown 内文件但未同步基线"的场景下当场被挡或自动补全（AC1）；② 真实膨胀
场景下依然被拒、棘轮没有被放宽成恒真（AC2）；③ 不触碰 laydown 源文件集合的普通提交不受
拖累（AC3）。⛔ 只在 `precommit-guard.test.mjs` 里加一段对 `judge()` 函数的单元断言、却没有
一条真正跑通 `git commit` 的 e2e 用例 ⇒ 不算完成——这正是本任务与旧任务
`gap-quay-init-closure-ratchet-manual-reanchor-recurs`（该任务的验收形态是单测断言）的关键
区别所在，重复它的验收形态不构成本任务的完成证据。

## Touches

- plugin/scripts/precommit-guard.ts
- plugin/scripts/quay-init-closure-ratchet.ts
- plugin/test/precommit-guard.test.mjs
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-closure-ratchet-stale-wire-into-precommit-guard.md

## Needs-Human

**执行 2026-09-16T14:24:06.280Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (the suite log names nothing a worker could fix); stopping instead of spending another worker session
- 成因类：human-adjudication
- 失败步/判词：step=suite: # fail 10
- run_id：wk-prod-anchor
- session_id：920f20cd-25f9-488f-89c6-43bd4736dc9c
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-closure-ratchet-stale-wire-into-precommit-guard~wk-prod-anchor~1789568420859-a84a66.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-closure-ratchet-stale-wire-into-precommit-guard-wk-prod-anchor.log

## 人复核（manager 会话，2026-09-16T14:3xZ）— 仓库级阻塞已解除，转回 ready 重试

进 needs-human 的真因是仓库级阻塞，非本任务实现缺陷：`direct-to-develop-bypass-check` 把 manager
2026-09-16 的 v0.8.0 release cut 两条直提（ae28758aa/806fee934，未走 fan-in）判定为未裁定 bypass，
static-tier fail-closed 挡住了全仓所有任务的完整套件（不只是这个任务）。

已裁定并落地修复（commit 5d937823a，已推送 origin/develop）：把这两条按先例 08e8ec55/a388ca38
（release 版本 bump 类直提）加入 RULED_HISTORICAL_COMMITS。已用生产命令验证转绿：
`node --no-warnings --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts
--root . --baseline develop~100 --json` => ok:true, reason:"ac65-authorized-or-ruled-historical-only"。

本任务自己之前的实现（precommit-guard.ts 改动、30/30 precommit-guard.test.mjs、scoped gate 已过）
未受影响，未碰 delta，转回 ready 让 worker-driver 重新派发即可。
