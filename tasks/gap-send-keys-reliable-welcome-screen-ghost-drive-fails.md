---
id: gap-send-keys-reliable-welcome-screen-ghost-drive-fails
title: "send-keys-reliable pane-empty check fails on welcome-screen ghost text
  (Try \"fix lint errors\" = real visible text, C-u can't clear, CLEAR_MAX=50
  fail-loud) — the TRUE root of watchdog 11:40 drive failure; NBSP fix (11:46
  sync) doesn't cover it; fix: fresh-session (no transcript/zero user msgs)
  skips clear-loop, sends directly (archguard manual seq proven)"
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**send-keys-reliable 判空不覆盖 welcome 屏 ghost 文本——watchdog 11:40 驱动失败的真根因（管理者复核确认）**：

**实测（archguard 第一份交付验证数据）**：NBSP 修复版在 fresh welcome 屏**仍然失败**。`pane_input_box_empty`
只显式剥 NBSP 两字节 + ANSI，然后 `case *[![:space:]]*` 判非空。而 welcome 屏 `❯ Try "fix lint errors"`
的 ❯ 后有**真实可读文本**（UI 渲染层的 ghost suggestion）——必然判非空，C-u 清不掉 → 死循环跑满
CLEAR_MAX=50 → fail loud → rc=1。

**两个失败场景不同**：NBSP 修复覆盖「空框渲染成 ❯+NBSP」；watchdog 撞的是「welcome 屏 ❯ 后有真实
ghost 文本」。11:46 同步 NBSP 修复版过去**没有修好这个**。

**修法（archguard 手工序列已验证成功）**：判空不应试图「清空」ghost 占位符（清不掉），而应把
**fresh session（transcript 不存在或零条 user 消息）当成已知分支【跳过清屏直接发】**。

**优先级（管理者 13:3xZ 裁定）**：这是 **AC12b（产品主判据，两层无人干预区间）的唯一硬阻塞**——
B 机（orangevps）是唯一干净测量场，但 fresh-session 分支命中 0，welcome 屏缺陷原封不动，cold-start
INNER-DRIVEN 用它驱动内层。**排在任何其它任务之前**。

**交叉标注（AC5，2026-08-08——`gap-install-upgrade-verification-targets-real-downstream-workspaces`）**：
AC12b 已达成后（人方向）可更频繁验证安装/升级/冷启动——本任务 AC12b 是「两层无人干预区间」的唯一硬阻塞；
`gap-install-upgrade-verification-targets-real-downstream-workspaces` **AC2（频率机制）正是把「AC12b 达成后
可更频繁验证」落实成机制**：真实目标验证从「只在里程碑边界」提高到每个验证轮（`orchestrator-loop-tick.md`
验证轮步骤 5），archguard 干净区间约束解除。

**AC11 一族**：管理者 11:46 说「已同步并校验一致」是真的，但隐含断言「问题已解决」没验证。

### 选定机制

1. `send-keys-reliable.sh`：检测 fresh session（目标 transcript 不存在 或 零条 user 消息）⇒ 跳过清屏循环，直接发送驱动文本
2. 保留 NBSP 修复（空框场景仍需要），但 fresh-session 分支优先
3. 验证：fresh welcome 屏（ghost 文本）⇒ 直接发送成功（archguard 场景）；正常空框 ⇒ 走 NBSP 清屏路径

## Acceptance Criteria

- [x] AC1: fresh welcome 屏（`❯ Try "..."` ghost 文本）⇒ send-keys-reliable 跳过清屏直接发送，rc=0（archguard 场景，负控制——当前会 fail loud rc=1）
- [x] AC2: 正常空框（`❯`+NBSP）⇒ 仍走 NBSP 清屏路径（不回归）
- [x] AC3: 与 gap-os-anchor-watchdog-drive-retry-and-rc-semantics 交叉标注（watchdog 驱动依赖此修复）
- [x] AC4: 实测：kill archguard outer → watchdog relaunch → drive 成功（transcript 出现 user 消息）——AC2 完整闭环

