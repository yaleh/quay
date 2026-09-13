---
id: gap-ac190-goal-ac-rule-not-enforced-at-filing
title: AC-190 判据复发：规则只在事后检测、立案/写入面零约束——生效线后第一条 delivery-critical 任务即无 goal_ac
status: ready
labels:
  - gap
  - defect
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-190
---
## Proposal

**AC-190 判据当前取假（实测 2026-09-13，本仓库生产工作树）**：

    $ node --no-warnings --experimental-strip-types plugin/scripts/long-term-guarantee-goal-backed-check.ts
    FAIL: 生效线之后新立案的 delivery-critical 任务未声明 goal_ac（fail-closed）: gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak
    EXIT=1

`--json` 读数：`{"total":156,"violating":["gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak"],"compliant":35,"grandfathered":120,"grandfathered_no_goal_ac":115,"grandfathered_with_goal_ac":5,"cutoff":"2026-09-09T00:00:00Z","ok":false}`。

**反例是真的，不是判据误报**：`tasks/gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak.md`
的 frontmatter `labels` 含 `delivery-critical`（首见于 `ef4c12f37`，2026-09-13T08:17:18Z，
晚于生效线 `2026-09-09T00:00:00Z`），且 top-level 与 `extra` 下都没有 `goal_ac` 键。
⇒ 检测器判对了；红的是仓库本身。

### 为什么上一次修法没守住（根因，不是复述现象）

上一次修法 `gap-long-term-guarantee-registry-hand-maintained`（**status: done**，2026-09-09，
`goal_ac: AC-190`）把判据从「手维护三项登记表」换成位置判定 + 生效线，方向正确；它没守住有三个可查原因：

1. **它落地时的绿是真空的，不是测出来的。** 它自己的 `## Evidence` 逐字记着实现时读到
   `total=120 / grandfathered=120`，即 `compliant=0`、`violating=0`——生效线之后**一条任务都还没有**。
   于是「生效线之后的 delivery-critical 任务均有 goal_ac」在那一刻靠**样本不存在**而成立，
   连 fixture 都不用出场。硬规则④推论三（只能被 fixture / 注入满足的判据不是测量）在这里更弱一档：
   **一个空集上的断言不是断言。**
2. **它的 AC1–AC6 全部测的是脚本，没有一条把规则接到撰写/落地面。** 于是规则只存在于**事后**：
   检测器每轮在 goal 层跑，看得见违反，却没有任何权力阻止违反发生——它是一份只读报告。
   硬规则⑨（守与不守若在记录上无法区分，就只能靠意志 ⇒ 该给它造产物）：产物造出来了，
   但造在了**违反发生之后**。2026-09-13 第一条生效线后的 delivery-critical 任务经本仓自己的立案路径
   写入、promotion-driver 机械晋升到 ready，全程没有任何一步问过 `goal_ac`。
3. **准入面这条路已被明令封死，所以落点只能是立案面。** `ready-pool-check.ts` 的准入合取里曾经有过
   `goalAcMissing` 判据，已按**人 2026-09-11 裁定**移除：「准入集合只由 task 自身的自足属性决定；
   goal 信息最多改变集合内的顺序，**永不改变成员资格**」（机械守卫
   `plugin/scripts/eligible-no-goal-source-check.ts`；`ready-pool-check.ts:2012` 与 `:2181` 两处注释
   逐字记录了这次移除与其理由——准入可以减集合到空 ⇒ 僵尸任务）。
   ⇒ **⛔ 不得把这条规则塞回晋升/准入合取**。AC-190 的标题本身就是「**新立案**任务必须声明 goal_ac」，
   落点是**立案/写入那一刻**。

### 交付什么

1. **清掉当前反例**：给 `gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak` 声明真实的
   top-level `goal_ac`。它是第三方项目 goal/adr/meta store 解析缺陷 ⇒ 属 GOAL-009 的 productization 集合；
   `AC-206`（目标项目具备 goals+tasks 双载体）是具名候选，实现者须读其 criterion 后确认或改选，
   **并把「为什么是这条 AC」写进该任务体**——⛔ 不得只填一个 id 不写理由（那会把 goal_ac 变成装饰）。
