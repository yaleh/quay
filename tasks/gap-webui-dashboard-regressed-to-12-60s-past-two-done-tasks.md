---
id: gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks
title: /dashboard 渲染回涨到 12.8–60.5 秒,越过两条 done 任务的「≤5s 量级」取假对照;它同时是 AC-179
  判据翻转的成因,进而制造 66% 的 develop 提交与 3 小时内 13/14 次 ff 失败
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
    packages/quay/test/gap-dashboard-parallelize.test.mjs
---
## Finding

**结论**：活服务器 `/dashboard` 现在渲染要 **12.8–60.5 秒**，越过了两条 `done` 任务写明的取假对照；而它不只是一个 UI 慢的问题——它是当前**交付管线阻塞的直接成因**。

### 一、实测（活服务器，非 fixture）

对生产实例 `100.78.206.100:4173` 连测三次（`--max-time 120`，即不设人为帽）：

```
dashboard run1: t=60.453279s code=200 size=66449
dashboard run2: t=32.227021s code=200 size=66450
dashboard run3: t=12.818772s code=200 size=66448
```

对照同一进程的轻端点：`/health` **0.5s**（`time_connect=0.0005s`、`time_starttransfer=0.499s`、code 200）。⇒ 不是进程卡死、不是网络、不是绑定问题，是 `/dashboard` 这一条路径本身慢。

**已排除的替代解释（各配了对照，非推测）**：
- ⛔ 不是进程被 wedge：把该进程杀掉重启（新进程 RSS 129MB、状态 `S` 不空转），`/dashboard` **依旧** 12.8–60.5s。
- ⛔ 不是宿主整体不可用：同机另外三个 `quay.ts serve` 实例（127.0.0.1:8765 / :42999 / :43101）`/health` 均 code 200、2.4–4.5s。
- ⛔ 不是冷启动窗口：三次采样是同一进程连续测，且时间在**下降**（60→32→12.8，缓存回暖），最快的一次仍 12.8s。

### 二、越过了哪条取假对照（逐字，非转述）

`tasks/gap-webui-dashboard-manager-slow-parallelize.md`（`status: done`）的取假条款：

> **能取假（⊢ 对照）**：修复后活服务器 `/dashboard` / `/manager` 墙钟显著下降（目标：并行化后 **≤5s 量级**，ready-pool 若缓存再降）

当时的实测是 `/dashboard` **13.13s**，根因诊断为 `readManager` 串行跑机件脚本、其中 `ready-pool-check.ts --json` 单项 **9.10s**（`node --experimental-strip-types` 每次现编译无缓存）。

`tasks/gap-webui-dashboard-load-time-optimization.md`（`status: done`）标题即「manager 探针轻量化砍 pool 地板 + taskList 并行 + 任务摘要 30s TTL 缓存」。

⇒ 两条都 done，而现测最快 12.8s、最慢 60.5s——**比修复前那次 13.13s 还差**。⛔ 本条不预设「并行化被改回去了」，那是需要对照才能下的结论；**要求执行者先定位当前的耗时构成，再谈修法**（当年那次正是先拆出 9.10s 单项才修对的）。

### 三、下游代价——它不是一个只影响观感的缺陷

`goals/AC-179-web-card-and-cli.md` 的 criterion **刻意**读运行中的服务（其 origin 写明依据硬规则④推论三：grep 源码只证明「能产出」不证明「已产出」）：

```
curl -sf --max-time 10 "http://$a/dashboard" | grep -q 'id="goal-card"'
```

`--max-time 10` 打在一个 12.8–60.5s 的端点上 ⇒ **verdict 在 pass ⇄ fail 之间来回翻**。逐对 diff 相邻提交，只有这三行在变：

```
- at: …05:23:47Z   verdict: pass   reading: acceptance passed (exit 0)
+ at: …05:29:47Z   verdict: fail   reading: acceptance failed (exit 1)
+ at: …05:35:21Z   verdict: pass   reading: acceptance passed (exit 0)
```

每次翻转都是实质变更 ⇒ `commitGoalFileAfterWrite` 提交 ⇒ develop 前进。**近 90 分钟 develop 32 次提交，其中 21 次是 `goals: AC-179 写盘即提交`（66%）**，节奏约每 6.5 分钟一次，与 goal-driver 轮次同频。

而 worker 的机械 fan-in 在 `merge-develop` 与 `ff` 之间隔着若干分钟（typecheck / scoped-gate / suite）⇒ **ff 时 develop 已经前进,不再是快进**。近 3 小时步轨迹（`.quay/fan-in-step-trace.jsonl`）：**ff 共 14 次,失败 13 次,成功 1 次**；`worker-outcome.jsonl` 同窗口 23 条,`exited-not-landed` **21 条**。

