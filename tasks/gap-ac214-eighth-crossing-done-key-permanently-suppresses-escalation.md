---
id: gap-ac214-eighth-crossing-done-key-permanently-suppresses-escalation
title: AC-214 第八次转红（AC-238/239 = 237/200，margin −37；连续 790 fail / 0
  pass）：第七次刚建的升级通道对【曾被立案过的主体】结构性不可达 —— 供给 dedup 键的是两条 done 任务，boardKeys() 无
  status 维度
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

**判据此刻为假（本轮复跑，⛔ 非引述）**：`node packages/quay/bin/quay.js goal gate AC-214 --dry-run --json` ⇒ `verdict: "fail"`，reason 逐字：

```
acceptance failed (exit 1) — stale evidence: GOAL-009-AC-238:237/200 (margin -37), GOAL-009-AC-239:237/200 (margin -37)
```

`.quay/goal-freshness-margin.json` 全文（`2026-09-25T04:03:46Z`）：AC-201/203/205/207/232 均 **189/200（margin 11）**，AC-238/239 均 **237/200（margin −37）**。载体 `.quay/productization-verification.jsonl` 共 **291** 行，末条 `2026-09-20T13:50:36Z`，`ts >= 2026-09-23` 的记录数 = **0**。

**这是回归，不是恒红**（`.quay/gate-events.jsonl`，`item_id=AC-214`，`gate=goal`，共 5618 条）：

- 最后一次 **pass** = `2026-09-24T02:46:28.774Z`（reason 逐字 `acceptance passed (exit 0)`）。
- 其后第一条 **fail** = `2026-09-24T02:48:24.110Z`，reason 逐字 `… GOAL-009-AC-238:204/200 (margin -4), GOAL-009-AC-239:204/200 (margin -4)`。
- 自该时刻起至 `2026-09-25T04:03:23.761Z`：**fail=790 / pass=0**，margin 由 −4 加深到 −37。

### 成因：第七次刚建的升级通道，对【曾被立案过的主体】结构性不可达

第七次（`gap-ac214-seventh-crossing-blocked-remedy-has-no-consumer`，已 done）交付的机制本身是对的：`remedy_availability = blocked` ⇒ 不得产出与「可在本处执行」同形的 `ready`，改走人可见通道 `needs-human`。**它对该轮命中的 5 个 coldstart-face 主体确实生效了**（`.quay/routine-findings.jsonl`，runId `freshness-refresh-1790308195712`，`filed` 与 `escalated` 各 5 条，逐条 `status: needs-human`）。

**但对 AC-238/239 —— 也就是判据此刻唯二越界的主体 —— 它一次都没生效过。** 该轮同一条 `filing-round` 记录逐字：

```
REJ: freshness-goal-009-ac-238-upgrade-face | quality-dedup-rate | dedup: an equivalent finding is already on the board (matched key: symbols:goal-009-ac-238,upgrade-face)
REJ: freshness-goal-009-ac-239-upgrade-face | quality-dedup-rate | dedup: an equivalent finding is already on the board (matched key: symbols:goal-009-ac-239,upgrade-face)
```

⇒ **它在 `quality-dedup-rate` 这一道就被 dedup 挡下，`blocked-repeat`（`probe-routine.ts:407`）与 `gateEscalation`（`:419`）这两条升级分支从未被执行到。** 自第七次落地以来**每一轮都是这个形态**：连续 5 个 filing-round（`03:38:20` / `03:41:47` / `03:46:19` / `03:48:25` / `03:49:55`）里，238/239 无一轮例外，而同一轮的 coldstart-face 五条全部成功升级。

**匹配键的供给者是谁 —— 用真机件算出，⛔ 不靠读键名推断**：

```
node --experimental-strip-types  (import routine-file-gate.ts 的 boardKeys / findingKey)
boardKeys("/data/home/yale/work/quay/tasks", null)   → 511 键
  其中 symbols 前缀键 29 个；**27 个由 done 任务供给**；distinct done-owned symbols 键 **24** 个
逐键定位：
  symbols:goal-009-ac-238,upgrade-face  <- tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face.md   status: done
  symbols:goal-009-ac-239,upgrade-face  <- tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-239-upgrade-face.md   status: done
```

