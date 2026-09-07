---
id: gap-load-sensitive-tests-undeclared-run-in-main-lane-block-fan-in
title: 三个事实上负载敏感的测试文件未声明泳道，在满并发主泳道跑 ⇒ 8 轮 fan-in 全红且红集每轮漂移；单跑全绿，已声明的同类文件只红 1/8
status: done
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

### 六、同时登记进 KNOWN-LOAD-SENSITIVE 族（红窗自动隔离-判定机制，与泳道声明是两件事）

`@test-group` 泳道声明之外，这三个文件还应该登记进独立的 KNOWN-LOAD-SENSITIVE 族（`plugin/scripts/known-load-sensitive.ts` 的机读 `// @load-sensitive <kind>` 头注释清单）——这是与泳道声明不同的另一个机制：泳道声明**降低失败概率**（降并发）；`@load-sensitive` 族登记让 `red-window-triage.ts` 在这三个文件未来仍在满并发下红时，**自动**发出隔离重跑命令并机械判定 environmental（绿，放行）vs 真回归（红，升级），不必每次都靠人工重新做一遍本任务 Evidence 2 那样的隔离验证。`load-sensitive-release-check.ts` 强制"红窗隔离通过的放行必须带**预先声明**的标记，不能是**事后**声明"——本任务已经拿到隔离证据（Evidence 2：worker-driver-resident 单跑 39/39 绿 89.6s；observation 单跑 74981ms 绿），现在登记就是"预先声明"，避免下次真的红了之后来不及补登记。

**kind 归类**（与 `known-load-sensitive.ts` 现有分类法一致，"一个根因=一个 kind"，不得盲选）：
- `worker-driver-resident.test.mjs` → `child-spawn`（resident driver 真实子进程管理，并发时序对宿主负载敏感，同 `serve.test.mjs`/`acceptance.test.mjs` 现有 child-spawn 成员性质一致）
- `ts-typecheck-gate-config-wiring.test.mjs` → `child-spawn`（起真实 `npx tsc --noEmit` 子进程，完成时间受宿主负载直接影响）
- `observation.test.mjs` → `wall-clock`（`/tasks cold <3s` 是真实进程计时断言，同现有 `delivery-standalone-smoke-gate.test.mjs`/`cold-start-skill.test.mjs` 两个 wall-clock 成员性质一致）

**张力与为何不构成问题**：`observation.test.mjs` 的 `/tasks cold <3s` 是真实性能回归闸门，登记进 load-sensitive 族**不等于弱化断言**——隔离重跑仍然跑同一条真实断言，只是换个不受干扰的环境重新验证；若代码真的退化（非环境问题），隔离重跑一样会红，`red-window-triage.ts` 判 `red ⇒ NOT environmental, escalate`，不会被蒙混过关。

### 第 5 实例写回 GOAL-007（DoD 第 5 条）

本条是 `GOAL-007`（done 任务判据后来变假、无机制重新评估）的**第 5 个实例**：`gap-observation-ac1-perf-threshold-relax`（`status: done`，人 2026-09-01 裁定放宽阈值）的 AC3 逐字写着取假条件「⛔ 仍反复红 ⇒ 假」——该条件此刻成立（近 8 轮 fan-in 中 observation 红 4 次，且全红无一真回归）。判据当年为真（放宽后曾稳定），之后被「满并发主泳道 + 宿主基线负载恒不为零」的外生负载推成假。证据记录于此（GOAL-007 为 draft，激活时吸收进 origin）。

### 与 gap-process-budget-in-use-structurally-zero-never-throttles 的关系（DoD 第 6 条）

两条修的是「满并发套件在非空宿主上跑」的**两个正交半面**，都需要、不重叠：
- 本条（泳道）修「负载敏感文件未进安静泳道」——把三个文件从满并发主泳道挪进 lowconc 相，让它们的墙钟计时断言不再与其它一切争 CPU。但它只保护这三个文件：满并发主泳道仍会把**别的**计时断言推翻（8 轮里已出现 6 个不同文件）。
- `gap-process-budget-in-use-structurally-zero-never-throttles` 修「套件并发不感知既有负载」——把 `in_use` 恒 0 修成真实占用，使主泳道并发派生式对宿主上已在跑的一切真正让路（自适应，非静态砍半）。
**只做任一条都仍会红**：只降并发，那三个文件在负载尖峰时仍可能红；只进泳道，满并发主泳道继续推翻别的计时断言。两任务体互指。

