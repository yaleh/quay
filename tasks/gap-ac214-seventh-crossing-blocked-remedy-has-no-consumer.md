---
id: gap-ac214-seventh-crossing-blocked-remedy-has-no-consumer
title: AC-214 第七次转红（AC-238/239 = 228/200，margin −28；连续 762 fail 无
  pass）：「本机可执行的产出者=0」这个读数已在生产载体里，却全仓零消费者 —— 立案照旧产出可派发的 ready 任务
status: todo
labels:
  - gap
  - defect
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-214
---
## Finding

**判据此刻为假（本轮复跑，⛔ 非引述）**：用仓库自己的 YAML 解析器（`yaml@2.9.0`）从 `goals/AC-214-交付证据必须新鲜-….md` 的 `criterion: >-` 折叠块抽出判据逐字跑（cwd = 主检出 `/data/home/yale/work/quay`）⇒ **exit 1**。stdout 七行逐字：

```
freshness GOAL-009-AC-201: 180/200 (margin 20)
freshness GOAL-009-AC-232: 180/200 (margin 20)
freshness GOAL-009-AC-205: 180/200 (margin 20)
freshness GOAL-009-AC-207: 180/200 (margin 20)
freshness GOAL-009-AC-203: 180/200 (margin 20)
freshness GOAL-009-AC-238: 228/200 (margin -28)
freshness GOAL-009-AC-239: 228/200 (margin -28)
```

stderr 逐字：`stale evidence: GOAL-009-AC-238:228/200 (margin -28), GOAL-009-AC-239:228/200 (margin -28)`

⚠️ 抽取必须走真 YAML 解析器：折叠块里的续行（如 `⛔` 换行后的 `不手写路径清单。`）按 `>-` 语义折成同一行；手搓 `join("\n")` 会把它断成独立一行并让 python 报 `SyntaxError`（硬规则 2 的「取不出读数时先怀疑谓词」形态）。

**载体读数（每个主体最新一条记录，机械重算，⛔ 不采信任何自报值）**：

| 主体 | 最新记录 ts | build_sha | d/K |
|---|---|---|---|
| AC-201 / 203 / 207 / 232 | `2026-09-20T13:50:36Z` | `c80040ad49b335df44269ac07ea829d2a3511843` | 180/200 |
| AC-205 | `2026-09-20T13:23:10Z` | `c80040ad49b335df44269ac07ea829d2a3511843` | 180/200 |
| AC-238 / 239 | `2026-09-19T11:06:09Z` | `fa1cae202e02138a983f4118d108aa9fdd73917a` | 228/200 |

`.quay/productization-verification.jsonl` 共 **291** 行；`ts >= 2026-09-23` 的记录数 = **0**（末条 `2026-09-20T13:50:36Z`）。

**这是回归，不是恒红**（`.quay/gate-events.jsonl`，`item_id=AC-214`、`gate=goal`）：

- 最后一次 **pass** = `2026-09-24T02:46:28.774Z`（reason 逐字 `acceptance passed (exit 0)`）。
- 其后第一条 **fail** = `2026-09-24T02:48:24.110Z`，reason 逐字 `acceptance failed (exit 1) — stale evidence: GOAL-009-AC-238:204/200 (margin -4), GOAL-009-AC-239:204/200 (margin -4)`。
- 自该时刻起至 `2026-09-25T03:15:11.433Z`：**连续 762 条 fail、0 条 pass**，margin 由 −4 加深到 −28（约 24 交付面提交 / 24h）。⇒ 越界发生在 09-24 那一小时内，且此后一直红着。

### 成因：读数【有】、载体【有】、消费者【零】

`.quay/routine-findings.jsonl` 第 878 行（`kind:"scan-round"`，routine `freshness-refresh`，runId `freshness-refresh-1790303081218`，ts `2026-09-25T02:24:41.218Z`）的 `inventory` 逐字：

```json
{"subjects_in_margin_snapshot":7,"subjects_with_registered_producer":7,"producers":3,"carrier_records":291,"carrier_records_since_2026-09-23":0,"producers_executable_from_this_host":0}
```

