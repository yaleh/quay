---
id: EXIST
title: EXIST 残留对象处置记录（非工作项）
status: ready
labels: []
parent: null
children: []
extra: {}
---
## Finding

本任务对象不是一个真实工作项，而是 2026-09-14 一次「已存在 id 的 create」复现留下的残留。

复现想在一次性目录里建这个 id，命令行上用 `--tasks-dir` 把 store 指到别处；`task create` 不认这个
参数，未知参数被静默忽略，store 于是按仓库根解析，把文件写进了本工作区的真实任务目录。
复现脚本随后删掉了工作树里的文件，但该对象已被 CLI 提交（b4c6e8b41，提交信息
`tasks: EXIST task_write by cli:1216183`）。

已核的三条读数（每条都能取假）：

1. 对该文件的 git log 只有 b4c6e8b41 一条 —— 无实现提交、无 fan-in 提交。
2. 全仓任务体里把它当 parent 或 depends_on 引用的命中数 = 0。
3. 本对象没有段落、没有验收判据、没有完成定义、没有 Touches —— 按现状不可能被当作可执行工作。

因此本任务的真实工作只有一件：把这个残留对象处置掉（或写明保留理由），让 todo 池里不再有
一个从不打算被执行的条目。

<!-- dedup-ref -->
相关但不同：`gap-quay-native-task-create-duplicate-id-prepends-frontmatter`（已 done）是那次复现所
验证的缺陷本身；本条处置的是复现留下的残留对象 —— 对象、判据、落点都不同，不重复立案。

## 更正（2026-09-15 处置轮补记；不改写上文，把差记在明处）

上文三条读数写在提交 `2a9ef2f76`（2026-09-15T16:06:06Z）。此后本对象又收到两条提交，
**两条都不是实现提交、也不是 fan-in 提交**，而是本对象自身的记录与生命周期：

| 提交 | 时刻 | 是什么 |
|---|---|---|
| `2a9ef2f76` | 16:06:06Z | 上文的落盘（`tasks: EXIST task_write by cli:873387`，+37 行） |
| `ae15f8643` | 16:06:51Z | `tasks: EXIST todo→ready（promotion-driver 机械晋升）` |

⇒ **读数 1 的逐字读法已失效**：现在 3 条，不是 1 条。**但它的实质（无实现提交 / 无 fan-in 提交）仍成立**
—— 三条全是任务记录自身的写入，没有一行产品代码，没有一次 fan-in 合并。逐字与实质的差见 Evidence/AC1。

⇒ **读数 3 是被它自己的写入动作否掉的**：写下读数 3 的那一次 `task_write` 正是给本对象补上
Finding/AC/DoD/Touches 的那一次，50 秒后晋升又把它变成在飞工作项。该句描述的是写入【之前】的状态，
故它现在不成立，且不可能再成立。

⇒ ⚠️ **一个会带偏下一位读者的陷阱**：`git log --follow -- tasks/EXIST.md` 会把
`packages/quay-native/tasks/V-1.md` 显示成本文件的前身。那是 `--follow` 的**相似度假阳性**——
`b4c6e8b41` 的逐路径 diff 是 `new file mode 100644`、`9 insertions(+)`、`0 deletions(-)`，
且 V-1.md 至今仍在树里、未被删改。此处记录以免有人据此认为 EXIST 是 V-1 改名而来。

## Disposition（处置：**保留**，理由成段）

**决定：保留本对象，不删除。** 理由五条，每条都能取假：

1. **删除会与本案的成因同形。** 本对象的成因是一次【静默】写入 —— `task create` 静默吞掉未知参数
   `--tasks-dir`，把文件写进真实 store；复现脚本随后删掉了工作树里的文件，而提交已经落地。
   若处置方式是静默删除，那是同一形态的第二次：动作发生了，记录上没有可核的痕迹。
