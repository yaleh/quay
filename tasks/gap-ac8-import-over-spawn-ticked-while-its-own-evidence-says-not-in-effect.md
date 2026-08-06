---
id: gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect
title: "AC8 of gap-eighty-one-instruments (task status:done, all 11 ACs [x]) is ticked while its
  OWN cited evidence ends with the sentence '41:4 说明政策存在、未生效' — the evidence text
  literally states the policy is NOT in effect, and the AC was ticked anyway; what got ticked was
  'I counted the numbers', not 'I made it happen'; verified 3 days later (2026-08-06): the sibling
  AC2 (script count must fall) DID land — 207 -> 142 measured — but the import-over-spawn ratio
  did NOT move at all: .sh tests 30/30 spawn (100%), .ts tests 35/40 spawn (88%), pure-import
  zero-side-effect tests still 3 (spec recorded 3, outer's recount said 4, today measures 3);
  SPEC-instruments-behind-one-entry.md's AC9 states the causal order — '集成是「import 取代
  spawn」的前提，不是它的附带好处 ⇒ AC7 依赖 AC8 与第二步，不是独立项' — so the unmoved ratio
  means the integration step it depends on never happened either; manager 2026-08-06, found by
  searching session history for 集成 per human direction"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**一条 AC 的证据文本自己写着「未生效」，然后它被勾成了完成。**

### 实测（可复算）

`tasks/gap-eighty-one-instruments-behind-remembered-paths-and-no-entry-point.md`
状态 `done`，**11 条 AC 全勾**。其中 AC8 的证据原文，**最后一句是**：

> **「41:4 说明政策存在、未生效。」**

⇒ **被勾选的是"我核了数"这个动作，不是"我做到了"这个结果。**

### 三天后的对照（2026-08-06 实测，规格记于 2026-08-04）

| 判据 | 规格/AC 当时记录 | 今天实测 | 结论 |
|---|---|---|---|
| 脚本总数（AC2 的收口判据） | 205→207（记为**失败信号**） | `plugin/scripts` **142** | ✅ **AC2 真做到了** |
| `plugin/test` 里 spawn 的文件数 | 41/47 | `.sh` 测试 **30/30**（100%）<br>`.ts` 测试 **35/40**（88%） | ❌ 未下降 |
| **纯 import、零副作用的测试** | 3（规格）/ 4（外层复核口径） | **3** | ❌ **三天，一个没增加** |

**AC2 与 AC8 的对照是关键**：同一条任务里，**一条 AC 真落地了（脚本 207→142），
另一条只核了数**。所以这不是"整条任务是假的"，是**单条 AC 的勾选标准不一致**——
更难发现，因为任务整体确实产生了真实成果。

### 为什么这条比"没做"更严重

`SPEC-instruments-behind-one-entry.md` 的 **AC9 把因果写死了**：

> **「集成是『import 取代 spawn』的前提，不是它的附带好处。」**
> ⇒ **AC7（测试从 spawn 改 import）依赖 AC8 与第二步，不是独立项。**

⇒ **import 比例三天不动，反过来说明它依赖的那个「集成」步骤也没真正发生。**
一条被勾掉的 AC，把"依赖项未完成"这个事实一起掩埋了——
**后来者看到 `done` + 全勾，不会知道这条链断在哪。**

### 与今晚同族缺陷的关系（本条是第四种形态）

| 形态 | 实例 |
|---|---|
| ① AC 跨度小于问题跨度 | 跨机同步任务及其前身（×2） |
| ② AC 勾在后来被回退的机制上 | `gap-concurrency-derivation-reverted-...` |
| ③ 任务标 done 但交付物没落地 | （今晚一度误判 archguard TASK-60，已撤回；形态本身成立） |
| **④ AC 的证据文本自承未生效，仍被勾** | **本条** |

### 选定机制（方向，接法留执行时）

**不预设"把 AC8 撤勾"**——撤勾只是记账，不解决问题。两条都要：

1. **把断掉的链接上**：按 AC9 的因果，先做「集成」（`quay-dev <instrument>` 派发入口，
   规格 AC8/AC10 的形态），再让测试从 spawn 转 import。判据是**比例下降**，不是"核过数"。
2. **防复发的机械形态**：一条 AC 的证据文本里若出现"未生效/未达成/仍然/尚未"这类**自承未完成**
   的措辞，而该 AC 被勾为 `[x]`——**应当可被机械检出**。这与 `task-contract-check.ts` 的
   `invoke-evidence-missing` 是同一族（证据与勾选状态不一致），可考虑并入。

## Contract

```
measure pure_import_tests = `for f in plugin/scripts/*.ts; do b=$(basename "$f" .ts); t="plugin/test/$b.test.mjs"; [ -f "$t" ] || continue; grep -qE "^import .*from .*scripts/" "$t" && ! grep -qE "spawnSync|execSync" "$t" && echo "$t"; done | wc -l` stdout 的数字段（当前基线 3）
measure spawn_ratio_ts = `for f in plugin/scripts/*.ts; do b=$(basename "$f" .ts); t="plugin/test/$b.test.mjs"; [ -f "$t" ] || continue; grep -qE "spawnSync|execFileSync|execSync" "$t" && echo x; done | wc -l` stdout 的数字段（当前基线 35，分母 40）
band pure_import_tests = 大于 3（必须真实上升，不接受"核过数"作为达成）
invariant 一条 AC 的证据文本自承未生效时，该 AC 不得被勾为完成；证据描述的是现状，不是成果
invoke `bash -c 'for f in plugin/scripts/*.ts; do b=$(basename "$f" .ts); t="plugin/test/$b.test.mjs"; [ -f "$t" ] || continue; grep -qE "^import .*from .*scripts/" "$t" && ! grep -qE "spawnSync|execSync" "$t" && echo "$t"; done | wc -l'`
control 把一个当前 spawn 型测试改成 import 型 ⇒ pure_import_tests 必须 +1；若不变，说明 measure 的判定口径错了，需先修 measure
resume 若中断，先跑 measure 读当前 import/spawn 比例，不要相信任何已勾的 AC
```

## Acceptance Criteria

- [ ] AC1: **比例真实下降**——`pure_import_tests` 从 3 上升，`spawn_ratio_ts` 从 35/40 下降，
      贴出改前/改后实测；**不接受"核过数"作为达成**
- [ ] AC2: **先集成再转测试**（遵循 SPEC 的 AC9 因果）——任务体记录集成入口的形态与落地证据；
      若跳过集成直接改测试，需说明为什么 AC9 的因果在此不适用
- [ ] AC3: **负控制（承重条）**——按 `control` 把一个 spawn 型测试转成 import 型，
      `pure_import_tests` 必须 +1；若不变则 measure 口径错，须先修 measure 再谈达成
- [ ] AC4: **保住端到端覆盖**（复用原任务 AC9 的负控制）——转 import 不得抹掉该工具唯一的
      CLI 契约检查；每一个仍然 spawn 的都要能说出它在验哪条契约
- [ ] AC5: **防复发**——给出一条机械检查（或并入 `task-contract-check.ts`）：
      AC 证据文本含自承未完成措辞（未生效/未达成/尚未/仍然）而该 AC 被勾 `[x]` ⇒ 报出。
      **负控制**：构造一条这样的 AC ⇒ 检查必须报红
- [ ] AC6: 与 `gap-eighty-one-instruments-behind-remembered-paths-and-no-entry-point`（done）
      交叉标注——说明该任务的 AC2 真落地（脚本 207→142）而 AC8 只核数，
      **不得把整条任务说成假的**；这是单条 AC 的勾选标准问题

## Definition of Done

- [ ] AC1-AC6 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [ ] 任务体记录：本条是"AC 证据自承未生效仍被勾"这一形态的首个实例

## Touches
- plugin/test/（转 import 的测试文件，具体范围由 AC2 的集成方案决定）
- plugin/scripts/task-contract-check.ts（AC5 的机械检查）
- tasks/gap-eighty-one-instruments-behind-remembered-paths-and-no-entry-point.md（交叉标注）
- orchestration/SPEC-instruments-behind-one-entry.md（AC9 因果的落地记录）

## Dispatch review

reviewer: none
at: 2026-08-06T17:2xZ
changed: 尚未派发/审阅（人指示用"集成"搜索历史会话后，管理者发现既有规格与任务，并测出 AC8 的勾选与其自身证据矛盾）
