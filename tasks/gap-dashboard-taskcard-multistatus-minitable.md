---
id: gap-dashboard-taskcard-multistatus-minitable
title: dashboard taskCard 升级为按状态分栏的可展开迷你表（依据48h访问日志：/tasks 单小时78次跨状态整页巡检）
status: ready
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**依据（实测读数）**：过去48h `.quay/quay-access.log` 访问日志（440条请求窗口）里，`/tasks` 是最高频
base path（170次），且 08-30 15:05–15:59 单小时内产生 78 次跨 `status=done/ready/todo/needs-human` ×
`sort=updated` × `pageSize=N` 组合的请求——这是"整页跳转来回切换状态巡检"的模式，每切一次状态就是一次
完整往返。同一窗口里 `/dashboard` 本身只被访问 4 次，远低于它汇总的 `/tasks`/`/tests`/`/live`，说明当前
dashboard 的任务卡片信息密度不够，用户巡检时绕过它直奔 `/tasks`。

**现状**：`packages/quay/src/serve-dashboard.ts` 的 `taskCard`（`renderDashboardPage` 内）只渲染：
①按 `TASK_STATUS` 的横向计数条 + 文字计数，②一个不区分状态、只取"非 done 且 updatedAt 最新的 5 条"的
`recentActive` 列表。要看某个具体状态（比如 needs-human）下都有哪些任务，仍必须点开 `/tasks?status=...`。

**提议**：把 `taskCard` 从"计数条 + 单一混合列表"升级为按状态分栏的迷你表：对 `ready`/`todo`/
`needs-human` 三个非终态状态（`done`/`superseded` 保留纯计数，不展开明细，避免版面爆炸），各渲染一个
"最近 N 条"（N=3）迷你列表，按 `updatedAt` 降序，每行仍是指向 `/task/<id>` 的链接。数据源复用已有的
`readTaskSummary()`（30s TTL 缓存的 `client.taskList({includeBody:false})` 结果），在内存里按 `status`
分组即可——不新增 provider 调用、不新增网络往返，只改渲染函数内部的分组逻辑。

## Acceptance Criteria

- [ ] `renderDashboardPage` 对 `ready`、`todo`、`needs-human` 三个状态，各自渲染一个独立的"最近 N 条"
      迷你列表区块（N=3，按 `updatedAt` 降序），可用测试断言生成的 HTML 中三个状态各自的区块标题 +
      对应 task id 链接均存在。
- [ ] 每个状态迷你列表在该状态下任务数为 0 时，该区块不渲染任务行（不显示空列表占位噪音），但计数条
      仍照常显示该状态的 0。
- [ ] 不新增 provider 调用：改动前后 `client.taskList`（进而 `readTaskSummary`）在一次 `/dashboard`
      请求里的调用次数不变（沿用 `gap-webui-dashboard-load-time-optimization` AC3 的"零额外调用"判据，
      写一个 mock/spy 断言调用次数）。
- [ ] `node --test packages/quay/test/gap-dashboard-taskcard-multistatus-minitable.test.mjs` 新增测试
      exit 0，覆盖：四态混合 fixture 下三个分栏各自列出正确的任务 id；`done`/`superseded` 不展开明细。
- [ ] 既有 dashboard 相关测试不因本改动回归：
      `node --test packages/quay/test/gap-dashboard-parallelize.test.mjs
      packages/quay/test/gap-webui-root-should-show-dashboard.test.mjs` exit 0。
- [ ] `scripts/test.sh --for-task gap-dashboard-taskcard-multistatus-minitable` scoped 静态检查通过
      （或等效的本仓库任务级 scoped 门），exit 0。

## Definition of Done

不是"新增了渲染函数和绿测试"就算完——DoD 要求：在本机实际启动的 `quay serve`（例如
`node --experimental-strip-types packages/quay/bin/quay.ts serve --host <ip> --port <p>`）上真实
`curl`/浏览器打开 `/dashboard`，看到 ready/todo/needs-human 三栏迷你表渲染出**当前任务store里真实存在
的任务 id**（不是 fixture 数据），且页面加载耗时相对改动前无明显回归（用改动前后各一次 `curl -w
"%{time_total}"` 对 `/dashboard` 的粗略对照，记入任务体或提交信息）。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-dashboard-taskcard-multistatus-minitable.test.mjs
- tasks/gap-dashboard-taskcard-multistatus-minitable.md
