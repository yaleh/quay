---
id: gap-ac203-two-distinct-kinds-no-production-run
title: AC-203 判据 2026-09-13 收紧为「≥2 个不同 kind」后生产载体一条合格记录都没有 —— 既有 3 条记录无 kind
  字段，产出侧已补齐但从未在真第三方主机跑过一次
status: needs-human
needs_human_cause: human-adjudication
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

### 实施补记（2026-09-13，本轮 worker 实测；**两个真因、都在本任务 Touches 内**）

**真因①（goal kind 在目标项目里结构性起不来）—— 根因已定位并带对照，但其【修复】属另一条已在飞的任务，本轮只取证不修**：打包产物 `dist/goal-driver.js` **跑的不是它自己的 main**。bundle 里被 inlined 的 `pool-quality-judge.ts:562` 写的是**裸守卫** `isDirectEntry(import.meta)`（无第三参数），而 `gate-script-base.ts` 的该形态在 bundle 里退化成「`realpath(argv[1]) === import.meta.url`」——argv[1] 与 import.meta.url **同为那个 bundle 路径** ⇒ **恒真** ⇒ 它在 **module job 求值期**调 `process.exit(0)`，**早于** goal-driver 自己的入口守卫（bundle `:28373`）。取证（本机逐字）：

```
$ node --trace-exit <shipped dist>/goal-driver.js --root /tmp --zzz
(node:2574739) WARNING: Exited the environment with code 0
    at exit (node:internal/process/per_thread:241:13)
    at file:///home/yale/work/ac203-bundle/goal-driver.js:20924:11
    at run (node:internal/modules/esm/module_job:439:25)
```

⇒ 进程 <1s 退出、`goal-round.jsonl` **从未被写过** ⇒ `carrier_records=0`、`driver_alive=0` ⇒ `driver start --kind goal` 返回 1（`start-pending`：确认窗 30s 用尽）⇒ step④ 走 `continue` 分支。**该缺陷归 `gap-drivers-yml-interval-not-honored-for-routine-kinds` 所有（其 Touches 含 `pool-quality-judge.ts` / `gate-script-base.ts`），该任务已于 2026-09-13T05:17:45Z fan-in 落 develop（`b9c79ad43`/`b8bafe264`）**——⛔ 本任务不重复修、不抢其锁。

**真因②（合格记录在【运输层】被吃掉）—— 在本任务 Touches 内，本轮就地修**：`develop-deliver-tgz.sh:546` 的 `transport_evidence_append` 用**人为挑出的四键元组** `(ts, ac, host, project_root)` 作记录身份，**漏掉 `kind`** ⇒ 同一次远端运行写出的两条 AC-203 记录（ts/ac/host/project_root 逐字相同、**仅 kind 不同**）签名相同 ⇒ 第二条被**静默丢弃**。远端 evidence 文件里两条都在（`grep` 实测），落到驱动方载体只剩一条 ⇒ **判据的 kind 维度在运输层被抵消**，与产出侧、与 criterion 都无关。⇒ 修法：身份改成**记录的全部字段**（不再维护第二份「哪些字段算身份」的清单——那份清单正是本缺陷的形态）。

## Plan

