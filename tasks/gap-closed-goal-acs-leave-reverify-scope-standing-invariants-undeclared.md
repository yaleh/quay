---
id: gap-closed-goal-acs-leave-reverify-scope-standing-invariants-undeclared
title: 两目标关闭后 21 条判据离开 I5 复验域——哪些属常设不变式须逐条裁定并声明 long-term
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

GOAL-009 与 GOAL-015 于 2026-09-11 相继 achieved 后，本仓库**没有任何 active goal**，I5 复验域（`goal-store.ts` `checkAchievedFailing` 的 `inScope`）由 **18 条降到 4 条**——只剩 4 条显式声明 `long-term: true` 的 AC（AC-161/188/189/190）。GOAL-009 的 17 条与 GOAL-015 的 4 条判据**全部离开复验域**，此后不再被任何机制重跑。

这本身是设计（`goal-store.ts` 注释：「an undeclared one leaves with its GOAL — 成本边界，⛔ 不做无差别放宽」），逃生口也已存在（`long-term: true`，AC-216 投影）。要决定的是：**这批判据里哪些属于「常设保证」，应当在其 goal 关闭后继续被复验。**

需要显式决定的理由是它们中有一类会**随时间自行失效**：新鲜度类判据按「证据 sha 到 develop 的提交距离 ≤ K」判定，K 默认 200。距离只增不减 ⇒ 不重跑就不会有人知道它已经红了。而检测「冻结的 achieved 却失败」的那条判据自己也在同一批里，一并出域。

⛔ 本任务不主张无差别把 21 条全标 long-term（那正是注释禁止的无差别放宽）；要的是按「该判据是一次性验收、还是常设不变式」逐条裁定，并把裁定落到记录字段上。

## Evidence

2026-09-11T17:23 实测（末轮 goal-round 的 `goal-ring` fact）：

- `scopeSize = 4`，`evaluated = true`；`inScope` 中属 GOAL-009 的 AC **0 条**
- 活跃 goal 清单：**空**
- 两目标判据此刻独立干跑：GOAL-009 17/17 exit 0、GOAL-015 4/4 exit 0（即出域时它们是绿的，问题不在当下而在此后无人复验）

新鲜度余量实测（K=200，距离 = `git rev-list --count <证据 sha>..develop -- <paths>`）：

| AC | 证据 sha | 距离 | 余量 |
|---|---|---|---|
| GOAL-009-AC-201 / AC-238 / AC-239 | 3b0932db3 | 0 | 200 |
| GOAL-009-AC-203 / AC-205 / AC-207 / AC-232 | 4a9654a1e | 69 | 131 |

⇒ 四条判据的证据已消耗掉 K 的三分之一，且距离单调增。

## 裁定（AC2，逐条）

判据：**该判据读的是「冻结的历史存证」还是「会随仓库演化的活量」**。只读载体
`.quay/productization-verification.jsonl` 里一次历史事件的判据 = 一次性验收（重跑只是重读同一批字节，
测不到当下的任何能力）；读当前源码 / 活测试 / 活台账 / develop tip 的判据 = 常设不变式（今后回退会让它转红）。

