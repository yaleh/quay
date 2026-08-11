---
id: gap-commit-message-claims-verified-without-verification
title: 8e2e49b9 commit message claims "all syntax verified" while carrying real
  merge corruption (trend-check duplicated 2×, 8 task frontmatters broken) —
  commit message is a new AC11 carrier, more dangerous than task body/tick rows
  (history won't re-verify)
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
## Finding

合并提交 `8e2e49b9`（2026-08-06 13:02:03，432 A 侧 + 99 B 侧提交、45 冲突）的**提交消息自称「all syntax verified」**，而它实际带着两类真实损坏：`plugin/scripts/trend-check.ts` 被复制 2 份（copy1+copy2 塞在文件中段）、8 个任务 frontmatter 不可解析。**提交消息是 AC11 族的一个新载体**，且比此前样本（任务体 / tick 行）更危险：它是历史记录，后来者读到 "all syntax verified" 不会去复验。

## 实测（2026-08-06）

- `8e2e49b9` 消息原文：`... 45 conflicts resolved (tasks/docs combine; tick docs two-line model; ...; all syntax verified)`
- 损坏：`82b1a719`（20:43）修复——"repair 8e2e49b9 merge corruption (file was duplicated 2×: copy1 + copy2 jammed mid-file)"；`9c6b4efd` 修 8 个不可解析任务 frontmatter。
- 发现延迟 d = **7 小时 41 分**（13:02:03 → 20:43:05），跨 154 提交，且发现途径是【为别的目的跑的全量套件偶然撞见】，不是任何针对性机制。

## 性质

`manager-phase-goal.md` AC11 要求「凡带已验证/verified 字样的断言必须同时给出验证命令与负控制」。此前样本都出现在**任务体与 tick 行**里；**合并提交消息是这一族的新载体**。它更危险：提交消息进历史，读者默认相信（"all syntax verified" 就是声称"我可以不验"）。

## 与测量的对应

`gap-no-post-merge-cross-machine-verification-detection-latency-is-luck`（已按人裁定去 cross-machine 限定保留）的标题断言 "detection latency is luck"——现在有了 **d=7.68h 的实测实例**（≈ 3.5× 模型破局点 2.2h）。损坏确实源自合并，与几台机器无关——支持该任务保留。

## 修复方向（接法留执行时）

给合并提交消息的 "verified" 类断言提供机械支撑：合并后必须跑实际验证（如 scoped 测试 / 语法检查的**命令与输出**），并让验证命令可复现（负控制：去掉验证命令则该断言不可信）。或建立一条机械检查：提交消息含 "verified" 时，要求同时给出验证命令引用（否则 flag）。

## AC（draft）

- [x] 提交消息的 "verified" 类断言必须伴随可复现的验证命令/引用（负控制：无命令则 flag）
- [x] 一条机械检查能检出「提交消息自称 verified 但缺验证命令」的提交
- [x] 与 `gap-ac8-import-over-spawn-ticked-...`（AC 勾选 ≠ 机制生效）与 `manager-phase-goal.md` AC11 交叉标注

## DoD（draft）

- [ ] 本仓未来合并提交消息带 "verified" 时，验证命令/负控制可机械追溯
- [ ] 完整套件绿

## Evidence

- `git log -1 --format=%s 8e2e49b9`：含 "all syntax verified"
- `82b1a719`（20:43:05）修复 trend-check 复制 2 份；`9c6b4efd` 修 8 个 frontmatter
- d = 13:02:03 → 20:43:05 = 7h41m（`orchestration/ANALYSIS-when-should-B-develop-...md` 已记，c1085e6b）

### Invoke evidence（2026-08-11，worktree 实跑）

- **scoped 门**：`bash scripts/test.sh --for-task gap-commit-message-claims-verified-without-verification --allow-thin` → **11 pass / 0 fail / 0 cancelled / EXIT 0**；scoped 静态检查 13 项全绿（含本检查器 `commit-message-verified-claim-check`、capability-catalog、delivery-inventory、test-framework-policy、test-isolation、test-impl-census、dead-code-after-return、adr016、tick-core、task-contract、superseded、delivery-inventory-drift-gate）。
- **检查器 RED（8e2e49b9 形态，裸断言无命令）**：`commit-message-verified-claim-check --root <repo> --depth 10` → `violations: 1`，`claim='all syntax verified'`，`subject='merge: 45 conflicts resolved (...; all syntax verified)'`，**EXIT=1**。
- **检查器 GREEN（同一断言带验证命令）**：`subject='merge: 45 conflicts resolved (...; all syntax verified — scripts/test.sh scoped green)'` → `violations: 0`，**EXIT=0**。
- **mutation case**：`checker-mutation-check.sh --check` → `MUTATION commit-message-verified-claim-check: pass`（注入裸断言必红、恢复命令引用必绿）。
- **AC3 交叉标注**：本检查器即「机械生效 ≠ 勾选」的实例——检查器被接进 `run_static_checks`（scoped + full 都跑），裸 verified 断言在下次测试即红，而不是等到 7h41m 后发现；对齐 `gap-ac8-import-over-spawn-ticked-...`（AC 勾选 ≠ 机制生效）与 `manager-phase-goal.md` AC11（verified 断言必须带验证命令 + 负控制）。

## Touches

- plugin/scripts/commit-message-verified-claim-check.ts（new：机械检查——提交消息含 "verified" 须带验证命令引用，否则 flag）
- plugin/test/commit-message-verified-claim-check.test.mjs（new：检查器测试 + 负控制）
- scripts/test.sh（接线到 run_static_checks，若需）
- tasks/gap-commit-message-claims-verified-without-verification.md（自身：勾 AC + 贴证据）
