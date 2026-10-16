---
id: gap-ac152-filter-carrier-renamed-criterion-stale
title: AC152 判据 stale：TASK_FILTERS 里 touchesDisjoint 已被 touchesDisjointOrAged
  取代（GOAL-037/AC-365），判据仍点名旧名 ⇒ 判据移到真承载者 + 失败带成因 + 负控制
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-152
---
## Proposal

**本轮逐字实测（2026-10-17）**：`goals/AC-152-filter-composable-predicate-list.md` 的 criterion 现为 **fail**。逐字跑 ⇒ exit 1；把断言展开读数：

```
names:   notInFlight,depsSatisfied,touchesDisjointOrAged,retryCapNotExhausted,notNeedsHuman
missing: touchesDisjoint
```

⇒ 取假的只有「列表里那一格叫什么名字」这一面；`TASK_FILTERS` 仍是**一个列表**、仍是五个元素、两个任务处理型 kind 仍经 `applyTaskFilters` 共用（`plugin/scripts/worker-driver.ts:6673` / `plugin/scripts/promotion-driver.ts:925`）。

**成因：合法改名，不是机制坏了。** commit `efb4c8e85`（GOAL-037 / AC-365，achieved 2026-10-16）把 `TASK_FILTERS` 里 touch 那一格从 `touchesDisjoint` 换成 **`touchesDisjointOrAged`**，并把 `touchesDisjoint` **保留导出**（新谓词逐调用委托它；`plugin/scripts/driver-filters.ts:265-275, 436-438` 写明「**取代**列表里那一格、而不是追加第六个谓词」，理由：off 下与现状逐字节同形是 GOAL-037 生效路径的前提）。**保证本身仍然成立**：可组合谓词列表 + 两 driver 共用这一抽象没有变，变的只是那一格的名字。

**为什么上一轮的修复没顶住**：建机制的任务 `gap-ac152-filter-composable-predicate-list`（done）做对了（单一列表实现、两 driver 共用），判据也真绿了约六周。它顶不住的是**后续合法改名**——判据把**符号名**钉成字符串，任何改名（哪怕旧符号仍保留作实现）都会把它重新变假。

<!-- dedup-ref -->
同类已有先例：`gap-ac157-catalog-carrier-moved-criterion-stale`（done；承载者搬迁把判据变假，修法=判据移到真承载者）。本任务只做 AC-152 这一条，不重做它的通用机制。`orchestration/manager-phase-goal.md` 的 `### AC152` 段已随 G3（2026-09-06）**降级为历史档案**（正本在 `goals/`），故**不改写**；`orchestration/SPEC-unified-driver-architecture-2026-08-23.md` §2.1 的「现状（实测）」块是 2026-08-23 的**当日快照**，改写即篡改当时的测量（AC-157 先例的同类纪律：历史读数原样保留）。

**两个修法的取舍**：
- ✗ 把列表那一格改回 `touchesDisjoint` / 追加一个同名元素：拒绝——会破坏 AC-365 的 off 同形前提（多一条判定即不再同形），且与 AC-365 已落地的判据文本矛盾。
- ✓ **把判据移到真承载者**（点名当前那一格），并补上旧判据缺的两件事：失败**带成因**、可被**负控制**取假。

## Plan

