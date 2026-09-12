---
id: gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass
title: achieved 判据在最后一次记录后失效时对所有机制不可见——AC-242 检「被记录的失败」而非「当前为假」，实测 4 条已红
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

**「achieved 却已失效」目前只有在【被重跑过】之后才可见；从未被重跑者的失效，对所有机制都不可见。**

两个机制各覆盖一半，缺口正好落在中间：

- **I5 复验域**（`goal-store.ts` `checkAchievedFailing`）只收「活跃 goal 名下 ∪ 显式 `long-term: true`」的 achieved AC。goal 一关闭，其未声明的 AC 即离域，此后不再被跑。
- **AC-242** 判「冻结的 achieved 却失败」时读的是**台账尾事件**（`.quay/gate-events.jsonl` 中该 AC 的最后一条 `verdict`）。尾事件为 `pass` 时它判通过——**而尾事件只反映最后一次被跑的结果，不反映判据当前是否为真**。

⇒ 一条 AC 在最后一次记录之后才失效，就同时逃出两者：域外不跑它，台账里它还是 pass。

## Evidence

2026-09-12 实测（逐条真跑判据，⛔ 非推断）：

- 已关闭 goal 名下、`status: achieved`、未标 `long-term`、且有非空判据的 AC 共 **79 条**（分布：GOAL-001 11 / GOAL-002 13 / GOAL-003 13 / GOAL-007 4 / GOAL-008 6 / GOAL-009 8 / GOAL-010 12 / GOAL-011 3 / GOAL-012 5 / GOAL-013 3 / GOAL-015 1）。
- 把这 79 条逐条跑一遍：exit 0 = 75，**exit 1 = 4**，NOT-EVALUATED = 0。
- 这 4 条**当前为假**，而它们的台账尾事件**全是 `pass`**：

| AC | goal | 实跑 | 台账尾事件 | 尾事件距今 | 失败输出 |
|---|---|---|---|---|---|
| AC-147 | GOAL-002 | exit 1 | pass | 112h | `ERR_MODULE_NOT_FOUND` |
| AC-149 | GOAL-002 | exit 1 | pass | 112h | `ERR_MODULE_NOT_FOUND` |
| AC-172 | GOAL-001 | exit 1 | pass | 70h | **无任何输出** |
| AC-228 | GOAL-012 | exit 1 | pass | 42h | **无任何输出** |

⇒ AC-242 对这 4 条**结构上不可能报红**（它读 pass），I5 也不跑它们（域外）。其中 2 条还是静默失败，即便被跑到也无成因可归。

**与既有两条任务的分工（⛔ 不重复）**：`gap-meta-inachievedreverifyscope` 处理的是把 `long-term` 声明落到具体字段上（对象是 AC-217）；`gap-meta-goal-store-activation-gate` 处理的是激活写面缺少「名下至少一条 AC」这道闸。本条处理的是**第三件事**：AC-242 的判定口径——它检「被记录的失败」，而非「当前为假」。

### 落地后的生产读数（2026-09-12，`--root /home/yale/work/quay`，非夹具）

瓶颈是「判定无法凭台账得知判据当前真假——**那需要跑**」，故修法的一半是**动作**（有界轮转），另一半是判定读它：

1. **动作**：`goal-store check --stale-pass --sweep --budget 200 --min-age-ms 0` 对当时 M=80 条冻结 AC 跑一轮（`eligible 80 / ran 80 / stoppedBy exhausted`，用时约 2min）。
2. **判定**（纯读，即 AC-242 判据调用的那一支）：`exit 1`，stderr 逐字
   `stale-pass: frozen achieved AC(s) whose criterion is CURRENTLY false: AC-147, AC-149, AC-172, AC-228`
   —— **与上表四条逐字相同、且只报这四条**（`verifiedFresh 76 / staleUnverified 0 / neverGated 0`）。⛔ 不是推断：四条的台账尾事件由 `pass`（112h/112h/70h/42h 前）变为本轮 `actor=goal-sweep` 的 `fail`。
