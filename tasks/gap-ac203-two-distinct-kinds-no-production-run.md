---
id: gap-ac203-two-distinct-kinds-no-production-run
title: AC-203 判据 2026-09-13 收紧为「≥2 个不同 kind」后生产载体一条合格记录都没有 —— 既有 3 条记录无 kind
  字段，产出侧已补齐但从未在真第三方主机跑过一次
status: ready
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-203
---
## Proposal

**判据当前取假（本轮干跑，非引述）**：在本仓库根把 `quay goal show AC-203 --json` 的 criterion 里 `python3 - <<'P' … P` 之间的片段提出来用 `python3` 跑 ⇒ **exit 1**，stderr 逐字：

```
GOAL-009-AC-203: 合格记录覆盖的 kind=[] （需要 >=2 个不同的 driver kind）
```

**为什么上一次修复没兜住（硬规则 5b：缺陷是成簇的，只修被报出来的那一个）**：判据**被收紧过**。`gap-ac203-record-schema-has-no-kind-dimension`（2026-09-13，done）给 criterion 加了两条：① 合格记录必须带非空 `kind`（缺 kind 的记录**不计入**，⛔ 不是「当作合格」）；② 合格记录的 kind 取值**≥2 个不同**。而生产载体 `.quay/productization-verification.jsonl` 里的 AC-203 记录**全部是这次收紧【之前】**写的——本轮逐条读出，共 **3 条，3/3 无 `kind` 字段**：

```
{"ts":"2026-09-11T00:19:20Z","ac":"GOAL-009-AC-203","host":"orangevps","project_root":"/home/yale/quay-verify-coldstart-63ee9681-root","has_plugin_dir":false,"driver_alive":1,"carrier_records":1}
{"build_sha":"b95bd6f13479b6c1bd2418d9cc67fea95efc5a3a","ts":"2026-09-11T03:04:34Z","ac":"GOAL-009-AC-203","host":"orangevps","project_root":"/home/yale/quay-verify-coldstart-b95bd6f1-root","has_plugin_dir":false,"driver_alive":1,"carrier_records":1}
{"build_sha":"4a9654a1e378b22cdc11d8a18627c3cd50ddd03b","ts":"2026-09-11T04:48:31Z","ac":"GOAL-009-AC-203","host":"orangevps","project_root":"/home/yale/quay-verify-coldstart-4a9654a1-root","has_plugin_dir":false,"driver_alive":1,"carrier_records":1}
```

⇒ 全被 `if not k: continue` 过滤掉 ⇒ `kinds=[]` ⇒ exit 1。**这是如实的**：这三条的绿本来就只说明「**某一个**（未记录是哪个）kind 活过」，判据收紧正是为了让这件事可判。⛔ 不是判据坏了，⛔ 不放宽 criterion。

**而那条任务自己【明说】了它不负责让判据转绿。** 其 Evidence 的「⚠️ 边界如实」逐字：

> **生产载体** `.quay/productization-verification.jsonl` 的 3 条 AC-203 记录**仍是旧 schema（无 kind）** ⇒ 按新判据该 AC **今天不再是绿的** —— 这是如实的（那三条本来就不能区分 kind，它们的绿本来就只说明「某一个 kind 活过」）。产出侧已补齐：step④ 现在按 `AC203_KINDS`（缺省 `promotion goal`）逐个 `driver start` 并【按 kind 各写一条】⇒ **下一次 e2e 即产出「两个不同 kind」的记录集**。

⇒ 它把转绿挂在一个条件上：**下一次真实 e2e 运行**。

**而那次运行没有发生（直接量）**：载体里 `ac="GOAL-009-AC-203"` 记录的最新 `ts` = `2026-09-11T04:48:31Z`，**早于收紧日 2026-09-13 两天**。⇒ 硬规则 4 推论三的教科书形态：**实现了、`--selfcheck` 绿了、生产一次都没跑过 ⇒ 与【没实现】同形**（那条任务 AC1/AC2 的绿全部由 `--selfcheck` 注入的夹具记录满足，⛔ 两条都不是生产载体读数）。

<!-- dedup-ref -->
**相关但机制不同的既有任务（均 done，不构成重复）**：`gap-ac203-record-schema-has-no-kind-dimension`（把判据收紧 + 补齐产出侧，**明说不负责转绿**）、`gap-cross-host-evidence-run-incomplete-and-step-order-makes-ac234-unsatisfiable`（步骤顺序 + 远端 stdout 持久化）、`gap-third-party-evidence-no-transport-to-driving-repo-carrier`（回传机件本体）、`gap-driver-runtime-driver-path-anchored-at-project-root-not-dist`（driver 路径锚在 `opts.root`；**唯一一条顶层 `goal_ac: AC-203` 的既有任务，已 done**）。本任务要的是**一次生产运行的读数**，不是又一次机制修复。