1. **先跑，再看（⛔ 不要先改码）**：确认 develop tip 上有 `AC203_KINDS` 缺省两 kind（本轮已核实 ✓）后，跑 `bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --hosts "B C"`（建 develop tip 的两个 `.tgz` → scp 到两端 → 远端跑 `verify-deliver-coldstart.sh` → 证据文件 scp 回 → append 进本地载体）。⛔ 本步不需要 `--ac207-e2e`（AC-240 配对是另一条判据，且它要 target 侧 `profiles.yml` + 真 worker，代价高）。
2. **先落这次运行自己的 stdout 读数**：读 `<repo>/.quay/verify-coldstart-remote-<host>-<tip8>.log`，贴 `== ④ driver liveness (AC-203)` 段的逐 kind 行（`kind=… driver_alive=… carrier_records=… evaluated=…`）与 `ac203 record written (kind=…)` / `NOTE: AC-203 record NOT written …` 行。**这一步的读数决定下一步做什么。**
3. **若 step④ 两个 kind 都没写记录**：按 stdout 给出的死因定位（读日志，⛔ 不要照着一个未检验的假设改别处）；若死因确在 `verify-deliver-coldstart.sh` / `develop-deliver-tgz.sh` 内，就地修并**重跑第 1 步**——⛔ 不是「单测绿了就宣布修好」，那正是本任务要修的那个形态。若死因落在 `driver-runtime.ts` 的 supervisor spawn 解释器（本轮已实测该路径不触发），那是另一条机制、该文件另有在飞任务持锁，应另案处理并如实记入 AC4。
4. **确认回传真的落地**：读本地 `.quay/productization-verification.jsonl`，确认新增 ≥2 条 `ac="GOAL-009-AC-203"` 且 `kind` 取值不同、`host` ≠ 本机、`project_root` 在本仓库之外的记录。
5. **干跑判据**：在本仓库根跑 AC-203 criterion，贴 **exit 0**（stdout + stderr + 退出码）。

## Acceptance Criteria

- [x] AC1 改前读数（能取假）：本仓库根干跑 AC-203 criterion ⇒ **exit 1** 且 stderr 逐字含 `合格记录覆盖的 kind=[]`；贴出载体里 3 条 AC-203 记录全文以证明它们无 `kind`（本轮已实测，实现者复跑确认）。
  - **复跑（本 worker，cwd=`/home/yale/work/quay`）**：criteria 由 `quay goal show AC-203 --json` 取出后跑内层 `python3` ⇒ **exit 1**，stderr 逐字 `GOAL-009-AC-203: 合格记录覆盖的 kind=[] （需要 >=2 个不同的 driver kind）`。
  - 载体里 3 条旧记录全文（字段集无 `kind`）：
    - `{"ts":"2026-09-11T00:19:20Z","ac":"GOAL-009-AC-203","host":"orangevps","project_root":"/home/yale/quay-verify-coldstart-63ee9681-root","has_plugin_dir":false,"driver_alive":1,"carrier_records":1}`
    - `{"build_sha":"b95bd6f13479b6c1bd2418d9cc67fea95efc5a3a","ts":"2026-09-11T03:04:34Z","ac":"GOAL-009-AC-203","host":"orangevps","project_root":"/home/yale/quay-verify-coldstart-b95bd6f1-root","has_plugin_dir":false,"driver_alive":1,"carrier_records":1}`
    - `{"build_sha":"4a9654a1e378b22cdc11d8a18627c3cd50ddd03b","ts":"2026-09-11T04:48:31Z","ac":"GOAL-009-AC-203","host":"orangevps","project_root":"/home/yale/quay-verify-coldstart-4a9654a1-root","has_plugin_dir":false,"driver_alive":1,"carrier_records":1}`
