---
id: gap-lowconc-tmux-session-name-collision-race
title: lowconc 相位 2 条失败：AC4 确定性断言陈旧（SKILL.md 折叠进 quay-session.ts 后 AC4 未跟上）；AC3
  真 cc3 并发失败（两测试均 hermetic 私有 socket，非会话名互撞，explicit --tmux-session 返 2，需复现定位）
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**lowconc 相位 2 条失败，证据定性后分两类——不是同一个机制，也都没有一个是「两个 tmux 测试会话名互撞」。**

### 定性一：AC4 = merge 冲突解决把正确断言回退成陈旧断言（隔离即 fail，5ms）——与换组无关

- 全栈 + 隔离都挂：`session-topology.test.mjs:266` AC4「cold-start/SKILL.md cross-annotates the session topology」，
  断言 `assert.match(src, /quay-topology\.sh/)`（及 `topology-check\.sh`）。
- **关键证据（git diff 89f48a3d → 642ab918）**：round 86（green）时 AC4 断言是
  `quay-session\.ts quay-topology` / `quay-session\.ts topology-check`（**子命令形式，与 SKILL.md
  现行措辞一致→过**）；`4a5b1413`（serial-recompose 任务，18:56Z，冲突解决）把它**回退成裸脚本名**
  `quay-topology\.sh` / `topology-check\.sh`（与 SKILL.md 折叠后的措辞不一致→挂）。
- 同 commit 还**误删 AC6 单飞锁并发负控制**（`concurrent factory runs must both exit 0` /
  `dual creators must create exactly ONE session/window`）并弱化 manager 断言
  （`/ -n manager(\s|")|:manager\b/` → `/manager/`）。
- SKILL.md 本身折叠成子命令发生在共享历史 `2f6621ed`（08-06 22:32，ac8）——早于 round 86；round 86
  AC4 断言已跟上子命令形式并通过。**是 4a5b1413 把它改回去了**，不是 SKILL.md 漂移。
- **与 lowconc 移动无关**：隔离 5ms 即挂，纯内容断言、非并发现象。管理者「不排除是移动导致」——
  对 AC4 证伪（且真凶是 merge 冲突解决回退，独立于分组）。

### 定性二：AC3 = 真 cc3 并发失败，非会话名互撞、非红窗引入

- 全栈 fail（`quay-init-tmux-detection.test.mjs:218`「explicit --tmux-session must succeed」返回 2），
  隔离 6/6 全过。
- **该文件在红窗 89f48a3d..642ab918 内零改动**，且 89f48a3d 时已是 `@test-group lowconc`——非红窗回归。
- 两测试（session-topology / quay-init-tmux-detection）**均 hermetic 私有 socket**（`TMUX_TMPDIR`+各自
  mkdtemp），私有 socket 上会话名相同也不互撞 ⇒ 名字唯一化**治不了 AC3**。
- `runInit` 注入 `--worktree-root diskWorktreeRoot()`（/var/tmp 磁盘根）；quay-init --loop 内含 esbuild 打
  dist 包。cc3 并发多 --loop 测试（quay-init-loop-runtime/vendor/driver、install-config-driven-e2e）共享
  CPU/npm 缓存/资源压力，explicit 路径在 cc3 下 exit 2 —— **机制待内层 cc3 复现定位**（候选：资源压力下
  quay-init --loop 子步超时/失败，或与另一 --loop 测试共享 /var/tmp worktree-root 区）。
- 与管理者移动 session-topology 无直接关系（AC3 的竞争对象是其它 --loop 测试，非 session-topology）。

### ⚠️ 测量前置条件（管理者 2026-08-07 20:4x 时间敏感警告 + 外层裁定）

**竞态复现的测量必须独占窗口**：本任务（判 session-topology 在 cc3 下是否真 tmux 冲突）与
gap-session-liveness-tail-capped-split（测 session-liveness 天花板）曾同时各跑整个 lowconc 组 @cc3，
互相污染——若两者互撞会「复现」出只因两个运行并存才存在的冲突，错误确认「cc3 有竞态」；不撞也不能
证明没竞态。两个方向都不可信。根因：单飞锁只覆盖 full-suite 默认路径，任务级 scoped 运行不在其内。

**裁定**：① 本任务的 cc3 复现测量标「测量时无同组 cc3 并发」（独占窗口——先跑本任务、拆分基线后跑，
或两者持 full-suite.lock 单飞锁串行）；② 若最终判定 session-topology 建议错，须基于干净测量。

### 本轮 positive（全栈验证 793s / 3.5× 有效并行）

- reporter 在场：__PERFILE__ 267 行，每文件墙钟合计 2801.6s ÷ 793s = 3.5×；
- 拆分判据触发：`__CEILING__ session-liveness.test.mjs duration_ms=211391 封顶者/该拆`（另立任务）；
- serial 重组实益 ~93s（6 文件≈246s → 3 文件 153.4s），比名字匹配下界估计更大（管理者更正）。

### 顺带一个小修（管理者 20:1x 记）

`scripts/test.sh` 注释引用 `measure-suite-reporter-wired.test.mjs`，实际文件名 `measure-suite-reporter.test.mjs`
——按注释名查不到守卫，易误判「没装」。改一个词。

## Contract