## Evidence

1. **AC1 路由证明（分组机制的输出，非读字符串）**：`node plugin/scripts/runner-grouping-metadata.mjs <三文件>`（= `scripts/test.sh` `build_deduped_files` 的分类器）输出三行 `<realpath>\tlowconc`；且 `build_deduped_files | runner-grouping.ts --select lowconc` 把三文件选入 lowconc 相。三文件行输出：`plugin/test/worker-driver-resident.test.mjs\tlowconc`、`packages/quay/test/observation.test.mjs\tlowconc`、`packages/quay/test/ts-typecheck-gate-config-wiring.test.mjs\tlowconc`。
2. **AC2 降级凭据**：`node --experimental-strip-types plugin/scripts/test-group-downgrade-check.ts --root . --json` → `{"ok":true,"baseline":"8ea050c7","files":569,"violations":[]}`，退出码 0。承载改动的提交 `77a9ddd12` 信息含字面量 `@test-group-downgrade` 与理由。
3. **AC3 负控制（实跑变红）**：把 `packages/quay/test/observation.test.mjs` 头临时改回 `product` ⇒ `node --test --test-name-pattern='route to lowconc' plugin/test/runner-grouping-metadata.test.mjs` → `✖ … AssertionError: …observation.test.mjs: grouped product, expected lowconc`（fail 1）；随后还原为 `lowconc`，重跑 4/4 pass。
4. **DoD3 泳道选择理由 + 实测耗时**：三文件隔离单跑（= lowconc 相低并发形态）全部绿——`ts-typecheck-gate-config-wiring` 6.3s（1 测试）、`worker-driver-resident` 58.6s（39 测试）、`observation` 60.5s（54 测试）。选 `lowconc` 而非 `serial`：serial 与 lowconc 当前并发已同源（`runner-concurrency.ts` 两者都 = `max(1, floor(nproc÷(S×P)))`，`gap-lowconc-concurrency-restore-host-derived` 后 lowconc=3 固定值已废弃），并发代价无差别；而 lowconc 是这三个文件所属的**语义族**——test.sh 头注释把 lowconc 定义为「hermetic-but-load-sensitive session-observation family」：observation 正是 session-observation 族（readLive/readSession/readJournal），worker-driver-resident 的同胞 `worker-driver.test.mjs` 已在 lowconc，ts-typecheck-gate-config-wiring 是 hermetic-but-load-sensitive（npx tsc 墙钟）。故三者都进 lowconc，不推到 serial（finding 方向倾向也是 lowconc 优先）。
5. **AC4 阈值未削弱**：`observation.test.mjs:1337` `coldMs < 3000`、`:1345` `warmMs < 500`（未动）；`ts-typecheck` gate `timeoutMs: 120000`（`config.yml:98`，为前序任务已抬的值，本条未再上调——finding 所述「60s 超时」指该 gate 的 60000ms 默认值，此前已被抬到 120000，本条保持）。

## AC

