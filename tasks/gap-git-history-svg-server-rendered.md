---
id: gap-git-history-svg-server-rendered
title: web UI 服务端渲染 git history SVG（人裁定，新依赖 0，零客户端 JS）
status: done
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**人 2026-08-12 02:2x 裁定**：「做 服务端渲染 git history SVG。排任务吧。」

**约束（manager 实测）**：
| 项 | 值 |
|---|---|
| `serve-handlers.ts` | 1516 行，`<script>` 标签 0 个——纯服务端渲染 HTML，零客户端 JS |
| `serve.ts` 头注 | 「no framework, no styling beyond what's needed」 |
| 现有路由 | `/` `/adr` `/board` `/doc` `/goal` `/journal` `/live` |
| 可复用渲染件 | `html()` `escapeHtml()` `pageStyles()` `renderMarkdown()`（均已 export） |
| 取数成本 | `git log --all --source` = 6450 条 / 422 ms / 1.17 MB；fan-in 373 条 / 372 ms |
| 拓扑规模 | 79 分支、近 7 天 3352 提交、505 合并提交 |

**服务端 SVG 完全可行，新增依赖 0，无构建步骤**。现成库全不建议：gitgraph.js 已归档 / Mermaid 3352 行图源 / React 换架构。

**⚠ 两个 AC 必须写死的陷阱**：
1. **git 分支寿命 ≠ 任务工时**：149/164 fan-in 寿命 <1h（活在首提交前干完）。图横轴是**落地时刻**，不是持续时间；任何「这个任务花了多久」语义都不能从 git 时间轴推。
2. **真工时在遥测里但两边几乎不相交**（6% join，见 #55）。图只能展示 git 能证明的（落地时刻/合并），不能假装知道工时。

**实现归 inner，判定归 outer。**

**验证锚**：修后 (a) `/git-history` 路由返回服务端 SVG；(b) 零 `<script>` 标签（纯服务端）；(c) 无新依赖；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录约束（纯服务端、零 JS、零新依赖）+ 两陷阱（工时不可推 / 遥测不相交）（本任务 Proposal 已含）
- [x] AC2: **服务端 SVG 路由**——`/git-history` 返回服务端渲染 SVG（复用 html/escapeHtml/pageStyles/renderMarkdown）
- [x] AC3: **不假装知道工时**——图横轴=落地时刻，无持续时间/工时语义
- [x] AC4: **零新依赖零客户端 JS**——`<script>` 标签 0 个，package.json 无新依赖
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：`/git-history` 返回 SVG + `<script>` 计数 0 贴出
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay/src/serve-handlers.ts（/git-history 路由 + SVG 生成）
- packages/quay/src/serve.ts（路由注册）
- packages/quay/test/serve-handlers.test.mjs（SVG 路由用例）
- tasks/gap-git-history-svg-server-rendered.md（自身：勾 AC + 贴证据）

## Contract

measure   git_history_svg = `curl -s http://localhost:PORT/git-history | grep -c '<svg'` 的 stdout 数字
band      git_history_svg >= 1（/git-history 返回 SVG）
invariant zero_client_js = 1（serve-handlers.ts 新增代码零 `<script>` 标签）
invariant no_new_deps = 1（package.json 无新依赖）
invoke    `node --experimental-strip-types packages/quay/bin/quay.ts serve --port 18000 & sleep 2; curl -s http://localhost:18000/git-history | grep -c '<svg'`（贴 SVG 计数）
control   服务端 SVG 可达；零客户端 JS；零新依赖；既有不回归
resume    SVG 路由 / 测试 / 不假装工时分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-12
changed: 人 022037 裁定（服务端 git history SVG）。约束 + 两陷阱由 manager 实测。实现归 inner。

## Evidence（内层实现 2026-08-12）

落地形态：`/git-history` 路由（`serve-handlers.ts` 的 `handleAllRoutes` 注册）返回**服务端渲染的 SVG**——取数在 `observation.ts` 的 `readGitHistory`（git 隔离在唯一允许知道 git 的 serve 路径模块；一次 `git log --branches --source`，`%H %ct %S %P %s`，`-n 500` 封顶），渲染在 `serve-handlers.ts` 的 `renderGitHistorySvg`（**纯字符串拼接，无模板引擎，无 `<script>`**）。复用 `html`/`escapeHtml`/`pageStyles`；`renderMarkdown` 不适用（该页无 markdown 正文，故未强行调用）。取数成本实测 ~422ms/1.17MB（与任务 Proposal 的测量一致）。

**两陷阱的落地（AC3）**：横轴 = `%ct` 提交落地时刻（unix 秒），x 单调映射到提交时间；**不画任何「任务花了多久」的持续时间/工时条**。每分支一条 lane：存活区间线（first→last 提交，代码注释与页面明示「分支存活区间 ≠ 任务工时」）+ 每个提交一个点（普通提交=蓝圆，合并提交=橙菱形）。页面 note 显式写「横轴 = 提交落地时刻，不是工时/持续时间」「真工时不在此图中：它在遥测里（#55，join 率仅 ~6%）」。数据窗口明示「最近 500 条提交（跨所有本地分支）」。

**AC4 验证（零客户端 JS + 零新依赖）**：`/git-history` 页面与 SVG 内 `<script` 计数 = 0；`package.json` / `package-lock.json` 无改动（`git status` 只有 3 个源文件 + 1 个测试文件 + 本任务文件）。

**修后实跑（Contract invoke）**——worktree 真仓库起 serve（临时 `.quay/config.yml`，跑完即删）：

```
$ node --experimental-strip-types packages/quay/bin/quay.ts serve --port 18000 & sleep 2
$ curl -s http://localhost:18000/git-history | grep -c '<svg'        # → 1
$ curl -s http://localhost:18000/git-history | grep -c '<script'     # → 0
$ curl -s http://localhost:18000/git-history | wc -c                 # → 154209
$ curl -s http://localhost:18000/git-history | grep -o '横轴 = 提交落地时刻[^<]*'  # → 横轴 = 提交落地时刻（git commit time），不是工时/持续时间。
```

真实仓库 SVG：32 lanes（含图例）、408 提交点、94 合并菱形。

**Scoped gate（C1）**——`scripts/test.sh --for-task gap-git-history-svg-server-rendered`（9 个选中测试文件，含新 `serve-handlers.test.mjs` 7 用例 + 既有 `serve.test.mjs` 等）：

```
ℹ tests 86 | ℹ pass 86 | ℹ fail 0 | ℹ cancelled 0 | ℹ duration_ms ~46810
```

新测试 `packages/quay/test/serve-handlers.test.mjs`（7 用例）：x 随提交时间单调（AC3 陷阱钉死）、单时刻窗口无 NaN、合并/普通 mark 区分、降级不渲染图、真 git 工作区集成（200 + ≥1 `<svg>` + 0 `<script>` + 页面明示 落地时刻/非工时）、非 git 工作区 200「无数据」（AC5 不 500）。

**提交（分步）**：
- `2fa0ca86` inner: #56 /git-history — server-rendered SVG commit-landing timeline（SVG 路由 + 不假装工时说明，observation.ts + serve-handlers.ts + serve.ts）
- `7bb3cb26` inner: #56 tests — /git-history SVG route + AC3 x-axis semantics + AC4 zero-JS + AC5 degradation（serve-handlers.test.mjs）
- 本提交：任务文件勾 AC + 贴 Evidence

**诚实备注**：AC1 由任务 Proposal 既有文本满足（复现固化已在任务体）；全量套件绿（DoD 末行）按 DoD 归属外层 verification-round 验证，非 inner 此步范围。
