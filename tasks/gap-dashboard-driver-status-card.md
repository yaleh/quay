---
id: gap-dashboard-driver-status-card
title: Dashboard「MANAGER / OUTER / INNER」卡读的是已退役探针（loop-driver-check/liveness
  恒空）——改读真实的 promotion/worker driver 存活状态
status: todo
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现状（`packages/quay/src/serve-dashboard.ts:526-534` `renderMgrCard`）**：Dashboard 的
「MANAGER / OUTER / INNER」卡读的是 `readManagerLight()`（`observation.ts:2957`）的
`mgr.loopDriver`（`loop-driver-check.sh` 探针，探测的是已退役的经典单进程 outer/inner tmux 循环）和
`mgr.liveness`——而 `liveness` 字段在 `readManagerLight` 里是硬编码常量：
`{status:"empty", reason:"liveness observer retired 2026-09-03", sessions:[]}`。这不是数据没接上，
是这套被探测的机制本身已经死了（CLAUDE.md：「outer 作为独立会话角色亦已退役(2026-09-04)」）。
生产页面上「loop-driver: 未接入 · 会话数未接入」是这条死链路的直接结果——用 MCP 浏览器实测确认
（2026-09-08 截图 + 源码对读，非目测）。

**现在实际驱动本仓库的是两层 driver（promotion-driver + worker-driver）**，其活状态已经有现成、
零 subprocess 开销的读法：`plugin/scripts/driver-runtime.ts` 导出的 `aliveness(root, kind)`
（`:971`，读 pid 文件 + `pidAlive()`）与 `carrierStats(root, kind)`（`:312`，读 carrier jsonl 的
记录数/末条时间戳）——这两者的组合就是 `statusForKind`（`:999`，`quay driver status --kind <kind>`
的实现）。现场核对（`node packages/quay/bin/quay.js driver status --kind promotion|worker`）：
```
promotion: supervisor pid=3696193 alive=1 · driver pid=3696202 alive=1 · running=1 · last_record_ts=2026-09-06T08:07:34.771Z
worker:    supervisor pid=2176308 alive=1 · driver pid=2176709 alive=1 · running=1 · last_record_ts=2026-09-06T08:04:07.308Z
```
两个 driver 都活、都在几分钟级新写记录——是真正反映生产状态的活数据源，卡片却完全没读它。

**方案**：把 mgrCard 换成读 `aliveness()`+`carrierStats()`（`promotion`/`worker` 各查一次），
卡片标题改为「Driver」，展示两行（每行：kind、alive/dead、last_record 相对时间）；退役的
`loopDriver`/`liveness` 字段从卡片渲染中移除（`ManagerResult` 类型定义本身可以保留，不在本任务范围内
做类型层清理，只改卡片实际读取/渲染的字段）。为避免每次 `/dashboard` 请求都同步读 pid 文件 + jsonl
末行，复用 `readPoolMetrics`（`observation.ts:2898`）已有的 30s TTL 缓存手法给这个新读取包一层缓存。

## Plan

1. 在 `observation.ts` 新增一个纯函数（或复用 `readPoolMetrics` 同款缓存包装模式）读取
   `promotion`/`worker` 两个 kind 的 `aliveness()`+`carrierStats()`，通过 in-process `import`
   `plugin/scripts/driver-runtime.ts` 的 `aliveness`/`carrierStats`（不 spawn 子进程、不解析 CLI 输出）。
2. 改 `renderMgrCard`：标题「Manager / Outer / Inner」→「Driver」；渲染两行
   `promotion: <alive text> · <last_record relativeTime>`、`worker: <同上>`；
   dead/pid 缺失时渲染「未运行」而非编造的占位符（absent-field 契约，硬规则 3b/4b）。
3. `handleDashboard`/`handleDashboardCards` 的数据组装点同步换成新读取函数的返回值；
   `#mgr-card` 的 DOM id 不变（`renderDashboardCardRefreshScript` 已有的自动刷新路径不用改）。
4. 旧的 `runLoopDriverProbe`/`liveness` 读取调用点若因此清空，保留函数定义（`readManager`／
   `/manager` 页面等其它消费者可能仍需要），只改 mgrCard 这一个消费点，不做跨文件大范围清理。

## Acceptance Criteria

- [ ] AC1（真实读数）：给定当前 workspace 真实的 `.quay/promotion-*.pid` / `.quay/worker-*.pid` 与
      对应 carrier jsonl，新读取函数返回的 `supervisorAlive`/`driverAlive`/`lastTs` 与
      `node packages/quay/bin/quay.js driver status --kind promotion --json` /
      `--kind worker --json` 的输出逐字段一致（同一时刻对照，不是分别读两次不同时刻的状态）。
- [ ] AC2（卡片渲染）：给定两个 kind 均 `running:true` 的 fixture，`renderMgrCard`（或其新签名）输出
      同时包含 `promotion` 与 `worker` 两个 kind 各自的 alive 状态文案；给定 `running:false`
      （pid 文件缺失）的 fixture，输出「未运行」而非 `undefined`/`NaN`/空字符串。
- [ ] AC3（退役读数不再出现在卡片）：`grep -n "loopDriver\|liveness" packages/quay/src/serve-dashboard.ts`
      在 `renderMgrCard` 函数体内命中数为 0（旧字段名不再被这个函数引用）。
- [ ] AC4（零新增子进程开销）：`grep -n "execFileSync\|spawnSync\|execSync" packages/quay/src/observation.ts`
      新增读取函数所在代码块内命中数为 0（in-process 调用 `driver-runtime.ts` 导出函数，不 shell 出）。
- [ ] AC5（真实回归）：新增/复用的单测覆盖 AC1/AC2/AC3 的固定断言，
      `node --experimental-strip-types --test packages/quay/test/gap-dashboard-driver-status-card.test.mjs`
      exit 0；并用 MCP 浏览器截图核验一次：生产页面「Driver」卡显示的 pid/alive/last_record 与
      当时 `quay driver status` 的现场输出一致。

## Definition of Done

- 代码改动已合入 `develop`。
- `scripts/test.sh --for-task gap-dashboard-driver-status-card`（或等价 scoped 调用）绿。
- 手工用 MCP 浏览器刷新生产 dashboard 页确认：原「MANAGER / OUTER / INNER」卡已替换为显示
  promotion-driver / worker-driver 真实存活状态的卡片，不再显示「未接入」占位文案。
- `quay task check gap-dashboard-driver-status-card --json` 的 `missing` 为 `[]`。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/src/observation.ts
- packages/quay/test/gap-dashboard-driver-status-card.test.mjs
- tasks/gap-dashboard-driver-status-card.md