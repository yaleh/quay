---
id: gap-ac194-production-criterion-owner
title: "AC-194 结构判定缺钉子——测试只钉旧拼法（: storing ref），改回白名单不会有任何测试变红"
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-suite-ambient-reds-block-all-code-landings
  - gap-superseded-dependency-blocks-dispatch-forever
goal_ac: AC-194
---
**type:** execution

## Proposal

**本条已收窄（2026-09-24，manager 层裁定）。** 立案时的前提（AC-194 判据 `EXIT=1`、`unclassifiableCommits:2`）
**已被他任务满足**，剩下的唯一活口是「缺钉子」。

**此刻的生产读数（逐字重跑，生产 root HEAD `993859ea`，2026-09-24T02:40:27Z）**：

    EXIT=0
    evaluated=true   ok=true   reasonSecondary=null
    unclassifiableCommits=0
    classification: 100/100 (ratio 1)
    denominator.totalDirectCommits=0
    candidates.length=0

`.quay/gate-events.jsonl` 的 AC-194 goal-sweep 尾条亦为 `verdict=pass`
（2026-09-23T17:50:01.644Z，`criterionHash=d3eb8d7a6165b156`）。

**前置由谁满足（⛔ 本条不重做那部分）**：`gap-suite-ambient-reds-block-all-code-landings`（done）的"第 4 类"
已按**结构**修好分类器——原文见 `plugin/scripts/direct-to-develop-bypass-check.ts:479` 起：任何以 `fetch`
开头的 reflog action 都必然是一次 ref-level 移动（git-fetch 在本地从不创建 commit），与 status 后缀无关。
立案当轮探针实测（6 个变体，含**从未在任何名单里出现过**的后缀）：

| `%gs` 输入 | `classifyReflogAction` |
|---|---|
| `fetch -q . author:develop: fast-forward` | `refMove` |
| `fetch -q --force . some-branch:develop: forced-update` | `refMove` |
| `fetch -q . totally-novel-branch-i-have-never-seen:develop: pruned` | `refMove` |
| `fetch -q . x:develop: some-future-suffix-nobody-enumerated` | `refMove` |
| `commit: fix something` | `direct`（负控成立） |

⇒ 原 AC3（生产真值）、AC4（台账翻转）、AC6 的**实现侧**均已满足。

**剩下的真缺口是「钉子」**：`plugin/test/direct-to-develop-bypass-check.test.mjs` 对 fetch **只有 1 条断言**
（`:1017`），且用的是**旧拼法** `: storing ref`。也就是说——**把结构判定改回白名单，不会有任何测试变红。**
这正是本任务要防的"第 6 次"，而它此刻**没有载体**（硬规则 9：可见性 ≠ 执行，该给它造产物）。

⛔ 本条**不再**新增任何字符串白名单；⛔ 不重做分类器实现（已由他任务完成）。

## AC

- [x] AC1（现状固化·生产载体）在生产 root 逐字重跑 AC-194 判据 ⇒ `exit 0`，贴 `evaluated` /
      `unclassifiableCommits` / `classification.ratio` / `denominator.totalDirectCommits` / `candidates.length`
      五个字段读数；并附 `.quay/gate-events.jsonl` 中 AC-194 的 goal-sweep 尾条原文与时间戳
- [x] AC2（前置归属·引用不重做）贴 `plugin/scripts/direct-to-develop-bypass-check.ts:479` 起的结构判定注释原文，
      点名 `gap-suite-ambient-reds-block-all-code-landings` 为其落点；证明本条**零实现改动**
- [x] AC3（**钉子**·本条核心）在 `plugin/test/direct-to-develop-bypass-check.test.mjs` 增加断言，至少钉住：
      （a）生产真实形态 `fetch -q . author:develop: fast-forward` ⇒ `refMove`；
      （b）≥1 个**任何名单里都没有**的后缀（如 `pruned`）⇒ `refMove`。
      **并做一次变异检验**：把 `classifyReflogAction` 的 fetch 分支临时改回 `&& /: storing ref\s*$/.test(s)`
      ⇒ 新断言**必须变红**（贴红/绿两次读数 + 恢复后的 `git diff --stat` 为空）。⛔ 只加一条与 `:1017` 同形的
      拼法断言 ⇒ 本 AC 取假
- [x] AC4（负控制·判据不是恒真）在**一次性 scratch clone**（⛔ 不在真 develop 上注入）的窗口内
      注入一次 `commit:` 形态的 code-surface 直投 ⇒ 同一 checker `exit 1`；贴读数与恢复步骤