同一条记录的 `notes` 逐字摘：`ssh precondition 0 verified live this run (yale@orangevps.wan.hwang.men Permission denied, rc=255) so NO producer is runnable from this host without an authorization change`。

⇒ **探针已经机械地测出「本机可执行的产出者 = 0」，把它写进了生产载体，并在 notes 里点名了成因。** 而**同一轮**的 `filing-round` 记录（同一 runId）照样产出：

```json
{"evaluated": true, "candidates": 7, "filed": ["gap-routine-freshness-refresh-freshness-stale-goal-009-ac-201", "gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238"], "rejected": [5 条 quality-dedup-rate 挡下], "errors": []}
```

**「零消费者」的谓词与命中数**（⛔ 硬规则 2：只数代码/规格构造点，散文与日志字符串不算命中；⛔ 硬规则 5：来源完备性 —— 来源 = `git grep` 全仓**已跟踪**文件 + 工作树递归 `grep`（排除 `node_modules`、`.quay` 自身之外），两者都只命中下面那 1 行）：

```
git grep -n "producers_executable_from_this_host"     → 1 命中（就是载体第 878 行本身）
git grep -n "producers_executable"                     → 1 命中（同上）
grep -rn "producers_executable_from_this_host" --include=*.ts --include=*.md --include=*.json --include=*.mjs --include=*.sh .（排除 node_modules/.quay） → 0 命中
grep -n "inventory"          plugin/probes/freshness-refresh.md  → 0 命中（rc=1）：该键【不在探针规格声明的输出模式里】
grep -n "ssh\|precondition"  plugin/probes/freshness-refresh.md  → 0 命中（rc=1）：探针规格里连「前置」这个概念都没有
```

⇒ 这个 0 **不是**探针规格声明过的输出键；它是探针从 `plugin/freshness-producers.json` 的 `preconditions` 散文里**自发**推出的一个字段。既不保证下一轮重现（规格里没有它 ⇒ 换一轮换个模型就没有），也没有任何机件读它。

**「无消费者」的可观测后果（直接量，⛔ 无一条靠推断）**：

1. **同一轮照旧产出可派发的 `ready` 任务**：`gap-routine-freshness-refresh-freshness-stale-goal-009-ac-201`（`tasks/…-ac-201.md:33` 的 Requested action 逐字 `re-run coldstart-face on a host already authorized to B (this host is NOT: ssh BatchMode rc=255)`）与 `gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238`，两条此刻都是 `status: ready` ⇒ 都进派发候选，形状上与「可在本处执行」的任务**不可区分**。
2. **该类立案从未到达过人可见的通道**：`tasks/` 下 `freshness-refresh` 任务共 **15** 条 —— **13 done / 2 ready / 0 条 ever `needs-human`**。
3. **证据一次都没被刷新过**：`ts >= 2026-09-23` 的载体记录 = **0**；自 `2026-09-20T13:50:36Z` 之后，本机产出者**零条**落账。
4. **本机两条验证机都拒绝**（本轮实测，2026-09-25）：`ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men 'df -h / ; date -u'` ⇒ `yale@orangevps.wan.hwang.men: Permission denied (publickey,password).` rc=255（显式带 `-i ~/.ssh/id_ed25519` 同形）；`yale@ad-arm1.wan.hwang.men` ⇒ `Permission denied (publickey).` rc=255。`~/.ssh/id_ed25519` mtime = Sep 16 10:39。

### 更早的修复为什么没兜住（这是同族第 7 次，不是第 1 次）

