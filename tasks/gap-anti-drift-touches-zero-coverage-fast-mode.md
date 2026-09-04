---
id: gap-anti-drift-touches-zero-coverage-fast-mode
title: anti-drift-touches 守卫在 fast-mode 零覆盖——自称 NON-WAIVABLE 但全部调用者在退役 classic-loop 侧，收窄 Touches 无安全网（manager 16:3xZ 报 + outer 按位置核实）
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

**（anti-drift-touches 守卫 fast-mode 零覆盖——manager 2026-08-14 16:3xZ 报，outer 按位置核实）**。

**现象**：`plugin/scripts/anti-drift-touches-check.ts` 自称「the NON-WAIVABLE after-the-fact HARD guardrail … trusts NOTHING: after a concurrent batch has RUN, it takes each build's ACTUAL touched files … and HARD-FAILS if either (a) a build wrote OUTSIDE its declared touches … or (b) two builds ACTUALLY touched the same file」——但它自己不跑 `git diff`（注释明写「the driver supplies them」）。

**零覆盖核实（outer 按位置，2026-08-14 16:2xZ）**：
```
⊢ 谓词 `grep -c 'anti-drift-touches' .claude/workflows/fan-in-execute.js` = 0        （真零）
⊢ 干跑（同一文件已知真样本）：`grep -n 'touch' fan-in-execute.js` 命中 :77（Touches 闸）⇒ 谓词有效，上面的零是真的
非测试调用者枚举：concurrent-batch-scheduler.ts · select-preflight.ts · golden-replay-dir044.ts
  · anti-drift-touches-check.sh · sync-vendor.sh · derive-touches-heuristic.ts —— 全在退役 classic-loop / 工具侧
  ⇒ 零个在 fan-in-execute.js / fast-mode 路径
fan-in-execute.js 唯一的 actual-diff 读数是 :65 `git diff --name-only`（喂 code_delta 跳过全量判定），
  **不是** declared-vs-actual 的事后核对
```

**后果**：fast-mode 下「声明过窄/不诚实」与「两任务实碰同一文件」都没有任何东西会 HARD-FAIL。而我们的方向正是【鼓励收窄 Touches】（CLAUDE.md 实证：4 条任务目录级收窄后 dispatchable_disjoint 4→7、criterion_met 翻 True）——**收窄恰是最需要该守卫的方向**（越窄越准的前提是越界会被抓；没有守卫，越窄=放松 gate）。

**判据1**：fan-in 路径（fan-in-execute.js 或其所调脚本）存在一处 anti-drift-touches-check 调用，输入=该 build 实际触碰文件集 + 声明 Touches。
**判据2（能取假·真样本不构造）**：**故意让一个任务写到 Touches 之外，fan-in 应 HARD-FAIL**——现真值：不会（零调用）⇒ 假。修复后该负控制应红。
**判据3（不破坏既有行为）**：合法收窄（实际触碰 ⊆ 声明）不应红——判别「收窄是订正还是撒谎」的机械判据正是它：收窄后实现真的碰了 Touches 之外的文件 ⇒ 那次收窄被 HARD-FAIL 抓住。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿。

**⚠️ 与 gap-fan-in-suite-data-not-accounted 同碰 `.claude/workflows/fan-in-execute.js`**（manager 16:3xZ 指出）——两者一起做只需一次解封（flip-no-ac 落地后）。

**不覆盖**：不写死收窄策略（收窄由实现者按实际计划做，非 gate 驱动）；不改 anti-drift-touches-check.ts 的判定逻辑本身（它按 driver 供的 diff 判，逻辑没问题——缺的是 driver）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 fan-in-execute.js 的 merge/land 流程 + anti-drift-touches-check.ts 的输入契约（driver 供什么）。
2. 判据1：fan-in 路径接 anti-drift-touches-check（输入=实际触碰文件集 + 声明 Touches）。
3. 判据2 能取假：负控制——故意越界触碰，fan-in HARD-FAIL（现不会）。
4. 判据3：合法收窄不红。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：fan-in 路径存在一处 anti-drift-touches-check 调用（实际触碰 vs 声明 Touches）。
- [x] AC2 判据2 能取假：故意写到 Touches 之外 ⇒ fan-in HARD-FAIL（现真值=不会）。
- [x] AC3 判据3：合法收窄（实际 ⊆ 声明）不红。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] anti-drift-touches 守卫接入 fan-in 路径（越界触碰 HARD-FAIL）+ 合法收窄不红 + 测试绿。

## Touches

- .claude/workflows/fan-in-execute.js（merge/land 后调 anti-drift-touches-check，输入实际 diff）
- plugin/workflows/fan-in-execute.js（.claude 版双副本镜像——workflows-dual-copy-drift-check 要求双副本同改）
- plugin/scripts/anti-drift-touches-check.ts（若需暴露 driver 输入面；判定逻辑不动）
- plugin/test/（补测：越界触碰 HARD-FAIL 负控制 + 合法收窄绿）
- tasks/gap-anti-drift-touches-zero-coverage-fast-mode.md（自身）

## Test-Files

- plugin/test/fan-in-execute-paths.test.mjs

## Evidence

（回填 2026-08-14，impl 落地后）：
- 判据1（实际触碰 vs 声明 Touches）：fan-in-execute.js step 1 merge 后接 driver 调用
  `anti-drift-touches-check.ts --task <id> --worktree <dir> --merge-target <ref>`；driver 输入面新加
  （读任务体 `## Touches` + `git diff --name-only <merge-target>...HEAD` = fan-in 将 land 的文件），判定逻辑（checkAntiDrift）未动。
- 判据2 负控制（能取假·现真值=不会）：`plugin/test/fan-in-execute-paths.test.mjs` ⑤ REAL negative control ——
  真实 temp git repo（step-1 merge 后状态）中任务实际 diff 含 `pkg/OTHER/stray.js`（声明 Touches 之外）⇒
  anti-drift 块 HARD-FAIL（exit 2 + FATAL + `ANTI-DRIFT HARD FAIL: task wrote pkg/OTHER/stray.js`）。实测红。
- 判据3：⑤ REAL positive —— 实际 diff ⊆ 声明 Touches ⇒ `ANTI-DRIFT OK`（exit 0）。实测绿。
- 判据4：`scripts/test.sh --for-task gap-anti-drift-touches-zero-coverage-fast-mode --allow-thin` 绿；
  `fan-in-execute-paths.test.mjs` 21 测试全绿（16 既有 + 5 新增 ⑤）；ts-typecheck 闸 admitted（本任务无新增/移动 .ts）。
- 双副本：`plugin/workflows/fan-in-execute.js` 与 `.claude/workflows/fan-in-execute.js` 同步（workflows-dual-copy-drift-check 绿）。
- 背景核实（outer 2026-08-14 16:2xZ）：谓词 `grep -c anti-drift-touches fan-in-execute.js`=0，干跑 touch 命中 :77 ⇒ 零为真；
  suite-budget 收窄在有守卫前无安全网，见 suite-budget 任务体。
