---
id: gap-ci-red-attribution-classifier
title: CI 红有机械归因：落地 plugin/scripts/ci-red-attribute.ts 并把 attribution 写进
  .quay/ci-runs.jsonl 的每条失败记录（AC-269）
status: ready
labels:
  - gap
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-269
---
**type:** execution

## Finding

**缺口（立案实测 2026-09-15，两条直接量）**：

```
$ ls plugin/scripts/ci-red-attribute.ts   → No such file or directory
$ ls .quay/ci-runs.jsonl                  → No such file or directory
```

AC-269 的判据（全文见 `goals/AC-269-goal.md` 的 `criterion:` 块）要求三件事同时成立：
①`plugin/scripts/ci-red-attribute.ts` 有落地提交（`git log -1 --format=%cI -- <该文件>` 非空）；
②载体 `.quay/ci-runs.jsonl` 中存在 `ts` 晚于该提交时刻的记录（证明采集在跑，不是「没有失败所以看起来没事」）；
③这些记录里每一条 `conclusion=failure` 都带 `attribution ∈ {real-defect, infrastructure, known-flake}`。
落地后有记录但无 failure ⇒ exit 0（合法空态，不是静默空过）。

**动因（AC-269 的 origin，逐字）**：为给一批 CI 红定性（真缺陷 / job 超时截断 / 已知负载 flake 三类混在一起），
需要人肉读 15684 行日志并跨 4 次 run 比对失败集合。无机械归因则每次红都要重复这个成本，持续驱动无法成立。

**为什么现在做不了（结构与依赖）**：
- 载体的既有字段口径（`ts` / `branch` / `workflow` / `conclusion` / `runId` / `testFiles` / `timedOut` / `durationSec`，
  见 AC-265/266/267/268 判据读到的字段集）全部是**运行级可直接观测的量**，没有一个字段回答「这条红是什么性质」——
  本任务造的就是这个字段。
- **判据读的是载体的失败记录本身**，不是一份旁路分类报告 ⇒ 归因必须发生在**写面**（记录落盘时就带 `attribution`）。
  另写一份报告、或事后往载体追加一条新记录，都无法满足判据（原记录仍是 `conclusion=failure` 且无 `attribution`）。
- **落地点是归因器文件的最后一次提交时刻** ⇒ 归因器与「写面接入」若分两次提交，
  两次提交之间落盘的失败记录会落在窗口内却没有 `attribution` ⇒ 判据红。故本任务要求二者**同一次提交**。
- **写面本身是 AC-265 的产出**（`plugin/scripts/ci-runs-collect.ts`）：载体的生产者不由本任务新造，
  本任务只在它的写路径上接一处归因；它尚不存在时按 Requested action 第 4 条办（同一个路径，不造第二个）。

**归因器必须可证伪（否则就是一个恒值）**：若归因器对任何输入都返回同一个取值，
判据在「窗口内全是 failure」时会照样 exit 0，但它什么也没区分——这正是硬规则 4 说的「一个结构上不可能取假的量」。
故本任务的验收核心是**单变量对照**（AC2）：同一条失败记录只翻转一个客观信号，`attribution` 必须改判。

## Requested action