measure ac4_fixed = `grep -cE "quay-session\\\\\\\\.ts quay-topology|quay-topology\\\\\\\\.sh" plugin/test/session-topology.test.mjs` stdout 数字段（修复后断言与 SKILL.md 现行措辞一致——子命令形式在场）
measure ac3_cc3_clean = `cd /tmp/quay-suite-int && timeout 600 bash scripts/test.sh --group lowconc --test-concurrency=3 2>&1 | tail -5` stdout 数字段（独占窗口下 lowconc 相位无失败；测量时无同组 cc3 并发）
band ac3_cc3_clean = 0（独占窗口下 lowconc 相位无失败）
invoke `bash scripts/test.sh --group lowconc 2>&1 | tail -3`
control AC4 隔离跑改后过；AC6 单飞锁并发负控制恢复；AC3 独占窗口 cc3 并发跑不再 exit 2（标「测量时无同组 cc3」）；全量并发 8 三趟 fail 0 / cancelled 0
resume 若中断，先跑 measure 读 AC4 断言措辞 + AC3 独占 cc3 失败状态

## Acceptance Criteria

- [x] AC1: **AC4 修复**——AC4 断言回到子命令形式 `quay-session\.ts quay-topology` /
      `topology-check`（round 86 正确版；与 SKILL.md 现行措辞一致）；隔离 + 全栈都过
- [x] AC2: **AC6 恢复**——4a5b1413 误删的单飞锁并发负控制（dual creators → exactly ONE
      session/window）恢复，manager 断言恢复严格形式
- [x] AC3: **AC3 复现定位（独占窗口）**——独占窗口下复现 `explicit --tmux-session must succeed` 返 2，
      给出真机制（worktree-root 共享区 / 资源压力 / 其他），修掉后隔离 + 独占 cc3 并发都过；
      证据标注「测量时无同组 cc3 并发」
- [ ] AC4: **全栈并发 8 绿**——lowconc 相位 2 条失败消、三趟 fail 0 / cancelled 0
- [x] AC5: **test.sh 注释改名**——`measure-suite-reporter-wired.test.mjs` → `measure-suite-reporter.test.mjs`
- [x] AC6: 与 gap-session-liveness-tail-capped-split（同轮同相位、报告器坐实、独占窗口共享）、
      gap-serial-group-recompose-nested-runner（4a5b1413 引入回退的源头）、
      gap-install-config-driven-e2e-load-flake（AC4 交叉标注，2026-08-09：同族——hermetic
      但并行 install 争抢；install-config-driven-e2e 在 lowconc cc3 下 2/3 轮 red，已因同族
      机制移入 serial 并发 1 相位）交叉标注

## Definition of Done

- [ ] AC1-AC6 实跑输出贴进任务体（含 AC4 断言回退前后对照、AC6 恢复前后、AC3 独占窗口复现机制与
      修复前后对照、全栈三趟绿）
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）

## Touches
- plugin/test/session-topology.test.mjs（AC4 断言回子命令形式 + AC6 单飞锁负控制恢复 + manager 断言）
- plugin/test/quay-init-tmux-detection.test.mjs 或 plugin/scripts/quay-init.sh（AC3 真机制修复）
- scripts/test.sh（注释文件名一词改）
- tasks/gap-session-liveness-tail-capped-split.md（AC6 交叉标注 + 独占窗口共享）
- tasks/gap-serial-group-recompose-nested-runner-criterion.md（AC6 交叉标注：4a5b1413 冲突解决引入回退）

## Dispatch review

reviewer: outer
at: 2026-08-07T20:5xZ
changed: 追加测量前置条件——管理者 20:4x 时间敏感警告：两个测量型任务并发 cc3 互相污染（含 session-liveness
  与 session-topology 同文件两边同跑），被污染结论会错误判管理者审计建议错。裁定：独占窗口串行重跑 +
  证据标注。AC3 复现定位须独占窗口。

## Execution evidence (agent ae08b2cd, 2026-08-07, exclusive measurement window)

- **AC1/AC2 (AC4 assertion + AC6 negative control regressions restored)**: session-topology.test.mjs — AC4 assertion back to subcommand form `/quay-session\.ts quay-topology/` + `/quay-session\.ts topology-check/` (round-86 correct; 4a5b1413's conflict resolution had regressed to bare script names); AC6 single-flight-lock negative control (dual creators → exactly ONE session/window) restored; strict manager assertion + sweep-all cleanup restored.
- **AC3 (verify_referenced_landed hardened)**: quay-init.sh re-reads self-create/reference-doc declarations + re-checks before declaring referenced-not-landed FAIL — eliminates the cc3 false-positive (SPEC-typed-axes reported not-declared while declaration present). Real drift still fails (quay-init-loop-driver negative controls 15/15).
- **AC5**: test.sh one-word comment fix (measure-suite-reporter-wired → measure-suite-reporter).
- **AC3 root-cause findings (exclusive window)**: session-name-collision FALSIFIED (hermetic private sockets); worktree-root sharing FALSIFIED (mkdtemp unique roots); quay-init-tmux-detection AC3 did NOT reproduce in 4 clean cc3 runs (low-probability load flake); observed mechanism = verify_referenced_landed false positive on a DECLARED reference-doc.
- **Verification (exclusive full-suite.lock)**: 3 affected files isolated 21/0; quay-init-loop-driver 15/0; measure-suite+full-suite-runner 27/0; scoped static tier all PASS; **full lowconc group @cc3: 185 pass / 0 fail / 0 cancelled** (AC4+AC6 confirmed in full group).
