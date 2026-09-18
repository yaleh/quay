---
id: gap-webui-dashboard-body-copy-en-zh
title: /dashboard 正文文案在 lang=en 下仍是硬编码中文 —— 卡片标题/状态词/链接/项目身份卡都不随语言切换（正文本地化系列第 1
  页，定 pattern）
status: todo
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

**缺口（2026-09-18 在真实浏览器形态下复现：headless Chrome 截图 `/dashboard?lang=en` + curl `Cookie: lang=en` 抽取可见文本）**：

GOAL-024 AC-289~303 与 `gap-webui-lang-switcher-control` 落地后，`?lang=en` 下 `/dashboard` 的 **外壳**（nav 各项、`<h1>`、`<title>`、`<html lang>`、切换控件）已是英文，
但 **正文文案** 仍是写死在源码里的中文字面量。实测 `curl -H 'Cookie: lang=en' /dashboard` 去掉 `<style>/<script>`/标签后含中文的文本行 **57 条**，其中界面文案（非任务标题/提交信息等用户数据）包括：

| 位置 | 中文字面量（例） | 源码位置 |
|---|---|---|
| 副标题 | 循环脉搏、任务台账、系统资源与三层调度状态的总览 — 每张卡片指向对应完整页面。 | `serve-dashboard.ts:1366` |
| 时间轴窗口说明 | 时间轴窗口（以各自最近一次运行/fan-in 结束时刻为终点的过去 3h） | `serve-dashboard.ts`（窗口选择器一行） |
| 项目身份卡 | 项目身份 / 项目根路径 / 主机 / 监听 / 交付物 / 工作区落盘 / 分支模型 / 未接入/无数据 / 一致 / 不一致 — 该工作区落盘的 plugin 已过期 / 未评估（缺一侧读数） | `serve-render.ts:1262-1296` `renderIdentityCard` |
| 卡片标题与链接 | 循环脉搏 / 系统资源 / 工作进展 / 阶段目标 / 测试 / 变更记录 / 任务台账速览 / 查看 Live → / 查看系统状态 → / 查看三层状态 → / 查看 Goals → / 查看任务列表 → / 查看 Tests → / 查看 Journal → / 查看 Git History → | `serve-dashboard.ts`（`CJK 行` 共 50 条非注释行） |
| 状态词 | 在飞 N / 上限 M / 运行中 / 末条记录 N ago / AC 达成 a/b / ready（最近 10 条）/ 最近 5 次机械 fan-in（landed/red · 锁持有区间） | `serve-dashboard.ts` |

**去重（机制，不是症状）**：`tasks/*.md` 中无「正文文案本地化」机制的任务。相关但不同机制（仅 traceability）：`gap-ac289-dashboard-zh-nav-label-and-own-title`（只做 nav 当前项与 `<title>`）、`gap-webui-lang-switcher-control`（只做切换入口）。

<!-- dedup-ref -->
**为什么这是「系列第 1 页」**：其余 14 页 `lang=en` 下同样有大量中文正文（按含中文文本行数：journal 246 / tests 82 / sessions 60 / goal 44 / tasks 24 / live 23 / manager 23 / architecture 21 / board 20 / git-history 19 / adr 18 / system 14 / needs-human 14 / doc 7，含用户数据行，故为上界）。
它们全部共享 `serve-i18n.ts` 这份字典，若现在并发立 14 条，Touches 会在该文件上互锁且各自发明字典形态。**故先只立本页，把「正文文案字典 + 取词函数 + 测试形态」定下来，落地后其余页各一条、只需一行消费。** 用户数据（任务标题、提交信息、AC 文本）不翻译，只翻译界面文案。

## Plan

1. **红基线**：`curl -s -H 'Cookie: lang=en' http://127.0.0.1:<port>/dashboard`（自起 `startServer({port:0})` 的测试形态，⛔ 不探询常驻实例）去掉 `<style>/<script>`/标签，统计含 CJK 的行，并逐条列出**界面文案**行（剔除任务标题等数据行）；贴完整清单，这是本任务的「待清零集合」。
2. **字典**：在 `serve-i18n.ts` 新增 `DASHBOARD_LABELS: Record<DashboardKey, {en:string; zh:string}>`（与既有 `NAV_LABELS`/`PAGE_LABELS` 同形：`Record<Key, …>` 使缺一列编译期报错），**zh 列逐字等于现有中文字面量**（zh 下输出零变化）。带插值的文案（`在飞 ${n} / 上限 ${m}`、`AC 达成 ${a}/${b}`、`末条记录 ${t}`）用取词函数接收参数，⛔ 不在调用点拼接中英混合串。
3. **取词函数**：`dashboardLabelsFor(lang)`（照 `navLabelsFor` 一次取整表，避免逐项重复读）。
4. **改 `serve-dashboard.ts`**：50 条非注释中文行全部经字典取词；`renderDashboardPage` 已有 `opts.lang`，**两条渲染路径（快照路径=生产默认、旧路径）都要改**（AC-288 任务已记录过这个坑：只改旧路径会在生产形态下漏改）。
5. **改 `serve-render.ts` `renderIdentityCard`**：加 `lang` 形参，`stateText`/`branchVal`/各标签走字典；调用点 `serve-dashboard.ts:1368` 传 `opts.lang`。
6. **既有测试迁移**：默认语言是 `en`，钉中文字面量的 dashboard 测试在改造后会变红。逐个处理：断言中文的改为请求 `?lang=zh`（保持断言不变，同时它们因此变成 zh 输出零变化的回归护栏），另补 en 侧断言。先跑一遍找出全部红的（⛔ 不靠 grep 猜），红的文件若不在 Touches 里，**先补 Touches 再改**。
7. **新测试 `packages/quay/test/serve-dashboard-body-i18n.test.mjs`**（`// @test-group product`）：字典完备性（每键 en/zh 都非空且 `en` 列不含 CJK、`zh` 列含 CJK 或纯符号）、黑盒 en/zh 两态。
8. **因果对照**：临时把 `dashboardLabelsFor` 钳成恒返回 zh 列，验证 en 黑盒断言变红；恢复复绿。
9. **收口**：`scripts/test.sh --for-task gap-webui-dashboard-body-copy-en-zh` 绿 + `packages/quay/test/serve-*.test.mjs` 全绿 + `tsc --noEmit` 绿；落地后**重启常驻 `quay serve`**（不会自动重载）并在真实 headless Chrome 下截图核对。

