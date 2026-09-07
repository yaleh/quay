---
id: gap-goal-achieved-but-failing-no-handler
title: achieved-but-failing 无任何处理者，而 goal-driver:272 注释声称「I4 已报出」——I4 判的是方向相反的
  GOAL 层条件，对该形态恒不触发且 exit 0
status: done
labels:
  - gap
  - defect
  - goal-driver
parent: null
children: []
extra:
  schema: execution
  acceptance: node --experimental-strip-types --test plugin/test/goal-driver.test.mjs
---
## Finding

> **🔴 派发后重大更新（2026-09-07T07:0xZ）——请务必读完第零节再动手。**
> 已有的实现（留在 worktree `gap-goal-achieved-but-failing-no-handler` 中）**在生产上引发了无界递归进程链**，实测 25+ 进程、宿主 load 41.89（16 核）、并使近 1 小时**每一次 fan-in 都因 suite 计时断言变红而失败**。
> **根源是我在本任务体原「方向倾向」里给出的建议本身有错**，见第零节。

### 〇、🔴 已实测的无界递归——必须先解决，否则本任务不可落地

**现象（直接量，非推测）**：
```
ppid 链：goal-store.ts check --staleness
      → /bin/sh -c out="$(node ... goal-store.ts check --staleness)" && ... grep -q '"fresh"' ...
      → goal-store.ts check --staleness → ...（观察时 25 个进程且在增长，根进程已被 systemd 收养）
宿主 loadavg：41.89 / 16 核（≈2.6× 超订）
杀掉整条链后 60 秒内未重生，loadavg 41.89 → 13.25   ← 能取假的对照
```

**机制（逐行可核对）**：
- worktree 实现把 `achievedButFailing` 放进 `checkStaleness`，`packages/quay/src/goal-store.ts:422-432` 对**每条 active goal 下的 achieved AC** 调 `runAcceptance({ command: criterion, timeoutMs: 60000 })`；
- 而 `goals/AC-175-staleness-three-state-and-divergence.md`（`status: achieved`、`goal: GOAL-001`＝active）的 criterion **正是**：
  ```
  out="$(node packages/quay/src/goal-store.ts check --staleness)" && printf '%s' "$out" | grep -q '"fresh"' ...
  ```
- ⇒ `check --staleness` 跑 AC-175 的判据 → 判据再调 `check --staleness` → **无界递归**。每层 `timeoutMs: 60000` 只保证单层 60 秒后退出，而它在启动瞬间就已生出下一层 ⇒ 稳态是数十个并发 node 进程。

**⚠️ 爆炸半径不是 1 条，是 8 条**：GOAL-001（active）下 `status: achieved` 且 criterion 中出现 `goal-store` 的 AC 共 **8** 条——AC-170 / 171 / 172 / 173 / 174 / 175 / 176 / 177。直接自递归的目前只有 AC-175，但**「判据回调本机制」是一个类**，任何一条日后改成调用 `check` 都会再次引爆。⇒ 修法必须针对这个类，⛔ 不是给 AC-175 打特例。

**⛔ 我原来写的方向倾向是错的，现予撤回**：原文写「最小形态是让 `check --staleness` 增加一个 `achievedButFailing: string[]` 桶」——我当时**没有检查是否存在回调本机制的判据**。执行者按它实现是对的；错在需求方。**新的方向倾向见第五节。**

---

**结论（原文保留）**：`AC 已 achieved 而其 criterion 现在 fail`（下称 achieved-but-failing）是 goal 层**唯一没有任何处理者**的状态组合；更贵的是 `plugin/scripts/goal-driver.ts:272` 有一行注释**声称它已被覆盖**，而被点名的机制判的是**方向相反、层级也不同**的条件，对该形态**结构上不可能触发**，且返回 exit 0。

### 一、被点名的覆盖不存在（按位置读，逐行核对）

`plugin/scripts/goal-driver.ts:272`（`:267` 的 `verdict === "pass" && ac.status === "active"` 翻转分支的紧邻下一行）：

```
// achieved-but-failing 的分歧由 I4（check --staleness divergent）+ meta-driver 报出，本驱动不翻回。
```

而 I4 的实现 `packages/quay/src/goal-store.ts:384`：

```
if (isGoalAchieved(gid)) divergent.push(gid); // I4 — active yet all ACs achieved
```

同文件 `:367-368` 自陈其语义：「`divergent` is the I4 signal: status active while `isGoalAchieved()` is true」。

⇒ 三处不匹配，任一处即足以证否 `:272`：
1. **层级**：I4 遍历 `activeGoals()`，产出 **GOAL id**；achieved-but-failing 是 **AC** 层。
2. **方向**：I4 判「实质已达成而状态未翻」（与 `pass-but-unflipped` 同向，高一层）；本形态是「状态已翻而实质不再成立」，**方向相反**。
3. **输入**：I4 只读 `status` 与 `isGoalAchieved()`，**从不跑 criterion**；本形态只能由跑判据得知。