### AC1–AC3 验证证据（2026-08-05，worktree 分支 task/gap-send-keys-reliable-welcome-screen-ghost-drive-fails）

**真实 fresh session 实测（AC1，claude-deepseek --model deepseek-v4-flash，独立临时目录，非 live 会话）**：
启动后欢迎屏实测内容为 `❯ Try "write a test for <filepath>"`（ghost 文本），target transcript 尚不存在。运行修复后脚本：

```
$ bash plugin/scripts/send-keys-reliable.sh skr-real-2864688 "echo real-fresh-drive-ok-2864688" ~/.claude/projects/-tmp-skr-real-fresh-2864688/<session>.jsonl
send-keys-reliable: fresh session（transcript 无 user 消息）——SKIP 清屏循环，直接发送
send-keys-reliable: 已送达 skr-real-2864688（transcript 出现内容匹配的真实 user message）
delivered: true
matched_line: {"...","type":"user","message":{"role":"user","content":"echo real-fresh-drive-ok-2864688"},...}
RC=0
```

输出无 `fail loud` 且无 `CLEAR_MAX`（Contract measure `fresh_welcome_drive`=0）。transcript 由「不存在」变为含该驱动文本的真实 user message。

**真实 active session 实测（AC2 不回归）**：首条消息后 session 已非 fresh（transcript 已有 2 条 user 消息），输入框为空（`❯`+NBSP）。第二次驱动：

```
$ bash plugin/scripts/send-keys-reliable.sh skr-real-2864688 "echo real-active-drive-ok-2864688" <同上 transcript>
send-keys-reliable: 已送达 skr-real-2864688（transcript 出现内容匹配的真实 user message）
delivered: true
RC=0
```

输出**无** `SKIP 清屏循环` 分支（走的是 NBSP 清屏路径），user 消息 2→3。

**AC1 e2e 自动化测试**（`plugin/test/send-keys-reliable.test.mjs`，真实 tmux fixture 渲染 `❯ Try "fix lint errors"` ghost 文本、CLEAR_MAX=2）：fresh welcome → rc=0、断言无 `fail loud|CLEAR_MAX`、断言走 `SKIP 清屏循环` 分支、transcript 出现 marker。AC2 e2e 改为非 fresh（transcript 预置 user 消息）保 NBSP 清屏路径回归，断言无 SKIP 分支。**scoped 运行**：`bash scripts/test.sh --for-task gap-send-keys-reliable-welcome-screen-ghost-drive-fails` → EXIT=0，`tests 28 / pass 28 / fail 0 / cancelled 0 / skipped 0`，scoped 静态检查全 PASS（test-framework-policy、test-isolation、task-contract-check「no violations」、adr016-screen-use）。

**AC3 交叉标注**：已在 `tasks/gap-os-anchor-watchdog-drive-retry-and-rc-semantics.md` Proposal 加「交叉标注（2026-08-05…）」段 + Dispatch review，写明 watchdog 驱动依赖此修复、修 drive 重试/rc 语义时须验证 fresh 屏不回归。

**AC4 未勾**：需 kill archguard outer 走 watchdog 重拉闭环，属 live-loop 干预；本任务在 worktree 隔离分支执行，不动 archguard-4/quay-0。留 fan-in 由外层实测（DoD 未勾）。

**AC1–AC3 复核（2026-08-06，worktree task/gap-send-keys-reliable-welcome-screen-ghost-drive-fails，复用 master 已落地的修复 a75dde7e）**：本次内层复核 scoped 验证：

```
$ bash scripts/test.sh --for-task gap-send-keys-reliable-welcome-screen-ghost-drive-fails   (EXIT=0)
ℹ tests 28 · pass 28 · fail 0 · cancelled 0 · skipped 0
scoped check: run_checker "test-framework-policy-check" … PASS
scoped check: run_checker "test-isolation-check" … PASS (all 44 violation(s) are baselined …)
scoped check: run_checker "test-impl-census-check" … checked 226 test files · clean 226 · impl-deleted 0
scoped check: run_checker "task-contract-check" … task-contract-check: no violations.
scoped check: run_checker "adr016-screen-use-check" … PASS: active whole-screen-hash violations (1) within band (0..1)
```

