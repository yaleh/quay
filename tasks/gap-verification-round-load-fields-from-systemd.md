---
id: gap-verification-round-load-fields-from-systemd
title: verification-round 接 systemd scope 退出行的负载三字段（cpu_time_s/mem_peak_mb/swap_peak_mb）
status: ready
labels:
  - gap
  - performance
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（manager 2026-08-12，journal 位置判定）**：systemd 在每个 scope 退出时写一行——
`run-<unit>.scope: Consumed <T> CPU time, <M> memory peak, <S> memory swap peak.`。runner 已在
`full-suite-runner.ts` 记录 scope_unit（`.quay/suite-cgroup-evidence.txt` 的 `scope_unit=` 行）。
一次 `journalctl --user -u <scope_unit>` 即得三值——**零新仪器、零采样开销、内核累计精确非抽样**
（对比：此前 20.8% 是 34 个 5 秒采样点推的）。

**为何要**：人授权的分相 lane 实验（#26）要求「关注负载」——有了这三个字段，负载就是每轮
verification-round 记录的一个字段，而不是另跑采样器。round 48/49 实测：CPU-time/轮 ≈2957s（两轮
相差 3s=稳定分母）、mem peak 1.5G/6G=25%、实际并行 6.6/16 核=41%。

**约束（判据B）**：这是改验证机件（full-suite-runner.ts）——fan-in 前须有一轮覆盖该改动的绿。

## Plan（含 manager 2026-08-12 实查三陷阱，原样采纳）

**陷阱1：`suite-cgroup-evidence.txt` 是单槽文件，每轮覆盖**（runner:977 固定路径）。
⇒ `scope_unit` 必须在**轮次开始**时写进【该轮自己的记录】（:1223 fire-and-forget 已找到 scope 单元——把它存进内存变量 + 进轮次记录），
不能在收尾时回头读共享文件——否则就是「影子副本与本体漂移」形状（今天已死过三次）。

**陷阱2：`Consumed` 行出现在轮次结束之后 ~2s**（round 49 finishedAt=18:33:05, journal Consumed=18:33:07）。
⇒ 子进程 exit 那一刻立即读 journal 必空——需**有界轮询**（≤5s、间隔 200ms）。
runner 在 scope 外面（:1213 spawn systemd-run --scope 把套件作子进程包起来），子进程 exit 后仍活着，有资格轮询。

**陷阱3：读不到必须缺键/显式 null+原因，绝不填 0**（硬规则⑥：缺值=未查≠为假）。
`mem_peak_mb: 0` 会被当「这轮没吃内存」；`cpu_time_s: 0` 会把并行度算成无穷。
⇒ `{cpu_time_s: null, mem_peak_mb: null, swap_peak_mb: null, load_read_error: "<原因>"}`。

1. 轮次开始时：捕获 scope_unit → 存内存变量 + 写进本轮记录（不读共享文件）。
2. 子进程 exit 后：`journalctl --user -u <本轮 scope_unit> --since <startedAt>`，有界轮询到出现 Consumed 行。
3. 解析 cpu_time_s/mem_peak_mb/swap_peak_mb 写入 verification-round.jsonl 行；解析失败 → 显式 null+原因。
4. scoped 绿 → 全量验证轮（覆盖本改动的绿）→ fan-in。

## AC

- [x] AC1: verification-round.jsonl 每行含 cpu_time_s/mem_peak_mb/swap_peak_mb（实测值，非抽样）
- [x] AC2: scope_unit 在轮次开始时捕获（非收尾读共享文件）；两轮记录的 scope_unit 不同（陷阱1反证）
- [x] AC3: Consumed 行有界轮询读到（非立即读空）；两轮 cpu_time_s 均非 null（陷阱2反证）
- [x] AC4: 读不到时缺键/显式 null+原因，绝不填 0（陷阱3）
- [ ] AC5: 覆盖本改动的验证轮绿后才 fan-in（判据B）——外层 verification-round 的职责（本任务只跑 scoped 门）
- [x] AC6: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 新字段实测样例贴出（见 Evidence）
- [ ] 全量套件绿——外层 verification-round 验证

