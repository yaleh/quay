---
id: gap-watchdog-killed-round-writes-no-verification-round-record
title: 静默看门狗杀死的轮在 verification-round.jsonl 一行都不写（实证 9 次 / 6 天）——已宣告「轮次不落记录」族的第三个子类
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：2026-09-13 本会话对「worker 退出时未落地率 62%」的实证调查。本条是调查中**判定载体侧**的发现。

**读数（发生率：9 次 / 6 天，逐条交叉核对过）**：
`.quay/fan-in-step-trace.jsonl`（11080 行）的 `suite-end` 步里，`reason` 为 `silence watchdog killed the suite (no output ≥ silence timeout)` 共 **9 次**（2026-09-07 ~ 2026-09-12，**9 个不同任务**，`wall_ms` 90 万 ~ 143 万 ≈ 15–24 分钟）。
逐条用 taskId 交叉核对 `.quay/verification-round.jsonl`：**9 次全部在「被杀那一轮」的时间窗内没有任何记录。**
举一个可复核的例：`gap-ac168-criterion-sh-incompatible` 的看门狗触发于 20:51:39Z（21.8 分钟），而该任务在 `verification-round.jsonl` 里唯一的记录是 **21:00:34Z 的 green —— 那是【后一轮】**，不是被杀的这一轮。

**危害形态（硬规则 3b 的镜像半边，这是本条的理由而不只是「少了个日志」）**：
任何以 `verification-round.jsonl` 为输入的判定器，会把**「没评估」读成「没问题」**。
硬规则 3b 的原话：判定机件在读不懂输入时，不得返回与**合格**同形的值；而**「没有检查」是已知的空白，「一个恒绿的检查」是一个假的保证，后者更贵**。
本仓库已有三个同形前例，全部退出码 0、结构完整、数字合理：`task-status-drift-check.ts:126`（读不到 AC 段 ⇒ 返回零未勾 ⇒ 判为完成）、`slot-refill.ts:373`（`total===0` ⇒ 第一行就判 landed）、`outer-tick-log-check.sh`（解析不出 ACTION ⇒ 每条分支跳过 ⇒ 打印 `PASS — is self-consistent`）。
**现实后果已经在发生**：判这种情形当前只能**手工**做——记录在案的诊断手法是「找**缺 `__PERFILE__` 行**的那个文件 + 查进程树是否仍活着，别重跑碰运气」⇒ 而一条写下来的记录正是让这套手工取证不必要的东西。

**⇒ 本条是一个【已被宣告的族】的第三个子类（⚠️ 立案时必须写明，否则会被判重）**：
`gap-verification-round-static-fail-no-record`（**done**）正文里自己就写下了这个**族**名——**「未完整跑完的轮次结构性不落记录」**，并修了其中两个子类（静态闸 fail / 动态测试 fail），落法是 `pre-verified-round-record.ts --state red` + 两个调用方在 suite 红时写红轮记录。
**但它没有覆盖本子类，原因是机制性的两条**：
① 它的触发条件是 `sr.outcome === "red"`，而**看门狗杀产生的是独立取值 `hung`**；
② 该分支的红轮写入被 `recordDelegatedRound` 的 `if (!suiteRunsOutsideRunner(worktree)) return` **提前返回** —— quay 自身路径靠 runner 写记录，而 **runner 被 SIGKILL 整组杀死后写不成**。
`gap-fan-in-realsuite-bypasses-verification-round-ledger`（**done**）是同族第二实例（真跑 suite 分支零入账）。
**⇒ 本条 = 该族第三成员，是硬规则 5b（在某处修好 X ≠ X 只在那一处；缺陷是成簇的、兄弟实例常在同一文件甚至同一行）的经典形态。**

**⚠️ 前提负控制：一个我原本写进来的半边已被证伪，特此记下以免它被再次提出。**
原假设含「`reason:"infra-error"` 的轮也一行都不写」⇒ **为假**。`verification-round.jsonl` 里**确有 4 条** `state=red / reason=infra-error`，其中 **3 条是 worktree-scope 带 taskId 的**（round 1031 `gap-quay-init-closure-assertion-first`、1115 `gap-writestate-torn-read-assertion-load-sensitive-flaky`、1412 `gap-dashboard-workprogress-row-paired-columns`，均带 `void:true`）。
⇒ **infra-error 半边不属于本条范围。** 若要追问，剩下的问题是另一个形状——「`void:true` 是否被下游消费者正确读为 NOT-EVALUATED」——⛔ 那需要先量它的实际误读发生率，本条不承担。

**与相邻已落地任务的分工（均非重复）**：
- `gap-mech-fan-in-suite-silence-watchdog-fired`（done）修的是**同一个看门狗**的另一个轴：「suite 真挂死 vs 看门狗误杀正常静默」的**可分性**（漏传 env 导致误杀），⛔ 不碰记账。本条是「杀掉之后载体上一行都没有」。两条互补。
- `gap-suite-state-has-no-reason-axis-failed-aborted-infra`（done）确立了 `failed / aborted / infra-error` 词表，但在**另一个载体**（`full-suite-state.json`，见 `plugin/scripts/suite-state-trigger.ts:97` 的 `SuiteStateReason`）⇒ 它是本条的**词表来源**，不是本条的解。
- `gap-not-evaluated-checkers-never-persisted` / `gap-not-evaluated-harness-third-state`（均 done）= 同一认识论根（硬规则 3b），不同对象（checker 层），⛔ 不是同机制。

## Plan

