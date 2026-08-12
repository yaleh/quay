---
id: gap-serve-pid-derived-port-collision-family
title: serve 家族 PID 派生端口重叠 → 确定性碰撞（表现负载敏感 flake）
status: done
labels:
  - gap
  - defect
  - product
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（manager 2026-08-12 源码级分析）**：round 29（fa1a679d）红在 `serve.test.mjs` + `serve-adversarial-eval.test.mjs`（round 28 两条都过）——不是 load/flake vs 结构性缺陷的二分，**两者同一件事**。

13 个测试文件用 `port = <base> + (process.pid % <range>)` 派生端口避免碰撞，但区间重叠：

| 文件:行 | 表达式 | 区间 |
|---|---|---|
| serve.test.mjs:145 | 41730 + pid%1000 | [41730,42729] |
| serve-adversarial-eval:111 | 41720 + pid%500 | [41720,42219] |
| serve-adversarial-eval:181 | 41740 + pid%500 | [41740,42239] |
| …另 10 处（41830×3 复用） | | |

**碰撞由 pid 分配决定（确定性）**：两个进程 pid 落在互映射位置就撞。负载越高 ⇒ 派生越多 ⇒ pid 循环越快 ⇒ 撞的概率越大 ⇒ **表现"负载敏感 flake"，根因结构**。隔离重跑通过**不构成** flake 证据（隔离时 pid 空间不拥挤）。

**修法**：`port: 0`（内核分配临时端口，无碰撞可能，构造性消除）+ 从 server `listening` 事件读回实际端口。顺带修根因报告的另两条：`startServer` 不 await `'listening'`、无 `'error'` handler。

**约束**：产品 CLI 的显式 `--port <n>` 行为保留（用户指定端口仍生效）——修的是**测试/内部 spawn 的 PID 派生端口**（13 处全在 test 文件），非 CLI 契约。

**验证锚**：(a) 13 处 PID 派生端口全替换为 port:0 + 读回；(b) 显式 --port 行为不变（既有 CLI 测试仍绿）；(c) 受影响的 serve 测试隔离跑无重构回归；(d) 全量套件绿（round-30 验证——端口碰撞由构造消除，无需重跑证明）。

## Plan

1. 读 serve startServer 帮手 + 13 个测试文件，确认 spawn 方式（子进程/进程内）与 listening 事件暴露面。
2. port:0 + 读回实际端口（必要时 startServer 输出/事件暴露 bound port）。
3. 修 startServer 不 await listening + 补 error handler。
4. 隔离跑受影响 serve 测试（无重构回归）。
5. 提交（不合并）。全量验证留给外层 round 30。

## AC

- [x] AC1: 13 处 PID 派生端口全替换为 port:0 + 实际端口读回（无残留 pid% 派生）
- [x] AC2: 产品 CLI 显式 `--port <n>` 行为不变（cli.test.mjs "becomes reachable on the exact port" PASS + free-port probe）
- [x] AC3: startServer await `'listening'` + `'error'` handler 落地
- [x] AC4: 受影响 serve 测试隔离跑无重构回归
- [ ] AC5: 全量套件绿（外层 round-32 验证——端口碰撞构造性消除）

## Evidence（port-fix subagent 2026-08-12, commit c573ec1f, merge e94998ee）

**AC1**：12 个 in-process 站点全 `port: 0` + `await startServer()` 后 `server.address().port` 读回（serve-adversarial ×2/core-three-way/serve-github/serve-browser-render/unparseable ×2/serve-goal-doc/web-ui-browser/serve.test/serve-adr/serve-list-realtime）；serve.test.mjs 的 18 个下游 `port+N` 块各转独立 `port: 0`+读回；cli.test.mjs 用 free-port probe（显式端口契约保留）。`grep -rn "pid % " packages/quay/test/ packages/quay/src/` 清零。

**AC2**：CLI 路径（bin/quay.ts cmd===serve）仍逐字绑定显式 --port。`cli.test.mjs` "becomes reachable on the exact port passed on the command line" PASS（spawn 真子进程）+ "renders the seeded task in its GET / body" PASS。

**AC3**：startServer 现 await 'listening' resolve / 'error' reject（调用方可读 address().port）；持久 'error' handler（原缺 → EADDRINUSE 崩进程）；`listening on http://host:port` 打实际绑定端口（port:0 打真临时端口）。

**AC4**：隔离跑全绿（load~9.6 下）：serve.test/serve-adversarial/serve-github/serve-adr/core-three-way/serve-browser-render/unparseable/serve-goal-doc/serve-list-realtime/web-ui-browser/cli.test/provider-env-symmetry/serve-handlers/serve-board/live-state/serve-action-delivery。**修 1 处引入回归**：startServer 改 await listening 后 provider-env-symmetry 重等 `once("listening")` 会挂——已移除冗余等待（注释说明）。其他代码若在 await startServer() 后再等 listening 会同样挂——已查无。

**invoke**：`bash scripts/test.sh --for-task gap-serve-pid-derived-port-collision-family`（待外层验证）。

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后 13 处替换清单 + 隔离跑结果贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay/src/serve.ts（startServer await listening + error handler + bound-port 暴露，若需要）
- packages/quay/test/serve.test.mjs、serve-adversarial-eval.test.mjs、serve-github.test.mjs、serve-adr.test.mjs、serve-goal-doc.test.mjs、serve-list-realtime.test.mjs、serve-browser-render.test.mjs、web-ui-browser.test.mjs、unparseable-frontmatter.test.mjs、core-three-way-symmetry.test.mjs、cli.test.mjs（13 处端口派生替换）
- tasks/gap-serve-pid-derived-port-collision-family.md（自身：勾 AC + 贴证据）
