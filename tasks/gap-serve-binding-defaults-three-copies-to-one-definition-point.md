---
id: gap-serve-binding-defaults-three-copies-to-one-definition-point
title: serve 绑定默认值有三个定义点（serve.ts host="0.0.0.0" / cli/server.ts
  hostFlag??"127.0.0.1" / start-drivers.ts DEFAULT_SERVE_HOST + 无条件 `--port
  0`），host 两值互相矛盾，且实测落在任何检测器范围外（两个最近类比 checker 均 PASS）⇒ 收成唯一解析点
  resolveServeBinding + 一份带 marker 的回退字面量 + `.quay/config.yml#serve` 期望态；人
  2026-09-30 裁定默认收敛到 0.0.0.0
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**症状**：同一个量（serve 的绑定默认值）在本仓库有**三个定义点**，且 host 的值互相矛盾。

| 入口 | host 默认 | port 默认 | 出处 |
|---|---|---|---|
| `quay serve` | `"0.0.0.0"` | `0`（内核分配） | `packages/quay/src/serve.ts:571`（默认参数 `{ port = 0, host = "0.0.0.0" }`） |
| `quay server start`（spawn 出的宿主） | `"127.0.0.1"` | 不给则**不传** `--port` ⇒ 落 `0` | `packages/quay/src/cli/server.ts:503`（`hostFlag ?? "127.0.0.1"`） |
| `start-drivers.ts` | `"0.0.0.0"` | `0`，且**无条件写进 cmdline** | `plugin/scripts/start-drivers.ts:91,97,615-616` + `:566`（`"--port", String(port)`） |

两条后果：

1. **同一句「起 web server」经不同入口监听面不同** —— `0.0.0.0` vs `127.0.0.1`。可达面取决于操作者恰好用了哪个入口。
2. **`start-drivers` spawn 出的宿主 cmdline 恒带 `--port 0`**。2026-09-23 16:14→21:54（5h40m）内立的 17 条 `gap-ac2XX-criterion-cmdline-port-literal-stale`（全部 done）的判据，正是**从 cmdline 的 `--port` 字面量派生地址** ⇒ 结构上恒假（实测读数形如 `addr=172.28.0.1:0`，curl 必失败），而机制本身为真。逐条重锚治了 17 个症状，**机制性根因在本文件这一行**。

**零检测覆盖（实测，非推断）**：
- `concurrency-literal-check` → PASS（0 违规；例外清单逐条带 `concurrency-default-fallback: <理由>`）。但其 `SCAN_ROOTS` 只含 `plugin/scripts`、`scripts`、`plugin/workflows`，**不含 `packages/quay/src`**；且只认标识符带并发关键词的位置 ⇒ 连 CLAUDE.md 自己点名的「超时秒数」族都不覆盖。
- `target-identity-literal-check` → PASS（391 kernel 文件 0 命中）。其谓词要求「**无** override 通道」，而这三处都有（默认参数 / `??`）⇒ 按该谓词它们**不是**违规。

⇒ 本形态落在**任何**检测器范围之外，且与「没有重复」同形（硬规则 3b 的镜像半边）。

**本仓库自己的原则与先例（⛔ 本任务不新造机制）**：
- `adr/ADR-036-枚举事实的单一真源与表层派生-实现-帮助-web-文档不得各存一份手抄副本.md`（accepted，enforcement = `enum-surface-parity-check.ts`）：同一事实只允许一处定义，其余表层派生、⛔ 不得手抄；规范 5 = 豁免须显式且带理由。
- `adr/ADR-004-hard-over-soft-load-bearing-rules-become-executable-checks.md`（accepted）：load-bearing 规则**必须**变成可执行检查；散文只能是 rationale + 指向检查的指针。
- 先例 `plugin/scripts/driver-config.ts`（头注释逐字）：并发 cap 此前有**三份「单一真相源」**，收成一份声明式 `drivers.yml` + `loadDriverConfig` + `driverCap` 单一加载点。
- 先例 `plugin/scripts/worktree-namespace-literal-check.ts`：一个字面量在引号内**至多 1 处**命中（= 声明点），其余非引号出现降为 advisory 不判红（实测输出：`PASS — 1 double-quoted "quay-worktrees", at …` + `advisory (unquoted, non-failing): 45`）。
- 前科（同形）：`plugin/scripts/registry-path-literal-check.ts` 的声明逐字 —— *Measured 2026-09-22: FIVE such copies, byte-identical to the declaration at the time — i.e. the claim had zero enforcement power.*　而 `packages/quay/src/serve.ts:501` 那句「the web port's default now belongs to **ONE place**」是同一句话。

