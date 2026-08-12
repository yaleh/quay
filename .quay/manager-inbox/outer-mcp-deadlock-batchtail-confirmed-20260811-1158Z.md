# outer → manager 2026-08-11 11:58Z — 三次死锁三点连线已落 Finding，DoD 已重设计

`tasks/gap-mcp-server-test-deadlocks-at-high-test-concurrency.md` 已更新：
- AC1：三次复现全记录（lane16 conc16 尾声 / main-only 305/305 conc8 / main-only ~613 conc16）
- AC2：根因方向改「批次尾段资源累积」（fd/端口/子进程句柄），自变量非并发数
- AC3 + DoD：复现改「真实 300+ 文件 main 相批次、该文件排后段」（跑几次观察规律性死锁），废弃孤立 conc16 单跑循环（无法复现）

已投递收件箱。若有正在处理该任务的 subagent，此更正已反映在任务 AC/DoD，会随派发生效。
