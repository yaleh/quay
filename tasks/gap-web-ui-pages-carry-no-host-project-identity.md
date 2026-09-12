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

- [x] AC1 能取假：**两个不同项目**的 `/dashboard` 的 `<title>` **必须不同**——打印两个实际取值做对照。今天两者均为 `Dashboard`，故本条**今天必红**。**验证（真实 HTTP 探测，⛔ 非渲染层自测）**：起真实 `startServer`（本任务 worktree 源码）分别以两个**真实项目根**为 cwd，两次真实 `GET /dashboard` ⇒ P1 `/home/yale/work/quay` = `<title>quay — Dashboard</title>`，P2 `/home/yale/.quay-verify-dryrun/proj`（quay-init 生成的真实工作区）= `<title>proj — Dashboard</title>`；差异落在**项目半边**（两侧都以同一 `Dashboard` 结尾，故不是「比了两个不同页面」）。可取假控制见 `packages/quay/test/serve.test.mjs`：两个不同根 ⇒ title 不同 ∧ 同根两次调用相等 ∧ 裸字面量 `<title>Dashboard</title>` 会被源级谓词判红。
- [x] AC2 项目可定位：页面内容中出现该项目的 `projectRoot` **完整路径**（今天 0 命中）；打印命中行。**验证**：同一对真实探测里 `/dashboard` 正文命中各自完整根路径，原文 `<strong>项目根路径</strong>：<code class="identity-project-root">/home/yale/work/quay</code>` / `...>/home/yale/.quay-verify-dryrun/proj</code>`（改前两页均为 0 命中）。
- [x] AC3 版本一致性可见：`quay-init-state.json` 的 `pluginVersion` 与交付物 plugin 版本**并排出现**在 dashboard，且两者不等时存在**可机械检出**的标记。**负控制现成**：archguard 于 2026-09-12 补跑 quay-init 前为 `0.4.0` vs `0.6.1`（不等态），补跑后应为相等态——两态的页面输出必须可区分。**验证**：P2（落盘 `0.4.0`，真实 quay-init 工作区）渲染 `<p … data-plugin-version-state="mismatch">` + `交付物 0.6.1 · 工作区落盘 0.4.0 · 不一致 — 该工作区落盘的 plugin 已过期`；P1（无 `quay-init-state.json`）渲染 `data-plugin-version-state="unknown"` + 「未评估（缺一侧读数）」。三态由纯函数 `pluginVersionState()` 单测取值区分，**`unknown` 是独立取值、绝不写成 match**（硬规则 3b）；match 态另由单测断言其 marker 与 mismatch 不同（两态可区分），并附「mismatch 页不得同时报 match」的负控制。
- [x] AC4 单一真源：title/身份的拼装逻辑**只有一处**——给出 grep 计数**并打印命中内容**（⛔ 计数不打印内容不算，硬规则 2）。**验证**：四处定义（`serveIdentity()` / `projectLabel()` / `pageTitle()` / `renderIdentityCard()`）全部只存在于 `packages/quay/src/serve-render.ts`；源级 grep `projectLabel(` / `.projectName` / `.projectRoot` / `.deliveredPluginVersion` / `.initPluginVersion` / `.landingBaseline` 在 16 个 `serve-*.ts` 中的命中**只在 `serve-render.ts`**（页模块 0 命中，命中内容即该文件内的定义与自用），且这条不变量由 `serve.test.mjs` 做成断言，附负控制（伪造一个页内自拼身份的片段必被判红 ⇒ 谓词不是恒真）。
- [x] AC5 概览页全覆盖：Plan 第 1 步清单中的**每一个概览页** title 都带项目身份（逐页列出改前/改后取值）。**验证**：源级扫描 `serve-*.ts` 的 head `<title>` 共 23 处，其中 **16 处**（= Plan 第 1 步清单的全部概览页）经 `pageTitle()`；余 7 处为详情页，保留实体 id（理由见「实施说明 ③」）。逐页改前/改后取值与两次真实探测的完整 15 路由读数见下方两节。