**人的裁定（2026-09-30）**：默认值收敛到 **`0.0.0.0`**。`quay server start` 的 `127.0.0.1` 是**要修掉的偏差**；⛔ 不是反过来把 web 腿收紧到 loopback —— 那会打断 LAN/tailscale 可达（`gap-ac250-web-observe-tailscale-progress-record` 表明这是真实用法），属独立的行为变更，需另行裁定。

**诚实张力（硬规则 12）**：「人需要钉住一个端口却钉不住」这一侧**没有实测发生率**。本任务配置键的正当性不来自那里，而来自**已实测**的「三处矛盾 + 零覆盖」。若 P3 的生命周期改造代价失控，P1+P2 独立成立（它们消灭的是已实测的缺陷）。

## Plan

**P1 — 唯一定义点**。新增 `packages/quay/src/serve-binding.ts`：
- **leaf 纪律**（同 `plugin/scripts/code-span-strip.ts`）：⛔ 不 import 任何模块，只导出纯函数与常量 —— 不给 import 图添环（`import-graph-check` 的 `valueSccs` 基线为 0）。
- `export const SERVE_BINDING_FALLBACK = { host: "0.0.0.0", port: 0 }` —— 全仓**唯一**回退字面量，带标记注释 `serve-default-fallback: <理由>`（形态照抄 `concurrency-default-fallback`）。
- `export function resolveServeBinding({ cliHost?, cliPort?, config? }): ServeBindingRead` —— 优先级 **显式 CLI flag > `.quay/config.yml` 的 `serve:` 段 > 回退**。
- 返回**三分法**（硬规则 3b）：`{ kind:"resolved", host, port, source: "cli"|"config"|"fallback", detail }` / `{ kind:"not-evaluated", reason }`。坏值（`port` 非整数或 <0、`host` 非非空字符串）⇒ `not-evaluated` + **fail-closed**，⛔ 不静默回退（否则「配错了」与「没配」同形）。

**P2 — 三处 spawn 点只做转发，不再做决定**：
- `packages/quay/src/serve.ts`：默认参数 `{ port = 0, host = "0.0.0.0" }` 去掉默认；`startServer` 入口调 `resolveServeBinding`（`loadConfig()` 的 `config` 已在手，零新增管线）；`not-evaluated` ⇒ 拒绝启动并出声。
- `packages/quay/src/cli/server.ts:503`：`hostFlag ?? "127.0.0.1"` → `hostFlag`；未给则**不传** `--host`（`--port` 已只在给定时传）。
- `plugin/scripts/start-drivers.ts`：删 `DEFAULT_SERVE_HOST`/`DEFAULT_SERVE_PORT`；`parseArgs` 的 opts 种子改 `undefined`；`startServe` 只在用户显式给时传 `--host`/`--port`，**⛔ 删除无条件 `"--port", String(port)`**。该文件保持**零闭包依赖**（它不再做决定，只转发，故无需读 config）。

**P3 — 配置键与它的生命周期**。`.quay/config.yml` 新增可选顶层段：

```yaml
serve:            # 可选。缺席 ⇒ 用声明式回退（host 0.0.0.0 / port 0 = 不设约束）
  host: 0.0.0.0
  port: 0         # 0 = 不约束（硬规则 4 推论二：要表达「不限制」就在机制上不设限制）
```