**产出侧已就位，本轮核实于 develop（预期零代码改动）**：
- `plugin/scripts/verify-deliver-coldstart.sh:3497`：`AC203_KINDS="${AC203_KINDS:-promotion goal}"` —— 缺省即两个 kind；`:3513` `for k in $AC203_KINDS` 逐个 `driver start --kind` + 轮询 `driver status --json`（至多 30s）+ **按 kind 各写一条**（`:3531` `write_ac203_record … "$k"`）。
- 写入点 `write_ac203_record`（`:3384`）校验 kind 形状（非空 ∧ `^[a-z][a-z0-9-]*$`），并经 `ac_record_append` 统一补 top-level `build_sha`/`ts`（AC-214 新鲜度锚）。criterion / schema / writer 三侧同为 6 字段、两向差集为空（该任务的 `--ac-record-schema-report` 已证）。
- `step4_driver_liveness "$ROOT"`（`:6595`）在**主流程中无条件执行**，⛔ 不在任何 flag 后面 ⇒ 一次普通 `--verify-coldstart` 就会走它。
- 回传机件存在且跑通过：`develop-deliver-tgz.sh --verify-coldstart`（arg parser `:207` + 执行段），远端 stdout 已持久化到 `<repo>/.quay/verify-coldstart-remote-<host>-<tip8>.log`，「部分产出」与「全产出」在退出码上可区分（`:1780` PARTIAL / `:1787` OK）。
- 两台远端可达且 `hostname` ≠ 本机（本轮实测）：`B=orangevps.wan.hwang.men`（hostname `orangevps`）、`C=ad-arm1.wan.hwang.men`（hostname `instance-20221019-1509`）。⇒ criterion 的 `host != me`（me = 本机 `boheidc`）对两端都成立。

**已排除的一个疑似阻塞（本轮实测，带对照；硬规则 4 推论四）**：`plugin/scripts/driver-runtime.ts:1386` 的 `startKind` spawn supervisor 时硬编码 `--experimental-strip-types`，而 `kernelSelfPath()`（`:281`）在打包安装下是 dist 的 `.js` bundle；C 机裸 ssh 的 `/usr/bin/node` = v18.19.1 **拒收该 flag**（实测 `/usr/bin/node: bad option: --experimental-strip-types`）。**但本任务走的传输路径不经过那个解释器**：`develop-deliver-tgz.sh` 的 `verify_node_export_for`（`:1627`）把 `host_node[$hk]`（`:1521/:1523`）前置进远端 PATH，本轮对**那两个具体解释器**实测：
- B `$HOME/.nvm/versions/node/v22.23.1/bin/node` → `v22.23.1` ⇒ `flag-accepted`
- C `$HOME/.local/opt/node-current/bin/node` → `v24.19.0` ⇒ `flag-accepted`

⇒ **该假设在 `--verify-coldstart` 路径上被证否**（若为假则结果会不同的对照就是上面两行：换成 `/usr/bin/node` 立即 `bad option`）。⛔ 不因此认定运行必然成功——**判据仍是这次运行自己的 stdout**。该硬编码对「裸 `/usr/bin/node` 跑 CLI 的路径」仍是一个真实陷阱，属另一条机制，本任务只记录、不在此修（观察项，发生率 1）。

## Plan

1. **先跑，再看（⛔ 不要先改码）**：确认 develop tip 上有 `AC203_KINDS` 缺省两 kind（本轮已核实 ✓）后，跑 `bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --hosts "B C"`（建 develop tip 的两个 `.tgz` → scp 到两端 → 远端跑 `verify-deliver-coldstart.sh` → 证据文件 scp 回 → append 进本地载体）。⛔ 本步不需要 `--ac207-e2e`（AC-240 配对是另一条判据，且它要 target 侧 `profiles.yml` + 真 worker，代价高）。
2. **先落这次运行自己的 stdout 读数**：读 `<repo>/.quay/verify-coldstart-remote-<host>-<tip8>.log`，贴 `== ④ driver liveness (AC-203)` 段的逐 kind 行（`kind=… driver_alive=… carrier_records=… evaluated=…`）与 `ac203 record written (kind=…)` / `NOTE: AC-203 record NOT written …` 行。**这一步的读数决定下一步做什么。**
3. **若 step④ 两个 kind 都没写记录**：按 stdout 给出的死因定位（读日志，⛔ 不要照着一个未检验的假设改别处）；若死因确在 `verify-deliver-coldstart.sh` / `develop-deliver-tgz.sh` 内，就地修并**重跑第 1 步**——⛔ 不是「单测绿了就宣布修好」，那正是本任务要修的那个形态。若死因落在 `driver-runtime.ts` 的 supervisor spawn 解释器（本轮已实测该路径不触发），那是另一条机制、该文件另有在飞任务持锁，应另案处理并如实记入 AC4。
4. **确认回传真的落地**：读本地 `.quay/productization-verification.jsonl`，确认新增 ≥2 条 `ac="GOAL-009-AC-203"` 且 `kind` 取值不同、`host` ≠ 本机、`project_root` 在本仓库之外的记录。
5. **干跑判据**：在本仓库根跑 AC-203 criterion，贴 **exit 0**（stdout + stderr + 退出码）。

