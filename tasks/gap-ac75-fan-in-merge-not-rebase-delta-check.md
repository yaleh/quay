---
id: gap-ac75-fan-in-merge-not-rebase-delta-check
title: AC75 fan-in 无锁段第1步 rebase→merge + 新增 delta 断言面判定（人 07:0xZ 裁定）
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

**AC75（fan-in 无锁段 rebase→merge + delta 断言面判定 —— 人 2026-08-14 07:0xZ 逐字「既然 develop 的变更很少，那么应该优先做 merge 而不是 rebase，而且应判断 develop 的变更是否需要再次跑 suite 测试」）**。

**判据是【重验成本】，不是历史形态（manager ②）**：
```
rebase   分支每个 commit 被重写 ⇒ 整条分支成"新组合" ⇒ 之前跑绿的结果【全部作废】⇒ 只能无条件重跑全量 suite（~390s）
merge    分支 commit 原样保留，只多一个 merge commit ⇒ 【新的只有那个 delta】⇒ 可以问「这个 delta 碰没碰断言面」⇒ 多数情况【不需要重跑】
```
**而 develop 的 delta 恰恰小且多为非代码**（构成：`tasks/` 58 · `manager:` 28 · `telemetry` 15 · `docs` 6 · `core` 6 · `inner` 5 · `fix` 4 · `test` 3 · `gitignore` 2）⇒ **绝大多数根本不触及套件断言面。**

**SPEC §7 活锁账随之翻转**：ff 失败**频率**不变（develop 前进快），但**每次失败代价从「必然 ~390s」降为「多数情况秒级」**——§7b「重试代价必须按整段算」只在 rebase 路径下成立（manager 已在 SPEC 标注）。

**manager 自记的错（④，写进 SPEC §1b）**：查「实现 rebase 11 次 / SPEC 写 merge 0 次」就以「实现为准」把 SPEC 改成 rebase——**把「实现在做什么」当成了「什么是对的」，没问哪个更好**；而 SPEC §3 自己就论证过 merge 路径（「第 1 步之后分支 tip 是以 develop@Y 为父的 merge commit ⇒ ff 成立」）⇒ **改掉的是一份自洽设计，去迁就一份没人审过的实现**。**判据：发现 SPEC 与实现分歧时先问【哪个更好】，不得默认以实现为准——分歧只说明有一处没被判据读到（AC73 族）。**

**AC67 判据2 已达成（manager ⑦，第一条真实 ff 重试记录）**：
```
{"taskId":"gap-ac67-…","attempt":1,"developHead":"24bcad50…","ts":"2026-08-14T06:38:45Z",
 "runId":"fm-gap-ac67-…","agentId":"aab2d14d10a762ff4","mergeTarget":"develop",
 "error":"hint: Diverging branches can't be fast-forwarded…"}
agentId aab2d14d 对应 bc1a438b/subagents/agent-aab2d14d10a762ff4.jsonl = 【subagent，非主会话】⇒ 执行者确已搬进 subagent
锁事件 acquire/release 同一秒、同 pid、同 runId ⇒ 持锁 0 秒（SPEC §2 毫秒级）✓
```

**判据（manager ⑥，实现面三处）**：
- **判据1（无锁段第 1 步 rebase→merge）**：`fast-mode-tick-core.md` A6 无锁段第 1 步 + `fan-in-ff-merge.sh` 重试路径文案——rebase 改 merge（inner 现行 11 次全是 rebase）。
- **判据2（新增 delta 断言面判定，fail-closed）**：无锁段第 2 步——merge 后判断「这次 develop delta 要不要重跑 suite」：看 delta 是否触及断言面（复用 AC51 的 doc/代码分类）；判不出 ⇒ **fail-closed 重跑**（硬规则 3b：判不出必须与不需要有不同取值）；不设阈值（硬规则 4）。
- **判据3（能取假）**：回放「纯 doc 却重跑」或「含代码却跳过」必须红——D2 真样本。
- **判据4（AC67 判据2 达成留档）**：第一条真实重试记录（五字段 + agentId + mergeTarget + error）作为 AC67 判据2 证据，已核 agentId=subagent。

**⚠️ 时点（manager ⑥）**：**AC67 正在飞、其 subagent 正在实现 fan-in 四件**——判据1/2 越早并入越好，晚了又是「已按旧判据交付」（与 AC6 那次同形）。