1. 定位轮记录的写入点与两条绕过路径：`plugin/scripts/suite-driver.ts:211-234`（看门狗判定与 `error` 文本，`SILENCE_MS_DEFAULT` 见 `:45`，缺省 15 分钟）→ 记录写入侧（`pre-verified-round-record.ts` / `recordDelegatedRound` 的 `suiteRunsOutsideRunner` 提前返回）。搞清「runner 被整组 SIGKILL 之后，谁还活着能写这条记录」——**这是本条的真实设计问题，不是加一行 append 就完**。
2. 让看门狗路径**也写一条记录**，`reason` 取**独立值**（如 `watchdog-killed`）且带 `evaluated:false`：⛔ 不与 `failed`/`gate-failed` 共用取值，⛔ 也不伪装成绿。
3. ⛔ **不改为 fail-closed 阻塞在飞任务** —— 参照同族既定裁定：当场改 fail-closed 会立刻让套件红并挡住在飞任务，**而「说实话」零代价**（退出码不变，取值可区分）；fail-closed 留到该判据真正具备输入之后。
4. 按硬规则 5b 在同一载体里枚举**还有哪些取值/路径**同样不落记录（`hung` 之外是否还有第四、第五个），把命中数与清单贴进提交。

## Acceptance Criteria

- [ ] AC1（与合格不同形·可取假·核心）：人为触发一次看门狗杀死（用 `QUAY_TEST_SUITE_DRIVER_SILENCE_MS` 传小值，或等价 seam），断言写出的记录与一次正常绿轮**结构上可区分**。判据：两条记录的 `evaluated` 字段取值不同（`false` vs 缺省/`true`），且 `reason` 为 `watchdog-killed`；两条记录原文贴进读数段。⛔ 取假形态：两者同形、或看门狗路径仍然一行不写 ⇒ 未达成。
- [ ] AC2（runner 被杀后仍有人写·可取假·本条的真实设计判据）：在**被 SIGKILL 的是整个 runner 进程组**这一前提下，记录仍然出现。判据：干跑一次真实的整组杀（⛔ 不是只杀子进程），事后载体中存在该轮记录。⛔ 取假形态：整组杀后记录缺席，而只杀子进程时才出现 ⇒ 说明写入点仍在被杀的一侧，未达成（这正是既有 `recordDelegatedRound` 提前返回没能覆盖本子类的根因）。
- [ ] AC3（缺行数对账·可取假·⚠️ 零计数要走正样本干跑）：对同一窗口做两个计数——①`fan-in-step-trace.jsonl` 里 `step` 含 suite ∧ `ok=false` ∧ `reason` 含 `silence watchdog` 的条数；②`verification-round.jsonl` 里同窗口 `reason=watchdog-killed` 的条数。判据：落地后窗口内**差值 = 0**，或差值的每一条都有显式解释；两个计数与差值写进读数段。⚠️ **若差值算出来是 0，必须把谓词 ② 对着一个【已知存在的看门狗轮】干跑一次**证明它确实命中（硬规则 2 的零计数配套动作：非零查「命中的是不是我要的」，零查「谓词对真样本命不命中」；否则 0 可能来自谓词不命中任何东西）。
- [ ] AC4（生产载体验证·读产物，⚠️ 允许 not-evaluated）：落地后窗口内，`verification-round.jsonl` 含 ≥1 条**实现落地时刻之后**产生的 `evaluated:false` 记录。⚠️ 若窗口内**未自然发生**看门狗杀死（历史发生率 9 次 / 6 天，但不保证）⇒ 该 AC 记 **not-evaluated** 并写明窗口长度，⛔ 不得用注入数据记为通过（硬规则 4 推论三：一个只能被 fixture/注入 seam 满足的判据只证明「能产出」，不证明「已产出」；⊢ 反例判据：把注入 seam 关掉后仍能通过，它才是测量）。
- [ ] AC5（⛔ 不引入阻塞，可取假）：判据：落地后窗口内 `mfi-` 轮的 `exited-not-landed` 比例**未因本改动上升**（给出落地前后两个读数）。⛔ 取假形态：比例上升且无法排除本改动 ⇒ 必须说明并回退到「只记录、不影响控制流」。
- [ ] AC6（硬规则 5b 的族成员枚举，⛔ 非布尔）：枚举该族**还有哪些「轮未完整跑完」的取值/路径不落记录**（`hung` 之外）。判据：产出一张表，每行（取值或路径 / 是否落记录 / 若不落则该不该修），并给出**命中数**；标为「该修而未修」的须实际立案并附任务 id。⛔ 写不出这个数 ⇒ 视为只修了被报出来的那一个（本族前两次就是这么一个一个被发现的）。

## Definition of Done

- 看门狗路径的记录写入落地；纯函数部分有单测，且单测含**可失败控制**（把写入去掉即红——⛔ 一个不可能报红的测试等于没接线，同族第二实例的教训：「不产生新红」被当成接线成功的证据，而那正是恒绿检查会给出的结果）。
- AC1 的两条记录原文、AC2 的整组杀干跑读数、AC3 的两个计数与差值（含零计数时的正样本干跑）、AC6 的族成员表，全部落进任务体读数段。
- ⛔ **不把看门狗路径改成 fail-closed**（那需要先具备输入，是另一件事）；⛔ 不动 `gap-mech-fan-in-suite-silence-watchdog-fired` 管的「误杀可分性」那个轴；⛔ 不承担 `infra-error` / `void:true` 的下游误读问题（前提已证伪，见 Proposal）。
- ⚠️ **Touches 补充义务**：Plan 1 定位出的记录写入侧文件（`pre-verified-round-record.ts` / `recordDelegatedRound` 所在文件等）必须在提交前追加进本任务 `## Touches`——fan-in 的 anti-drift 是 HARD-FAIL 步，读 worktree 内任务文件且只算已提交 delta，提交了未声明的文件即红。

## Touches

- tasks/gap-watchdog-killed-round-writes-no-verification-round-record.md
- plugin/scripts/suite-driver.ts