| AC | 裁定 | 理由 |
|---|---|---|
| AC-201 | 一次性验收 | 只读载体里「曾产出一个锚在 develop 祖先上的 build」的记录；祖先关系单调 ⇒ 记录一落即永久为真。它的「持续新鲜」由 AC-214 承担，不重复。 |
| AC-202 | 常设不变式 | 读**当前源码**：`plugin/scripts/driver-runtime.ts` 的字面量表 vs `build-plugin-dist.mjs` 推导出的交付集 ⇒ 今后新增一个 driver kind 而漏进交付物即转红。 |
| AC-203 | 一次性验收 | 只读载体里「某第三方项目曾无 plugin/ 而 driver 存活」的记录，历史存证。 |
| AC-204 | 常设不变式 | 前半读**当前源码** `quay-init-closure-assertion.ts` 的 FORBIDDEN_PREFIXES ⇒ 删掉 `.mcp.json`/`commands`/`hooks` 任一项即转红（quay-init 开始写实现文件的回归）。 |
| AC-205 | 一次性验收 | 只读载体里的 transcript_confirmed 记录，是过去一次投递的存证。 |
| AC-206 | 常设不变式 | 三段都读**当前仓库**：SPEC 的 closed-set 块、`CLOSED_SET_DIRS`、`quay-init.sh` 的 mkdir ⇒ goals/ 从任一处掉出即转红（新项目失去 goals 载体）。 |
| AC-207 | 一次性验收 | 只读载体里「某第三方项目曾由 driver 驱动出真实开发提交并翻 done」的记录。 |
| AC-214 | 常设不变式 | **本批的核心**：输入含 develop tip —— 判据 = 证据 sha 到 develop 的交付面提交距离 ≤ K，距离**单调增** ⇒ 不重验就自己转红。这正是「常设保证」的定义，也是本任务存在的理由。 |
| AC-232 | 一次性验收 | 只读载体里「目标项目 goal 载体曾可写、可读回」的记录。 |
| AC-233 | 常设不变式 | 跑**活测试** `plugin/test/shipped-entry-runnable.test.mjs` ⇒ 今后交付包里再出现「形如入口但装不上跑不动」的文件即转红。 |
| AC-234 | 一次性验收 | 只读载体里「web 曾渲染过第三方项目真实载体」的记录。 |
| AC-235 | 常设不变式 | 跑**活检查器** `config-key-consumer-check.ts` 并断言它登记在 checker-mutation-check ⇒ 出现零消费者的配置键即转红。 |
| AC-236 | 常设不变式 | 跑**活棘轮** `host-repo-surface-ratchet.ts`（CLI 动词集 / 路由集 / 有消费者配置键集单调不缩）⇒ 本仓库行为回退即转红。 |
| AC-237 | 常设不变式 | 跑**活的** acceptance-runner 夹具，断言失败 reason 携带判据自身 stderr ⇒ runner 今后丢掉 stderr 即转红。 |
| AC-238 | 一次性验收 | 只读载体里「某旧版项目曾被当前 tip 干净接管且任务不丢」的记录。 |
| AC-239 | 一次性验收 | 交叉引用 AC-238 的过去记录（同一 project_root）证明「升级后还能接着干」，仍是历史存证。 |
| AC-240 | 一次性验收 | 交叉引用 AC-203 与 AC-207 的过去记录是否共享同一 (host, project_root)，历史存证。 |
| AC-241 | 常设不变式 | 读**活台账** `.quay/gate-events.jsonl` ⇒ 今后任何 goal-gate 失败 reason 退化为空因模板即转红。 |
| AC-242 | 常设不变式 | 读活台账 + 当前 `goals/`：断言没有 AC「已离开复验域却尾事件为 fail」。**本任务正是改变复验域的那一个**，这条必须活着。 |
| AC-243 | 常设不变式 | 运行时取 runner 真实的零输出成因文本，与 AC-241 声明的常量比对 ⇒ AC-241 的检测器退化为恒绿时它必须报红。 |
| AC-244 | 常设不变式 | 从当前 `goals/` + 载体**机械推导**载体型主体集合，断言无成员逃出 AC-214 的 NEED ⇒ 今后新增载体型 AC 未接线即转红（AC-232/238 就是这么被抓到的）。 |

**计数（枚举，非布尔）**：常设不变式 **12** 条 —— AC-202/204/206/214/233/235/236/237/241/242/243/244；
一次性验收 **9** 条 —— AC-201/203/205/207/232/234/238/239/240。12+9=21 ✓（⛔ 不是无差别全标）。

**AC1 的断言与它的取假半边（诚实说明）**：AC1 的字面断言「清单中不含任何 goal 已 achieved 且未声明
long-term 的 AC」在**改前改后都为真**（改前复验域只有 4 条已声明 long-term 的；改后 12 条也都有声明）
—— 它是一条**守卫**（防无差别放宽），不是可取的假。真正**改前为假**的是同一命令的
`standingMissing`（裁定为常设不变式却未落成字段），以及 AC4 的 scopeSize 差量与集合相等。
二者由同一条命令 `goal-store check --reverify-scope --adjudication <本任务体>` 一并给出：
改前 exit 1（12 条全在 standingMissing 里），改后 exit 0。

## AC