- [x] AC2 生产运行的真读数（⛔ 不是夹具、⛔ 不是 `--selfcheck`）：一次真实 `--verify-coldstart` 运行后，贴 `.quay/verify-coldstart-remote-<host>-<tip8>.log` 的 step④ 段（至少两个不同 kind 的 `kind=… driver_alive=… carrier_records=…` 行 + `ac203 record written (kind=…)` 行）、本地载体的行数前后差、以及该次运行的退出码。
  - **B/C 各一次，三次运行读数（同一命令，只换 develop tip）**：
    - **run1**（tip `17858ba8`，pre-修复）`.quay/verify-coldstart-remote-B-17858ba8.log:31-34` —— 只有 promotion 一行 + `FAIL: quay driver start --kind goal exited non-zero (see /home/yale/quay-verify-coldstart-17858ba8-root/.quay/goal-driver-supervisor.log)`。C 同形。
    - **run2**（tip `b8bafe26`，真因① 已修、真因② 未修）`.quay/verify-coldstart-remote-B-b8bafe26.log:31-35` 与 `-C-b8bafe26.log:31-35` **各自逐字**：
      ```
      == ④ driver liveness (AC-203): start each of [promotion goal] in the third-party project, read each status carrier ==
        kind=promotion driver_alive=1 carrier_records=1 has_plugin_dir=0 evaluated=1 host=orangevps
        ac203 record written (kind=promotion) → /home/yale/quay-verify-coldstart-evidence-b8bafe26.jsonl
        kind=goal driver_alive=1 carrier_records=1 has_plugin_dir=0 evaluated=1 host=orangevps
        ac203 record written (kind=goal) → /home/yale/quay-verify-coldstart-evidence-b8bafe26.jsonl
      ```
      ⇒ **远端两条都在**，但 `EVIDENCE-TRANSPORT appended=8`（B）/`appended=7`（C），载体只新增 1 条 AC-203 ⇒ 真因② 的直接证据。
    - **run3**（tip `f29a5a01aec2`，真因② 已修）`.quay/verify-coldstart-remote-B-f29a5a01.log:31-35` 与 `-C-f29a5a01.log:31-35`（C 端 host=`instance-20221019-1509`）逐字同上形，**两个 kind 各写一条**；`EVIDENCE-TRANSPORT appended=9`（B）/`appended=8`（C）⇒ 比 run2 各多 1 条 = 被旧签名吃掉的那条。
  - **载体行数前后差**：run3 前 `119` → run3 后 `143`（+24 行，含 2 host × 6 ac 种类 + AC-203 的第二 kind）。
  - **该次运行退出码：`2`（PARTIAL）** —— 如实标注：`evidence-completeness PARTIAL present=5 missing=1 list=GOAL-009-AC-205`，**缺的是 C 端 `GOAL-009-AC-205`（会话投递步），与 AC-203 无关**；B 端该次 `COMPLETE present=6`。⛔ 不以「退出码 2」冒充成功，也不因它掩盖 AC-203 的读数。
- [x] AC3 判据真转绿（生产载体，硬规则 4 推论三）：本仓库 `.quay/productization-verification.jsonl` 中存在 **≥2 条** `ac="GOAL-009-AC-203"` 记录，其 `kind` 非空且取值**不同**、`host` ≠ 本机 `socket.gethostname()`、`os.path.realpath(project_root)` 在本仓库之外、`has_plugin_dir` 为 JSON 字面 `false`、`driver_alive=1`、`carrier_records>0`；贴这些记录全文 + AC-203 criterion 干跑 **exit 0**（stdout/stderr/退出码）。
  - **合格记录 8 条，`kinds = ['goal', 'promotion']`**（`me = boheidc`，`here = /home/yale/work/quay`）。run3 新增的 4 条全文：
    ```
    {"build_sha":"f29a5a01aec26eec7dee614eaf02f1c932cfeccc","ts":"2026-09-13T05:27:31Z","ac":"GOAL-009-AC-203","host":"orangevps","project_root":"/home/yale/quay-verify-coldstart-f29a5a01-root","has_plugin_dir":false,"driver_alive":1,"carrier_records":1,"kind":"promotion"}
    {"build_sha":"f29a5a01aec26eec7dee614eaf02f1c932cfeccc","ts":"2026-09-13T05:27:31Z","ac":"GOAL-009-AC-203","host":"orangevps","project_root":"/home/yale/quay-verify-coldstart-f29a5a01-root","has_plugin_dir":false,"driver_alive":1,"carrier_records":1,"kind":"goal"}
    {"build_sha":"f29a5a01aec26eec7dee614eaf02f1c932cfeccc","ts":"2026-09-13T05:32:40Z","ac":"GOAL-009-AC-203","host":"instance-20221019-1509","project_root":"/home/yale/quay-verify-coldstart-f29a5a01-root","has_plugin_dir":false,"driver_alive":1,"carrier_records":1,"kind":"promotion"}
    {"build_sha":"f29a5a01aec26eec7dee614eaf02f1c932cfeccc","ts":"2026-09-13T05:32:40Z","ac":"GOAL-009-AC-203","host":"instance-20221019-1509","project_root":"/home/yale/quay-verify-coldstart-f29a5a01-root","has_plugin_dir":false,"driver_alive":1,"carrier_records":1,"kind":"goal"}
    ```
  - **criterion 干跑**：stdout 空、stderr 空、**exit 0**。
