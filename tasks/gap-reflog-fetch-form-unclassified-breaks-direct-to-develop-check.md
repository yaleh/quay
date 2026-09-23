---
id: gap-reflog-fetch-form-unclassified-breaks-direct-to-develop-check
title: reflog 分类器声称覆盖 fetch 却认不出本仓自己同步机制产生的 fetch
  形态——direct-to-develop-bypass-check 恒红
status: superseded
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/scripts/direct-to-develop-bypass-check.ts` 的 reflog action 分类器**声称**覆盖 `fetch …: storing ref`（该文件 `:24` / `:441` / `:479`，实现为 `/^fetch\b/.test(s) && /: storing ref\s*$/.test(s)`），`:478` 的注释预期形态是 `fetch -q . <sha>:refs/heads/<b>: storing ref`。

但本仓自己的分支同步机制（`plugin/scripts/driver-filters.ts` 的 author↔develop 传播）产生的**是另一种形态**，实测分类结果原文：

```
unsupported-reflog-action: fetch -q . author:develop, fetch -q . chore/quay-dev-marketplace:develop
```

即 `fetch -q . <branch>:<branch>`，**不带** `: storing ref` 后缀 ⇒ 落入 unknown ⇒ `NOT-EVALUATED` fail-closed。

后果：`plugin/test/direct-to-develop-bypass-check.test.mjs` 的 AC3 回放用例期望 `unclassifiable-commits-in-range`，实得 `unsupported-reflog-action: fetch -q . author:develop, fetch -q . chore/quay-dev-marketplace:develop`；实测 **57 pass / 1 fail**（`LC_ALL=C.UTF-8 LANG=C.UTF-8 TZ=UTC`，已排除 locale 成因）。该文件在任何任务的 fan-in 里恒红，与任何 delta 无关。

⛔ 修法**不得**是往白名单里加字符串：本仓自己在该文件 `:1137` 附近逐字写明「⛔ Not a spelling whitelist — a spelling whitelist is structurally blind to the next landing form（这正是 `branch: Reset to HEAD` 破掉 AC-194 的方式）」。要么按**结构**判定（`fetch` 把 ref 移到已存在的 commit ⇒ `refMove`），要么让测试不钉死 reason 字符串。

## AC

- [ ] AC1（复现固化）贴出 57/1 读数、失败断言的 `actual`（`unsupported-reflog-action: …`）与 `expected`（`unclassifiable-commits-in-range`）原文
- [ ] AC2（归因，硬规则 4 推论四）点名 `fetch -q . author:develop` 由哪个机制、哪个文件:行产生，并贴 `git reflog show develop` 中该条目的完整 `%gs` 原文
- [ ] AC3（修后）同一测试 58/0；并证明该 `fetch` 形态被**按结构**归为 `refMove`（贴该形态的分类结果）
- [ ] AC4（负控制·证明不是白名单）构造一个**此前未出现过**的 `fetch` 变体（例如 `fetch -q . <sha>:refs/heads/x`），分类器仍正确归类（贴读数）
- [ ] AC5（生产读数）落地后时间窗内一次真实 fan-in 的 suite 日志中该文件不出现在 `passed=false` 行（贴路径 + 时间戳 + 计数 0）
- [ ] AC6 `bash scripts/test.sh --for-task gap-reflog-fetch-form-unclassified-breaks-direct-to-develop-check` 绿

## DoD

真实落地：本仓自己的同步机制产生的 `fetch` reflog 形态在真实 fan-in 中被结构性地归类（AC3 + AC5），而不是被加进字符串名单（AC4 取假）。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts
- plugin/test/direct-to-develop-bypass-check.test.mjs
- tasks/gap-reflog-fetch-form-unclassified-breaks-direct-to-develop-check.md

## Superseded

**2026-09-23 — 并入 `gap-suite-ambient-reds-block-all-code-landings`，本任务置 superseded。**

原因：本任务单独立项时未察觉一个引导自锁——ff 闸要求 suite 证书 `state === "green"`（`plugin/scripts/worker-fan-in.ts:1588`），而四类环境红同时存在时 suite 恒红 ⇒ **只修一类的任务，其自身 worktree 内 suite 仍是红的 ⇒ 它自己也落不了地**。自 2026-09-16 起本机无一次全量 suite 跑绿，凡是 delta 需要跑 suite 的 code 任务全部落不了地（能落地的只有 doc-only 跳过 suite 的）。⇒ 必须一次修完四类红，才有一个"worktree 内 suite 为绿"的落地。

**落点映射（本任务内容逐条有家，硬规则 5 —— 本任务的 Proposal / AC / DoD / Touches 全部原样保留在上方，未删除任何一个字）**：

| 本任务 | 新落点 |
|---|---|
| Proposal 的全部实测读数 | `gap-suite-ambient-reds-block-all-code-landings` 的 Proposal 对应类别节（逐字保留） |
| AC1（复现固化） | 新任务同名类的 AC（第 1/3/4 类分别对应 AC1 / AC3 / AC4） |
| AC2（修后·位置判定） | 同上 |
| AC3（负控制·取假） | 同上 |
| AC4（与 CI 对齐 / 归因） | 同上 |
| AC5（生产读数） | 新任务 AC7 + AC8（判据升级为"另一个 code 任务真的过墙"） |
| AC6（scoped 门） | 新任务 AC9 |
| DoD | 新任务 DoD |
| Touches 的各条目 | 新任务 Touches 的同名条目 |
