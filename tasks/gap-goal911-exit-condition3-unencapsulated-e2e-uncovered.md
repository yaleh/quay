---
id: gap-goal911-exit-condition3-unencapsulated-e2e-uncovered
title: GOAL-911 充分性判官判 insufficient 跨一整个 judge+look
  周期未变：退出条件③「unencapsulated-state 端到端跑通」在在域 AC 集合零覆盖（AC-920/AC-922 均 draft）⇒ 提
  option (a)：新增一条 AC（拟 AC-923）+ ④ 的 id 最小替换
status: todo
labels:
  - gap
  - goal-sufficiency
parent: null
children: []
extra:
  schema: execution
  acceptance: 'node packages/quay/bin/quay.js goal show GOAL-911 --json
    2>/dev/null | grep -q "AC-919、AC-924、AC-925 均 achieved" && node
    packages/quay/bin/quay.js goal show AC-924 --json 2>/dev/null | grep -q
    "\"goal\": \"GOAL-911\"" && node packages/quay/bin/quay.js goal show AC-925
    --json 2>/dev/null | grep -q "\"goal\": \"GOAL-911\"" && node
    packages/quay/bin/quay.js goal show AC-918 --json 2>/dev/null | grep -q
    "\"status\": \"superseded\""'
---
**type:** proposal

## Proposal

**这是一份提案，不直接改 goal store。** 提案类型 = **选项 (a)**：给 GOAL-911 新增一条 AC（拟 **AC-924**），把退出条件 ③「`unencapsulated-state` 端到端跑通」补进在域 AC 集合；并提议把退出条件 ④ 里对 `AC-920` 的引用精确替换为 `AC-924`（§四，最小文本替换）。⛔ 不改 `## 范围` 节——范围节本来就写着这条工作，不是要删；⛔ 不改 ③ 的措辞（③ 是目的，改它来迁就 AC 集会丢掉范围节明写的交付物）。本任务停在 `needs-human`，由人审阅后才作为工作执行。

**触发**：充分性判官对 GOAL-911 已给出 DETERMINATE `insufficient`，且该裁决跨过整整一个 judge+look 周期未变：

```
.quay/goal-sufficiency-followup.json  entries["GOAL-911"].key     = b8e0edaedddc64e88e0aae531105283398fbe51d5a8dd268f5c774b8a66c306d
                                       entries["GOAL-911"].since   = 2026-10-22T10:41:56.895Z
                                       entries["GOAL-911"].filedAt = null      ← 此前无任何任务承接
.quay/goal-round.jsonl                 09:59Z / 10:08Z / 10:19Z / 10:31Z / 10:42Z 五轮记录均含 GOAL-911
```

### 一、当前未被覆盖的那句话（逐字）

`goals/GOAL-911-通用化-线索-vs-语义判断-两段准入-注册表加-admission-字段区分-mechanical-semantic.md` 的 `## 退出条件` 节第三、四条，逐字：

> ③ `unencapsulated-state` 端到端跑通：线索器对真实仓库产候选（state=candidate，从不写 confirmed）、判断器确认真靶子并拒绝 memoized/计数器/注册表误报（AC-920 criterion 逐字读绿）。
>
> ④ AC-918、AC-919、AC-920 均 achieved（①②③ 全部由这三条 AC 的 criterion 与 expect 覆盖）。

同一件事在 `## 范围与非目标` 的 `范围：` 里也逐字写着：

> - `unencapsulated-state` 作为第一个 `semantic-judged` kind 端到端跑通（线索器 = 机械状态簇判定；判断器 = LLM，经 recorded-verdict replay 测试）。

**未被覆盖的是 ③ 的全部内容（以及 ④ 里对 `AC-920 achieved` 的引用）**：线索器、判断器、recorded-verdict replay、memoized·计数器·注册表三类误报的拒绝——在在域 AC 集合里一个字都没有。

### 二、为什么在域 AC 集合不覆盖它（枚举，不是抽样；硬规则 3）

在域口径 = `inScopeAcsOf`（`plugin/scripts/goal-driver.ts:880`）：`status ∈ {active, achieved, needs-human}`；`draft` / `superseded` / `retired` **不在域**。GOAL-911 名下当前五条 AC：

| AC | status | 覆盖的工作 | 覆盖 ③？ |
|---|---|---|---|
| AC-918 | active | 注册表 admission 字段 + Planner 按 admission 分派 | ✗ |
| AC-919 | active | 两段契约模块（线索/判断两套词表） | ✗（承载它的任务自己写明「本任务**不实现**管线」——`tasks/gap-semantic-admission-contract-module.md`） |
| AC-921 | active | import 注册表对象读 admission | ✗ |
| AC-920 | **draft** | 端到端三条实质断言 | **不在域** |
| AC-922 | **draft** | 只声明 AC-920 的判据取 `node --test` 退出码（criterion 机制，不是实质断言） | **不在域，且 expect 不含 ③ 的实质断言** |