`boardKeys()`（`plugin/scripts/routine-file-gate.ts:298`）的实现**只有 `excludePath` 一个维度（排除候选自身），⛔ 没有 status 维度**：

```ts
export function boardKeys(boardDir: string, excludePath: string | null = null): Set<string> {
  const keys = new Set<string>();
  ... for (const f of files) { ... const k = findingKey(fs.readFileSync(abs, "utf8")); if (k) keys.add(k); }
```

⇒ **一条 `done` 的 routine 立案永久占住它的符号键**；此后任何**同一主体、符号集合逐字相同**的 finding 都永远过不去 dedup，**包括第七次专门为它建的那条升级通道**。对 `freshness-refresh` 这条轨道，这个语义是反的：它的 finding 说的不是一个「修一次就没的缺陷」，而是一个**会随 develop 前进永远重新变陈旧的状态**——用 done 把它封印，等于把「处理过一次」变成「从此不再看它」。**这正是本 AC 自己的主题（「一旦转绿即永久绿」）在 dedup 空间的同构形态。**

**双向对照（硬规则 4 推论四：给不出对照就降为假说）** —— 同一条候选文本、同一份 `boardKeys`，只把 done-owned 键移除：

```
AS-IS   gateEscalation(cand, {existingKeys: boardKeys(...)})
        ⇒ {accept:false, reason:"dedup: an equivalent finding is already on the board (matched key: symbols:goal-009-ac-238,upgrade-face)"}
CONTROL gateEscalation(cand, {existingKeys: boardKeys(...) − doneOwned})
        ⇒ {accept:true,  reason:"accepted: actionable, novel — routed to the HUMAN-VISIBLE channel (its own throttle: one open escalation per subject while the reading is unchanged)"}
```

⇒ 判别式成立：**done 键是唯一阻断项**；移除它，升级立即被接受。⛔ 不是「候选本身不合格」（它属 `isActionable` 通过面）。

**为什么前几次修复没兜住（同族第 8 次，⛔ 不是第 1 次）**：

- 第 7 次的**测试**用的是夹具（`plugin/test/freshness-refresh-remedy-availability.test.mjs` 自建 board），夹具里**没有 done 任务** ⇒ 「done 键沉淀」这个形态在夹具里**结构上不可能出现**（硬规则 4 推论三：只能被夹具满足的判据不是测量）。
- 第 7 次的**生产读数**恰好吃在符号集合**漂移过**的主体上：coldstart-face 候选的符号集是 `symbols:coldstart-face,develop-deliver-tgz.sh[,…]`（多符号），板上 done 键是单符号或别的组合 ⇒ **精确匹配落空 ⇒ 升级通过**。238/239 的候选符号集**恰好逐字等于**两条 done 键 ⇒ 升级被吞。
  ⇒ 符号键由 LLM 探针**自发产出**（`findingSubjectKey` 读 `观测符号` 行），会漂移 ⇒ 同一条机制**时灵时不灵**，而「不灵」的那一半正好落在**唯一真红的主体**上 —— 硬规则 4b 的形态：一个诚实的读数与「一切照旧」同形。
- 更早的同类修复（`exp5-DEFECT-ROUTINE-GATE-SELF-REJECT`，done）只加了 `excludePath`（候选自身豁免），**status 维度从未被考虑过**。

### 一般形态（硬规则 5b：缺陷成簇，⛔ 不止被观测到的那一条）

「done 键永久沉淀」不是 238/239 的专属：实测 **24 个 distinct done-owned symbols 键**，覆盖 `semantic-dedup-scan` 与 `freshness-refresh` 两条轨道。对 `freshness-refresh` 它是**正确性缺陷**（状态型 finding 被永久封印）；对 `semantic-dedup-scan` 它至少是**未声明的残余**（修复类 finding 的复现被静默吸收）。⇒ 本案修完必须**在同一载体里数出「done 供给的键」这个量并给出新读数**，⛔ 不得只报 238/239。