3. **改前不可见性的双侧控制**（同一形态，hermetic 夹具 `packages/quay/test/goal-store.test.mjs`）：`check --achieved-failing` 的 `achievedButFailing` 不含它；`check --reverify-scope` 把它列在 `outOfScope`；而把它**存储的**判据真跑一次 ⇒ `exit 1`。
4. **改后双向控制**：同一条为假 ⇒ `failing:["AC-900"]` 且 stderr 点名；同夹具的健康条（尾事件 pass ∧ 实跑 exit 0）⇒ `verifiedFresh`，⛔ 不被一并判红。
5. **AC5 存量四条的终态取证**：AC-147/AC-149 回读 `status: superseded`（提交 `04ad77293` / `3d9cf5d07`）；AC-172/AC-228 判据重写后**在落地树内实跑 `rc=0`**（807ms / 1799ms）。
6. **AC6 双向负控制**（判据失败时 stderr 非空）：AC-172 把 `GS` 指向不存在的 store ⇒ `rc=1`、stderr **931 字节**，首行 `CAUSE=write-failed — …`；AC-228 把钉住的 root 指向不存在目录 ⇒ `rc=1`、stderr **737 字节**，首行 `CAUSE=fixture-test-failed(rc=1) — …`。

## 修法与成本上界（AC2 要求写进任务体）

判据无法凭台账得知判据当前真假 —— **那需要跑**；而「把 79 条无差别纳入每轮复跑」是 `goal-store.ts` 注释明令禁止的无差别放宽。故修法 = **有界轮转**（动作）**+ 纯读判定**（判据）：

- `check --stale-pass --sweep`：重跑冻结population 中**最久未被轮转验证**的至多 `budget` 条，verdict 以 `actor=goal-sweep` 落进**同一本台账** ⇒ ⛔ 无新状态文件、**无游标可漂移**（下次调用的资格由这些事件自身导出，天然可续）。
- `check --stale-pass`（无 `--sweep`）：**纯读**，零 criterion 执行 —— 这是 AC-242 判据每轮调用的那一支。
- 接线：`goal-driver` pass 1c 每轮调一次（放在 pass 2 刷台账尾**之前**，使本轮 verdict 进入关闭判定）。

**成本上界（实测导出，⛔ 非凭空设阈值——硬规则 4）**：本仓冻结population **M=81**（含 4 条存量），单线程真跑 21 条样本得 **avg 1.31s/条**（两个离群 7.4s / 10.6s）。

- 每次调用 ≤ `min(DEFAULT_SWEEP_BUDGET × SWEEP_CRITERION_TIMEOUT_MS, DEFAULT_SWEEP_WALL_MS)` = `min(6×60s, 30s)` = **≤ 30s**（超墙钟即早停，余下由下次调用接手）。
- 稳态 ≈ `M × 1.31s / DEFAULT_SWEEP_MIN_AGE_MS` = 81×1.31s/1h ≈ **106s/小时 ≈ 一个核的 3%**。
- 一次全轮 ≈ `M × 1.31s` ≈ **106s ≈ 1.8min CPU**，按 1h 周期摊薄。
- **已记录的 `fail` 更早重查**（`minAgeMs / DEFAULT_FAIL_RECHECK_DIVISOR(6)`）：⛔ 只改**资格顺序**，每次调用的条数/墙钟上界不变（持久失败集最多挤占同一 budget，⛔ 不会超）。

三个旋钮的字面值与算式只写在 `packages/quay/src/goal-store.ts` 的 `DEFAULT_SWEEP_MIN_AGE_MS` 块注释里一处（⛔ 两处各写一份即漂移）。

**同时修掉一处同族缺陷（顺带，非同一条 AC）**：`check` 的**未知 flag 此前会静默回落到 `checkWithinCap` 并 exit 0** —— 那正是「读不懂输入」与「合格」同形（硬规则 3b），在「判据已落盘而代码未跟上」的激活窗口内尤其危险。现改为 fail-closed `exit 2` 并点名 flag。

## AC

