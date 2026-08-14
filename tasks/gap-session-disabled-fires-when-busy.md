---
id: gap-session-disabled-fires-when-busy
title: SESSION-DISABLED 在最忙时误报——三合取缺「忙时必假」的直接量，③ cache_read 单调恒真（manager 12:2xZ 报）
status: ready
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

**（SESSION-DISABLED 复合判据在最忙时误报——manager 2026-08-14 12:2xZ 报，outer 读码确认）**。

**缺陷**：`plugin/scripts/session-liveness.sh` 的 SESSION-DISABLED 发射端三合取：
```bash
_sl_sat_disabled_verdict() {  # 三条件全满足 ⇒ emit，否则 hold
  if [ "$1" = "saturated" ] && [ "$2" = "1" ] && [ "$3" = "1" ]; then echo emit; else echo hold; fi
}
```
三合取 = ①`transcriptContextSaturation`（cache_read ≥ SATURATION_TOKENS=450000 且最后一条未应答） && ②`_sl_develop_silent`（develop 静默 ≥10min） && ③`_sl_worktree_set` 集合无变化。

**实测误报（manager 12:1xZ 事件，12:16Z）**：SESSION-DISABLED 触发，但当时 **5 个 worktree 在飞**、两层主会话 mtime 均 0 分钟前——**最忙的时候响了**。拆三合取：
- **③ `cache_read ≥ 450000` 是硬规则 4 形态**——monotonic、永不回落（manager 的 50MB transcript 早已超，只增）⇒ 对判别力贡献 = 0，**结构上不可能取假**。
- **①② 在「多任务同时实现」时同时翻真**——实现阶段不提交 develop（②真）、不建新 worktree（③真）⇒ **有效判别力实际只剩「develop 静默 ≥10min」一条**，而它恰在最忙时（多个实现子代理在飞）也真。

**判据1**：给 SESSION-DISABLED 复合判据加一条**「忙时必假」的直接量**把「忙」与「失能」分开——manager 建议两条方向：
```
在飞 worktree 内有活进程（忙 ⇒ 该条真 ⇒ 不报 DISABLED）
或 目标会话 transcript 距今 >T 无写入（失能 ⇒ 该条真 ⇒ 报 DISABLED）
```
选哪条由实现者按 direct-quantity 原则裁（外部可核、非自产、能取假）。
**判据2（能取假）**：现状三合取在「多任务实现中」回放 ⇒ 误报 DISABLED（真样本=manager 12:16Z 事件，5 worktree 在飞时响）⇒ 红；修复后同场景 ⇒ 不报（绿）。**且必须有一条【忙时必假】的合取项——验证它能在忙时取假，不是恒真**（硬规则 4：恒真合取项贡献零）。
**判据3**：`session-liveness.test.mjs`（SESSION-DISABLED 复合条件发射端，AC1-AC5）同步更新——AC3 负控制加「多任务实现中不报」用例；新合取项有独立测试（能取假）。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿（含 session-liveness 家族）。

**不覆盖**：不改 SESSION-DISABLED 的语义（「饱和且随后指令未被响应」才报）；不改 SATURATION_TOKENS / SATURATION_SILENCE_MIN 阈值（阈值本身不是缺陷）；不引入新的 Monitor/事件。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 session-liveness.sh SESSION-DISABLED 发射端（:520-554）+ session-liveness.test.mjs（AC1-AC5）。
2. 判据1：加「忙时必假」直接量（活进程在 worktree / transcript 无写入）进三合取。
3. 判据2 能取假：manager 12:16Z 场景（多实现在飞）回放不报；单任务实现中不报；真失能（无活进程+静默）仍报。
4. 判据3：session-liveness.test.mjs 补用例。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：SESSION-DISABLED 加「忙时必假」直接量（活进程/transcript 无写入），忙与失能可区分。
- [x] AC2 判据2 能取假：manager 12:16Z 场景（5 worktree 在飞）回放不报 DISABLED；真失能仍报；新合取项忙时取假。
- [x] AC3 判据3：session-liveness.test.mjs 补「多实现中不报」负控制 + 新合取项测试。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] SESSION-DISABLED 不再最忙时误报：三合取补「忙时必假」直接量 + 回放 manager 12:16Z 场景绿 + session-liveness 家族测试全绿。