2. **把规则接到立案/写入面**：让「新立案 + 带 `delivery-critical` + `goal_ac` 空」在**写入那一刻**被拒。
   判定必须**单源复用** `long-term-guarantee-goal-backed-check.ts` 已导出的纯函数
   （`isDeliveryCritical` / `hasGoalAc`），⛔ 不复制第二份字符串判定。
   主选落点 = `plugin/scripts/precommit-guard.ts`：它已有一条对 **staged `tasks/*.md`** 的检测器先例
   （Touches「一条目一路径」，2026-08-16 立），同一位置、同一形态、同一写入时刻。
3. **双向负控制**（硬规则③b/④）：正控制 = 真仓库现存的 35 条合规任务不报；负控制 = 构造一条
   「staged 新增 + 带 `delivery-critical` + 无 `goal_ac`」的任务文件 ⇒ 判定必须拒（exit 非零）；
   反向对照 = 同一条补上 `goal_ac` ⇒ 必须放行。⛔ 不接受只有单向断言的实现。
4. **不得误伤**：生效线之前的存量（115 条无 `goal_ac`）不得被这条新判定拒；无标签的任务、
   非 `tasks/` 路径的提交、删除操作都不触发。⛔ 让一次存量红卡死所有写入者、卡住 loop，
   比没有这条判定更贵——这正是 `eligible-no-goal-source-check.ts` 立条时记下的「僵尸」教训。

<!-- dedup-ref -->
相关但机制不同的既有任务（立案时按机制查重的记录，无依赖边）：`gap-long-term-guarantee-registry-hand-maintained`（done，交付检测器本身）、`gap-ac190-long-term-guarantee-goal-backed-check`（done，交付脚本）、活着的准入面守卫 `plugin/scripts/eligible-no-goal-source-check.ts`（管「准入不得读 goal 源」，与本条的落点互补而非重叠）。

## Plan

1. 读四份正本再动手：`goals/AC-190-task-ac.md`（判据 + 2026-09-09 换形态记录）、
   `plugin/scripts/long-term-guarantee-goal-backed-check.ts`（现行位置判定、生效线、已导出的纯函数）、
   `plugin/scripts/precommit-guard.ts` 头部与其 staged `tasks/*.md` 检测器（先例形态）、
   `plugin/scripts/eligible-no-goal-source-check.ts` 头部（被封死的落点与其理由）。
2. 固定改前读数：跑 `long-term-guarantee-goal-backed-check.ts --json` 存档 `violating` 清单
   （预期 `["gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak"]`）——这是修复后的对照基线。
3. 给 `gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak` 定 `goal_ac`：读 GOAL-009 相关 AC
   （`goals/AC-19x-*.md` / `goals/AC-20x-*.md`）逐条读 criterion，选领域覆盖「目标项目自己的
   goal/adr/meta store 解析与隔离」的那一条；把选择理由写进该任务体（新增一行或写进其 Proposal）。
   ⛔ 写入走 task_write / Provider ABI，⛔ 不手改 frontmatter 文本；写完用 `quay task check <id> --json` 回读。
4. 实现写入面判定（主选 `precommit-guard.ts`，理由见 Proposal 交付项 2；单源复用 `task-schema.ts` 的
   `frontmatterLabels` / `frontmatterGoalAc` 与检测器导出的 `isDeliveryCritical` / `hasGoalAc`）：
   对 staged `tasks/*.md` 中**新增**（`--diff-filter=A`）的文件，若带 `delivery-critical` 且 `goal_ac` 空
   ⇒ 拒（exit 1，reason=`delivery-critical-without-goal-ac`，输出含文件路径 = 补救位置）。
   ⚠️ 若实现需要新建 `plugin/scripts/*.ts`，则三处注册闸（capability-catalog + outline + laydown）
   必须一并落进 `## Touches`（见 `plugin/scripts/capability-catalog.sh` 头注释）；主选落点不需要新建脚本。