## AC

- [ ] **AC1（红基线，枚举不是布尔）**：贴 `lang=en` 下 `/dashboard` 的界面文案中文行**完整清单与条数**（本任务的待清零集合）；⛔ 不得只报总数，也不得把任务标题等数据行混进来。
- [ ] **AC2（en 清零）**：同一判据在改后 `lang=en` 下，界面文案中文行 **= 0**；剩余含中文的行经逐条核对**全部是用户数据**（任务标题/提交信息/AC 文本），贴出剩余行及归类。⛔ 判据先对红基线干跑一次确认能命中（零计数必须先对已知真样本验证谓词，否则 0 不携带信息）。
- [ ] **AC3（zh 零变化）**：`lang=zh` 下 `/dashboard` 的**界面文案**与改前逐字一致——在改前 commit 与改后各抓一次 zh 响应，去除动态数据后 diff 为空（或差异逐条解释）。⛔ 不得只测 en。
- [ ] **AC4（字典完备且被强制）**：`DASHBOARD_LABELS` 为 `Record<DashboardKey,{en,zh}>`；测试断言每键两列非空、`en` 列无 CJK；删掉任一列 `tsc --noEmit` 报错（贴一次删列后的 tsc 红读数，再恢复）。
- [ ] **AC5（两条渲染路径都改）**：快照路径与旧路径分别触发并断言 en 输出无界面中文（`peekDashboardSnapshot` 命中与未命中各一次）。
- [ ] **AC6（因果对照）**：`dashboardLabelsFor` 钳成恒 zh 后 en 黑盒断言变红，恢复后复绿，两次读数并排贴出。
- [ ] **AC7（既有测试迁移）**：改造前先跑 Touches 内与 dashboard 相关的全部既有测试，贴出**实际变红的清单**；逐个迁移后全绿；`scripts/test.sh --for-task gap-webui-dashboard-body-copy-en-zh` 绿；`node --test packages/quay/test/serve-*.test.mjs` 全绿；`tsc --noEmit` 绿。
- [ ] **AC8（真实浏览器形态）**：落地后重启常驻 serve，用 headless Chrome 截图 `/dashboard?lang=en` 与 `?lang=zh`，贴截图路径；en 图上无界面中文。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「字典里多了一批键、单测绿了」，而是**一个真实的 `quay serve` 进程在真实浏览器里，选 EN 后 `/dashboard` 的界面文案全部是英文，选中文后与改前完全一致**：

1. **落地对象**：AC2/AC3 的读数直接来自 HTTP 响应体（⛔ 不读渲染函数返回值当「响应」）。
2. **可被打红**：AC6 因果对照实际跑过；AC2 判据先对红基线命中过。
3. **不越界**：只改 `/dashboard` 及其独占的 `renderIdentityCard`；其余 14 页的正文**一字不动**（`git diff --stat` 只含 Touches 内文件）。
4. **pattern 可被下游消费**：字典形态 + 取词函数 + 测试形态写进任务体「决定记录」一节，其余页面任务只需照抄，不需重新设计。
5. **可回滚**：还原 `serve-dashboard.ts`/`serve-render.ts`（`renderIdentityCard`）的取词调用、删 `DASHBOARD_LABELS`，纯本地代码无外部状态。
6. **生效核对**：重启 serve 后浏览器截图（AC8），⛔ 不以「代码已落地」代替「页面已变」（常驻 serve 不会自动重载）。

## Touches

- tasks/gap-webui-dashboard-body-copy-en-zh.md
- packages/quay/src/serve-dashboard.ts
- packages/quay/src/serve-render.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-dashboard-body-i18n.test.mjs (new)
- packages/quay/test/serve-dashboard.test.mjs
- packages/quay/test/serve-ac95-views.test.mjs
- packages/quay/test/gap-dashboard-cards-layout-and-livecard-swimlane.test.mjs
- packages/quay/test/gap-dashboard-grid-autofit-columns-vs-card-count.test.mjs
- packages/quay/test/gap-dashboard-livecard-minilist-overflow-indicator.test.mjs
