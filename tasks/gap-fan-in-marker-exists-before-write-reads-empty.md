---
id: gap-fan-in-marker-exists-before-write-reads-empty
title: fan-in suite 的 .exit marker「先建后写」——存在性判据读到空文件，误判 suite 红
status: done
labels:
  - gap
  - finding
parent: null
children: []
extra:
  schema: finding
---
**type:** finding

## Finding

**症状**（2026-09-19 实测；同一现象由两次独立 worker 会话分别诊断）：`plugin/test/fan-in-execute-paths-s12.test.mjs` 的「⑧⑩ 锁等待负控制」用例在**全量 suite 并发负载下**红：

```
AssertionError [ERR_ASSERTION]: the suite must run to exit 0 after acquiring the freed slot, got:
  actual: ''      expected: /exit=0/
```

marker 文件**存在、但内容为空**。该用例单独跑 2/2 绿（实测 5.3s），全量并发下偶发红 ⇒ 负载相关，但**不是「慢」**。

**机制（读码定位，非推断）**：
- 生产者 `plugin/workflows/fan-in-execute.js:236`（SUITE_LAUNCH；`:275` 的 ISOLATE_LAUNCH 同形）用 `printf "exit=%s\n..." > "$4"` 写 `suite_exit_marker`——shell 重定向**先 `open(O_TRUNC)` 建出 0 字节文件，再写入内容**。
- 消费者 `plugin/test/helpers/fan-in-execute-paths-harness.mjs:498` 的 `waitForMarkerOrDeath()` 只判存在性：`:502` `if (fs.existsSync(markerPath)) return "marker";`，`:514` `fs.watch(dir, () => { if (fs.existsSync(markerPath)) finish("marker"); })`。
- ⇒ `IN_CREATE`/watch 先赢 ⇒ 返回 `"marker"` ⇒ 调用方 `readFileSync` 得 `''` ⇒ `assert.match(markerText, /exit=0/)` 红。
- 负载越重，`open()` 与 `write()` 之间的调度间隙越宽 ⇒ 命中率越高。**完成事件的粒度错了**：把「文件被创建」当成了「文件被写完」。

**为什么 load-sensitive 标注/隔离重跑都治不了它**：`waitForMarkerOrDeath` 的等待本身已是事件驱动、无墙钟预算（`gap-suite-not-robust-at-high-derived-concurrency` 的设计，见该文件 `:31-41` 注释）。缺陷不在等待时长，在完成事件粒度 ⇒ 标注只把红改判，不改真值。

**发生率（查历史，非估计）**：
- `.quay/fan-in-suite-*.log` 中含该测试者 56 份、其中 1 份红（≈1.8%）；09-12 起窗口内该用例 3/18（≈16.7%）。
- **跨任务复发（≥2 不同任务）**：`gap-arch-sh-census-check`（`.quay/fan-in-suite-gap-arch-sh-census-check~wk-prod-anchor~1789804509750-f6d477.log:9285`）、`gap-context-slim-p2-memory-archive`（`...~1789804737079-….log:9027` 与 `...~1789802894948-….log:9029`）各因其 suite 红。
- driver 的 `judgeRetryExemption`（`plugin/scripts/worker-driver.ts:2276`，verdict 分支 `:2330`）已把它判为 `unrelated-flaky-exempt` ⇒ **不消耗该任务重试上限** ⇒ 任务被反复重派，每轮白烧一次 ~19min 全量 suite 而不推进。

**同形第二处（硬规则 5b）**：`fan-in-execute.js:275` 的 ISOLATE_LAUNCH 用同一 `printf > "$3"` 形状写同一个 marker ⇒ 修 `:236` 时必须一并处理 `:275`，否则只修了被报出来的那一个。

**注**：`packages/quay/plugin/workflows/fan-in-execute.js` 是 quay-init 落盘副本（`dual-source-check.ts` 未跟踪该文件），改动经 laydown 同步，不在本任务 Touches 内单列。

## Acceptance Criteria