- **第 4 次**（`gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger`，done）交付了 `plugin/freshness-producers.json` + 探针 + routine 触发；其 DoD 明确写「探针**只 file 不 execute**」⇒ 它把「谁来重跑产出者」留给派发链。
- **第 5 / 6 次**（`gap-ac214-fifth-crossing-routine-detects-but-nothing-acts` / `gap-ac214-sixth-crossing-stale-bundle-detected-but-no-remediation`，均 done）把「检测 → 立案」这一步真正跑起来（后者还修掉了「跑的是陈旧 dist，所以立案步根本不在执行路径上」）。
- **09-24 那条 done 任务**（`gap-routine-freshness-refresh-stale-goal-009-ac-238`）**已经测到本轮的同一条阻断**，把它登记进 mapping 的 `upgrade-face.preconditions`（0 号前置 = ssh 授权），并**自己写下了预言**（逐字）：`criterion 在 margin 6 时仍绿 ⇒ 若该前置长期不解除，约 6 个交付面提交后 AC-238 会因 d > K 转红。这是后果，⛔ 不是补救。` —— 本轮正是那个「后果」兑现（margin 6 → −28）。
- **09-25 那条在飞任务**（`gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238`，`ready`，分支上已提交）把产出者的 15 条 `ssh`/`scp` 失败行补上成因；其结论逐字（`.quay/anchor.log`）：`Honest bottom line: the subject is still stale. AC-238/239 remain at fa1cae20 / margin −28 — refreshing them requires a host authorized to B, and this one is not.`

⇒ **每一次修复都在给「上一个读数」接消费者**（陈旧 dist → 机械重建；ssh 成因 → 失败行归因），**而链条上每上一层读数又是无消费者的**。这一次无消费者的是 `producers_executable_from_this_host: 0`：它已可测、已在载体里、已点名成因，**却没有改变立案的产物形态** —— 于是每窗口立一条形状上「可在本处执行」的 `ready` 任务、判据照旧转红。这正是硬规则 4b / 3b 的形态：**一个诚实的读数，与「一切照旧」同形**。

### 发生率（硬规则 12：⛔ 无发生率读数者不升为超前置）

- 「补救被外部前置挡住」实测 **3** 次：2026-09-24（机械取得，rc=255）、2026-09-25T02:24Z（探针自己在 `inventory` + `notes` 里取得）、2026-09-25（本轮复跑，rc=255）。
- 该阻断期间**仍未改变形态**的立案 **4** 条（09-24 ×2、09-25 ×2）；证据刷新 **0** 次。
- 判据连续 **762** 条 fail、**0** 条 pass。

### 反例对照（硬规则 4 推论四：给不出对照就降为假说）

若立案链**已经消费**了这个读数，09-25T02:24Z 那一轮的产物就**应当**在形态上区别于「可在本处执行」——例如不产出可派发的 `ready`、或在载体上留下一个独立取值。实测形态是：`filing-round` 的 `errors: []`、`filed` 两条、两条都 `status: ready`，**与「可执行」同形**。⇒ 判别式成立：**读数为 0 时不该出现这个形态；它出现了** ⇒ 消费者缺席。（可区分性：若把读数改成 > 0 的对照，形态**应当**不变 —— 那才是「消费者在场」的形态。）

<!-- dedup-ref -->
**相关但不同（仅为溯源，⛔ 不是前置、⛔ 不是依赖）**：`tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238.md` 与 `tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-201.md`（均 `ready`，在飞）处置的是**单个主体**的 finding（各自的复核与处置），⛔ 不消费 `producers_executable_from_this_host`，也 ⛔ 不改变立案链的产物形态；`tasks/gap-ac214-sixth-crossing-stale-bundle-detected-but-no-remediation.md`（done）修的是**陈旧 dist** 这一个读数。本条的对象是**链条上再上一层、同样是「检测到、如实记录、无消费者」**的那个读数。

### ⛔ 本任务不做的事

⛔ 不改 K / 主体集合 / `criterion` / `expect` / `goals/`（含「把已越界的主体删掉」）；⛔ 不改 `plugin/freshness-producers.json` 的 `wallclock_hours`（改它会移动探针阈值）；⛔ 手写 / 搬运 / 伪造任何证据记录；⛔ 自行 `superseded` 或改 AC-214 的 status（需人裁定）；⛔ **不新增 needs-human 成因枚举、不新增任何「可机械再入队」路径** —— 人 2026-09-20 逐字裁定「needs-human 本来就不应该有『可机械再入队』的路径」「靠枚举成因字段做逻辑控制……枚举异常是靠不住的」，该三态枚举已于 `plugin/scripts/driver-filters.ts:853` 整套退役；⛔ 不在验证机上删任何文件（对外、难逆、需人授权）；⛔ 不自动跨机执行产出者（第 4 次任务的 FILE-ONLY 边界不变）。