- [x] AC5（防第 6 次·结构余量）列出实测到的 fetch 后缀词表，并证明一个**不在该词表内**的后缀仍归类 `refMove`
      （即判定与词表无关）；贴分类输出原文
- [x] AC6（本任务自身的门）`bash scripts/test.sh --for-task gap-ac194-production-criterion-owner` 绿

## DoD

真实落地：**钉子存在且可证伪**——AC3 的变异检验里把结构判定改回白名单后**新断言变红**（这是"测得出来"的
唯一证据；硬规则 4 推论三：一个**改回旧实现也不变红**的测试不是钉子，只是回声）。且生产 root 上 AC-194 判据
保持 `exit 0`（AC1），且负控仍能取假（AC4）。只把测试条数刷高、或新增一条与 `:1017` 同形的拼法断言 ⇒ 不算完成；
把分类器实现重做一遍（已由他任务完成）⇒ 也不算完成。

## Evidence

全部原始读数在 `.quay/ac194-owner/`（主检出，未跟踪）。落地物 = `plugin/test/direct-to-develop-bypass-check.test.mjs`
的新增 3 个测试（113 行）；分类器实现**零改动**。

**AC1（生产载体·逐字重跑）** 2026-09-24T04:25:09Z，生产 root `/data/home/yale/work/quay`（HEAD = develop = `9a069f0ff`）：

    EXIT=0
    evaluated=true   ok=true   reason=no-direct-commits-in-range   reasonSecondary=null
    unclassifiableCommits=0
    classification: 100/100   (ratio 1)
    denominator.totalDirectCommits=0
    candidates.length=0
    classification.unclassifiedActionForms=[]

`.quay/gate-events.jsonl` 的 AC-194 goal-sweep 尾条（该文件共 222 条 AC-194 事件）：

    {"id":"c60661ec-9ef1-465f-8d3b-e2f2c0f0b8f2","item_id":"AC-194","pipeline_id":"AC-194","gate":"goal",
     "actor":"goal-sweep","verdict":"pass","timestamp":"2026-09-23T17:50:01.644Z",
     "payload":{"reason":"acceptance passed (exit 0)","criterionHash":"d3eb8d7a6165b156"}}

（`ac1-production-criterion.txt`）

**AC2（落点 + 零实现改动）** `:479` 起结构判定注释逐字原文 + 落点见 `ac2-landing-and-zero-change.txt`：
落点 = `gap-suite-ambient-reds-block-all-code-landings`（注释 `:481` 逐字点名其为"第 4 类"缺陷的落点；
该文件对应的落地提交为 `57138e535`）。零改动硬证据（blob 逐字同一）：

    worktree 盘上 hash-object = HEAD:blob = develop:blob = 12071aae48494988f69826c2dc66f86b106e8b82
    本条分支相对 develop 的该路径 diff 行数 = 0

**AC3（钉子 + 变异检验）** 新增 3 个测试（1 PURE + 2 CLI 级）。绿：`tests 61 / pass 61 / fail 0`
（`ac3-green-full.txt`、`ac3-restored-green.txt`）。变异检验——把 fetch 分支临时改回
`if (/^fetch\b/.test(s) && /: storing ref\s*$/.test(s)) return "refMove";` ⇒ **`tests 61 / pass 57 / fail 4`**，
3 条新测试全部变红（`ac3-mutation-red.txt`）：

    ✖ PURE classifyReflogAction — fetch 形按结构判定（钉子）
        AssertionError: 生产形态 ⇒ refMove …      actual: 'unknown'   expected: 'refMove'
    ✖ AC3 CLI — 生产形态 `git fetch -q . author:develop` 的真实 reflog 落地
        reason: "unsupported-reflog-action: fetch -q . author:develop"
        reasonSecondary: "unclassifiable-commits-in-range"
    ✖ AC5 CLI — 词表外 fetch 后缀（`pruned`）落在真实 reflog 行
        reason: "unsupported-reflog-action: fetch -q . author:develop"
    （第 4 条红是既有的「全量扫描（生产基线 b11ce720）」用例——它同样钉住该 fetch 形，同源放大）

即变异**精确复现了生产故障签名** `unsupported-reflog-action: fetch -q . author:develop` + `unclassifiable-commits-in-range`。
恢复：`git checkout -- plugin/scripts/direct-to-develop-bypass-check.ts` ⇒ 61 pass / 0 fail；
恢复后 `git diff --stat` **字节数 = 0**（空）。⇒ 钉子**可证伪**，不是回声。

