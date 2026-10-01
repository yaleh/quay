---
id: gap-coverage-nonblock-ledger-has-no-consumer
title: "`--no-block` 把覆盖率 RED 从「挡住全部 code
  落地」降为「写进一份没人读的台账」——gate-event-coverage-nonblock-ledger.jsonl
  只有写者、零读者，漏记不再有任何机制把它送到会处置的人面前"
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

**读侧修复把代价从「过高」改成了「为零」：覆盖率 RED 现在只落进一份只有写者、没有读者的台账。**

<!-- dedup-ref --> `tasks/gap-coverage-miss-fail-closed-stops-code-landings.md` 给 `gate-event-coverage-check` 加了 `--no-block`：RED 照常打印并记入 grow-only 台账 `.quay/gate-event-coverage-nonblock-ledger.jsonl`，但 `exit 0`、不再中止套件。那条修的是「一条历史读数不该让无关任务停摆」，方向是对的；本条修它留下的另一半。

### 实测（2026-10-01，分支 `task/gap-coverage-miss-fail-closed-stops-code-landings`）

`git grep -n 'gate-event-coverage-nonblock-ledger' <该分支> -- plugin packages scripts .gitignore` ⇒ **4 处命中，全部在写侧**：

1. `plugin/scripts/gate-event-coverage-check.ts:41`（头注释）
2. `plugin/scripts/gate-event-coverage-check.ts:329`（`NO_BLOCK_LEDGER_REL` 常量，唯一写者 `recordNonBlockReport` 用它）
3. `plugin/scripts/runner-static-gate.ts:968`（接线注释）
4. `plugin/test/gate-event-coverage-check.test.mjs:278`（写者自己的单测）

**读者数 = 0**：没有任何 checker、driver、routine、manager 读数或 Web UI 页面读这份文件。生产载体里此刻已有一行（`{"day":"2026-09-30","task":"gap-ac292-criterion-carrier-absence-not-evaluated",…,"at":"2026-10-01T12:18:29.066Z"}`），它不会被任何机制送到任何人面前。

### 为什么这是缺陷而不是「以后再说」

- 修复前：漏记 ⇒ 全部 code 落地停一天（代价过高，但**一定有人处置**）。修复后：漏记 ⇒ 套件日志里一行会滚走的 `NON-BLOCKING` + 台账里一行没人读的 JSON（**没有任何东西保证有人处置**）。「守」与「不守」在任何会被读的记录上无法区分——硬规则 9：可见性 ≠ 执行。
- 接线处自己写明了代价：`--no-block` 下 `run_checker` 按 exit 0 把 cost 行记成 `verdict:"pass"`。⇒ 取值轴**只**剩这份台账；台账没人读 ⇒ 取值轴实际上是断的。
- 写侧注释把这份台账称为「取值轴的持久载体，可审计、不消失」。「不消失」成立，「可审计」目前只意味着「有人想起来去 cat 它」。
- 同文件里另有三处 `--no-block` 先例（`task-contract-check` / `suite-duration-exceed-check` / `instrument-decay-check`）。它们各自的 RED 最终有没有读者，本条**未查**——见 AC4。

### 附带观察（未定性）

`git check-ignore -v .quay/gate-event-coverage-nonblock-ledger.jsonl` 在主检出返回非零（未被忽略）⇒ 这份运行时台账会以 untracked 形态出现在主检出 `git status` 里。是否该进 `plugin/scripts/quay-runtime-artifacts.txt` 清单，由实现者按 `gitignore-runtime-coverage-check` 的规矩判。

### 请求动作

给台账接一个**会把未处置条目送到处置面**的读者。落点由实现者定，约束三条：

1. **不重新 fail-closed 套件**——那是前一条刚拆掉的形态。读者应落在不挡 fan-in 的面上（例如 manager tick 读数 / needs-human 面 / 一条自动立案的 gap，按 `day|task` 去重）。
2. **条目要有「已处置」这一态**——否则读者要么永远报同一条（噪声），要么靠时间窗滑过自动沉默（等于没读）。处置 = 该落地补上了 `complete` 事件，或有一条带理由的裁定；⛔ 不是手维护的豁免 id 表。
3. **读不到台账 ≠ 台账为空**（硬规则 3b）：载体缺席 / 不可解析要有独立取值，不与「零未处置」同形。

## AC

- [ ] **AC1（现状固化）** 在 develop 上重跑上面那条 `git grep`，贴命中数与全部命中行，并按「写者 / 读者」分类写出两个计数；另贴生产台账当前行数与前 3 行原文。若 develop 上还没有这个常量（写者尚未落地）⇒ 写明并停在此处，⛔ 不自行实现写者。
- [ ] **AC2（读者落地·读生产载体）** 新读者对着**生产**台账跑一次，贴读数：未处置条目数与清单（⛔ 不是布尔）。把 fixture/注入关掉后这条读数仍须取得到。
- [ ] **AC3（三态可取假）** 同一读者对三种输入各跑一次并贴读数：有未处置条目 ⇒ 报出；条目已处置（对应落地已有 `complete` 事件）⇒ 不再报；台账缺席或坏行 ⇒ 独立的「未评估」取值，与前两者都不同形。
- [ ] **AC4（5b 同载体扫描）** 对 `runner-static-gate.ts` 里**全部** `--no-block` 接线逐条列出：它的 RED 落在哪个载体、该载体有没有读者。贴命中数与清单；零读者的每一条要么在本任务内接上，要么各立一条 gap 并贴 id。⛔ 不写成「其余同上」。
- [ ] **AC5（不回退前一条）** 在存在一条未处置条目的条件下，code delta 的静态闸仍不因它中止——贴 `run_checker "gate-event-coverage-check"` 的 exit 读数。
- [ ] **AC6（本任务自身的门）** `bash scripts/test.sh --for-task gap-coverage-nonblock-ledger-has-no-consumer` 绿。

## DoD

**真实落地**：生产台账里那条 2026-09-30 的条目，被新读者在一个**有人/有机制会处置**的面上报出过一次（贴该面的读数），并在处置后不再被报。⛔ 只加一段说明「可以去看这份台账」⇒ 不算完成；⛔ 把 `--no-block` 改回 fail-closed ⇒ 不算完成。

## Touches

- `plugin/scripts/gate-event-coverage-check.ts`
- `plugin/test/gate-event-coverage-check.test.mjs`
- `plugin/scripts/manager-tick-readings.ts`
- `plugin/scripts/quay-runtime-artifacts.txt`
- `.gitignore`
- `tasks/gap-coverage-nonblock-ledger-has-no-consumer.md`