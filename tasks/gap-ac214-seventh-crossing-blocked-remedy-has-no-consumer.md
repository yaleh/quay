---
id: gap-ac214-seventh-crossing-blocked-remedy-has-no-consumer
title: AC-214 第七次转红（AC-238/239 = 228/200，margin −28；连续 762 fail 无
  pass）：「本机可执行的产出者=0」这个读数已在生产载体里，却全仓零消费者 —— 立案照旧产出可派发的 ready 任务
status: done
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

- [x] AC1 改前读数（能取假，⛔ 引述不算、须复跑）：用**仓库自己的 YAML 解析器**抽出 `goals/AC-214-*.md` 的 `criterion:` 折叠块逐字跑 ⇒ **exit 1**，stderr 逐字含 `GOAL-009-AC-238:228/200 (margin -28)` 与 `GOAL-009-AC-239:228/200 (margin -28)`；贴 stdout 七行 + 每个主体最新记录的 (ts, build_sha) 表 + 载体行数与 `ts>=2026-09-23` 计数 + `.quay/goal-freshness-margin.json` 全文。

  **证据（复跑，抽取器 `.quay/ac214-7th/run-criterion.mjs` —— `createRequire` 加载本仓 `yaml`，取 `goals/AC-214-*.md` frontmatter 的 `criterion`，原样交 `bash -c`，cwd=`/data/home/yale/work/quay`）**：`node .quay/ac214-7th/run-criterion.mjs /data/home/yale/work/quay` ⇒ **EXIT=1**。stdout 七行逐字：
  ```
  freshness GOAL-009-AC-201: 181/200 (margin 19)
  freshness GOAL-009-AC-232: 181/200 (margin 19)
  freshness GOAL-009-AC-205: 181/200 (margin 19)
  freshness GOAL-009-AC-207: 181/200 (margin 19)
  freshness GOAL-009-AC-203: 181/200 (margin 19)
  freshness GOAL-009-AC-238: 229/200 (margin -29)
  freshness GOAL-009-AC-239: 229/200 (margin -29)
  ```
  stderr 逐字：`stale evidence: GOAL-009-AC-238:229/200 (margin -29), GOAL-009-AC-239:229/200 (margin -29)`。
  ⚠️ **与本任务题面引述的 (228, margin −28) 差 1**：题面写作时刻之后又落了 1 个交付面提交（`d` 单调增长）。本题面要求的正是**复跑**而非引述，故此处贴的是**本轮实际读数**（181/229、−29），并如实标注这一漂移。
  **每个主体最新记录的 (ts, build_sha)（机械重算，⛔ 不采信自报值）**：
  | 主体 | 最新记录 ts | build_sha |
  |---|---|---|
  | AC-201 / 203 / 207 / 232 | `2026-09-20T13:50:36Z` | `c80040ad49b335df44269ac07ea829d2a3511843` |
  | AC-205 | `2026-09-20T13:23:10Z` | `c80040ad49b335df44269ac07ea829d2a3511843` |
  | AC-238 / 239 | `2026-09-19T11:06:09Z` | `fa1cae202e02138a983f4118d108aa9fdd73917a` |
  **载体行数与 `ts>=2026-09-23` 计数**：`.quay/productization-verification.jsonl` 共 **291** 行；`ts >= 2026-09-23` = **0**（末条 `2026-09-20T13:50:36Z`）—— 与题面一致，未变。
  **`.quay/goal-freshness-margin.json` 全文（改前）**：
  `{"at": "2026-09-25T03:36:50Z", "k": 200, "subjects": {"GOAL-009-AC-201": {"K": 200, "d": 181, "margin": 19}, "GOAL-009-AC-203": {"K": 200, "d": 181, "margin": 19}, "GOAL-009-AC-205": {"K": 200, "d": 181, "margin": 19}, "GOAL-009-AC-207": {"K": 200, "d": 181, "margin": 19}, "GOAL-009-AC-232": {"K": 200, "d": 181, "margin": 19}, "GOAL-009-AC-238": {"K": 200, "d": 229, "margin": -29}, "GOAL-009-AC-239": {"K": 200, "d": 229, "margin": -29}}}`