**⚠️ 派发排序（manager 2026-08-14 ① 逐字「AC75 一落地，排第一个派，优先于 AC74 与其余」，写进任务体防只存在于对话里）**：**AC75 ∩ AC67 = { orchestration/fast-mode-tick-core.md, plugin/scripts/fan-in-ff-merge.sh } ⇒ AC75 不能派直到 AC67 落地**（AC67 正因没有 AC75 才付昂贵重试 ~390s）。**AC67 一落地 ⇒ AC75 排第一个派，优先于 AC74 与其余**。理由：它降的是**所有后续任务**的重试代价（rebase→merge 使单次重试从 ~390s 降到多数秒级），不是单条任务收益。AC74 先行（已派，2026-08-14），AC75 在其后——AC74 落地后再核 AC75∩AC74 disjoint。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 SPEC §1/§1b/§1c（manager 已改 078fb93a）+ A6 无锁段第 1/2 步 + fan-in-ff-merge.sh 重试路径。
2. 判据1：A6 第 1 步 rebase→merge（C17 外层落盘 + inner 分支内改调用形态）。
3. 判据2：新增第 2 步 delta 断言面判定（复用 AC51 doc/代码分类）+ fail-closed。
4. 判据3：能取假——纯 doc 却重跑 / 含代码却跳过 必须红（D2）。
5. 判据4：AC67 第一条重试记录留档作判据2 证据。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：A6 无锁段第 1 步 rebase→merge（实现 + SPEC 一致）。
- [x] AC2 判据2：新增 delta 断言面判定（复用 AC51 分类）+ fail-closed（判不出=重跑，硬规则 3b）；不设阈值。
- [x] AC3 判据3 能取假：纯 doc 却重跑 / 含代码却跳过 回放必须红（D2 真样本）。
- [x] AC4 判据4：AC67 第一条重试记录（五字段 + agentId=subagent + 锁毫秒级）留档作判据2 证据。
- [x] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] 无锁段 rebase→merge + delta 断言面判定（fail-closed）+ 重试路径文案更新 + AC67 判据2 证据留档。

## Touches

- orchestration/fast-mode-tick-core.md（A6 无锁段第 1 步 rebase→merge + 第 2 步 delta 判定——C17 外层落盘）
- plugin/loop/fast-mode-tick-core.md（A6 双副本同改——AC73 判据4）
- plugin/scripts/fan-in-ff-merge.sh（重试路径文案：rebase→merge + delta 判定说明）
- plugin/scripts/fan-in-ff-executor-check.ts（AC75 判据扩展——rebase 检出 + delta 判定 fail-closed + 真样本回放；文件非新增，AC67 已建）
- plugin/test/fan-in-ff-executor-check.test.mjs（负控制 fixture）
- tasks/gap-ac75-fan-in-merge-not-rebase-delta-check.md（自身）

## Evidence

（inner 实现落地 2026-08-14；提交 SHA `4e2f3b68`（rebase 后 `23f025f9`），scoped 门绿 + ts-typecheck ADMITTED。）

**AC1 判据1（rebase→merge）**：`plugin/loop/fast-mode-tick-core.md` A6 无锁段第 1 步已是 `git merge $MERGE_TARGET`（AC67 带入「取代旧 rebase」）；
`fan-in-ff-merge.sh` 头注释（第 6-12 行）与重试路径文案改为「必须 merge 不得 rebase（人 07:0xZ 裁定, AC75）」。
`fan-in-ff-executor-check.ts` 判据5 `judgeA6MergeNotRebase` 检出 `git rebase <target>` 命令形 ⇒ RED。测试：
```
✔ AC75 judgeA6MergeNotRebase — a REAL rebase step ① ⇒ RED (must be merge)
✔ AC75 judgeA6MergeNotRebase — the LANDED plugin/loop A6 (git merge, AC67/AC75) ⇒ GREEN
✔ AC75 judgeCommandMergeNotRebase — a REAL rebase fan-in command ⇒ RED
```

