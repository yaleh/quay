---
id: gap-readme-ac278-four-screenshots-and-verify-token-drift
title: docs/screenshots/ 四张真实截图缺席且 README 零 PNG 引用（AC-278 真跑
  CAUSE=screenshots-dir-absent）；既有截图链的像素核验因 accent token 漂移恒判 BLANK，须一并修复
status: ready
labels:
  - gap
  - docs
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-278
---
**type:** execution

## Finding

**缺口（直接量，立案当轮实测；cwd = 主检出 `/home/yale/work/quay`）**：GOAL-021 的 AC-278 要求
`docs/screenshots/` 下存在 dashboard / goals / task-detail / git-history 四张 PNG（各 ≥5000 字节），
且四个**文件名**都被 `README.md` 逐字引用。判据**逐字真跑**（与 goal driver 同形，⛔ 不是读代码推断）：

```
const ac = await createGoalStore(<root>/goals).get("AC-278");
runAcceptance({ command: ac.criterion, cwd: <root> });
⇒ { ok:false, code:1, signal:null, timedOut:false,
    reason:"acceptance failed (exit 1) — CAUSE=screenshots-dir-absent — docs/screenshots does not exist yet" }
```

配套直接量：`grep -c '\.png' README.md` ⇒ **0**；`grep -c '!\[\]' README.md` ⇒ **0**（README 一张图都没有）。

**⚠️ 读数取法**：`runAcceptance` 的返回里**没有 `stdout`/`stderr`**，只有 `{ok, code, signal, timedOut, reason}`，
criterion 的 stderr 被并进 `reason` ⇒ 要断言 `CAUSE=...` 就读 `reason`（⛔ 读不存在的 `stderr` 字段会让断言恒 undefined，
与「跑过了」同形）。
另：`parseFrontmatterCompletely` 读不出 goals/ 下这两条 AC 的 criterion（报 `Source contains multiple documents`），
**可用读取面是 `createGoalStore(<root>/goals)`**（⛔ 参数是 **goals 目录本身**，不是 repo root）。

### ⚠️ 已有一整条截图链（2026-08-21，`gap-docs-t3-webui-doc-and-screenshots` = done）——复用它是对的方向，但它现在跑不起来

| 已有物 | 现状 |
|---|---|
| `docs/capture-webui-screenshots.sh` | 19 条路由：curl 真实 HTTP 断言 + google-chrome headless 截图 + 像素核验；**任一不过即 `FAILED=1` / exit 1** |
| `docs/verify-webui-screenshot.mjs` | PNG 自解码像素核验，判 `non-blank` / `BLANK` |
| `docs/images/webui-*.png` | 19 张（2026-08-21 采集，**旧 CSS 时代**） |
| `docs/images/webui-screenshots.tsv` | 路由清单 |

**它们对不上判据**：判据钉死 `DIR="docs/screenshots"`（现有物在 `docs/images/`）；
且判据要 `*goals*.png`（**复数**）——现有的 `docs/images/webui-goal.png` 是**单数**，**glob 不命中**。

### 缺陷 A（立案当轮实测，两值对照）：`verify-webui-screenshot.mjs` 的 accent token 已漂移 ⇒ **恒判 BLANK**

`docs/verify-webui-screenshot.mjs:16` 写死 `ACCENT = [0xec,0x30,0x13]`（`#ec3013`），
而现行 CSS `packages/quay/src/webui-modernist.css:35` 是 `--color-accent-600: #dd2b0f`。
旧值 `#ec3013` 在现行源码里只剩注释/文档/设计稿（`grep -rn ec3013 packages/quay/src/` 仅命中
`webui-modernist.css:8` 的一句注释）。

**两值对照（同一批 PNG，只改这一个常量）**：

```
用【现行】verifier（#ec3013）              用【改成 #dd2b0f】的 verifier
dashboard    accentPixels 0    BLANK      dashboard    accentPixels 33   non-blank
git-history  accentPixels 0    BLANK      git-history  accentPixels 577  non-blank
（反向对照）2026-08-21 那批旧采集：
dashboard（旧 CSS 渲染）× patched verifier ⇒ accentPixels 0 / BLANK   ← 证明 CSS 确实换过 token
```