该文件经 `.gitignore:483`（`/.quay/config.yml`）gitignored ⇒ 绑定天然是 **per-checkout** 的，同机多 workspace 各自不同号。三件事缺一即新键不可达：
1. `packages/quay/src/init.ts` 的 `generateConfigContent` 写入该段（种子值 = 回退值，⛔ 不是某个字面端口）；
2. `reconcileConfigContent` 覆盖它 —— 现存**只覆盖 `loop:` 段**；不扩则既有 workspace 永远拿不到新键，这正是 `init.ts:90` 逐字记录的那个缺陷形态（*"unreachable for every project that was initialized before it — forever"*）；
3. ⚠️ 先核 `plugin/scripts/config-key-consumer-check.ts` 的 writer face：其头注释声明提取面是 `plugin/scripts/quay-init.sh`，而该文件的 `ensure_loop_config` 已改为委托 `packages/quay/src/init.ts:ensureLoopConfig`（`quay-init.sh:418-424` 逐字 "one implementation, no second copy"）⇒ 提取面可能已陈旧；按核实结果决定「扩它」还是「让它改读 TS 真源」。

**P4 — 强制产物（必须与 P1–P3 同一变更内 —— ADR-004 / exp5 standing INVARIANT）**：
- 新检查器 `plugin/scripts/serve-binding-literal-check.ts`：`"0.0.0.0"`/`"127.0.0.1"` 在 `packages/quay/src/**` + `plugin/scripts/**` 的**引号内命中 ≤ 1**，且必须位于 `serve-binding.ts`；其余出现报 **advisory（不判红）** —— 形态照抄 `worktree-namespace-literal-check.ts`。按 `plugin/scripts/capability-catalog.sh` 头注释的形式登记进 `plugin/scripts/capability-catalog-declarations.json`，并在 `plugin/scripts/runner-static-gate.ts` 接线。
- `plugin/scripts/config-wiring-check.ts` 登记 `serve.host`/`serve.port`（读者 = `resolveServeBinding`）；其三态 `NO_READER` / `NOT_CONSUMED_BY_DRIVER` / `UNRESOLVABLE_VALUE` 现成可用。
- `packages/quay/src/cli/help.ts` 与 `plugin/skills/drivers/SKILL.md` 中 `--host`/`--port` 的默认值文本与真源一致。

**⚠️ 已知坑**：
- ⛔ **不新增 `plugin/scripts/*.sh`**：`sh-census-check` 实测 `embeddedInterpreterLines=7686 ≤ 7686` —— **零余量**，任何新增 .sh 内容都会被全额计费。
- `start-drivers.ts` 是零闭包依赖入口，⛔ 不 import Core src（正因如此它才只转发）。
- ⛔ **不得在有在飞 worker 时重起生产 serve**（既有纪律）；DoD 的活实例读数在临时真 workspace 上做。

## Acceptance Criteria