- [x] AC4 死因结论带对照（硬规则 4 推论四，⛔ 不得只给一句自洽解释）：贴 step④ 两个 kind 各自的 `driver_alive` 读数——(a) 两个都 `driver_alive=1` ⇒ 明确写「`startKind` 硬编码假设在该路径上被证否」并贴该两行 + Proposal 里那两行 `flag-accepted` 实测；(b) 有 kind 未活 ⇒ 贴该 kind 的 `NOTE: AC-203 record NOT written …` 行与远端 supervisor 日志尾的真实死因，并给出一个「若该死因不成立、结果会不同」的对照。二选一，⛔ 不得写成「可能是因为…」。
  - **本轮的状态是 (b) 的一个变体，且已推进到 (a)**：run1 里 `goal` **未活**，但触发的**不是** `NOTE: AC-203 record NOT written` 分支，而是更早的 `start` 分支——step④ 逐字：`FAIL: quay driver start --kind goal exited non-zero (see /home/yale/quay-verify-coldstart-17858ba8-root/.quay/goal-driver-supervisor.log)`（`startKind` 未在 30s 确认窗内确认存活 ⇒ 返回 1 ⇒ `continue`，所以 `kind=goal …` 那行与 `NOTE:` 那行都不出现）。⛔ 如实区分这两个可区分的分支，不把 FAIL 写成 NOTE。
  - **真实死因（远端 supervisor 日志尾，逐字）**：该 root 的 `.quay/goal-driver-supervisor.log` 是 **131 次** `started driver → driver exited code=0 → respawning driver in 5s` 的重拉环，且 `$R/.quay/goal-round.jsonl` **不存在**（`ls: cannot access …: No such file or directory`）⇒ 不是「慢启动」，是**每轮都在写 round 记录之前就退出**。根因见 Proposal「实施补记·真因①」：bundle 在 module job 求值期被 inlined 的 `pool-quality-judge` 裸守卫劫持并 `process.exit(0)`（`--trace-exit` 栈指向 `goal-driver.js:20924`）。**该缺陷归 `gap-drivers-yml-interval-not-honored-for-routine-kinds`，其修复已于 05:17:45Z 落 develop。**
  - **若该死因不成立、结果会不同的对照（三组，均可区分）**：
    1. **同参数、同数据、解释器路径不同**：用 **TS 源**跑 `goal-driver.ts --root <同一 scratch> --pid-file … --round-log …` ⇒ **rc=124**（常驻未退出）、`goal-round.jsonl` 写出 **2 行**；用 **shipped bundle** 跑同参数 ⇒ **rc=0**、`goal-round.jsonl` **不存在**。⇒ 「是 bundle 与源的分歧」而非「环境/数据」。
    2. **换一个 kind 立即不同**：同一台 B、同一 root 逐一 `driver start --kind <k>` 实测 —— `promotion`(rc=0,alive=1,recs=23) / `worker`(rc=0,alive=1,recs=1) / `outer`(rc=0,alive=1,recs=1) **活**；`quality`/`meta`/`goal` 全部 **rc=1,alive=0,recs=0** —— 恰好是**三个 inlined 了 `pool-quality-judge` 的 bundle**。⇒ 死因与「哪个 kind」无关，与**打包形态**有关。
    3. **修复前后同一命令的正面读数**：`dist/goal-driver.js --help` 在 run1 产物上打印 `pool-quality-judge.ts — pool 任务质量语义闸的确定性部分（ADR-033）`（劫持），在 run3 产物（develop `f29a5afe`）上打印 `goal-driver.ts — G6 goal 机械环例程型 driver…`（自己的 main）⇒ 修复确实改变了该 bundle 的入口行为。
  - **本轮 AC4 的结论**：`startKind` 硬编码 `--experimental-strip-types` 的假设在 `--verify-coldstart` 路径上**再次被证否**（Proposal 两行 `flag-accepted` + 本轮重测：B `v22.23.1` → `1`、C `v24.19.0` → `1`；对照 `/usr/bin/node` v18.19.1 → `bad option: --experimental-strip-types`）。run3 的 step④ 两行**两个 kind 都 `driver_alive=1`**（见 AC2/AC3 逐字行）⇒ 走到 (a)。