## Requested action

1. **关闭当前缺口（⛔ 外部动作，见 AC7 的 `（待外部）`）**：在**一台已被 B 授权**的主机上（或先由人把本机 `~/.ssh/id_ed25519.pub` 加进 `yale@orangevps.wan.hwang.men` 的 `authorized_keys`）按 `plugin/freshness-producers.json` 重跑 `coldstart-face`（含 `--ac207-e2e`）与 `upgrade-face`（`--upgrade-source work/meta-cc-aged-ac238-copy`，必须**同时**带 `--ac239-e2e`；`--verify-upgrade` 读到 `PARTIAL` 要读成「AC-239 未刷新」），直到 AC-214 判据本体干跑 **exit 0**。⛔ 通过放宽判据 / 改 K / 删主体达成不算。

2. **给 `producers_executable_from_this_host` 一个消费者（本条要点）**：
   a. **先把它从「探针自发字段」升成规格声明** —— 在 `plugin/probes/freshness-refresh.md` 的输出模式里声明 remedy-availability 这个取值（⛔ 不能只活在 notes 散文里：该键今天在探针规格里 `grep -n inventory` 命中 0 ⇒ 下一轮不保证重现）。
   b. **给它一个会改变结果的动作面**：当该读数为「本机不可执行」时，立案链**不得**产出一条与「可在本处执行」同形的可派发 `ready` 任务；它必须走**人可见的通道**（任务 store 的 `needs-human`，或等价的人可读载体），携带**逐字补救动作**（哪台机、哪条命令、改哪个 `authorized_keys`），并在该读数不变时**不重复立案同一主体**。
   c. **⛔ 边界**：不新增 needs-human 成因枚举、不新增「可机械再入队」路径（人 2026-09-20 裁定）；不自动跨机执行产出者。

3. **可区分性（硬规则 3b）**：「本机不可执行」必须是一个**独立取值**，⛔ 不与「可执行」同形，⛔ 也不与 `NOT-EVALUATED` 同形（探针 ssh 复核读不出来时是**第三种**态）；且 STALE 本身**仍然被报出**（⛔ 不静默降级成 fresh）。

4. **双向负控制**：① 前置满足（ssh 可达 / 可执行产出者数 > 0）⇒ 读数**不是**「被挡住」，且照常立可派发任务（证明不是「恒报挡住」）；② 前置不满足 ⇒ 独立取值在场、STALE 仍被报出、且产物形态与 ① 可区分。

## Acceptance Criteria