1. **改判据（走机件，⛔ 不手搓 `goals/*.md`）**：`quay goal write AC-152 --criterion "<新判据>"`（`packages/quay/src/cli/goal.ts:307` 的 `patch.criterion` 路径）。⛔ **不要传 `--origin`**（`goal.ts:310` 只在显式传入时才 patch origin ⇒ 传了会覆盖 provenance）。新判据 = 旧判据的「五个名字在列表里」之上补三件：①点名**当前**承载者 `touchesDisjointOrAged`；②断言列表**恰好 5 格、名字唯一、每格都有 `predicate` 函数**（防「散落他处 / 平行副本」这类真取假形态）；③每条失败路径**同一行**打 `CAUSE=…` 到 stderr（今天 ledger 读数是「criterion wrote no output to stderr/stdout」，**红得无法诊断**；硬规则 3b 同族：不合格与「读不成」应当可区分）。
   - ⚠️ **写成单行**：`node --no-warnings --experimental-strip-types -e '…'` 全程单行，**不带 `#` 注释、不带内部换行**——store 以 YAML 折叠标量存它，多行会重排（`goal-criterion-comment-must-be-one-logical-line`）。
   - ⚠️ **真正的接受侧是 `/bin/sh`（dash），不是 bash**（`acceptance-runner.ts` 以 `shell: true` 起进程）：落盘后必须 `sh -n` + `sh -c` 各验一次。
   - ⚠️ `quay goal write` 会跑 `evaluateCriterionAttribution`（`ATTRIBUTION_RE = /stderr|>&2|console\.error/`，**行内匹配**）：每条 `process.exit(1)` 必须与 `console.error("CAUSE=…")` 同行，否则写入被拒。
   - 参考（已在本轮由立案方逐字验过、可直接采用，只需替换 `want` 里那一格为当前名）：单行 `node … -e 'import("./plugin/scripts/driver-filters.ts").then((m)=>{const want=[…];const f=m.TASK_FILTERS;…})'`，`sh -n` 与 `sh -c` 均 exit 0；把期望名换成旧名 ⇒ exit 1 且 `CAUSE=missing-filter=touchesDisjoint`（贴进 Evidence）。
2. **改 body**：`goals/AC-152-…md` 正文判据段里的 touch 那一格写成**当前名**，并加一行**带日期**更正（改名来源 commit `efb4c8e85` / GOAL-037 / AC-365；旧名仍是导出符号、只是不再占据列表那一格）。⛔ 原「2026-08-23 实测」那半句原样不动。
3. **把两个 pin 互相点名**（本次漂移的结构性成因）：`plugin/test/driver-filters.test.mjs` 的 `AC1 — TASK_FILTERS is the single list of the five composable predicates` 测试带着一份**逐字相同**的五名清单（`:104`），加注释点名 `goals/AC-152-filter-composable-predicate-list.md` 是它的镜像 pin ⇒ 下一次合法改名时，改测试的人会看到也要改判据（今天两处互不知晓：测试跟着改了，判据没改）。
4. **负控制**：`cp` 备份 `plugin/scripts/driver-filters.ts`，在任务 worktree 里把 `TASK_FILTERS` 的 touch 那一格临时删掉/改名 ⇒ 新判据必须 red 且打出 `CAUSE=…`；`cp` 恢复后 `md5sum` 与改前一致 ⇒ green。⛔ 不用 `git checkout` 恢复（会把并发改动一起洗掉）。

## AC

- [x] AC1 判据取真：`quay goal gate AC-152 --json` ⇒ `verdict: "pass"`（exit 0）；贴改后 criterion 全文与 `quay goal show AC-152 --json` 的读回
- [x] AC2 判据点名真承载者：（a）`quay goal show AC-152 --json` 取出的 criterion 含 `touchesDisjointOrAged`；（b）同一文本里 `grep -c '"touchesDisjoint"'`（**带双引号的精确 token**——`touchesDisjointOrAged` 是它的超串，不带引号的匹配必然假阳，硬规则 2 按位置判定）⇒ 0
- [x] AC3 失败带成因（可诊断）：把 store 里的新判据**逐字取出**，只把期望名换成旧名后以 `sh -c` 执行（⛔ 不写回 store）⇒ exit 1 且 stderr 含 `CAUSE=missing-filter=touchesDisjoint`（贴读数）
- [x] AC4 能取假（负控制，真载体）：临时改 worktree 里 `plugin/scripts/driver-filters.ts` 的 `TASK_FILTERS`（删/改名 touch 那一格）⇒ 判据 red（贴 `CAUSE=` 读数）；`cp` 备份恢复后 `md5sum` 与改前一致 ⇒ 判据 green（贴两侧读数）
- [x] AC5 落盘文本可被真接受侧执行：对 `quay goal show AC-152 --json` 取出的 criterion，`sh -n` 与 `sh -c` 均通过（贴两条读数）——⛔ 只验 `bash` 不算，接受侧是 dash
- [x] AC6 两个 pin 互相点名且仍绿：`grep -c 'goals/AC-152' plugin/test/driver-filters.test.mjs` ⇒ ≥1；`node --experimental-strip-types --test plugin/test/driver-filters.test.mjs` ⇒ 0 fail
- [x] AC7 criterion/body 经 Provider ABI 写入：`git log --oneline -1 -- goals/AC-152-filter-composable-predicate-list.md` 指向本任务工作（provider 自提交），且改后 `quay goal show AC-152 --json` 的 `origin` 与改前逐字相同（贴前后两读数）
- [x] AC8 `node plugin/scripts/task-schema-check.ts tasks/gap-ac152-filter-carrier-renamed-criterion-stale.md` ⇒ exit 0

