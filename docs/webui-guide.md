# quay Web UI — 用户指南

quay 的 Web UI 是一个零构建、无客户端框架的界面：每个页面都是一次普通 HTTP 请求取回完整
HTML（`<style>` 内联 Modernist token），导航/内容大部分由服务端生成。它由 `quay serve` 提供，
数据来自当前 workspace 的 `.quay/config.yml` 指向的 provider（任务、ADR、goal、managed document 等）。

> **原则变更（人 2026-08-23 裁定）**：「零客户端 JS」原则已**废除**（站点级，非单页例外）。原裁定
> 逐字为「引入第三方库。'零客户端 JS'原则取消。」——现改为**按需允许引入第三方前端库**与客户端 JS。
> 落地点：`/git-history` 页改用 D3（`d3`，第三方库）做纵向 git-graph 可视化，库在服务端内联进页面
> （与 Modernist CSS 同法：dist bundle 走 `globalThis.__WEBUI_D3_JS__`，开发树读 `node_modules`）。
> 其余页面维持服务端渲染不变（本页「零客户端 JS」字样仅指 `/git-history` 以外页面的现状）。

本指南覆盖 `packages/quay/src/serve-handlers.ts` 门面分发器里的 **15 条精确路由 + 4 条详情路由**。
每张截图都来自**开发树**启动的真实服务（见下文「截图来源」），并经过真实 HTTP 断言
（状态码 + 关键元素）与像素核验（非空白页）。

---

## 启动

```bash
# 开发树（源码）直接 serve：
node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port 4173
```

- `--host <ip>`：绑定地址。默认 `0.0.0.0`（所有网卡）。要本机浏览器访问或远程访问，显式传 `--host 127.0.0.1` 或你的局域网 IP。
- `--port <port>`：监听端口，默认 `4173`。
- 启动后访问 `http://<host>:<port>/`，根路径会 **302 重定向**到 `/dashboard`。

### 截图来源（重要）

**所有截图取自行 `node ... packages/quay/bin/quay.ts serve` 启动的开发树服务**，不是打包产物
（`quay-*.tgz` / vendored runtime）。原因：`gap-webui-modernist-css-missing-in-tgz` 未 land 前，
打包产物渲染的页面**没有 Modernist 样式**（`webui-modernist.css` 不在 bundle 同目录），而开发树
serve 的样式是完整的。判据：截图页面的 `<style>` 含 `--color-bg` 等 token，body 计算背景为
`#f3f2f2`。

### 前置

- workspace 根必须有 `.quay/config.yml`（provider map）。`serve` 从当前目录向上查找它。
- 各路由按需读取对应数据源：任务（`tasks_dir`）、ADR（`QUAY_NATIVE_ADR_DIR`）、
  goal（`<workspaceRoot>/goals/`）、managed document（`<workspaceRoot>/docs-managed/`）。
  数据缺失时页面会 fail-closed 优雅降级（显示「未接入/无数据」空态），不会崩溃。

---

## 路由总览（15 精确 + 4 详情）

| # | 路由 | 页面 | 截图 |
|---|---|---|---|
| 1 | `/` | 302 → `/dashboard`（落地首页） | [webui-root.png](images/webui-root.png) |
| 2 | `/dashboard` | 总览：循环脉搏 / 任务台账 / 系统资源 / 三层状态 / 最近提交 | [webui-dashboard.png](images/webui-dashboard.png) |
| 3 | `/tasks` | 任务列表（native provider） | [webui-tasks.png](images/webui-tasks.png) |
| 4 | `/system` | 系统状态（CPU / 负载 / cgroup） | [webui-system.png](images/webui-system.png) |
| 5 | `/manager` | Manager / Outer / Inner 三层状态 | [webui-manager.png](images/webui-manager.png) |
| 6 | `/tests` | 验证轮记录 | [webui-tests.png](images/webui-tests.png) |
| 7 | `/sessions` | 三层最近会话（按层分组渲染） | [webui-sessions.png](images/webui-sessions.png) |
| 8 | `/architecture` | 系统组件图 | [webui-architecture.png](images/webui-architecture.png) |
| 9 | `/live` | 循环此刻在做什么（loop activity） | [webui-live.png](images/webui-live.png) |
| 10 | `/journal` | 循环最近记录（tick-log + git log） | [webui-journal.png](images/webui-journal.png) |
| 11 | `/git-history` | 提交纵向时间轴（develop 主干 + task 分支，D3 客户端渲染） | [webui-git-history.png](images/webui-git-history.png) |
| 12 | `/board` | 三源 join 看板（意图/执行/落地 + 分页 + status/label 筛选） | [webui-board.png](images/webui-board.png) |
| 13 | `/adr` | ADR 列表（架构决策记录） | [webui-adr.png](images/webui-adr.png) |
| 14 | `/goal` | Goal 列表（阶段目标与 AC） | [webui-goal.png](images/webui-goal.png) |
| 15 | `/doc` | Managed document 列表 | [webui-doc.png](images/webui-doc.png) |
| 16 | `/adr/:id` | ADR 详情（supersedes / supersededBy 双向渲染） | [webui-adr-detail.png](images/webui-adr-detail.png) |
| 17 | `/goal/:id` | Goal 详情（kind/status、criterion、最近 verdict） | [webui-goal-detail.png](images/webui-goal-detail.png) |
| 18 | `/doc/:id` | Managed document 详情 | [webui-doc-detail.png](images/webui-doc-detail.png) |
| 19 | `/task/:id` | 任务详情（Proposal / Plan / AC / DoD） | [webui-task-detail.png](images/webui-task-detail.png) |