1. **落地 `plugin/scripts/ci-red-attribute.ts`**：一个纯函数归因器，入参是一条载体记录（可选带上该 run 的 job 级读数），
   出参 `{ attribution, signals }`。`attribution` 的取值**只能是**三元词表之一；`signals` 是非空字符串数组，
   写明是哪几条客观信号定的性。判定全部取自记录的**客观字段**，不做日志文本关键词匹配。
   判定次序（外部原因 → 已知 flake → 兜底）：
   - `infrastructure`——红发生在被测对象**之外**：`timedOut === true`；或 `durationSec` 达到该 job 的 `timeout-minutes`；
     或 job 级 `conclusion === "cancelled"`；或失败集中在 setup 步（checkout / setup-node / 依赖安装）
     而测试步从未开始（`testFiles` 缺失或为 0）。
   - `known-flake`——失败测试标识（`文件::测试名`）命中本仓已知 flake 登记表（新增 `plugin/scripts/known-flakes.json`，
     每条含测试标识 + 首次登记日期 + 指向一次性复现证据的引用）。⛔ 登记表为空就判不出 known-flake；
     不许拿「看起来像 flake」「上次也红过」当信号——那会把真缺陷洗成 flake，方向不可逆。
   - `real-defect`——**兜底默认**：没有命中任何 infra / flake 信号时记为真缺陷。
     理由：把真缺陷误记为 infra/flake 会**豁免一条红**，而把 infra/flake 误记为真缺陷只是多一次人看，
     两边代价不对称 ⇒ 兜底方向取「当作真缺陷」。
   - **取值必须可区分**（硬规则 3b）：`signals` 要让「命中信号判出的 real-defect」与「无信号兜底判出的 real-defect」
     在记录里可分辨（兜底时写入形如 `default:no-signal-matched` 的标记）。一个取值同时表示这两件事，
     就等于把「读不懂」伪装成「读懂了且判为真缺陷」。
   - 附带一个 CLI 面（读单条记录做干跑 / 读整个载体做只读复核），供人与后续机件使用。
2. **把归因器接进载体的写面**：`conclusion === "failure"` 的记录在落盘时带 `attribution`；
   **非 failure 记录不写该字段**——给 success 也盖一个 `attribution` 会让「有归因」这件事失去信息量。
3. **与写面改动同一次提交落地**（理由见 Finding 第三条）：`git log -1 --format=%cI -- plugin/scripts/ci-red-attribute.ts`
   必须与写面文件的最后一次改动属于同一个提交（该文件此前从未被提交过时，它自己的首次提交就是落地点）。
4. **写面归属与顺序**：`plugin/scripts/ci-runs-collect.ts` 是 AC-265 的产出，本任务不新造第二个采集器。
   执行时：①该文件已存在 ⇒ 只在它的写路径上接一处归因（Touches 重合会让两个任务串行，这是预期）；
   ②尚不存在 ⇒ 本任务落地**这一个**写面（同一路径、字段口径照上面 Finding 列的字段集），
   并在 Evidence 里如实写明当时的顺序（哪个文件先被提交、为什么）。
5. **新脚本登记**：新增 `plugin/scripts/*.ts` 会让登记闸非零退出——按 `plugin/scripts/capability-catalog.sh`
   头注释的要求补齐它的登记行（形状与另几张表的正本在该脚本内，⛔ 不在此处复制），
   并在 `plugin/test/` 下补一个测试文件。
6. **5b 扫描（修完贴数）**：归因器只在写面接一处是不够的——全仓搜载体路径的写入口
   （`appendFile` / `writeFile` / `>>` 重定向 / 采集器的所有落盘分支），把命中数与前 3 条逐条贴出；
   每个写口要么过归因器，要么在 Evidence 里写明它写不出 `conclusion=failure` 的理由。
   ⛔ 不留一个能绕过归因的写口。

## Acceptance Criteria

