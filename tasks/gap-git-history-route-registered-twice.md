---
id: gap-git-history-route-registered-twice
title: "/git-history 路由注册两次（serve-handlers.ts:2485/:2500），第二处结构上永远走不到（死代码）"
status: done
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`packages/quay/src/serve-handlers.ts:2485` 和 `:2500` 都有 `if (url.pathname === "/git-history")`——第二处结构上永远走不到（第一处已匹配并 return），是死代码。纯代码事实，不涉及设计取舍。

## Acceptance Criteria

- [x] AC1: 移除第二处死代码注册（:2500），保留一处。
- [x] AC2: 负控制——移除死代码后 `/git-history` 路由行为不变（仍正常渲染 SVG + HTML 页）。

## Definition of Done

- [x] `grep serve-handlers.ts 'url.pathname === "/git-history"'` 只剩 1 处命中。

## Touches

- packages/quay/src/serve-handlers.ts
- tasks/gap-git-history-route-registered-twice.md（自身：勾 AC + 贴证据）

## Evidence（内层实现 2026-08-18）

AC1/DoD 机械证据——`grep serve-handlers.ts 'url.pathname === "/git-history"'` 只剩 1 处命中（原 :2485 / :2500 两处 → 现 :2487 一处）：

```
$ grep -n 'url.pathname === "/git-history"' packages/quay/src/serve-handlers.ts
2487:  if (url.pathname === "/git-history") {
```

修法：删除第二处死代码 `if` 块（原 :2500），并把该块上方的 `gap-git-history-svg-server-rendered` 注释上移到保留的那一处（:2485→现 :2487），文档不丢。

AC2 负控制——`node --test packages/quay/test/serve-handlers.test.mjs` 全绿（7/7 pass），其中 `AC2/AC4: GET /git-history returns a server-rendered SVG page with zero <script> tags` 真实起服务打 `/git-history` 断言 200 + SVG + 零 `<script>`：

```
ℹ tests 7
ℹ pass 7
ℹ fail 0
ℹ duration_ms 2496.7
```

Scoped gate（`bash scripts/test.sh --for-task gap-git-history-route-registered-twice`）GATE_EXIT=0：

```
$ bash scripts/test.sh --for-task gap-git-history-route-registered-twice; echo "GATE_EXIT=$?"
GATE_EXIT=0
```

- 静态检查（change-relevant tier，全部通过）：`task-contract-check: no violations.`、`malformed-task-check`、`touches-one-entry-one-path-check`（`0 multi-path bullet(s)`）、`superseded-capability check: PASS`、`landing-target-check --gate ... PASS — 0 violations`。
- 测试选择：Touches 收窄后 `serve-handlers.ts` → `serve-handlers.test.mjs`（basename-pair），含 `AC2/AC4: GET /git-history returns a server-rendered SVG page` 集成测试（真实 git-init workspace 起服务）。
- 测试结果：`ℹ tests 85 | ℹ pass 85 | ℹ fail 0`（含 serve-handlers 7 条）。