> 详情路由的 `:id` 是 URL 编码的条目 id：`/adr/ADR-016`、`/goal/AC-100`、`/doc/DOC-001`、
> `/task/<task-id>`。不存在时返回 `404 not found`。

---

## 页面逐览

### 1–2. `/` → `/dashboard` — 总览

根路径 302 到 `/dashboard`。Dashboard 是设计稿的落地页：卡片布局聚合「循环脉搏」（在跑任务/并发）、
「系统资源」（cpu_stall / loadavg / GO 判定）、「三层状态」（loop-driver 活性）、「任务台账速览」
（按 status 计数）、「最近更新（非 done）」、「测试」接入状态，以及「变更记录」（最近 git 提交）。

![Dashboard](images/webui-dashboard.png)

### 3. `/tasks` — 任务列表

当前 provider 的完整任务列表。行内展示任务 id、标题、status、labels，可点击进入详情。

![Tasks](images/webui-tasks.png)

### 4. `/system` — 系统状态

服务端读取本机运行观测（CPU stall、loadavg、cgroup 用量），并给出 `GO` / 告警判定。

![System](images/webui-system.png)

### 5. `/manager` — 三层状态

Manager / Outer / Inner 三层各自的会话活性与工作状态。

![Manager](images/webui-manager.png)

### 6. `/tests` — 验证轮记录

读取 `.quay/verification-round.jsonl` 的验证轮记录；文件缺失时 fail-closed 显示「未接入」。

![Tests](images/webui-tests.png)

### 7. `/sessions` — 三层最近会话

按 Manager / Outer / Inner 分层渲染最近会话；未接入层优雅降级（显示缺失说明），不跨层混排。

![Sessions](images/webui-sessions.png)

### 8. `/architecture` — 系统组件图

架构视图，展示系统组件与关系。

![Architecture](images/webui-architecture.png)

### 9. `/live` — 循环此刻在做什么

loop activity 观测页：当前在跑动作、在飞任务、slot 使用。

![Live](images/webui-live.png)

### 10. `/journal` — 循环最近记录

读取 tick-log / git log 的最近记录，展示循环每一步的落痕。

![Journal](images/webui-journal.png)

### 11. `/git-history` — 提交纵向时间轴

纵向 git-graph 时间轴（D3 第三方库客户端渲染）：develop 竖直主干 + task 分支从主干分出
（fork）/合入（merge）的连线。task 分支默认折叠（只显提交总数 + 时间跨度），点击展开查看逐条。
页面仍保留服务端渲染的分支汇总表（无 JS 时的可达视图）。

![Git History](images/webui-git-history.png)

### 12. `/board` — 三源 join 看板

意图 / 执行 / 落地三源 join 看板：服务端分页（`?page=N`）、status 筛选（`?status=`）、
label 筛选（`?label=`），并渲染四个不一致旗标。

![Board](images/webui-board.png)

### 13. `/adr` — ADR 列表

架构决策记录列表（id、标题、status、supersedes/supersededBy）。

![ADRs](images/webui-adr.png)

### 14. `/goal` — Goal 列表

阶段目标与 AC 列表，含 kind/status 筛选（`?kind=` / `?status=`）、criterion、最近 verdict。
`goals/` 目录为空时显示引导空态（指向 prose 正本文件）。

![Goals](images/webui-goal.png)

### 15. `/doc` — Managed document 列表

`docs-managed/` 下 managed document 列表（id、status、kind、title）。

![Docs](images/webui-doc.png)

### 16. `/adr/:id` — ADR 详情

单个 ADR 的完整正文 + 元数据，supersedes / supersededBy 双向链接。例：`/adr/ADR-016`。

![ADR Detail](images/webui-adr-detail.png)

### 17. `/goal/:id` — Goal 详情

单个 goal 的 kind/status/phase、criterion（可运行 shell 命令）、expect、最近 verdict 与时间、
origin 与完整正文。例：`/goal/AC-100`。

![Goal Detail](images/webui-goal-detail.png)

### 18. `/doc/:id` — Managed document 详情

单个 managed document 的正文 + 元数据。例：`/doc/DOC-001`。

![Doc Detail](images/webui-doc-detail.png)

### 19. `/task/:id` — 任务详情

单个任务的 Proposal / Plan / Acceptance Criteria / Definition of Done 完整渲染，顶部含 status
徽章。例：`/task/gap-docs-t3-webui-doc-and-screenshots`。

![Task Detail](images/webui-task-detail.png)

---

## 复现截图

截图 + 真实 HTTP 断言 + 像素核验一键复现：

```bash
# 1. 起 dev-tree serve（任一空闲端口）
node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port 8123 &

# 2. 跑截图脚本（对 19 条路由各做 200/302 + 关键元素断言、截图、像素核验非空白）
docs/capture-webui-screenshots.sh http://127.0.0.1:8123 docs/images
```

- 输出：`docs/images/webui-*.png`（19 张）+ `docs/images/webui-screenshots.tsv`（路由→截图清单）。
- 像素核验：`docs/verify-webui-screenshot.mjs` —— 解码 PNG，断言 Modernist 浅底为主（>50%）、
  深色正文存在（>0.2%）、accent `#ec3013` 出现（token 生效），任一失败判 `BLANK`。
- 需要 `google-chrome`（headless）与 `node`。
