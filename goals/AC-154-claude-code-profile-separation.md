---
id: AC-154
title: Claude Code profile 抽层 + 独立承载
status: active
kind: criterion
goal: GOAL-002
origin: |
  人 2026-08-23 裁定「前述可重用机制应当分层抽象，以支持这两层上的重用」；
  正本 orchestration/SPEC-unified-driver-architecture-2026-08-23.md §2.1/§2.5/§2.6。
---

**判据（能取假）**：`profiles`（可复用）与 `roles`（引用 profile）分离；`bare` **只在一层出现**；
`env` 的"取消继承"显式表达为 `unset:[...]`（⛔ 非空字符串约定）；profile 有自己的承载文件，
`launch.settings.json` 只留 Claude Code 认识的键。

**取假**：①`bare` 仍有两级（顶层 + role）⇒ 假（**该歧义已造成 AC142 的 13/13 全败，⛔ 不留第二次**）；
②「给所有 worker 换模型」仍需改三处以上 ⇒ 假；③profile 仍寄生在 `_launchSpec` 下划线扩展键里 ⇒ 假。

**⊢ criterion 留空**：本条是语义判据、无可跑 shell 判据；`gate` fail-closed（红）是诚实状态（SPEC-0809 §3）。