## Definition of Done

- 五条 AC 全部满足。
- AC1/AC2 的证据取自**两个真实项目的跨机探测**（⛔ 非本地单项目自测——单项目下两个 title 天然不同，证明不了任何事）。
- ⛔ **不得通过在 17 处各自硬写项目名来满足 AC1/AC5** —— 那会让 AC4 红，且是本任务明确要避免的形态。
- 项目自身闸门（scripts/test.sh 相关 scoped 门）全绿。

## 实施说明

**① Plan 第 1 步 —— 全部 `<title>` 实际取值清单（`grep -n '<title>' packages/quay/src/serve-*.ts`，23 处 head title）**

概览页（通用词，16 处 —— 本任务改造对象）：

| 文件:行 | 改前 | 改后 |
|---|---|---|
| serve-dashboard.ts:1245 | `Dashboard` | `<project> — Dashboard` |
| serve-task.ts:467 | `Quay — ${manifest.name}` = `Quay — quay-native` | `<project> — Tasks` |
| serve-live.ts:149 | `Live — loop activity` | `<project> — Live — loop activity` |
| serve-live.ts:161 | `Journal — recent loop record` | `<project> — Journal — recent loop record` |
| serve-board.ts:160 | `Board — 三源 join 看板` | `<project> — Board — 三源 join 看板` |
| serve-system.ts:63 | `System — 系统状态` | `<project> — System — 系统状态` |
| serve-system.ts:147 | `Manager / Outer / Inner` | `<project> — Manager / Outer / Inner` |
| serve-tests.ts:860 | `Tests — 验证轮记录` | `<project> — Tests — 验证轮记录` |
| serve-sessions.ts:70 | `Sessions — 会话观测` | `<project> — Sessions — 会话观测` |
| serve-git.ts:913 | `Git history — 任务分组` | `<project> — Git history — 任务分组` |
| serve-git.ts:957 | `Git history — vertical commit timeline` | `<project> — Git history — vertical commit timeline` |
| serve-adr.ts:23 | `ADRs` | `<project> — ADRs` |
| serve-goal.ts:383 | `Goals` | `<project> — Goals` |
| serve-doc.ts:35 | `Docs` | `<project> — Docs` |
| serve-architecture.ts:71 | `Architecture — 系统组件图` | `<project> — Architecture — 系统组件图` |
| serve-needs-human.ts:76 | `Needs Human — ${manifest.name}` = `Needs Human — quay-native` | `<project> — Needs Human` |

> ⚠️ 两处「本来就带名字」的（`/tasks`、`/needs-human`）**并未解决本缺陷**：它们带的是 `manifest.name` = provider 名（native provider 恒为 `quay-native`），**在每个工作区里是同一个字符串**，恰恰是「多项目同形」的成因之一。故二者计入概览页，一并改为项目身份。

详情页（实体 id，7 处 —— **不改**，理由见 ③）：`serve-doc.ts:63` `${d.id}`、`serve-adr.ts:59` `${a.id}`、`serve-task.ts:665` `${t.id}`、`serve-goal.ts:475` `${g.id}`、`serve-sessions.ts:244` `Session — ${view.sessionId}`、`serve-tests.ts:1107` `Test file — ${filePath}`、`serve-send.ts:437` `消息投递 — ${outcome.sessionId}`。

**② Plan 第 2 步 —— 单一真源落点**

`packages/quay/src/serve-render.ts` 内四处新定义，是全仓库唯一身份来源：
`serveIdentity(input)`（装配 `projectName`/`projectRoot`/`host`/`port`/`hostname`/两个 plugin 版本/分支模型）、`projectLabel(id)`（项目显示名：`workspaceRoot` basename；**仅当超出 32 字符**才截断并追加根路径的 8 位摘要 —— 截断不得把两个项目并成同一个标签）、`pageTitle(pageName, id)`（**唯一**标题拼装点）、`renderIdentityCard(id)`（**唯一**身份字段渲染点）。
`observation.ts` 新增 `readBranchModel(root)`：serve 路径唯一被许可读 git 的模块（其他模块只渲染它返回的结果）。`serve.ts` 在 `listen` 成功后**装配一次**身份（端口取内核实际绑定值，故 `--port 0` 报的是真端口）并交给路由分发；页面各自把 `cfg.identity` 传给自己那个 render 函数。