<!-- dedup-ref -->
**相关但不同（仅为溯源，⛔ 不是前置、⛔ 不构成依赖）**：`tasks/gap-prose-prereq-refs-should-exclude-done-referenced-tasks.md`（已 done，2026-09-18）在**兄弟子系统的同一原则**上修过一次 —— `ready-pool-check.ts` 的 `prosePrereqRefs.add()` 只跳过 `superseded`、不跳过 `done`，导致引用了已完成任务的散文句把任务永久拦在晋升闸外。本案是**同一原则**（`done` 不得充当永久阻断项）在**另一处载体**（`routine-file-gate.ts` 的 `boardKeys()`，消费点是 routine 立案链而非晋升链）上的**未传播实例** —— 该修复当时没有沿载体扫同族适用点（硬规则 5b）。

### ⛔ 本任务不做的事

⛔ 不改 K / `criterion` / `expect` / `goals/`；⛔ 不手写、搬运或伪造任何证据记录；⛔ 不删任何 done 任务；⛔ 不新增 needs-human 成因枚举或「可机械再入队」路径（人 2026-09-20 裁定，该三态枚举已于 `plugin/scripts/driver-filters.ts:853` 整套退役）。

## Requested action

1. **给 routine 立案链的 dedup 空间加 status 维度**：一条 finding 的键若**只**由 `done` / `superseded` 任务供给，则**不得**成为阻断项 —— 因为「该主体曾被处理过」不是「该主体此刻仍有未处理的等价工作」。落地面 = `routine-file-gate.ts` 的 `boardKeys()`（返回键→拥有者状态的映射，或新增一个 live-only 的取键函数）；消费点 = `gateFinding`（`:254`）与 `gateEscalation`（`:281`）。**升级通道必须与派发通道分开判**：升级的对象是「状态**仍然**陈旧」，done 键对它**没有**语义。
2. **保持「同一主体在读数不变时不重复升级」这条既有闸**（`escalationMarkerByKey` `:681` + `probe-routine.ts:407` 的 `blocked-repeat`）—— 它是**按身份**的上界（≤ |tracked subjects|），⛔ 不因本改动被放宽。
3. **可区分性（硬规则 3b）**：dedup 判定必须能区分三态 —— ①被 **live**（`todo`/`ready`/`needs-human`）等价 finding 挡住（真去重，照旧 reject）；②**仅有 done 键**（**不得**挡住，且该事实必须可在 reason / 载体上读出）；③**拥有者状态读不出**（NOT-EVALUATED，⛔ 不与 ① 或 ② 同形）。
4. **一般化产物（硬规则 5b）**：修完给出「done 供给的键」的新读数与前后对照，⛔ 不只报 238/239。
5. **双向负控制**：① 存在一条 live 等价 finding ⇒ **照旧 reject**（证明不是把 dedup 关掉）；② 只有 done 键 ⇒ **accept 且走人可见通道**；③ `exp5-DEFECT-ROUTINE-GATE-SELF-REJECT` 的候选自豁免臂保持绿。
6. **生产读数（硬规则 4 推论三）**：修复落地后**真实**一轮 `freshness-refresh`（常驻 driver 调度，⛔ 不是夹具、⛔ 不是 `--selfcheck`）在 `.quay/routine-findings.jsonl` 里**不再**出现 `freshness-goal-009-ac-238-upgrade-face | quality-dedup-rate | dedup:` 形态，而出现该主体经升级通道落 `needs-human` 的记录。

## AC

- [x] AC1 改前读数（能取假，⛔ 引述不算、须复跑）：`node packages/quay/bin/quay.js goal gate AC-214 --dry-run --json` ⇒ `verdict: "fail"`，reason 逐字含 `GOAL-009-AC-238:237/200 (margin -37)` 与 `GOAL-009-AC-239:237/200 (margin -37)`；贴 stdout 七行 + `.quay/goal-freshness-margin.json` 全文 + 载体行数与 `ts >= 2026-09-23` 计数。

  **本轮复跑（2026-09-25T04:11:01.008Z；两次独立跑 —— 带 `--json` 与不带 —— 输出逐字相同；`--dry-run` 不 append）**，判据块（stdout 前 7 行）：
  ```json
  {
    "id": "AC-214",
    "verdict": "fail",
    "cause": null,
    "reason": "acceptance failed (exit 1) — stale evidence: GOAL-009-AC-238:237/200 (margin -37), GOAL-009-AC-239:237/200 (margin -37)",
    "timeoutMs": 60000,
    "timestamp": "2026-09-25T04:11:01.008Z",
    "dryRun": true,
  ```
  `.quay/goal-freshness-margin.json` 全文（`2026-09-25T04:11:04Z`）：
  ```json
  {"at": "2026-09-25T04:11:04Z", "k": 200, "subjects": {"GOAL-009-AC-201": {"K": 200, "d": 189, "margin": 11}, "GOAL-009-AC-203": {"K": 200, "d": 189, "margin": 11}, "GOAL-009-AC-205": {"K": 200, "d": 189, "margin": 11}, "GOAL-009-AC-207": {"K": 200, "d": 189, "margin": 11}, "GOAL-009-AC-232": {"K": 200, "d": 189, "margin": 11}, "GOAL-009-AC-238": {"K": 200, "d": 237, "margin": -37}, "GOAL-009-AC-239": {"K": 200, "d": 237, "margin": -37}}}
  ```
  载体 `.quay/productization-verification.jsonl`：**291** 行，末条 `ts` = `2026-09-20T13:50:36Z`，`ts >= 2026-09-23` 的记录数 = **0**。