- [ ] AC1 改前读数（能取假，⛔ 引述不算、须复跑）：用**仓库自己的 YAML 解析器**抽出 `goals/AC-214-*.md` 的 `criterion:` 折叠块逐字跑 ⇒ **exit 1**，stderr 逐字含 `GOAL-009-AC-238:228/200 (margin -28)` 与 `GOAL-009-AC-239:228/200 (margin -28)`；贴 stdout 七行 + 每个主体最新记录的 (ts, build_sha) 表 + 载体行数与 `ts>=2026-09-23` 计数 + `.quay/goal-freshness-margin.json` 全文。
- [ ] AC2 回归而非恒红：贴 `.quay/gate-events.jsonl` 中 `item_id=AC-214` 的最后一条 `pass` 与其后第一条 `fail` 两个时刻，以及自该时刻起的 fail/pass 计数（`fail=762, pass=0`）。
- [ ] AC3 「读数有、消费者零」具名到机件：贴 `git grep` 的**谓词与命中数**（`producers_executable_from_this_host` 全仓 1 条 = 载体自身；`inventory` 在 `plugin/probes/freshness-refresh.md` 命中 0；`ssh|precondition` 在同文件命中 0），并给出你用来判定「无消费者」的完整谓词；⛔ 硬规则 5：搜不到须先证明来源对它完备。
- [ ] AC4 「无消费者」的后果是直接量：贴同一 runId 的 `filing-round` 记录全文 + 它立出的任务文件此刻的 `status:`（⛔ 不是标题），以及 `tasks/` 下 `freshness-refresh` 任务的 (done/ready/needs-human) 三态计数。
- [ ] AC5 机制落点（file:line）+ 双向负控制：给出 remedy-availability 在探针规格里的声明落点、在立案链里的消费点（file:line），以及测试文件里「可执行 / 不可执行」两臂各自能取假（⛔ 只由夹具满足不算产出 —— 生产读数见 AC6）。
- [ ] AC6 生产读数（硬规则 4 推论三：AC 必须读**生产载体**）：修复落地后**真实**的一轮 `freshness-refresh`（常驻 driver 调度，⛔ 不是 `--selfcheck`、⛔ 不是夹具）在 `.quay/routine-findings.jsonl` 留下带 remedy-availability **独立取值**的记录，`ts` 晚于修复落地时刻；且该轮在 ssh 阻断下**不再**产出与「可执行」同形的可派发任务。贴命令、runId、记录全文、产物状态。
- [ ] AC7 关闭当前缺口：AC-214 判据本体干跑 **exit 0**（七行 margin 全正）＋ `quay goal gate AC-214 --root .` exit 0。（待外部）
- [ ] AC8 未改判据本体：`git diff --exit-code -- goals/` 为空；跑判据前后 `md5sum .quay/productization-verification.jsonl` 相同。

## Definition of Done

主检出判据本体干跑 **exit 0**（七行 margin 全正）；`producers_executable_from_this_host`（或等价的 remedy-availability 取值）**已进探针规格的声明输出**并有**在生产的立案链里**改变结果的消费者 —— 落地后真实一轮 `freshness-refresh` 在载体上留下该读数的独立取值，且在该读数 = 0 时**不再产出与「可执行」同形的可派发任务**；「前置满足」臂下**不**报「被挡住」（⛔ 不是恒有输出）；⛔ 未新增任何 needs-human 成因枚举或再入队路径；`goals/` 零 diff。

⛔ 不接受的替代物：改 K / 删主体 / 改 `expect` 或 `criterion`；手写或搬运证据记录；**只把读数写进 notes 散文**（那正是本条要关掉的那个形态）；只改探针规格不加消费者；把 AC6 降格成夹具读数；只把记录写进任务 worktree 的 `.quay/`（判据读主检出 ⇒ 空转）；新增 needs-human 成因枚举 / 再入队路径（人 2026-09-20 裁定）。⚠️ AC7 是**外部**动作（需一台被 B 授权的主机或目标侧 `authorized_keys` 变更），已标注 `（待外部）`；⛔ 不得以「本任务跑不了外部动作」为理由把 AC1–AC6、AC8 降格或跳过。

## Touches

- `plugin/probes/freshness-refresh.md`（remedy-availability 进声明的输出模式）
- `plugin/scripts/probe-routine.ts`（finding 记录携带该取值 + 立案前的消费点）
- `plugin/scripts/routine-file-gate.ts`（立案产物形态：不得与「可执行」同形）
- `plugin/freshness-producers.json`（产出者可执行性的机械求值面；⛔ 不动 `wallclock_hours`）
- `plugin/test/freshness-refresh-remedy-availability.test.mjs` (new)（双向负控制）
- `tasks/gap-ac214-seventh-crossing-blocked-remedy-has-no-consumer.md`（自身文件：勾 AC + 贴实跑证据）
- `.quay/routine-findings.jsonl`（生产载体：AC6 在它上面取证；⚠️ git-tracked，故声明）
- `.quay/productization-verification.jsonl`（gitignored：产出者 append 的落点，⛔ 非可提交物）