**AC4（负控·一次性 scratch clone）** `ac4-scratch-clone.txt`：`git clone --shared --branch develop --single-branch`
到 `/data/scratch/yale/…`（同设备；⛔ 不在真 develop 上注入），在 clone 内真实 `commit` 一个 code-surface 文件
（`plugin/test/ac194-scratch-direct.test.mjs`，其 reflog action 形为 `commit:`），随后用**同一 checker**
（生产路径 `plugin/scripts/direct-to-develop-bypass-check.ts`，未改动）在 1-commit 窗口 `--baseline <注入前 tip>` 判定：

    EXIT=1
    evaluated=true   ok=false   reason=direct-commit-bypasses-fan-in
    denominator: totalDirectCommits=1  codeSurfaceCommits=1
    lockWindow: evaluated=true  reason="no-lock-events (vacuous: no lock holds)"
    candidates[0]: codeSurfaceFiles=["plugin/test/ac194-scratch-direct.test.mjs"]  confirmedBypass=true

恢复步骤（脚本内已执行并核实）：`rm -rf` 该 clone；真 develop tip 与注入前**逐字相同**；
真 develop reflog 无该注入；真工作树无该文件。⇒ 判据能取假。

⚠️ **诚实披露本轮的真实事故（AC4 第一次尝试）**：首次尝试 `git clone --local … /tmp/…`，
因 `/tmp` 与 `/data` **跨设备**而失败（`Invalid cross-device link`），且脚本无 `set -e`、用 `cd` 而非 `git -C`
⇒ 后续 `git add -A` + `git commit` **落进了共享主检出**，产出提交 `288c425b3`（697 files），
并被 live driver 在**同一秒** `push` 进 **develop**（`develop@{0}|288c425b3|push|12:23:35`）。
**已完整恢复**：`git reset --soft HEAD~1` + `git reset` 还原 author/索引/工作树（工作树文件一个未删），
`git update-ref -m "recover: …" refs/heads/develop 9a069f0ff…` 把 develop 还原**并留痕于其 reflog**；
核实：0 个 ref 指向该提交、全部 worktree 无一含它（含在飞 peer worktree）、AC-194 判据复跑 exit 0、
`git status` 无 `M`/`A`/`D`。完整复盘：`INCIDENT-shared-checkout-leak.md`。**AC4 的正式读数取自重做版**（上方）。

**AC5（词表 + 判定与词表无关）** `ac5-fetch-suffix-vocabulary.txt`。探针仓库实测（git 2.43.0）产出 **4** 种后缀：

    fetch -q <r> <src>:<已存在 ref>: fast-forward      （ff 落地，= 生产形态）
    fetch -q --force <r> <src>:<已存在 ref>: forced-update
    fetch -q <r> <src>:refs/heads/<b>: storing head
    fetch -q <r> <sha>:refs/heads/<b>: storing ref

`pruned` 实测**不在**词表内：`git fetch --prune` 删除 ref 时其 reflog 一并消失，`.git/logs` 下含 `pruned` 的行数 = 0。
分类输出（逐字；词表外后缀仍 refMove ⇒ 判定与词表无关）：

    refMove  ← 生产真实形态（develop reflog develop@{225} 逐字）  : fetch -q . author:develop: fast-forward
    refMove  ← 词表外 1（实测不在词表）                        : fetch -q . author:develop: pruned
    refMove  ← 词表外 2（人为编造的后缀）                      : fetch -q . author:develop: suffix-nobody-enumerated
    direct   ← 负控：commit 形                              : commit: direct
    unknown  ← 负控：非 action 词（`\b` 边界）                : fetching: nope

词表外后缀在**真实 reflog 行**上仍 refMove 也已被 CLI 测试钉住（`AC5 CLI — 词表外 fetch 后缀`）。

**AC6（本任务自身的门）** `bash scripts/test.sh --for-task gap-ac194-production-criterion-owner --allow-thin`
（worktree 根，`LC_ALL=C.UTF-8 LANG=C.UTF-8 TZ=UTC`）⇒ `EXIT=0`，scoped static checks 全 PASS，
`tests 61 / pass 61 / fail 0 / duration_ms ≈ 42–48s`（`ac6-scoped-gate.txt`）。

## Touches

- plugin/test/direct-to-develop-bypass-check.test.mjs
- plugin/scripts/direct-to-develop-bypass-check.ts
- tasks/gap-ac194-production-criterion-owner.md