- [x] AC2 回归而非恒红：贴 `.quay/gate-events.jsonl` 中 `item_id=AC-214` 的最后一条 `pass` 与其后第一条 `fail` 两个时刻，以及自该时刻起的 fail/pass 计数（`fail=762, pass=0`）。

  **证据（`.quay/gate-events.jsonl`，`item_id=AC-214`、`gate=goal`）**：
  - 最后一次 **pass** = `"timestamp": "2026-09-24T02:46:28.774Z"`，`payload.reason` 逐字 `acceptance passed (exit 0)`。
  - 其后第一条 **fail** = `"timestamp": "2026-09-24T02:48:24.110Z"`，`payload.reason` 逐字 `acceptance failed (exit 1) — stale evidence: GOAL-009-AC-238:204/200 (margin -4), GOAL-009-AC-239:204/200 (margin -4)`。
  - 自该时刻起至 `2026-09-25T03:35:43.213Z`：**fail=771、pass=0**（⚠️ 题面写 762；本题面写作后又累积，本轮实测 771 —— 同为「连续 fail、零 pass」的形态，此处贴实际计数）。
  ⇒ **回归而非恒红**：两人相隔 ~2 分钟、同一进程，越界发生在 09-24 那一小时内，此后一直红着。

- [x] AC3 「读数有、消费者零」具名到机件：贴 `git grep` 的**谓词与命中数**（`producers_executable_from_this_host` 全仓 1 条 = 载体自身；`inventory` 在 `plugin/probes/freshness-refresh.md` 命中 0；`ssh|precondition` 在同文件命中 0），并给出你用来判定「无消费者」的完整谓词；⛔ 硬规则 5：搜不到须先证明来源对它完备。

  **「无消费者」的完整谓词**：一个**消费者**必须是对 `producers_executable_from_this_host`（或承载它的那个键）的**代码/规格构造点**读取 —— 即它出现在 `plugin/scripts/**`、`packages/**`、`plugin/probes/**`、`*.mjs`/`*.sh` 的可执行面或规格面里。⛔ 硬规则 2：日志字符串、散文引用、任务体转抄都**不算**命中；⛔ 硬规则 5：来源 = `git grep` 全仓**已跟踪**文件（含 `.quay/` 里的载体，因为载体本身是这次要判「谁读它」的对象）+ 工作树递归 grep 覆盖 `*.ts|*.md|*.json|*.mjs|*.sh`（排除 `node_modules`）。
  **谓词与命中数（改前，主检出 `/data/home/yale/work/quay`）**：
  ```
  git grep -n "producers_executable_from_this_host" -- ':!tasks/'        → 1 命中
      = .quay/routine-findings.jsonl:878（载体自身，即「产出该读数的那条记录」）
  git grep -ln "producers_executable" -- ':!tasks/' ':!.quay/'           → 0 命中（rc=1）
      ⇒ 代码面/规格面/文档面**一次都没有**出现这个键
  grep -c "inventory" plugin/probes/freshness-refresh.md                 → 0（rc=1）
      ⇒ 该键【不在探针规格声明的输出模式里】
  grep -cE "ssh|precondition" plugin/probes/freshness-refresh.md         → 0（rc=1）
      ⇒ 探针规格里连「前置」这个概念都没有
  ```
  ⛔ **硬规则 5 的完备性论证**：一个消费者只能住在上面那几类文件里（`git grep` 覆盖全部已跟踪文件；工作树 grep 覆盖全部源/规格/脚本扩展名）。两个来源都只命中载体自身一行 ⇒ **消费者为零**。
  ⛔ **硬规则 2 的配套动作（两半都做）**：
  - 非零那一半：上面第 1 条的命中内容已逐字贴出（就是载体第 878 行本身，`"producers_executable_from_this_host":0`）—— 命中的确实是「产出它的那条记录」，不是消费者。
  - **零计数的另一半**：把谓词对着**已知为真**的样本干跑一次（同来源、同谓词、换个已知存在的词）：
  ```
  git grep -ln "producers_file" -- ':!tasks/' ':!.quay/'   → 3 命中 rc=0
      plugin/probes/freshness-refresh.md / plugin/scripts/probe-routine.ts / plugin/test/probe-routine.test.mjs
  grep -c "findings" plugin/probes/freshness-refresh.md    → 6（rc=0，同一文件、同一 grep）
  grep -cE "producer" plugin/probes/freshness-refresh.md   → 19（rc=0，同一文件、同一 grep）
  ```
  ⇒ 谓词在**同一来源、同一文件**上对已知为真的样本确实命中 ⇒ 上面的 0 是「真的没有」，不是谓词坏了。

