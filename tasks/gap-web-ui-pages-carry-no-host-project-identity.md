---
id: gap-web-ui-pages-carry-no-host-project-identity
title: web 各概览页不带主机/项目身份 —— 多机多项目时浏览器标签页完全同形，无法分辨在看哪个项目
status: ready
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**症状（2026-09-12 跨机实测对照，机械可复算）**：同时打开两个项目的 quay web，**在标签页上无法分辨哪个是哪个**。

```
                        archguard @ ad-arm1      quay 自己 @ boheidc
<title>                 Dashboard                Dashboard            ← 完全同形
<h1>                    Dashboard                Dashboard
页头品牌                Quay                     Quay
导航 10 项              完全相同                 完全相同
主机名出现次数          0                        0
监听 IP 出现次数        0                        0
项目根路径出现次数      0                        0
```

⇒ **身份信息不是「显示得不好」，是压根不在页面上**。而**浏览器标签页是页面不可见时唯一的标识**，多标签页正是多机多项目的默认工作形态。

**一个内在矛盾说明这不是有意设计**：详情页的 title **都带了实体 id**（`${t.id}` / `${g.id}` / `${a.id}` / `${d.id}`、乃至 `${iv.taskId} · ${state} · ${duration}`），**能精确区分具体对象**；而**概览页**全是通用词——`Dashboard` / `Docs` / `ADRs` / `Goals` / `Board — 三源 join 看板` / `Live — loop activity` / `Journal — recent loop record` / `Manager / Outer / Inner` / `Architecture — 系统组件图` / `Git history — …`——**连项目都区分不了**。⇒ 详情页解决了「是哪个对象」，没人解决「是哪个项目/哪台机器」。

**已有可行先例**：`packages/quay/src/serve-needs-human.ts:76` 的 title 已经是 `Needs Human — ${escapeHtml(manifest.name)}`。⇒ 这条路走得通，只是**没有推广、也没有单一真源**。

**数据全部现成，⛔ 不需要新数据源、不需要改配置**：`cfg.workspaceRoot`（`serve.ts` 已持有，见 `:208` 等处）+ CLI 的 `--host/--port` + `os.hostname()`。

**结构现状（决定方案形态，⛔ 不要绕过）**：`serve-render.ts` **只导出样式函数**（`pageStyles()` / `shellStyles()`），**没有共享的页头/导航/标题渲染**；`<title>`、`<h1>`、页头分散在 **17 个 `serve-*.ts` 各自硬写**（如 `serve-dashboard.ts:1245` 的 `<title>Dashboard</title>` 与 `:1247` 的 `<h1>Dashboard</h1>`）。⇒ **若在 17 处各自拼字符串即复制即漂移**，本任务要求先立单一真源。

**为什么现在值得做（不是洁癖）**：quay 的目标形态就是驱动**第三方**项目，多机多项目是常态。该机器上此刻就并存着一批同类项目（`quay-verify-coldstart-*-root`、`quay-verify-upgrade-*-root`、`archguard`、`quay` 自身），**光看项目名都分不出是哪个副本**——项目根路径才是唯一可辨识的量。

**一个由今日实例导出的高价值读数**：archguard 的**配置形状版本**（`.quay/quay-init-state.json` 的 `pluginVersion`）当日为 `0.4.0`，而**交付物 plugin 版本**为 `0.6.1`——两者不一致导致 `goals/` 载体缺失、provider 绑定指向已退役的本地 runtime 等一系列症状，而这**挖了很久才被发现**。⇒ 若 dashboard 并排显示这两个数，**打开页面即可见**，且它是**能取假的读数**（不等即异常），⛔ 不是装饰性信息。

## Plan

1. **先取直接量**：列出全部 `serve-*.ts` 中 `<title>` 的**实际取值清单**（打印清单本身，⛔ 不要只报数量——硬规则 2）；标出哪些是概览页（通用词）、哪些是详情页（已带实体 id）。
2. **立单一真源**：在 `serve-render.ts` 新增身份与标题的**唯一**拼装点（形如 `serveIdentity(cfg)` → `{projectName, projectRoot, host, port, hostname}` 与 `pageTitle(pageName, identity)`）。⛔ **不得在各页各自拼字符串**。`projectName` 建议由 `workspaceRoot` 的 basename 派生（零配置、总是可得），具体取法由你定，但必须只有一处。
3. **各概览页改为调用它**（详情页保持带实体 id，可按同一函数追加项目前缀，是否追加由你判断并在任务体说明理由）。
4. **dashboard 身份卡片**：项目根路径 / 主机名 + 监听地址 / **交付物 plugin 版本 vs `quay-init-state.json` 的 `pluginVersion`** / 分支模型（default、doc-branch、landing-baseline）。两个版本不一致时给出**可机械检出**的标记。
5. **负控制（单项目不得变难读）**：单项目场景下标题不得长到把页面名挤出标签页可视区——给出你的取舍依据（例如项目名在前、页面名在后，或超长时截断项目名而非页面名）。

## Acceptance Criteria

- [ ] AC1 能取假：**两个不同项目**的 `/dashboard` 的 `<title>` **必须不同**——打印两个实际取值做对照。今天两者均为 `Dashboard`，故本条**今天必红**。
- [ ] AC2 项目可定位：页面内容中出现该项目的 `projectRoot` **完整路径**（今天 0 命中）；打印命中行。
- [ ] AC3 版本一致性可见：`quay-init-state.json` 的 `pluginVersion` 与交付物 plugin 版本**并排出现**在 dashboard，且两者不等时存在**可机械检出**的标记。**负控制现成**：archguard 于 2026-09-12 补跑 quay-init 前为 `0.4.0` vs `0.6.1`（不等态），补跑后应为相等态——两态的页面输出必须可区分。
- [ ] AC4 单一真源：title/身份的拼装逻辑**只有一处**——给出 grep 计数**并打印命中内容**（⛔ 计数不打印内容不算，硬规则 2）。
- [ ] AC5 概览页全覆盖：Plan 第 1 步清单中的**每一个概览页** title 都带项目身份（逐页列出改前/改后取值）。

## Definition of Done

- 五条 AC 全部满足。
- AC1/AC2 的证据取自**两个真实项目的跨机探测**（⛔ 非本地单项目自测——单项目下两个 title 天然不同，证明不了任何事）。
- ⛔ **不得通过在 17 处各自硬写项目名来满足 AC1/AC5** —— 那会让 AC4 红，且是本任务明确要避免的形态。
- 项目自身闸门（scripts/test.sh 相关 scoped 门）全绿。

## Touches

- packages/quay/src/serve-render.ts
- packages/quay/src/serve.ts
- packages/quay/src/serve-dashboard.ts
- packages/quay/src/serve-doc.ts
- packages/quay/src/serve-adr.ts
- packages/quay/src/serve-goal.ts
- packages/quay/src/serve-board.ts
- packages/quay/src/serve-live.ts
- packages/quay/src/serve-system.ts
- packages/quay/src/serve-architecture.ts
- packages/quay/src/serve-git.ts
- packages/quay/test/serve-dashboard.test.mjs
- packages/quay/test/serve.test.mjs
- tasks/gap-web-ui-pages-carry-no-host-project-identity.md