- [x] AC1（现状读数，可取假）：跑一条命令打印当前 I5 复验域的 `scopeSize` 与 `inScope` 全量清单，并逐条标注每个 id 的 goal 与 goal 的 status；断言清单中不含任何 goal 已 achieved 且未声明 long-term 的 AC——改前此断言应为**假**（当前 GOAL-009 的 17 条正是这种情形的反面：它们已不在清单里）。
- [x] AC2（逐条裁定，枚举非布尔）：对 GOAL-009 的 17 条与 GOAL-015 的 4 条**逐条**给出「一次性验收 / 常设不变式」的裁定与一句理由，落在本任务体的表格里；⛔ 不得整批同判。
- [x] AC3（裁定落地）：被判为常设不变式的 AC 全部写入 `long-term: true`；被判为一次性验收的保持原样。改动只碰该字段，其余字段与正文逐字节不变（改前改后 diff 为证）。
- [x] AC4（复验域读数变化）：改后重跑 AC1 的同一条命令，`scopeSize` 增加的条数 == AC3 中被标记的条数，且新增的 id 集合与被标记集合逐字相等。
- [x] AC5（取假控制）：对任取一条被标 long-term 的 AC，临时把其判据改成必然失败的形态并跑一次 I5，`achievedButFailing` 必须包含它；恢复后不再包含。证明它真的在被复跑，而不只是名字进了清单。
- [x] AC6（新鲜度余量可见）：给新鲜度类判据的失败输出补上「当前距离/K」的数字（⛔ 不是布尔），使「还剩多少余量」在红之前就能被读到。
- [ ] AC7（全量绿）：`scripts/test.sh` 全量绿（待外部）

## DoD

生产读数可验证：I5 复验域在两目标关闭后仍覆盖被裁定为常设不变式的那些判据，且其中至少一条被实际重跑过（goal-round 记录中出现其 id 的复验痕迹）。⛔ 「字段已写上」不算——必须是复验域读数与重跑痕迹。fixture 与单测是必要不充分条件（DIR-026 Reading A）。

## 执行记录（证据，AC1/3/4/5/6）

命令（AC1/AC4 的**同一条**，在工作树内跑；`--adjudication` 指向任务体自身）：

```
node --experimental-strip-types packages/quay/src/goal-store.ts check --reverify-scope \
  --adjudication tasks/gap-closed-goal-acs-leave-reverify-scope-standing-invariants-undeclared.md
```

- **AC2**：上表 21 行**逐条**裁定（12 常设 / 9 一次性），判据与理由见该节。
- **AC1 改前读数**（本任务改动前、同一命令）：`scopeSize=4`、`evaluated=true`、
  `inScope=[AC-161, AC-188, AC-189, AC-190]`（四条均 `longTerm=true`、goal 均 achieved）、`activeGoals=[]`；
  `adjudication.standingMissing` = **12 条**（= 上表全部常设不变式），`violations=12`，**exit 1**。
  ⇒ 「裁定未落成字段」在改前报红——这是**真正可取假**的那一半。
  ⚠️ AC1 的字面断言（「清单中不含 goal 已 achieved 且未声明 long-term 的 AC」）改前改后**都为真**：
  给定 `inAchievedReverifyScope`，goal 已 achieved ⇒ 不在 active 集 ⇒ 入域必靠 `longTerm` ⇒ 该谓词
  结构上不可能命中。已在代码注释与 `AC-reverify-1` 里如实标为**对谓词的 tripwire**，⛔ 不当测量用。
- **AC3**：`goal-store write <id> --long-term true` 逐条写 12 条。`git diff <分支起点> -- goals/` 为证：
  **11 个文件各恰好新增一行 `long-term: true`、零删除**；AC-214 另有 AC6 的判据改动，是唯一多于一行的。
  **实测涌现的缺陷（已修）**：AC-202 首次经 `store.write` 落字段时，序列化器把它**手工折行的 `expect`
  标量重新折行** ⇒ 改动不再是「只碰该字段」。已按【原始字节 + 插入一行】重做（commit `aa36ed9b1`），
  净 diff 回到一行。⇒ 定式：**store 的「写一个字段」不保证字节级最小 diff**；凡判据要求逐字节不变，
  写完必须 `git diff` 核，⛔ 不许假定。
- **AC4 改后读数**：同一条命令 `scopeSize=16`（+12）、`standingMissing=[]`、`violations=[]`、**exit 0**；
  新增 id 集合 = {AC-202,204,206,214,233,235,236,237,241,242,243,244}，与 AC3 被标记集合**逐字相等**。
