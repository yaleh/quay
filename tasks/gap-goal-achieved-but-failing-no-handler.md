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

**结论**：`AC 已 achieved 而其 criterion 现在 fail`（下称 achieved-but-failing）是 goal 层**唯一没有任何处理者**的状态组合；更贵的是 `plugin/scripts/goal-driver.ts:272` 有一行注释**声称它已被覆盖**，而被点名的机制判的是**方向相反、层级也不同**的条件，对该形态**结构上不可能触发**，且返回 exit 0。

### 一、被点名的覆盖不存在（按位置读，逐行核对）

`plugin/scripts/goal-driver.ts:272`（`:267` 的 `verdict === "pass" && ac.status === "active"` 翻转分支的紧邻下一行）：

```
// achieved-but-failing 的分歧由 I4（check --staleness divergent）+ meta-driver 报出，本驱动不翻回。
```

而 I4 的实现 `packages/quay/src/goal-store.ts:384`：

```
if (isGoalAchieved(gid)) divergent.push(gid); // I4 — active yet all ACs achieved
```

同文件 `:367-368` 的注释自陈其语义：「`divergent` is the I4 signal: status active while `isGoalAchieved()` is true ("achieved but nobody closed it")」。

⇒ 三处不匹配，任一处即足以证否 `:272`：
1. **层级**：I4 遍历的是 `activeGoals()`，产出的是 **GOAL id**；achieved-but-failing 是 **AC** 层的状态。
2. **方向**：I4 判「实质已达成而状态未翻」（与 `pass-but-unflipped` 同向，高一层）；achieved-but-failing 是「状态已翻而实质不再成立」，**方向相反**。
3. **输入**：I4 只读 `status` 与 `isGoalAchieved()`（后者只看 AC 的 `status` 字段），**从不跑 criterion**；而 achieved-but-failing 只能由跑判据得知。

### 二、负控制已实跑（能取假，不是转述）

生产载体现场，同一分钟内两条命令：

```
$ node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-172 --root /home/yale/work/quay
  ... "verdict": "fail", "payload": {"reason": "acceptance failed (exit 1)"}
  gate exit=1
$ node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts check --staleness --root /home/yale/work/quay
  {"fresh":["GOAL-001","GOAL-003"],"stale":[],"notEvaluated":[],"divergent":[],"cap":3,"staleMs":604800000}
  exit=0
```

`goals/AC-172-*.md` 的 `status: achieved`。⇒ **一条 achieved 且判据 fail 的 AC 就在库里，被点名的报告者返回空桶并 exit 0。** 这正是硬规则 3b 的形态：「读不懂/覆盖不到」与「查过且合格」输出同形——`divergent: []` + exit 0 与「一切健康」逐字节相同。

### 三、真实发生率（硬规则⑫，查历史不等下一轮）

`.quay/meta-driver-round.jsonl` 61 个有内容轮次累计 762 条偏离，按 kind 拆：

| kind | 次数 | 处理者 | 实证 |
|---|---|---|---|
| `no-criterion` | 481（AC-143..155 共 13 条 × 37 轮） | task → worker | 补判据的 task 于 19:03 落地，该类当轮消失 |
| `pass-but-unflipped` | 276 | goal-driver `:267` | goal-driver 21:47 常驻后，AC-177 于 21:54 被自动翻 achieved（`a885938ec`） |
| **`achieved-but-failing`** | **5**（AC-172 × 4、AC-179 × 1） | **无** | AC-172 自 01:48 报到 02:47，立案时仍在报，无任何机制动作 |

⇒ 757/762 = 99.3% 属于有处理者的种类；本条是**唯一**无人管的。发生率 5（两个不同对象），不是零，也不是靠"等下一轮"取得。

### 四、为什么"不翻回"这个决定本身可能是对的，缺的是别的

`:272` 说「本驱动不翻回」——这个克制大概率正确：`achieved → active` 的反向翻转会与裁定 3（激活归人）打架，且判据可能只是暂时红（外部依赖、suite 抖动）。**所以本条不预设修法是"加反向翻转"。** 缺的是：该形态目前**既没有会报警的检测者，也没有可关闭的面**——meta-driver 会报，但它按规格 `⛔ You never flip a status yourself`，且其输出只落在轮记录里。