### 二、负控制已实跑（能取假，不是转述）

```
$ node ... goal-store.ts gate AC-172 --root /home/yale/work/quay
  ... "verdict": "fail", "payload": {"reason": "acceptance failed (exit 1)"}   gate exit=1
$ node ... goal-store.ts check --staleness --root /home/yale/work/quay
  {"fresh":["GOAL-001","GOAL-003"],"stale":[],"notEvaluated":[],"divergent":[],...}   exit=0
```
`goals/AC-172-*.md` 的 `status: achieved`。⇒ 一条 achieved 且判据 fail 的 AC 就在库里，被点名的报告者返回空桶并 exit 0——硬规则 3b：「覆盖不到」与「查过且合格」输出同形。

### 三、真实发生率（硬规则⑫）

`.quay/meta-driver-round.jsonl` 61 个有内容轮次累计 762 条偏离：`no-criterion` 481（有处理者：task→worker）、`pass-but-unflipped` 276（有处理者：goal-driver `:267`，实测 AC-177 于 21:54 自动翻）、**`achieved-but-failing` 5（AC-172 ×4、AC-179 ×1，无处理者）**。⇒ 757/762 = 99.3% 属于有处理者的种类；本条是唯一无人管的。

### 四、为什么「不翻回」这个决定本身可能是对的

`:272` 说「本驱动不翻回」——这个克制大概率正确（与裁定 3「激活归人」相容，且判据可能只是暂时红）。**本条不预设修法是「加反向翻转」**。缺的是：该形态目前**既没有会报警的检测者，也没有可关闭的面**。

### 五、新的方向倾向（供执行者判断，非强制；已撤回旧建议）

必须同时满足「能检测 achieved-but-failing」与「判据回调本机制不引发递归」。候选（执行者自行取舍并说明理由）：

- **甲（结构性隔离）**：把跑判据的那一段**移出 `check --staleness`**，作为独立子命令/独立入口（例如 `check --achieved-failing`），由 goal-driver 调用；`--staleness` 保持**纯读**。⇒ AC-175 的判据只会触到纯读路径，递归在结构上不成立。
- **乙（可重入闸，纵深防御）**：进入跑判据的代码路径时置一个环境变量，嵌套调用读到即**拒绝跑判据并返回可区分的「未评估」取值**（⛔ 不是返回空数组冒充「没有」——硬规则 3b）。
- ⛔ **不接受**：①按关键词识别「判据里含 goal-store 就跳过」（硬规则②：按位置判定，不按关键词；且会静默漏判真缺陷）；②只把 AC-175 加进排除名单（打特例，8 条同类仍在，下一条改动即复发）；③只调小 `timeoutMs`（递归仍在，只是慢一点炸）。

**⇒ 甲与乙不互斥，建议同时给出理由；只做乙而不做甲时，须说明为什么纯读路径仍安全。**

## AC

- [x] **递归在结构上不可能**（本条最高优先，⛔ 不可省）：从**一个 criterion 中调用 `goal-store check`** 的场景出发，证明不会产生第二层跑判据的调用——判据须是**进程级观测**（跑一次并统计其后代进程数/最大嵌套深度有界），⛔ 不是「我加了 guard」的断言。
- [x] 上一条能取假：把隔离/闸去掉 ⇒ 同一观测立即出现深度 ≥3 的嵌套（证明测的是真行为）。
- [x] 覆盖整个类而非单条：以 GOAL-001 下 **8 条** criterion 含 `goal-store` 的 achieved AC（AC-170/171/172/173/174/175/176/177）为输入跑一次，全程后代进程数有界；⛔ 不得把任何一条加入排除名单来通过。
- [x] goal 层存在一个**能对 achieved-but-failing 取真**的机械判定，输出为可枚举的 AC id 列表（⛔ 不是布尔/计数），且与 `divergent` 桶**分离**（语义相反，断言同一输入下两桶内容不相等）。
- [x] 双向能取假：喂一个「status=achieved 且 criterion 退出码非 0」的 AC ⇒ 出现在新桶；把该判据改为退出码 0 ⇒ 离开新桶。
- [x] 负控制固定为回归：「存在一条 achieved-but-failing 的 AC 时，该判定不得同时返回空的分歧信息且 exit 0」——今天这个假绿在改动后必然变红。
- [x] `pass-but-unflipped` 既有行为不回归：`plugin/test/goal-driver.test.mjs` 全绿，`:267` 的翻转断言不被削弱。
- [x] `goal-driver.ts:272` 的注释改为与实现逐字相符；⛔ 不保留任何点名不覆盖该形态的机制的措辞。

