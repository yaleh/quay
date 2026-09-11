---
id: gap-ac240-e2e-closure-same-run-pairing
title: AC-240 端到端闭环须由同一次运行自证：step⑤ e2e 成功后必须为同一 (host, project_root) 写出 AC-203
  存活记录，且运行级判据对「两批互不相交的见证」给出可区分取值
status: todo
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-240
---
## Proposal

**正本判据**：`goals/AC-240-端到端闭环必须由-同一次验证运行-自证-ac-203-的-driver-存活证据与-ac-207-的-driver-产出.md`（goal=GOAL-009，activatedAt 2026-09-11T03:28:27Z）——exit 0 仅当载体 `.quay/productization-verification.jsonl` 里存在**同一 (host, project_root)** 的一对记录：AC-203（`has_plugin_dir=false` ∧ `driver_alive=1` ∧ `carrier_records>0`）与 AC-207（`task_status=done` ∧ `gate_events>0` ∧ `produced_by_driver=true` ∧ `commit_sha`/`task_id` 非空）。exit 1 = 无（当前）；exit 3 = 载体缺失。⛔ 本任务不得修改该 criterion 以迁就实现。

**实测现状（2026-09-11 本机载体，python3 逐行读，⛔ 非抽查；60 行 total、29 行 GOAL-009）**：

```
root=quay-verify-coldstart-<x>-root            AC-203   AC-207
  32c0d047  (09-10T22:45Z)                        —        —
  af8c835a  (09-10T22:47Z)                        —        —
  63ee9681  (09-11T00:19Z)                        ✓        —
  64747948  (09-11T00:42Z)                        —        —
  a2a5aac0  (09-11T01:21Z, 03:07Z)                —       ✓✓
  b95bd6f1  (09-11T03:04Z)                        ✓        —
```

AC-203 的 root 集 = {63ee9681, b95bd6f1}；AC-207 的 root 集 = {a2a5aac0}；**交集 = ∅**。这正是 AC-240 origin 描述的形态，本任务复现该读数作为基线。

**机制位置（为什么两者分散在两次运行，以及为什么单次运行【能】同时产出——⛔ 非恒假判据）**：

- `plugin/scripts/verify-deliver-coldstart.sh:2337` `step4_driver_liveness "$ROOT"` 与 `:2349` `step5_e2e "$ROOT"` **在同一次运行里共用同一个 `$ROOT`**。
- `:1136 step4_driver_liveness`：`driver start --kind promotion` 之后**只轮询 ≤30s**（`seq 1 60` × `sleep 0.5`）等首轮 heartbeat；读到 `driver_alive=1 ∧ carrier_records>0` 才写 AC-203（`:1155-1170`），否则**什么都不写**——fail-closed 本身是对的，但此后**没有任何步骤再探一次**。
- `:579 step5_e2e`：轮询 `AC207_POLL_SECS`（默认 1800s，跨机传输传 3600s）直到 task done，然后写 AC-207 —— **写完从不再探 AC-203 的读数**。
- ⇒ **同一次运行里，真正驱动出 done 的那个项目（＝可得的最强「driver 真活」直接量）能写出一条 AC-207 记录，而同一 root 的 AC-203 记录永远缺席**，只因 step ④ 那 30 秒窗口（紧接 start 之后）错过了 promotion driver 的首轮落盘。`a2a5aac0` 就是这个形态。

**判定侧也没有这条要求**：`plugin/scripts/develop-deliver-tgz.sh:632` 的 `expected_acs` 是**按 ac 种类的集合差**（6 种，含 `GOAL-009-AC-203`，注释逐字写「AC-207 仅 --ac207-e2e 时预期，不在此列」）；全仓库**没有任何 (host, project_root) 配对判定**（实测 `grep -n 'SELF_EVIDENCED\|同一次运行\|pairing' plugin/scripts/verify-deliver-coldstart.sh plugin/scripts/develop-deliver-tgz.sh` = **0 命中**）。⇒ 「同一次运行自证」既没有被产出，也没有被判过——它只是**恰好**从没发生过的可能性。