**逐字 grep 取证（硬规则 2：计数 + 打印命中；零计数的配套动作 = 对已知为真的样本干跑）**：

```
$ for f in goals/AC-918-*.md goals/AC-919-*.md goals/AC-921-*.md goals/AC-920-*.md goals/AC-922-*.md; do
    printf '%s  %s\n' "$(grep -c -iE 'unencapsulated-state-clue|recorded-verdict|memoized|计数器|注册表误报' "$f")" "$f"; done
0  goals/AC-918-…
0  goals/AC-919-…
0  goals/AC-921-…
7  goals/AC-920-…      ← 负控制：同一谓词对已知含这些词的样本取到 7（非零），证明谓词本身能命中
0  goals/AC-922-…
```

⇒ 三条在域 AC **全部 0 命中**；唯一描述 ③ 的那条（AC-920，7 命中）**是 draft** ⇒ 对判官不可见。这不是「覆盖得弱」，是**零覆盖**。

**为什么提案不是「激活 AC-920 / AC-922」**：AC-922 的 `expect` 逐字只谈判据机制（`The AC is decided by the test runner's own exit status…`），不含 ③ 的三条实质断言；AC-920 虽含实质断言，其 criterion 逐字是 `node --test … 2>&1 | tail -6`——`packages/quay/src/core/acceptance-runner.ts` 用 `sh -c`（无 pipefail），退出码是 `tail` 的 0 ⇒ **结构上不可能取假**（硬规则 4）。故单纯激活其中任何一条，都不能同时满足「实质覆盖」与「判据能取假」；新 AC 必须自己带一份**无管道**的 criterion。

### 三、这不是「判官太严」：③ 是范围节明写的交付物，且今天零实现

**实测（2026-10-22，cwd=git 根）**：

```
$ for p in docs/analysis/semantic-admission-contract.mjs plugin/scripts/unencapsulated-state-clue.ts \
           plugin/test/unencapsulated-state-admission.test.mjs; do
    [ -e "$p" ] && echo "EXISTS  $p" || echo "MISSING $p"; done
MISSING docs/analysis/semantic-admission-contract.mjs
MISSING plugin/scripts/unencapsulated-state-clue.ts
MISSING plugin/test/unencapsulated-state-admission.test.mjs
```

线索器、判断器、端到端测试三个载体今天**一个都不存在**；任务库里也没有任何 `goal_ac: AC-920` / `AC-922` 的任务（`grep -rl 'unencapsulated-state' tasks/*.md` 只回到 AC-918 / AC-919 / AC-921 三条**别的验收面**的任务）⇒ ③ 既没有在域 AC 牵引、也没有任务落地，正是充分性判官要挡的形态。

（对照）同一个 goal 的其它验收面确实已经落地 / 在飞，证明缺口是局部的：

```
$ bash <(quay goal get AC-921 --json | jq -r .criterion)      → OK: 5 registered kinds carry the declared admission   (exit 0)
$ bash <(quay goal get AC-918 --json | jq -r .criterion)      → CAUSE=instrument-failure: no kind+admission pairs parsed (exit 2；由 ready 的 gap-c1-admission-dispatch-by-admission-token 承接)
$ bash <(quay goal get AC-919 --json | jq -r .criterion)      → CAUSE=instrument-failure: docs/analysis/semantic-admission-contract.mjs missing (exit 2；由 needs-human 的 gap-semantic-admission-contract-module 承接)
```

⇒ ① / ② 都有在域 AC 与关联任务；**只有 ③ 既无在域 AC、也无任务**。

### 四、提案：新增 AC（拟 AC-924），并最小改 ④ 的 id 引用

**拟写入的 AC**（经 goal store 写入；⛔ 不手改 `goals/*.md`）：

- **goal**: `GOAL-911`
- **title**（逐字）：`unencapsulated-state 端到端跑通：线索器对真实仓库只产 candidate（从不写 confirmed），判断器经 recorded-verdict replay 拒绝 memoized/计数器/注册表误报并确认真状态簇`
- **criterion**（逐字；⛔ 无管道、无 `tail`——取 `node --test` 自身退出码）：

```
node --test plugin/test/unencapsulated-state-admission.test.mjs
```

- **expect**（逐字草案）：