## Acceptance Criteria

- [ ] AC1 改前读数（能取假）：本仓库根干跑 AC-203 criterion ⇒ **exit 1** 且 stderr 逐字含 `合格记录覆盖的 kind=[]`；贴出载体里 3 条 AC-203 记录全文以证明它们无 `kind`（本轮已实测，实现者复跑确认）。
- [ ] AC2 生产运行的真读数（⛔ 不是夹具、⛔ 不是 `--selfcheck`）：一次真实 `--verify-coldstart` 运行后，贴 `.quay/verify-coldstart-remote-<host>-<tip8>.log` 的 step④ 段（至少两个不同 kind 的 `kind=… driver_alive=… carrier_records=…` 行 + `ac203 record written (kind=…)` 行）、本地载体的行数前后差、以及该次运行的退出码。
- [ ] AC3 判据真转绿（生产载体，硬规则 4 推论三）：本仓库 `.quay/productization-verification.jsonl` 中存在 **≥2 条** `ac="GOAL-009-AC-203"` 记录，其 `kind` 非空且取值**不同**、`host` ≠ 本机 `socket.gethostname()`、`os.path.realpath(project_root)` 在本仓库之外、`has_plugin_dir` 为 JSON 字面 `false`、`driver_alive=1`、`carrier_records>0`；贴这些记录全文 + AC-203 criterion 干跑 **exit 0**（stdout/stderr/退出码）。
- [ ] AC4 死因结论带对照（硬规则 4 推论四，⛔ 不得只给一句自洽解释）：贴 step④ 两个 kind 各自的 `driver_alive` 读数——(a) 两个都 `driver_alive=1` ⇒ 明确写「`startKind` 硬编码假设在该路径上被证否」并贴该两行 + Proposal 里那两行 `flag-accepted` 实测；(b) 有 kind 未活 ⇒ 贴该 kind 的 `NOTE: AC-203 record NOT written …` 行与远端 supervisor 日志尾的真实死因，并给出一个「若该死因不成立、结果会不同」的对照。二选一，⛔ 不得写成「可能是因为…」。
- [ ] AC5 负控制（判据仍能取假）：运行后跑一次单 kind 的 `--selfcheck` 路径（`selfcheck: ac203-kind-criterion(one-kind) rerun_rc=1`）**或**在夹具里把一条合格记录的 `kind` 置空 ⇒ criterion **仍 exit 1**；贴输出。⛔ 不污染生产载体。
- [ ] AC6 全量绿：`scripts/test.sh` 全量绿；若本任务一步未改码，改为贴零代码改动的直接量（`git diff --name-only <base>..HEAD -- plugin/ packages/` 为空）。

## Definition of Done

一次**真实跨机** `--verify-coldstart` 运行后，本仓库生产载体 `.quay/productization-verification.jsonl` 中出现 **≥2 条 kind 取值不同**的 `GOAL-009-AC-203` 合格记录（`host` ≠ 本机、`project_root` 在本仓库之外、`has_plugin_dir=false`、`driver_alive=1`、`carrier_records>0`），且 AC-203 criterion 干跑 **exit 0**；step④ 每个 kind 的存活读数与（若未活）真实死因各有一个可区分读数。⛔ 夹具或 `--selfcheck` 注入的记录不算（硬规则 4 推论三：能取假的判据必须读【生产载体】且只计【实现落地之后】的时间窗）。⛔ 通过放宽 criterion（删掉 kind 断言、把「≥2 个不同」降成「≥1 个」）达成不算。⛔ 把一个 kind 的两条记录当成两个 kind 不算。

## Touches

- plugin/scripts/develop-deliver-tgz.sh
- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-ac203-two-distinct-kinds-no-production-run.md