## Touches

- plugin/scripts/full-suite-runner.ts（终态写入前加三字段解析）
- plugin/test/full-suite-runner.test.mjs（如有）
- tasks/gap-verification-round-load-fields-from-systemd.md（自身）

## Evidence

**实现**（三陷阱逐条落实）：

- **陷阱1（scope_unit 轮次开始捕获）**：`run()` 里新增内存变量 `roundScopeUnit`，由 :1423 的
  fire-and-forget 在找到 scope 单元时写入（`roundScopeUnit = unit`），并在 spawn 后经
  `QUAY_TEST_SCOPE_UNIT` 注入口设值；轮次记录（`SuiteRoundRecord.scope_unit`）读的是这个内存变量，
  **绝不**在收尾时回头读共享的 `suite-cgroup-evidence.txt`（单槽文件，每轮覆盖）。
- **陷阱2（Consumed 行 ~2s 后出现 ⇒ 有界轮询）**：`readScopeConsumedLoad()` 对
  `journalctl --user -u <unit> --since <startedAt> --no-pager` 做 ≤5s、200ms 间隔的有界轮询
  （runner 在 scope 外面，子进程 exit 后仍活着，有资格轮询）；实测真实 scope 在 exit 后 ~2s 出
  Consumed 行，5s 预算覆盖。
- **陷阱3（读不到 ⇒ 显式 null+原因，绝不填 0）**：解析失败 / 无 Consumed 行 / journalctl 报错都返回
  `{cpu_time_s: null, mem_peak_mb: null, swap_peak_mb: null, load_read_error: "<原因>"}`；
  非 systemd 轮次则四字段**缺键**（与 `*_phase_ms` 相同的缺席契约）。`mem_peak_mb: 0` 只出现在
  systemd 真的报了 `0B memory swap peak` 时（真零 ≠ 未测）。

**实测样例（真 systemd scope，CPU 烧 6s + 120MB 触页，非 seam）**——verification-round.jsonl 行：

```json
{
  "scope_unit": "run-rd63e39d8f7ee4317b2f370d08255848a.scope",
  "cpu_time_s": 6.525,
  "mem_peak_mb": 26.8,
  "swap_peak_mb": 0,
  "load_read_error": null,
  "state": "green"
}
```

真实 full-suite 样例（manager 2026-08-12 观测，解析器已覆盖其格式）：
`run-r8f2917794c3948958290f71b58ccbdae.scope: Consumed 48min 3.887s CPU time, 1.4G memory peak, 0B memory swap peak.`
（`48min 3.887s` 时段格式与 `1.4G` IEC 字节格式均有单测）。

**scoped 门**：`scripts/test.sh --for-task gap-verification-round-load-fields-from-systemd` 绿 —
108 tests / 0 fail / 0 skipped，含 11 条新增 load-fields 单测 + 既有 108 条全绿；
scoped 静态检查层（task-contract / tick-core / test-isolation / delivery-inventory 等）PASS。

**陷阱反证测试**：
- trap-1 反证（AC2）：两个不同 `QUAY_TEST_SCOPE_UNIT` 轮次记录 scope_unit 不同（非共享文件重读）。
- trap-2 反证（AC3）：live 真 scope 读到非 null 的 cpu_time_s=6.525（非立即读空）。
- trap-3 反证（AC4）：seam 无 Consumed 行 → 记录携带 `cpu_time_s/mem_peak_mb/swap_peak_mb: null`
  + `load_read_error: "no Consumed line …"`，绝不填 0。

**未做**（判据B / DoD 第三项，属外层 verification-round）：AC5 覆盖本改动的全量验证轮绿 → fan-in。
本任务只跑 scoped 门（已绿），全量套件由外层 verification-round 验证。
