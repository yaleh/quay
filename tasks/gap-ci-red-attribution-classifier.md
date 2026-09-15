---
id: gap-ci-red-attribution-classifier
title: CI 红有机械归因：落地 plugin/scripts/ci-red-attribute.ts 并把 attribution 写进
  .quay/ci-runs.jsonl 的每条失败记录（AC-269）
status: todo
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

- [ ] AC1（判据主体，能取假）：`plugin/scripts/ci-red-attribute.ts` 存在，且 `git log -1 --format=%cI -- plugin/scripts/ci-red-attribute.ts` 非空。表驱动单测证明它是**总函数**：至少三条 fixture 分别判出 `real-defect` / `infrastructure` / `known-flake`，并打印每条的 `attribution` 与 `signals`；一条无任何信号的 fixture 判 `real-defect` 且 `signals` 含兜底标记。⛔ 立案基线：文件不存在（`ls` 报 No such file or directory）。
- [ ] AC2（可证伪性 / 单变量对照，本任务核心）：对同一条失败记录**只翻转一个客观信号**（例如 `timedOut: false → true`，其余字段逐字不变），`attribution` 必须改判（`real-defect → infrastructure`）；两次读数（输入记录 + 输出 `attribution`/`signals`）逐字贴出。一个恒返回同一取值的「归因器」在这个对照下必然暴露。
- [ ] AC3（写面接入，判据的直接量）：跑一次真实采集（或等一轮采集）后，`.quay/ci-runs.jsonl` 中**每一条** `conclusion=failure` 的记录都带 `attribution ∈ {real-defect, infrastructure, known-flake}`。并把 **AC-269 判据本身**逐字跑一遍（代码在 `goals/AC-269-goal.md` 的 `criterion:` 块内），贴出 exit code 与 stdout/stderr 全文。⚠️ 窗口内没有任何 failure 记录时，判据按设计 exit 0——此时必须**额外**在同一个真实写函数上造一次失败记录（⛔ 不是手工往载体里塞一行），证明写面确实会写 `attribution`；「空态 exit 0」与「写面会写归因」两条证据缺一不可。
- [ ] AC4（采集活性，非静默空过）：载体中存在 `ts` 晚于归因器落地提交的记录（判据里的 `post` 非空）；打印 `post` 的条数与最早/最晚 `ts`。⛔ 只报「判据 exit 0」而不报这个条数，区分不了「没有红所以没事」与「采集根本没跑」。
- [ ] AC5（5b 扫描，先数再改）：全仓搜载体路径的写入口，命中数与前 3 条逐条贴出；每个写口的处置（过归因 / 写不出 failure 的理由）逐条列出。
- [ ] AC6（scoped 门）：`bash scripts/test.sh --for-task gap-ci-red-attribution-classifier` 绿。

## Definition of Done

- [ ] AC1–AC6 全勾；AC2 / AC3 的读数是在本任务 worktree 上用上文逐字命令跑出来的（立案基线只作「修前」对照）。
- [ ] **REAL LANDING（DIR-026 Reading A）**：交付的不是「仓库里多了一个分类函数」，而是**载体里真实落盘的失败记录带着 `attribution`**——一个真实对象穿过了机制（写面 + 归因器）；且 AC2 的单变量对照证明该机制在信号变化时会改判，不是一个恒值。
- [ ] **落地窗口留痕**：贴出 `git show --stat` 证明归因器与写面接入同属一个提交，并说明理由（Finding 的窗口约束）。
- [ ] **判据自跑留档 + 如实交代**：AC-269 判据的 exit code 与 stdout/stderr 全文落 `.quay/` 下一个证据文件并在本任务 Evidence 段引用；⛔ 不伪造载体记录去骗判据，也不把「窗口内无 failure」说成「归因已验证」。
- [ ] 本任务按 inherited-core 的 standard 交付：Evidence 段贴出全部命令的逐字输出（含失败读数），不自述结论、不省掉反例。

## Touches

- plugin/scripts/ci-red-attribute.ts (new)
- plugin/scripts/ci-runs-collect.ts
- plugin/scripts/known-flakes.json (new)
- plugin/scripts/capability-catalog.sh
- plugin/test/ci-red-attribute.test.mjs (new)
- tasks/gap-ci-red-attribution-classifier.md