---
id: gap-git-history-svg-server-rendered
title: web UI 服务端渲染 git history SVG（人裁定，新依赖 0，零客户端 JS）
status: todo
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

- [ ] AC1: **复现固化**——任务体记录约束（纯服务端、零 JS、零新依赖）+ 两陷阱（工时不可推 / 遥测不相交）（本任务 Proposal 已含）
- [ ] AC2: **服务端 SVG 路由**——`/git-history` 返回服务端渲染 SVG（复用 html/escapeHtml/pageStyles/renderMarkdown）
- [ ] AC3: **不假装知道工时**——图横轴=落地时刻，无持续时间/工时语义
- [ ] AC4: **零新依赖零客户端 JS**——`<script>` 标签 0 个，package.json 无新依赖
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

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