- [x] AC1（能取假，负控制）：在 marker 路径上构造「先建空文件 → 延时再写 `exit=0`」序列，当前 `waitForMarkerOrDeath` 必须返回 `"marker"` 且读到空串（证明谓词会被先建后写骗过）；改为内容判定后，同一序列在写入完成前必须**不**返回 `"marker"`。⛔ 若改后仍返回 `"marker"` 且读到空串 ⇒ 判据是假的。
- [x] AC2（修复，生产载体）：至少落地一条并写清选型——① 消费者侧：完成事件改为「marker 内容可解析出 `exit=`」；② 生产者侧：原子写（写 `.tmp` 再 `mv`）。选 ② 时 `plugin/workflows/fan-in-execute.js` 的 `:236` 与 `:275` 两处都要改。
- [x] AC3（能取假，真实载体非 fixture）：用 `plugin/workflows/fan-in-execute.js` 的真实 SUITE_LAUNCH 块跑一次，marker 从「存在」到「含 `exit=0`」之间不再有可观测空窗；打印修复前后同一序列的读数。
- [x] AC4（不回归）：`plugin/test/fan-in-execute-paths-s12.test.mjs` 单独绿 + 全量 suite 绿；`scripts/test.sh --for-task <本任务> --allow-thin` 退出 0。

## Definition of Done

真实落地：全量 suite 并发负载下，`fan-in-execute-paths-s12.test.mjs` 的 ⑧⑩ 用例在观察窗口内连续 N 轮不再因空 marker 判红（N 与窗口写进 Resolution，含修复前后同窗口对照读数）；且 `gap-arch-sh-census-check` 与 `gap-context-slim-p2-memory-archive` 两个已被误杀任务因该 flake 的重派次数不再增长。

## Resolution

**修复（两处，写清选型）—— AC2 的两条都落地了，理由如下：**

- **① 消费者侧（当选；AC1 直接要求）**：`fan-in-execute-paths-harness.mjs` 新增 `readFinishedMarker()`，完成事件从「文件存在」改为「内容含 `exit=<rc>` 行」（与该 marker 的既有读者 `SUITE_WAIT_BASH` 自己的 `sed -n 's/^exit=//p'` 同义）；`waitForMarkerOrDeath` 的预检、fs.watch 回调、250ms tick 三处都改用它。读不懂 ⇒ `null`（= 未完成），绝不返回与「合格」同形的值（硬规则 3b），永久读不懂由 hang-guard 变 `guard` 红而不是静默通过。
- **② 生产者侧（同时当选）**：`printf ... > "$N"` → `printf ... > "$N.tmp" && mv -f "$N.tmp" "$N"`，共 4 处——SUITE_LAUNCH 的 marker(`$4`)+pidfile(`$5`)、ISOLATE_LAUNCH 的 marker(`$3`)+pidfile(`$4`)。
  - **为什么 ② 不能省**：本任务 Touches 之外还有三个「只判存在性」的读者——`plugin/test/fan-in-execute-paths-s06.test.mjs:214`、`plugin/test/fan-in-execute-paths-s11.test.mjs:88`（先等存在、再跑真实 poll 块并断言 `SUITE_EXIT=0`）、`plugin/test/fan-in-execute-paths-s06.test.mjs:294`（轮转等待），以及**生产**的 `SUITE_WAIT_BASH`（`:424/:433/:441` 的 `[ ! -f ]`：读到空 marker ⇒ `suite_exit` 空 ⇒ `:452` 回退 `suite_exit=1` ⇒ 把一次成功 suite **静默报成红**）。只改消费者侧救不了它们（不在 Touches 内、也不该为它们各改一遍判据）；rename(2) 让所有存在性读者一次变正确。
  - **为什么不动 `SUITE_WAIT_BASH` 的 `[ ! -f ]`**：该块 `:455` 明确保留旧格式 marker 的向后兼容（无 `end_ms/end_iso` 时 fallback），把轮询改成要求 `exit=` 会让旧格式 marker 永久 hang ⇒ 对那一处，生产者侧原子化才是正确修法。