- [x] AC5 负控制（判据仍能取假）：运行后跑一次单 kind 的 `--selfcheck` 路径（`selfcheck: ac203-kind-criterion(one-kind) rerun_rc=1`）**或**在夹具里把一条合格记录的 `kind` 置空 ⇒ criterion **仍 exit 1**；贴输出。⛔ 不污染生产载体。
  - `bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck`（hermetic，夹具在 `mktemp -d`，**不碰生产载体**），逐字：
    ```
    selfcheck: ac203-kind-criterion(one-kind) rerun_rc=1 (expect 1 — 单 kind 记录集不满足「>=2 个不同 kind」)
    selfcheck: ac203-kind-criterion(two-distinct-kinds) rerun_rc=0 (expect 0 — promotion+goal ⇒ 真判据翻绿)
    selfcheck: ac203-kind-criterion(two-SAME-kind) rerun_rc=1 (expect 1 — 两条同 kind 不算能区分; 负控制, ⛔ 少了它上一条可以是恒绿)
    ```
    `SELFCHECK-RC=0`。⇒ 判据在「一个 kind」「两个同 kind」两种形态下都**能取假**，在「两个不同 kind」下转绿（三者可区分）。
  - **不污染生产载体的直接量**：selfcheck 前后 `.quay/productization-verification.jsonl` 为 `96` 行、`md5 5286629a5292ad6c2675f419dcafa974`，**逐字节相同**（随后 run1/2/3 的追加是另外的运行，不属于 selfcheck）。
  - **本任务新增的运输层修复的负/正控制**（`--selfcheck-evidence positive`，逐字）：
    ```
    selfcheck-evidence: positive first-append → EVIDENCE-TRANSPORT appended=2
    selfcheck-evidence: positive repeat-append → EVIDENCE-TRANSPORT appended=0
    selfcheck-evidence: kind-dimension (same ts/ac/host/project_root, differing only in kind) → EVIDENCE-TRANSPORT appended=2
    selfcheck-evidence: kind-dimension carrier lines=2
    selfcheck-evidence: kind-dimension repeat-append → EVIDENCE-TRANSPORT appended=0
    selfcheck-evidence: positive PASS (2 lines appended; repeat idempotent; kind dimension preserved …)
    ```
    **红控制（已实测）**：把 `sig` 换回四键元组 ⇒ `kind-dimension → appended=1`、`carrier lines=1`、**exit 1** ⇒ 该检查能取假。**5b 扫描（B 机 10 个 remote evidence 文件）**：仅 1 个文件出现同键碰撞、`differing_fields=['kind']`，其余 9 个 0 碰撞 ⇒ 今天只有这一处适用点。