- **AC5 取假控制（两向实测）**：取 AC-202，用 `store.write(..., {commit:false})`（⛔ 不落 git）把 criterion
  换成 `echo AC5-CONTROL-INJECTED >&2; exit 1` ⇒ I5 `check --achieved-failing` 得
  `scopeSize=16, achievedButFailing=["AC-202"]`、exit 1（19s）；再 `git checkout HEAD -- <file>` 还原，
  sha256 与注入前**逐字节相同**（`cmp` exit 0、`git status` 干净）⇒ 重跑 I5 得 `achievedButFailing=[]`、exit 0。
  ⇒ **AC-202 真的在被复跑**，不只是名字进了清单。
- **AC6**：AC-214 的判据现在对**每一条**主体 AC 恒输出 `freshness <ac>: <d>/<K> (margin <K-d>)`，并把同一组
  数字写进运行期载体 `.quay/goal-freshness-margin.json`（`.gitignore` 已登记该路径）。
  **为什么必须落载体**：acceptance-runner 只在**失败**时把判据输出折进 `reason`（`withFailureOutput`）
  ⇒ 若只写 stdout，本 AC 绿着的时候这些数字**到不了任何消费者**，「红之前就能被读到」不成立。
  实测（绿，`at=2026-09-11T17:40:57Z`）：`k=200`，`AC-201/238/239 d=0 margin=200`；
  `AC-203/205/207/232 d=69 margin=131`（与上方 Evidence 表的实测值一致）。
  实测（红，`QUAY_GOAL009_FRESHNESS_K=1`）：
  `reason = acceptance failed (exit 1) — stale evidence: GOAL-009-AC-232:69/1 (margin -68), …`
  ⇒ **失败输出带「距离/K」**（⛔ 不是布尔）。
- **单测**：`packages/quay/test/goal-store.test.mjs` 新增 5 例（`AC-reverify-1..5`），63/63 绿；
  scoped 门 `scripts/test.sh --for-task <id> --allow-thin` 145/145 绿、exit 0。

**⛔ AC7 不在本 worker 的取证面内**：全量套件由 fan-in 机械驱动运行（本 worker 只跑 `--for-task` scoped 门），
故 AC7 保持**未勾**并标注 `（待外部）`——仓库既有的「等外层验证」声明形态，⛔ 不是「已完成」的伪装。

**DoD 的载体面说明（诚实标注，⛔ 不把「痕迹尚未生成」冒充「已验证」）**：DoD 点名的 **`goal-round` 复验痕迹
本 worker 造不出来**。实测：生产 goal-driver 以 `--root /home/yale/work/quay` 运行（pid 998575），
它读的是**主检出**的 `goals/`，而本任务的 12 条 `long-term` 字段此刻只在任务分支上。取证：本工作树的
`.quay/goal-round.jsonl` 与主检出的同名文件是**前缀拷贝**关系（`cmp` 通过，非同一 inode），
且 round **163–168（17:42–17:47，标记全部落地之后）** 的 `goal-ring` 仍是 `criterionCount=4`、
ids=`[AC-161,188,189,190]` ⇒ **该驱动读的不是本工作树**。
⇒ DoD 的那半条是**落地后的自动生产事件**：fan-in ff 到 develop ⇒ promotion-driver 每轮启动前的
`syncDevelopToDoc` 把主检出 ff 到 develop ⇒ 下一轮 `goal-ring` 即列出 16 条并逐条跑出 verdict。
**本节能证的是**：①复验域读数已覆盖那 12 条（`scopeSize=16`、exit 0）；②它们**真的被跑**
（16 条全部实跑，且 AC-202 的红控制证明被标记者确在执行路径上）；③`goal-ring` 用的就是同一个谓词
（round 168 列出的 4 条正是此前已声明 long-term 的那 4 条）。**未证的是**主检出那份载体上的痕迹——
它按上述机制自动生成，本任务不在此冒充已生成。

## Touches