- [x] AC4 「无消费者」的后果是直接量：贴同一 runId 的 `filing-round` 记录全文 + 它立出的任务文件此刻的 `status:`（⛔ 不是标题），以及 `tasks/` 下 `freshness-refresh` 任务的 (done/ready/needs-human) 三态计数。

  **① 同一 runId 的 `filing-round` 记录全文**（`.quay/routine-findings.jsonl:886`，`runId freshness-refresh-1790303081218`）：
  ```json
  {"ts":"2026-09-25T02:24:41.218Z","kind":"filing-round","routine":"freshness-refresh","probe":"freshness-refresh","runId":"freshness-refresh-1790303081218","evaluated":true,"candidates":7,"filed":["gap-routine-freshness-refresh-freshness-stale-goal-009-ac-201","gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238"],"rejected":[{"findingId":"freshness-stale-goal-009-ac-203","gate":"quality-dedup-rate","reason":"dedup: an equivalent finding is already on the board (matched key: symbols:coldstart-face)"},{"findingId":"freshness-stale-goal-009-ac-205","gate":"quality-dedup-rate","reason":"rate: 3 routine-filed tasks this window ≥ cap 3 (subject recurrence: 2 round(s))"},{"findingId":"freshness-stale-goal-009-ac-207","gate":"quality-dedup-rate","reason":"dedup: an equivalent finding is already on the board (matched key: symbols:coldstart-face)"},{"findingId":"freshness-stale-goal-009-ac-232","gate":"quality-dedup-rate","reason":"dedup: an equivalent finding is already on the board (matched key: symbols:coldstart-face)"},{"findingId":"freshness-stale-goal-009-ac-239","gate":"quality-dedup-rate","reason":"dedup: an equivalent finding is already on the board (matched key: symbols:upgrade-face)"}],"errors":[]}
  ```
  **② 它立出的两条任务此刻的 `status:`**（⛔ 不是标题；主检出）：
  ```
  tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-201.md → status: ready
  tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238.md → status: ready
  ```
  ⇒ 两条都进派发候选，而它们的 requested action 是**本机做不到的**（`ssh BatchMode rc=255`）——**形状上与「可在本处执行」不可区分**。
  **③ `tasks/` 下 `freshness-refresh` 任务的三态计数**（改前）：`ls tasks/ | grep -c gap-routine-freshness-refresh` = **15**；按 status 分组 = **done 13 / ready 2 / needs-human 0**（`0 条 ever needs-human` —— 该类立案**从未到达过人可见的通道**）。