- [x] AC2 回归而非恒红：贴 `.quay/gate-events.jsonl` 中 `item_id=AC-214` 的最后一条 `pass` 与其后第一条 `fail` 两个时刻，及 `fail=790 / pass=0` 的计数。

  **实跑**（`node -e` 读 `.quay/gate-events.jsonl`，筛 `item_id === "AC-214" && gate === "goal"`）：
  - 最后一条 **pass** = `2026-09-24T02:46:28.774Z`，payload 逐字 `{"reason":"acceptance passed (exit 0)"}`。
  - 其后第一条 **fail** = `2026-09-24T02:48:24.110Z`，payload 逐字 `{"reason":"acceptance failed (exit 1) — stale evidence: GOAL-009-AC-238:204/200 (margin -4), GOAL-009-AC-239:204/200 (margin -4)"}`。
  - 自该 pass 起至 `2026-09-25T04:11Z`：**fail = 792 / pass = 0**（总事件 5620；立案时读数为 5618 / fail 790 —— 差的 2 条是**常驻 goal-driver 自己在 04:03→04:11 之间又跑的两轮**，⛔ 不是本轮复跑写的：实测 `.quay/gate-events.jsonl` 里 `2026-09-25T04:11:0x` 的事件数 = **0**）。

- [x] AC3 成因具名到机件：用**真机件**（import `routine-file-gate.ts` 的 `boardKeys` / `findingKey`）算出并贴出 `symbols:goal-009-ac-238,upgrade-face` 与 `symbols:goal-009-ac-239,upgrade-face` 两个键的**拥有者文件路径与 `status:`**（均 `done`），以及「symbols 键 29 / done 拥有 27 / distinct done-owned 24」三个计数；贴 `boardKeys()` 里**没有 status 维度**的那几行源码。

  **改前复跑**（脚本 import **主检出** `plugin/scripts/routine-file-gate.ts`，root = `/data/home/yale/work/quay`，即生产板；修订 `04e41f0bb818be48a2b7e7d5cca8a68b0c9239e1`）逐字：
  ```
  boardKeys() size: 512
  symbols-prefixed keys: 26
  symbols keys with >=1 done/superseded owner: 24
  symbols keys whose owners are ALL done/superseded: 24
  distinct done-owned task FILES supplying a symbols key: 27

  key symbols:goal-009-ac-238,upgrade-face
    in boardKeys(): true
    owners: [{"file":"gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face.md","status":"done"}]

  key symbols:goal-009-ac-239,upgrade-face
    in boardKeys(): true
    owners: [{"file":"gap-routine-freshness-refresh-freshness-goal-009-ac-239-upgrade-face.md","status":"done"}]
  ```
  ⚠️ 与立案文本的两处数字差已如实对齐：立案时（04:03）读的是 `symbols 29 / ≥1 done 27 / all-done 24`，本轮（04:11）是 `26 / 24 / 24` —— 差量来自**板在两次读数之间被常驻 loop 改动**（键数即 `boardKeys()` 自己报的 512 vs 511）；**不变量未变**：两个键的拥有者都**只有**那一条 `status: done` 的任务。⚠️ 另如实更正立案文本的一处标签错误：`27` 是 **distinct done-owned FILES**（键的供给文件数），`24` 才是**键数** —— 本案复跑把两个量都数了出来，上述输出即两者的正确标注。

  `boardKeys()` 改前源码（`plugin/scripts/routine-file-gate.ts:294-314`，⛔ 函数体内无任何 `status` 读取）：
  ```ts
  export function boardKeys(boardDir: string, excludePath: string | null = null): Set<string> {
    const keys = new Set<string>();
    let files;
    try { files = fs.readdirSync(boardDir).filter((f) => f.endsWith(".md")); } catch { return keys; }
    let skip = null;
    if (excludePath) { try { skip = fs.realpathSync(path.resolve(excludePath)); } catch { skip = path.resolve(excludePath); } }
    for (const f of files) {
      try {
        const abs = path.join(boardDir, f);
        let absReal; try { absReal = fs.realpathSync(abs); } catch { absReal = path.resolve(abs); }
        if (skip && absReal === skip) continue;
        const k = findingKey(fs.readFileSync(abs, "utf8"));
        if (k) keys.add(k);
      } catch { /* skip */ }
    }
    return keys;
  }
  ```

