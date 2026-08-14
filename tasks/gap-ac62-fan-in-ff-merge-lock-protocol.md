---
id: gap-ac62-fan-in-ff-merge-lock-protocol
title: AC62 协议本体——fan-in 改 ff-only + 独立 merge 锁（锁只包 ff、持锁期间唯一动作是 ff）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**人 2026-08-14 02:2xZ 裁定（SPEC-fan-in-ff-merge-lock-2026-08-14，74e28bcc 入本阶段）**：inner 的 A6 fan-in 目前整段在主会话串行（`fast-mode-tick-core.md:25` 明文「串行」），其中只有最后一步真正需要串行。改为：

```
无锁段（全部在自己的 worktree 内，不碰共享检出）
  1. git merge develop            ← 冲突【只可能在这里】出现，慢慢解，不占任何人
  2. 跑全量 suite                 ← 绿才继续
  3. 跑 doc 检查                  ← 补 ff 不触发任何钩子的缺口（AC63）
持锁段
  4. git merge --ff-only          ← 唯一允许的动作
解锁（成功或失败都立即释放）
  失败 ⇒ 回第 1 步，并写一条重试记录（AC62 判据 ②）
```

**AC62 判据（SPEC 逐字）**：
- 判据1（协议本体）：fan-in 落地 = 「无锁段自测（merge develop + 全量 suite + doc 检查）+ 锁内 `git merge --ff-only`」；**锁只包 ff**（持锁时长毫秒级），持锁期间禁一切其它动作。
- 判据2（能取假）：develop 上出现**非 ff** 的 fan-in merge ⇒ 红；持锁段内出现 suite 调用 ⇒ 红。
- 判据3（失败路径）：ff 失败 ⇒ 写重试记录（任务 id / 第几次 / 当时 develop 头 / 时刻）。
- 判据4（活锁）：不预造机制；触发条件写死「同一任务 ff 失败 ≥3 次」才谈防活锁——届时才有真实重试分布。
- ⚠️ 锁覆盖范围不得与 suite 锁交叉（suite 锁覆盖第 2 步、merge 锁覆盖第 4 步，时间不重叠、对象不相干——人要求「两把锁覆盖范围不得交叉」天然成立）。

**关键性质（为什么 ff-only 是安全的，不依赖锁正确性）**：
A 从 develop@X 建树 → merge develop@X → 跑绿；期间 B 先 ff 上去 develop 变 Y；A 去 ff ⇒ 失败（tip 不含 Y）⇒ A 绝不可能把「未与 Y 一起测过」的状态推上去。**ff 失败原因唯一（develop 前进了）、处置唯一（回第 1 步重跑），无「ff 冲突」这种情况 ⇒ 不需要 needs-human 路径。**

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 SPEC §1-§4 + 现有 A6（fast-mode-tick-core.md:25）+ suite 锁（full-suite.lock.0/.1）。
2. 实现协议：无锁段（merge develop + suite + doc 检查）+ 持锁段（ff-only）。
3. 实现独立 merge 锁（锁只包 ff，毫秒级；覆盖范围与 suite 锁不交叉）。
4. 失败路径：重试记录（任务 id/第几次/develop 头/时刻）。
5. 检查器/负控制：非 ff 的 fan-in merge ⇒ 红；持锁段内 suite 调用 ⇒ 红。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 协议本体落地：fan-in = 无锁段自测（merge develop + 全量 suite + doc 检查）+ 锁内 `git merge --ff-only`；锁只包 ff、持锁期间唯一动作是 ff。
- [x] AC2 能取假：develop 上非 ff 的 fan-in merge ⇒ 红；持锁段内 suite 调用 ⇒ 红。
- [x] AC3 失败路径：ff 失败写重试记录（任务 id/第几次/当时 develop 头/时刻）。
- [x] AC4 锁覆盖范围不与 suite 锁交叉（时间不重叠、对象不相干）。
- [x] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] 协议落地 + 两把锁互斥 + ff-only 机械强制（非 ff ⇒ 红）。
- [x] 重试记录 + 既有测试绿。

## Touches