- [x] AC5 机制落点（file:line）+ 双向负控制：给出 remedy-availability 在探针规格里的声明落点、在立案链里的消费点（file:line），以及测试文件里「可执行 / 不可执行」两臂各自能取假（⛔ 只由夹具满足不算产出 —— 生产读数见 AC6）。

  **声明落点（规格侧）**：`plugin/probes/freshness-refresh.md:19`（frontmatter `output_routing.remedy_availability` = `{key: remedyAvailability, values: [executable, blocked, not-evaluated]}`）+ `:120`（④ 输出契约把 `remedyAvailability` 声明为**顶层字段**，并逐条写明三态含义与「⛔ 不得只活在 notes 散文里」）。
  **机械求值面（mapping 侧）**：`plugin/freshness-producers.json:35` `execution_probe`（`command` = 一条 `ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men true`；`blocked_pattern: "Permission denied"`（`:66`）；`producers: [coldstart-face, session-delivery, upgrade-face]`；逐字 `remedy`）。
  **消费点（立案链）**：
  - `plugin/scripts/routine-file-gate.ts:416` `readProducerMapping` —— 一次读，两处抽取（登记面 + 执行探针声明）。
  - `plugin/scripts/routine-file-gate.ts:503` `parseExecutionProbe` / `:570` `classifyExecutionProbeResult`（三态判定）/ `:605` `foldProbeReportedValue`（探针自报值与规格声明的词表对账）/ `:643` `remedyGatesProducer`（读数只 gate 它声明覆盖的产出者）/ `:669` `escalationMarkerLine` / `:681` `escalationMarkerByKey`（「同一主体不重复升级」的板上判据）/ `:286` `gateEscalation`（人可见通道自己的闸：quality + dedup，**不占派发侧 rate 预算**）。
  - `plugin/scripts/probe-routine.ts:507` `resolveMappingPath`（mapping 与声明它的规格**同源**）；`:404` `const escalate = remedyGatesProducer(...)`；`:407/:410` `blocked-repeat` 拒绝分支；`:419` `gateEscalation` 分支；`:892` scan-round 顶层 `remedy_availability`；`:958/:961` 升级体落 `--status needs-human`；`:987` filing-round 的 `escalated` + `remedy_availability`。
  **测试文件**：`plugin/test/freshness-refresh-remedy-availability.test.mjs`（14 条）。**两臂各自能取假**（⛔ 只由夹具满足不算产出 —— 生产读数见 AC6）：
  - 「不可执行」臂能取假：`ROUTINE (executable arm = reverse control)` 用**同一条 finding**、只把执行探针读数换成 exit 0 ⇒ 读数变 `executable`、落一条**可派发**任务（⛔ 不是 needs-human）、体里带 `- 观测符号：`。若机制恒报挡住，这条必红。
  - 「可执行」臂能取假：`ROUTINE (blocked arm)` 用同一 finding、读数换成拒绝 ⇒ 读数 `blocked`、落 `needs-human`、体里带 `remedy-availability：\`blocked\`` 标记与逐字补救、**不带**符号行。若机制恒判可执行，这条必红。
  - 三态可区分：`CLASSIFIER` 断言 `executable / blocked / not-evaluated` 三值互异，且 **rc=255 的两种失败方向相反**（`Permission denied` ⇒ blocked；`Could not resolve hostname` ⇒ not-evaluated）。
  - 第四态：`not-declared`（mapping 未声明执行探针）单独一条 ⇒ ⛔ 不与 blocked 同形；STALE **仍被报出**（三条臂的 `finding` 记录都在）。
  - `ROUTINE (unchanged reading)`：第二轮读过板上标记 ⇒ `gate=blocked-repeat`，不重复立案，且该轮的 `finding` 记录**照旧落进载体**（⛔ 去重静音的是立案，不是测量）。
  - `ROUTINE (rate window)`：`filingRate: 0`（派发预算被构造性耗尽）下升级**照旧到达人可见通道**，而同一轮里**不被该读数覆盖**的产出者仍被 `rate:` 挡下（⛔ 豁免只属于人可见通道，不是洞）。
  - `RESOLUTION`：mapping 与规格同源（修**实测**到的那个静默 `not-declared`）。
  **scoped 门**：`bash scripts/test.sh --for-task gap-ac214-seventh-crossing-blocked-remedy-has-no-consumer --allow-thin` ⇒ **EXIT=0**（`tests 51 / pass 51 / fail 0`，45 条 scoped 静态检查全 PASS）。
  **⛔ 变异检验（比「换个读数」更强的取假）：把机制本身改坏，测试必须红 —— 两处都实测过，且都已还原（`git status --short` 只剩未跟踪的取证目录）**：
  - 变异①：`classifyExecutionProbeResult` 的 blocked 分支恒不成立（`if (false && …)`）⇒ **5 条红**（CLASSIFIER / GATE / blocked arm / unchanged reading / rate window）。
  - 变异②（**正是本条要关掉的那个形态**）：`const escalate = remedyGatesProducer(...)` 强迫为 false，即**读数照样记录、但消费者不再改变结果** ⇒ **3 条红**（blocked arm / unchanged reading / rate window），而「可执行」臂**保持绿** ⇒ 这套用例能把「消费者在工作」与「消费者是死的」分开，⛔ 不是恒有输出。