- [x] AC1（唯一定义点·按位置）`grep -n '"0\.0\.0\.0"\|"127\.0\.0\.1"' packages/quay/src/serve.ts packages/quay/src/cli/server.ts packages/quay/src/cli/serve.ts plugin/scripts/start-drivers.ts` 输出 **0 行**；同一条 grep 加上 `packages/quay/src/serve-binding.ts` 后**恰好 1 处**命中，且该命中在 `SERVE_BINDING_FALLBACK` 那一行。
- [x] AC2（负控·不是回声）把 `SERVE_BINDING_FALLBACK.host` 的值改掉 ⇒ `resolveServeBinding({}).host` 随之改变；改回 ⇒ 恢复。证明三处读到的是**同一个量**（硬规则 4：能取假才算测量）。
- [x] AC3（坏值 fail-closed·三分法）`resolveServeBinding({ config: { serve: { port: "abc" } } })` ⇒ `kind === "not-evaluated"`（⛔ 不是回退值、⛔ 不是抛栈），且 `startServer` 在该情形下**不产生任何 LISTEN 套接字**、进程非 0 退出。
- [x] AC4（机制性根因）`plugin/scripts/start-drivers.ts` 在用户**未**传 `--port` 时，spawn 出的宿主 `/proc/<pid>/cmdline` **不含 `--port`**；显式传 `--port <N>` 时含 `--port <N>`。这是那 17 条判据恒假的根因是否被消除的直接读数。
- [x] AC5（配置生效·读生产载体）临时真 workspace 的 `.quay/config.yml` 写 `serve: { host: "0.0.0.0", port: <N> }`（N 为 >1024 的空闲端口）后起宿主 ⇒ `.quay/server.json` 的 web 条目 `port === N`（**内核回读值 = 配置值**）；删掉 `serve:` 段重起 ⇒ `port !== N`。
- [x] AC6（人裁定的收敛值·直接量）三个入口（`quay serve` / `quay server start` / `start-drivers.ts`）在**未**显式给 `--host` 时，宿主监听套接字的本地地址均为 `0.0.0.0`（`ss -ltnp` 该 pid 行以 `0.0.0.0:` 开头），⛔ 不是 `127.0.0.1`。
- [x] AC7（产物取假）a) 新检查器：注入一个引号内 `"0.0.0.0"` 副本 ⇒ 判红；撤掉 ⇒ 判绿。b) `config-wiring-check`：把 `serve.host` 的读者注掉 ⇒ 报 `NO_READER`；恢复 ⇒ 绿。
- [x] AC8（隐藏面一致性）`packages/quay/src/cli/help.ts` 与 `plugin/skills/drivers/SKILL.md` 里 `--host` 默认值的文本与 `SERVE_BINDING_FALLBACK.host` 一致（grep 出两处文本 == 真源值）。

## DoD

在一个由 `quay init` 生成的真实 workspace（真六文件面、真 CLI、真监听、真 carrier）上完成**两次活实例操作**：① 写入 `serve: { host: "0.0.0.0", port: <N> }` 并起宿主 ⇒ `quay server status --json` 报的 web 条目 `host === "0.0.0.0"` ∧ `port === N`；② 删掉 `serve:` 段并重起 ⇒ 回到内核分配端口、host 仍 `0.0.0.0`。两次读数都取自**生产载体**（`.quay/server.json`）而非 fixture（硬规则 4 推论三：一个只能被 fixture 满足的判据不是测量）。⛔ 不得为此重起本仓库的生产 serve。

## Touches

- packages/quay/src/serve-binding.ts
- packages/quay/src/serve.ts
- packages/quay/src/cli/server.ts
- packages/quay/src/cli/help.ts
- packages/quay/src/init.ts
- plugin/scripts/start-drivers.ts
- plugin/scripts/config-wiring-check.ts
- plugin/scripts/config-key-consumer-check.ts
- plugin/scripts/serve-binding-literal-check.ts
- plugin/scripts/capability-catalog-declarations.json
- plugin/scripts/runner-static-gate.ts
- plugin/skills/drivers/SKILL.md
- plugin/test/serve-binding-literal-check.test.mjs
- plugin/test/start-drivers.test.mjs
- plugin/test/start-drivers-cli-resolution.test.mjs
- plugin/test/config-key-consumer-check.test.mjs
- packages/quay/test/serve-binding.test.mjs
- packages/quay/test/config.test.mjs
- tasks/gap-serve-binding-defaults-three-copies-to-one-definition-point.md
- packages/quay/src/cli/init.ts
- packages/quay/src/kernel/control-plane-http.ts
- packages/quay/src/mcp-server.ts
- packages/quay/src/serve-render.ts
- packages/quay/test/init.test.mjs
- plugin/scripts/checker-mutation-cases/serve-binding-literal-check.sh