## Touches

- plugin/scripts/session-liveness.sh（SESSION-DISABLED 复合判据加忙时必假直接量）
- plugin/test/session-liveness.test.mjs（补负控制 + 新合取项测试）
- tasks/gap-session-disabled-fires-when-busy.md（自身）

## Test-Files

- plugin/test/session-liveness.test.mjs（SESSION-DISABLED 复合发射端 AC1-AC5 + 新④ 能取假 + 多任务实现中不报）
- plugin/test/session-liveness-signals-kinds.test.mjs（阶段四 AC2 承重条——饱和 vs 普通忙，回归确认不破）

## Evidence

（以下为落地后实测输出，2026-08-14）

**选择的方向**：在飞【链接】worktree 内有活进程（`/proc/<pid>/cwd` 解析，外部可核、非自产、能取假）——
比 transcript mtime（自产）更符合硬规则 4b 的「外部可核」偏好，且不会把「跑长命令期间 transcript 暂时不写」
误判成失能。

**`--for-task` scoped 门**（`bash scripts/test.sh --for-task gap-session-disabled-fires-when-busy --allow-thin`，exit 0）：
```
PASS: every test file uses node:test or is a listed legacy exemption ...
PASS: all 26 violation(s) are baselined in plugin/test-isolation-violations.txt ...
tmp-leak-pairing-check — 396 file(s), 0 unpaired mkdtemp result(s). PASS.
PASS: active whole-screen-hash violations (0) within band (0..1)
superseded-capability check: PASS — every superseded capability is removed ...
PASS: no dead code after a top-level return ...
PASS — every concurrency literal is at a QUAY_MAX_* definition point or a declared fallback (0 violations)
PASS — every declared landing target == forward branch 'develop' (0 violations)
PASS: delivery-inventory drift gate ...
== build dist/quay.js ... ==   == build dist/quay-native.js ... ==   == mirror vendored plugin dist ... ==
ℹ tests 7   ℹ pass 7   ℹ fail 0   (session-liveness.test.mjs: 7/7 全绿)
```

**session-liveness.test.mjs 逐条**（7 条全过，含 2 条新增）：
```
✔ AC1/AC4 — SESSION-DISABLED fires when 饱和 && develop 静默 ≥T && 在飞 worktree 集合无变化 && 无活进程 (all four hold); exactly one emission per spell (edge-trigger)
✔ AC3 负控制 — 饱和但 develop 活跃 ⇒ 不发
✔ AC3 负控制 — 饱和且静默但在飞变 ⇒ 不发
✔ AC1 负控制 — 不饱和 ⇒ 不发
✔ AC2 — SATURATION_SILENCE_MIN is env-configurable ... gates the composite
✔ 新④ 能取假 — 忙时 worktree 有活进程 ⇒ 不报 DISABLED；活进程消失（真失能）⇒ 报 (conjunct can take false)
✔ AC3 负控制 — 多任务实现中不报 (manager 12:16Z: 5 worktrees 在飞 + 忙活进程，replay)
```

**ts-typecheck gate**（exit 0，无新 .ts 文件）：
```
fan-in-ts-typecheck-gate: task gap-session-disabled-fires-when-busy — Touches do not cover any; new/moved .ts in diff: 0
fan-in-ts-typecheck-gate: no new/moved .ts in the declared write surface — no typecheck gate needed
fan-in-ts-typecheck-gate: ADMITTED (exit 0)
```

**判据2 回放（测试内）**：`新④ 能取假` 先验证忙时（worktree 有活进程）4 轮不报、活进程消失后发射；`多任务实现中不报` 用 5 个稳定链接 worktree + 1 个活进程回放 manager 12:16Z，≥4 轮无 DISABLED。旧三合取在该场景（饱和+develop 静默+集合稳定）本应发射——「不报」只能归因于新合取项忙时取假。