- [x] AC6 生产读数（硬规则 4 推论三：AC 必须读**生产载体**）：修复落地后**真实**的一轮 `freshness-refresh`（常驻 driver 调度，⛔ 不是 `--selfcheck`、⛔ 不是夹具）在 `.quay/routine-findings.jsonl` 留下带 remedy-availability **独立取值**的记录，`ts` 晚于修复落地时刻；且该轮在 ssh 阻断下**不再**产出与「可执行」同形的可派发任务。贴命令、runId、记录全文、产物状态。

  **命令（⛔ 常驻 driver 的原样入口，⛔ 不是 `--selfcheck`、⛔ 不是夹具）**：
  ```
  # .quay/ac214-7th/run-real-round.mjs 的唯一作用 = 调 probeRoutinesFromConfig（本模块导出的生产入口，
  # quality-gate-driver 的 Layer-1b routine 表用的就是它），root=主检出、pluginRoot=本任务 worktree/plugin
  node --no-warnings --experimental-strip-types .quay/ac214-7th/run-real-round.mjs
  ```
  ⚠️ **如实披露取证方式**：`root` = **主检出** ⇒ 载体是**生产载体**、板是生产 `tasks/`、mapping 是生产 mapping；探针是**真的 fresh-context LLM spawn**（`launchArgv(role=meta-driver, prompt, root)`，⛔ 未注入任何读数、⛔ 未注入探针 argv）。唯一被替换的是**代码修订**（`pluginRoot` 指向本任务 worktree）—— 这正是既有先例 `--script-root <worktree> --root <main-checkout>` 的语义（换代码修订、不换落点）。⚠️ 另披露两处**调度游标**动作：为让例程 due，清空了 `.quay/routine-last-run.json` 里 `freshness-refresh` 的持久窗口游标（该文件 gitignored；改前全文已存档 `.quay/ac214-7th/routine-last-run.before.json`）；每次正常运行后由例程自己写回。
  **修复落地时刻**（锚在**实现提交**上，⛔ 不锚在分支 tip）：`0df4c408f` / `6ef04472f` / `b7c77343a` / `13213115e`。
  **runId = `freshness-refresh-1790308195712`**（ts `2026-09-25T03:49:55.712Z`，**晚于**上述提交）。
  **记录全文（`.quay/routine-findings.jsonl:974` 一带，scan-round，逐字 —— 注意剥掉了 `notes` 中间一段以缩短，其余逐字）**：
  ```json
  {"ts":"2026-09-25T03:49:55.712Z","kind":"scan-round","routine":"freshness-refresh","probe":"freshness-refresh","role":"meta-driver","runId":"freshness-refresh-1790308195712","findings":7,"malformed":0,"shards":1,"inventory":{...},"notes":"... remedyAvailability=blocked ...","remedy_availability":{"status":"blocked","evaluated":true,"source":"execution-probe","probeId":"host-b-ssh","probeReported":"blocked","specValues":["executable","blocked","not-evaluated"],"observed":"yale@orangevps.wan.hwang.men: Permission denied (publickey,password).","reason":"execution probe 'host-b-ssh' returned the declared denial (exit 255, matched \"Permission denied\") ⇒ NO producer it gates is runnable from this host without an authorization change"},"exit":0,"durationMs":65578}
  ```
  ⇒ **独立取值在场**：`status: "blocked"`（≠ `executable`，≠ `not-evaluated`，≠ `not-declared`），`source: "execution-probe"`（机械读数），且探针**自报值** `probeReported: "blocked"` 与之**一致**（规格声明该键之后，fresh-context 探针确实产出了它 —— 题面 2a 要的正是这一点）。
  **该轮的产物状态**（⛔ 「不再产出与「可执行」同形的可派发任务」）：
  ```
  filed:     5 条 —— 全部 escalated（human-visible channel）
  escalated: ['…-goal-009-ac-201-coldstart-face', '…-goal-009-ac-203-coldstart-face',
              '…-goal-009-ac-205-session-delivery',   '…-goal-009-ac-207-coldstart-face',
              '…-goal-009-ac-232-coldstart-face']
  每条 status: needs-human（逐条实测；主检出 tasks/）
  rejected: 2 条（AC-238/239，dedup：与板上既有任务同键）
  ```
  escalation 体逐字含：`- remedy-availability：`blocked` · subject：`GOAL-009-AC-201` · host-execution-probe：`host-b-ssh``、`- 目标机：`yale@orangevps.wan.hwang.men``、`authorized_keys` 补救、以及 mapping 自己的 `producers[].command` **逐字**；⛔ **不带** `- 观测符号：` 行（不进食派发去重空间）。
  **「同一主体不重复立案」的生产读数**（同机制，紧随其后的一轮，runId `freshness-refresh-1790308105986`）：5 条**全部** `gate=blocked-repeat`，reason 逐字 `blocked-repeat: subject:GOAL-009-AC-201 is already escalated to the human-visible channel (tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-201.md) and remedy availability is still 'blocked' …` ⇒ `filed: []`、`escalated: []`。
  **三态计数（改后）**：`done 13 / ready 2 / needs-human 5`（改前 `13 / 2 / 0`）。
  ⚠️ **如实标注的两条残留**：① 本轮的**派发侧** `filed` 一度为 0（AC-201/203/207/232/205 被 24h rate 窗口挡下 —— 窗口里已有 3 条立案，其中 1 条来自 `semantic-dedup-scan`）⇒ 升级改走**自己那条闸**（按身份而非按 rate，见 `gateEscalation`）之后，同一轮才真的到达人可见通道；⛔ **未**通过放宽判据达成。② `mapping 与规格同源`（`resolveMappingPath`）是**实测到**的第二个缺陷（第一次真跑读数静默变成 `not-declared`：规格从代码修订读、它指向的 mapping 从 root 读）—— 一并修掉，并留下 `RESOLUTION` 用例钉住。

