---
id: gap-full-suite-runner-test-waitExit-load-race
title: full-suite-runner.test.mjs waitExit 负载 race：child.once('exit') 在 child
  已退后挂监听 ⇒ exit 事件丢失 ⇒ promise 永挂（复发，负载诱发）
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

**来源**：2026-08-20 复发实证。`plugin/test/full-suite-runner.test.mjs` 的 `waitExit(child)` helper（line 190）：
```js
function waitExit(child) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}
```
**无超时、无提前挂监听保护**。极端负载（load 15-25）下，被测 runner 子进程可能在 `waitExit` 执行到 `child.once("exit")` 之前就已退出 ⇒ `exit` 事件不会触发（Node child_process 的事件在子进程退出后不再重放）⇒ promise 永不 resolve ⇒ 测试永久挂起。

**这不是偶发**，是结构性 race 被负载稳定诱发：

| 时刻 | 证据 |
|---|---|
| 2026-08-20 10:31Z | 第28条 fan-in scoped 门首挂：`full-suite-runner.test.mjs` #141（AC1 real two-runner race, line 3956）`waitExit(childB)` 永挂。node test 3666023 在 ep_poll 0% CPU 17min，log 停滞 |
| 2026-08-20 10:44Z | 第28条 scoped gate **第二次**挂同一签名：node test 3666023 ep_poll 0% CPU 17:40，log 自 10:44:51 停滞，唯一子进程 3666178 是 full-suite-runner.test.mjs runner 0% CPU |
| 历史 | manager-tick-log:12167 同测试「passed=false，runner 自己的测试文件挂了 4.7 分钟」；outer tick-log 10 次引用 full-suite-runner.test.mjs（多为负载/挂起/超时族） |

**为什么是缺陷不是环境**：测试本应 fail-fast（真失败）或 pass（真绿）。挂起伪装成「仍在跑」——与「读不懂伪装成通过」同价（硬规则 3b 的镜像：挂起伪装成慢）。重试不是修：load 高位重跑大概率再挂。且 fan-in scoped 门反复执行这个测试文件 ⇒ 每次负载窗口都撞。

**为什么修在测试侧**：`waitExit` 是测试 harness 的 helper，114 个 `await waitExit` 调用点。加超时/提前监听是测试自身修法（不改生产 full-suite-runner.ts）。生产侧无缺陷（第28条 delta 改生产 pre-suite registry kill 不改变 exit 语义，已核实）。

**备选（更彻底，需单独裁定）**：`--test-timeout=0` 在 runner 子进程上（见 3666178 的 `--test-timeout=0`）意味着测试子进程本身无超时护栏——是否应给 full-suite-runner.test.mjs 设合理 test-timeout。本任务先修 waitExit 超时；test-timeout 决策记录为观察项。

## Plan

1. 修 `waitExit(child)`：加超时兜底（如 `timeoutMs` 参数，默认合理值如 30s 或可配置），超时即 reject（或 resolve 带 `timedOut:true` + 打印 child pid/state 诊断）。**提前挂监听**：在 spawn 后立刻挂 `exit` 监听（race 的本质是挂监听太晚）——若可行，改 runRunner 让 waitExit 在 spawn 时即注册。
2. 处理 114 个调用点：若 helper 加默认超时不破坏现有语义，则调用点无需逐一改（默认参数覆盖）；若需逐点传参，只改实际等待长任务的（如 two-runner race 测试）。
3. 负控制：构造「child 在 waitExit 调用前已退出」的用例，验证修复后不永挂（resolve/reject 有界）。
4. 全量 suite 绿（含该文件自身 15/15）。

## Acceptance Criteria

- [ ] AC1: `waitExit(child)` 不再能无限挂起——有超时兜底（默认合理值），超时路径打印 child pid/exit-code/state 诊断。
- [ ] AC2: 负控制：模拟 child 在监听挂载前已退出的场景，修复后该用例有界返回（不永挂）。
- [ ] AC3: full-suite-runner.test.mjs 自身 15/15 绿（含 AC1 two-runner race 用例）；修复不改变现有 114 个调用点的语义（默认参数覆盖）。
- [ ] AC4: 全量 suite 绿；fan-in scoped 门在该文件上不再出现「log 停滞 + ep_poll 0% CPU 永挂」签名。

## Definition of Done

- [ ] waitExit 有超时兜底且有界返回；负控制用例验证不永挂；全量 suite 绿；修复提交可 `git log` 追溯；挂起签名（ep_poll 0% + log 停滞）在后续 fan-in scoped 门不再复现 ≥2 轮。

## Touches

- plugin/test/full-suite-runner.test.mjs（waitExit helper + 负控制用例）
- tasks/gap-full-suite-runner-test-waitExit-load-race.md（自身）