**⚠️ 且这不是防活锁闸造成的**：新 runId 下 8 条 retry 记录的 attempt 全是 **1 或 2**，远未触及 `>= 3` 的闸 ⇒ 是 ff 本身每次都失败，不是被闸拦下。（ff 计数器闩锁是另一个真实缺陷，已立 `gap-ff-retry-counter-runid-no-longer-per-dispatch`，但**不是**本窗口的绑定约束——两者不要混为一谈。）

⊢ 一条 UI 端点的性能缺陷，经由「判据翻转 → git 提交 → develop churn」这条链，**使整个交付管线在 3 小时内只落地 1 条任务**。

### 四、与既有任务的关系（三条，都不重叠）

- `gap-goal-evidence-cache-should-not-enter-git`（**ready，未落地**）：修「evidence 不该进 git」这一段链路。它落地后，verdict 翻转不再产生提交 ⇒ 本条的下游代价消失，**但 `/dashboard` 仍然慢**。⇒ 两条都要。⚠️ 且它自己正被同一个洪水挡着落不了地（本轮已由停 goal-driver 临时解除）。
- `gap-ff-retry-counter-runid-no-longer-per-dispatch`（ready）：修重试预算被永久耗尽；与本条是**不同的**失败机制（见上段 attempt=1/2 的读数）。
- `gap-webui-dashboard-manager-slow-parallelize` / `gap-webui-dashboard-load-time-optimization`（均 done）：本条是它们的**回归/复发**，按本仓库先例新立而非重开（`gap-direct-to-develop-bypasses-fan-in-gates` 同款处理）。

**⇒ 本条同时是 `GOAL-007`（done 任务判据后来变假、无机制重新评估）的第 4 个实例**，且是在该 GOAL 立案后 1 小时内独立测出的——请在实现时把这一条写回 GOAL-007 的证据里。

**方向倾向（供执行者判断，非强制）**：先用一条命令拆出当前 `/dashboard` 的耗时构成（当年是 `readManager` 里 `ready-pool-check.ts --json` 9.10s 单项最大），再决定修法。⛔ **不接受**：①不测构成直接「再并行一次」；②把 AC-179 的 `--max-time 10` 调大来让判据变绿——那是掩盖一个真实的 60 秒页面（且判据当前是**诚实**的，它正确地报告了服务不可用）；③只加缓存使首屏变快而实际数据陈旧（须说明缓存 TTL 与陈旧度的取舍）。

## AC

- [ ] 活服务器实测：`/dashboard` 墙钟 **稳定 ≤5s**（沿用两条 done 任务写明的同一目标值，⛔ 不得放宽），至少连测 5 次且**每次**满足；给出全部 5 个读数，⛔ 不取最好的一次。
- [ ] 耗时构成被拆出来并可复核：给出当前各分项的实测耗时（形如当年的 `ready-pool-check.ts --json` 9.10s），⛔ 不是「已优化」的断言。
- [ ] 能取假：把定位到的主要耗时项恢复成修复前的形态 ⇒ `/dashboard` 墙钟立即回到 10s 以上（证明测的是真行为）。
- [ ] AC-179 判据随之稳定：以 `goals/AC-179-web-card-and-cli.md` 的 criterion 原样（`--max-time 10` **不改**）连跑 5 次，**5 次全 pass**；⛔ 不得通过修改该 criterion 来满足本条。
- [ ] 洪水消失，由载体读数证明：修复落地后开一个 ≥30 分钟窗口，`git log develop --since=... -- goals/` 的 AC-179 提交数**为 0**，且同窗口 goal-driver **在跑**（⛔ 不得靠停掉 goal-driver 制造这个零——那是本轮的止血，不是判据）。

## DoD

- [ ] 上述判据本轮实跑并贴出输出（⛔ 不是转述、⛔ 不是「应该会过」），能取假那条实跑确认会变红。
- [ ] **生产载体证据（非 fixture）**：读数来自活服务器与真实 `.quay/*.jsonl` 载体；⛔ 不得以单元测试通过冒充生产已验（硬规则④推论三）。
- [ ] `packages/quay/test/gap-dashboard-parallelize.test.mjs` 增一条钉住本次回归的用例，且该用例在改动前会红；说明它为什么当年没能拦住这次回归（⛔ 「加个测试」不够，要说清旧用例测的是什么、漏了什么）。
- [ ] ⛔ 未调大 AC-179 的 `--max-time`；⛔ 未改动该 criterion 的任何部分。
- [ ] 与上列三条任务的关系写入任务体，逐条说明为何不重叠；并把本条作为第 4 个实例写回 `GOAL-007` 的证据。

## Touches

- `packages/quay/src/serve-handlers.ts`
- `packages/quay/src/observation.ts`
- `packages/quay/test/gap-dashboard-parallelize.test.mjs`
- `tasks/gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks.md`
