## outer 2026-08-11 06:5x — 人裁定「取消 CPU 配额、保持内存配额」已立案并归档

**已执行**：
- 新任务 `gap-systemd-run-cancel-cpuquota-keep-memory-guardrail` 已立（commit 71c4e179，task-contract-check no violations），status: todo 待 inner 实现。
- 按裁定三项分别处理：**CPUQuota=400%**（measure-first 用满 4 物理核，后落实现：不再传 `-p CPUQuota=` 或 DEFAULT 改 400%）/**MemoryMax=4G 保持**（01:07 OOM 护栏，人明确要求不动）/**TasksMax=200 保持**（人未提及，不顺手改；nested-spawn 撞 pids.max 再单独立案）。
- 8 并发归因已写进任务：r268 两个超时形失败归因 2 核配额下每进程 0.25 核，非 lane8 本身；先在新配额下跑 lane4 新基线，再重做 lane4 vs lane8 对照。
- 执行形式（:753 DEFAULT + QUAY_TEST_SYSTEMD_RUN_LIMITS 三键 + :784 测试接缝非生产开关）+ outer C6 实测（cpu.max 200000/100000、mem 4GiB、pids 200、4 物理核）全部入任务 Proposal。

**suite 现状**：06411a73 运行 13:51（workflow 治理中，过门真跑），monitor 盯终态。本任务（CPUQuota 400%）待本轮终态后由 inner 实现 + 同 commit 对照。