- [x] AC1（判据主体，能取假）：`plugin/scripts/ci-red-attribute.ts` 存在，且 `git log -1 --format=%cI -- plugin/scripts/ci-red-attribute.ts` 非空。表驱动单测证明它是**总函数**：至少三条 fixture 分别判出 `real-defect` / `infrastructure` / `known-flake`，并打印每条的 `attribution` 与 `signals`；一条无任何信号的 fixture 判 `real-defect` 且 `signals` 含兜底标记。⛔ 立案基线：文件不存在（`ls` 报 No such file or directory）。
- [x] AC2（可证伪性 / 单变量对照，本任务核心）：对同一条失败记录**只翻转一个客观信号**（例如 `timedOut: false → true`，其余字段逐字不变），`attribution` 必须改判（`real-defect → infrastructure`）；两次读数（输入记录 + 输出 `attribution`/`signals`）逐字贴出。一个恒返回同一取值的「归因器」在这个对照下必然暴露。
- [x] AC3（写面接入，判据的直接量）：跑一次真实采集（或等一轮采集）后，`.quay/ci-runs.jsonl` 中**每一条** `conclusion=failure` 的记录都带 `attribution ∈ {real-defect, infrastructure, known-flake}`。并把 **AC-269 判据本身**逐字跑一遍（代码在 `goals/AC-269-goal.md` 的 `criterion:` 块内），贴出 exit code 与 stdout/stderr 全文。⚠️ 窗口内没有任何 failure 记录时，判据按设计 exit 0——此时必须**额外**在同一个真实写函数上造一次失败记录（⛔ 不是手工往载体里塞一行），证明写面确实会写 `attribution`；「空态 exit 0」与「写面会写归因」两条证据缺一不可。
- [x] AC4（采集活性，非静默空过）：载体中存在 `ts` 晚于归因器落地提交的记录（判据里的 `post` 非空）；打印 `post` 的条数与最早/最晚 `ts`。⛔ 只报「判据 exit 0」而不报这个条数，区分不了「没有红所以没事」与「采集根本没跑」。
- [x] AC5（5b 扫描，先数再改）：全仓搜载体路径的写入口，命中数与前 3 条逐条贴出；每个写口的处置（过归因 / 写不出 failure 的理由）逐条列出。
- [x] AC6（scoped 门）：`bash scripts/test.sh --for-task gap-ci-red-attribution-classifier` 绿。

## Definition of Done

- [x] AC1–AC6 全勾；AC2 / AC3 的读数是在本任务 worktree 上用上文逐字命令跑出来的（立案基线只作「修前」对照）。
- [x] **REAL LANDING（DIR-026 Reading A）**：交付的不是「仓库里多了一个分类函数」，而是**载体里真实落盘的失败记录带着 `attribution`**——一个真实对象穿过了机制（写面 + 归因器）；且 AC2 的单变量对照证明该机制在信号变化时会改判，不是一个恒值。
- [x] **落地窗口留痕**：贴出 `git show --stat` 证明归因器与写面接入同属一个提交，并说明理由（Finding 的窗口约束）。
- [x] **判据自跑留档 + 如实交代**：AC-269 判据的 exit code 与 stdout/stderr 全文落 `.quay/` 下一个证据文件并在本任务 Evidence 段引用；⛔ 不伪造载体记录去骗判据，也不把「窗口内无 failure」说成「归因已验证」。
- [x] 本任务按 inherited-core 的 standard 交付：Evidence 段贴出全部命令的逐字输出（含失败读数），不自述结论、不省掉反例。

## Touches

- plugin/scripts/ci-red-attribute.ts (new)
- plugin/scripts/ci-runs-collect.ts (new)
- plugin/scripts/known-flakes.json (new)
- plugin/scripts/capability-catalog.sh
- plugin/test/ci-red-attribute.test.mjs (new)
- .quay/ci-runs.jsonl (new — AC-269 判据读的载体)
- .quay/ac269-criterion-evidence.txt (new — 判据自跑留档)
- tasks/gap-ci-red-attribution-classifier.md


## Evidence

全部读数在 `/home/yale/work/quay-worktrees/gap-ci-red-attribution-classifier` 上跑出。⛔ 无手工塞进载体的行 ——
载体每一条都是 `plugin/scripts/ci-runs-collect.ts` 的真实写函数写出来的。

### 顺序交代（Requested action 第 4 条 ② 分支）

执行时 `plugin/scripts/ci-runs-collect.ts` **不存在**（`ls` → No such file or directory），故走 ② 分支：
本任务落地**这一个**写面（同一路径、字段口径按 Finding 列的字段集）。提交顺序：