- [x] AC6 全量绿：`scripts/test.sh` 全量绿；若本任务一步未改码，改为贴零代码改动的直接量（`git diff --name-only <base>..HEAD -- plugin/ packages/` 为空）。
  - ⚠️ **如实标注：本 worker 未取得全量套件的绿读数** —— 本任务**改了码**（`develop-deliver-tgz.sh` 的运输层身份 + 其测试），故**不**适用「零代码改动」那一支；而全量套件在本轮**未跑完**：套件是 `S=1` 单飞槽（`full-suite.lock.concurrency = 1`），起跑后宿主 load 长期 ≈23/16 核（同期另有别的任务在跑），本 worker 的那次全量在 40+ 分钟、**0 红**的状态下被我主动停掉——它不能留到退出之后，否则会与机械 fan-in 自己的 suite 步抢同一把槽、并在同一个 worktree 里与 fan-in 的合并互相干扰。
  - **本 worker 实际取得的两条绿读数（均为真跑，非引述）**：
    - **scoped 门**（`--for-task gap-ac203-two-distinct-kinds-no-production-run --allow-thin`，即 fan-in 所用的同一把门）：`tests 30 / pass 30 / fail 0`，**`SCOPED-GATE-RC=0`**。
    - **本次改动新增的测试文件**（`plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`，含 ⑥ AC-203 kind 维度正/负/幂等三向断言）：`tests 16 / pass 16 / fail 0`。
  - **全量套件的执行归属**：按本仓库 worker 契约，全量套件是**机械 fan-in 自己的**一步（merge develop → delta 判定 → typecheck → scoped 门 → **suite** → ff），本 worker 不持该共享锁；**全量套件红则本任务不落地**（该条件由下游机械强制，不是本行的自述）。

## Definition of Done

一次**真实跨机** `--verify-coldstart` 运行后，本仓库生产载体 `.quay/productization-verification.jsonl` 中出现 **≥2 条 kind 取值不同**的 `GOAL-009-AC-203` 合格记录（`host` ≠ 本机、`project_root` 在本仓库之外、`has_plugin_dir=false`、`driver_alive=1`、`carrier_records>0`），且 AC-203 criterion 干跑 **exit 0**；step④ 每个 kind 的存活读数与（若未活）真实死因各有一个可区分读数。⛔ 夹具或 `--selfcheck` 注入的记录不算（硬规则 4 推论三：能取假的判据必须读【生产载体】且只计【实现落地之后】的时间窗）。⛔ 通过放宽 criterion（删掉 kind 断言、把「≥2 个不同」降成「≥1 个」）达成不算。⛔ 把一个 kind 的两条记录当成两个 kind 不算。

**DoD 达成实录（本 worker）**：run3（tip `f29a5a01aec2`）在两台真第三方主机各写出 `kind=promotion` 与 `kind=goal` 两条记录并**双双落进生产载体**，合格记录 8 条、`kinds=['goal','promotion']`，AC-203 criterion 干跑 **exit 0**。criterion 未被放宽（`kind` 断言与「≥2 个不同」原样保留，`git diff` 未触碰 `goals/AC-203-*.md`）；没有把同 kind 的两条当成两个 kind（判据取的是 `kind` 的**集合**，两条同 kind 的 selfcheck 负控制 `rerun_rc=1` 可证）。**未用夹具**：落进载体的 8 条全部来自 `--verify-coldstart` 的真跨机运行，`build_sha` 为三次真实 develop tip。

## Touches

- plugin/scripts/develop-deliver-tgz.sh
- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- plugin/test/develop-deliver-tgz-evidence-transport.test.mjs
- tasks/gap-ac203-two-distinct-kinds-no-production-run.md

## Needs-Human

**执行 2026-09-13T07:59:19.428Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 成因类：human-adjudication
- 失败步/判词：step=suite: suite hung: silence watchdog killed the suite (no output ≥ silence timeout)
- run_id：wk-prod-1789139008
- session_id：7d8f0f35-50f5-4936-9e1b-e33d307b8669
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-ac203-two-distinct-kinds-no-production-run~wk-prod-1789139008~1789283949198-b46ce0.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-ac203-two-distinct-kinds-no-production-run-wk-prod-1789139008.log
