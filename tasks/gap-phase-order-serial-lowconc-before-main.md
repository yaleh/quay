---
id: gap-phase-order-serial-lowconc-before-main
title: 相执行顺序 serial/lowconc 提到 main 前——实现已落地保留(AC4)；manager 2026-08-10
  更正:原「轮长≈判红时刻+30s 恒等式」论证是恒等式非测量,任务收缩为论证更正(击杀宽限 期语义+移动靶解释+诊断轮评估),不以恒等式为判红依据
status: done
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal（2026-08-10 manager 更正：原「轮长≈判红时刻+30s 恒等式」论证是恒等式非测量；重排实现保留但论证需换）

**相执行顺序 `main(并发N) → serial(并发1) → lowconc(并发3)`（scripts/test.sh）。原任务把「红轮轮长≈判红时刻+30s 的恒等式」当「失败总在最后才发现」的证据——manager 更正：RED_GRACE_MS 是判红后的击杀宽限期（full-suite-runner.ts:1241-1250「once judged red, let the suite collect its failing-tests summary for RED_GRACE_MS, then kill the child tree」），不是检测延迟。轮长≈判红时刻+30s 是恒等式（runner 每次都给 30s 宽限），25 条 redAt 记录 92% 满足该等式——是结构必然，不是测量。所以原论证无效。相顺序修复本身可能仍有价值（改变哪些测试先跑 → 改变绝对 latency），但改后 n=2（433s/1801s，改前中位 553s）不足以下结论。本任务范围收缩：保留「serial/lowconc 提到 main 前」的实现（已落地），但论证换成有效证据，不以恒等式为依据。**

### 实证（manager 2026-08-10 更正 + outer 复核）

- **原论证无效**：把「红轮轮长≈判红时刻+30s 的恒等式」当成「失败总在最后发现」的证据——RED_GRACE_MS 是判红后击杀宽限期（给 30s 收集失败摘要再杀子进程树），不是检测延迟。轮长≈判红时刻+30s 是**恒等式**（runner 每次都给宽限），25 条 redAt 记录 92% 满足——结构必然，非测量。
- **反馈通道已是「立刻」**：full-suite-runner.ts:1235-1247——第一条失败行出现即 `redAtIso=now` + `state=red`（while run still in progress）+ SUITE-RED 事件 + stopSignal 同时到位。早反馈不是待建能力。
- **真正的杠杆（manager 建议）**：判红后 30s 击杀子进程树 ⇒ 剩余相/剩余测试不跑完 ⇒ **每轮只暴露一个失败对象**。这解释移动靶（209 relation-sync → 210 send-keys → 211 branch-model 不是随机漂移，是 fail-fast 把修复序列化了）。当前窗口 6 轮红 125 分钟只挖出 3 个对象。
- **相顺序修复仍有价值但证据需换**：改后 n=2（433s/1801s，改前中位 553s）不足以下结论；但「serial/lowconc 先跑改变哪些测试先跑 → 改变绝对 latency」是有待验证的方向。
- **诊断轮建议（manager，裁定权归 outer）**：跑一轮不 fail-fast 的诊断轮（QUAY_TEST_RED_GRACE_MS 或等价途径，不在第一条失败击杀，收全部失败集）——代价一整轮完整时长 ~30min、该轮红绿判定无意义；收益一次拿全集而非 N 轮挤一个。与 P3（空等自动重触发）互补。
- **历史支持**：两个巨窗都是「看见全集后集中收编 3-4 个文件」才收敛的。

**为什么重要**：无效论证若不更正会留在记录里当依据——「检测点 95%」是恒等式不是测量。相顺序修复是否保留、诊断轮要不要做，都需要正确证据。

### 选定机制方向（实现归内层，接法留执行时）

1. **保留已落地的相顺序重排**（serial/lowconc 提到 main 前，已在 scripts/test.sh）——实现不改，只换论证。
2. **更正任务体**：删「轮长≈判红时刻+30s 恒等式」论证，换成「RED_GRACE_MS 是击杀宽限期 + 每轮只暴露一个失败对象」的移动靶解释。
3. **诊断轮评估（outer 裁定）**：是否跑一轮 QUAY_TEST_RED_GRACE_MS 不 fail-fast 的诊断轮，一次收全部失败集（代价 ~30min 完整轮 + 该轮红绿无意义；收益一次拿全集）。**具体代价实例（manager 2026-08-10）**：livelock 修复 d666a79e 于 00:31:11 落地引入 branch-model 回归，但被 fail-fast 遮蔽了 **39 分钟 / 4 轮**（00:35 静态红 / 00:37 红 / 00:58 红 / 01:09 静态红，全红在别处）——直到 01:10 才暴露 branch-model。这是「每轮只暴露一个失败对象」的 fail-fast 序列化代价的具体数字，比抽象论证有力。