| 提交 | 时刻 | 内容 | 为何这个顺序 |
|---|---|---|---|
| `a0759fcef` | `12:46:55+00:00` | `ci-red-attribute.ts` + `ci-runs-collect.ts` + `known-flakes.json` + 测试 + catalog 登记 | **同一次提交**：判据的落地点是归因器文件的最后一次提交时刻；二者分开提交，则两次提交之间落盘的失败记录会落在窗口内却没有 `attribution`（Finding 第三条）|
| `ea2601f4` | `12:49:24+00:00` | 采集器：未完成的 run 不落盘 | 只碰采集器，不动归因器 ⇒ 落地时刻不变 |
| `ce3508be7` | `12:54:29+00:00` | 归因器两处谓词修复（见 AC2 段的「真语料暴露」）| 会移动落地时刻 ⇒ 落地后**重发**一次 CI run 取新窗口 |
| `fac2b0499` | `12:58:03+00:00` | 采集器：job 日志补 `--allow-escape-sequences` | 只碰采集器 ⇒ 落地时刻不变 |
| `1149324da` | `13:00:39+00:00` | 采集器头注释 + catalog CONSUMER 行：记下「采集与提交必须成对做」 | 只碰采集器与 catalog ⇒ 落地时刻不变 |
| `8c51b43ca` | `13:07:30+00:00` | 采集器：per-job timeout 改从 run 自己的 `path` 取 | 只碰采集器 ⇒ 落地时刻不变 |
| `18ff03567` | `13:08:52+00:00` | merge develop（`HEAD^2` = `104153b2b…`） | 合并提交不改 `ci-red-attribute.ts` 的内容 ⇒ 判据读的落地时刻不变 |
| `854a21c2b` | `13:15:17+00:00` | 采集器：run 级 `timed_out` 不再被「jobs 是否取到」连带 | 只碰采集器 ⇒ 落地时刻不变 |
| `ef0d76236` | `13:21:28+00:00` | 载体 `.quay/ci-runs.jsonl` + 判据自跑留档 | 新文件，不碰归因器 ⇒ 落地时刻不变 |
| `27ef2b259` | `13:22:32+00:00` | merge develop（`HEAD^2` = `7a0c5f2c5…`）| 合并提交不改 `ci-red-attribute.ts` 的内容 ⇒ 落地时刻不变 |

落地窗口留痕（DoD 第 3 条）：

```
$ git show --stat --format='%H %cI' a0759fcef
a0759fcef31311b25e3300c6550d46e0fa9f0b72 2026-09-15T12:46:55+00:00

 plugin/scripts/capability-catalog.sh  |  12 +
 plugin/scripts/ci-red-attribute.ts    | 386 +++++++++++++++++++++++++++
 plugin/scripts/ci-runs-collect.ts     | 488 ++++++++++++++++++++++++++++++++++
 plugin/scripts/known-flakes.json      |  20 ++
 plugin/test/ci-red-attribute.test.mjs | 367 ++++++++++++++++++++++++++++++++++
 5 files changed, 1273 insertions(+)

$ git log --format='%h %cI %s' -- plugin/scripts/ci-red-attribute.ts
ce3508be7 2026-09-15T12:54:29+00:00 gap-ci-red-attribution-classifier: 修两处误把真红判成基础设施的谓词（真语料暴露）
a0759fcef 2026-09-15T12:46:55+00:00 gap-ci-red-attribution-classifier: CI 红有机械归因（归因器 + 写面同一次提交）
```

⇒ 归因器**首次**落地与写面接入同属 `a0759fcef`；之后的 `ce3508be7` 是谓词修复（同样是一次提交内
同时改归因逻辑与它的回归测试）。判据读的落地点因此是 `12:54:29+00:00`。

### AC1 — 归因器可判三类 + 兜底可分辨

立案基线（修前）：`ls plugin/scripts/ci-red-attribute.ts` → `No such file or directory`。
落地后 `git log -1 --format=%cI -- plugin/scripts/ci-red-attribute.ts` = `2026-09-15T12:54:29+00:00`（非空）。

表驱动单测（`node --test plugin/test/ci-red-attribute.test.mjs`，26 例全绿）逐条打印：

```
    attribution=real-defect signals=["defect:tests-ran-and-failed"]
    attribution=infrastructure signals=["infra:job-timeout-reached:test"]
    attribution=known-flake signals=["flake:plugin/test/tmux-leak-scan.test.mjs::R2 — TRANSIENT NEW residue"]
    attribution=real-defect signals=["default:no-signal-matched"]
```