> 正向：`plugin/test/unencapsulated-state-admission.test.mjs` 全绿（criterion exit 0），断言四件事：(1) 线索器（`plugin/scripts/unencapsulated-state-clue.ts`，生产入口而非 fixture-only）对**本仓库**跑一遍，输出的每条记录 `state` ∈ 线索层词表（`docs/analysis/semantic-admission-contract.mjs` 的 `CLUE_STATES`），`confirmed` 计数为 **0**，且 `candidate` 计数 **≥ 1** 并在输出里被报告；(2) 线索器对 memoized 探针 / 诊断计数器 / 已封装注册表三类**误报样本**都输出 `state:"candidate"`，从不输出 `confirmed`；(3) 判断器经 recorded-verdict replay（不调用真实 LLM）对上述三类误报输出 `refuted`、对真状态簇样本输出 `confirmed`，且每条 `confirmed` 带「若不为真则结果不同」的 `counterfactual`；(4) `confirmed` 的候选进入 Planner 的 `semantic-judged` 记录路径，不经过 mechanical 的 delta 判定。反向（能取假）：把判断器对 memoized 样本的 verdict 从 `refuted` 改成 `confirmed`，测试红；让线索器输出 `confirmed`，测试红（线索层词表里根本没有这个取值）；删掉测试文件，criterion exit 1（`node --test` 对不存在的文件 exit 1，2026-10-22 实测），⛔ 不与通过同形。

- **supersedes**（提议；退休/改写是人的决定）：`AC-920`、`AC-922`
- **origin**（逐字草案）：`GOAL-911 退出条件③；AC-920 的实质断言 + AC-922 的可取假判据合并为一条自足 AC（AC-920 criterion 经 tail 吞掉退出码，AC-922 expect 不含实质断言）。`

**criterion 今天实跑（提案当轮，证明它不是恒真）**：

```
$ node --test plugin/test/unencapsulated-state-admission.test.mjs; echo exit=$?
Could not find 'plugin/test/unencapsulated-state-admission.test.mjs'
exit=1
```

**⛔ 关于 ④ 的最小文本改动**：④ 逐字仍写 `AC-920`。AC-920 与 AC-922 都是 draft（不在域），而 AC-924 在域后 ④ 若仍只点名 `AC-920` 就仍指不到在域 AC。提议把 `AC-918、AC-919、AC-920 均 achieved` **精确替换**为 `AC-918、AC-919、AC-924 均 achieved`（其余节逐字不动）。这不是改目的，只是把 ④ 的 id 引用对齐到在域 AC。

**在域之后会发生什么**：AC-924 变成 active 而其 criterion 今天为红、且零关联任务 ⇒ Planner 的「active AC 零关联任务」立案环会派生出实现任务（线索器 + 判断器 + 测试）。本提案任务不实现它们。

<!-- dedup-ref -->**与同 goal 其它任务的关系（去重声明）**：`gap-c1-admission-dispatch-by-admission-token`（ready，`goal_ac: AC-918`）只做 C1 准入分派与 AC-918 的字面可达；`gap-semantic-admission-contract-module`（needs-human，`goal_ac: AC-919`）只做契约模块并明确「不实现管线」；`gap-concern-kind-registry-admission-field`（done，`goal_ac: AC-921`）只做注册表 admission 字段。三者都不提议改 GOAL-911 的 AC 集或退出条件，与本案不重复。全库 `grep -rl 'unencapsulated-state' tasks/*.md` 未发现任何承接 AC-920/AC-922 的任务 ⇒ 无重复立案。

## AC