⇒ `capture-webui-screenshots.sh` 现在会对**每条路由**都判 BLANK ⇒ 整条链 exit 1，
**而它的失败形态看起来像「UI 坏了」**（与硬规则 3b 同族：一个读不懂输入的判定，返回与不合格同形的值）。

**第二个脆弱点（即使 token 改对）**：`accent > 0` 要求**精确等于** token 的像素。
Goals 页的 accent 只以**抗锯齿文字**出现 ⇒ **改对 token 后仍得 `accentPixels: 0` / `BLANK`**
（实测 `/goal` 页面在 patched verifier 下仍为 0）。⇒ 该子句不是稳健判据。

### 缺陷 B（GOAL-021 记的「页面中段灰色空白区域」）：**根因是截图时序，不是产品 bug，也不是懒加载**

GOAL-021 立案时记「疑似某组件懒加载未完成，正式产出截图前必须先排查修复」。**逐条实测推翻了"懒加载"假设**：

1. **页面里没有任何懒加载机件**：`curl /dashboard` ⇒ HTTP 200 / 65908 字节；
   `grep -ci "loading\|spinner\|placeholder\|skeleton"` ⇒ **0**。
2. 那块空白是 `#sys-sparkline`：服务端渲染 `sparklineSvg([], threshold)` —— **只有图例**
   （2 个 `<rect>` + 2 个 `<text>`），却占着固定 `viewBox="0 0 300 120"` / `height:120px` ⇒ 一个 120px 空框。
3. 曲线只在 `history.length >= 2` 时画（`serve-dashboard.ts:669`），而 history **只由客户端轮询**累积：
   `setInterval(refresh, REFRESH_MS)`、`REFRESH_MS = 30000`（`:591,:722,:773`），
   **且没有立即执行的首次调用** ⇒ 第 1 个点 ≈ t=30s，第 2 个点 ≈ **t=60s**。
4. 而 `google-chrome --headless=new --virtual-time-budget=3000..4000 --screenshot` 在 **t≈3–4s** 就拍
   ⇒ **结构上必然拍到空框**（2026-08-21 那批同样如此，只是当时卡片更紧凑、不显眼）。
5. 同屏的「循环脉搏」甘特是服务端渲染、`aria-label="循环脉搏甘特图（固定 5 泳道）"`；
   当前 `在飞 0 / 上限 5` ⇒ **5 条泳道本来就是空的**，同样不是缺陷。

⇒ **解法是"等渲染稳定再拍"（GOAL-021 原文点名 chrome-devtools / playwright MCP 作为"能等"的工具类别），
不是改产品代码。** GOAL-021 的**非目标**明确：⛔ 本 GOAL 不改产品功能/代码逻辑（除非缺陷本身是真产品 bug）——
**本 Finding 已证否该前提**。**⚠️ 本任务的实际执行路径见下方 Requested action 第 2 步的纯 CLI 方案——
执行本任务的 worker 不持有这两个 MCP，"等渲染稳定"这个目标改用 Chrome 自带的 `--virtual-time-budget`
虚拟时钟快进达成，效果已用两次真实截图对照验证（见下）。**

### 环境读数（立案当轮实测，供实现轮直接用）

```
chrome-devtools MCP 已配置（~/.claude.json global mcpServers，仅 manager 会话可用）
playwright MCP 已配置（同上，仅 manager 会话可用）
```

**⚠️ 这两条 MCP 只在 manager 会话（人交互的这个会话）配置，执行本任务的 worker（`worker-driver` 派发出去的
fix-worker 子会话）不挂载它们**——worker 的工具集只有 Bash/Read/Edit/Write 等，找不到
chrome-devtools/playwright 的 MCP 工具。**本任务必须走纯 Bash CLI 路径完成截图与 DOM 读数
（见 Requested action 第 2 步 / AC7），⛔ 不要在 worker 里尝试寻找或调用这两条 MCP 工具**——
找不到会卡住任务。