**相关但机制不同的既有任务（均不覆盖本条，⛔ 不重复立案）**：`gap-third-party-evidence-no-transport-to-driving-repo-carrier`（done，回传层）、`gap-cross-host-evidence-run-incomplete-and-step-order-makes-ac234-unsatisfiable`（done，步骤顺序/flag/远端 stdout）、`gap-ac214-freshness-anchor-build-sha-missing-on-203-205-207`（done，新鲜度锚）。同文件还有两条在飞任务（`gap-ac207-commit-sha-points-at-bookkeeping-flip-not-implementation-commit` ready、`gap-aged-project-post-upgrade-driver-e2e` todo）——Touches 重叠由派发锁串行化，⛔ 不另立 depends_on 边（它们不改变「配对」这一性质）。

## Plan

1. **生成侧（同一次运行内成对产出）** —— 在 `plugin/scripts/verify-deliver-coldstart.sh` 的 `step5_e2e` 内，为**它自己的 `$root`** 探测 AC-203 的直接量并写记录：复用 `probe_ac203_driver_status` + `write_ac203_record`（⛔ 不新造第二个写入者、⛔ 不另写一份 `build_sha` 字面量），探测点放进 step ⑤ 已有的轮询路径（driver 起后至 task done 之间，首次读到 `driver_alive=1 ∧ carrier_records>0` 即写一次，每次运行至多一条）。
   - ⛔ **硬规则 4 约束**：`has_plugin_dir` / `driver_alive` / `carrier_records` 必须是**当场 probe 出来的值**，⛔ 不得沿用 `step4` 那种字面量 `"0" "1"`——字面量会让该记录与「恒真量」同形。
   - 该记录是**同一次运行对同一项目 status 载体的直接读**，驱动方正是本次运行自己启的 driver ⇒ 不是注入数据（硬规则 4 推论三：判据读生产载体）。
   - fail-closed 语义不变：读数不满足 ⇒ 不写。
2. **判定侧（运行级「同一次运行自证」取值）** —— 引入 `E2E_CLOSURE_SELF_EVIDENCED`，由**本次运行自己写的记录**算出（两个写入点各置一个 `*_WRITTEN_THIS_RUN` flag）：
   - `1` = AC-203 与 AC-207 均在本次运行内、同一 `project_root` 写出；
   - `0` = 写了 AC-207 而本次运行没有写出 AC-203 ⇒ 打印明说「闭环不由本次运行自证」的 NOTE；
   - `not-evaluated` = 本次运行未尝试 e2e（未传 `--ac207-e2e`）⇒ ⛔ 不得与 0/1 同形（硬规则 3b：词表里没有「未评估」这一态的判据，分不清「查过且合格」与「没查成」）。
   三个读数在最终 summary 块一并打印。
3. **传输侧同判（anti-regression）** —— `plugin/scripts/develop-deliver-tgz.sh` 的 `verify_coldstart_mode` 在 `--ac207-e2e` 下，除 `expected_acs` 的集合差外再判一次**配对**：回传 evidence 里同一 `host` 上 AC-203 与 AC-207 是否共享同一 `project_root`；缺 ⇒ 该 host 记 PARTIAL 并打印可区分取值（`E2E_PAIR_MISSING=1`），⛔ 不静默按 ok 退出（硬规则 3b）。
4. **测试钉死两方向** —— `plugin/test/verify-deliver-coldstart.test.mjs`（必要时加 `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`）：① 两记录同 run 同 root ⇒ `E2E_CLOSURE_SELF_EVIDENCED=1`；② 仅 AC-207 ⇒ `=0` 且 NOTE 非空；③ 未尝试 e2e ⇒ `not-evaluated`；④ 传输侧：只含 AC-207 的 evidence ⇒ `E2E_PAIR_MISSING=1`。⛔ 负控制必须能让判据取假，⛔ 不是「跑一次看它绿」。
5. **真实证据（跨机；硬规则 4 推论三）** —— 跑一次 `bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --hosts B --ac207-e2e`（回传层已 done），使本仓库载体出现**同一 (host, project_root) 的一对**记录，再干跑 AC-240 criterion 确认 exit 0。⛔ 手工注入/夹具数据不算。

## Acceptance Criteria