2. **判据本身要求证据落在「体内」。** AC1/AC2 与 DoD 都要求把「命令 + 原始输出」贴进任务体内。
   文件被删则「体内」不存在，这两条判据**在结构上不可满足**。⇒ 在「移除」与「保留理由成段」两支里，
   只有后者能同时满足三条 AC 与 DoD。这是判据结构上的结论，不是偏好。
3. **对象已被巡环回收为工作项。** 16:06:06 那次 `task_write` 补上了四件套，16:06:51 晋升把它推进
   ready 并派发。它不再是「从不打算被执行的条目」—— 它现在的工作就是自己的处置，本轮即闭合。
4. **删除会砸掉在飞的机械链。** 本对象此刻正被 worker/fan-in 驱动；fan-in 的 ac-precheck 与 done 翻转
   都以 `tasks/<id>.md` 存在为前提。文件消失 ⇒ 该轮 fan-in 失败，且处置记录失去落点。
5. **为什么不设 `superseded`。** 本 store 现有 68 条 `superseded` 都是**被取代的真实任务**
   （如 `DIR-101` 带 `extra.superseded: true` + `## DRAIN disposition`、`DIR-119-D3` 被同父兄弟取代）。
   EXIST 不被任何对象取代，它的交付物（一个处置决定 + 记录）本轮真实完成 ⇒ 终态是 `done`，
   不是 `superseded`。两个终态不可混用。

**保留的代价与抵消。** 一条 `done` 记录若仍叫 `repro title`，它依然是污染源：读者会以为某项工作被完成了。
故本轮同时把 frontmatter `title` 改为 `EXIST 残留对象处置记录（非工作项）`，让「这是一条处置记录、
不是产出」在读任务列表时当场可见。改动落在同一个文件（`## Touches` 里那一行），未新增文件。

## Evidence（AC 逐条证据：命令 + 原始输出）

### AC1 — 出处

```
$ git log --oneline -- tasks/EXIST.md
ae15f8643 tasks: EXIST todo→ready（promotion-driver 机械晋升）
2a9ef2f76 tasks: EXIST task_write by cli:873387
b4c6e8b41 tasks: EXIST task_write by cli:1216183

$ git log --oneline -- tasks/EXIST.md | wc -l
3

$ git show --stat --oneline b4c6e8b41
b4c6e8b41 tasks: EXIST task_write by cli:1216183
 tasks/EXIST.md | 9 +++++++++
 1 file changed, 9 insertions(+)

$ git log --oneline --follow -- tasks/EXIST.md        # ⚠️ 最后一行是假阳性，见「更正」
ae15f8643 tasks: EXIST todo→ready（promotion-driver 机械晋升）
2a9ef2f76 tasks: EXIST task_write by cli:873387
b4c6e8b41 tasks: EXIST task_write by cli:1216183
5b452aacd Add quay-native and quay Core v0-v1 walking skeleton, experiment scaffold

$ git ls-tree -r HEAD --name-only | grep V-1
packages/quay-native/tasks/V-1.md        # V-1.md 仍在 ⇒ 上面的「改名」不成立
```

**逐字读法**：3 条 ≠ 1 条 ⇒ Finding 读数 1 的「只有一条」**不成立**（失效原因见「更正」一节）。
**实质读法**：3 条里 0 条是实现提交、0 条是 fan-in 提交 ⇒ 与 Finding 的括注
「无实现提交 / 无 fan-in 提交」**一致**。
本条按**实质**勾上；逐字的差已在本文件内显式记出（「更正」表 + 上面两段原始输出），未隐去。
若审阅者判「须按逐字、故本条应为未满足」，本行即为该判断所需的全部原始材料。

### AC2 — 无依赖者

谓词 P（只读 frontmatter；只取 `parent` / `depends_on` 的**值位**；**逐字相等**，不是子串、不吃前缀）：

