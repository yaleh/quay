---
id: gap-goal020-exit-conditions-stale-after-sea-channel-retired
title: GOAL-020 退出条件②与范围节已被 SEA 渠道退役甩下：在域 7 条 AC 零条提到
  SEA/serve/plugin-root，而退出条件仍逐字要求「SEA 产物不再因 plugin-root.ts 的顶层求值而在 serve 上崩」⇒
  修文本（option b），不是加判据
status: done
labels:
  - gap
  - defect
  - goal-sufficiency
parent: null
children: []
extra:
  schema: execution
---
**type:** proposal

## Proposal

**结论｜本任务提的是 option (b)：改 GOAL-020 自己的【文本】（退出条件② + 范围节）。⛔ 不是再加一条判据。**

**触发**：充分性判官对 GOAL-020 已给出 DETERMINATE `insufficient`，且该裁决跨过一整个
judge+look 周期未变（`.quay/goal-sufficiency-followup.json` 的 `entries["GOAL-020"]`
`since=2026-09-16T10:13:10.767Z`，`filedAt=null` ⇒ 此前无任何任务承接）。每轮
`.quay/goal-round.jsonl` 的 `goal-sufficiency` fact 都在重复它，而没有任何机制消费它。

### 一、当前未被覆盖的那句话（逐字）

`goals/GOAL-020-ci-与-release-渠道成为可信守门员-develop-首绿-release-能发出三平台可用产物.md`
的 `## 退出条件` 第 ② 条：

> ② **release 渠道能发出一个 `quay serve` 真能起来的产物**——release run 成功，
>    且 SEA 产物不再因 `plugin-root.ts` 的顶层求值而在 `serve` 上崩。

**未被覆盖的是破折号后半句，逐字**：`且 SEA 产物不再因 plugin-root.ts 的顶层求值而在 serve 上崩`。

### 二、为什么在域 AC 集合不覆盖它（两条独立读数，都是直接量）

**读数 1｜在域 AC 里 0 条提到 SEA / serve / plugin-root。**
在域（非 superseded）AC 集合 = `{AC-265, AC-269, AC-270, AC-271, AC-272, AC-273, AC-274}`，
共 7 条（逐条取自 `goals/AC-*.md` 的 `goal: GOAL-020` 且 `status != superseded`，与判官输入的
7 条逐字一致）。对这 7 个文件逐条 `grep -c -i -E 'sea|serve|plugin-root'` ⇒ **7 个 0 命中**：

```
0  goals/AC-265-goal.md
0  goals/AC-269-goal.md
0  goals/AC-270-master-的值域不变式-要么停在首次-ff-前的化石值-要么等于一个-release-run-全绿的-tag-没有第.md
0  goals/AC-271-release-分支合回后即删除-或其-tip-逐字停在同名-tag-上-不得在-tag-之后继续生长.md
0  goals/AC-272-滚动渠道-marketplace-dist-plugin-自证版本-要么带-dev-后缀自证非发布版-要么确实等于同名.md
0  goals/AC-273-默认分支落在主干-origin-head-指向-origin-develop-新-clone-与-harness-wor.md
0  goals/AC-274-首次真实全绿发布-且-master-已-ff-到它-时间窗限定在本条立案之后-不得被历史绿run满足.md
```

（按硬规则 2 的动作：这 7 个计数是 `grep -c`，前 3 条命中内容为空即「0」本身——不存在可打印的命中行；
配套动作由 AC4 的**负控制**承担：把同一谓词对着一个**已知为真**的样本干跑，证明它取得到非零。）

**曾覆盖它的那条 AC 已退役**：`AC-267`（「SEA 产物的 `quay serve` 可用：`plugin-root.ts` 模块顶层
求值…」）status = `superseded`，其 statusLog 末条 reason 逐字：

