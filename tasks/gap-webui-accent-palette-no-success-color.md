---
id: gap-webui-accent-palette-no-success-color
title: web UI 配色令牌无独立"成功/绿色"色相——pass/alive/GO 与 fail/dead 只靠红橙色系深浅区分，普通链接也复用同一色相
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
**type:** execution

## Proposal

**证据（2026-09-02 用 chrome-devtools MCP 实测 /dashboard，逐条核对渲染 HTML/CSS 得到，非猜测）**：

`packages/quay/src/webui-modernist.css`（唯一 `:root` 令牌定义块，全文件 252 行）里**只有一个强调色家族 `--color-accent*`/`--color-accent-2*`，且从 100 到 900 全部是红/橙色相**（`--color-accent: #ec3013`、`--color-accent-700: #ae1800`、`--color-accent-800: #7c1405` ……），**整个文件里不存在任何绿色/青色系令牌**。这个文件是 `docs/design/quay-webui-improved-2026-08-16/_ds/modernist-40217566-87fa-42b1-9cc0-36027903691f/styles.css` 的产品侧镜像副本（受 `webui-modernist-sync.test.mjs` AC100(a) 字节级一致性强制），所以两处都要改。

由于没有独立的"成功/正向"色相，代码里把"正向状态"和"负向状态"都塞进了同一个红橙家族，只靠深浅（700 vs 800）区分，实测出的具体冲突点：

1. `packages/quay/src/serve-render.ts:250-251`（同一对定义在文件里重复出现于 `:439-440`）：`.verdict-pass { color: var(--color-accent-700); }` / `.verdict-fail { color: var(--color-accent-800); }`——"通过"与"失败"用的是同一色相的两级深浅，而不是两种可区分的色相。
2. `packages/quay/src/serve-dashboard.ts:94`（dashboard 测试卡片"近5轮"色块）：`r.state === "green" ? "var(--color-accent-700)" : r.state === "red" ? "var(--color-accent-800)" : "var(--color-neutral-400)"`——实测截图核实：5 个色块的 `title` 属性全部写着 `green pass N/N`，但视觉渲染出来是暗红色方块（`#ae1800`），与页面上到处都是的告警文字、普通导航链接同一色相，肉眼完全无法把"全绿全过"和"需要注意"区分开。
3. `packages/quay/src/serve-dashboard.ts:165`（系统资源卡片）：`sysGo ? "var(--color-accent-700)" : "var(--color-accent-800)"` 渲染 `⇒ GO` / `⇒ WAIT` / `⇒ 未接入`——同样的红橙深浅二分。**同一屏内的反例**：紧邻这张卡片的 MANAGER/OUTER/INNER 卡片里 `loop-driver: DEAD` 用的是纯默认文字色（无任何着色，`serve-dashboard.ts` 该行没有走 accent 判断），反而是三张卡片里视觉强调最强的"⇒ GO"语义上最不需要强调——强调层级和信息的重要性是倒挂的。
4. `packages/quay/src/serve-sessions.ts:32`：`s.alive ? "var(--color-accent-700)" : "var(--color-accent-800)"` 渲染 `LIVE`/`GONE`，同一模式再现一次——同一个色相家族被复用为"活/死"信号，跟 `a { color: var(--color-accent) }`（`webui-modernist.css:95`，全站默认超链接色）几乎撞色。

**根因**：色板设计阶段没有规划"成功/正向"语义色，实现时复用了唯一的强调色家族并靠深浅代偿，这个模式在多处独立复现（不是某一处的孤立笔误）。**判据（可证伪）**：若关掉这个假设——即给通过态一个真正不同色相的令牌——上面 4 处的深浅二分渲染出的截图应当能明显区分正/负，而当前截图（已保存于本次会话）不能。

## Plan