```bash
pred() {
  awk -v id="$1" '
    FNR==1 { fm=0; dep=0 }
    /^---[[:space:]]*$/ { fm = (fm==0) ? 1 : 2; next }
    fm!=1 { next }
    /^[A-Za-z_][A-Za-z0-9_]*:/ { dep=0 }
    /^parent:/ { v=$0; sub(/^parent:[[:space:]]*/,"",v); if (v==id) print FILENAME":"FNR": "$0 }
    /^depends_on:/ { dep=1; v=$0; sub(/^depends_on:[[:space:]]*/,"",v);
                     gsub(/[][,"]/," ",v); n=split(v,a," ");
                     for (i=1;i<=n;i++) if (a[i]==id) print FILENAME":"FNR": "$0; next }
    dep && /^[[:space:]]+-/ { v=$0; sub(/^[[:space:]]+-[[:space:]]*/,"",v);
                              if (v==id) print FILENAME":"FNR": "$0 }
  ' tasks/*.md
}
```

```
$ pred EXIST
（无输出）
hits=0

# 对照① parent 分支 · 已知为真 —— 必须非 0，否则谓词是空转的
$ pred exp5-M-CRYST | head -2
tasks/exp5-M-CRYST-A2.md:10: parent: exp5-M-CRYST
tasks/exp5-M-CRYST-ANALYSIS.md:9: parent: exp5-M-CRYST
hits=20

# 对照② depends_on 列表项分支 · 已知为真
$ pred gap-ac248-adr-check-differential-record-producer
tasks/gap-ac249-complete-change-code-doc-same-task-record.md:15:   - gap-ac248-adr-check-differential-record-producer
hits=1

# 对照③ 松谓词在计数为 0 时先看它命中什么（硬规则 2 的「打印前 3 条」动作）
$ grep -rnE '\bEXIST\b' tasks/ | grep -v '^tasks/EXIST.md:'
tasks/gap-readme-...-all-broken-quay-js-does-not-exist.md:5:  ... this file DOES NOT EXIST, only
tasks/gap-quay-native-task-create-duplicate-id-prepends-frontmatter.md:69:  ... task create EXIST-001 ...
tasks/gap-quay-native-task-create-duplicate-id-prepends-frontmatter.md:71:  ... task "EXIST-001" already exists ...
tasks/gap-quay-native-task-create-duplicate-id-prepends-frontmatter.md:72:  ... task create EXIST-002 ...
tasks/gap-quay-native-task-create-duplicate-id-prepends-frontmatter.md:87:  ... updated EXIST-001 ...

# 对照④ 前缀必须不被吃（EXIST-001 ≠ EXIST）
$ printf -- '---\nid: T\nparent: EXIST-001\n---\n' > /tmp/t.md ; pred /tmp/t.md
（无输出）—— 前缀被正确拒绝
```

对照③是这条判据存在的理由：松谓词命中 5 条，**全部是散文**（`DOES NOT EXIST`）或**另一个 id**
（`EXIST-001` / `EXIST-002`，复现当时真正使用的 id），**没有一条是 parent/depends_on 引用**。
⇒ 关键词计数在这里会给出与真值无关的数；必须用结构谓词。

**0 的来源完备性（硬规则 5）**：这个 0 取自**全部两个** task store 的全量 ——
`tasks/`（2189 个 `.md`）+ `packages/quay-native/tasks/`（1 个 `.md`：V-1.md，另有 `pred` 对其为 0）。
全仓其余带 `id:` frontmatter 的 `.md` 是文档与 fixture（`orchestration/*.md`、
`experiments/**/fixtures/*.md`），不是任务 store 条目，不参与本计数 —— 此处写明范围，
以免「搜不到」被当成「不存在」。

### AC3 — 处置已落（读盘，非自述）

