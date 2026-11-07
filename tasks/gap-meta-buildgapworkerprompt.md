---
id: gap-meta-buildgapworkerprompt
title: goal-driver 的 gap-filing prompt 用未限定名的 skill，filing agent 的 Skill 调用必然失败
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
`buildGapWorkerPrompt`（同族还有 line 2944 的信号 agent prompt）逐字写「via the `quay-file-task` skill (Skill tool)」，而注册名是 `quay:quay-file-task`；纯行为测试实测该 prompt 里 bare=2 / namespaced=0 ⇒ 照读的 filing agent 会得到 `Unknown skill: quay-file-task`。corpus 读数 `actionRecordFailures` 该签名 9 个不同会话命中（阈值 2，crossed）——与同文件同一条 prompt 上已修过的 `goal_get` 全限定名（gap-goal-get-meta-get-mcp-name-collision，done）是硬规则 5b 的兄弟实例：修了一个，同行另一个没修。后果是 GOAL-914 的立案回路静默丢执行者（driver 侧只看到「agent 没落盘」）。

本轮读数（actionRecordFailures.state）= `"crossed"`，采于 2026-11-07T02:14:34Z，由 meta-driver 机械采集。
⚠️ 机制词 `buildGapWorkerPrompt` 命中【已完成】任务：gap-done-unresolved-conflates-workable-with-world-gated.md[done]、gap-frozen-achieved-ac-no-owner-after-ledger-tail-mutation.md[done]、gap-frozen-violated-files-on-stale-verdict.md[done]、gap-goal-get-meta-get-mcp-name-collision.md[done]、gap-meta-computegoalgaps.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

查证结果：那些 done 任务修的是**同一条 prompt 上的另一个名字**（`goal_get`）或**另一个命题**（gap 计算），没有任何一个改过 `quay-file-task` 这个 skill 名；故本任务是修复既有 prompt 构造器，不是新建并行机制（DoD 第 2 条）。

## Evidence
- 修复后判据：`{"bare":0,"ns":2}`（exit 0）。
- 负控制（把实现临时改回裸名）：`{"bare":2,"ns":0}`（exit 1）⇒ 判据能取假，不是回声。
- 同载体 grep（硬规则 5b）：`grep -n "quay-file-task" plugin/scripts/goal-driver.ts plugin/scripts/quality-gate-driver.ts` ⇒ 剩余命中全部在**注释**里（行首 18/30/2807/3039/3049/3638/3857 与 qgd 19/21/524/574/1021/1511/3259），已无任何 prompt 字符串（agent 实际读到的文本）携带裸名；prompt 字符串内 9 处全部改为 `quay:quay-file-task`（goal-driver 4 + quality-gate-driver 5）。
- 测试：`node --test plugin/test/goal-driver-s01.test.mjs` 30/30 pass；`node --test plugin/test/quality-gate-driver.test.mjs` 118/118 pass（两处既有断言已加强为「必须含命名空间名 ∧ 裸名计数=0」）。

## Acceptance Criteria
- [x] `node --experimental-strip-types --input-type=module -e "import { buildGapWorkerPrompt } from './plugin/scripts/goal-driver.ts'; const p = buildGapWorkerPrompt({goal:'GOAL-914',ac:'AC-930',state:'gap'},'t','a','e','/tmp'); const bare=(p.match(/(?<!quay:)quay-file-task/g)||[]).length; const ns=(p.match(/quay:quay-file-task/g)||[]).length; if(bare!==0||ns<1){console.error(JSON.stringify({bare,ns}));process.exit(1)} console.log(JSON.stringify({bare,ns}))"` ⇒ buildGapWorkerPrompt 的返回串里不再出现任何未限定名的 `quay-file-task`，且至少出现一次 `quay:quay-file-task` —— filing agent 的 Skill 调用能解析到已注册技能。

## Definition of Done
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制
- 该轴仍暗,理由:本任务只改两处 driver 的 prompt 字符串与两条测试断言，不新增/移动模块、不改 import 图或包边界，无可归因于本次改动的 L_D/L_G 读数。

## Touches
- `plugin/scripts/goal-driver.ts`
- `plugin/scripts/quality-gate-driver.ts`
- `plugin/test/goal-driver-s01.test.mjs`
- `plugin/test/quality-gate-driver.test.mjs`
- `tasks/gap-meta-buildgapworkerprompt.md`