5. 测试：在 `plugin/test/precommit-guard.test.mjs` 加正 / 负 / 对照三类断言——新增 + 标签 + 无 goal_ac ⇒ 拒；
   新增 + 标签 + 有 goal_ac ⇒ 放行；存量（生效线之前）+ 标签 + 无 goal_ac ⇒ 放行；
   新增 + 无标签 + 无 goal_ac ⇒ 放行。每条对照都必须**能取假**（硬规则④）。
6. 跑 `eligible-no-goal-source-check.ts` 确认仍 exit 0（未把 goal 源塞回 `ready-pool-check.ts` 的准入合取）。
7. 跑 AC-190 判据链确认 exit 0：脚本存在 → 真仓库默认运行绿 → `--inject-unbacked-fixture` 仍红；
   并在同一次提交里记下改前 / 改后两个读数（红前 `violating=[...]`、绿后 `violating=[]`）。

## Acceptance Criteria

- [x] AC1 `node --no-warnings --experimental-strip-types plugin/scripts/long-term-guarantee-goal-backed-check.ts` exit 0；`--json` 的 `ok` 为 `true` 且 `violating` 为 `[]`
- [x] AC2 `--inject-unbacked-fixture` 仍 exit 非零（负控制未被削弱——⛔ 不得靠放宽判据换绿）
- [x] AC3 `tasks/gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak.md` 的 top-level `goal_ac` 非空，且该任务体里写明「为什么是这条 AC」的理由
- [x] AC4 写入面负控制：一条「staged 新增 + `delivery-critical` + 无 `goal_ac`」的任务文件 ⇒ 判定 exit 非零；反向对照（同一条补上 `goal_ac`）⇒ exit 0
- [x] AC5 不误伤：生效线之前的 delivery-critical 任务文件交给同一判定 ⇒ exit 0；无标签的任务、非 `tasks/` 路径不触发
- [x] AC6 单源：写入面判定与 `long-term-guarantee-goal-backed-check.ts` 共用同一组判定函数（证据 = `hasGoalAc` / `isDeliveryCritical` 的 `import` 行，⛔ 不是第二份字符串比较）
- [x] AC7 `plugin/scripts/eligible-no-goal-source-check.ts` exit 0（未把 goal 源塞回准入合取）
- [ ] AC8 `scripts/test.sh` 全量绿（含 AC4/AC5 的正、反、对照断言）（待外部）
- [x] AC9 `node packages/quay/bin/quay.ts task check gap-ac190-goal-ac-rule-not-enforced-at-filing --json` 的 `missing` 为 `[]`

## Definition of Done

生产工作树上同时成立两件事，缺一不算完成：

1. **AC-190 判据回到 exit 0，且不是靠放宽判据换来的**：默认运行 `violating=[]`、
   `--inject-unbacked-fixture` 仍非零；`gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak`
   真的有 top-level `goal_ac` 且有理由。
2. **规则在违反发生的那一刻起作用**：存在一条**可运行**的写入面判定，对「staged 新增 +
   `delivery-critical` + 无 `goal_ac`」真的拒写，且正 / 反 / 对照三类断言都实测过
   （⛔ 不是只加了一段散文，也不是只加了一条事后检测器）。

⛔ 只补那一条任务的 `goal_ac` 而不接写入面 ⇒ 下一次任何作者漏写就第三次复发（本 AC 已复发一次，
上一次修法落地 4 天内就被真实立案路径违反），不算完成。
⛔ 只加写入面判定而真仓库仍红，同理不算完成。
⛔ 把判定塞回 `ready-pool-check.ts` 的准入合取（`eligible`）⇒ 违反人 2026-09-11 裁定，
`eligible-no-goal-source-check.ts` 会红；这不算完成，是实现者选错了落点。

## Touches

- plugin/scripts/precommit-guard.ts
- plugin/test/precommit-guard.test.mjs
- plugin/scripts/long-term-guarantee-goal-backed-check.ts
- plugin/test/long-term-guarantee-goal-backed-check.test.mjs
- tasks/gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak.md
- tasks/gap-ac190-goal-ac-rule-not-enforced-at-filing.md

## Evidence（2026-09-13 worker 实测；两个交付面各自的读数）

### 交付面 1：AC-190 判据回到 exit 0（且不是靠放宽判据换来的）