**③ Plan 第 3 步 —— 详情页是否追加项目前缀：判定为「不追加」**

理由三条：**(a)** 现有契约测试把详情页 title 钉在裸实体 id 上（`web-ui-browser.test.mjs` 断言 `<title>WUI-1</title>`），加前缀即破坏真实契约；**(b)** Plan 第 5 步的负控制同向 —— 项目标签在前时，标签页截断会先吃掉 **id**，而 id 恰是详情页唯一要读的 token；**(c)** 详情页的项目语境由「概览页 title + nav + /dashboard 身份卡片」承担，而 AC4 的不变量保证页内**无法**私自再拼一个项目串。

**④ Plan 第 5 步 —— 负控制取舍依据**

格式取 `<项目> — <页面名>`（项目在前）：本缺陷的形态是「多项目、同一页」，项目在前才解决它；而单项目下的可读性由另一条规则保证 —— **超长时截断项目名、绝不截断页面名**（`PROJECT_LABEL_MAX = 32`，超出则 `前 22 字符…+ 根路径 8 位摘要`）。故标签页被挤时丢掉的是限定词，不是「我在哪一页」。测试另断言 `pageTitle` 的 16 处调用在两次真实探测里**全部**以页面名结尾。

**⑤ AC1/AC2/AC3/AC5 的真实读数（两个真实项目，真实 HTTP）**

```
P1 root=/home/yale/work/quay                        P2 root=/home/yale/.quay-verify-dryrun/proj
/dashboard        quay — Dashboard                  /dashboard        proj — Dashboard
/tasks            quay — Tasks                      /tasks            proj — Tasks
/live             quay — Live — loop activity       /live             proj — Live — loop activity
/journal          quay — Journal — recent loop record  /journal       proj — Journal — recent loop record
/board            quay — Board — 三源 join 看板      /board            proj — Board — 三源 join 看板
/system           quay — System — 系统状态           /system           proj — System — 系统状态
/manager          quay — Manager / Outer / Inner    /manager          proj — Manager / Outer / Inner
/tests            quay — Tests — 验证轮记录          /tests            proj — Tests — 验证轮记录
/sessions         quay — Sessions — 会话观测         /sessions         proj — Sessions — 会话观测
/git-history      quay — Git history — vertical …   /git-history      proj — Git history — vertical …
/adr              quay — ADRs                       /adr              proj — ADRs
/goal             quay — Goals                      /goal             proj — Goals
/doc              quay — Docs                       /doc              proj — Docs
/architecture     quay — Architecture — 系统组件图  /architecture     proj — Architecture — 系统组件图
/needs-human      quay — Needs Human                 /needs-human      proj — Needs Human

P2 dashboard 身份卡片原文（真实工作区，两版本不等态）：
  <strong>项目根路径</strong>：<code class="identity-project-root">/home/yale/.quay-verify-dryrun/proj</code>
  <strong>主机</strong>：<code class="identity-host">boheidc</code> <strong>监听</strong>：<code class="identity-addr">127.0.0.1:38709</code>
  <p … data-plugin-version-state="mismatch"><strong>plugin 版本</strong>：交付物 <code class="identity-plugin-version">0.6.1</code>
    · 工作区落盘 <code class="identity-init-version">0.4.0</code> · <span class="verdict-fail">不一致 — 该工作区落盘的 plugin 已过期</span>
  <strong>分支模型</strong>：default 未接入/无数据 · doc-branch main · landing-baseline integration

P1 同卡片：data-plugin-version-state="unknown"（该工作区无 .quay/quay-init-state.json ⇒ 「未评估（缺一侧读数）」，⛔ 不是 match）；分支模型 default/doc-branch/landing-baseline 均取真实读数。
```