- [x] AC1（缺口复现，可取假）：已复现。生产读数：轮转前 `failing: []`（尾事件 pass）；hermetic 夹具侧三条同时成立 —— `check --achieved-failing` 不含它、`check --reverify-scope` 把它列进 `outOfScope`、而把它**存储的**判据真跑 ⇒ `exit 1`。⛔ 非推断，判据是真跑的。
- [x] AC2（修法）：判定不再单靠台账尾事件 —— 尾事件由**有界轮转**（`actor=goal-sweep`）供给，判定另把「轮转写过且在 4h 内」与「尾事件 pass 但无人近期看过」拆成 `verifiedFresh` / `staleUnverified` 两个**不同**的桶，并对「轮转从未跑过」给独立的 `exit 3`（NOT-EVALUATED，⛔ 不与「查过且全好」同形，硬规则 3b）。⛔ 未把 79/81 条无差别纳入每轮复跑；**成本上界逐条写在上节**（≤30s/次；稳态 ≈106s/小时；一次全轮 ≈106s，全部由实测 avg 1.31s/条 导出）。
- [x] AC3（改后读数，枚举非布尔）：生产上 `exit 1` 并**逐条点名** `AC-147, AC-149, AC-172, AC-228`（stderr 与 JSON 的 `failing` 清单双重）；输出为清单 `{frozenScope, failing[], staleUnverified[], notEvaluated[], verifiedFresh[], neverGated[], rotation{}}`，⛔ 非布尔。
- [x] AC4（双向控制）：同夹具的健康条（尾事件 pass ∧ 实跑 exit 0）落 `verifiedFresh`、⛔ 不在 `failing`；生产轮转里 76 条健康 AC 同样落 `verifiedFresh`。另有反向控制：一条 `goal-cli`（非轮转）刚写的 pass 也**不**算 `verifiedFresh`、只算 `staleUnverified`（⛔「尾事件是 pass」本身不等于「为真」）。
- [x] AC5（存量归零，枚举）：四条各有终态与取证 —— AC-147 → `superseded`（判据所指 `plugin/scripts/manager-liveness-independent-check.ts` 已由 `gap-ac158` 归档为死件，⛔ 不改写判据去指归档副本）；AC-149 → `superseded`（`session-retirement-check.ts` 同批归档，其诉求已由 2026-09-03/09-04 的会话退役与 worker-driver 承接）；AC-172 → 判据**收敛到常设半边**（draft 可用 ∧ 默认不激活，hermetic 往返，实跑 `rc=0`），见证半边（唯一活载体 GOAL-003）是一次性验收、已随其激活完成，⛔ 不造假 draft GOAL 喂判据；AC-228 → 判据钉 `QUAY_PLUGIN_ROOT`（`plugin-root.ts` 文档化的显式指针），实跑 `rc=0`。四条的终态理由逐条写进各自文件的 `expect`/`statusLog`，⛔ 无一条是「已知悉」。
- [x] AC6（静默失败）：AC-172 与 AC-228 的判据各分支均带 `CAUSE=…` 且失败时 stderr 非空（双向负控制实测 931 / 737 字节）；两者在**健康态**下 `rc=0`，即失败输出是在真失败时才出现的。
- [ ] AC7（全量绿）：`scripts/test.sh` 全量绿（待外部）

## DoD

生产读数可验证：存在一个机制，能在「判据当前为假但台账尾事件为 pass」这一形态下报红，并在上表 4 条上实际报出过；且该机制的每轮成本有明确上界（写进任务体，非口头）。⛔ fixture 与单测是必要不充分条件（DIR-026 Reading A）。

**本任务的 DoD 取证**：生产（`--root /home/yale/work/quay`）一轮轮转 + 纯读判定 ⇒ `exit 1` 并**恰好**点名上表四条（`verifiedFresh 76 / staleUnverified 0`）；成本上界见「修法与成本上界」节（三处实测导出 + 三处算式）。fixture/单测只作为**机制**的两向控制（`packages/quay/test/goal-store.test.mjs` 7 条 + `plugin/test/goal-driver.test.mjs` 1 条，均真跑 CLI）。