- [ ] AC1 生成侧落地（能取假）：`grep -n 'write_ac203_record\|probe_ac203_driver_status' plugin/scripts/verify-deliver-coldstart.sh` 的命中里**至少一处落在 `step5_e2e` 函数体内**（贴命中行 + 所在函数名 + 行号区间）；改前该函数体内命中数 = **0**（贴改前读数）。且该调用传的是**当场 probe 出的** driver_alive / carrier_records（贴调用行，指出两个入参的来源变量名），⛔ 不得是字面量 `"0" "1"`。
- [ ] AC2 运行级取值可区分（能取假）：最终 summary 打印 `E2E_CLOSURE_SELF_EVIDENCED=1|0|not-evaluated`；贴出三条控制的实际输出行：(a) 两记录同 run 同 root ⇒ `1`；(b) 仅 AC-207 ⇒ `0` 且 NOTE 非空；(c) 未传 `--ac207-e2e` ⇒ `not-evaluated`。三态必须可区分（硬规则 3b）。
- [ ] AC3 传输侧同判（能取假）：`develop-deliver-tgz.sh` 在 `--ac207-e2e` 下对回传 evidence 做 `(host, project_root)` 配对判定；贴一次正控制（成对 ⇒ 无 PARTIAL 标记）与一次负控制（喂一份只含 AC-207 的 evidence 文件 ⇒ `E2E_PAIR_MISSING=1` 且该 host 记 PARTIAL）的实际输出。⛔ 负控制改的是**判定输入文件**，不是往生产载体写记录。
- [ ] AC4 生产载体成对（硬规则 4 推论三——判据读生产载体，⛔ fixture 不算）：本仓库 `.quay/productization-verification.jsonl` 中存在同一 `(host, project_root)` 的 `GOAL-009-AC-203` 与 `GOAL-009-AC-207` 记录，且由**机件回传**（非手工搬运）。贴 `python3` 判定输出 + 两条记录全文 + 该 host/project_root 非本机、不在本仓库下的核实命令与输出。
- [ ] AC5 正本判据转绿：`goals/AC-240-*.md` 的 criterion **原样**干跑 exit 0（贴命令与退出码）。⛔ 不得为了让实现通过而修改该 criterion 或放宽其字段。
- [ ] AC6 不回归：`scripts/test.sh --for-task gap-ac240-e2e-closure-same-run-pairing` scoped 门绿，且全量 `scripts/test.sh` 绿（贴两次读数）。

## Definition of Done

本仓库 `.quay/productization-verification.jsonl` 里存在由**一次**跨机运行产出的一对 `GOAL-009-AC-203` / `GOAL-009-AC-207` 记录（同 `host`、同 `project_root`），且 AC-240 criterion 干跑 exit 0；同时运行级取值在「只写了 AC-207」时给出与「成对」**不同形**的输出（负控制实测贴出）。⛔ 手工注入或夹具数据不算——判据读的必须是一次真实跨机运行留下的生产记录。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/scripts/develop-deliver-tgz.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- plugin/test/develop-deliver-tgz-evidence-transport.test.mjs
- tasks/gap-ac240-e2e-closure-same-run-pairing.md


## 补注（manager，2026-09-11，仅澄清一处措辞，不改范围）

Plan 步骤 1 写「⛔ 不得沿用 step4 那种字面量 "0" "1"」——作为**新写入点的指引**完全正确，请照做（新代码必须当场 probe）。

但**不要据此去改 step4 本身**：我按位置核过它的调用点，literals 只在实测值等于它们时才可达——

    if [ "$AC203_EVALUATED" = "1" ] && [ "$AC203_DRIVER_ALIVE" = "1" ] \
       && [ "$AC203_CARRIER_RECORDS" -gt 0 ] && [ "$AC203_HAS_PLUGIN_DIR" = "0" ]; then
        write_ac203_record "$TS" "$AC203_HOST" "$AC203_PROJECT_ROOT" "0" "1" "$AC203_CARRIER_RECORDS" "$AC89"

且 write_ac203_record 自身还有 fail-closed 守卫（`[ "$has_plugin_dir" = "0" ] || return 1`）。⇒ step4 写出的记录内容是**实测门控后的序列化**，不是恒真量；它不在本任务范围内，改它会白费工夫且触碰一个正被其它任务竞争的文件。