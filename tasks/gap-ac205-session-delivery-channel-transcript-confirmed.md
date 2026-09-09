---
id: gap-ac205-session-delivery-channel-transcript-confirmed
title: 会话投递通道在项目生命周期内持续可用——send-to-session 从安装物真投且 transcript 外部可核（AC-205）
status: ready
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-205
---
## Proposal

AC-205（GOAL-009）判据 exit 1：载体 `.quay/productization-verification.jsonl` 无 `ac="GOAL-009-AC-205"` 记录。判据要求一条记录证明会话投递通道在项目生命周期内持续可用，过滤条件逐字为 `host≠本机 ∧ shipped_from_installed_artifact 为真 ∧ transcript_confirmed=true`（消息在目标会话 transcript 中被读到）。`transcript_confirmed` 必须由**读目标会话 transcript** 得出（外部可核），⛔ 不采信发送方自述——`send-to-session` 走 Unix socket 返回 0 字节、无 ack，退出码 0 不代表对方真收到（`send-to-session.ts` 头注释逐字）。

三重已知障碍（AC-205 origin，实现时逐个消除）：
① `send-to-session.ts` 不在 entry 集 ⇒ 安装物里无可执行形态——已由 AC-202（done，`gap-driver-kinds-table-literal-not-in-dist-entry`）覆盖进包。
② `driver-runtime.ts:449 notifyManager` 把它锚在 `opts.root` 且 fire-and-forget 无 ack ⇒ 失败不可见——路径锚定迁移已由 AC-203（ready，`gap-driver-runtime-driver-path-anchored-at-project-root-not-dist`）覆盖；「失败不可见」正是本任务 `transcript_confirmed` 要消除的：确认靠读 transcript，不靠 send 退出码。
③ 靠 Unix socket + `~/.claude/sessions/<pid>.json` ⇒ 发送方必须与目标会话**同主机**，跨主机须先 ssh 过去再发——本任务验证路径因此落在 host B/C 上（目标会话与该主机同址）。

本任务的**独有新增**（siblings 不覆盖）：
(a) **安装物自洽**：`send-to-session.ts:53` 的 `await import("../../packages/quay/src/serve-send.ts")` 是 dev-tree 相对路径；AC-202 只把它打进 `dist/send-to-session.js`，未验证该 bundle 在 staged `packages/quay/plugin/` 布局下是否把 `serve-send.ts` 内联（`build-plugin-dist.mjs:245-254` 的 `coreSrcAliasPlugin` 按 basename 重定向 Core 源，能否覆盖这条**动态 import** 未证）。若 `dist/send-to-session.js` 残留 dev-tree 相对路径，在安装物（无 packages/ 源码树）里运行即 `共享投递模块不可用` 退出 4（`send-to-session.ts:134` 逐字）。
(b) **transcript 外部可核投递**：验证路径在 host B/C 用**安装物 shipped 的** `dist/send-to-session.js` 给同址目标会话发 probe，再**读目标会话 transcript**（`--pid` 注册打印的 `sessionId` → `~/.claude/projects/<hash>/<sessionId>.jsonl`）grep probe 文本确认落达 ⇒ `transcript_confirmed=true`；读不到 ⇒ 不写（硬规则 3b，缺值≠合格）。
(c) **载体落账**：追加 `{"ts","ac":"GOAL-009-AC-205","host","shipped_from_installed_artifact":true,"transcript_confirmed":true}` 到载体，生产复跑使判据 exit 0。

**为什么是必须修的缺陷**：GOAL-009 的「间断介入」能力（问题分析、创建 goal/task）依赖会话投递常在，而非一次性点火；且长期保证上移到 goal 层（GOAL-009 与 GOAL-007 同源）。

## Plan

1. **验证/修 `dist/send-to-session.js` 自洽**：跑 `node --experimental-strip-types packages/quay/scripts/build-plugin-dist.mjs` 后 grep staged bundle 无 `packages/quay/src` 残留；若 >0，扩展 `coreSrcAliasPlugin`（或把 `send-to-session.ts` 的动态 import 静态化/改为 bundle 内引用）使其内联。⛔ 不改 `send-to-session.ts` 的投递语义，只保证 shipped bundle 自洽。
2. **接线验证步骤到 `verify-deliver-coldstart.sh`**（或同层）：host B/C 上，用安装物里的 `dist/send-to-session.js` 发 probe（`--pid <target>` 或 `--self`）到同址目标会话；从 `--pid` 注册读 `sessionId`，grep 目标 transcript jsonl 命中 probe 文本 ⇒ `transcript_confirmed`。
3. **载体落账**：追加 `ac="GOAL-009-AC-205"` 记录；`shipped_from_installed_artifact` 取「所用 send-to-session 出自安装物 dist 而非 dev 树」这一事实，`transcript_confirmed` 取 grep 命中布尔；缺任一读数不写（fail-closed）。
4. **生产复跑**（host B/C + 同址目标会话）使 AC-205 判据 exit 1 → exit 0。

## Acceptance Criteria

- [ ] AC1 安装物自洽：`node --experimental-strip-types packages/quay/scripts/build-plugin-dist.mjs` 后，staged `packages/quay/plugin/scripts/dist/send-to-session.js` 的 `grep -c 'packages/quay/src'` = 0（serve-send 已内联，无 dev-tree 相对路径残留）；若 >0 则修至 =0（贴出修前 grep 命中）。
- [ ] AC2 transcript 外部可核：验证步骤里 `transcript_confirmed` 的值来自 grep 目标会话 transcript（`sessionId` jsonl）命中 probe 文本的退出码，而非 `send-to-session` 的退出码；贴出该 grep 命令与命中行。
- [ ] AC3 载体落账：生产载体 `.quay/productization-verification.jsonl` 出现 `ac="GOAL-009-AC-205"` 记录，其 JSON 的 `host≠本机 ∧ shipped_from_installed_artifact=true ∧ transcript_confirmed=true` 三字段逐字满足 criterion 过滤条件（`grep -c '"ac":"GOAL-009-AC-205"'` ≥ 1）。
- [ ] AC4 负控制（不采信自述）：`send-to-session` 退出码 0 但 transcript 读不到 probe（如发往错 token/已退出会话）⇒ 该轮不写 AC-205 记录（`transcript_confirmed=false` 或整体不落账）；证明判据不被 send 退出码满足。
- [ ] AC5 判据能取假：追加一条 `ac="GOAL-009-AC-205"` 但 `transcript_confirmed=false`（或 `host=本机`）的记录 ⇒ criterion 仍 exit 1；验证后移除该记录、不污染生产载体。
- [ ] AC6 生产复跑：AC-205 criterion 干跑从 exit 1 → exit 0（贴出干跑输出）。

## Definition of Done

AC1–AC6 全绿；`scripts/test.sh` 全量绿（含 `packages/quay/test/build-plugin-dist.test.mjs` / `plugin/test/verify-deliver-coldstart.test.mjs`）。AC-205 criterion 从 exit 1 → exit 0，宿主为 B/C 之一，记录里 `shipped_from_installed_artifact=true`（所用 send-to-session 出自安装物 dist）且 `transcript_confirmed=true`（由读目标会话 transcript 得出，非 send 退出码）。⛔ 本任务只到「会话投递通道真投 + transcript 外部可核」这一层；端到端（AC-207 开发提交）是下游，另有 task。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- packages/quay/scripts/build-plugin-dist.mjs
- packages/quay/test/build-plugin-dist.test.mjs
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-ac205-session-delivery-channel-transcript-confirmed.md