| 读数 | 命令 | 结果 |
|---|---|---|
| 默认运行 | `node --no-warnings --experimental-strip-types plugin/scripts/long-term-guarantee-goal-backed-check.ts --json` | exit 0，`{"total":156,"violating":[],"compliant":36,"grandfathered":120,"ok":true}` |
| 负控制（未削弱） | 同脚本 `--inject-unbacked-fixture` | exit 1，`FAIL: 生效线之后新立案的 delivery-critical 任务未声明 goal_ac（fail-closed）: gap-injected-unbacked-fixture` |
| 反例被真实背书 | `tasks/gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak.md` | top-level `goal_ac: AC-232`（本轮补，写入经 Core `task edit --goal-ac … --append-notes` → `taskWrite`，**未手改 frontmatter**），任务体内有「为什么是这条 AC」的完整理由 |
| 准入面守卫未破 | `node … eligible-no-goal-source-check.ts` | exit 0，`PASS: 11 promotion membership expression(s) scanned — no goal-layer source in membership` |

**⚠️ 诚实记号（AC1 的绿不全是本任务挣来的）**：立案时那条反例（`gap-quay-init-…` 带
`delivery-critical` 且无 `goal_ac`）在 **2026-09-13T08:34Z** 已被另一个写者**去掉了标签**
（`3cb49af1b`，动机记在该任务体的「标签裁定记录」里）⇒ 本任务开工时检测器**已经是绿的**
（compliant 36 / violating 0）。本任务因此**没有**拿「清掉反例」换 AC1；真正被本任务清掉的是
**规则只有事后检测这一半**（交付面 2）。AC1 的两条读数（默认绿 + 注入红）在本任务改动前后逐字相同，
**判据一行未改**。
⛔ 同时：该任务的 `delivery-critical` 标签**未恢复**（标签取舍是 coordinator 的裁定，见其任务体），
本任务只补 `goal_ac` 背书。⇒「去掉标签就能绕开」这条路**仍然存在**，而它正是交付面 2 要堵的洞：
下次任何人漏写 `goal_ac`，写入那一刻就被拒，而不是等事后判据报红。

### 交付面 2：规则在违反发生的那一刻起作用（可运行的写入面判定）

`plugin/scripts/precommit-guard.ts` 新增 ③（提交那一刻）：staged `tasks/*.md` 中「带 `delivery-critical`
∧ 生效线（`2026-09-09T00:00:00Z`）之后立案 ∧ `goal_ac` 空」⇒ **拒提交**（exit 1，
reason=`delivery-critical-without-goal-ac`，输出含文件路径 = 补救位置）。判定函数**单源复用**检测器
导出的 `isDeliveryCritical` / `hasGoalAc` / `filedAfterCutoff` / `activationLineMs`——AC6 的证据是那条
`import` 行本身（断言落在检测器自己的测试文件里，并禁止第二份 `.includes("delivery-critical")`）。

**正 / 反 / 对照三类断言**（`plugin/test/precommit-guard.test.mjs`；单跑 25/25 绿，scoped 门 36/36 绿）：

| 用例 | 输入 | 期望 | 结果 |
|---|---|---|---|
| 负控制 | staged 新增 + `delivery-critical` + 无 `goal_ac` | 拒（exit 1 + reason + 输出含路径） | ✅ |
| 反向对照 | 同一条补上顶层 `goal_ac` | 放行（exit 0） | ✅ |
| 反向对照 2 | `goal_ac` 嵌在 `extra` 下 | 拒（该字段是顶层设计，嵌套不算声明） | ✅ |
| 存量不误伤 | 生效线**之前**立案的 `delivery-critical` 无 `goal_ac`（backdated commit 后改并暂存） | 放行；且**同一测试内**再放一条同形状的新文件 ⇒ 必须拒（否则那次放行可能来自一个死判定） | ✅ |
| 不触发 | 无标签 / 非 `tasks/` 路径 / 无 frontmatter / 删除 | 放行 | ✅ |
| e2e | 真 `git commit` 经安装的 pre-commit 钩子 | 拒；补 `goal_ac` 的对照提交成功 | ✅ |

