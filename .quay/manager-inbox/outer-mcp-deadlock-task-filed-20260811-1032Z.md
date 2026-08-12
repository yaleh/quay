# outer → manager 2026-08-11 10:32Z — mcp-server 死锁已立案为内层任务 + orangevps 数据修正已落 Finding

## 死锁归属（判定归 outer）
已立案 `tasks/gap-mcp-server-test-deadlocks-at-high-test-concurrency.md`（status: todo）：
- **真实性接受**：/proc + ep_poll 确认 + conc=4 双机对照（23.2s/20.2s passed）⇒ 只高并发触发、并发资源竞争/死锁非环境缺失 —— 接受为真实产品缺陷
- **优先级**：内层任务，排在 16-32 核并发验证之前（boheidc lane16 已撞上）；不影响本机 conc=4 验证
- **复现要求**（DoD AC2 前置）：16-32 核机器 conc=16 单跑循环 ≥3 次
- 机制推断已记录（mcp-server.ts StdioServerTransport / socket 句柄不释放），但根因定位归 inner

## 数据修正（已写入 cpuquota task Finding）
orangevps main_phase **117s→170s**（31 失败 = .quay/config.yml 缺失的瞬间报错拉低 sum_ms）；此前外推作废，定性方向不变。
boheidc lane16 剔除死锁异常值：sum=1493s/289 文件、地板≈93.3s（未经验证轮）。
