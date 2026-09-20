---
id: gap-ac271-build-reading-creates-shared-release-ref
title: AC-271 第二次红：取一次 build 模式读数（resolveVersion 按 release/* 分支名判定）就必须在共享 Git
  目录造一条真 release/* 分支——合法验证动作与长期保证结构冲突，且创建与销毁都不留痕
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-271
---
**type:** execution

## Finding

**缺口｜AC-271 的保证在 2026-09-20 又红了一次。这次把它翻红的不是「有人忘了删分支」，而是本仓库自己一条在飞任务的 AC 所要求的**合法动作**：取一次 build 模式读数。**

⛔ **状态如实说明（硬规则 4，先读这段再看下面的数）**：**立案当轮判据读数是 `pass`**——违规分支已消失，`node packages/quay/bin/quay.js goal gate AC-271` → `{"verdict":"pass"}`、`EXIT=0`（2026-09-20T04:53:43.150Z）。本任务**不**声称判据现在红着。要修的是**保证的耐久性**：本轮实测到它在**生产台账上**被一个**会重复发生**的合法动作翻红，且翻红与复原都**不留仓库痕迹**。⇒ 一个 `long-term: true` 的保证，不能只在「碰巧没人取读数」的时刻成立。

⚠️ **关于「第二次」的口径（硬规则 2：按位置判定，不按关键词）**：`.quay/gate-events.jsonl` 里 **2026-09-20 只有 1 次** AC-271 fail 读数（04:52:49.353Z）。引文所说的「第二次」指的是**第二次事件**（2026-09-19 那次之后），**不是**同一红窗内两次读数。此外我自己在红窗内有**两次直接观测**到违规态（见下，均为直接量）。⛔ 不把「观测到违规态两次」写成「判据 fail 了两次」。

**本轮实测（主检出 `/home/yale/work/quay`，全部为直接量）**：

| 量 | 值 |
|---|---|
| 生产 fail 读数 | `2026-09-20T04:52:49.353Z` `actor=goal-cli` `gate=goal` `verdict=fail` — `CAUSE=release-branch-not-parked-on-a-tag — 1 of 1 release branches have a tip that is not any tag: release/ac4-reading` |
| 违规分支 | `refs/heads/release/ac4-reading`，tip `df538caa6886f105f49412fcdf184203e862ca9e` |
| `git tag --points-at release/ac4-reading` | **空**（我的两次独立观测，窗内） |
| 红窗宽度 | `04:51:07.365Z`（创建）→ `04:53:26.422Z`（销毁）= **2m19s**，期间**恰好 1 次** driver 读数（04:48:10.744Z pass 在窗前，04:53:43.150Z pass 在窗后） |
| 该 tip 是否切版 | `git log -1` = 「版本号生成器 stamp-version：改 VERSION 一处即更新全部 15 处载体」，`2026-09-20 04:50:09Z`，父提交 `f8f385bee`（当时 `author` 的 tip） |
| 该 tip 是否已进入主干 | `git merge-base --is-ancestor df538caa6 {develop,author,master}` → **三个全 NO** |

**生产者（可查，机件读取而非手搓）**：worker 会话 `c543788e-52ea-4e2f-917a-8bc89399a001`（`claude -p` 的 `quay-task-worker`，任务 `gap-version-stamp-generator-and-build-wiring`，进程 04:36:41 起）。`meta-cc query_session_content --role tool --session_id c543788e-… --contains ac4-reading` 逐字读出两条：

```
2026-09-20T04:51:07.365Z  cd /home/yale/work/quay-worktrees/gap-version-stamp-generator-and-build-wiring \
  && git worktree add /home/yale/work/quay-worktrees/ac-stamp-release-reading -b release/ac4-reading HEAD …
2026-09-20T04:53:26.422Z  … cd /home/yale/work/quay && git worktree remove --force …/ac-stamp-release-reading \
  && git branch -D release/ac4-reading …
```

⛔ 注意：命令是在**任务 worktree**里敲的，但 worktree 与主检出**共享 `refs`** ⇒ 分支落进共享 `.git`，主检出上的判据**看得见它**。这正是判据设计要的（判据判的是「本地有没有这样的分支」，不管谁在哪敲的）。

**结构成因（这是本任务真正要修的东西，不是症状）**：`scripts/resolve-version.ts:98`：

```
const RELEASE_BRANCH_RE = /^release\//;
```

同文件 `:26-27` 的语义说明：「`build` — …… `X.Y.Z`（无后缀）**iff** HEAD 恰在 tag `vX.Y.Z` 上，**或当前分支是 `release/*`**」。⇒ **build 模式的判决按分支名**，于是**每一次** build 模式的真实验证，都必须在真 Git 仓库里把 HEAD 放到一条**真** `release/*` 分支上。而 AC-271 恰恰禁止共享仓库里存在 tip 不在 tag 上的 `release/*` 分支。**两个机制各自都对，合起来直接冲突**——而冲突的代价是：保证被合法动作翻红，且翻红者无从追查。

**为什么上一轮的修复没有覆盖它**：`gap-ac271-release-branch-outlives-its-tag-again`（`goal_ac: AC-271`，done 2026-09-19）交付的是**删除半边**——命令 `release-branch-finish.sh`、它的 `--cut --tag` 落地步、以及 `.quay/release-branch-finish.jsonl` 痕迹。它的 Finding 通篇讲的是「合回后没人删」，**没有一处提到「为取读数而合法创建一条 release 分支」**；其 `## Touches` 也只覆盖命令/测试/catalog/SPEC。⇒ ⛔ 本任务**不是**它的重复：它管销毁，本任务管**创建侧**。

**判别性对照（硬规则 4 推论四：给不出对照就只是假说）**：
- 假说 H1「某次切版忘了删分支」⇒ 预测：本轮红掉的分支应当是**切版动作**的产物——tip 停在版本 tag 之后，或与某次 cut 的提交同源。
- 假说 H2「为取 build 读数临时造了一条分支」⇒ 预测：tip 是一条与该版本**无关**的实现提交，且不在任何 tag、也不在主干。
- **实测与 H2 一致、与 H1 相反**：tip `df538caa6` 是**版本号生成器**的实现提交，`tag --points-at` 空，`merge-base --is-ancestor` 对 develop/author/master **全 NO**，且它的消费者任务 AC 逐字要求造这条分支（见下）。⇒ **H1 被实测排除。**

**消费者的 AC 逐字要求（这就是「合法动作」的出处）**：`tasks/gap-version-stamp-generator-and-build-wiring.md:34`（status=ready，在飞）：

```
- [ ] build 模式真实读数：在真实 release/* 临时分支上跑 sync-vendor.sh 的产物，其
      plugin/.claude-plugin/plugin.json 与 plugin/VERSION 无 -dev；在 develop/author 上带 -dev。
```

⇒ **任务撰写者写这条 AC 完全合理**（它要的正是 build 模式的真实读数），**它也没有任何办法知道**这么做会把一条长期保证翻红。⛔ 这才是缺口：**「不要去造 release 分支」这条规则在【创建点】没有任何载体**（硬规则 9：可见性 ≠ 执行）。

**无痕（第三次出现同一个失败形态）**：
- `.quay/release-branch-finish.jsonl` 末条 = `2026-09-19T03:52:55Z` ⇒ 本轮的创建与销毁**零记录**（走的是裸 `git worktree add -b` / `git branch -D`，不是命令）。
- `.git/logs/refs/heads/` 下**无 `release/` 目录**（`git branch -D` 连 reflog 一起删）⇒ 连「谁造过」都没有本地痕迹。
- ⇒ 「谁删的、用哪条命令删的」在本仓库**不可查**（唯一可查的是 worker transcript，那是会话面不是仓库产物）。**与 2026-09-19 那次「无痕迹的外部删除」是同一个形态，只是这次发生在创建侧**——同一个坑踩了两次，且两次都不是靠仓库产物发现的。

**发生率（硬规则 12：先给读数，再谈前置）**：
- AC-271 台账累计 fail = **29** 次；其中 **2026-09-20 = 1 次**（本轮）。
- 而「build 模式验证需要一条真 `release/*` 分支」这一**生产者**已至少 **2** 个实例：`gap-version-single-source-root-file-and-resolver`（done，落地了 `RELEASE_BRANCH_RE` 的 build 语义）与 `gap-version-stamp-generator-and-build-wiring`（ready 在飞，本轮翻红者）。**且每验证一次 build 模式就会再生一次。** ⛔ 本任务**不以发生率为前置**：AC-271 是 `long-term: true`，它要的是**保证**；本轮已实测到保证被合法动作击穿。

**边界（⛔ 不做）**：
- ⛔ **不放宽判据**。上一轮已明令「不把判据放宽成『允许在 tag 之后生长』」，本任务沿用该边界：判据保持严格，本轮它**抓对了**——红的是保证，不是判据。
- ⛔ **不给 `resolveVersion` 加「注入分支名」的开关**来消解冲突。那会把 build 读数变成恒真的回声（硬规则 4 推论三：一个只能被注入数据满足的判据不是测量）。
- ⛔ **不改 `gap-version-stamp-generator-and-build-wiring` 的实现或它的 AC**（那是它的实现者/作者的活）。本任务只把载体备好；它的 AC4 文字是否要跟着改，由那条任务的持有者判。

## Requested action

1. **先取证（任一不满足就停并报告）**：贴出（a）台账里 `2026-09-20T04:52:49.353Z` 那条 fail 的原文；（b）`meta-cc query_session_content` 读出的那两条命令（含时间戳）；（c）红窗两端的 `git rev-parse` / `git worktree list` 读数；（d）两处无痕读数（`.quay/release-branch-finish.jsonl` 末条时刻、`.git/logs/refs/heads/release/` 不存在）。⛔ **不得**把这次的创建或销毁归因给 `release-branch-finish.sh`——它以 `result=deleted-local` / `refused-no-license` 记账，本轮记录里**没有**对应行。
2. **给「取 release 形态读数」一个不与 AC-271 争用共享 refs 的载体**：把这类读数放进**隔离的 Git 目录**（scratch clone，或 `git init` + 把目标提交 fetch 进去 + **在沙箱里** `git branch release/...`），使读数仍是**真实 Git 对象上的真实运行**（DIR-026 Reading A），但**不进入主检出被判据枚举的 `refs/heads/release-*` / `refs/heads/release/*`**。
   - ✅ 这条路的可行性**已在立案当轮核实**：`scripts/resolve-version.ts` 的 CLI 本来就支持 `--root <dir>`，且文档写明「`build` reads `git symbolic-ref`/`git tag` **FROM HERE**」⇒ **沙箱化不需要改 `resolve-version.ts`**。
   - 载体必须是**命令**（可被任务体逐字调用、有退出码、有 CAUSE），不是 SPEC/skill 措辞——措辞正是本轮红掉的原因（ADR-004）。
   - ⛔ 沙箱必须自清理；⛔ 不得在共享 `.git` 里留下 `refs/heads/release/*`、stash、或 `FETCH_HEAD` 之外的可疑状态。
3. **让「某次 release 形态读数发生过」可查（硬规则 9）**：记录里能读出**分支名 / 时刻 / 结果**；且「从未发生」必须有**独立取值**（独立退出码 + 独立 `CAUSE=`），**不与「发生但没记」共用输出**（硬规则 3b）。⛔ 命名不得复用既有 `form=` 词表（硬规则 8：编号/命名不得复用）。
4. **两条负控制（硬规则 4c：落笔当轮当场干跑一次，两次读数都贴）**：
   - **① 判据未被放宽**：在主检出造一条 tip 既不在 develop、也不在任何 tag 的 `release/v0.0.0-nc271b` ⇒ `node packages/quay/bin/quay.js goal gate AC-271` 必须 **`verdict=fail`** + 同一 `CAUSE=release-branch-not-parked-on-a-tag` 且**列出该分支名**；**同一动作序列内**删除后再跑 ⇒ 必须 **`verdict=pass`**。⛔ 临时分支同轮删掉、⛔ 不得留残留。
   - **② 读数是真读数不是回声（硬规则 4 推论三）**：在隔离载体上，对**非** `release/*` 分支取同一读数 ⇒ 必须给带后缀的 `X.Y.Z-dev`；对 `release/*` 分支取 ⇒ 必须给**无后缀** `X.Y.Z`。**两次读数都贴**——只贴后者的话，一个恒定返回 `X.Y.Z` 的实现也能通过，那正是「回声」。
5. **登记与测试**：本轮若新增 `plugin/scripts/*` 脚本，按 `plugin/scripts/capability-catalog.sh` **头部自述的规则**补齐它要求的表项（声明数据半边在 `plugin/scripts/capability-catalog-declarations.json`，⛔ 不照抄任何清单）；行为变更必须有测试进入套件泳道（`plugin/test/` 下新文件或扩既有文件）；本轮新增的每个文件**同轮**写进本任务 `## Touches`。
6. **落点同步**：`orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` 中凡要求「在真实 release 分支上取读数」的步骤，按当轮读数指向新载体；并如实把本轮 `04:51:07Z`–`04:53:26Z` 的创建/销毁记为**无仓库痕迹**（⛔ 不写成「已由命令处理」）。⛔ 只改 SPEC 措辞**不算**本任务的载体（载体是第 2 步的命令）。

## Acceptance Criteria

- [x] **AC1 现状取证 + 归因诚实**：贴出（a）`.quay/gate-events.jsonl` 里 `2026-09-20T04:52:49.353Z` 那条 fail 的原文（含完整 `CAUSE=` 与分支名）；（b）`meta-cc query_session_content --role tool --session_id c543788e-52ea-4e2f-917a-8bc89399a001 --contains ac4-reading` 读出的**创建**（`04:51:07.365Z`）与**销毁**（`04:53:26.422Z`）两条命令原文；（c）红窗两端读数：`git rev-parse release/ac4-reading` 现为 `fatal: … unknown revision`（EXIT=128）、`git rev-parse df538caa6` 仍可解析、`git merge-base --is-ancestor df538caa6 develop` = NO；（d）两处无痕读数：`.quay/release-branch-finish.jsonl` 末条 = `2026-09-19T03:52:55Z`（本轮零记录）、`ls .git/logs/refs/heads/release/` → No such file or directory。⛔ **不得**声称这两条命令经由 `release-branch-finish.sh`；⛔ 不得把「观测到违规态两次」写成「判据 fail 两次」。
      ⇒ **读数**（全文见 worktree 内 `.quay/ac271-evidence-ac1.txt`）：(a) 台账原文含 `"verdict":"fail"` + 完整 `CAUSE=release-branch-not-parked-on-a-tag — 1 of 1 release branches have a tip that is not any tag: release/ac4-reading`；(b) meta-cc 逐字读出 `04:51:07.365Z`（`git worktree add …/ac-stamp-release-reading -b release/ac4-reading HEAD`）与 `04:53:26.422Z`（`cd /home/yale/work/quay && git worktree remove --force …/ac-stamp-release-reading && git branch -D release/ac4-reading`）——⛔ 两条**都不是** `release-branch-finish.sh`，本轮该记录里没有 `result=deleted-local` 行；(c) `git rev-parse release/ac4-reading` → `fatal: ambiguous argument … unknown revision` **EXIT=128**；`git rev-parse df538caa6` → `df538caa6886f105f49412fcdf184203e862ca9e` **EXIT=0**；`git merge-base --is-ancestor df538caa6 develop` → **EXIT=1（NO）**；(d) `tail -1 .quay/release-branch-finish.jsonl` = `{"ts":"2026-09-19T03:52:55Z", …, "result":"refused-no-license", …}`；`ls .git/logs/refs/heads/release/` → `No such file or directory`。⛔ 本任务台账里 2026-09-20 的 AC-271 fail 读数**只有 1 条**（04:52:49.353Z），未把「观测到违规态」写成「判据 fail」。
- [x] **AC2 隔离载体落地（读数不再争用共享 refs）**：贴出新的读命令在**真实仓库**上的实跑：命令 + 退出码 + 输出。判据三条**同时**成立：（i）跑之前与跑之后，主检出 `git for-each-ref --format='%(refname:short)' refs/heads/release-* 'refs/heads/release/*'` **都为空**（贴两次读数）；（ii）读数**确实返回了无后缀形态**（证明读数是真的，不是空转）；（iii）沙箱自清理（跑完后其路径不存在，`git worktree list` 无新增条目）。
      ⇒ **读数**（全文见 `.quay/ac271-evidence-reading.txt`，源仓库 = 主检出 `/home/yale/work/quay`，工具取自本任务 worktree）：`node --experimental-strip-types <wt>/plugin/scripts/release-reading-sandbox.ts --root /home/yale/work/quay --branch release/v0.0.0-read271` → **EXIT=0**，输出 `source release refs BEFORE = 0` / `sandbox=/tmp/release-reading-sandbox-uRQPJa (isolated git dir; the source repo holds no ref of it)` / `branch=release/v0.0.0-read271 sha=a84d36797d19… shape=release-branch` / **`version=0.10.0`（无后缀）** / `source release refs AFTER = 0` / `sandbox removed`。(i) 跑前与跑后的 `git for-each-ref … refs/heads/release-* refs/heads/release/*` **两次都为空**（EXIT=0，无输出）。(iii) `ls -d /tmp/release-reading-sandbox-*` → `No such file or directory`；`git worktree list` 中 `grep -c release-reading-sandbox` = **0**。
- [x] **AC3 痕迹可查 + 「从未发生」独立取值**：贴出一条命令，能从痕迹载体里读出**某次** release 形态读数发生过（含分支名/时刻/结果）；并贴出「从未发生」时的读数，证明它是**独立退出码 + 独立 `CAUSE=`**，⛔ 不与「发生但没记」共用输出（硬规则 3b）。⛔ 新增的记录词表不得复用既有 `form=` 取值（硬规则 8）。
      ⇒ **读数**：`--log` → `2026-09-20T05:16:13.328Z  release/v0.0.0-read271  shape=release-branch  version=0.10.0  result=taken  sha=a84d36797d19  exit=0` / `2026-09-20T05:16:43.399Z  reading-plain-271b  shape=non-release-branch  version=0.10.0-dev  result=taken  sha=a84d36797d19  exit=0` / `trace: 2 record(s) in /home/yale/work/quay/.quay/release-reading-sandbox.jsonl`，**EXIT=0**（分支名 / 时刻 / 结果齐全）。「从未发生」：`--log --trace /tmp/ac271-never-existed.jsonl` → **EXIT=4** + `CAUSE=release-reading-trace-missing`（独立退出码 + 独立 CAUSE，且不打印 `trace: 0 record(s)`）；第三种态「读不出」→ **EXIT=5** + `CAUSE=release-reading-trace-unreadable`。**词表**：键为 `shape=` ∈ {`release-branch`, `non-release-branch`}、`result=` ∈ {`taken`, `not-evaluated`, `reading-error`}，⛔ 记录里**没有 `form=` 键**（既有 `form=` 词表是 `none`/`merged`/`tagged`/`cut`，属 `.quay/release-branch-finish.jsonl`）——由测试 `the record's vocabulary does not re-use the finish record's form= word or values` 机械把守。
- [x] **AC4 判据未被放宽（负控制 ①，真实仓库）**：在同一动作序列内：（i）造 `release/v0.0.0-nc271b`（tip 既不在 develop 也不在任何 tag）⇒ `node packages/quay/bin/quay.js goal gate AC-271` → **`verdict=fail`**、`EXIT=1`、`CAUSE=release-branch-not-parked-on-a-tag`、**输出里含该分支名**（两次读数都贴）；（ii）删除该分支后同命令 → **`verdict=pass`**、`EXIT=0`。⛔ 临时分支必须同轮删除，末尾贴 `refs/heads/release-*`/`release/*` 枚举 = 空。
      ⇒ **读数**（同一动作序列 `05:16:52Z`–`05:16:54Z`，全文见 `.quay/ac271-evidence-ac4.txt`）：tip 用 `df538caa6`（`git tag --points-at df538caa6` 空、`merge-base --is-ancestor df538caa6 develop` 非 0）。(i) `git branch release/v0.0.0-nc271b df538caa6` → `goal gate AC-271` → **`"verdict": "fail"`、EXIT=1**，`reason` 含 `CAUSE=release-branch-not-parked-on-a-tag — 1 of 1 release branches … : **release/v0.0.0-nc271b**`（点名了）。(ii) 同序列 `git branch -D release/v0.0.0-nc271b`（`Deleted branch … (was df538caa6)`）→ 同命令 → **`"verdict": "pass"`、EXIT=0**。末尾枚举 `for-each-ref … release-*` / `branch --list` 均**空**，`git rev-parse --verify --quiet refs/heads/release/v0.0.0-nc271b` → **EXIT=1**。⇒ 判据一字未改、且仍能取假。
- [x] **AC5 读数是真读数不是回声（负控制 ②，硬规则 4 推论三）**：在隔离载体上贴**成对**读数——同一个命令对**非** `release/*` 分支给 `X.Y.Z-dev`（带后缀）、对 `release/*` 分支给 `X.Y.Z`（无后缀），两条都贴。⇒ 证明该读数**按分支名取假**，不是恒定返回同一个值的回声。
      ⇒ **读数**（**同一条命令**，只换 `--branch`，同一 `sha=a84d36797d19…`）：`--branch release/v0.0.0-read271` → `version=0.10.0`（无后缀，`reason: branch release/v0.0.0-read271 is a release branch`）**EXIT=0**；`--branch reading-plain-271b` → **`version=0.10.0-dev`**（`reason: branch reading-plain-271b is not a release branch and HEAD carries no version tag`）**EXIT=0**。两条都贴（见 `.quay/ac271-evidence-reading.txt`）⇒ 该读数**按分支名取假**；只贴前一条的话，一个恒定返回 `0.10.0` 的实现也能通过。
- [x] **AC6 登记与套件**：若本轮新增脚本：`bash plugin/scripts/capability-catalog.sh --json` → `EXIT=0` 且 `unclassified: 0`，并贴出该脚本在 catalog 里的那一行；`bash scripts/test.sh --for-task gap-ac271-build-reading-creates-shared-release-ref --allow-thin` → `EXIT=0` 且选择集**含**本轮新增/修改的测试文件（⛔ 在 worktree 里直接 `node --test` 不算证据）。⛔ 若未新增脚本，贴出为何不需要（并说明测试落在哪个既有文件里）。
      ⇒ **读数**：`bash plugin/scripts/capability-catalog.sh --json` → **EXIT=0**，`capability-catalog: 347 scripts | 347 declared | **0 unclassified** | 342 ship`；本任务新脚本在 catalog 里的那一行 = `{"file": "release-reading-sandbox.ts", "ships": true, "cadence": "按需", "last_reaffirmed": "2026-09-20", "matching": "keyword"}`（六表齐备，`CONSUMER` 也已补，`rhythm-consumer-check --check` exit 0；`--entry-surface` PASS）。`bash scripts/test.sh --for-task gap-ac271-build-reading-creates-shared-release-ref --allow-thin` → **EXIT=0**，选择集第 235 行 `+ plugin/test/release-reading-sandbox.test.mjs`，尾部 `tests 12 / pass 12 / fail 0`。⚠️ **形态说明**：本轮新增脚本落在 `plugin/scripts/release-reading-sandbox.ts`（⛔ 不是原 Touches 写的 `.sh`）——`.sh` 一调 `node --experimental-strip-types` 就把 `sh-census-check` 的 `embeddedInterpreterLines` 棘轮从基线 9505 抬高（该轴只降不升），而本任务要的载体判据是「命令 + 退出码 + CAUSE」而非扩展名；`## Touches` 已按**实际文件名**更新（硬规则 8/9：Touches 是声明，不能与实际写入的文件名不一致）。
- [x] **AC7 落点同步 + 无痕如实记录**：贴出 `orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` 里被改动的段落（改动前后各贴关键行），并确认其中把 `04:51:07Z`–`04:53:26Z` 这次创建/销毁记为**无仓库痕迹、成因由 worker transcript 可查但仓库产物不可查**。
      ⇒ **读数**：`git diff develop -- orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` —— **改动前**：§4.1.1 ③ 的末行是 `` `release-*` / `release/*` 只存在于本地，任何远端侧载体（例如 release workflow 里加一个 job）**在结构上够不到这些 ref**。 ``，其后直接是 `### 4.2 切点前置…`（**当时没有任何「取读数」的载体段落**）；**改动后**：新增 `#### 4.1.2 「取 release 形态读数」的载体：**隔离 Git 目录**（2026-09-20）`（第 395 行起），含 `⛔ **这两次创建与销毁在仓库里零痕迹**`（418 行）、`⇒ **成因只能由 worker transcript 可查，仓库产物不可查**`（422 行）、`⛔ 不得写成「已由命令处理」`，且明确 ⛔ 不是 `release-branch-finish.sh`；§10 新增 `**追加执行状态（2026-09-20）**`（736 行），如实记 `04:51:07.365Z`–`04:53:26.422Z` 与 `05:00:52.101Z`–`05:01:16.474Z` **在仓库产物里零痕迹**、⛔ 不计入任何任务的成果。全文见 `.quay/ac271-evidence-ac6-ac7.txt`。

## Definition of Done

- [x] **合法验证动作不再能击穿 AC-271 的保证**：在隔离载体上取一次真实 build 模式读数的**全程**，主检出的 `refs/heads/release-*` / `refs/heads/release/*` 枚举**保持为空**（AC2 前后两次读数），而读数**确实**给出了无后缀形态（AC2 ii）——两件事**同一次运行**里自证。
      ⇒ **读数**：AC2 那一次运行**自己**打印了 `source release refs BEFORE = 0` 与 `source release refs AFTER = 0`，同时打印 `version=0.10.0`（无后缀）⇒ 两件事同一次运行自证。
- [x] **判据保持严格、且能取假**（AC4/AC5）：违规分支存在时判据 exit 1 并点名，删除后 exit 0；隔离读数按分支名取假（非 release 分支给 `-dev`）。⛔ 只贴一次 exit 0 不算（硬规则 3b/4）。
      ⇒ **读数**：AC4 同一序列 fail(EXIT=1，点名 `release/v0.0.0-nc271b`) → pass(EXIT=0)；AC5 成对 `0.10.0` / `0.10.0-dev`。两组都是**双读数**。
- [x] **可归因**（AC3）：某次 release 形态读数发生过 ⇒ 能从痕迹载体读出分支名/时刻/结果；「从未发生」是独立取值，不与「发生但没记」同形。
      ⇒ **读数**：`--log` EXIT=0 且逐行给出 `ts / branch / shape / version / result / sha / exit`；`--log` 对不存在的记录 EXIT=4 + `CAUSE=release-reading-trace-missing`；对读不出的记录 EXIT=5 + `CAUSE=release-reading-trace-unreadable`。三态各自独立。
- [x] 上面的判据按 `inherited-core` 的 REAL LANDING 口径执行（DIR-026 Reading A）：在**真实仓库 / 真实 Git 对象**上真的穿过了机制——一次真实隔离读数、一次真实判据红→绿、一对真实成对读数。⛔ 不是只写脚本 / 只写测试 / 只改 SPEC / 只留 fixture。
      ⇒ **读数**：真实仓库 = 主检出 `/home/yale/work/quay`；真实 Git 对象 = `a84d36797d19…`（隔离读数）与 `df538caa6`（判据负控制，一个**不被任何 tag 引用、也不在任何分支上**的提交）；判据红→绿在**同一动作序列**内（05:16:52Z–05:16:54Z）完成；成对读数两次都真实跑出（EXIT=0）。
- [x] ⛔ **不把 2026-09-20T04:53:26Z 那次清理记成本任务的成果**：它发生在立案之前、由 worker 自己完成；本任务的证据全部取自立案后**由本任务自己造并自己清理**的 ref 与沙箱。
      ⇒ 本任务自造的 ref = `release/v0.0.0-nc271b`（AC4，同轮 `git branch -D` 删净，末尾枚举空）；自造的沙箱 = `/tmp/release-reading-sandbox-uRQPJa` 与 `-UTk6Na`（AC2，跑完即被自身删除，`ls -d` 已无）。`04:51–04:53` 那次只作**取证对象**，⛔ 未记为本任务成果。

## Touches

- plugin/scripts/release-reading-sandbox.ts
- plugin/test/release-reading-sandbox.test.mjs
- plugin/scripts/capability-catalog-declarations.json
- orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md
- tasks/gap-ac271-build-reading-creates-shared-release-ref.md

<!-- dedup-ref -->
同族但机制不同，故不是重复：`gap-ac271-release-branch-outlives-its-tag-again`（`goal_ac: AC-271`，done 2026-09-19）交付的是**销毁半边**（`release-branch-finish.sh` + `--cut` 落地步 + `--log` 痕迹），其 Finding 与 Touches 全篇未涉及**创建侧**；`gap-release-branch-deleted-after-merge`（`goal_ac: AC-271`，done）建的是判据本身，本轮判据抓对了。本任务补的是两者都未覆盖的那半边：**为取 build 读数而合法创建 release 分支**这一动作与 AC-271 的结构冲突，以及它留下的无痕。