第三行是真登记表里的条目（`plugin/scripts/known-flakes.json`，3 条，每条带 `firstRegistered` +
一份 `.quay/verification-round.jsonl` 的 perFile 复现读数）。第四行是无信号兜底 ⇒ 与第二行的
`defect:tests-ran-and-failed` 在 `signals` 上可分辨（硬规则 3b）。

登记表三条的**复现读数**是本任务实测的（不是抄的）：

```
$ node -e '<遍历 .quay/verification-round.jsonl 的 perFile>'
rounds=1781 withPerFile=1207
tmux-leak-scan: 7 red rounds / distinct tasks=7 / loads=[27.87,38.19,38.75,40.03,43.27,45.22,46.87]
worker-driver-fan-in: 20 red rounds / distinct tasks=17 / loads=[7.97,…,75.71]
gap-git-graph-adopt: 3 red rounds / distinct tasks=3 / loads=[25.36,37.76,44.76]
```

⇒ 三条都是「别的任务、别的 commit 也红过 + 与负载相关」。

### AC2 — 单变量对照（本任务核心）

**（a）单测里的对照**（`timedOut: false → true`，其余字段逐字不变；`diffKeys` 断言只翻了一个键）：

```
    before: input={"ts":"2026-09-15T02:38:35Z","branch":"develop","workflow":"CI","conclusion":"failure","runId":34921960393,"durationSec":1091,"testFiles":631,"jobs":[{"name":"test","conclusion":"failure","durationSec":1080,"timeoutMinutes":25}]}
            attribution=real-defect signals=["defect:tests-ran-and-failed"]
    after : input={"ts":"2026-09-15T02:38:35Z","branch":"develop","workflow":"CI","conclusion":"failure","runId":34921960393,"durationSec":1091,"testFiles":631,"jobs":[{"name":"test","conclusion":"failure","durationSec":1080,"timeoutMinutes":25}],"timedOut":true}
            attribution=infrastructure signals=["infra:run-timed-out"]
```

（两条 input 逐字对比：`after` 只是 `before` 的同一个 JSON 文本多了一个 `"timedOut":true` 键，
其余字符完全相同；测试里另有 `assert.deepEqual(diffKeys, ["timedOut"])` 把这一点钉死。）

**（b）真记录上的对照**（AC-269 那种恒值归因器在（a）下必然暴露；（b）另外证明它在真记录上也按信号走）：

```
$ node -e '<取载体里 runId=34921960393 那条真记录，只翻转 timedOut>'
single-variable diff keys = ["timedOut"]

$ node --experimental-strip-types plugin/scripts/ci-red-attribute.ts --record-file /tmp/ac269-real-before.json
real-defect	defect:tests-ran-and-failed
$ node --experimental-strip-types plugin/scripts/ci-red-attribute.ts --record-file /tmp/ac269-real-after.json
real-defect	defect:tests-ran-and-failed,defect:substantive-failure:test,suppressed-by-substantive-failure:infra:run-timed-out
```

⚠️ **如实交代**：这一条**没有改判**，且这是设计而非哑掉 —— 那条真记录的 `test` job 的 `Run tests` 步
**真的失败了**，所以「run 被超时截断」不是这个 run 红的原因；把 infra 信号一票通过会把那个真红豁免掉
（不可逆的一侧）。`signals` 里把被压制的 `infra:run-timed-out` 原样吐出来 ⇒ 读记录的人分得出
「没命中」与「命中但没定案」。这条边界由单测 `AC2 — ⛔ 单变量对照不成立于【有兄弟实质失败】的记录上`
逐字钉住。

**（c）真语料暴露的两个谓词缺陷（本条是本任务最有价值的读数）**

首次对真 run 归因时，载体 19 条失败**全部**判 `infrastructure` —— 一个在真实语料上**恒定**的取值，
且方向是把真红豁免掉。这正是硬规则 4 的形态，且是**单元对照过不了、只有真分布能暴露**的那一类：

```
$ node -e '<按 attribution 分组>'
records=39 byConclusion={"failure":19,"cancelled":8,"success":12}
failures byAttribution={"infrastructure":19}          ← 恒定值
  10x  infrastructure | ["infra:failed-before-tests-started:first-failed-step:Run tests"]
   7x  infrastructure | ["infra:failed-before-tests-started:first-failed-step:Test-coverage self-check …"]
   2x  infrastructure | ["infra:job-cancelled:release", …]
```