## DoD

AC-152 在 goal-driver 下一轮由 fail 翻 **pass**（读 `.quay/goal-round.jsonl` 该 AC 的 verdict），且达成靠的是**判据移到真承载者 + 失败带成因 + 负控制可红**——⛔ 不是把判据改成恒真（AC3/AC4/AC5 是这条的判据），⛔ 也不是把代码里的名字改回去（那会破坏 AC-365 的 off 同形前提）。只把名字换掉却拿不出 AC3/AC4 的读数 ⇒ 不算达成。

## Touches

- goals/AC-152-filter-composable-predicate-list.md
- plugin/test/driver-filters.test.mjs
- tasks/gap-ac152-filter-carrier-renamed-criterion-stale.md

## Evidence

**判据（改后，逐字取自 `quay goal show AC-152 --json`）**：

```
node --no-warnings --experimental-strip-types -e 'import("./plugin/scripts/driver-filters.ts").then((m)=>{const want=["notInFlight","depsSatisfied","touchesDisjointOrAged","retryCapNotExhausted","notNeedsHuman"];const f=m.TASK_FILTERS;if(!Array.isArray(f)){console.error("CAUSE=TASK_FILTERS-not-a-list — the composable-predicate list is the single carrier AC-152 names");process.exit(1)}if(f.length!==want.length){console.error("CAUSE=filter-count="+f.length+"-want="+want.length+" — TASK_FILTERS must hold exactly the five composable predicates, no more and no fewer");process.exit(1)}const names=f.map((x)=>x&&x.name);const missing=want.filter((n)=>!names.includes(n));if(missing.length){console.error("CAUSE=missing-filter="+missing.join(",")+" — TASK_FILTERS must expose "+want.join(","));process.exit(1)}const dup=names.filter((n,i)=>names.indexOf(n)!==i);if(dup.length){console.error("CAUSE=duplicate-filter-name="+Array.from(new Set(dup)).join(",")+" — each predicate occupies exactly one slot");process.exit(1)}const bad=f.filter((x)=>typeof x.predicate!=="function").map((x)=>x&&x.name);if(bad.length){console.error("CAUSE=filter-without-predicate="+bad.join(",")+" — every slot must carry a callable predicate, not a name-only stub");process.exit(1)}process.exit(0)}).catch((e)=>{console.error("CAUSE=import-failed="+String((e&&e.message)||e));process.exit(1)})'
```