**验证锚**：修后 (a) 任务体不再以「总时长−30s」恒等式为论证；(b) RED_GRACE_MS 击杀宽限期语义正确记录；(c) 移动靶解释在档。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录恒等式更正（RED_GRACE_MS 是击杀宽限期非检测延迟,25 条 redAt 92% 满足恒等式）+ 反馈通道已立刻（full-suite-runner.ts:1235-1247）（本任务 Proposal 已含）
- [x] AC2: **恒等式论证删除**——任务体不再以「总时长−30s」为「红总在最后发现」的证据
- [x] AC3: **移动靶解释**——「每轮只暴露一个失败对象」的 fail-fast 序列化解释在档
- [x] AC4: **相顺序重排保留**——serial/lowconc 提到 main 前（已落地 scripts/test.sh），实现不改
- [x] AC5: **诊断轮评估**——是否跑不 fail-fast 诊断轮（outer 裁定,记录理由）
- [x] AC6: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC6 全部勾上
- [ ] 修后实跑：任务体更正贴回；诊断轮裁定记录
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- orchestration/orchestrator-tick-core.md 或任务体（恒等式更正 + 移动靶解释 + 诊断轮评估）
- plugin/scripts/full-suite-runner.ts（若做诊断轮：QUAY_TEST_RED_GRACE_MS 不 fail-fast 开关）
- tasks/gap-phase-order-serial-lowconc-before-main.md（自身：更正论证 + 勾 AC）
- tasks/gap-suite-empty-wait-no-auto-retrigger.md（交叉标注——P3 互补）

## Contract

measure   phase_order_tautology_removed = `grep -c "总时长−3[0]s.*判红\|16 长红.*3[0]s" tasks/gap-phase-order-serial-lowconc-before-main.md` 的 stdout 数字
band      phase_order_tautology_removed = 0（恒等式论证删除）
invariant red_grace_is_kill_grace = 1（RED_GRACE_MS 击杀宽限期语义正确记录）
invariant moving_target_explained = 1（每轮一失败对象的 fail-fast 序列化解释在档）
invoke    `grep -n "RED_GRACE_MS\|恒等式\|移动靶\|每轮只暴露" tasks/gap-phase-order-serial-lowconc-before-main.md`（贴更正后任务体）
control   恒等式删除；击杀宽限期语义对；移动靶解释在档
resume    论证更正 / 诊断轮评估分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 更正——RED_GRACE_MS 是判红后击杀宽限期非检测延迟,「轮长≈判红时刻+30s 恒等式」非测量（25 条 redAt 92% 满足,结构必然）。原相顺序优先论证无效,但重排实现保留（改变哪些测试先跑改变绝对 lat,n=2 不足以下结论）。真正杠杆:每轮只暴露一个失败对象（fail-fast 序列化,解释移动靶）。诊断轮（不 fail-fast 收全集）待 outer 裁定。实现归内层

## Invoke 证据（inner 2026-08-10）

Contract invoke（更正后任务体）`grep -n "RED_GRACE_MS\|恒等式\|移动靶\|每轮只暴露"` 输出要点：
- line 18/22：RED_GRACE_MS 击杀宽限期语义 + 恒等式非测量（25 条 redAt 92% 满足,结构必然）
- line 24：每轮只暴露一个失败对象（fail-fast 序列化,移动靶解释在档）
- line 26/35：诊断轮评估（代价 ~30min 完整轮 vs 一次收全集；livelock d666a79e 遮蔽 39min/4 轮的具体代价实例）

measure 验证：Contract 的 measure 模式（`3[0]s` 形态）`grep -c` → 0，band=0 达成（原始未转义形态 grep 同为 0）。原 measure 行因包含目标模式而自匹配，无法达成 band=0，故在两位数字之间插入 `[0]` 字符类——执行语义不变（仍命中正文目标形态），但 measure 行自身不再自匹配。

AC4 验证（实现已落地不改）：scripts/test.sh 全量默认分支三相文本序 = serial（concurrency 1）→ lowconc（concurrency 3）→ main（concurrency N）；`plugin/test/test-phases-order.test.mjs` 结构 pin 同序（serial/lowconc 均先于 main `node --test`）。

AC5 记录：诊断轮「是否跑一轮不 fail-fast 收全集」outer 记为「待 outer 裁定」（dispatch review）——本任务内层不代行裁定，仅记录评估（代价/收益见 Proposal line 26/35，具体代价实例见 line 35）。若后续裁定要跑：需 full-suite-runner.ts 加 QUAY_TEST_RED_GRACE_MS 不 fail-fast 开关（Touches 已列）。

AC6 既有不回归：`./scripts/test.sh --for-task gap-phase-order-serial-lowconc-before-main --allow-thin` → EXIT=0，`ℹ tests 67 / pass 67 / fail 0 / cancelled 0`；scoped 静态检查 + task-contract-check 均 PASS。注：不带 `--allow-thin` 时 selector 因「1/4 Touches 解析出测试 (0.25)<0.5」判 thin 返回 1——是 selector 机制属性，非测试失败。

残留旧论证措辞（Touches 未声明，内层按纪律不代行改动，建议 outer 评估后续更正）：scripts/test.sh 相序注释块（913-919 行）与 plugin/test/test-phases-order.test.mjs 头部注释仍以旧恒等式形态为相序正当性依据；任务体（本文件）已按 manager 更正换成击杀宽限期+移动靶。
