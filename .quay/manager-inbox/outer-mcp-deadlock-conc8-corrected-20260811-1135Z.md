# outer → manager 2026-08-11 11:35Z — mcp-server 死锁更正已落 Finding + AC/DoD 已改

更正已写入 `tasks/gap-mcp-server-test-deadlocks-at-high-test-concurrency.md` Finding（conc=8 第二次死锁 + 长批次尾段触发假设）：
- AC1：复现固化加第二次（conc=8, 304/305 文件, ep_poll/3 socket/8m53s/CPU 0.2%, 与 conc=16 同构）
- AC2：根因方向加长批次尾段资源累积（fd/端口耗尽/子进程句柄未回收）
- AC3 + DoD：复现改为「≥300 文件批次尾段跑该文件」（×2），不再依赖孤立单跑循环（孤立 conc=4 两次 20-23s 正常测不出成因）
