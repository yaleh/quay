---
id: gap-retired-script-still-callable
title: 退休脚本仍可调用——send-keys-verified.sh 是 Layered retirement
  范式原型(NEVER_LAYDOWN)但没退干净:①仍可调用(2026-08-10 我调用发错指引)②测试泄漏 tmux(144
  孤儿进程/round-210 红);capability-catalog 管入口、gate-scripts-retirement
  管出口单案例,缺「被取代机件是否仍有调用者」检查;加 superseded 表+三检查(不进 laydown/不教学/静态调用者 0)
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**`send-keys-verified.sh` 已经退休（Layered retirement 范式原型：`NEVER_LAYDOWN="send-keys-verified.sh quay-init.sh"`，gate-scripts-retirement.test.mjs 把它命名为此范式的原型个案——「the files stay in the plugin tree but are no longer laid down by quay-init and no longer synced by sync.sh」），但**没退干净**：①它仍可被调用（2026-08-10 我今晚就调了并据此发了错指引）——退休了但没人拦；②它的测试仍在跑并泄漏 tmux server（gap-send-keys-verified-leaks-tmux-servers-unincorporated，status ready，是这族唯一没办完的；144 个孤儿进程/700MB；round-210 的红就是它）。本任务办 ①：**退休脚本可调用性检查**——capability-catalog 管入口（183 声明/0 未分类/178 出货），gate-scripts-retirement 管出口但只是单个案例，**没有一道答「已被取代的机件是否仍有调用者」**。**

### 实证（人 2026-08-10 裁定 + outer 复核）

- **send-keys-verified 是退休范式原型**：quay-init.sh:816 `NEVER_LAYDOWN="send-keys-verified.sh quay-init.sh"`；:1348「send-keys-verified.sh is retired」；gate-scripts-retirement.test.mjs「Layered retirement (**send-keys-verified precedent**)」。≥8 个测试钉「它不被铺设」这条不变式。
- **没退干净**：①仍可被调用（我今晚调用并据此发了错指引——退休了但没人拦）；②测试仍在跑泄漏 tmux server（144 孤儿进程/700MB,round-210 红）。
- **缺的检查**：capability-catalog 管入口（新脚本无声明会被报出）、gate-scripts-retirement 管出口（单案例）——**没有一道答「已被取代的机件是否仍有调用者」**。
- **建议（人）**：给 capability-catalog 加 superseded 表 + 检查——superseded 脚本 ①不得进 laydown ②不得出现在任何 SKILL/README 的教学位置 ③静态调用者为 0。这是 manager 给自己加 A16 的仓库级版本。

**为什么重要**：退休但不拦调用 = 退休形同虚设——下一个人照旧用 send-keys-verified（我今晚就犯了），且其测试泄漏污染套件。把「被取代的机件无调用者」变成机械检查，退休才真正生效。

### 选定机制方向（实现归内层，接法留执行时）

1. **superseded 表**：capability-catalog 加 superseded 声明（send-keys-verified → supervisor-deliver/send-keys-reliable）。
2. **三检查**：①不得进 laydown（已有 NEVER_LAYDOWN,补目录 superseded 表联动）；②不得出现在 SKILL/README 教学位置（grep 教学文件）；③静态调用者为 0（grep plugin/scripts + packages + SKILL 里的 `send-keys-verified.sh` 调用,排除 NEVER_LAYDOWN/退休注释本身）。
3. **接线**：进 run_static_checks（或能力目录检查）。

**验证锚**：修后 (a) 目录有 superseded 表；(b) 静态调用者检查报 0 或列明；(c) 教学位置无 superseded 脚本。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 send-keys-verified 退休范式原型 + 没退干净（可调用 + 泄漏）+ 缺「无调用者」检查（本任务 Proposal 已含）
- [ ] AC2: **superseded 表**——capability-catalog 加 superseded 声明
- [ ] AC3: **三检查**——①不进 laydown ②不教学位置 ③静态调用者 0
- [ ] AC4: **接线**——进 run_static_checks
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：superseded 表 + 三检查输出（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/capability-catalog.sh（superseded 表 + 三检查）
- plugin/test/capability-catalog.test.mjs 或等价（AC2-AC4 测试）
- plugin/scripts/quay-init.sh（NEVER_LAYDOWN 已含 send-keys-verified——联动确认）
- tasks/gap-send-keys-verified-leaks-tmux-servers-unincorporated.md（交叉标注——②泄漏办完）
- tasks/gap-retired-script-still-callable.md（自身：勾 AC + 贴证据）

## Contract

measure   superseded_static_callers = `grep -rn "send-keys-verified.sh" plugin/scripts packages --include="*.sh" --include="*.ts" --include="*.mjs" | grep -v "NEVER_LAYDOWN\|retired\|superseded" | wc -l` 的 stdout 数字
band      superseded_static_callers = 0（superseded 脚本静态调用者为 0）
invariant superseded_not_in_laydown = 1（不进 laydown）
invariant superseded_not_in_teaching = 1（不教学位置）
invariant catalog_has_superseded_table = 1（目录有 superseded 表）
invoke    `bash plugin/scripts/capability-catalog.sh`（贴 superseded 表 + 三检查输出）
control   superseded 表在档；静态调用者 0；教学位置无 superseded；接线 run_static_checks
resume    superseded 表 / 三检查 / 接线分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: 人裁定——send-keys-verified 已退休（范式原型）但没退干净:①仍可调用（我今晚调用发错指引）②测试泄漏 tmux。本任务办①:capability-catalog 加 superseded 表 + 三检查（不进 laydown/不教学/静态调用者 0）,接线 run_static_checks。②泄漏归 gap-send-keys-verified-leaks-tmux-servers-unincorporated（ready）。实现归内层