> 人 2026-09-16 裁定取消 SEA/npm 产物发布渠道（release.yml 的 release/sea-release/sea-verify-node-free(-cross-platform) 等 job），改为让 advance-master 消费 Claude Code plugin 渠道自己的发布+安装验证——判据主体所依赖的产物线本身被取消，非缺陷已修。见 `orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §11。

`AC-266` / `AC-268` 同因同轮 superseded。⇒ **三条老判据被一起退役，而 GOAL-020 自己的退出条件②
文本没跟着改**——这正是硬规则 5b「在某处修好 X ≠ X 只在那一处」：修的人只盯着被报出来的那三条 AC。

**读数 2｜范围节仍在描述一个已经不存在的范围。**
body 的 `## 范围（AC-265..AC-269）` 列的是 `AC-265 / AC-266 / AC-267 / AC-268 / AC-269` 五条：
其中 **3 条（266/267/268）已 superseded**，而在域的 **AC-270/271/272/273/274 五条一条都没列**。
判官被明确要求「judge the AC set against it, not against the exit conditions alone」
（`plugin/scripts/goal-driver.ts:938-939`，`buildSufficiencyPrompt`）⇒ 这条陈旧的范围节
**自己就在告诉判官：声明的分解与在域集合对不上**。

⇒ 两条读数指向同一结论：**这是【文本过期】，不是【判据缺位】。**

### 三、为什么不能靠【加一条新 AC】收口（这是我选 (b) 的理由）

若为②的后半句新增一条 AC，它判的对象是 SEA 产物线——**那条线已经不存在了**。
SPEC §11.4 逐字要求「⛔ 不是让它们继续挂着变成永久无法达成的红」。加一条判 SEA 的 AC，
等于把刚退役的 AC-267 换个编号复活；而**退出条件②的文本仍然要求它** ⇒ 判官下一轮仍判
`insufficient`，新增的那条则永远是红。**在这个方向上，加判据只会让目标更远。**

### 四、提案：改这两处文本（人已批准，具体字样以下方为准）

**(1) 退出条件② → 去掉已退役的 SEA 半句，把「产物真能起来」保留在「全绿」这个读数上：**

> ② **release 渠道能发出一个真能起来的产物**——`.quay/ci-runs.jsonl` 里存在一次
>    `workflow=Release` 且 `conclusion=success` 的 run，且 master 已 ff 到它的 tag；
>    「发出去的产物真能起来」由该 run 的**全绿**承载：`advance-master.needs` 必须覆盖
>    `.github/workflows/release.yml` 内其余每一个 job（`release-master-advance-needs-check.ts`，
>    每轮跑，见 `plugin/scripts/runner-static-gate.ts:958`），而该 gate job 本身就是 plugin 渠道的
>    真实安装验证（marketplace 装得上 → `quay-init` → `quay driver start` / `quay serve` 在隔离环境
>    alive，见 SPEC §11.2）。

⇒ 改完后，② 的判据需求**逐字等于 `AC-274` 的 expect**，覆盖关系是集合相等而非「勉强沾边」。

**(2) 范围节 → 改成在域 7 条，并显式写明三条已退役、不再计入：**

> ## 范围（在域 AC = AC-265、AC-269、AC-270、AC-271、AC-272、AC-273、AC-274，共 7 条）
>
> - **AC-265** develop 首绿，且绿不是靠少跑测试换来的（long-term）
> - **AC-269** CI 红有机械归因：真缺陷 / 基础设施 / 已知 flake（long-term）
> - **AC-270** master 的值域不变式：化石值，或一个 Release 全绿的 tag（long-term）
> - **AC-271** release 分支 tip 逐字停在同名 tag 上（long-term）
> - **AC-272** 滚动渠道自证版本：`-dev` 后缀，或等于同名 tag 的构建（long-term）
> - **AC-273** origin/HEAD 指向 origin/develop（long-term）
> - **AC-274** 首次真实全绿发布 + master 已 ff 到它（一次性，时间窗限定立案之后）
>
> ⛔ 已退役、不再计入范围：**AC-266 / AC-267 / AC-268**——主体（SEA/npm 产物线）经人 2026-09-16
> 裁定取消，已 `superseded`（SPEC §11.4）。