| AC | 读数（逐字） | 载体 |
|---|---|---|
| AC1 | `"verdict": "pass"` / `acceptance passed (exit 0)`，exit 0 —— **主检出与 worktree 两个 root 各一次** | `quay goal gate AC-152 --json` |
| AC2 | (a) `grep -c 'touchesDisjointOrAged'` = **1**；(b) `grep -c '"touchesDisjoint"'` = **0**（非恒零的配套干跑：`grep -c '"touchesDisjointOrAged"'` = **1**） | `goal show AC-152 --json` → `.criterion` |
| AC3 | 逐字取出后**只**换期望名（difflib 只有 1 个非 `equal` 区段：`delete stored[164:170]='OrAged'`）⇒ `sh -c` exit **1**，stderr `CAUSE=missing-filter=touchesDisjoint — TASK_FILTERS must expose notInFlight,depsSatisfied,touchesDisjoint,retryCapNotExhausted,notNeedsHuman`（⛔ 未写回 store） | worktree，cwd 使 `./plugin/scripts/driver-filters.ts` 可解析 |
| AC4 | 删掉 `TASK_FILTERS` 的 touch 那一格 ⇒ 判据 exit **1**、stderr `CAUSE=filter-count=4-want=5 — TASK_FILTERS must hold exactly the five composable predicates, no more and no fewer`；**经真接受侧** `goal gate` 亦 `verdict: fail`，reason 带**同一** `CAUSE=`（旧判据此处是「criterion wrote no output to stderr/stdout」⇒ 本次修复正是把「红得无法诊断」换成带成因的红）。`cp` 恢复后 `md5sum 86b23f883053b7e772f250901f229c88` 前后**一致**、`git status` 该文件为空 ⇒ 判据 exit **0** | `plugin/scripts/driver-filters.ts`（`cp` 备份 + `cp` 恢复，⛔ 非 `git checkout`）；负控制跑在**合并 develop 之后**的最终树上 |
| AC5 | `sh -n` exit **0**；`sh -c` exit **0**（`/bin/sh -> dash` 已核，⛔ 不是 bash） | `/bin/sh` |
| AC6 | `grep -c 'goals/AC-152' plugin/test/driver-filters.test.mjs` = **2**；`node --experimental-strip-types --test plugin/test/driver-filters.test.mjs` ⇒ `tests 90 / pass 90 / fail 0` | 本任务 worktree |
| AC7 | worktree：`73a9a3f0b goals: AC-152 field:criterion,body by cli:3280833`；主检出：`03ef3834a goals: AC-152 field:criterion,body by cli:3229015`。`origin` 改前 = 改后（逐字 `人 2026-08-23 裁定「前述可重用机制应当分层抽象，以支持这两层上的重用」；正本 orchestration/SPEC-unified-driver-architecture-2026-08-23.md §2.1/§2.5/§2.6。`） | **两个 root 各经 Provider ABI 写一次，文本逐字相同** |
| AC8 | `1 total, 0 pass, 1 N/A-legacy, 0 fail` ⇒ exit **0**（⛔ N/A-legacy 不是 fail） | `plugin/scripts/task-schema-check.ts` |

**两个 root 都写（同文本，⛔ 不是重复劳动）**：主检出 root 是 goal-driver 实际读的那棵树（`/proc/904789/cwd -> /data/home/yale/work/quay`，driver-anchor `--root /data/home/yale/work/quay`）——只写 worktree 会让 DoD 读不到；worktree root 是**分支 delta 的承载者**（AC7 的 self-commit 落在这里）。两侧文本逐字相同 ⇒ `git merge develop` 干净（实测：`Merge made by the 'ort' strategy`，`goals/` 无冲突）。

**本任务自己的门（同 driver fan-in 跑的那两条）**：
- `bash scripts/test.sh --for-task gap-ac152-filter-carrier-renamed-criterion-stale --allow-thin` ⇒ exit **0**（90 pass / 0 fail）。
- `anti-drift-touches-check --merge-target develop` ⇒ `ANTI-DRIFT OK: … 1 actual file(s), all within declared Touches (3 glob(s))`，exit **0**。

**改动面（3 个文件，全部在 `## Touches` 内）**：`goals/AC-152-…md`（criterion + body，经 ABI）、`plugin/test/driver-filters.test.mjs`（互指注释，Δ=1 块注释）、`tasks/gap-ac152-…md`（本文件）。