- [x] AC4 双向对照：同一条候选文本 + 同一份 `boardKeys`，贴 `gateEscalation` 的 AS-IS（reject，matched key 逐字）与 CONTROL（移除 done-owned 键 ⇒ accept，reason 逐字含 HUMAN-VISIBLE channel）两次实跑输出。

  **改前实跑**（同 AC3 的脚本；候选文本 = 从**生产载体** `.quay/routine-findings.jsonl` 的 `finding` 记录（runId `freshness-refresh-1790308195712`）逐字重建，经 `routineFindingCandidateText` 渲染 ⇒ key `symbols:goal-009-ac-238,upgrade-face`）：
  ```
  AS-IS   gateEscalation ⇒ {"accept":false,"reason":"dedup: an equivalent finding is already on the board (matched key: symbols:goal-009-ac-238,upgrade-face)"}
  CONTROL gateEscalation (done-owned keys removed; 504 removed) ⇒ {"accept":true,"reason":"accepted: actionable, novel — routed to the HUMAN-VISIBLE channel (its own throttle: one open escalation per subject while the reading is unchanged)"}
  ```
  **改后实跑**（同一候选文本、**同一条板**，机件换成本案的修复修订）：
  ```
  POST-FIX gateEscalation ⇒ {"accept":true,"dedup":{"state":"done-only","key":"symbols:goal-009-ac-238,upgrade-face","owners":[{"file":"gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face.md","status":"done"}],"block":false,"reason":"not an open duplicate: the board holds 'symbols:goal-009-ac-238,upgrade-face' only under CLOSED task(s) (…[status: done]) ⇒ 「该主体曾被处理过」 is not 「该主体此刻仍有未处理的等价工作」"},"reason":"accepted: actionable, novel — routed to the HUMAN-VISIBLE channel (its own throttle: one open escalation per subject while the reading is unchanged) · …"}
  POST-FIX gateFinding    ⇒ {"accept":true,…同上 dedup 读数…,"reason":"accepted: actionable, novel, within rate — not an open duplicate: …"}
  ```
  ⇒ 判别式成立且**两条通道各自判**：done 键是唯一阻断项；移除它（改前 CONTROL）与给判定装上 status 维度（改后 POST-FIX）**得到同一个接受**，而 accept 的理由里逐字带着「板上只有已关闭任务」。

