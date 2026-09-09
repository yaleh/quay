---
id: gap-dashboard-driver-status-card
title: Dashboard Driver 卡只读 promotion/worker 两个字面量 kind，遗漏 quality/meta/goal
  三个真实在跑的 driver（应遍历 DriverKind 而非硬编码）
status: done
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: execution
---
> **RETREATED / 搁置（人用 ps 直接核验：实际存活 5 个 driver kind（promotion/worker/quality/meta/goal），本任务落地实现硬编码字面量联合 promotion|worker，遗漏 quality/meta/goal 三个；任务体已补追加发现 + AC6/AC7，退回 ready 重新推进为遍历 DriverKind 的通用实现）**

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

**追加发现（2026-09-09，本任务已 done 落地后，人用真实进程核验再次核查暴露的缺口）**：
上面「现在实际驱动本仓库的是两层 driver」这句话在本任务撰写时是真的，**但已经过期**——
`plugin/scripts/driver-runtime.ts:111` 的 `DriverKind` 类型早已是
`"promotion" | "worker" | "outer" | "quality" | "meta" | "goal"` 六种，而 `ps aux` 直接核验（direct 量，
非自报）确认**当前实际存活的是 5 个 kind**（`outer` 已确认彻底退役——`.quay/outer-*.pid` 不存在、
`driver status --kind outer` 返回 `running=0 carrier_records=0`）：
```
promotion : supervisor pid=2740047（09-07 11:11 起）· driver pid=3813695 · running=1 · last_record 09-09T02:31Z
worker    : supervisor pid=2740107（09-07 11:11 起）· driver pid=1668830 · running=1 · last_record 09-09T02:28Z
quality   : supervisor pid=2031614（09-08 16:06 起）· driver pid=3807969 · running=1 · last_record 09-09T02:30Z
meta      : supervisor pid=49269  （09-07 09:03 起）· driver pid=3812949 · running=1 · last_record 09-09T02:31Z
goal      : supervisor pid=3307756（09-07 12:08 起）· driver pid=3813761 · running=1 · last_record 09-09T02:30Z
outer     : 无 pid 文件、driver status 恒 0（已退役，非本任务范围）
```
每一个 pid 都用 `ps -o pid,lstart,cmd -p <pid>` 逐条核对为真实的
`driver-runtime.ts __supervise --kind <kind>` / `<kind>-driver.ts` 进程对，不是读 pid 文件自证。

而本任务已落地的实现（`renderDriverStatusRow(kind: "promotion" | "worker", ...)`、
`readDriverKind(root, kind: "promotion" | "worker")`，见 `observation.ts:3009`/`serve-dashboard.ts:606`）
**把 kind 写成了字面量联合类型 `"promotion" | "worker"`，逐字复刻了本任务 Proposal 当时的（已过期）认知**——
不是代码 bug，是任务撰写时的前提被后续新增的 3 个 driver kind（quality/meta/goal）超越了，
实现完全忠实地做了任务要求的事，只是任务要求本身现在覆盖不全。**Driver 卡目前对生产使用者是失真的**：
只显示 2/5 个真正在跑的 driver，quality-driver/meta-driver/goal-driver 三个的存活状态完全不可见。

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
5. **（追加）不再硬编码 `"promotion" | "worker"` 字面量联合**：`readDriverKind`/
   `renderDriverStatusRow` 的 kind 参数类型改为 `driver-runtime.ts` 已导出的 `DriverKind`
   （`:111`，六值），`readDriverStatus` 改为遍历 `KNOWN_KINDS`（`:226`，导出的 `DriverKind[]`）而不是
   两行手写字段——这样以后再新增/退役一个 driver kind（本任务的教训正是"两层"这个数字本身会过期），
   卡片不需要再改代码就能跟上。**`outer` 是否要在卡片里显示「未运行」是一个产品判断，不是本任务自己
   决定**：默认方案是六个 kind 全部渲染（`outer` 显示「未运行」是真实且有信息量的——它标注了"这个角色
   已确认退役"，不是遗漏），除非人在推进本任务时另有裁定。