**方向倾向（供执行者判断，非强制）**：把 achieved-but-failing 做成一个**独立取值**（既不并入 `divergent`，也不静默），由跑判据的一侧产出，并落到一个有处理者的面上——最小形态是让 `check --staleness` 增加一个 `achievedButFailing: string[]` 桶（AC id）并据此定退出码，使任何调用者都能取假。⛔ **不接受**的修法：把它塞进现有 `divergent` 桶（两者语义相反，合桶后调用者无法区分）；只改 `:272` 的注释措辞而不给它检测者（那只是把假覆盖改成明说没覆盖，发生率 5 的问题原地不动）。

## AC

- [x] `:272` 的声明与实现一致：goal 层存在一个**能对 achieved-but-failing 取真**的机械判定，其输出为可枚举的 AC id 列表（⛔ 不是布尔、不是计数——SPEC §5.3：不枚举对象则零指引价值），且与 `divergent` 桶**分离**（两者语义相反，断言同一输入下两个桶内容不相等）。
- [x] 双向能取假：喂一个含「status=achieved 且 criterion 退出码非 0」的 AC 的载体 ⇒ 该 AC 出现在新桶中；把同一 AC 的判据改为退出码 0 ⇒ 该 AC 离开新桶。两个方向都断言。
- [x] 负控制固定为回归：以本任务实测的现场为形，断言「存在一条 achieved-but-failing 的 AC 时，`check --staleness` 不得同时返回空的分歧信息且 exit 0」——即今天这个假绿在改动后必然变红。
- [x] `pass-but-unflipped` 既有行为不回归：`plugin/test/goal-driver.test.mjs` 全绿，且 `verdict==="pass" && status==="active" ⇒ 翻 achieved` 的既有断言不被削弱（⛔ 不得为了让新桶通过而放宽 `:267`）。
- [x] `goal-driver.ts:272` 的注释改为与实现逐字相符；⛔ 不允许保留任何点名一个不覆盖该形态的机制的措辞。

## DoD

- [x] 上述判据本轮实跑并贴出输出（⛔ 不是转述、不是「应该会过」），负控制实跑确认能取假。
- [x] **生产载体证据（非 fixture）**：改动落地后，对**当前真实的** AC-172（或彼时任一 achieved-but-failing 的 AC）跑一次新判定，贴出它出现在新桶中的真实输出；若届时已无此类 AC，须贴出「库中确无该形态」的读数支撑（⛔ 不得以 fixture 通过冒充生产已验，硬规则④推论三）。
- [x] ⛔ 未新增 driver kind、未新增周期性检查器（SPEC §5.1）；新增的是既有 `check --staleness` 的一个取值。
- [x] ⛔ 未把 achieved-but-failing 并入 `divergent` 桶；⛔ 未采用「只改注释措辞、不给检测者」的修法。
- [x] 若执行者判断应当同时加反向翻转，须在任务体中写明它与裁定 3（激活归人）如何共存，并附一个能取假的判据；若判断不应加，须写明理由——**两种都可接受，静默跳过不可接受**。

**执行者决策（DoD 第 5 条，不加反向翻转）**：`achieved → active` 是激活动作，裁定 3 明确「激活归人」，机械反向翻转会与之打架；且判据 fail 可能只是暂时红（外部依赖 / suite 抖动）。本任务新增的检测者（`check --staleness` 的 `achievedButFailing` 桶 + 退出码 1）把该形态交还给有处理者的面，无需翻状态。实测生产读数：`achievedButFailing: ["AC-164","AC-172","AC-175","AC-177","AC-179"]`、`divergent: []`、exit 1。

## Touches

- `plugin/scripts/goal-driver.ts`
- `packages/quay/src/goal-store.ts`
- `plugin/test/goal-driver.test.mjs`
- `packages/quay/test/goal-store.test.mjs`
- `tasks/gap-goal-achieved-but-failing-no-handler.md`