### 五、两条必须先说清楚的前提（⛔ 都可在本检出当场核）

**前提 A｜②的「release run 成功」半句现在已经被 `AC-274` 覆盖。** `AC-274` 的 expect 逐字为：
「`.quay/ci-runs.jsonl` 里存在 workflow=Release ∧ conclusion=success ∧ ts > 2026-09-15T14:00:00Z 的
run，且 master 的提交正是其中某个 tag 的提交」。⇒ ②改写后与之同构。

**前提 B｜「产物真能起来」不会因为去掉 SEA 字样而丢掉——这条今天就已经成立，不是等 §11 落地才有。**
载体 `.quay/ci-runs.jsonl` 里 `v0.6.3` 那次 Release run（`runId=34845477762`）的 job 清单含
`sea-verify-node-free` 的步骤 **`Run quay serve and curl it (no Node on PATH)`**（`conclusion=failure`，
正是 GOAL-020 立项时那条真实产品 bug）——即「Release run 全绿」本身就意味着**发出去的产物真的起过
`quay serve`**。§11 落地后同一位置换成 `verify-plugin-channel`，还是同一件事。
⇒ ②去掉 SEA 字样后剩下的要求，正是「全绿」这个读数**已经**在承载的东西。

### 六、与在飞任务的关系（⛔ 不是重复立案）

<!-- dedup-ref -->
- `gap-release-yml-drop-sea-npm-gate-on-plugin-channel-instead`（`status: ready`，`goal_ac: AC-274`）——
  它是 SPEC §11 的**实现**（删 5 个 SEA job、加 `verify-plugin-channel`、改 `advance-master.needs`），
  它的 Touches 是 release.yml / delivery-manifest / runner-static-gate / capability-catalog 等，
  **不包含 GOAL-020 的 body，也不包含任何 AC/退出条件的改写**。§11.4 只退役了 AC-266/267/268
  三条**判据**，对退出条件②与范围节**只字未提**。两条任务改的是不同对象，无关。
- `gap-ac259-supersede-frozen-cycle-literal-and-restore-develop-dev`（`status: todo`，`goal_ac: AC-259`）——
  它只是在 AC3 里**引用** GOAL-020 的 AC-270/271/272 作为版本不变式的承接者，不提任何 AC/退出条件改写。
- 本条也**不**依赖上述任何一条先落地：前提 B 显示「全绿 ⇒ 产物起得来」在今天（SEA job 还在）与
  §11 落地后（`verify-plugin-channel`）**两种配置下都成立**，所以文本修订的覆盖论证不需要等实现。

## AC