- [x] AC5 机制落点（file:line）+ 三态可区分 + 双向负控制：给出 status 维度在消费点的落点；测试文件里「live 等价 finding ⇒ reject」「只有 done 键 ⇒ accept 并走人可见通道」「拥有者状态读不出 ⇒ 独立取值」三臂**各自能取假**（贴变异检验：把 status 维度改坏 ⇒ 对应用例红）。

  **落点（`plugin/scripts/routine-file-gate.ts`，行号取本任务提交 `016a7a4b9`）**：
  - `:342` / `:345` — `LIVE_TASK_STATUSES = [todo, ready, needs-human]` / `CLOSED_TASK_STATUSES = [done, superseded]`（两套词表分开声明，⛔ 不合并）。
  - `:363` `readTaskStatus(text)` — 从 frontmatter 读 `status:`；读不出 ⇒ `null`（第三值，⛔ 不与状态串同形）。
  - `:376` `boardKeyState(owners)` — 三态分类，优先级 `live` > `unknown` > `done-only`（一条 OPEN 拥有者是确定读数；`unknown` 排在 `done-only` 之前 ⇒ 「有已关闭 + 有读不出」fail-closed，⛔ 不谎报「只有已关闭的」）。
  - `:390` `class BoardKeys extends Set<string>` — **仍是 `Set<string>`**（既有调用面逐字不变），另带 `owners: Map<键, {file,status}[]>` 与 `readable`；两个读法同住一个对象 ⇒ 不会漂移（硬规则 5b）。
  - `:409` `boardKeys(boardDir, excludePath)` — 每个键记下**每个**供给文件的 `status`。
  - `:451` `dedupReading(existingKeys, key)` — **唯一**的去重判定（`novel` / `done-only` / `live` / `unknown` + `block` + 逐字 reason）。
  - **消费点**：`gateFinding` `:254`（`const dedup = dedupReading(...)` `:260`）与 `gateEscalation` `:292`（`:299`）；routine 侧 `plugin/scripts/probe-routine.ts:384`（`boardKeys(o.tasksDir)` 的返回值原样传下去，⛔ 不拷贝成裸 Set）、`:339`（`FilingDisposition.dedup`）、`:468`（接受面带上读数）、`:1007`（`filing-round.dedup_state` ⇒ 该事实**在载体上可读出**）。
  - ⛔ 未放宽：`escalationMarkerByKey`（`:681` 改前 / 本提交未改动）与 `blocked-repeat` 一字未动。

  **三臂测试 + 变异检验**（`plugin/test/routine-file-gate.test.mjs` ⑪⑫⑬⑭、`plugin/test/freshness-refresh-remedy-availability.test.mjs` 两条）：
  - 基线全绿：`node --no-warnings --test --experimental-strip-types plugin/test/routine-file-gate.test.mjs` ⇒ `tests 14 / pass 14 / fail 0`；freshness 文件 ⇒ `tests 16 / pass 16 / fail 0`。
  - **变异①（删掉 `unknown` 态：读不出 ⇒ 谎报 `done-only`）** ⇒ ⑪ + ⑭ 红（另带两条既有用例同时红：`RETRO-FIT`、`gateFinding: a re-found subject …` —— 它们依赖同一维度的 fail-closed 语义）。
  - **变异②（把 `done-only` 改回 `block: true`，即修复前的行为）** ⇒ ⑪ + ⑫ + ⑬ 红，且 `freshness-refresh-remedy-availability.test.mjs` 的「DONE task 已占住符号键 ⇒ 升级不被吞」红。
  - **变异③（把 `live` 改成 `block: false`，即把 dedup 关掉）** ⇒ ⑪ + ⑫ 红，且 freshness 的**反向控制**（同一块板、把该任务改成 OPEN ⇒ 照旧 dedup 拒绝）红。
  ⇒ 三臂各自**能取假**，且「修好 done 键沉淀」与「把真去重关掉」在用例上**分开**（②与③红的是不同用例）。三处变异均已还原（`routine-file-gate.ts` md5 `1cf41b51961db57551308e6789b1da3a`，与提交内容一致）。