- orchestration/fast-mode-tick-core.md（A6 改为新协议——inner 执行核；**C17：outer-exclusive，本任务只给改法建议，不直写**）
- plugin/scripts/fan-in-ff-merge.sh（merge 锁实现——持锁段：锁只包 `git merge --ff-only task/<id>`，成功/失败即解锁，ff 失败写重试记录）
- plugin/scripts/fan-in-ff-protocol-check.ts（检查器——判据2 能取假：非 ff fan-in / 持锁段内 suite ⇒ 红；判据3 重试记录形状）
- plugin/test/fan-in-ff-merge.test.mjs（负控制 fixture——持锁段行为 + 重试记录）
- plugin/test/fan-in-ff-protocol-check.test.mjs（负控制 fixture——两条判据2 红 + NOT-EVALUATED）
- .gitignore（新增 `.quay/fan-in-merge-lock-events.jsonl` / `.quay/fan-in-retries.jsonl` 两个运行时状态文件的 ignore）
- plugin/scripts/capability-catalog.sh（两个新脚本入目录）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照再生）
- tasks/gap-ac62-fan-in-ff-merge-lock-protocol.md（自身）

**`plugin/scripts/integration-batch-merge.sh` 核对结论（按 SPEC §9 不覆盖清单）：不改。** 其 `--fan-in <id> --run-id <r>` 模式是**遥测 runId 桥**（`gap-task-telemetry-6-percent-join`）的承载体——它造 `merge: fan-in task/<id> (runId: …)` 提交、被 `fan-in-runid-check.ts` 按提交信息判读。改为 ff-only 会斩断该桥（ff 不造 merge 提交）；**SPEC 的 fan-in 协议本体由新脚本 `fan-in-ff-merge.sh` 交付**（outer 落 A6 时改调它）。runId 桥在 ff-only 下的新载体（manifest/重试记录）是 AC63/AC64 及后续的接线事项，本任务不覆盖。

## Evidence

- **协议本体（AC1）**：`plugin/scripts/fan-in-ff-merge.sh` 实现持锁段——`<git-common-dir>/fan-in-merge.lock`（flock）只包 `git merge --ff-only task/<id>`，成功/失败即解锁（`flock -u` + 进程退出自动释放，不预造陈旧锁回收）；持锁前拒绝 suite `state=running`（AC4/A9）；锁事件写 `.quay/fan-in-merge-lock-events.jsonl`。ff 成功实测：master fast-forward 到 task tip、无 merge 提交、acquire+release 成对。
- **判据2 能取假（AC2）**：`plugin/scripts/fan-in-ff-protocol-check.ts` 三判据——① 非 ff fan-in（基线后 `--merges` 提交 subject 匹配 `/fan-in/` 或 `Merge branch 'task/`）⇒ 红；② 持锁段内 suite 调用（锁事件 hold 区间 ∩ suite 运行区间）⇒ 红；③ 重试记录缺 taskId/attempt/developHead/ts ⇒ 红。负控制 fixture 实跑：`--no-ff` fan-in 后 checker exit 1（`non-ff-fan-in-merge-on-develop`）；构造重叠后 exit 1（`suite-call-inside-merge-lock`）；无基线 ⇒ NOT-EVALUATED（evaluated:false，不混同于绿——硬规则 3b）。
- **失败路径（AC3）**：ff 失败（develop 前进了）实测写重试记录 `{"taskId","attempt","developHead","ts","runId","error"}`，attempt 按任务递增（第 1 次=1、第 2 次=2）；exit 1 且 ref 不变。
- **锁不相交（AC4）**：merge 锁文件 `fan-in-merge.lock` 与 suite 锁 `full-suite.lock.0/.1` 不同文件、不同对象；merge 脚本 suite-running 时拒持锁（exit 2）；checker 的 overlap 判据机械验证时间不重叠。
- **门（AC5）**：`bash scripts/test.sh --for-task gap-ac62-fan-in-ff-merge-lock-protocol --allow-thin` = **38 tests / 38 pass / 0 fail**（含 capability-catalog.test.mjs 13、fan-in-ff-merge 9、fan-in-ff-protocol-check 16）；`bash scripts/test.sh --static-checks` exit 0；ts-typecheck 闸（新增 1 个 .ts）**GREEN（exit 0）**。
- **integration-batch-merge.sh 核对**：不改——其 `--fan-in` 模式是遥测 runId 桥（`gap-task-telemetry-6-percent-join`）承载体，ff-only 会斩断该桥；SPEC 协议本体由新脚本交付（见 Touches 核对结论）。