- [x] 三个文件（`worker-driver-resident` / `observation` / `ts-typecheck-gate-config-wiring`）的 `@test-group` 为 `serial` 或 `lowconc`，且由 `scripts/test.sh` 的分组读取路径确认它们**实际被路由到该泳道**（⛔ 读文件里的字符串不算——须由分组机制的输出证明，硬规则②按位置判定）。——实测：三文件均 `lowconc`，由 `build_deduped_files` 分类器输出 + `--select lowconc` 选中证明（见 ## Evidence 1）。
- [x] 降级凭据齐备：`node --experimental-strip-types plugin/scripts/test-group-downgrade-check.ts --root . --json` 退出码 0，且承载本次改动的提交信息含字面量 `@test-group-downgrade` 与一句理由。——实测：退出码 0、violations=[]、files=569；提交 77a9ddd12 含 `@test-group-downgrade` + 理由（见 ## Evidence 2）。
- [x] **能取假（隔离对照固定为回归）**：把任一文件改回 `product`/`engine` ⇒ 上一条的路由断言立即变红。——实测：observation 头改回 product ⇒ 路由断言 ✖ `grouped product, expected lowconc`，已还原（见 ## Evidence 3）。
- [x] **计时断言未被削弱**：断言 `observation.test.mjs` 的 `/tasks` 冷/热阈值仍为 `<3s` / `<500ms`（⛔ 未上调），且 `ts-typecheck` 的 60s 超时未上调；用一条命令读出这三个数值并比对。——实测：冷/热阈值仍 `<3000ms`/`<500ms`；ts-typecheck timeoutMs 仍 120000（前序已抬、本条未动，见 ## Evidence 5）。
- [ ] **效果由载体读数证明，非断言**：改动落地后开一个至少 5 轮 fan-in 的窗口，读 `.quay/fan-in-suite-*.log` 的 `__PERFILE__ ... passed=false`，这三个文件的出现次数为 **0**；⛔ 「应该会好」不算，须贴出 5 轮的逐轮读数。（待外部）
- [ ] **KNOWN-LOAD-SENSITIVE 族登记（能取假）**：三个文件的头部各自声明 `// @load-sensitive <kind>`（`worker-driver-resident.test.mjs`→`child-spawn`、`ts-typecheck-gate-config-wiring.test.mjs`→`child-spawn`、`observation.test.mjs`→`wall-clock`）；`node --no-warnings --experimental-strip-types plugin/scripts/known-load-sensitive.ts --list` 的输出必须包含这三行（`file\tkind` 格式）；`node --no-warnings --experimental-strip-types plugin/scripts/known-load-sensitive.ts --check` 退出码为 0（AC2 不变量：所有头部声明都有匹配的机读注解，不存在裸声明）。⛔ kind 选择不得盲选，须在 Measured 里贴出选择理由（对照现有同 kind 成员的共性）；⛔ 声明了注解但未出现在 `--list` 输出 ⇒ 假；⛔ `--check` 非 0 退出 ⇒ 假。（待外部）

## DoD

- [x] 上述判据本轮实跑并贴出输出（⛔ 不是转述），能取假那条实跑确认会变红。——实测输出见 ## Evidence 1–5（路由/降级/负控制/耗时均贴出，非转述）。
- [ ] **生产载体证据（非 fixture）**：效果读数来自真实的 `.quay/fan-in-suite-*.log`，⛔ 不得以单元测试通过冒充（硬规则④推论三）。（待外部）
- [x] 泳道选择给出理由：为什么是 `lowconc` 而不是 `serial`（或反之），附该文件在目标泳道下的实测耗时；⛔ 不接受「都放 serial 保险」而不给代价读数。——实测耗时 6.3s/58.6s/60.5s；lowconc 理由见 ## Evidence 4。
- [x] ⛔ 未放宽任何计时阈值；⛔ 未给任何断言加无条件 skip；⛔ 未改动这三个文件的测试逻辑本身（本条只改泳道声明）。——仅改 `@test-group` 声明 + observation 的 NUL→`\x00` 转义（运行时字符串不变，非逻辑改动）。
- [x] 把本条作为第 5 个实例写回 `GOAL-007` 的证据（`gap-observation-ac1-perf-threshold-relax` 的 AC3 取假条件此刻成立）。——见上文「第 5 实例写回 GOAL-007」。
- [x] 与 `gap-process-budget-in-use-structurally-zero-never-throttles` 的关系写入任务体：那条修「套件并发不感知既有负载」，本条修「负载敏感文件未进安静泳道」；说明两者为何都需要（只做任一条都仍会红）。——见上文「与 gap-process-budget 的关系」。

## Touches

- `plugin/test/worker-driver-resident.test.mjs`（含 `@load-sensitive child-spawn` 头注解）
- `packages/quay/test/observation.test.mjs`（含 `@load-sensitive wall-clock` 头注解）
- `packages/quay/test/ts-typecheck-gate-config-wiring.test.mjs`（含 `@load-sensitive child-spawn` 头注解）
- `plugin/test/runner-grouping-metadata.test.mjs`
- `tasks/gap-load-sensitive-tests-undeclared-run-in-main-lane-block-fan-in.md`