- [x] **AC1｜退出条件②的旧句已从 store 里消失、新句已在场，且其余节未被误删。** 核法：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts get GOAL-020 --json` 取 `body`，断言 ① 该 body **不含**子串 `SEA 产物不再因`；② **含**子串 `release 渠道能发出一个真能起来的产物`；③ `## 背景` 与 `## 非目标` 两节标题仍在（防 `--body` 整体替换时把其它节丢掉）。三条都真 ⇒ exit 0；任一假 ⇒ exit 1 且 stderr 与 failure exit 写在同一物理行，带 `CAUSE=old-clause-still-present` / `CAUSE=new-clause-absent` / `CAUSE=body-sections-lost`。⛔ 改写必须经 goal store 本身（`goal-store.ts write GOAL-020 --expect-existing --body <全文> --actor <…> --reason <…>`，`--body` 是整篇替换、非节合并），**不得手改 `goals/GOAL-020-*.md`**（同 AC-259 的写入纪律）。
- [x] **AC2｜范围节的清单条目与在域 AC 集合【集合相等】，且三条退役项被显式登记为退役。** 核法：一条 python3 —— (a) 从 store `body` 抽 `## 范围…` 节（标题前缀匹配），在**节体内只取形如 `- **AC-NNN**` 的清单条目行**得集合 S；⛔ **不按整节文本抽所有 `AC-[0-9]+`**——退役说明那行会提到 AC-266/267/268，按全文抽取会把它们算进集合、使判据**恒假**（硬规则 4c：那个量必须穿过中间层还取得到；这里「中间层」就是退役说明行）；(b) 扫 `goals/AC-*.md`，取 `goal: GOAL-020` 且 `status != superseded` 的 id 得集合 L；(c) 断言 `S == L == {AC-265, AC-269, AC-270, AC-271, AC-272, AC-273, AC-274}`，并把抽到的 S 打印出来；(d) 断言节体内存在一行**同时**含 `AC-266`、`AC-267`、`AC-268` 与 `superseded` 字样。任一条假 ⇒ exit 1，stderr 与 failure exit 同一物理行，带 `CAUSE=scope-list-drifted`（a-c 假，并打印两侧差集）或 `CAUSE=retired-acs-unrecorded`（d 假）。
- [x] **AC3｜改完后判官在【新 key】上重判过一次（⛔ 不是缓存命中）。** 核法：改前记下 GOAL-020 的现 key（`.quay/goal-sufficiency-followup.json` 的 `entries["GOAL-020"].key` = `3c73e546246332abc7b6269f34784d20ec61b2550adcdae1f5d032b6be7682e9`）；改后读 `.quay/goal-sufficiency-cache.json`，断言 **原 key 条目仍在**（历史不被改写）**且**出现一个**新** key 条目（`sufficiencyCacheKey` 含退出条件文本与范围节文本 ⇒ body 一改 key 必变）；再断言 `.quay/goal-round.jsonl` 里其后落了一条 `goal-sufficiency` fact。⚠️ **新 verdict 是否翻成 `covered` 不作本任务的成功判据**——若仍是 `insufficient`，把读数与判官理由逐字记进任务体并**停手另立根因**；⛔ 不得为了让判官变绿而反复改文本或改提示词（那会把判官变成回声）。
- [x] **AC4｜负控制：AC1/AC2 的谓词能取假。** 把 AC1 的谓词对着**改前**的 body 干跑一次 ⇒ 必须 exit 1 且 `CAUSE=old-clause-still-present`；把 AC2 的谓词对着**改前**的 body 干跑 ⇒ 必须 exit 1 且 `CAUSE=scope-list-drifted`（改前 S 含 266/267/268 而 L 不含）。两次读数（命令 + 逐字 stderr）贴进任务体。硬规则 3b：**一个恒真的检查是假的保证**；没有这一条，AC1/AC2 与「没查」同形。
- [x] **AC5｜SPEC §11 的裁定链被补完（硬规则 5b 的当场执行）。** 在 `orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §11 追加一小节，逐字说明：§11.4 只退役了 AC-266/267/268 三条**判据**，**未同步 GOAL-020 自己的退出条件②与范围节**（属 5b 形态：修一个实例≠修完同类），二者由本任务同日修订；并给出修订后的 ② 全文。核法：该 §11 内出现「退出条件」字样且其所在小节里出现 `AC-274`。

## DoD

**真实落地 = goal store 里 GOAL-020 的 body 真的换了、判官真的在新 key 上重判过一次、且旧句在 store 里查不到**——⛔ 不是「任务体里写了一段待批的建议文本」。

- 可核事实①（AC1）：`goal-store.ts get GOAL-020 --json` 的 `body` 含新句、不含旧句、其余节完好。
- 可核事实②（AC2）：范围节的清单条目 id 集合 == 在域 AC 集合，**集合相等**。
- 可核事实③（AC3）：`.quay/goal-sufficiency-cache.json` 出现新 key 条目，且 `.quay/goal-round.jsonl` 在其后落一条 `goal-sufficiency` fact。
- ⛔ **本任务只改 GOAL-020 的 body 文本**：不动任何 AC 的 `status` / `criterion`（AC-266/267/268 保持 `superseded`，AC-274 保持 `active`），不动 GOAL-020 的 `status`（保持 `active`），⛔ 不写 goal store 的 status。

## Touches

- goals/GOAL-020-ci-与-release-渠道成为可信守门员-develop-首绿-release-能发出三平台可用产物.md
- orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md
- tasks/gap-goal020-exit-conditions-stale-after-sea-channel-retired.md

⛔ 无测试文件：本任务无代码路径（产物是 goal store 里的 body 文本 + 一份 SPEC 记录），其判据是 AC1/AC2 的两条可执行谓词当场干跑（含 AC4 负控制），不进套件。⛔ 本任务不新增 `plugin/scripts/*` 检查器——那会牵动 capability-catalog / outline / laydown 三处登记，而本轮要的是**改文本**不是**造仪器**。

## 人批准（manager 会话，2026-09-16）

草稿按第四节原样批准，无改字。转 `todo` 交自动管线执行——AC1-AC5 都是可机械核验的谓词，不需要再等人判断。

## 证据（AC1–AC5 逐条核验，worker 会话 2026-09-16）

**产物落点**：`goals/GOAL-020-…md` 经 **goal store 本身**改写（`goal-store.ts write GOAL-020
--expect-existing --body <全文> --actor "worker:gap-goal020-exit-conditions-stale-after-sea-channel-retired"
--reason "option(b): 退出条件②去掉已退役的 SEA 半句、范围节改为在域 7 条…"`），在任务 worktree
`/home/yale/work/quay-worktrees/gap-goal020-exit-conditions-stale-after-sea-channel-retired` 内执行
⇒ 落成提交 `81bfa8f20 goals: GOAL-020 field:body by cli:2493529`（**任务分支**，不是主检出）。
⛔ 全程未手改 `goals/GOAL-020-*.md`。**goal store 未写任何 status**：write 之后 worktree `git status`
仅显示该 body 提交 + 任务分支上的 SPEC 改动，`goals/` 无其它 diff ⇒ AC 的 `status`/`criterion`
（AC-266/267/268 保持 `superseded`，AC-274 保持 `active`）与 GOAL-020 的 `status`（保持 `active`）全部原样。

### AC1｜旧句已消失 / 新句已在场 / 其余节完好

谓词（`bash /tmp/goal020-ac1.sh [<body-file>]`，缺省从 store 读 GOAL-020 的 body）：

```sh
if [ $# -ge 1 ]; then BODY="$(cat "$1")"; else
  BODY="$(node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts get GOAL-020 --json \
          | python3 -c 'import json,sys;print(json.load(sys.stdin)["body"],end="")')"
fi
case "$BODY" in *"SEA 产物不再因"*) echo "CAUSE=old-clause-still-present" >&2; exit 1;; esac
case "$BODY" in *"release 渠道能发出一个真能起来的产物"*) : ;; *) echo "CAUSE=new-clause-absent" >&2; exit 1;; esac
printf '%s\n' "$BODY" | grep -q '^## 背景'   || { echo "CAUSE=body-sections-lost" >&2; exit 1; }
printf '%s\n' "$BODY" | grep -q '^## 非目标' || { echo "CAUSE=body-sections-lost" >&2; exit 1; }
echo "AC1 PASS: old-clause absent / new-clause present / sections ## 背景 + ## 非目标 intact"
```

读数（cwd = 任务 worktree）：`AC1 PASS: old-clause absent / new-clause present / sections ## 背景 + ## 非目标 intact`，**exit 0**。
节标题实测仍在（`grep -n '^## '` 四条）：`## 背景（2026-09-15 实测，全部为直接量）` /
`## 范围（在域 AC = AC-265、AC-269、AC-270、AC-271、AC-272、AC-273、AC-274，共 7 条）` /
`## 非目标 / 与 GOAL-019 的边界` / `## 退出条件` —— 只有范围节标题按提案换了措辞，其余三条逐字未动。

### AC2｜范围节清单条目集合 S == 在域 AC 集合 L，且三条退役项被显式登记

谓词 `python3 /tmp/goal020-ac2.py [<body-file>]`：(a) 从 body 抽 `## 范围…` 节（标题前缀匹配），
在节体内**只取形如 `- **AC-NNN**` 的清单条目行**得 S；(b) 扫 `goals/AC-*.md` 取
`goal: GOAL-020` ∧ `status != superseded` 得 L；(c) 断言 `S == L == 7 条` 并打印 S；
(d) 断言节体内存在一行**同时**含 `AC-266`、`AC-267`、`AC-268` 与 `superseded`。

读数（cwd = 任务 worktree）：

```
S (范围节清单条目) = ['AC-265', 'AC-269', 'AC-270', 'AC-271', 'AC-272', 'AC-273', 'AC-274']
L (在域 AC)        = ['AC-265', 'AC-269', 'AC-270', 'AC-271', 'AC-272', 'AC-273', 'AC-274']
AC2 PASS: S == L == 7 in-scope ACs; retired AC-266/267/268 recorded as superseded
```

**exit 0**，集合**相等**（不是包含）。

⚠️ 硬规则 4c 的当场处置（两处都在实现前抓到的恒假形态）：退役说明行**故意写成一整条物理行**
（`⛔ 已退役、不再计入范围：**AC-266 / AC-267 / AC-268**——主体（SEA/npm 产物线）经人 2026-09-16
裁定取消，已 `superseded`（SPEC §11.4）。`）——因为 (d) 要求四者在**同一行**；若照提案正文那样折行，
`superseded` 会掉到下一行、**(d) 恒假**。而 (a) 只取清单条目行而不是整节全文抽 `AC-\d+`，是为了不让
退役行把 266/267/268 算进 S（否则 **(c) 恒假**）——这两条正是 AC 正文点名要求跨越的「中间层」。

### AC3｜判官在**新 key** 上重判过一次（⛔ 不是缓存命中）

改前读数（生产 `.quay/goal-sufficiency-followup.json`）：
`entries["GOAL-020"].key = 3c73e546246332abc7b6269f34784d20ec61b2550adcdae1f5d032b6be7682e9`，
它在生产 `.quay/goal-sufficiency-cache.json` 里的条目为
`{'verdict': 'insufficient', 'ts': '2026-09-16T10:07:18.599Z'}`。

做法：把**生产缓存原样播种**进任务 worktree 的 `.quay/goal-sufficiency-cache.json`（43 条，含旧 key），
再在 worktree 内跑**真判官**一轮：

```sh
cd <worktree> && node --no-warnings --experimental-strip-types plugin/scripts/goal-driver.ts \
    --root <worktree> --once --spawn-cap 0 --json
```

（`--root <worktree>` ⇒ `dataRoot` / `sufficiencyCacheDir` / `roundLogFile` 全部落在 worktree；
`--spawn-cap 0` 只关掉 gap-filing / stall-followup 的 LLM spawn，**不影响充分性判官本身**。）

读数 —— 三条子断言全部为真：
1. **原 key 条目仍在、且逐字未变**：`'3c73e546…' in entries == True`，
   值仍为 `{'verdict': 'insufficient', 'ts': '2026-09-16T10:07:18.599Z'}`（历史不被改写）；
2. **出现一个新 key 条目**：`54cdc2a9624197ab9452e238a8ab5695abaf9e7db6acc2b4e9b4d76ea2154fe5`
   `{'verdict': 'covered', 'ts': '2026-09-16T11:28:11.620Z'}`（entries 43 → 44）；
3. `.quay/goal-round.jsonl` 其后落了 `goal-sufficiency` fact，逐字：
   `{"name":"goal-sufficiency","value":{"sufficiency":{"goal":"GOAL-020","verdict":"covered"}},"state":"verified","reason":"sufficiency=covered（在域 AC 7 条）"}`。

⇒ 新 key ≠ 旧 key ⇒ **确实重判了，不是缓存命中**（`sufficiencyCacheKey` 含退出条件文本与范围节文本，
body 一改 key 必变）。新 verdict 由 `insufficient` 翻成 `covered` —— 按 AC3 的约定这**只是信号、不是本任务的
成功判据**；它与本任务的前提一致（②改造后逐字等于 AC-274 的 expect，覆盖关系由「不对上」变成「集合相等」）。

⚠️ **落点诚实说明**：这一轮跑在**任务 worktree** 里（改动所在地），所以上面两条读数取自
`<worktree>/.quay/`。生产 goal-driver（`driver-anchor --root /home/yale/work/quay`，每轮从**主检出**读
`goals/`）要等本任务经 fan-in 落到 develop、再经 `syncDevelopToDoc` 追上主检出之后，才会自行在新 body 上
重判——**那是同一段代码、同一个 `semanticSufficiencyVerdictDetail`、同一个 `sufficiencyCacheKey`**，
本轮的读数就是它的前像；本任务不声称已观测到生产侧那一轮。

### AC4｜负控制：AC1/AC2 的谓词能取假

改前 body 取自**生产 store**（主检出 `node … packages/quay/src/goal-store.ts get GOAL-020 --json`），
存为 `/tmp/goal020-body-before.md`（4421 字符，`grep -c 'SEA 产物不再因'` = **1**、
`grep -c 'release 渠道能发出一个真能起来的产物'` = **0**）。

```
$ bash /tmp/goal020-ac1.sh /tmp/goal020-body-before.md
CAUSE=old-clause-still-present
exit=1

$ python3 /tmp/goal020-ac2.py /tmp/goal020-body-before.md
S (范围节清单条目) = ['AC-265', 'AC-266', 'AC-267', 'AC-268', 'AC-269']
L (在域 AC)        = ['AC-265', 'AC-269', 'AC-270', 'AC-271', 'AC-272', 'AC-273', 'AC-274']
CAUSE=scope-list-drifted
S-L=['AC-266', 'AC-267', 'AC-268']  L-S=['AC-270', 'AC-271', 'AC-272', 'AC-273', 'AC-274']
S△WANT=['AC-266','AC-267','AC-268','AC-270','AC-271','AC-272','AC-273','AC-274']  L△WANT=[]
exit=1
```

两个 `CAUSE=` 与 AC4 要求的逐字一致，**两次都 exit 1** ⇒ AC1/AC2 **不是恒真的检查**（硬规则 3b：
一个恒真的检查是假的保证）。两向都取了读数：正向（改后 ⇒ exit 0）+ 负向（改前 ⇒ exit 1）；
非零方向查「命中的是不是我要的」，而 AC 正文里那 7 个 `grep -c` **零命中**的方向，由这条负控制承担
「同一谓词对一个已知为真的样本确实会命中」（硬规则 2 的两半）。

### AC5｜SPEC §11 裁定链补完（硬规则 5b 的当场执行）

`orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` 内新增 `### 11.5`（提交 `51d4d18ed`），
逐字说明：§11.4 只退役了 `AC-266/267/268` 三条**判据**，**未同步 GOAL-020 自己的退出条件②与范围节**
（5b 形态：修一个实例 ≠ 修完同类，且兄弟实例就在同一个 body 里），二者由本任务同日修订；并给出修订后的
② 全文。核法读数：§11 内含「退出条件」字样的行有 6 行，**逐行取「其所在小节」全部解析为 `### 11.5 …`**，
且该小节含 `AC-274` ⇒ AC5 PASS。