- [x] AC6 生产读数：修复落地后**真实**一轮 `freshness-refresh` 在 `.quay/routine-findings.jsonl` 留下该主体经升级通道落 `needs-human` 的记录（贴命令、runId、记录全文、任务 `status:`）。

  <!-- dedup-ref -->
  **命令（常驻 driver 的同一条生产入口，⛔ 不是夹具、⛔ 不是 `--selfcheck`；取证方式逐字披露）**：
  ```
  node --no-warnings --experimental-strip-types .quay/ac214-eighth/run-real-round.mjs
  # 脚本唯一作用 = 调 probe-routine.ts 导出的生产入口 probeRoutinesFromConfig（quality-gate-driver
  # 的 Layer-1b 例程表用的就是它），root=主检出、pluginRoot=本任务 worktree/plugin
  ```
  ⚠️ 披露：`root` = **主检出** ⇒ 载体是**生产载体**、板是生产 `tasks/`、mapping 是生产 mapping；探针是**真的 fresh-context LLM spawn**（`launchArgv(role=meta-driver, …)`，⛔ 未注入读数 / ⛔ 未注入探针 argv / ⛔ 未注入 `fileTaskFn`）；唯一被替换的是**代码修订**（pluginRoot 指向本任务 worktree，即既有先例 `--script-root <worktree> --root <main-checkout>` 的语义）。另披露两处**调度游标**动作：为让例程 due，两次各清空 `.quay/routine-last-run.json` 里 `freshness-refresh` 的游标（该文件 gitignored；改前全文已存档 `.quay/ac214-eighth/routine-last-run.before.json`），每轮结束后由例程自己写回。**锚定**：本轮执行的 `routine-file-gate.ts` 与提交 `016a7a4b9` **逐字节相同**（`git show 016a7a4b9:plugin/scripts/routine-file-gate.ts | md5sum` = `1cf41b51961db57551308e6789b1da3a` = 运行时 md5）——⛔ 不靠时间戳。

  **runId = `freshness-refresh-1790309953418`**（ts `2026-09-25T04:19:13.418Z`，探针真跑 `durationMs 71142`，`exit 0`，`carrierCommit: committed`）。该轮 `filing-round` 记录全文（`.quay/routine-findings.jsonl:983`，逐字）：
  ```json
  {"ts":"2026-09-25T04:19:13.418Z","kind":"filing-round","routine":"freshness-refresh","probe":"freshness-refresh","runId":"freshness-refresh-1790309953418","evaluated":true,"candidates":7,"filed":["gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face-8c2414da","gap-routine-freshness-refresh-freshness-goal-009-ac-239-upgrade-face-8c2414da"],"escalated":["gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face-8c2414da","gap-routine-freshness-refresh-freshness-goal-009-ac-239-upgrade-face-8c2414da"],"remedy_availability":"blocked","rejected":[{"findingId":"freshness-goal-009-ac-201-coldstart-face","gate":"blocked-repeat","reason":"blocked-repeat: subject:GOAL-009-AC-201 is already escalated to the human-visible channel (tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-201-coldstart-face.md) and remedy availability is still 'blocked' (probe 'host-b-ssh') ⇒ not re-filing"},{"findingId":"freshness-goal-009-ac-203-coldstart-face","gate":"blocked-repeat",…},{"findingId":"freshness-goal-009-ac-207-coldstart-face","gate":"blocked-repeat",…},{"findingId":"freshness-goal-009-ac-232-coldstart-face","gate":"blocked-repeat",…},{"findingId":"freshness-goal-009-ac-205-session-delivery","gate":"blocked-repeat",…}],"dedup_state":[{"findingId":"freshness-goal-009-ac-238-upgrade-face","taskId":"gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face-8c2414da","accepted":true,"state":"done-only","matchedKey":"symbols:upgrade-face","reason":"accepted: actionable, novel — routed to the HUMAN-VISIBLE channel (its own throttle: one open escalation per subject while the reading is unchanged) · not an open duplicate: the board holds 'symbols:upgrade-face' only under CLOSED task(s) (gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238.md [status: done]) ⇒ 「该主体曾被处理过」 is not 「该主体此刻仍有未处理的等价工作」 — ⛔ a finished task does not close the READING · remedy availability 'blocked' ⇒ the requested action is not performable from this host"},{"findingId":"freshness-goal-009-ac-239-upgrade-face","taskId":"gap-routine-freshness-refresh-freshness-goal-009-ac-239-upgrade-face-8c2414da","accepted":true,"state":"done-only","matchedKey":"symbols:upgrade-face","reason":"…同上…"}],"errors":[]}
  ```
  ⇒ **该主体不再被 done 键以 `dedup:` 挡下**：`rejected` 里没有任何 `dedup:` 条目（5 条全是 `blocked-repeat`，即第七次的按身份上界仍在工作），而 `dedup_state` 逐条写着 `state: "done-only"` / `matchedKey` / 逐字理由 —— **该事实在载体上可读出**（硬规则 3 的『② 必须可在 reason / 载体上读出』）。

  <!-- dedup-ref -->
  **产物状态**（主检出 `tasks/`，`grep -m1 '^status:'`）：`gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face-8c2414da.md` ⇒ `status: needs-human`；`…-239…-8c2414da.md` ⇒ `status: needs-human`。两条标题均带 `[remedy-blocked]`，体内第一行为升级标记 `- remedy-availability：`blocked` · subject：`GOAL-009-AC-238` · host-execution-probe：`host-b-ssh``，并逐字携带 `## Requested action` 的补救（目标机 / `authorized_keys` / mapping 自己的 producer 命令）——⇒ **第一次到达人面前**。

  <!-- dedup-ref -->
  **紧随其后的一轮**（runId `freshness-refresh-1790310119306`，ts `2026-09-25T04:21:59.306Z`，代码修订 = **提交 `016a7a4b9`**）：7 条**全部** `gate: "blocked-repeat"`（reason 逐字含 `subject:GOAL-009-AC-238 is already escalated to the human-visible channel (tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face-8c2414da.md)…`），`filed: []` / `escalated: []` / `dedup_state: []` ⇒ **「同一主体在读数不变时不重复升级」这条既有闸在生产上仍然生效**（Requested action 2 的读数，⛔ 不是夹具）。