```
/usr/bin/google-chrome 存在
quay serve 正在跑：http://100.78.206.100:4173（pid 2345364）
路由可达：/dashboard 200 · /goal 200 · /git-history 200 · /task/<id> 200
```

### ⚠️ 判据的三条字面语义（逐字读 criterion 得出，决定文件命名）

1. `ls "$DIR"/*"$name"*.png | head -1` ⇒ **每个名字都取【字典序第一个】匹配**。
   实测：`dashboard-mobile.png` 排在 `dashboard.png` **前面**（`-` 0x2D < `.` 0x2E）
   ⇒ 若目录里同时有移动版，`head -1` 取的是**移动版**，README 就必须引用 `dashboard-mobile.png`。
   ⇒ **每个名字只放一张 PNG**（或保证 README 引用的是 `head -1` 实际选中的那个 basename）。
2. `grep -qF "$base" README.md` 只要求 **basename 字面出现**——一句裸文本提及也算过。
   ⇒ 判据不证明"真的嵌入了图"；本条自加更严的 AC5（要求真 markdown 图片语法）。
3. `REQUIRED="dashboard goals task-detail git-history"` 是**复数 `goals`**，⛔ 不是 `goal`。

### 去重读数（立案前逐条核，都是直接量）

- `grep -rl '^goal_ac: AC-278' tasks/` ⇒ **0 个文件**；`grep -rln 'AC-278' tasks/` ⇒ **0 命中**
  ⇒ 没有任何在飞任务承接这条 AC。
- 同 GOAL 兄弟任务（机制不同，均 `todo`）：`gap-readme-positioning-software-engineering-agent`（AC-276）、
  `gap-dev-stats-collect-from-production-carriers`（AC-277）。

<!-- dedup-ref -->
<!-- 上面两条兄弟任务都把 `README.md` 写进 `## Touches`，与本条对 README.md 的声明交叠，
     派发面按 Touches 互斥串行——这是预期的串行化，不是缺陷；本条不声明任何对它们的依赖。 -->

- `docs/verify-webui-screenshot.mjs` / `docs/capture-webui-screenshots.sh` **无打包镜像**
  （`find packages/quay/plugin -name 'verify-webui-screenshot*'` ⇒ 空）⇒ 无需声明 mirror。

## Requested action

产出四张真实截图并让 README 引用它们；一并修掉挡在这条路上的失效仪表。

1. **建 `docs/screenshots/`，恰好四个文件**（名字即判据的 glob 锚点，⛔ 每个名字只此一张）：
   `dashboard.png` · `goals.png` · `task-detail.png` · `git-history.png`，各 ≥5000 字节。
2. **从【正在运行的 dev-tree `quay serve`】采集**（`http://100.78.206.100:4173`；⛔ 不是打包产物——
   `capture-webui-screenshots.sh:10-12` 记的 `gap-webui-modernist-css-missing-in-tgz` 未落地前，
   打包构建渲染不出 Modernist CSS）。
   **⚠️ 不要用 chrome-devtools MCP 或 playwright MCP**——这两条 MCP 只在 manager 会话配置，
   执行本任务的 worker 没有这两个工具（见「环境读数」）。改用下面这条纯 Bash 命令，
   用 Chrome 自带的 `--virtual-time-budget` 把虚拟时钟快进到渲染稳定，
   **拍前不需要等待任何真实墙钟时间**：

   ```bash
   google-chrome --headless --disable-gpu --no-sandbox --window-size=<w>,<h> \
     --virtual-time-budget=95000 \
     --screenshot=docs/screenshots/<name>.png \
     "http://100.78.206.100:4173/<路由>"
   ```

   `--virtual-time-budget=95000` 让 Chrome 的虚拟时钟快进到 95 秒虚拟时间，触发页面
   `setInterval(refresh, 30000)`（`serve-dashboard.ts:591,:722,:773`）的至少 2 次轮询——
   sparkline 需要 `history.length >= 2` 才画曲线（`serve-dashboard.ts:669`）——从而解决缺陷 B。
   **manager 会话已用两次真实截图对照验证**：不带 `--virtual-time-budget`（默认，t≈3-4s 拍）
   ⇒ `#sys-sparkline` 卡片是空的；带 `--virtual-time-budget=95000` ⇒ 同一张截图里
   `#sys-sparkline` 已经画出数据点曲线。
   ⛔ 仍然不要用【短】`--virtual-time-budget`（默认或 3000–4000 这类，t≈3-4s 就拍）直接拍——
   那正是缺陷 B 的成因；95000 这个量级本身就是"等到渲染稳定"的等价形态，不在此项禁止之列。