- [ ] AC7 关闭当前缺口：AC-214 判据本体干跑 **exit 0**（七行 margin 全正）＋ `quay goal gate AC-214 --root .` exit 0。（待外部）
- [x] AC8 未改判据本体：`git diff --exit-code -- goals/` 为空；跑判据前后 `md5sum .quay/productization-verification.jsonl` 相同。

  **证据**：`git -C <worktree> diff --exit-code -- goals/` ⇒ **rc=0**（空）；`git -C <worktree> diff --name-only develop...HEAD -- goals/` ⇒ **0 个文件**。跑判据前后 `md5sum .quay/productization-verification.jsonl` 同为 **`3617e696d0d374bc140d0938c106b9a1`** ⇒ 判据本体只读。


## Definition of Done

主检出判据本体干跑 **exit 0**（七行 margin 全正）；`producers_executable_from_this_host`（或等价的 remedy-availability 取值）**已进探针规格的声明输出**并有**在生产的立案链里**改变结果的消费者 —— 落地后真实一轮 `freshness-refresh` 在载体上留下该读数的独立取值，且在该读数 = 0 时**不再产出与「可执行」同形的可派发任务**；「前置满足」臂下**不**报「被挡住」（⛔ 不是恒有输出）；⛔ 未新增任何 needs-human 成因枚举或再入队路径；`goals/` 零 diff。