两处根因：

1. **「测试步没成功」被当成「测试步没跑」**——`Run tests` 步 `conclusion=failure` 被判成「测试从未开始」。
   修法：`skipped` 才是没跑，`success`/`failure`/`cancelled` 都是跑了；且只有**失败的步本身是 setup 形**
   才报 infra（否则落 real-defect，宁多一次人看）。同时 `TEST_STEP_RE` 去掉裸词 `test`/`suite`
   —— 实测有个失败的前置步叫 `Test-coverage self-check (DIR-110/ADR-019 …)`，裸词匹配会把「测试根本没开始」判反。
2. **infra 信号被当成一票通过**——两次 release run 里 `release` job 被取消，而 `sea-verify-node-free` 的
   `Run quay serve and curl it (no Node on PATH)` 步**真的失败**（那正是 AC-267 追的 SEA 缺陷）。
   修法：同一 run 里若另有 job 的红是实质性的，则它才是成因，兄弟 job 的取消不得豁免它。

修后同一批真记录（最终载体，40 条）：

```
records=40  byConclusion={"failure":21,"cancelled":8,"success":11}
failures=21  byAttribution={"real-defect":21}
    7x  real-defect  ["default:no-signal-matched"]
    2x  real-defect  ["defect:tests-ran-and-failed","defect:substantive-failure:sea-verify-node-free","suppressed-by-substantive-failure:infra:job-timeout-reached:release","suppressed-by-substantive-failure:infra:job-cancelled:release"]
   12x  real-defect  ["defect:tests-ran-and-failed"]
```

三种可区分形状；`signals` 全程非空。两条 release run 的 `job-cancelled` 是**真**取消（job 结论逐字
`cancelled`，`Run tests` 步也 `cancelled`），被压制而非被丢弃 —— 而它们的 `job-timeout-reached`
（`release` job 1817s > 30min 的 timeout-minutes）是**补 `path` 派生后新出现**的信号，
说明补完 timeout 派生之后压制那条规则确实又派上用场。

⚠️ 修后是**另一个恒定值**（19→21 条全 `real-defect`），但这是**语料的性质**不是谓词的缺陷：
三条信号形状在 `signals` 里可分辨，且两条把「命中过 infra 但被实质失败压制定案」逐字写在记录里。
可证伪性由 AC2 的单变量对照承担（那是**函数**的性质，不是语料的性质）——两者不可互相替代。

### AC3 — 写面接入（判据的直接量）

真采集（`gh` 已认证，非构造输入）：

```
$ node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --root <worktree> --limit 40
carrier=…/.quay/ci-runs.jsonl appended=40 skipped=0 attributed=21

$ node -e '<按 conclusion / attribution 分组>'
records=40  byConclusion={"failure":21,"cancelled":8,"success":11}
failures=21  byAttribution={"real-defect":21}
non-failure carrying attribution = 0
```

- 40 条记录全部由真实写函数落盘；**21 条 failure 全部带 attribution**，11 条 success / 8 条 cancelled
  **一条都不带**（`non-failure carrying attribution = 0`）。
- 只读复核（同一归因器的另一个 CLI 面）+ **双向控制**：

```
$ node --experimental-strip-types plugin/scripts/ci-red-attribute.ts --carrier .quay/ci-runs.jsonl
records=40 failures=21 unattributed=0 unreadable=0      exit=0
$ node --experimental-strip-types plugin/scripts/ci-red-attribute.ts --carrier /tmp/ac269-carrier-unattributed.jsonl
records=40 failures=21 unattributed=21 unreadable=0     exit=3
  缺归因: runId=34971747152 attribution=null
  缺归因: runId=34970958367 attribution=null
  缺归因: runId=34921960393 attribution=null
```

负控制（把**同一份载体**的 `attribution` 剥掉、其余逐字不变）判 `exit=3` 并点名 runId
⇒ 这个复核**能取假**，不是恒绿。