## Acceptance Criteria

- [x] AC1（真实读数）：给定当前 workspace 真实的 `.quay/promotion-*.pid` / `.quay/worker-*.pid` 与
      对应 carrier jsonl，新读取函数返回的 `supervisorAlive`/`driverAlive`/`lastTs` 与
      `node packages/quay/bin/quay.js driver status --kind promotion --json` /
      `--kind worker --json` 的输出逐字段一致（同一时刻对照，不是分别读两次不同时刻的状态）。
- [x] AC2（卡片渲染）：给定两个 kind 均 `running:true` 的 fixture，`renderMgrCard`（或其新签名）输出
      同时包含 `promotion` 与 `worker` 两个 kind 各自的 alive 状态文案；给定 `running:false`
      （pid 文件缺失）的 fixture，输出「未运行」而非 `undefined`/`NaN`/空字符串。
- [x] AC3（退役读数不再出现在卡片）：`grep -n "loopDriver\|liveness" packages/quay/src/serve-dashboard.ts`
      在 `renderMgrCard` 函数体内命中数为 0（旧字段名不再被这个函数引用）。
- [x] AC4（零新增子进程开销）：`grep -n "execFileSync\|spawnSync\|execSync" packages/quay/src/observation.ts`
      新增读取函数所在代码块内命中数为 0（in-process 调用 `driver-runtime.ts` 导出函数，不 shell 出）。
- [x] AC5（真实回归）：新增/复用的单测覆盖 AC1/AC2/AC3 的固定断言，
      `node --experimental-strip-types --test packages/quay/test/gap-dashboard-driver-status-card.test.mjs`
      exit 0；并用 MCP 浏览器截图核验一次：生产页面「Driver」卡显示的 pid/alive/last_record 与
      当时 `quay driver status` 的现场输出一致。
- [x] AC6（六 kind 全覆盖，不再硬编码两个字面量）：`grep -n '"promotion" | "worker"\|"promotion"|"worker"'
      packages/quay/src/observation.ts packages/quay/src/serve-dashboard.ts` 命中数为 0（字面量联合已改成
      `DriverKind` 类型引用）；`grep -n "KNOWN_KINDS" packages/quay/src/observation.ts` 命中数 ≥1
      （改成遍历导出的 kind 列表，不是手写两行）。
- [x] AC7（真实回归，六 kind 全部可见）：给定当前 workspace 真实的 5 个存活 driver
      （promotion/worker/quality/meta/goal，2026-09-09 用 `ps -o pid,lstart,cmd -p <pid>` 核验过的现场
      pid，验收时需重新现场核验一次而非援引本任务写死的历史 pid），`/dashboard` 页面（或
      `renderMgrCard`/`readDriverStatus` 的单测 fixture）的 Driver 卡对这 5 个 kind 每一个都渲染出
      「运行中」+ 一个非空的末条记录相对时间；`outer` 渲染出「未运行」（不是被静默省略——负控制：
      故意把某个 kind 的 pid 文件改名/删除，断言该 kind 从「运行中」变成「未运行」而不是从卡片上消失）。

## Definition of Done

- 代码改动已合入 `develop`。
- `scripts/test.sh --for-task gap-dashboard-driver-status-card`（或等价 scoped 调用）绿。
- 手工用 MCP 浏览器刷新生产 dashboard 页确认：Driver 卡同时显示 promotion/worker/quality/meta/goal
  五个 kind 的真实存活状态（与当时 `node packages/quay/bin/quay.js driver status --kind <kind>` 的
  现场输出逐一核对一致），不再只显示 promotion/worker 两项。
- `quay task check gap-dashboard-driver-status-card --json` 的 `missing` 为 `[]`。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/src/observation.ts
- packages/quay/test/gap-dashboard-driver-status-card.test.mjs
- packages/quay/test/gap-dashboard-visual-review-batch-fixes.test.mjs
- packages/quay/test/gap-webui-dashboard-tests-card-latest-round-no-live-signal.test.mjs
- tasks/gap-dashboard-driver-status-card.md