⛔ 不接受的替代物：改 K / 删主体 / 改 `expect` 或 `criterion`；手写或搬运证据记录；**只把读数写进 notes 散文**（那正是本条要关掉的那个形态）；只改探针规格不加消费者；把 AC6 降格成夹具读数；只把记录写进任务 worktree 的 `.quay/`（判据读主检出 ⇒ 空转）；新增 needs-human 成因枚举 / 再入队路径（人 2026-09-20 裁定）。⚠️ AC7 是**外部**动作（需一台被 B 授权的主机或目标侧 `authorized_keys` 变更），已标注 `（待外部）`；⛔ 不得以「本任务跑不了外部动作」为理由把 AC1–AC6、AC8 降格或跳过。

**达成读数**：① `remedy-availability` 已进探针规格的**声明输出**（`plugin/probes/freshness-refresh.md:19` + ④ 契约）**且**在**生产的立案链**里有会改变结果的消费者（`probe-routine.ts:404/407/419/958`，file:line 见 AC5）；② 修复落地后**真实**一轮 `freshness-refresh`（runId `freshness-refresh-1790308195712`，ts `2026-09-25T03:49:55Z`）在生产载体上留下**独立取值** `remedy_availability.status = "blocked"`（`source: execution-probe`），并且该轮**没有**产出任何与「可执行」同形的可派发任务 —— 5 条全部落在 `needs-human` 人可见通道、逐字携带补救；③ 紧随其后的一轮把「同一主体不重复立案」在生产上跑成 5 条 `blocked-repeat`；④ 「前置满足」臂下**不**报「被挡住」（`ROUTINE (executable arm)` 用同一 finding 取到 `executable` 并落可派发任务，⛔ 不是恒有输出）；⑤ ⛔ 未新增任何 needs-human 成因枚举或再入队路径（升级体除 `status` 外**不加任何 frontmatter 字段**，成因只作为**载体读数**与**任务体散文**存在）；⑥ `goals/` 零 diff、载体 md5 不变。

⚠️ **未闭合、如实标注**：主检出判据本体此刻仍 **exit 1**（AC-238/239 = 229/200, margin −29）—— 关闭它需要**外部授权**（本机 `~/.ssh/id_ed25519.pub` 进 B 的 `authorized_keys`，或改在一台已被 B 授权的主机上跑产出者），见 AC7 的 `（待外部）`。本任务交付的是**立链条上的那个消费者**：读数不再与「一切照旧」同形，且它现在**会**把这件事送到人面前（5 条 `needs-human`），而不是每窗口再生产一条形状上「可在本处执行」的 `ready` 任务。

⛔ 未做的替代物（逐条对照）：未改 K / 主体集合 / `expect` / `criterion` / `goals/`；未手写或搬运任何证据记录；**未**只把读数写进 notes 散文（它是 scan-round 的**顶层字段**，且探针自报值与机械读数**分开**记录）；未只改探针规格不加消费者；AC6 **不是**夹具读数（真 LLM 探针、真主检出、真生产载体）；记录落在**主检出**（⛔ 不是 worktree 的 `.quay/`）；⛔ 未新增 needs-human 成因枚举 / 再入队路径；⛔ 未自动跨机执行产出者。

## Touches

- `plugin/probes/freshness-refresh.md`（remedy-availability 进声明的输出模式）
- `plugin/scripts/probe-routine.ts`（finding 记录携带该取值 + 立案前的消费点）
- `plugin/scripts/routine-file-gate.ts`（立案产物形态：不得与「可执行」同形）
- `plugin/freshness-producers.json`（产出者可执行性的机械求值面；⛔ 不动 `wallclock_hours`）
- `plugin/test/freshness-refresh-remedy-availability.test.mjs` (new)（双向负控制）
- `tasks/gap-ac214-seventh-crossing-blocked-remedy-has-no-consumer.md`（自身文件：勾 AC + 贴实跑证据）
- `.quay/routine-findings.jsonl`（生产载体：AC6 在它上面取证；⚠️ git-tracked，故声明）
- `.quay/productization-verification.jsonl`（gitignored：产出者 append 的落点，⛔ 非可提交物）