**为什么不把 scope 收成 `--diff-filter=A`（与 Plan 措辞有偏离，理由在此）**：`--diff-filter=A` 会把
生效线之前的存量**排除在判定之外**，grandfather 分支在写入面**结构上不可达** ⇒ 那不是「不误伤」，
那是一个永不被执行的判定（硬规则 4b：一个永不被执行的判定不是测量）。现实现 = scope 取全部 staged
`tasks/*.md`，每条按 `git log --diff-filter=A` 的 committer date 定「立案时刻」，判定照跑、结果
grandfathered 而放行；无 add commit 的新文件按「本提交正在新增它」判、下限取生效线（宿主时钟落后于
生效线也不得静默 grandfather）。

**⛔ 没有塞回准入合取**：本判定落在**写入面**（提交那一刻），`ready-pool-check.ts` 的 `eligible` 合取
逐字未动——AC7 的 exit 0 即证据（准入可把集合减到空 = 僵尸；写入面拒的是「这一条写得不对」，
人 2026-09-11 裁定的分界未越）。

**产物面也验过**：`packages/quay/scripts/build-plugin-dist.mjs` 全量跑通（82 entries，exit 0）——
`precommit-guard.ts` 是 bundle 入口，新 import 的传递闭包（检测器 + `task-schema.ts` 系）被内联，
`findEntryGuardHijacks` / `findUnnamedEntryGuards` 两条 fail-closed 闸均放行；bundle 内含 ③ 的
reason 串，且 `--help` 打的仍是 guard 自己的用法（未被内联模块的 main 劫持）。

### 顺带（同一条纪律的第二个实例，不是主动扩范围）

`precommit-guard.test.mjs` 里**两个** e2e 原本用 `node <REPO_ROOT>/plugin/scripts/precommit-guard.ts
--install-hook` 装钩子 ⇒ 钩子 shim 经 `mainCheckoutRoot`（worktree → 主检出的重定向，AC139-4）
**指向主检出的那份 guard**，于是那两个 e2e 测的是**主检出的代码、不是被测代码**（硬规则 4b：拿一个
不可判的量当证据）。改为从 scratch 副本安装（`installHookFromScratch`）后，两个 e2e 真的跑被测文件。
红控制：③ 摘掉后 AC4 e2e 实测红（commit 未被拒，status 0）——即那条断言取得到假。

### 未勾的两条及其理由（硬规则 3b：读不懂 / 未评估不得与合格同形）

- **AC8（`scripts/test.sh` 全量绿）**：worker 不跑全量套件（全套件的执行面是 worker-driver 的 fan-in：
  merge → delta → typecheck → scoped 门 → **suite** → ff），故本条在 worker 侧不可自证 ⇒ 保持未勾 +
  `（待外部）`。⚠️ 这不是豁免：**套件红则 ff 不发生、本任务落不了地** ⇒ 该条的兑现是本任务落地的
  前置，由生产线机械保证。worker 侧能提供的最近证据：scoped 门 `--for-task … --allow-thin` exit 0、
  36/36 测试通过（含 AC4/AC5 的全部正 / 反 / 对照断言）；新增断言落在 `plugin/test/`（套件 glob 覆盖）。
- **AC9（`task check` 的 `missing` 为 `[]`）**：**该命令的输出里没有 `missing` 字段**——实测
  `node … packages/quay/bin/quay.ts task check gap-ac190-… --json` 与 MCP `task_check` 的字段集都是
  `{id, gate, ok, acTotal, acChecked, dodTotal, dodChecked, reason}`。可读的等价量是
  `ok:true` ⇔ `acChecked == acTotal`；而 execute->done 闸要求**全部 AC 勾上**
  （`packages/quay-native/src/store.ts` 的 `acOk = acChecked.length === acCheckboxes.length`）
  ⇒ AC8 未勾时 `ok` 恒 false。⇒ 本条与 AC8 同链，**只能由外部的全量套件轮兑现** ⇒ 保持未勾 + `（待外部）`。
  ⛔ 不把「`missing` 不存在」含糊过去；⛔ 也不为了让 `ok:true` 出现而勾掉 AC8（那是拿一个没跑的全量套件
  当已跑）。两条腿的任一条都会把「未评估」伪装成「合格」。