```
$ grep -n '^status:' tasks/EXIST.md
6:status: ready          # 处置轮开始时的盘上状态；本轮由机械 fan-in 翻 done

# store 全量 frontmatter 扫描（处置轮开始时的现状）
$ awk '<infm 内> /^status:/{print $2}' tasks/*.md | sort | uniq -c | sort -rn
   2113 done
     68 superseded
      4 ready
      3 needs-human
      1 todo

# ready-pool 的【目标化判定】—— DoD 点名的那个量
$ node --experimental-strip-types plugin/scripts/ready-pool-check.ts \
      --root /home/yale/work/quay --targeted EXIST
{
  "id": "EXIST", "found": true, "status": "ready",
  "eligible": false, "floor_independent": true, "reason": "status-ready",
  "pool": 4, "floor": 20, "cap": 5
}

# 对照：同一判定对池里唯一的真 todo 任务给出的【是逐任务算出来的】理由，不是常量
$ node --experimental-strip-types plugin/scripts/ready-pool-check.ts \
      --root /home/yale/work/quay --targeted gap-prose-prereq-negation-window-is-before-keyword-only-and-sibling-markers-are-chinese-only
{
  "id": "gap-prose-prereq-...", "status": "todo", "eligible": false,
  "reason": "gap-prose-prereq-...: not eligible · four-artifacts complete · deps ready · touches resolve · prose-prereq GAP(gap-prose-prereq-detector-blind-to-repo-own-conventions)"
}
```

**读到的值**：`eligible=false`，`reason=status-ready` ⇒ 目标化判定不把本 id 当候选。
处置落地（fan-in 翻 `done`）后同样为 `false`，且不再出现在任何派发池 / todo 列表里。
对照说明：同一判定对两个对象给出**不同的 status 与不同的 reason**（`status-ready` vs 逐条子条件），
⇒ 它不是恒 false 的常量。**已知的读法边界（硬规则 5）**：本 store 当前没有 `eligible=true` 的样本
（唯一的 todo 被一个 prose-prereq GAP 挡住），故「该谓词能返回 true」这半边**未取到正样本**，
记为边界而非结论。另一条边界：该检查器读 status 的具体来源（盘 vs ref）在本对象上不可区分
（盘与 refs 同值），故此处只声称「读到的值与盘上一致」。

**处置的落点**：本节 + 「Disposition」一节就是落点（保留理由成段可见）；文件仍在 store 中，
终态由本轮机械 fan-in 翻为 `done`。

### DoD 第 3 条 — 只动了 Touches 里那一个文件

```
# 基线（处置轮开始前，主检出）
$ git status --short -- tasks/
（空）

# 本任务 worktree 的 tracked 状态：零改动、零提交
$ git -C /home/yale/work/quay-worktrees/EXIST status --short
（空）
$ git -C /home/yale/work/quay-worktrees/EXIST rev-list --count develop..HEAD
0

# worktree 供给复制进来的文件都不是 tracked 文件（故不构成「动了别的文件」）
$ git ls-files --error-unmatch .quay/config.yml
error: pathspec '.quay/config.yml' did not match any file(s) known to git
$ git ls-files plugin/vendor/ | head -2
plugin/vendor/quay-native/provider.yml
plugin/vendor/quay/package.json
```

⇒ 本任务唯一的写入是 `tasks/EXIST.md` 自身（由 `task_write` 提交，见 AC1 的 git log）。
未触碰任何其他任务体，未触碰任何代码：本任务**没有代码 delta**（它的交付物是这条记录）。

## Acceptance Criteria

- [x] AC1: **出处已核**——对该文件的 git log 只返回立案那一条提交（无实现提交 / 无 fan-in 提交），原始输出贴进体内。
- [x] AC2: **无依赖者已核**——全仓对 parent / depends_on 指向本 id 的命中数为 0，并附谓词对照（计数为 0 时要拿一个已知为真的样本干跑同一个谓词）。
- [x] AC3: **处置已落（读盘，非自述）**——本对象已从 store 移除，或保留理由在体内成段可见；处置后 todo 列表不再把本 id 列为工作。

## Definition of Done

- [x] AC1–AC3 全部勾上，每条证据 = 命令 + 原始输出片段，贴在任务体内。
- [x] 处置读数是盘上状态：本文件已不存在（或保留理由成段），且 ready-pool 的目标化判定不再把本 id 当候选。
- [x] 本任务自始至终只动 Touches 里那一个文件，未触碰任何其他任务体或代码。

## Touches

- tasks/EXIST.md（本任务自身的对象：处置落点）