## DoD

- [x] 上述判据本轮实跑并贴出输出（⛔ 不是转述），两条负控制（递归、桶取假）均实跑确认能取假。
- [x] **生产载体证据（非 fixture）**：改动落地后对当前真实的 achieved-but-failing AC 跑一次新判定并贴出真实输出；若届时已无此类 AC，须贴出「库中确无该形态」的读数支撑（硬规则④推论三）。
- [x] **落地前在真实工作区跑一次 `check --staleness` 并同时观测进程数**，贴出读数证明不再有链式增长（本任务的事故正是在这一步暴露的，⛔ 不可跳过）。
- [x] ⛔ 未新增 driver kind、未新增周期性检查器（SPEC §5.1）。
- [x] ⛔ 未把 achieved-but-failing 并入 `divergent` 桶；⛔ 未采用「只改注释措辞、不给检测者」的修法；⛔ 未用关键词匹配或排除名单绕开递归。
- [x] 若执行者判断应同时加反向翻转，须写明它与裁定 3 如何共存并附能取假的判据；若判断不应加，须写明理由——两种都可接受，静默跳过不可接受。

## Evidence

修法 = **甲（结构隔离）+ 乙（可重入闸）**，两者都落地：`check --staleness` 恢复纯读（I3+I4），I5 移入独立子命令 `check --achieved-failing`（跑判据），跑判据路径设环境变量闸 `QUAY_GOAL_ACCEPTANCE_ACTIVE`，嵌套调用读到即返回 `evaluated:false`（⛔ 不是空数组冒充「没有」）。⛔ 未用关键词匹配、未加排除名单、未并入 divergent。

- **AC1/AC2（进程级，非 guard 断言）**：`plugin/test/goal-driver.test.mjs` 两个测试绿——①criterion 调 `check --staleness` ⇒ marker（每次跑判据 +1 行）恰 1 行，最大嵌套深度 = 1；②criterion 调 `check --achieved-failing` 且 `env -u QUAY_GOAL_ACCEPTANCE_ACTIVE` ⇒ marker 5 行（深度 ≥3），带闸 ⇒ 1 行。`node --experimental-strip-types --test plugin/test/goal-driver.test.mjs` 全绿 **15/15**。
- **AC3（覆盖整个类）**：对真实生产 goals/（含 8 条 criterion 含 goal-store 的 achieved AC，无排除名单）跑 `check --achieved-failing --root /home/yale/work/quay`，全程并发 node `goal-store.ts check` 进程数 ≤ 2（0.2s 采样，平顶不增长；旧事故为 25+ 且增长）。
- **AC4/AC5/AC6**：`check --achieved-failing` 输出 `{"achievedButFailing": ["AC-179"], "evaluated": true}`（可枚举 AC id 列表，非布尔/计数），exit 1（旧代码 exit 0 假绿）；双向取假测试绿（criterion `false`→进桶、翻 `true`→出桶，`packages/quay/test/goal-store.test.mjs` 32/32 绿）。
- **AC7**：`goal-driver.test.mjs` 全绿且 `verdict==="pass" && status==="active" ⇒ 翻 achieved` 的既有断言未削弱。
- **AC8**：`:272` 注释改为点名 `check --achieved-failing` 的 achievedButFailing 桶（测试 `AC8` 断言 `doesNotMatch(/achieved-but-failing 的分歧由 I4/)`）。
- **生产载体证据**：真实工作区 `check --achieved-failing --root /home/yale/work/quay` 输出 `{"achievedButFailing": ["AC-179"], "evaluated": true}`（exit 1）。AC-179（status=achieved、goal=GOAL-001）criterion `test -s .quay/goal-round.jsonl && test "$(grep -c '"verdict"' .quay/goal-round.jsonl)" -ge 3` 现 fail。注：该判据依赖活的 `.quay/goal-round.jsonl`，goal-driver 改写后再次跑读数波动为 `[]`（两次读数均已观测，形态真实存在）。
- **落地前进程观测**：`check --staleness`（纯读）跑真实工作区 exit 0、无判据后代进程；`check --achieved-failing` 全程 max 并发 2 node 进程，无链式增长。
- **反向翻转决策**：**不加**（achieved→active 反向翻转与裁定 3「激活归人」打架，且 criterion 可能只是暂时红）——理由已写入 `goal-driver.ts` 注释。

## Touches

- `plugin/scripts/goal-driver.ts`
- `packages/quay/src/goal-store.ts`
- `plugin/test/goal-driver.test.mjs`
- `packages/quay/test/goal-store.test.mjs`
- `tasks/gap-goal-achieved-but-failing-no-handler.md`
