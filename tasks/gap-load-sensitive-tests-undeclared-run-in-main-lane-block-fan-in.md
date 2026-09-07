---
id: gap-load-sensitive-tests-undeclared-run-in-main-lane-block-fan-in
title: 三个事实上负载敏感的测试文件未声明泳道，在满并发主泳道跑 ⇒ 8 轮 fan-in 全红且红集每轮漂移；单跑全绿，已声明的同类文件只红 1/8
status: todo
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
  acceptance: node --experimental-strip-types --test
    plugin/test/runner-grouping-metadata.test.mjs
---
## Finding

**结论**：近 8 轮 fan-in **全部**在 `suite-end` 变红、无一落地，而**没有一条是真回归**——红集每轮漂移，且最顽固的两条**单独跑全绿**。根因是三个事实上负载敏感的测试文件**没有声明安静泳道**，在满并发主泳道与其它一切争 CPU。

### 一、红集漂移（8 轮实测，全量非采样）

| 文件 | 8 轮中红 | 当前 `@test-group` | 泳道 |
|---|---|---|---|
| `plugin/test/worker-driver-resident.test.mjs` | **6** | `engine` | 主泳道 |
| `packages/quay/test/observation.test.mjs` | **4** | `product` | 主泳道 |
| `packages/quay/test/ts-typecheck-gate-config-wiring.test.mjs` | **3** | `product` | 主泳道 |
| `packages/quay/test/ts-typecheck-gate-pass.test.mjs` | 2 | `product` | 主泳道 |
| `plugin/test/worker-driver-fan-in.test.mjs` | 1 | — | 主泳道 |
| `plugin/test/quay-init-loop-vendor-user-scope-stale.test.mjs` | 1 | **带 `@load-sensitive`** | 安静泳道 |

⊢ **唯一带标记的那条只红 1/8；未标记的三条红 3–6/8。** 这个不对称本身就是判据。

### 二、隔离对照——两条最顽固的单跑全绿（能取假，非推测）

```
$ node --experimental-strip-types --test plugin/test/worker-driver-resident.test.mjs
  ℹ tests 39   ℹ pass 39   ℹ fail 0   ℹ duration_ms 89573.6

$ node --experimental-strip-types --test --test-name-pattern='cold first request' packages/quay/test/observation.test.mjs
  ✔ AC1 — /tasks cold first request < 3s and warmed request < 500ms on a ≥1500-task/≥10000-commit fixture (74981ms)
  ℹ pass 1   ℹ fail 0
```

⇒ 同一份代码，套件内红、隔离绿。**若是真回归，隔离也应红**——这是能区分两个假设的对照。

失败的断言无一例外是**墙钟计时**：`/tasks cold <3s`（套件内实测 124.4s）、`npx tsc --noEmit` 60s 超时、resident loop 并发时序。

### 三、宿主基线永远不空（这是"负载敏感"的成因，不是偶发）

本机 16 核，而套件跑起来时 `loadavg` 实测 **26–42**。基线由常驻件构成，永不为零：`quay.ts serve`（实测 44.5% CPU、769MB，因每次渲染扫全部 1813 个任务文件——见 `gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks`）、promotion/worker/meta 三个 driver 及其子进程、数十个 claude 会话进程。

⇒ 套件按 `nproc` 规模并行，**却假设机器是空的**。这三个文件的计时断言正好落在这个假设上。

### 四、⛔ 为什么不能"再放宽一次阈值"——已经试过，且它的取假条件此刻成立

`tasks/gap-observation-ac1-perf-threshold-relax.md`（`status: done`，人 2026-09-01 裁定）已经把 `/tasks` 阈值从 `<1.5s/<200ms` 放宽到 `<3s/<500ms`。它当时明确列了**二选一**：「改 AC1 阈值断言 … **或**给 performance 测试加『负载豁免』（loadavg/cpu_stall 超限时跳过 perf 断言、只验正确性），二选一或组合」——**当时选了放宽**。

它的 AC3 逐字写着：

> AC3（能取假，负载稳定）：并发 fan-in + 真实负载下 observation.test.mjs 稳定绿（不再因负载波动误杀）；**⛔ 仍反复红 ⇒ 假**

**该取假条件此刻成立**（8 轮红 4 次）⇒ 放宽这条路已被实测证否，本条走另一条路（泳道/豁免）。
且人当时的裁定明确约束「⛔ 别放宽到连『没做优化』也能过」，⇒ 阈值已无下调空间。

