# AC-940 退出条件矛盾可见化 — live 证据

任务：`tasks/gap-ac940-exit-condition-contradiction.md`
日期：2026-11-06（派发会话 `2026-11-06T15:1xZ` 起；主检出读数时刻见各节）

## 0. 先说一件事：世界在立案之后变了（否则下面的读数会被误读）

- 立案时（Proposal / DoD 写下时）AC-938 的 `status` 是 `active` ⇒ AC-940 的判据 exit 1，
  stderr 逐字 `{"AC934":"achieved","AC938":"active","contradiction":"achieved AC whose evidence AC is red"}`。
- 派发时，`gap-goal-filing-ledger-landing` 的落地已经进了 develop/author：
  `goals/AC-938-…md` 的 `active→achieved` 翻转提交是 `3510aa8df`（2026-11-06 21:09:49 +0800），
  紧随其后 `goals/AC-940-…md` 由 goal-driver 自动翻 `achieved`（`a9236d72d`，21:09:55 +0800）；
  `reconcileGoalFiling` 在 `develop:plugin/scripts/goal-driver.ts` 里出现 5 次，
  `.quay/goal-filing.jsonl` 有一条真实 `filed` 终态（`requestId=GOAL-914|AC-937|…`，
  `taskId=gap-goal-filing-chain-audit`）。
- ⇒ **「此刻仍 exit 1」这个预期在派发时刻已不成立**。这正是 AC-940 判据自己的确定性逃逸口
  （让替代者达成）。下面把【立案时刻的真实读数】与【派发时刻的真实读数】都逐字记下，
  并标明各自来自哪个真实载体。⛔ 本任务没有改 AC-934 / AC-938 / AC-940 任何一条的 `status`
  或 `criterion` 来制造一条红读数——那正是 AC-940 要防的事。

## 1. 判据命令 + exit 1 + stderr 全行

判据正文（逐字，读自 goal store `createGoalStore('./goals').get('AC-940').criterion`）：

```
node -e "const fs=require('fs');const files=fs.readdirSync('goals');const st=(id)=>{const f=files.find(n=>n.startsWith(id+'-'));if(!f)return null;const m=fs.readFileSync('goals/'+f,'utf8').match(/^status:\s*(\S+)\s*$/m);return m?m[1]:'unknown'};const a=st('AC-934'),b=st('AC-938');if(a===null||b===null){console.error('AC record missing');process.exit(2)};if(a==='achieved'&&b!=='achieved'){console.error(JSON.stringify({AC934:a,AC938:b,contradiction:'achieved AC whose evidence AC is red'}));process.exit(1)};console.log(JSON.stringify({AC934:a,AC938:b}))"
```

### 1a. 立案时刻的真实记录（主检出自己的 git 对象：`3510aa8df^` = AC-938 翻 achieved 的前一个提交）

```
$ cd <workspace>; git -C /data/home/yale/work/quay archive 3510aa8df^ goals/ | tar -x -C <workspace>
$ bash -c "<上面那条判据>"
{"AC934":"achieved","AC938":"active","contradiction":"achieved AC whose evidence AC is red"}
EXIT=1
```

⚠️ 这不是 fixture：`goals/` 整个目录是从**主检出**的 git 对象里解出来的真实 goal 记录
（8 条 GOAL-914 的 AC + GOAL 记录，逐字未改），只是取在 AC-938 落地之前的那一个时刻。

### 1b. 派发时刻的主检出（`/data/home/yale/work/quay`，同一条判据，同一 store 入口）

```
$ cd /data/home/yale/work/quay && node -e "const fs=require('fs');const files=fs.readdirSync('goals');…"
{"AC934":"achieved","AC938":"achieved"}
EXIT=0
```

exit 0 不是「判据变弱了」，而是 AC-938 真的落地了（见 §0）。判据文本本身一个字节都没动
（本任务的红线之一）。

## 2. 主检出上新增的那条 divergence

读面：**真实 store 记录**（`listGoalRecords(<worktree>, '/data/home/yale/work/quay')`），
不重跑 criterion——第五类只由 `status × supersedes 关系` 决定，与 verdict 无关
（verdict 字段在这条最小读面上标成 `not-evaluated`，因此下表的 `verdict` 不作为读数依据）。
本类之外的四类被过滤掉（它们才是靠 verdict 的那四类）。

### 2a. 立案时刻状态（同一批真实记录，取 `3510aa8df^` 的 `goals/`）

```json
[
  {
    "id": "AC-934",
    "kind": "achieved-but-superseder-unmet",
    "status": "achieved",
    "verdict": "not-evaluated",
    "reason": "AC-934 is achieved but its declared superseder is not: AC-938 (status=active, verdict=not-evaluated); direction:one-way"
  }
]
```

⇒ 恰一条，`id=AC-934`，reason 点名 `AC-938 (status=active)`，并标出这是**单向声明漂移**
（AC-938 写了 `supersedes: ["AC-934"]`，AC-934 的 `supersededBy` 为空）。

### 2b. 派发时刻的主检出

```json
[]
```

