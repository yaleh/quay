---
id: GOAL-013
title: 判据保真性——criterion 必须能在它 expect 声称的对象上取假，把「achieved-but-vacuous」从三条不变式的盲区变成激活期可判
status: achieved
kind: goal
origin: '立条依据（人 2026-09-10 授权执行）：GOAL-012 于 07:03:36Z flip achieved，其 AC-225 于
  07:00:55Z flip achieved（reason "I2: criterion pass"），而该判据背后的
  kernel-sibling-resolution-check 当时对【跨包源码锚点】结构上不可能红——同族锚点 worker-driver.ts 的
  path.join(repoRoot(),"packages","quay","src","gate","gate-event-store.ts")
  就在其扫描面内且已在 orangevps 第三方项目 e2e 上造成真实故障（MODULE_NOT_FOUND ⇒ gate-events.jsonl
  永不写 ⇒ GOAL-009 AC-207 判据恒不满足）。实质缺口由 aca7a0511（08:16:28Z）扩面闭合，比 achieved 晚 73
  分钟。⇒ 缺陷由生产发现而非机制发现；I2 误触发、I4 不适用、I5 全盲（判据仍 pass，什么都没回退）。人 2026-09-10 裁定：goal
  应以业务价值实现为目标，achieved 后发现进一步问题而要求修改/重开是诚实行为，且该行为模式需被机制承载而非靠自觉。本 goal
  即该裁定的机制落点。发生率：AC-212 origin 已记录三次假 achieved（纯语法合取即关闭），本次第四次且首次由生产实证（硬规则 12
  查历史不等下一轮）。'
activatedAt: 2026-09-10T10:07:41.713Z
statusLog:
  - at: 2026-09-10T10:07:41.713Z
    from: draft
    to: active
    actor: cli:human-ruling-2026-09-10
    reason: 人 2026-09-10 裁定后授权执行：achieved 后发现进一步问题而要求修改/重开是诚实行为，且该行为模式需被机制承载——本 goal
      是该裁定的机制落点（激活期保真性闸）。立条时 active=GOAL-009 一条，本条激活后 2/3。
  - at: 2026-09-10T15:35:00.855Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: all ACs achieved + sufficiency covered"
---
## 背景

**2026-09-10 实测时序（本 goal 的立条依据，非主张）**：

```
07:00:55Z  goal-driver flip AC-225 → achieved   reason "I2: criterion pass"
07:03:36Z  goal-driver flip GOAL-012 → achieved reason "I2: all ACs achieved + sufficiency covered"
           ↑ 此刻 kernel-sibling-resolution-check 的对象定义只覆盖 plugin/scripts 兄弟脚本（P1/P2/P3），
             对【跨包源码锚点】结构上不可能红
08:16:28Z  aca7a0511 扩面落地（P4 三形态 + 突变用例 + 单测）——实质缺口在 73 分钟后才闭合
```

AC-225 的 criterion 是跑 `kernel-sibling-resolution-check.ts --root . --json` 期望 exit 0，而它的 `expect` **逐字声称**：「完整性由检查器的机械枚举给出，不是手工清单——人工枚举已做过 3 次、3 次都有遗漏。」

而同族锚点 `worker-driver.ts` 的 `path.join(repoRoot(), "packages", "quay", "src", "gate", "gate-event-store.ts")` **当时就在该检查器的扫描面里**，且**已在生产上造成真实故障**：orangevps 第三方项目 e2e fan-in 末步 `append-complete-gate-event` 报 MODULE_NOT_FOUND（shipped 包把 `packages/quay/` 打平到包根）⇒ `.quay/gate-events.jsonl` 永不写 ⇒ GOAL-009 AC-207 的判据 `gate_events > 0` 恒不满足。

⇒ **AC-225 拿到的那个 `0` 是定义太窄换来的 0**（硬规则 4：一个结构上不可能取假的量，不是测量）。**缺陷由生产发现，不是由机制发现。**

**为什么现有三条不变式一条都报不出来**：