**⊢ 这同时是 `GOAL-007`（done 任务判据后来变假、无机制重新评估）的第 5 个实例**，请在实现时写回该 GOAL 的证据。

### 五、机制已存在，缺的只是把这三个文件登记进去

`scripts/test.sh` 已有四个泳道 `product | engine | serial | lowconc`（`serial` 并发 1、`lowconc` 并发 3），当前 `serial` 14 个成员、`lowconc` 9 个成员。降级由 `plugin/scripts/test-group-downgrade-check.ts` 守：product|engine → serial|lowconc 属**降级**，**提交信息必须含字面量 `@test-group-downgrade` 及理由**，否则红（无基线文件要改，凭据就是提交信息）。

**方向倾向（供执行者判断，非强制）**：把三个文件改到**能让它们在代表性负载下稳定绿的最宽松泳道**（`lowconc` 优先于 `serial`——`serial` 并发 1 代价最大，⛔ 不要一律推到 serial），提交带 `@test-group-downgrade` 与理由。⛔ **不接受**：①再次放宽任何计时阈值（第四节已证否，且人 2026-09-01 的裁定禁止放宽到容纳任意负载）；②给这些断言加无条件 skip（那是删掉保证，不是隔离）；③只改一个文件（三个都在挡，红集漂移正说明是同一个类）。

## AC

- [ ] 三个文件（`worker-driver-resident` / `observation` / `ts-typecheck-gate-config-wiring`）的 `@test-group` 为 `serial` 或 `lowconc`，且由 `scripts/test.sh` 的分组读取路径确认它们**实际被路由到该泳道**（⛔ 读文件里的字符串不算——须由分组机制的输出证明，硬规则②按位置判定）。
- [ ] 降级凭据齐备：`node --experimental-strip-types plugin/scripts/test-group-downgrade-check.ts --root . --json` 退出码 0，且承载本次改动的提交信息含字面量 `@test-group-downgrade` 与一句理由。
- [ ] **能取假（隔离对照固定为回归）**：把任一文件改回 `product`/`engine` ⇒ 上一条的路由断言立即变红。
- [ ] **计时断言未被削弱**：断言 `observation.test.mjs` 的 `/tasks` 冷/热阈值仍为 `<3s` / `<500ms`（⛔ 未上调），且 `ts-typecheck` 的 60s 超时未上调；用一条命令读出这三个数值并比对。
- [ ] **效果由载体读数证明，非断言**：改动落地后开一个至少 5 轮 fan-in 的窗口，读 `.quay/fan-in-suite-*.log` 的 `__PERFILE__ ... passed=false`，这三个文件的出现次数为 **0**；⛔ 「应该会好」不算，须贴出 5 轮的逐轮读数。

## DoD

- [ ] 上述判据本轮实跑并贴出输出（⛔ 不是转述），能取假那条实跑确认会变红。
- [ ] **生产载体证据（非 fixture）**：效果读数来自真实的 `.quay/fan-in-suite-*.log`，⛔ 不得以单元测试通过冒充（硬规则④推论三）。
- [ ] 泳道选择给出理由：为什么是 `lowconc` 而不是 `serial`（或反之），附该文件在目标泳道下的实测耗时；⛔ 不接受「都放 serial 保险」而不给代价读数。
- [ ] ⛔ 未放宽任何计时阈值；⛔ 未给任何断言加无条件 skip；⛔ 未改动这三个文件的测试逻辑本身（本条只改泳道声明）。
- [ ] 把本条作为第 5 个实例写回 `GOAL-007` 的证据（`gap-observation-ac1-perf-threshold-relax` 的 AC3 取假条件此刻成立）。
- [ ] 与 `gap-process-budget-in-use-structurally-zero-never-throttles` 的关系写入任务体：那条修「套件并发不感知既有负载」，本条修「负载敏感文件未进安静泳道」；说明两者为何都需要（只做任一条都仍会红）。

## Touches

- `plugin/test/worker-driver-resident.test.mjs`
- `packages/quay/test/observation.test.mjs`
- `packages/quay/test/ts-typecheck-gate-config-wiring.test.mjs`
- `plugin/test/runner-grouping-metadata.test.mjs`
- `tasks/gap-load-sensitive-tests-undeclared-run-in-main-lane-block-fan-in.md`