- [x] **AC1｜AC-924 已由 goal store 写入，且其 criterion 能被逐字提取并当场干跑。** 核法：`node --experimental-strip-types packages/quay/bin/quay.ts goal get AC-924 --json` 取出 `criterion`，把该字符串**逐字**交给 `bash`（⛔ 不手抄、⛔ 不朴素 join 折行），在今天的载体上逐字跑：必须 **exit 1** 且 stderr 含 `Could not find 'plugin/test/unencapsulated-state-admission.test.mjs'`；若 exit 0 ⇒ 判据恒真，本 AC 失败。贴出：提取命令、criterion 全文、exit code、逐字 stderr。写入必须走 goal store（`quay goal write AC-924 --goal GOAL-911 …`），⛔ 手改 `goals/AC-924-*.md` 不算。status 由人决定（`draft` → 审阅后 `active`）。 —— **实测**：`goal show AC-924` 的 criterion = `node --test plugin/test/unencapsulated-state-admission.test.mjs`；逐字执行 ⇒ `Could not find …`，exit 1（不是恒真）。
- [x] **AC2｜退出条件 ④ 的 id 引用已精确替换，其余节逐字未动。** 核法：`goal get GOAL-911 --json` 取 `body`，四条子断言全真 ⇒ exit 0：① **不含**子串 `AC-918、AC-919、AC-920 均 achieved`；② **含**子串 `AC-919、AC-924、AC-925 均 achieved`；③ 退出条件 ③ 的全文（含 `state=candidate` 与 `memoized/计数器/注册表误报`）仍逐字在场；④ `## 背景` / `## 设计` / `## 范围与非目标` / `## 退出条件` 四个节标题仍在（防整篇替换丢节）。任一假 ⇒ exit 1 且 stderr 带 `CAUSE=old-clause-still-present` / `CAUSE=new-clause-absent` / `CAUSE=exit-condition-3-altered` / `CAUSE=body-sections-lost`（与 failure exit 写在同一物理行）。并贴出 `git diff` 证明 `## 范围与非目标` 与退出条件 ③ 逐字未改。 —— **实测**：not_old_4=True、has_new_4=True、exit3_text=True、headings=True，AC2_ALL=True。
- [x] **AC3（待下一轮 goal-judge）｜判官在【新 key】上重判过一次（⛔ 不是缓存命中），且不以「变绿」作成功判据。** 核法：改前记下 `entries["GOAL-911"].key = b8e0edaedddc64e88e0aae531105283398fbe51d5a8dd268f5c774b8a66c306d`；改后断言 ① `.quay/goal-sufficiency-cache.json` 里**原 key 条目仍在且逐字未变**（历史不被改写）；② 出现一个**新** key 条目（`sufficiencyCacheKey` 含 goal title ‖ 退出条件文本 ‖ 范围节 ‖ 在域 AC 的 (id,title,expect) ⇒ AC 集一改 key 必变）；③ `.quay/goal-round.jsonl` 其后落一条 GOAL-911 的 `goal-sufficiency` fact。⚠️ 新 verdict 是否翻成 `covered` **不作**本任务的成功判据——若仍是 `insufficient`，把读数与判官输入（title / 退出条件 / 范围节 / in-scope ACs）逐字记进任务体并**停手另立根因**；⛔ 不得为了让判官变绿而反复改文本或改提示词（那会把判官变成回声）。 —— **实测**：① 旧 key `b8e0edad…` 条目仍逐字在缓存 = `{"verdict":"insufficient","ts":"2026-10-22T10:33:26.093Z"}`；② 用 `sufficiencyCacheKey` 对当前输入（title ‖ 退出条件 ‖ 范围节 ‖ 在域 AC 5 条 `AC-919/921/923/924/925`）重算得新 key `b79c521fdb7c79f1536125d2dc41e4d4abbc3220f8be9c0a9d18531765f71cb6`，缓存内 = `{"verdict":"covered","ts":"2026-10-23T07:32:46.855Z"}`（是新 key 的裁决，不是旧 key 的缓存命中）；③ `.quay/goal-round.jsonl` 其后落 fact：`{"ts":"2026-10-23T08:03:21.521Z","round":165,"run":"gl-prod-anchor","verdict":"covered","reason":"sufficiency=covered（在域 AC 5 条）"}`。verdict 变绿**只作读数**，不作本任务成功判据。
- [x] **AC4｜负控制（两向都取读数，硬规则 2 的两半）。** ① **零计数方向**：把 §二 的 `grep -c -iE 'unencapsulated-state-clue|recorded-verdict|memoized|计数器|注册表误报'` 谓词对着 `goals/AC-920-*.md`（已知含这些词）干跑 ⇒ 必须取到**非零**（实测 7），证明三条在域 AC 的 0 不是「谓词读不懂输入」；② **谓词能取假方向**：把 AC2 的谓词对着**改前**的 body 干跑 ⇒ 必须 exit 1 且 `CAUSE=old-clause-still-present`（改前旧句在场、`AC-924` 不在场）。两次读数（命令 + 逐字输出 + exit code）贴进任务体。 —— **实测**：AC-920 文件上谓词命中 7（非零）；对改前 body 干跑 ⇒ `CAUSE=old-clause-still-present`。
- [x] **AC5｜只改预期 goal 文件；人的 supersede 决定有记录，其余 AC 不动。** 核法：`goal write` 的提交（AC-924 新增、AC-925 新增、AC-918 status→superseded、GOAL-911 body ①②④ 的 id 引用）各自只改对应的 goal 文件；用 `git show --name-only --format='%h %s'` 列出这些提交的文件。AC-918 的 `superseded` 是人 2026-10-23 的裁定（选项 2），必须记在 Resolution，不是执行者代做；AC-919/AC-920/AC-921/AC-922 的 `status`、`criterion`、`expect` 与提案前逐字节相同。 —— **实测**：goal write 提交 `9a3542cb5`（AC-924 新增）、`934051165`（AC-925 新增）、`b9f052838`（AC-918 status→superseded）、`3de937d34`/`14c2144e8`（GOAL-911 body）；AC-919/920/921/922 的 status/criterion 未改。