**AC-269 判据本身逐字跑**，`exit code` 与 `stdout`/`stderr` 全文落在
`.quay/ac269-criterion-evidence.txt`（本任务 worktree 上，判据正文用
`plugin/scripts/criterion-failure-attribution-check.ts` 的 `parseGoalFile` 从
`goals/AC-269-goal.md` 抽取，⛔ 不是手抄）。同一份载体上判据的三个分支**逐个走到过**，
证明它不是恒绿：

| 时刻 | 载体状态 | 判据读数 |
|---|---|---|
| `12:48:33` | 载体不存在 | `CAUSE=carrier-absent` exit 1 |
| `12:56:44` / `12:58:45` | 载体 39 条，无 post 窗口记录 | `CAUSE=collection-stalled` exit 1 |
| `13:20:40` | 载体 40 条，post 窗口 1 条（带 `attribution`） | **exit 0**（`bash criterion.txt`）；canonical `quay goal gate AC-269` 判 `pass` |

⚠️ **一条自己踩到的跑法坑，如实留下**：criterion 块以 `python3 - <<'P'` 开头 ⇒ 它是一条 **shell 命令**，
不是纯 python。第一版留档脚本写成 `python3 - < criterion.txt`，得到 `SyntaxError` + `exit 1` ——
**那不是判据的红，是跑法错**。同一时刻 canonical 入口 `quay goal gate AC-269` 判的是 `pass`。
⇒ 两个读数不一致时，先怀疑自己那条自造的跑法。（acceptance-runner 也是把 criterion 当 shell 命令 spawn 的。）

### AC4 — 采集活性（post 窗口条数）

见 `.quay/ac269-criterion-evidence.txt` 的「跑法 3」段。⚠️ 只报「判据 exit 0」区分不了
「没有红所以没事」与「采集根本没跑」，故必须贴条数与最早/最晚 `ts`。

判据里的 `post`（`ts` 晚于落地提交 `2026-09-15T12:54:29+00:00` 的记录）**非空**，读数逐字：

```
landing (-- plugin/scripts/ci-red-attribute.ts) = 2026-09-15T12:54:29+00:00
carrier records total = 40
post-window records (ts > landing) = 1
post earliest ts = 2026-09-15T12:55:17Z
post latest   ts = 2026-09-15T12:55:17Z
post runIds/branch/workflow/conclusion/attribution:
  2026-09-15T12:55:17Z  develop  CI  failure  attribution=real-defect
post failures = 1 ; all attributed = True
```

⇒ `post` = **1** 条（不是 0），且这**一条**就是 `conclusion=failure` 且带 `attribution` 的 ——
AC3 里「⛔ 不是手工塞行」的那一臂因此**不需要**单独走：窗口内真的有红，且它由真实写函数归因。
（本条 run 是本任务用 `gh workflow run ci.yml --ref develop` 真发的一次 develop CI，
`created_at` = `12:55:17Z` 晚于落地时刻；`gh run view` 可复核其存在与结论。）

### AC5 — 5b 扫描：载体写入口只有一处

三条独立读法（先数、再打印前 3 条命中，硬规则 2）：

**(1) 载体名的全仓引用**（`grep -rn "ci-runs"`，排除 `node_modules` 与 `.quay/`）—— 命中 **4** 个文件：

```
plugin/scripts/ci-runs-collect.ts:57       export const CARRIER_REL = path.join(".quay", "ci-runs.jsonl");   ← 唯一写口
plugin/scripts/ci-red-attribute.ts:64      /** 载体记录（`.quay/ci-runs.jsonl` 的一行）… */                 ← 只读（--carrier 复核）
plugin/test/ci-red-attribute.test.mjs:364  const carrier = path.join(dir, ".quay", "ci-runs.jsonl");        ← 夹具 mkdtemp 临时目录
plugin/scripts/capability-catalog.sh:450   [ci-red-attribute.ts]="…" / :451 [ci-runs-collect.ts]="…"        ← 声明行
```