⛔ 这不是「机制没生效」：第五类的判定是
`X.status==='achieved' ∧ ∃Y≠X 同 goal：Y 声明取代 X ∧ Y.status!=='achieved'`。
AC-938 现在 `achieved` ⇒ 第二个合取项不成立，矛盾按设计消解（确定性逃逸口之一）。
它的可见性证据因此取 §2a 的真实记录重放 + `plugin/test/meta-driver.test.mjs` 的
(a)–(f) 六条判定用例；`plugin/test/ac940-exit-condition-contradiction.test.mjs` 的另一把锁
证明的是 AC-940 判据本身仍然能取假。

## 3. GOAL-914 `## 退出条件` 改后全文 + `git diff`

写入面：goal store 自己的写入面（`quay goal write GOAL-914 --body … --store --root <worktree>`），
⛔ 没有手搓 frontmatter。改后该节全文：

```
## 退出条件

AC-934..937 均 achieved，且每条都有实现落地之后的生产载体读数：AC-934 至少一条真实 `filed` 终态且不存在仍 open 的 spawned 行；AC-935 至少一个 active GOAL 的一行投影且出现在 round fact；AC-936 至少一条真实请求被 driver 消费；AC-937 至少一条 driver 自己立案的任务落地并使 AC 机械翻 achieved。sufficiency 判官对在域 AC 集合判 covered。既有 GOAL 的 AC/退出条件不回退。

此外两条**否证条件**必须同时成立：AC-938（AC-934 的绿必须来自工作区树上真实存在的台账写入代码，而不是任务 worktree 一次证据跑留下的静态文件）——它未达成时，AC-934 的 achieved 不算证据；AC-940（本节不得被「AC-934 绿 ∧ AC-938 红」这一自相矛盾的组合满足）——两者冲突时 GOAL 不得退出。该冲突在每轮读数上可见（meta-driver 第五类 divergence `achieved-but-superseder-unmet`，reason 点名替代者与其状态），⛔ 不是只在人读导出时才看得见。
```

`git diff goals/`（只此一节；`git diff --numstat goals/` = `3 1`，只有 GOAL-914 一个文件）：

```diff
@@ -36,4 +36,6 @@
 
 ## 退出条件
 
-AC-934..937 均 achieved，且每条都有实现落地之后的生产载体读数：……既有 GOAL 的 AC/退出条件不回退。
\ No newline at end of file
+AC-934..937 均 achieved，且每条都有实现落地之后的生产载体读数：……既有 GOAL 的 AC/退出条件不回退。
+
+此外两条**否证条件**必须同时成立：AC-938（……）——它未达成时，AC-934 的 achieved 不算证据；AC-940（……）——两者冲突时 GOAL 不得退出。该冲突在每轮读数上可见（meta-driver 第五类 divergence `achieved-but-superseder-unmet`，reason 点名替代者与其状态），⛔ 不是只在人读导出时才看得见。
\ No newline at end of file
```

（`## 范围` 节里本来就提到 AC-938，所以按节取文本判定而不是整文件 grep——硬规则 2 按位置判定。）

按节取文本的检查（⛔ 不是整文件 `grep AC-938`）：

```
$ node -e '… const i=t.indexOf("## 退出条件"); const sec=t.slice(i); …'
{"file":"GOAL-914-goal-driver-自驱闭环-立案生命周期-下一步投影与请求消费-quay-native.md","section":"## 退出条件","has938":true,"has940":true}
EXIT=0
```

## 4. unpark 命令与此刻的事实

AC-940 的判据就是它的 unpark 检查（在主检出上直接跑即可）：

```bash
cd /data/home/yale/work/quay && node -e "const fs=require('fs');const files=fs.readdirSync('goals');const st=(id)=>{const f=files.find(n=>n.startsWith(id+'-'));if(!f)return null;const m=fs.readFileSync('goals/'+f,'utf8').match(/^status:\s*(\S+)\s*$/m);return m?m[1]:'unknown'};const a=st('AC-934'),b=st('AC-938');if(a===null||b===null){console.error('AC record missing');process.exit(2)};if(a==='achieved'&&b!=='achieved'){console.error(JSON.stringify({AC934:a,AC938:b,contradiction:'achieved AC whose evidence AC is red'}));process.exit(1)};console.log(JSON.stringify({AC934:a,AC938:b}))"
```

- 立案时刻：`exit 1`（§1a，stderr 全行已抄录）。
- 派发时刻：`exit 0`，stdout `{"AC934":"achieved","AC938":"achieved"}`。
- 它退回 1 的唯一含义是 **AC-938 的证据被撤回**（工作区树重新失去台账写入代码，或 AC-938 的记录
  退回 active）——那种情况下 GOAL-914 必须**不退出**，而这正是 `## 退出条件` 现在写下的那一条。

## 5. 其它复验命令（本任务新增能力的正/负控）

```bash
# 第五类：恰一条正控 + 三个负控全 0，退出码 0
node --experimental-strip-types --input-type=module -e "…computeDivergences…"

# AC-940 判据的回归锁（正控 + 三负控 + 变异负控）
node --test plugin/test/ac940-exit-condition-contradiction.test.mjs

# meta-driver 判定面（含 (a)-(f) 六条新用例 + 既有 149 条）
node --test plugin/test/meta-driver.test.mjs
```