| 不变式 | 它抓什么 | 本例 |
|---|---|---|
| I2 | criterion pass ⇒ flip achieved | **误触发**（判据确实 pass） |
| I4 | active 而全部 AC achieved（该关没关） | 不适用 |
| I5 | achieved 而 criterion **现在转 fail** | **全盲**（判据仍 pass，什么都没回退） |

⇒ 缺的是第四类：**achieved-but-vacuous —— criterion pass，但它测量的对象比自己 `expect` 声称的窄。**
与 I5 **方向相反**：I5 是「曾真、后回退」，本类是「**从未测量它声称的对象**」。

**⛔ 与 AC-180/184/186 退役非同类**（这一条必须写明，因为它已经被混淆过一次）：那三条退役理由是「**活性量自行回退**」——进程存活/进程比源码新，量会自己变假，而 goal-driver 无反向翻转 ⇒ 记录会永久声称一件已不成立的事。本类**什么都没回退**，是判据从一开始就没测量它 `expect` 声称的对象。**两者的修法也不同**：那三条的修法是「别把这类量写成判据」，本条的修法是「让空洞判据进不来」。

**发生率（硬规则 12：查历史，不等下一轮）**：`AC-212` 的 origin 已记录「纯语法合取即关闭」造成的**三次假 achieved**，充分性闸正是那三次的机制回应。本次是**第四次，且是第一次由生产实证**。⇒ 该类别不是首发，造机制够格，⛔ 不是凭空设前置。

**GOAL-012 因此【不重开】**：其退出条件此刻实质成立，三条实测读数——扩面后 checker `--root .` exit 0 / 突变用例六形态注入全红且两条豁免不误伤（exit 0）/ 单测 21 pass（含 P4 三形态 RED + 相对 import·bin 布局边界 GREEN）。本 goal 管的是「**机制为什么没先抓到**」，不是「那个缺陷有没有修」。

## 范围与非目标

**范围**：

① **判据保真性判定**——给定一条 criterion 记录（`criterion` + `expect`），判「这条 criterion 能否在它 `expect` 声称的对象上取假」，三态输出 `faithful` / `vacuous` / `not-evaluated`；⛔ `not-evaluated` 不与 `faithful` 同形（硬规则 3b）。

② **接在【激活期】，不是关闭期**——落点是 `packages/quay/src/goal-store.ts` 的 P6 activation gate（draft→active 已经在跑一次 criterion 以要求它「**可评估**」）。本 goal 给同一个钩子加**第二问**：不止「跑得动」，还要「**测得着**」。
   ⛔ 不接在关闭期：那等于让一条空洞判据先在 ~42 秒的热循环里绿着转，且 achieved 之后只有人能翻回（裁定 3：激活归人）。

③ **复用充分性闸的既有机件与词表**——`AC-212/213/222` 的 `covered/insufficient/not-evaluated` 三态与 `parseSemanticSufficiencyVerdict` 的 fail-closed 手法；⛔ 不另起炉灶。

④ **给硬规则 4c 补上产物**——「判据落笔当轮就要取一次真实读数」此前只是散文纪律、**无产物**（AC-224/225 的 origin 都写了「已干跑取真实读数」，而那是**自述**，与没跑同形）。

**非目标（明确排除）**：

- **不追求纯机械判定**——「criterion 是否测量了 expect 声称的对象」需要语义（同充分性闸 `covered` 那一半）；⛔ 不做一个做不出来的承诺。机械半只覆盖**可枚举**的部分（是否存在能取假的负控制）。
- **不回溯重判存量 228 条 AC**——逐条重判的成本从未测量（硬规则 4 推论：成本结构未知前不设数值阈值）。本 goal 只管**从此刻起新激活的**；存量归例行/观察项。
- **不改 I5 的语义、不与其合并**——两者方向相反（同 `goal-store.ts` 对 I4/I5 分工的 ⛔ never merged 注释）。
- **不给 goal-driver 加反向翻转**——裁定 3（激活归人）原样保留。本 goal 让空洞判据**进不来**，不是让它**出得去**。
- **不改任何现存 AC 的状态**——包括 AC-225 本身（它的 criterion 在扩面后已是真测量）。

## 退出条件