- plugin/test/ac214-freshness-subject-set.test.mjs
- goals/AC-214-交付证据必须新鲜-四条载体型判据不得-一旦转绿即永久绿.md
- goals/AC-202-凡被-spawn-的机件必进交付物-把闭包闸扩到-driver-kinds-这类数据表字面量引用.md
- goals/AC-204-quay-init-只写启用不写实现-禁列补-mcp-commands-hooks-且成对判定.md
- goals/AC-206-目标项目具备-goals-tasks-双载体-goals-与-tasks-一同由-quay-init-创建.md
- goals/AC-233-下游-cli-底线自洽-同一宿主上-driver-可跑而-cli-拒跑的不一致必须被报出-不让人自己去撞-退出条件①.md
- goals/AC-235-交付的每个配置键都有消费者-零消费者的键已接线或已删-由机械枚举证明-退出条件③.md
- goals/AC-236-本仓库自身行为不得因本-goal-的改动而回退-cli-动词集-web-路由集-有消费者的配置键集单调不缩-退出条件④.md
- goals/AC-237-失败判据必须可归因-goal-gate-记录的失败-reason-必须携带判据自身写出的成因-不得只留-exit-1.md
- goals/AC-241-生产台账上失败判据必须可归因-任何-goal-gate-verdict-fail-的-reason-不得是-判据没写任何.md
- goals/AC-242-台账不得留下-已离开复验域却尾事件为-fail-的-ac-否则下游判据-ac-241-结构上永不通过-被误读成-还有真缺.md
- goals/AC-243-ac-241-的空因常量必须与-acceptance-runner-实际产出的零输出成因文本同源-ac-241-自身退化.md
- goals/AC-244-新鲜度约束的主体集合必须由载体机械推导-后加入的载体型-ac-今天-ac-232-ac-238-不得自动逃出-ac-21.md
- .gitignore
- packages/quay/src/goal-store.ts
- packages/quay/test/goal-store.test.mjs
- tasks/gap-closed-goal-acs-leave-reverify-scope-standing-invariants-undeclared.md

### develop 侧红修复：AC-244 的接线钉自己复制了真相源（2026-09-11 本轮）

**症状（fan-in `step=suite`，非本任务缺陷，但按 fail-closed 归本任务）**：
`plugin/test/ac214-freshness-subject-set.test.mjs` 的 AC4 红，stderr 为
`no evidence yet: GOAL-009-AC-201,…,AC-239`（**看似「守卫坏了」**）。

**真因（一条命令取证）**：`git merge-base --is-ancestor a26bd6c66 develop` ⇒ **YES**。
该 develop 提交（17:16）把 `GOAL-009-AC-239` **正确地**并入 AC-214 的 `NEED`
（AC-239 判据正文只读 `.quay/productization-verification.jsonl`、`SRC_RE` 零命中 ⇒ 按 AC-244 自己的规则确属载体型）。
而该测试（12:54 落地）**硬写了一份 `NEED_IDS = [201,203,205,207,232,238]` 副本**，并把 `239` 当「NEED 之外」的探针
⇒ 副本过期后 AC4 **语义反转**：它原本断言「守卫指名逃出的那条」，现在断言了反面。
⇒ 不是守卫坏了，是**测试钉死了它并不拥有的一份活产物的快照**。`goals/` 与该测试均在 develop、
本分支 delta 不含它们（`git diff develop...HEAD -- <两个路径>` 为空）。

**修法（⛔ 不是把 239 换成另一个字面量——同形会再犯）**：主体集合与探针**都机械取自判据正文** ——
`needSubjectSet(criterion)` 从 `NEED = [` 行取成员、探针取 `max(NEED)+1`（**按构造**在集合外，
NEED 今后再增员也不会让它过期）；两个独立读法（按行 vs 全文引号匹配）互校，少读即当场报错（硬规则 3b）。

**实测（三步，本地命令逐条可复跑）**：
- **改后绿**：`node --test plugin/test/ac214-freshness-subject-set.test.mjs` ⇒ **5/5 pass**；
  AC5 现在覆盖全部 **7** 条 NEED，AC4 探针自动推导为 **AC-240**（= `max(NEED)+1`）。
- **仍可取假（红控制）**：把判据正文的 `unwired = sorted(SUBJ - set(NEED))` 换成 `unwired = []`
  ⇒ **2 例转红**（AC4 + 「判据正文含 SUBJ 推导块与 unwired 守卫」）；`git checkout --` 还原后
  sha256 `501fab0d…d441` **逐字节相同**、`git status` 干净。
- **非空转**：AC4 仍钉着 `SRC_RE` 的 `\b` 词边界（探针正文含 `.jsonl`，子串写法会让候选集恒空）。

**与兄弟分支的关系（诚实标注）**：同一修复已存在于在飞分支
`task/gap-ff-merge-suite-cert-classifier-unshipped-and-misreported`（提交 `fb488fc50`，17:42）。
本分支**逐字节取用同一份内容**（`git diff <该分支> -- <file>` 为空）——这不是抄近路，
而是**故意让两侧改动字节相同**，从而使先落地的一方让另一方的合并成为 no-op、⛔ 不制造第二次冲突。