3. **修 `docs/verify-webui-screenshot.mjs` 的 accent token 漂移**（缺陷 A）：⛔ 不要再写死一个字面量
   （硬规则 4 推论二：写死的、依赖当前代码的常量，下次漂移时会**静默**变恒假）。
   从 `packages/quay/src/webui-modernist.css` **读出** `--color-accent-600` 的值来用（或等价地：
   把 `accent > 0` 从"精确 RGB 相等"放宽为"存在靠近该 token 的像素"）。
   无论取哪条，都必须保留**可证伪性**：改完要能给出"旧 token ⇒ BLANK / 当前 token ⇒ non-blank"这一对读数（AC3）。
4. **README.md 用真 markdown 图片语法引用四个文件**（basename 逐字出现，满足判据的 `grep -qF`；
   用 `![...](docs/screenshots/dashboard.png)` 形态，⛔ 不是裸文本提及——自加 AC5 钉这条）。
5. **把缺陷 B 的排查结论写进任务记录**（根因 = 30s 轮询 × 2 才画 sparkline，而 headless 短预算 t≈4s 就拍），
   ⛔ **不改产品渲染代码**——GOAL-021 非目标明确禁止扩大范围；该前提已被本 Finding 证否。

**新增文件不需要 capability-catalog 登记**（那是 `plugin/scripts/` 的义务；`docs/` 下的截图与脚本不在其列）。
若改动 `docs/capture-webui-screenshots.sh` 的输出目录/命名，**它的 `MANIFEST` 与 19 条路由表要同步**，
否则该脚本自身与 `docs/images/` 的既有清单会分叉。

## Acceptance Criteria

- [ ] AC1: AC-278 的 criterion 逐字判定通过。取法：`createGoalStore(<主检出>/goals).get("AC-278")` 取
      `criterion`，`runAcceptance({command: criterion, cwd: <主检出>})`（与 goal driver 同形）
      ⇒ **`ok === true` 且 `code === 0`**。证据形态：命令 + 完整 JSON 输出。⛔ 不是「另写一份等价谓词跑绿」；
      ⛔ 不得用 `parseFrontmatterCompletely`（见 Finding 读数取法）。
- [ ] AC2（负控制——证明 AC1 的绿不是判据恒绿）: 在一个**临时副本**里把 `docs/screenshots/goals.png` 删掉
      （或改小到 <5000 字节），cwd = 该副本跑**同一条** criterion ⇒ **exit 1** 且 `reason` 含
      `CAUSE=screenshots-missing`（或 `screenshots-too-small`）；还原后再跑 ⇒ exit 0。
      两条读数并排贴出（证明本判据在本产物上确实能取两个值）。
- [ ] AC3（缺陷 A 的两值对照）: 同一张新 PNG，① 用**修复前**的 verifier ⇒ `verdict: BLANK`
      （`accentPixels: 0`）；② 用**修复后**的 ⇒ `verdict: non-blank`。并给出**反向对照**：
      修复后的 verifier 对一张**旧 token 时代**的渲染仍判 BLANK（证明它测的确实是当前 token，不是恒真）。
      三条读数并排。
- [ ] AC4（真截图、真路由）: 四张 PNG 各 ≥5000 字节（`stat -c%s`）；每条路由的真实 HTTP 断言
      （`curl -s -L -o … -w %{http_code}` ⇒ 200 且页面含该页 `<h1>` **前缀**：
      `<h1>Dashboard</h1>` / `<h1>Goals —` / `<h1>Git History —` / `<h1>gap-…`）。
      ⚠️ `/goal` 的 h1 带**会漂移的目标计数**（实测 `Goals — 阶段目标 (21)`）⇒ ⛔ 断言整串，只断前缀。
