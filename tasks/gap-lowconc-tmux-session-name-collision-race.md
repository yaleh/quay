---
id: gap-lowconc-tmux-session-name-collision-race
title: lowconc 相位 2 条失败：AC4 确定性断言陈旧（SKILL.md 折叠进 quay-session.ts 后 AC4 未跟上）；AC3
  真 cc3 并发失败（两测试均 hermetic 私有 socket，非会话名互撞，explicit --tmux-session 返 2，需复现定位）
status: ready
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

### 定性一：AC4 = 确定性内容漂移（隔离即 fail，5ms）——与换组无关

- 全栈 + 隔离都挂：`session-topology.test.mjs:266` AC4「cold-start/SKILL.md cross-annotates the session topology」，
  断言 `assert.match(src, /quay-topology\.sh/)`（及 `topology-check\.sh`、`session-topology`）。
- SKILL.md 现状（`plugin/skills/cold-start/SKILL.md:192-193`）：
  `node --experimental-strip-types <root>/plugin/scripts/quay-session.ts quay-topology --session <session>`
  `node --experimental-strip-types <root>/plugin/scripts/quay-session.ts topology-check --session <session> --json`
  ——工厂/校验已折叠成 `quay-session.ts` 子命令（git log：`2f6621ed` ac8「implement 40→6 instrument
  integration」、`1d2af642` 同族改 SKILL.md）。
- 断言要求裸脚本名 `quay-topology\.sh` / `topology-check\.sh`，但 SKILL.md 已改子命令形式 ⇒ 正则不匹配 ⇒ 确定性 fail。
- `quay-topology.sh` / `topology-check.sh` 脚本仍在（FACTORY 常量仍解析），是 **SKILL.md 措辞与 AC4 断言脱节**。
- **与 lowconc 移动无关**：隔离 5ms 即挂，不是并发现象。管理者「不排除是移动导致」——对 AC4 证伪。

### 定性二：AC3 = 真 cc3 并发失败，但「会话名互撞」机制不成立

- 全栈 fail（`quay-init-tmux-detection.test.mjs:218`「explicit --tmux-session must succeed」返回 2），隔离 6/6 全过。
- 两测试（session-topology / quay-init-tmux-detection）**均 hermetic 私有 socket**（`TMUX_TMPDIR`+各自
  mkdtemp，见 socketPathFor/isolateTmuxEnv），私有 socket 上会话名相同也不互撞 ⇒ 名字唯一化**治不了 AC3**。
- `runInit` 注入 `--worktree-root diskWorktreeRoot()`（/var/tmp 磁盘根）；quay-init --loop 内含 esbuild 打
  dist 包。cc3 并发多 --loop 测试（quay-init-loop-runtime/vendor/driver、install-config-driven-e2e）共享
  CPU/npm 缓存/资源压力，explicit 路径在 cc3 下 exit 2 —— **机制待内层 cc3 复现定位**（候选：资源压力下
  quay-init --loop 子步超时/失败，或与另一 --loop 测试共享 /var/tmp worktree-root 区）。
- 若复现确认是共享 worktree-root 区 → 修：每个 --loop 测试独立 worktree-root 根；若是资源压力 → 属
  lowconc 设计内抖动，回到 cc5/cc3 边界判定。

### 本轮 positive（全栈验证 793s / 3.5× 有效并行）

- reporter 在场：__PERFILE__ 267 行，每文件墙钟合计 2801.6s ÷ 793s = 3.5×；
- 拆分判据触发：`__CEILING__ session-liveness.test.mjs duration_ms=211391 封顶者/该拆`（另立任务）；
- serial 重组实益 ~93s（6 文件≈246s → 3 文件 153.4s），比名字匹配下界估计更大（管理者更正）。

### 顺带一个小修（管理者 20:1x 记）

`scripts/test.sh` 注释引用 `measure-suite-reporter-wired.test.mjs`，实际文件名 `measure-suite-reporter.test.mjs`
——按注释名查不到守卫，易误判「没装」。改一个词。

## Contract

measure ac4_stale = `grep -nE "quay-topology\\\\\\\\.sh|topology-check\\\\\\\\.sh" plugin/skills/cold-start/SKILL.md` stdout 数字段（修复后 SKILL.md 用子命令形式，裸脚本名断言应消失或改子命令形式）
measure ac3_cc3 = `cd /tmp/quay-suite-int && timeout 600 bash scripts/test.sh --group lowconc --test-concurrency=3 2>&1 | tail -5` stdout 数字段（修复后 lowconc 相位无失败）
band ac3_cc3 = 0（lowconc 相位无失败）
invoke `bash scripts/test.sh --group lowconc 2>&1 | tail -3`
control AC4 隔离跑改后过（断言与 SKILL.md 现行措辞一致）；AC3 cc3 并发跑不再 exit 2；全量并发 8 三趟 fail 0 / cancelled 0
resume 若中断，先跑 measure 读 AC4 断言措辞 + AC3 cc3 失败状态

## Acceptance Criteria

- [ ] AC1: **AC4 修复**——AC4 断言与 SKILL.md 现行措辞一致（`quay-session.ts quay-topology` /
      `topology-check` 子命令形式，或 SKILL.md 补裸脚本名交叉引用，取让 cross-annotation 语义成立的方案）；
      隔离 + 全栈都过
- [ ] AC2: **AC3 复现定位**——cc3 下复现 `explicit --tmux-session must succeed` 返 2，给出真机制
      （worktree-root 共享区 / 资源压力 / 其他），修掉后隔离 + cc3 并发都过
- [ ] AC3: **全栈并发 8 绿**——lowconc 相位 2 条失败消、三趟 fail 0 / cancelled 0
- [ ] AC4: **test.sh 注释改名**——`measure-suite-reporter-wired.test.mjs` → `measure-suite-reporter.test.mjs`
- [ ] AC5: 与 gap-session-liveness-tail-capped-split（同轮同相位、报告器坐实）交叉标注

## Definition of Done

- [ ] AC1-AC4 实跑输出贴进任务体（含 AC4 断言新旧对照、AC3 复现机制与修复前后 cc3 对照、全栈三趟绿）
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）

## Touches
- plugin/skills/cold-start/SKILL.md 或 plugin/test/session-topology.test.mjs（AC4 断言与 SKILL.md 措辞对齐）
- plugin/test/quay-init-tmux-detection.test.mjs 或 plugin/scripts/quay-init.sh（AC3 真机制修复）
- scripts/test.sh（注释文件名一词改）
- tasks/gap-session-liveness-tail-capped-split.md（AC5 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-07T20:2xZ
changed: 全栈 red 2 条证据定性——AC4 隔离即挂（SKILL.md 折叠进 quay-session.ts 子命令后断言陈旧，与移动无关）；
  AC3 真 cc3 并发失败但非会话名互撞（两测试均 hermetic 私有 socket）。原「会话名唯一化」诊断对两者都错，推翻。
