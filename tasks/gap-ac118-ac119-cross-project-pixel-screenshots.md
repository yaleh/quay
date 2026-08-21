---
id: gap-ac118-ac119-cross-project-pixel-screenshots
title: AC118/119 跨项目像素截图补验证（B 机 meta-cc quay serve + headless chrome 截图，同次满足跨项目+截图）
status: todo
labels:
  - gap
---

## Proposal

**来源**：人 2026-08-21 14:1xZ 原话「跨项目 + 截图要在同一次行动里都满足」，manager 转达执行（不要解释，实际做）。

**背景**：AC118（跨项目真实驱动，meta-cc B 机）与 AC119（跨项目真实 HTTP 内容断言，meta-cc B 机）均已 land 并写记录到 `.quay/productization-verification.jsonl`，但两者都**没有像素截图**——只有内容断言。T3（`gap-docs-t3-webui-doc-and-screenshots`，已 land 274bcccd）产出了 19 张真实像素截图，但是 **quay 自己的开发树**，不是第三方项目。因此「跨项目 + 截图」的组合没有任何一个验证同时满足两半。本次补做：在第三方项目（meta-cc）上 quay serve 指向该项目数据 + 实际截图，同一次行动中两半都满足。

**判据**（能取假，同 AC118/AC119 主机约束：**不得用 A**——亲代环境无法验证自己）：

1. **同一次行动**：在 B=orangevps（或 C=ad-arm1）上，`quay serve` 指向 meta-cc 项目的 `.quay/config.yml`，该行动内完成真实 HTTP 断言 + 像素截图（复用 AC96/AC100/T3 已有的 `google-chrome --headless=new` 流程）。
2. **跨项目真实**：meta-cc 是 quay 团队不定制的第三方项目（与 AC118/119 同一项目），serve 指向它的数据面，截图**必须**显示该项目自己的数据（任务板/路由页面内容），非空白页、非 quay 演示数据。
3. **像素截图证据**：≥3 张真实 PNG 截图（`google-chrome --headless=new --screenshot`），截图文件大小 > 0 且非空白（`file` 命令 + 像素非全同色可核）。
4. **记录**：写入 `.quay/productization-verification.jsonl`，`ac="AC118"` 追加一行（或 `ac="AC118-screenshot"`），含主机 / 项目名 / serve 端口 / 截图文件清单 / 各截图 sha256，ok=true。取假：无该记录或记录时刻早于本次验证。

**⛔ 前置依赖**：AC118/AC119 已 land（第三方项目数据面就绪）。本任务无需新版本产物（用已发布的 quay-0.6.0 tgz 或 B 机现有安装）。

**为什么 inner 执行**：跨主机（B/C）验证 + 截图流程执行是 inner 域（AC107/AC118/AC119 均 inner 执行）。

## Plan

1. 在 B=orangevps（或 C=ad-arm1）上确认 meta-cc 项目 `.quay/config.yml` 存在且 serve 指向其数据面。
2. `quay serve`（指向 meta-cc 项目数据）启动，真实 HTTP 断言（非 curl 探活，取回页面内容断言关键元素）。
3. 用 `google-chrome --headless=new` 对 ≥3 条路由各截一图（复用 T3/AC96 流程），截图存主机留档。
4. 验证截图非空白（`file` + 像素检查）。
5. 写记录进 `.quay/productization-verification.jsonl`（主检出，ac=AC118 追加行，含截图清单）。

## AC

- [ ] AC1: 同一次行动中，B/C 上 `quay serve` 指向 meta-cc 项目数据面 + 真实 HTTP 内容断言（非 curl 探活）。
- [ ] AC2: ≥3 张真实像素 PNG 截图（headless chrome），截图显示 meta-cc 项目自己的数据（非 quay 演示/空白），`file` + 像素核验可查。
- [ ] AC3: 记录写入主检出 `.quay/productization-verification.jsonl`（ac=AC118 追加行，含 host/project/serve_port/截图清单/sha256，ok=true），时刻新于本任务立案。

## DoD

- [ ] 跨项目 + 截图两半在同一次行动中满足并有机械可核证据（截图文件 + jsonl 记录）；AC1-3 全勾。

## Touches

- .quay/productization-verification.jsonl（记录）
- 目标第三方项目 meta-cc 的数据面（该主机 B/C 上，非本仓库）
- tasks/gap-ac118-ac119-cross-project-pixel-screenshots.md（自身）
