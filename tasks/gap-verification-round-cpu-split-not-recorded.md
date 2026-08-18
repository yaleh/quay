---
id: gap-verification-round-cpu-split-not-recorded
title: "verification-round.jsonl 只记合并 cpu_time_s 无 user/sys 拆分——suite 优化无法区分「测试内容」vs「执行形态」成本"
status: todo
labels:
  - gap
  - finding
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`verification-round.jsonl` 只记录合并的 `cpu_time_s`（user+sys 之和），拆不出 user/sys。manager 从 SSOT 第 4 次 suite run 的 `/tmp/*.time` 读到：wall ≈1654s（27.6min，2.76x 超标）、user=4414s sys=6899s、**sys 占 61%**——而正常计算密集套件内核态通常 10–25%。sys=61% 意味着大头是系统调用（`--test-isolation=process` × ~448 文件的 fork/exec；fixture 的 mkdtemp/rmtree/git），不是测试逻辑本身。

**含义**：「把单个测试写快」的天花板只有 ~39%（user 部分）；真正的杠杆在**执行形态**（进程隔离粒度、fixture 复用/tmpfs、按文件分组批处理）。**没有 user/sys 拆分，suite 优化只能凭猜**——无法判断每次优化动到的是 39% 还是 61% 那部分。

**证据**：单次 run 的 CPU 拆分（sys=61%），非 fixture；manager 从 `/tmp/*.time` 反推。需多 run 采样确认是否稳定。

## Acceptance Criteria

- [ ] AC1: `verification-round.jsonl` 每条记录增加 `cpu_user_s` / `cpu_sys_s`（或等价拆分），由 suite 完成时写入（现有 `cpu_time_s` 保留）。
- [ ] AC2: 负控制——一次真实 suite run 后，记录含 user/sys 两字段且 user+sys≈cpu_time_s（可核对）。
- [ ] AC3: 拆分来源是真实 gnu-time / time 输出（非估算），与现有 `cpu_source` 字段一致。

## Definition of Done

- [ ] 一次真实 suite run 的记录含 user/sys 拆分，且与 `/tmp/*.time` 原始值一致。