- [ ] AC5（README 真嵌入，严于判据）: `grep -n 'docs/screenshots/' README.md` ⇒ **恰好 4 行**，
      每行是 markdown 图片语法（形如 `![…](docs/screenshots/<name>.png)`），且四个 basename 逐字命中。
      把这 4 行原文贴出。
- [ ] AC6（glob 唯一性陷阱）: 打印 `ls docs/screenshots/*<name>*.png` 对四个名字各自的行数 ⇒ **各为 1**
      （证明 `head -1` 选中的就是 README 引用的那张；理由见 Finding「判据的三条字面语义」第 1 条）。
- [ ] AC7（缺陷 B 的两值对照——证明"空框"是时序而非渲染缺陷）: 对同一 URL，在 t≈4s 与 t≈90s 各取一次
      `#sys-sparkline` 的**数据点数**（如 `document.querySelectorAll('#sys-sparkline polyline, #sys-sparkline circle').length`）
      ⇒ 前者 **0**、后者 **>0**；并附 `grep -ci "loading\|spinner\|placeholder\|skeleton"` 对 `/dashboard` HTML
      ⇒ **0**（页面无懒加载机件）。
      **不依赖 MCP 的等价取法（worker 用这条）**：`google-chrome --headless --disable-gpu --no-sandbox
      --virtual-time-budget=<N> --dump-dom "<url>"` 把渲染后的 DOM 输出到文件，再用 grep/python 数
      数据点元素个数；具体选择器（`<polyline>`/`<circle>` 等）由实现者先跑一次 `--dump-dom` 看真实渲染
      输出后再定，不要凭空假设标签名。t≈4s（不带 `--virtual-time-budget`，或给一个很小的值如 4000）
      与 t≈95000 两次 dump 各做一次，对比数据点元素数量。

## Definition of Done

- [ ] `docs/screenshots/{dashboard,goals,task-detail,git-history}.png` 四张已在 **`develop`** 上存在，各 ≥5000 字节。
- [ ] README.md 的四个 markdown 图片引用已在 **`develop`** 上
      （`git show develop:README.md | grep -c 'docs/screenshots/'` ⇒ 4）。
- [ ] AC-278 的 criterion 在**权威基线**上成立：对 **develop 的检出**跑
      `runAcceptance({command: criterion, cwd: <该检出>})` ⇒ `ok === true`
      （⛔ 不是只在任务 worktree 里绿、develop 上读不到）。
- [ ] `docs/verify-webui-screenshot.mjs` 的 accent token 不再写死：它从 `webui-modernist.css` 读出
      （或等价地不再依赖单一字面量），且 AC3 的两值对照在该改动后仍成立——即它**能判 BLANK 也能判 non-blank**，
      ⛔ 不是恒真、也⛔ 不是恒假。
- [ ] ⛔ 没有改动产品渲染代码（`packages/quay/src/serve-*.ts` / `webui-modernist.css` 的 diff 为空）——
      除非实现轮发现了一个**独立于截图时序**的真产品 bug，那种情况下须单独给出「若该 bug 为假则读数会不同」
      的对照（硬规则 4 推论四）。
- [ ] 判准遵循 inherited-core 的 REAL LANDING 口径（DIR-026 Reading A）：证据钉在**产物被真实机制读取并判 pass**
      （AC1/AC2 两条读数分开可证伪），⛔ 不是「目录里能 grep 到 4 个文件」这类静态存在性断言。

## Touches

- README.md
- docs/screenshots/dashboard.png (new)
- docs/screenshots/goals.png (new)
- docs/screenshots/task-detail.png (new)
- docs/screenshots/git-history.png (new)
- docs/verify-webui-screenshot.mjs
- docs/capture-webui-screenshots.sh
- tasks/gap-readme-ac278-four-screenshots-and-verify-token-drift.md（自身）