- [x] AC7 未改判据本体：`git diff --exit-code -- goals/` 为空；跑判据前后 `md5sum .quay/productization-verification.jsonl` 相同。

  **实跑**：
  ```
  $ git diff --exit-code -- goals/   ⇒ exit 0（空）
  $ md5sum .quay/productization-verification.jsonl   ⇒ 3617e696d0d374bc140d0938c106b9a1  (291 行)
  $ node packages/quay/bin/quay.js goal gate AC-214 --dry-run   ⇒ verdict: "fail"（判据照跑）
  $ md5sum .quay/productization-verification.jsonl   ⇒ 3617e696d0d374bc140d0938c106b9a1  (291 行)
  ```
  ⚠️ 两次复跑（`04:11` 与 `04:23`）的 margin 读数为 −37 → **−46**（`GOAL-009-AC-238:246/200`）：这是**并行的外部条件**（loop 每轮都在推进 develop），⛔ 不是本任务的 DoD —— 本条只断言**判据本体未被改动**、**载体 md5 不变**，两者都成立。⛔ 未改 K / `criterion` / `expect`、⛔ 未删主体、⛔ 未删任何 done 任务、⛔ 未新增 needs-human 成因枚举或再入队路径。

## DoD

`boardKeys` / dedup 空间已带 status 维度并在**生产的立案链**里改变结果 —— 落地后真实一轮 `freshness-refresh` 中 AC-238/239 的 finding **不再**被 done 键以 `dedup:` 挡下，而是经升级通道到达人可见通道（`needs-human`，逐字携带补救）；「live 等价 finding 存在 ⇒ 照旧 reject」臂**能取假**（⛔ 不是把 dedup 关掉）；拥有者状态读不出时有**独立取值**（硬规则 3b）；给出「done 供给的键」的新读数与前后对照（硬规则 5b）；`goals/` 零 diff、载体 md5 不变。

⛔ 不接受的替代物：改 K / 删主体 / 改 `expect` 或 `criterion`；手写或搬运证据记录；**把 done 键从 `boardKeys()` 里整体删掉**（那会把真去重一起拆掉 —— 三态可区分是硬要求）；放宽 `blocked-repeat` / `escalationMarkerByKey`；新增 needs-human 成因枚举或再入队路径；只把读数写进 notes 散文；把 AC6 降格成夹具读数。

⚠️ **本 AC 本体（AC-214）在外部授权解除前仍会红**：刷新 AC-238/239 的载体证据需要一台被 B 授权的主机（本机 `ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men true` ⇒ `Permission denied (publickey,password).`，rc=255）。这是一个**并行的外部条件**，⛔ 不是本任务的 DoD；本任务修的是**为什么这件事从来没有到达过人面前**。⛔ 不得以「修完判据还是红」为理由不修。

## Touches

- `plugin/scripts/routine-file-gate.ts`
- `plugin/scripts/probe-routine.ts`
- `plugin/test/routine-file-gate.test.mjs`
- `plugin/test/freshness-refresh-remedy-availability.test.mjs`
- `tasks/gap-ac214-eighth-crossing-done-key-permanently-suppresses-escalation.md`