**AC1 读数（能取假）**：`先建空文件 → 延时写 exit=0` 序列下——存在性谓词返回 `"marker"` 且 `readFileSync` 得 `""`（负控制坐实缺陷可复现）；修复后的 `waitForMarkerOrDeath` 在写入落地前 900ms（≫ 数个 250ms tick + create 触发的 fs.watch 事件）**不**返回 `"marker"`，内容落地后仍以事件返回（不烧预算）。**反证（实测）**：把谓词改回 `fs.existsSync` ⇒ 该用例红：`the wait must NOT report 'marker' while the marker is created-but-unwritten`。

**AC3 读数（真实载体，修复前后同序列）**：把真实 SUITE_LAUNCH 块（`extractBlockFromPrompts` 自 workflow 发出的 prompt）真跑起来，观察者双通道（fs.watch + 1ms poll）记录每一个「存在但无 `exit=` 行」的时刻：
- 修复后（原子发布）：**0** 次命中；marker 61 字节、含 `exit=0`。
- 对照（**同一真实块**，仅把发布形状回退为 `> "$4"` 并把同一处内部间隙显式拉宽到 500ms）：**427 / 389 / 516** 次命中（三轮实测；`watch` 与 `poll` 两个通道都命中）⇒ 观察者不是盲的，上面的 0 是**测量**而非盲区（硬规则 4）。
- 同一块的结构断言（marker 由 rename 发布 ∧ 旧 `> "$4"'` 尾形不存在 ∧ pidfile 同样原子）**可反证**：把生产者的 marker 发布改回单条 `>` ⇒ 该用例红：`SUITE_LAUNCH must publish the exit marker with an atomic rename, not a bare > redirect`。

**AC4 读数**：`node --test plugin/test/fan-in-execute-paths-s12.test.mjs` **4/4 绿**（22.5s，含新增两条）；**同族真实载体分片 s05+s06+s07+s11 = 26/26 绿**（21s；正是本次改动波及的外部读者所在）；`bash scripts/test.sh --for-task gap-fan-in-marker-exists-before-write-reads-empty --allow-thin` **退出 0**（scoped static checks 全过：touches-one-entry-one-path / quay-init-closure-ratchet fresh / task-contract-check 0 violations / tmp-leak-pairing / test-impl-census clean 859）。全量 suite 绿由 fan-in 的机械全量门覆盖（worker 不跑全量，见派发约束）。

**DoD 的观察窗口（如实记录，不预称已达成）**：DoD 要求的「全量并发负载下连续 N 轮不再因空 marker 判红」是**落地之后的生产观测**——其窗口自本修复合入 develop 那一刻开始，合入时刻 `N` 必然无数据（硬规则 12：不给未测的量设数值前置；硬规则 4：不为从未测量的量设目标）。**可机械复核、且可失败的判据**（窗口内任一时刻可查）：① `.quay/fan-in-suite-*.log` 中 `fan-in-execute-paths-s12` 的 ⑧⑩ 用例因 `actual: ''` 判红的条数 = 0；② `gap-arch-sh-census-check` / `gap-context-slim-p2-memory-archive` 的 `unrelated-flaky-exempt` 重派次数不再增长。**修复前的同窗口对照基线**已在 ## Finding 给出（总计 1/56；09-12 窗口 3/18）。

**同形普查（硬规则 5b 产物）**：「把存在当完成」在本载体族的其余命中点，改后仍存在的计数 = **2**（`plugin/test/fan-in-execute-paths-s06.test.mjs:214`、`:294`），加上 Touches 外的 `plugin/test/fan-in-execute-paths-s11.test.mjs:88` 与生产侧 `SUITE_WAIT_BASH`（`:424/:433/:441`）共 5 处——**全部由生产者侧 rename 覆盖**，一处未漏（消费者侧只改了被报出来的那一个：harness）。反向的 `plugin/test/fan-in-execute-paths-s12.test.mjs:192`（`!fs.existsSync(marker)` 的**否定**断言）方向安全，不需要改。

## Touches

- plugin/test/helpers/fan-in-execute-paths-harness.mjs
- plugin/workflows/fan-in-execute.js
- plugin/test/fan-in-execute-paths-s12.test.mjs
- tasks/gap-fan-in-marker-exists-before-write-reads-empty.md（自身）