1. 在**设计源** `docs/design/quay-webui-improved-2026-08-16/_ds/modernist-40217566-87fa-42b1-9cc0-36027903691f/styles.css` 的 `:root` 令牌块里新增一个与 `--color-accent*` **色相不同**（非红橙，例如绿/青系）的语义色阶，命名遵循既有家族命名法（如 `--color-positive-700`/`--color-positive-800`，具体命名以文件里已有的 `-100…-900` 阶梯风格为准），至少覆盖 700/800 两档以维持现有"通过更浅、告警更深"的层级习惯。
2. 把该新增令牌**逐字节同步**到产品侧镜像 `packages/quay/src/webui-modernist.css`（`webui-modernist-sync.test.mjs` AC100(a) 会做字节级校验，不能只改一边）。
3. 改写 `serve-render.ts` 的 `.verdict-pass`（两处定义）指向新令牌，`.verdict-fail` 保留在 `--color-accent-700/800` 家族（负向信号留在原家族，不需要新色）。
4. 改写 `serve-dashboard.ts:94`（近5轮色块 `state === "green"` 分支）与 `:165`（`sysGo` 分支的 `GO` 一侧）指向新令牌；`red`/`WAIT`/`未接入` 分支保留原 accent 家族。
5. 改写 `serve-sessions.ts:32` 的 `alive` 一侧指向新令牌，`GONE` 一侧保留原 accent 家族。
6. 顺带核实（不在本任务强制修复范围，仅记录）：`serve-architecture.ts:34/66`（"最近变更"高亮）与 `serve-send.ts:410`（`delivered` 状态）是否也是同一模式的正向语义误用红橙色——如果是，另开任务，避免本任务范围失控。

## Acceptance Criteria

- [x] `grep -c 'color-positive\|color-success' docs/design/quay-webui-improved-2026-08-16/_ds/modernist-40217566-87fa-42b1-9cc0-36027903691f/styles.css` 与对 `packages/quay/src/webui-modernist.css` 的同一 grep 结果**都 ≥ 1 且相等**（新令牌两侧同步落地）。
- [x] `node --test packages/quay/test/webui-modernist-sync.test.mjs` 全绿（AC100(a) 字节级一致性未破坏）。
- [x] 新令牌的十六进制色相与 `--color-accent`（`#ec3013`）的色相角（HSL hue）差异 ≥ 60°（机械可算：脚本读两个 hex，转 HSL，比较 hue 差），证明确实是"不同色相"而不是又一级红橙深浅。
- [x] `serve-render.ts` 里两处 `.verdict-pass` 定义均改用新令牌，`grep -c "verdict-pass.*color-accent-700" packages/quay/src/serve-render.ts` 结果为 0。
- [x] `serve-dashboard.ts` 的 `state === "green"` 分支与 `sysGo` 为真分支均不再引用 `--color-accent-700`（grep 验证），改用新令牌。
- [x] `serve-sessions.ts` 的 `alive` 为真分支不再引用 `--color-accent-700`。
- [x] 新增测试文件 `packages/quay/test/gap-webui-accent-palette-no-success-color.test.mjs`：起一个真实 server（复用 `webui-modernist-sync.test.mjs` 的 `startServer` 方式），构造一组 fixture 让 `/dashboard` 渲染出 `state:"green"` 的一轮和一个 `sysGo:true` 场景，断言响应体里这两处样式引用的十六进制/变量名**不等于** `--color-accent-700` 对应值，且等于新令牌。
- [x] `scripts/test.sh` 全量绿（不引入新的失败）。

## Definition of Done

不是"新令牌定义存在"就算完成——**真实渲染的 `/dashboard` 页面对同一批数据，通过态色块与告警态色块必须是肉眼可分的两种色相**，用同一台正在运行的 web server 重新截图验证（不满足于 fixture/单测通过）：
1. 落地后，用 chrome-devtools/playwright MCP 重新访问本次会话验证过的 `/dashboard`，对"近5轮"色块与"⇒ GO"重新截图；
2. 新截图里通过态色块的可见色相与告警文字/普通链接的可见色相**目测可区分**（不再是同一红橙色系的深浅两级）；
3. 把新旧两张截图一并贴进落地提交/PR 描述做前后对照——这是本任务改的是"看得见的东西"，AC 全绿但没有一张新截图 ⇒ 不算完成（同 CLAUDE.md 硬规则 4 推论三：只在 fixture/单测里满足过的判据不算测量）。

## Touches

- docs/design/quay-webui-improved-2026-08-16/_ds/modernist-40217566-87fa-42b1-9cc0-36027903691f/styles.css
- packages/quay/src/webui-modernist.css
- packages/quay/src/serve-render.ts
- packages/quay/src/serve-dashboard.ts
- packages/quay/src/serve-sessions.ts
- packages/quay/test/gap-webui-accent-palette-no-success-color.test.mjs
- tasks/gap-webui-accent-palette-no-success-color.md