1. 一条 criterion 记录 draft→active 时，除「可评估」外还判一次「保真」：判出 `vacuous` ⇒ **拒绝激活**且理由可见；`not-evaluated` ⇒ **不放行**（fail-closed，⛔ 不与 `faithful` 同形）。
2. 该判定**能取假**——双向突变用例：喂一条已知空洞的判据 ⇒ 必须判 `vacuous`；喂一条已知保真的判据 ⇒ 必须判 `faithful`。⛔ **恒 `faithful` 的保真性判定器正是它自己要禁的东西**（自指风险，见风险 2）。
3. 判定结果与理由**落在记录自身**（字段或 statusLog 条目），⛔ 不只打印到 stderr——否则「判过且保真」与「没判成」在载体上同形。
4. **既有 228 条 AC 的激活路径逐字不变**——只加一问，不改 I2/I4/I5 语义，不改任何现存记录状态。
5. **AC-225 这个真实历史案例被用作回归夹具**：把 `aca7a0511` 之前的检查器形态 + AC-225 的 criterion/expect 喂进判定器 ⇒ 必须判 `vacuous`。⛔ 该夹具**逐字 vendor 进仓库**，不得锚在 commit SHA（硬规则 5b 已记：判据不得引用生命周期短于判据本身的对象——rebase/squash 后假阴性）。

机器判据在本 GOAL 名下的 AC 记录里，**不在本节**。

## 风险

1. **语义判定的成本**——判定接在激活期而非每轮热循环：激活是低频事件（整个项目寿命至今 13 个 goal / 230 条 AC）⇒ 成本可接受。**但若有人把它接进 ~42 秒热循环就会原样重演 `gap-goal-gate-timestamp-commit-flood`**（实测 gate-events 最近 400 条全是 goal-driver 每 42 秒的 gate）。⇒ 落点必须钉在激活期钩子上，判据里要写明。
2. **判定器自己空洞（自指，本 goal 最容易犯的错）**——一个总是判 `faithful` 的保真性判定器，正是本 goal 要禁的那一类东西，且它会**与「一切判据都保真」同形**。⇒ 退出条件 2 的双向突变用例是唯一对冲，且退出条件 5 要求其中一例是**真实历史案例**而非合成夹具（硬规则 4 推论三：只能被 fixture 满足的判据不是测量）。
3. **误拒合法的短判据**——生产里有合法的 19 字符判据与 `exit 0` 形（`goal-store.ts` 注释已记，且其 re-write 负控制会拒绝它们）。⇒ 判准是「**能否在 expect 声称的对象上取假**」，⛔ 不是长度/复杂度/形态。
4. **`not-evaluated` 变成事实上的全面拒绝闸**——语义判定不可用（超时/无凭据/读不懂）时 fail-closed 会挡住所有新 AC 激活。⇒ 需一条显式 `--force` 逃逸（同 P6 现有手法「我知道它不可评估」），且 **force 必须在记录里留痕**，⛔ 不得静默越权。
5. **判据的类别纪律**（承 GOAL-012 同款）：本 GOAL 的判据只引用不会自行回退的量——代码状态与套件绿红；⛔ 不含进程存活/远程可达性/LLM 当次可用性。

## 与其他 goal 的关系

- **`GOAL-010`（goal 机制的语义闸）建的是 goal 层的一问**：「这组 AC 是否覆盖退出条件」（充分性，AC-212/213/222）。**本 goal 是它下一层的镜像**：「这条 criterion 是否测量了它 `expect` 声称的对象」（保真性）。同机件、同三态词表、同 fail-closed 手法 ⇒ ⛔ 不另起炉灶。
- **`GOAL-012` 提供本 goal 的立条实证与退出条件 5 的历史夹具**，但**GOAL-012 不重开**（退出条件此刻实质成立，三读数已附）。分工：GOAL-012 = 那一类缺陷不再发生；**本 goal = 机制能在关门前发现自己没测到**。
- **`GOAL-009` 是本 goal 的实证来源**（AC-207 的 `gate_events > 0` 恒不满足正是那处空洞判据放过去的缺陷造成的），但二者不共享 AC。
- 受 I1′ cap=3 约束：立条时 active = `GOAL-009` 一条，本条激活后 **2/3**。