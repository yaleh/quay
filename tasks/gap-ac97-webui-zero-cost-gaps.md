---
id: gap-ac97-webui-zero-cost-gaps
title: "AC97: 三条零成本 Web UI 缺口先修（/board 导航链接 + /git-history 重启可见 + white-space 内联覆盖）"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**判据正本（直接引用，勿转述）**：`orchestration/manager-phase-goal.md` AC97。

**三条缺口（审计 P0，共同点=不需要写新功能）**：
```
① /board 没有任何页面链接到它（grep 实测：全文件只有路由自身，0 个 <a href="/board">）⇒ 加进导航
② /git-history 源码已完整实现，只是当前 demo 进程启动早于该功能落地 ⇒ 重启 quay serve 即可见
③ serve-handlers.ts:860 内联 style="white-space:normal" 覆盖 .label-nav-wrap 的 white-space:nowrap（设计意图和实现矛盾）
```

## Acceptance Criteria

- [x] AC1: `curl` demo 实例 `/git-history` 返回 200（现为 404）——重启 serve 进程后。
- [x] AC2: 任务列表页 HTML 中 `href="/board"` 命中 ≥1（现为 0）。
- [x] AC3: serve-handlers.ts:860 的 white-space 内联覆盖移除/修正，`.label-nav-wrap` nowrap 意图生效。

## Definition of Done

- [x] 三条零成本缺口全部修复并落地（/board 导航入口 + /git-history 重启可见 + white-space 覆盖修正），
      AC1-AC3 三条判据各自可机械核对（curl / grep），packages/quay/test/ 13 个既有 web 测试保持全绿。

## Touches

- packages/quay/src/serve-handlers.ts（white-space 覆盖 + 导航链接）
- packages/quay/test/（13 个既有 web 测试保持全绿）
- tasks/gap-ac97-webui-zero-cost-gaps.md（自身）

## Evidence

（实测 2026-08-16，工作树 gap-ac97-webui-zero-cost-gaps @ 5a33f518）

- **AC1（/git-history 200）**：源码实现 2026-08-12 已落地（7f7b7f3c / 001eb376 / 9ef7ec8e），
  运行中 demo 进程（pid 1229410，lstart **2026-08-15 13:10:21**，晚于功能落地）⇒
  `curl -s -o /dev/null -w "%{http_code}" http://100.78.206.100:4173/git-history` → **200**（重启后可见已成立）。
  另起本地新 serve（本工作树代码）验证同一判据：`curl …/git-history` → **200**（server-rendered SVG 页）。
- **AC2（任务列表页 href="/board" ≥1）**：`curl http://127.0.0.1:43997/ | grep -c 'href="/board"'` → **1**（改前 0）。
  导航行：`<p class="meta"><a href="/board">board</a> · <a href="/live">live</a> · …`。
- **AC3（white-space 内联覆盖移除）**：`curl http://127.0.0.1:43997/ | grep -c 'style="white-space:normal"'` → **0**（改前 1）；
  `<div class="label-nav-wrap">` 仍在（1），内联覆盖移除后 `.label-nav-wrap { white-space:nowrap }`（overflow-x:auto 滚动条）继承意图生效。
- **既有 web 测试全绿（exit 0，逐文件）**：serve-adr 4/4、serve-board 4/4、serve-goal-doc 8/8、
  serve-handlers 7/7、serve-list-realtime 4/4、serve-action-delivery ✔、serve-adversarial-eval ✔、
  serve-browser-render ✔、serve.test ✔、web-ui-browser 32 pass/1 skip、serve-github 1 skipped（设计上需 live GitHub）。
  复算：`bash scripts/test.sh --scoped <上述 11 个 test 文件>` 或逐个 `node --test packages/quay/test/<file>.test.mjs`。