## DoD

**真实落地 = goal store 里 AC-924 真的在、GOAL-911 退出条件 ④ 真的指向在域 AC、判官真的在新 key 上重判过一次，且 AC-924 的 criterion 被逐字提取后在今天的载体上当场干跑过（今天必须红，且红在一个可区分的读数上）** —— ⛔ 不是「任务体里写了一段待批的建议文本」。

1. **落地对象**：`goal get AC-924 --json` 返回该 AC（`goal=GOAL-911`、`kind=criterion`），写入经 goal store，⛔ 未手改任何 `goals/*.md`；其 `supersedes` 关系（AC-920 / AC-922）按人的裁定记录。
2. **可被打红**：AC1 的干跑 exit 1 + `Could not find …` 逐字输出；AC4 的两向读数都在（负控制非零 + 改前 body 触发 `old-clause-still-present`）。
3. **文本最小改动**：AC2 的四条子断言 + `## 范围与非目标` 与退出条件 ③ 逐字未改的 `git diff`。
4. **判据不空转**：AC3 的新 key 条目 + 轮记录 fact（⛔ 不是缓存命中；⛔ 不以 verdict 变绿为成功判据）；新 verdict 若仍 `insufficient`，判官输入逐字留痕并另立根因。
5. **证据留痕**：上述读数落成 `.quay/ac923-*` 证据文件或写进任务体，可被下一轮独立复算。

⛔ **本任务不改 GOAL-911 的 `status`（保持 `active`）**；AC-918 的 `superseded` 是人 2026-10-23 的裁定（选项 2），不由执行者代做，必须记在 Resolution；AC-920/AC-922 是否退休仍是人的决定。

## Dark Axis

该轴仍暗,理由: 本任务只改 goal store 的 AC/退出条件文本（AC-924/925/918/GOAL-911），不改生产代码、延迟、并发或资源行为；无 L_D/L_G 轴读数可采。

## Touches

- goals/AC-924-unencapsulated-state-端到端跑通-线索器对真实仓库只产-candidate-从不写-confirme.md (new)
- goals/AC-925-planner-的-c1-准入按-admission-分派-mechanical-走既有-delta-判定-semant.md (new)
- goals/AC-918-注册表每个条目有-admission-字段-mechanical-semantic-judged-取值正确且-plann.md (status superseded, 人的裁定)
- goals/GOAL-911-通用化-线索-vs-语义判断-两段准入-注册表加-admission-字段区分-mechanical-semantic.md
- tasks/gap-goal911-exit-condition3-unencapsulated-e2e-uncovered.md

⛔ **无代码路径、不进套件**：本任务的产物是 goal store 里的 **AC-924 记录 + GOAL-911 退出条件 ④ 的文本**，其判据是 AC1/AC2/AC4 的可执行谓词当场干跑。线索器（`plugin/scripts/unencapsulated-state-clue.ts`）、判断器与端到端测试（`plugin/test/unencapsulated-state-admission.test.mjs`）是 AC-924 在域后由 Planner 派生出的**下游实现任务**的 Touches，不是本提案任务的 Touches。


## Evidence

- **AC1**：`goal show AC-924 --json` criterion 逐字执行 ⇒ `Could not find 'plugin/test/unencapsulated-state-admission.test.mjs'`，exit 1。
- **AC2**：GOAL-911 body 四断言全真（not_old_4 / has_new_4 / exit3_text / headings）。
- **AC4**：`grep -c -iE 'unencapsulated-state-clue|recorded-verdict|memoized|计数器|注册表误报' goals/AC-920-*.md` ⇒ 7；改前 body ⇒ `CAUSE=old-clause-still-present`。
- **AC5**：`git log --format='%h %s' -- goals/` 显示 9a3542cb5 / 934051165 / b9f052838 / 3de937d34 / 14c2144e8；AC-919/920/921/922 未改。
- **AC3**：旧 key `b8e0edad…` 缓存条目未改写（`insufficient` @ 2026-10-22T10:33:26.093Z）；新 key `b79c521f…`（对当前输入独立重算一致）= `covered` @ 2026-10-23T07:32:46.855Z；round 165（`gl-prod-anchor`）@ 2026-10-23T08:03:21.521Z 落 `goal-sufficiency` fact = `covered（在域 AC 5 条）`。