直接运行任务命名的测试文件 `bash scripts/test.sh plugin/test/send-keys-reliable.test.mjs` → 同样 `tests 28 / pass 28 / fail 0 / cancelled 0 / skipped 0`。其中 AC1 e2e（fresh welcome 屏 ghost 文本 + CLEAR_MAX=2）断言无 `fail loud|CLEAR_MAX` 且走 `SKIP 清屏循环` 分支、rc=0、transcript 出现 marker；AC2 e2e（非 fresh，transcript 预置 user 消息）断言无 SKIP 分支、走 NBSP 清屏路径。Contract measure `fresh_welcome_drive`=0 由 AC1 e2e 的 `doesNotMatch(fail loud|CLEAR_MAX)` 断言覆盖；`invoke` grep 确认 `--is-fresh`/`fresh_session`/`SKIP 清屏循环`/`CLEAR_MAX` 均在 `plugin/scripts/send-keys-reliable.sh` 中。AC4 仍未勾：需 kill archguard outer 走 watchdog 重拉闭环（live-loop 干预），worktree 隔离执行不动 archguard-4/quay-0，留 fan-in 由外层实测。

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] fresh welcome 屏实测：send-keys-reliable 跳过清屏直接发送，rc=0，transcript 出现驱动文本的 user 消息（AC1/AC4 实跑输出贴任务体）
- [ ] 正常空框（`❯`+NBSP）仍走 NBSP 清屏路径，rc=0（AC2 不回归，实跑输出贴任务体）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

**needs-human 时效性分诊关闭（2026-08-09，outer 依人裁定执行；判定：fix a75dde7e landed on integration+develop; AC1-AC3 verified with real fresh-session + active-session evidence (28 scoped tests pass); AC4 is a live watchdog-relaunch verification the outer runs, not a human decision.）**
全文见 git 历史（`git log -p -- tasks/gap-send-keys-reliable-welcome-screen-ghost-drive-fails.md`）。

## Touches
- tasks/gap-send-keys-reliable-welcome-screen-ghost-drive-fails.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/scripts/send-keys-reliable.sh（fresh-session 分支）
- plugin/test/send-keys-reliable.test.mjs（AC1-AC2 测试）
- tasks/gap-os-anchor-watchdog-drive-retry-and-rc-semantics.md（AC3 交叉标注）

## Contract

measure   fresh_welcome_drive = `bash plugin/scripts/send-keys-reliable.sh <fresh-pane> <text> 2>&1 | grep -c 'fail loud\|CLEAR_MAX'` stdout 数字段
band      fresh_welcome_drive = 0（fresh 屏不再 fail loud）
invariant fresh_session_skips_clear = 1（transcript 不存在/零 user 消息 ⇒ 跳过清屏直接发）
invoke    `grep -n 'fresh\|transcript\|skip\|CLEAR_MAX' plugin/scripts/send-keys-reliable.sh`
control   fresh welcome 屏（ghost 文本）⇒ rc=0 直接发（AC1）；空框 ⇒ NBSP 路径（AC2）
resume    fresh-session 分支与测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: none
at: 2026-08-05
changed: inner 执行——(1) transcript-delivery-check.ts 新增 hasUserMessages 纯函数 + `--is-fresh`
CLI（ENOENT=不存在 ⇒ fresh；零 user 消息 ⇒ fresh）；(2) send-keys-reliable.sh 新增 fresh-session
分支：transcript 不存在/零 user 消息 ⇒ SKIP 清屏循环直接发（welcome 屏 ghost 文本不再 CLEAR_MAX
fail loud）；(3) send-keys-reliable.test.mjs 新增 AC1 fresh-welcome e2e（ghost 文本 + CLEAR_MAX=2，
rc=0 无 fail loud）+ AC2 改非 fresh（transcript 预置 user 消息）保 NBSP 清屏路径回归；(4) watchdog
任务 AC3 交叉标注。AC4（kill archguard outer → watchdog 重拉驱动）为 live-loop 干预，worktree 隔离
下不做，留 fan-in 由外层实测。