**AC2 判据2（delta 断言面判定 fail-closed）**：A6 无锁段新增第 2 步「delta 断言面判定（AC75, 复用 AC51 doc/代码分类, 不设阈值）：
全落 doc/任务体/telemetry ⇒ 跳过全量 suite；触及代码/测试/脚本 ⇒ 重跑全量；判不出 ⇒ fail-closed 重跑全量（硬规则 3b）」。
判据6 `judgeA6DeltaStep`（step 缺失或非 fail-closed ⇒ RED）+ 判据7 `classifyDeltaRerun`/`judgeDeltaDecision`（`resolveDeltaCodeSurface` = AC51 断言面减 tasks/**）。测试：
```
✔ AC75 judgeA6DeltaStep — an A6 WITHOUT the delta step (pre-AC75) ⇒ RED
✔ AC75 judgeA6DeltaStep — an A6 WITH the delta step but NOT fail-closed ⇒ RED
✔ AC75 judgeA6DeltaStep — the LANDED plugin/loop A6 (delta step + fail-closed) ⇒ GREEN
```

**AC3 判据3（能取假，D2 真样本回放）**：真实 develop delta 回放实际输出——
纯 doc delta（`tasks/gap-ac72-cert-mechanism-retire.md,tasks/gap-ac73-catalog-rhythm-consumer-check.md`）回放「reran-full-suite」：
```
[delta-assertion-decision] ok=False evaluated=True reason=pure-doc-but-reran (delta-pure-doc/task/telemetry)
aggregate ok= False
```
含代码 delta（`plugin/loop/fast-mode-tick-core.md,plugin/scripts/fan-in-ff-executor-check.ts,plugin/test/fan-in-ff-executor-check.test.mjs,tasks/gap-ac67-*.md`）回放「skipped-full-suite」：
```
[delta-assertion-decision] ok=False evaluated=True reason=code-delta-but-skipped (delta-touches-code (plugin/scripts/fan-in-ff-executor-check.ts, plugin/test/fan-in-ff-executor-check.test.mjs))
aggregate ok= False
```
空 delta + skipped（fail-closed）：
```
[delta-assertion-decision] ok=False evaluated=True reason=cannot-judge-but-skipped (empty-delta (fail-closed: 判不出=重跑))
aggregate ok= False
```
`node --test --test-name-pattern="AC75" plugin/test/fan-in-ff-executor-check.test.mjs` → **21 pass / 0 fail**（含上面三条 RED 的纯函数 + 集成用例）。

**AC4 判据4（AC67 第一条重试记录留档）**：主检出 `.quay/fan-in-retries.jsonl` 首条（逐字）：
```
{"taskId":"gap-ac67-fan-in-executor-to-task-subagent","attempt":1,"developHead":"24bcad50ed779b0d194c0aff982da9f5eda114cb","ts":"2026-08-14T06:38:45Z","epoch":1786689525,"runId":"fm-gap-ac67-fan-in-executor-to-task-subagent-1786689502118-aab2d14d","agentId":"aab2d14d10a762ff4","mergeTarget":"develop","error":"hint: Diverging branches can't be fast-forwarded, you need to either:"}
```
五字段（taskId/attempt/developHead/ts/runId）+ agentId + mergeTarget + error 齐；锁事件 acquire/release 同秒同 pid：
```
{"event":"acquire","ts":"2026-08-14T06:38:45Z","epoch":1786689525,"taskId":"gap-ac67-…","pid":1063198,"runId":"fm-gap-ac67-…-aab2d14d","agentId":"aab2d14d10a762ff4"}
{"event":"release","ts":"2026-08-14T06:38:45Z","epoch":1786689525,"taskId":"gap-ac67-…","pid":1063198,"runId":"fm-gap-ac67-…-aab2d14d","agentId":"aab2d14d10a762ff4"}
```
`agentId aab2d14d10a762ff4` 对应 `bc1a438b-66f2-4760-8964-91c641166602/subagents/agent-aab2d14d10a762ff4.jsonl` = **subagent**（非主会话）。

**AC5 既有测试全绿 + scoped 门绿**：`bash scripts/test.sh --for-task gap-ac75-fan-in-merge-not-rebase-delta-check --allow-thin` →
```
ℹ tests 62  ℹ pass 62  ℹ fail 0   (exit 0)
scoped static checks: 13 PASS（test-framework-policy / test-isolation / tmp-leak / adr016 / dead-code /
concurrency-literal / landing-target / judgment-consumer / delivery-inventory / ac61-staleness …）
```
ts-typecheck 闸：
```
fan-in-ts-typecheck-gate: no new/moved .ts in the declared write surface — no typecheck gate needed
fan-in-ts-typecheck-gate: ADMITTED (exit 0)
```

**C17**：`orchestration/fast-mode-tick-core.md` A6（outer-exclusive）未直接编辑——给出同形修改建议，由 outer 落盘。
建议：将 A6 无锁段第 1 步确认 `git merge $MERGE_TARGET`（不得 rebase），并在 ② ts-typecheck 前插入第 2 步
「delta 断言面判定（AC75, 复用 AC51 doc/代码分类, 不设阈值）：merge 进来的 develop delta 全落 doc/任务体/telemetry 面
⇒ 跳过全量 suite（只跑 doc 检查）；触及代码/测试/脚本面 ⇒ 重跑全量；判不出 ⇒ fail-closed 重跑全量（硬规则 3b）」，
后续步骤顺延。