**(2) 反向判别**（更硬）：全仓凡是**算出一个 `.quay/<name>.jsonl` 路径**的地方按 basename 归组 ——
**209** 个不同载体名，其中 `ci-runs.jsonl` 只由上面那 4 个文件提及
（`carrier writers = plugin/scripts/capability-catalog.sh, plugin/scripts/ci-red-attribute.ts,
plugin/scripts/ci-runs-collect.ts, plugin/test/ci-red-attribute.test.mjs`）。
⇒ 没有任何别的机件会写这个载体。

**(3) 粗谓词作旁证**：「源码里出现 `.quay/` 且调了 `appendFile`/`writeFile`/`createWriteStream`/`>>`」
命中 **112** 个生产文件（根 = `plugin/scripts` `scripts` `packages/quay/src` `packages/quay-native/src`，
排除 `node_modules`/`archive`/`checker-mutation-cases`）。前 3 条：

```
plugin/scripts/architecture-review-cluster.ts   writeCall=true  shellRedirect=false
plugin/scripts/cap-from-gate.ts                 writeCall=true  shellRedirect=true
plugin/scripts/capability-catalog.sh            writeCall=true  shellRedirect=true
```

逐条看都写的是**别的**载体（`gate-events.jsonl` / `worker-outcome.jsonl` / `checker-cost.jsonl` /
`fan-in-step-trace.jsonl` …），没有一条指向 `ci-runs.jsonl`。
⛔ 粗谓词在此只作旁证 —— 真正定案的是 (1)/(2)，因为「提到 .quay 又写文件」与「写这个载体」不是一回事。

**逐条处置**：

| 写口 | 处置 |
|---|---|
| `plugin/scripts/ci-runs-collect.ts` `writeCarrier()` | **过归因**：append 前对每条 `conclusion === "failure"` 调 `withAttribution()`；非 failure 不加该字段。载体只追加，从不重写既有行 |
| `plugin/scripts/ci-red-attribute.ts` `--carrier` | 只读，不写 |
| `plugin/test/ci-red-attribute.test.mjs` | 写的是 `mkdtemp` 临时目录，`after()` 全清（R6 tmp-leak 配对）|
| `plugin/scripts/capability-catalog.sh` | 声明行，不写载体 |

⇒ **不留一个能绕过归因的写口**：`withAttribution` 是 `writeCarrier` 里唯一通往 `appendFileSync` 的路径，
且它对非 failure 记录**不写**该字段（⛔ 不是「写了但写空」——字段根本不存在）。

### AC6 — scoped 门

在**最终 merge 之后的 tip** 上跑（`HEAD^2` = `7a0c5f2c5f28b054d954101eb7d8cc096b4db53e`，
即那次 merge 进来的 develop tip —— cache 的 `--develop-sha` 取的就是它，⛔ 不是「写缓存那一刻的 develop」）：

```
$ bash scripts/test.sh --for-task gap-ci-red-attribution-classifier --allow-thin
…
ℹ tests 42
ℹ pass 42
ℹ fail 0
SCOPED_GATE_EXIT=0
```

`^✖` 计数 = 0，`^FAIL` 与 `[FAIL]` 计数各 = 0（scoped 静态层 13 条 `^PASS` + 5 条 `[PASS]`）。
本任务的新测试文件被 `--for-task` 的 Touches 选择集选中（日志 `:3976  + plugin/test/ci-red-attribute.test.mjs`），
scoped 门确实跑了它，不是「没选中所以绿」。

### DoD — REAL LANDING + 判据自跑留档

**REAL LANDING（DIR-026 Reading A）**：交付的**不是**「仓库里多了一个分类函数」——是载体
`.quay/ci-runs.jsonl` 里**真实落盘的失败记录带着 `attribution`**（21/21 failure 带归因，且由真 `gh`
采出来的真 run），并且 AC2 的单变量对照证明机制在信号变化时**会改判**（单测逐字读数），
不是一个恒值。

**判据自跑留档**：`.quay/ac269-criterion-evidence.txt`（判据正文 + 两种跑法的 exit code 与
stdout/stderr 全文 + post 窗口读数）。⛔ 没有伪造载体记录去骗判据；窗口内无 failure 的情形按
AC3 的要求另走「真实写函数造一次失败记录」一臂。