## Touches

- goals/AC-242-台账不得留下-已离开复验域却尾事件为-fail-的-ac-否则下游判据-ac-241-结构上永不通过-被误读成-还有真缺.md
- goals/AC-147-manager-liveness-independent-watchdog.md
- goals/AC-149-session-retirement-no-dual-source.md
- goals/AC-172-draft-status-real-carrier.md
- goals/AC-228-一致性夹具接入常规套件且沿三轴不像本仓库-含双向负控制-goal-012-退出条件③.md
- packages/quay/src/goal-store.ts
- packages/quay/test/goal-store.test.mjs
- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver.test.mjs
- tasks/gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass.md

## 交接与已知副产物（⛔ 不属本任务 AC，但必须留痕）

1. **AC-241 会短暂转红，且自愈**：本任务的生产轮转在 `2026-09-12T01:44:16Z` 给 AC-172 写下了一条尾事件，其 reason 是**旧判据**（零输出）产生的裸模板（`acceptance failed (exit 1) — criterion wrote no output to stderr/stdout`）⇒ AC-241 现在点名 AC-172。这是**对当时部署态的忠实读数**（旧 AC-172 判据确实无成因输出），也是 AC6 之所以存在。落地后：主检出 sync 拿到新判据 ⇒ AC-172 实跑 exit 0 ⇒ 尾事件转 pass ⇒ AC-241 不再检查它。所加的「已记录的 fail 更早重查（minAge/6 = 10min）」正是为把这个窗口从 **~1h 压到一个 driver 轮**。
2. **工作树的 `.quay/` 会被从主检出同步**（实测：本 worktree 的 `gate-events.jsonl` 是主检出台账的副本）⇒ **轮转必须在拥有运行载体的那个工作区（生产主检出）里驱动**；在 worktree 里跑的聚合读数不可作为证据（判据读 `.quay/` 里的 gitignore 运行载体，副本里必然缺）。本任务据此只引用生产读数与逐条判据读数。
3. **另一处根因、另有其主（⛔ 不在本条范围）**：`packages/quay/plugin/` 是 `package.sh` 在 `npm pack` 前 staged 的**生成快照**（gitignore、从不跟踪、pack 后残留），`resolvePluginRoot()` 的 walk-up 从 `packages/quay/src` 出发会**先命中它** ⇒ `resolvePluginScript("scripts/driver-runtime.ts")` 的 raw 形态返回 null；该残留已陈旧（`plugin/scripts/*.ts` 中 **20** 个比其 `VERSION` 新），而自主检出出发的解析**当前正指向它**。ACK：本条只记录，未修。
4. **与 `gap-frozen-achieved-ac-no-owner-after-ledger-tail-mutation`（develop 上 status=ready）的分工**：那条要的是「已被记录为 fail 且已出域」这一集合的**消费者/所有权**（`computeGoalGaps` 的第三 population）。本条只做**判定口径 + 有界重跑**，⛔ 不加 spawn 分支（AC2 的成本边界 + 避免与其已写好的 Plan 双写同一处）。两条互补：本条让**不可见**的失效可见，那条让**已可见**的失效有主。落地后该条的 AC4/AC5/AC6 的**可观察终态**由本条先行满足（四条进终态、AC-242 由 1→0、AC-241 不再因 AC-172 而红），其**核心交付**（`frozen-violated` 取值 + 立案路径）仍归它。
5. **`gap-ac242-naive-frontmatter-split-hides-own-long-term-self-latching-false-positive`（develop 上 status=todo）已被本任务在构造上取代**：那条针对的是 AC-242 判据正文里朴素的 `split("---",2)[1]` 取 frontmatter（导致自指假阳性 + 红了不自愈）。本任务把该判据正文整体换成了 `goal-store check --stale-pass`（**零 frontmatter 解析**）⇒ 该自锁在该判据上不复存在。建议由 manager 裁定该条撤回或重定范围（本任务⛔ 不代改别条任务的状态）。