**⑥ 探测机位说明（诚实标注，硬规则 5）**：P2 是**真实存在的第二个项目工作区**（quay-init 生成，自带 `.quay/quay-init-state.json` 与 provider runtime），但它与 P1 同在本机（`boheidc`）——本机不存在第二个「provider 绑定可用」的 quay 工作区（archguard 的 `.quay/config.yml` 正指向**已退役的本地 runtime**，server 起不来，这本身就是本任务要暴露的版本漂移症状）。`<title>` 是 `workspaceRoot` 的纯函数、`hostname` 是独立字段，故 `title 因项目而异` 这一条在单机上与跨机等价；跨机的可见区分由身份卡片的 `主机` 字段承担（渲染的 `os.hostname()`，读数为 `boheidc`）。以上口径如实标注，不冒充跨机。


**⑦ 本轮补修（suite 红 → 绿）**：机械 fan-in 的**全量 suite** 报 4 红，**全部由本任务的 delta 引起**（非环境性；本地重跑 4/4 复现）：

- **3 处 = `handleGoalList` 第 5 参数由 `workspaceRoot: string` 改为 `ServePageCfg` 时**，函数体开始**无条件**读 `cfg.workspaceRoot`。直调单测有两种旧形态：传 `"ws"` 字符串、或传 4 个参数省略该位——**省略形态在旧签名下是被容忍的**（读到的就是 `undefined`，而 `readTaskSummary` 的缓存键本就接受它）。字符串形态下 `workspaceRoot` 静默变成 `undefined` ⇒ 共享 `taskSummaryCache` 键错 ⇒ `taskList` 被调 2 次（AC3b `2 !== 1`）；省略形态下直接抛 TypeError（AC7、AC2/AC3）。修法=在**唯一入口**归一：字符串 ⇒ `{workspaceRoot}`，缺失 ⇒ 仍缺失（=旧行为），两者都不带 identity ⇒ `pageTitle` 渲染显式的「未接入项目身份」，⛔ 不退化成改造前那个匿名标题（硬规则 3b）。
- **1 处 = `gap-webui-tests-page-unpaginated-tables.test.mjs` AC4 把 `serve-adr.ts:26` / `serve-architecture.ts:55` / `serve-board.ts:168` 三个**绝对行号**钉死**：本任务的身份改造把 serve-adr 的表格点从 `:26` 移到 `:28`（一次与表格无关的编辑）即判红。该文件的**文件多重集**断言本就**拒绝比行号**（其注释明写「行号会因无关编辑漂移，不得打红本任务」）——首 3 条断言是**漏改的兄弟**（硬规则 5b）⇒ 改为按**文件 + `<table` 内容**钉，排序与条数仍由「计数断言 + 排序后文件多重集」覆盖。

⇒ 该改动使 `packages/quay/test/gap-webui-tests-page-unpaginated-tables.test.mjs` 进入本任务 delta，故列入下方 `## Touches`。
## Touches

- packages/quay/src/serve-render.ts
- packages/quay/src/serve.ts
- packages/quay/src/serve-handlers.ts
- packages/quay/src/observation.ts
- packages/quay/src/serve-dashboard.ts
- packages/quay/src/serve-doc.ts
- packages/quay/src/serve-adr.ts
- packages/quay/src/serve-goal.ts
- packages/quay/src/serve-board.ts
- packages/quay/src/serve-live.ts
- packages/quay/src/serve-system.ts
- packages/quay/src/serve-architecture.ts
- packages/quay/src/serve-git.ts
- packages/quay/src/serve-task.ts
- packages/quay/src/serve-tests.ts
- packages/quay/src/serve-sessions.ts
- packages/quay/src/serve-needs-human.ts
- packages/quay/test/gap-webui-tests-page-unpaginated-tables.test.mjs
- packages/quay/test/serve-dashboard.test.mjs
- packages/quay/test/serve.test.mjs
- packages/quay/test/web-ui-browser.test.mjs
- tasks/gap-web-ui-pages-carry-no-host-project-identity.md
