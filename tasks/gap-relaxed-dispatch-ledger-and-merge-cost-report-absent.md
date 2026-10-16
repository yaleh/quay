---
id: gap-relaxed-dispatch-ledger-and-merge-cost-report-absent
title: 放宽派发既无账本也无报告：每次放宽不落 .quay/relaxed-dispatch.jsonl，合并成本无法按任务 id 与
  worker-outcome 连接（额外 worker 分钟 / 尝试次数 / fan-in 失败步都取不到）（GOAL-037 AC-363 观测面）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-363
---
**type:** execution

## Proposal

**缺口（GOAL-037 方案第 0 步「只加观测」的第二半）**：放宽派发（任务被 touches 单独挡住超过阈值后放行）一旦生效，**它多花了多少成本没有任何读数**。`plugin/scripts/` 全文 grep `relaxed-dispatch` / `touchesDisjointOrAged` / `max_relaxed_inflight` **零命中**：既没有 `.quay/relaxed-dispatch.jsonl` 这个载体（`git check-ignore .quay/relaxed-dispatch.jsonl` 也不命中——本仓库是逐载体条目式忽略，`.gitignore:96` 的 `**/.quay/worker-outcome.jsonl` 就是同族先例，⛔ 没有 `.quay/` 兜底规则），也没有任何函数把「放宽过的任务」与 `.quay/worker-outcome.jsonl` 里的运行连接起来。

**为什么这是缺口，而不是「以后再加」**：GOAL-037 的生效（AC-365/366）与自动收紧（AC-367）**都要读「放宽比不放宽多花多少」**才能设名额、才能收紧。立案文本给出现状读数：worker 追平 develop 的冲突**没有被记录**（fan-in 的 merge-develop 失败率仅 3.3% / 0.15%，因为重叠任务被 touches 谓词串行化了），而放宽之后冲突会出现在 **worker 运行段**里——这一段目前没有任何账本。这是硬规则 4 推论三要求的次序：先把量做成一条能穿过所有中间层、在验收那一刻仍取得到的记录，才谈得上给它设阈值/名额。

**本条只做两件机件、不碰策略**：① **账本写入器**（每次放宽追加一行：task / blockers / overlapFiles / waitedMinutes / dispatchedAt）；② **连接报告**（把每条放宽记录与该任务在 `worker-outcome` 里的**全部**运行按**任务 id** 连接，给出额外 worker 分钟 / 尝试次数 / fan-in 失败步，并给出同期未放宽对照）。⛔ 放宽谓词、阈值、名额、自动收紧、`worker-driver.ts` 的接线**都不在本条**（分别是 AC-364/365/366/367）。

<!-- dedup-ref --> 追踪与去重结论（机制去重已做，非症状去重）：同批的 `gap-worker-round-filter-trace-attribution`（AC-362）在 `driver-filters.ts` / `worker-driver.ts` 里做 filtered-empty 轮的归因，本条**不触碰**这两个文件（见 AC9④），两条任务无 Touches 重叠。合并候选检查用现成机件跑过：`node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --touches plugin/scripts/relaxed-dispatch-ledger.ts --touches plugin/scripts/capability-catalog-declarations.json --touches plugin/test/touches-relax-ledger.test.mjs --touches .gitignore --json` ⇒ `peers: []`、`mentions: []` ⇒ 判定：独立立案，不并入任何在飞任务。

## Plan

1. **新模块 `plugin/scripts/relaxed-dispatch-ledger.ts`**（纯库 + `isDirectEntry` CLI，与 `plugin/scripts/duration-report.ts` 的尾部同形）：
   - `RELAXED_DISPATCH_REL = ".quay/relaxed-dispatch.jsonl"` 导出（路径单一来源，⛔ 调用方不各写一份字面量）；worker-outcome 的路径**复用** `plugin/scripts/driver-filters.ts:1019` 已导出的 `WORKER_OUTCOME_REL`（⛔ 不写第二个字面量，硬规则 1）。
   - `RelaxedDispatchRecord = { task, blockers, overlapFiles, waitedMinutes, dispatchedAt }` —— **恰好 AC 点名的五键**，⛔ 不再加第二个时间字段（`dispatchedAt` 是这一件事的唯一时刻；再加一个 `ts` 就是这个仓库明令禁止的同义字段漂移）：`task` 非空任务 id；`blockers` **数组**（这次放宽放过的 touches 重叠对手 id，非空）；`overlapFiles` 重叠文件路径数组（交集，沿用 `checkTouchesPair().overlaps` 的排序）；`waitedMinutes` 有限非负数（等多久才放宽）；`dispatchedAt` 可 `Date.parse` 的 ISO 时刻。
   - `appendRelaxedDispatch(root, rec)`：**追加写**（`appendFileSync`，一次一行 JSON + `\n`），⛔ 不读改写、不重排、不截断；文件末尾**无换行**时先补一个换行再写（否则新记录与旧行粘成一行，整份载体从那一行起不可解析）。
   - **fail-closed**（同族先例 `plugin/scripts/dispatch-record.ts` 的理由不足即拒写）：五键任一不合法（缺 / 空数组 / 非数组 / 非有限数 / 负 / 不可 parse）⇒ **拒写且一个字节都不写**，`reason` 指名具体字段。⛔ 不把读不到的 `waitedMinutes` 写成 0（硬规则 6 + 3b：缺值 = 未查，不得与「等 0 分钟」同形）。
   - `readRelaxedDispatchLedger(root)` ⇒ `{present, records, malformed}`：`present:false` 与 `records:[]` **不同形**（照 `duration-report.ts:196` `readJsonl` 的约定）。
   - `buildRelaxedDispatchReport(root, {nowMs})`：见第 2 步。CLI `--report [--root <dir>] [--json]`，退出码 0 = `evaluated:true` · 2 = 用法错误 · 3 = NOT-EVALUATED（与 `plugin/scripts/rework-predictors.ts` 的退出码约定一致）。
   - **命名避让（撞名即红，与语义无关）**：⛔ 本模块不要用 `lineOf` / `lineAt` / `colOf` / `snippetOf` / `snippetAt` / `relOf` 做函数名——`plugin/test/source-text-lib.test.mjs` 对**全仓** `plugin/scripts` 非测试文件逐文件匹配这一族名字（`codeOnlyText` / `maskComments` 同族同理），撞名即使语义不同也会红。
2. **连接与读数（同一文件）**：
   - **口径复用，不另立一套**：worker 运行段 = `workerExitedAtMs − dispatchedAtMs`（两键都在才算；⛔ **不用 `wall_clock_ms`**——它含 fan-in，会把 merge/suite 成本混进「worker 多花了多少」）。归一化直接调 `duration-report.ts:230` 的 `toAttemptRecord`（缺字段 ⇒ 该运行 NOT-EVALUATED，⛔ 不折成 0）；分钟换算只此一处；对照组与放宽组**用同一个归一化函数** ⇒ 「口径相同」是结构性质而不是约定。中位数用 `duration-report.ts:167` 的 `percentile(sorted, 0.5)`，⛔ 不手搓第二个 median。
   - **连接键 = 任务 id**（⛔ 不是数组下标/行号）：每条账本记录 ⇒ 该 `task` 在 `worker-outcome` 里的**全部**运行 ⇒ `attempts` = 运行条数；`workerMinutes` = 各运行段求和（有运行段不可测 ⇒ 计入 `runsWithoutSegment`，⛔ 不计 0）；`fanInFailureSteps` = 该任务**失败运行**的 `mechanical_fan_in.step` 逐字取值（按出现序去重）。
   - **词表分开**：`step` 取值来自 `mechanical_fan_in`（如 `merge-develop` / `suite` / `ff`），`final_state` 另有词表（`worker-driver.ts:486` 的 `FINAL_STATES`：`completed` / `exited-not-landed` / …）——⛔ 两表不得互串（`worker-driver.ts:470-505` 记录过 `landed` 被写进 `final_state` 的实测事故：吞吐读数变 0 且与「系统停摆」同形）。没有 `mechanical_fan_in` 的失败运行**不产出 step 值**（⛔ 不写 `"unknown"`），单独计入 `failuresWithoutStep`。
   - **对照组** = 同一时间窗（放宽记录 `dispatchedAt` 的最早→最晚）内、**未出现在账本**、且 **≥1 条 `final_state === "completed"`** 的任务；同口径算每任务分钟与尝试次数。`extraWorkerMinutes` = 该放宽任务的分钟 − 对照组任务的分钟**中位数**。
   - **三态，⛔ 不伪装**（硬规则 3b）：任一侧**可测任务数**为 0 或低于模块导出的样本下限常量 ⇒ `{evaluated:false, reason:<指名哪一侧不足 + 两侧计数>}`，且 `extraWorkerMinutes` / 对照组中位数字段取 `NOT_EVALUATED`（**不是 0、不是空均值**）。下限常量是具名导出（`duration-report.ts:54` 的 `NOT_EVALUATED` 同族约定），取值与理由写进 Evidence——⛔ 测试不得复制这个数字。
3. **测试 `plugin/test/touches-relax-ledger.test.mjs`**（首行 `// @test-group engine`：纯 fs、无子进程、无 wall-clock 等待 ⇒ 55s 上限应有余量，实测值写进 Evidence）：
   - **用真实机件**：真实 `appendRelaxedDispatch` 写进 `fs.mkdtempSync` 出的 fixture root 的 `.quay/relaxed-dispatch.jsonl`；`worker-outcome.jsonl` 行按生产字段写盘；**断言读的是从载体文件回读并 `JSON.parse` 出来的内容**（⛔ 不是内存对象）。fixture root 登记进 `TMP_ROOTS` 数组、在顶层 `after()` 统一删（照 `plugin/test/duration-report.test.mjs` 的手法：每个 mkdtemp 都有配对清理，`tmp-leak-pairing-check` 要求）。
   - **判别力**：夹具刻意让账本行序 ≠ outcome 行序、且各任务的分钟数与失败步**互不相同**，并**在测试内独立算出「按位置连接」的投影、显式断言它与正确读数不同**——否则 AC8 的注入可能是空转的（负控制的空转形态与「验过了」同形）。
4. **静态面（三条登记，缺一即红 —— 一个新增的 `plugin/scripts/*.ts` 会被一组不 import 你的仓级契约判）**：
   - **能力目录**：新脚本必须在 `plugin/scripts/capability-catalog-declarations.json` 里成组声明（QUESTION / CADENCE / INVALIDATION / LAST_REAFFIRMED / MATCHING / CONSUMER 六表，与 `duration-report.ts` 同形；键是 **basename**，⛔ 不是带目录的路径）——⛔ 漏声明会让 `bash plugin/scripts/capability-catalog.sh --summary` 报 unclassified 并 exit 1（当前读数 383 scripts | 383 declared | 0 unclassified）。声明值内⛔ 不得有反引号或 `$(`（数据完整性闸扫每个值）。⚠️ **CONSUMER 值里若写出 `node …<name>.ts` 形状**，`build-plugin-dist.mjs` 的 `INVOCATION_RE` 会把本模块变成**发布包的一个 bundle entry**（实测 283→284 files、体积上限转红）——按需决定，别无意中加上；⚠️ cadence 若声明「按需」，`rhythm-consumer-check` 判据2 要求**必须有 CONSUMER 行**（否则该静态检查红 ⇒ `run_static_checks` fail-closed ⇒ 整套 suite 一条测试都没跑）。
   - **载体登记**：新载体名必须在 `docs/carrier-registry.json` 登记一条 `{name: "relaxed-dispatch.jsonl", kind: "jsonl-log", owner: "plugin/scripts/relaxed-dispatch-ledger.ts", readers: "unaudited"}` —— `plugin/test/carrier-registry-completeness.test.mjs` 把「代码里的载体名字面量」与登记表做成**双向**契约（代码有而未登记 ⇒ 红；登记了而代码里已无 ⇒ **也**红），取值按字符串字面量**逐 `/` 段**判定（`".quay/relaxed-dispatch.jsonl"` ⇒ 名字 `relaxed-dispatch.jsonl`），`owner` 必须是仓里**真实存在**的模块文件（本模块就是它的写入者，⛔ 不写 `unowned-yet`），`readers` 只能是 `"unaudited"`。
   - **忽略项**：新载体在 `.gitignore` 加 `**/.quay/relaxed-dispatch.jsonl` 一行（同族 `.gitignore:96` 的 `**/.quay/worker-outcome.jsonl`；本仓库是逐载体条目式忽略，⛔ 没有 `.quay/` 兜底规则）。
5. **不越界**：⛔ 不改 `plugin/scripts/driver-filters.ts` / `plugin/scripts/worker-driver.ts`（放宽决策点与接线是 AC-365/366），⛔ 不新增放宽谓词、不读配置、不碰 `.quay/config.yml`（AC-364）。

## Acceptance Criteria

- [x] AC1 — 测试文件落地且通过（AC-363 判据面逐字）：`timeout 55 node --experimental-strip-types --test plugin/test/touches-relax-ledger.test.mjs` **exit 0**，文件首行带 `// @test-group engine`。附实际命令、输出尾部与实测耗时（秒）。
- [x] AC2 — 账本形状与追加语义（AC-363(a)）：真实 `appendRelaxedDispatch` 写两行 ⇒ 从载体文件回读：行数 = 2、每行恰含 `task`/`blockers`/`overlapFiles`/`waitedMinutes`/`dispatchedAt` 五键且类型正确（`blockers`/`overlapFiles` 为数组）。**第二行写入后第一行逐字节不变**（写前先留存文件字节，写后逐字节比较）。文件里预置一行外来内容 + 一行**末尾无换行**的记录时，两者逐字保留且新记录独立成行（追加后 `malformed` 不因粘行而增加）。附写入前后的字节与两行逐字 JSON。
- [x] AC3 — 写入器 fail-closed（⛔ 缺值不写成 0）：五个非法输入各一次——`task` 缺失/空串、`blockers` 空数组、`overlapFiles` 非数组、`waitedMinutes` 为 `null`/`NaN`/负数、`dispatchedAt` 不可 parse ⇒ 每次 `ok:false` 且 `reason` 指名该字段，**且文件字节哈希与调用前相同**（一个字节都没写）。附五次调用与哈希前后值。
- [x] AC4 — 连接键是 task id，不是位置（AC-363(b) + (e) 的判别力半边）：fixture 三任务（A、B 放宽；C 对照），**账本行序 ≠ outcome 行序**，各任务 worker 分钟与失败步互不相同 ⇒ 每条放宽记录的 `attempts`/`workerMinutes`/`fanInFailureSteps` 与该任务自身运行的实测值相同；测试内**独立算出按位置连接的投影**（`ledger[i] ↔ outcome[i]`）并显式断言它与正确读数**不同**（夹具具判别力）。附正确读数、按位置投影、两者差异的逐字打印。
- [x] AC5 — extraWorkerMinutes 口径与对照组（AC-363(b)(c)）：worker 分钟 = `workerExitedAtMs − dispatchedAtMs` 求和；用一条 `wall_clock_ms` 明显更大的 fixture 行断言「本读数 ≠ wall_clock_ms 口径读数」（证明口径真的换了，不是巧合相等）。对照组 = 窗口内未放宽且 ≥1 条 `final_state === "completed"` 的任务，用**同一个** `toAttemptRecord` 归一化。构造可手算的 fixture（放宽任务 30 分钟；对照组 10/20/30 分钟 ⇒ 中位 20 ⇒ extra = 10）并逐字断言。附实际数值、算式与对照组任务清单。
- [x] AC6 — fanInFailureSteps 的来处与词表隔离（AC-363(b)）：某放宽任务有两条失败运行（`mechanical_fan_in.step` 分别为 `merge-develop` 与 `suite`）+ 一条 `completed` ⇒ 该任务 `fanInFailureSteps` 恰为这两个值（逐字取自 `step`，⛔ 不翻译）；显式断言该字段**不含** `exited-not-landed`/`completed`/`landed`，且与该任务的 `final_state` 投影是两个不同字段。另造一条**无 `mechanical_fan_in`** 的失败运行 ⇒ 不产出 step 值、计入 `failuresWithoutStep`（⛔ 不写 `"unknown"`、⛔ 不折成 0）。附该任务两个字段的逐字值。
- [x] AC7 — 样本不足 ⇒ evaluated:false 且不伪装成 0（AC-363(d)）：三组 fixture——账本空 / 有放宽无对照 / 有对照无放宽——每组断言 `evaluated === false`、`reason` 指名不足的一侧并带两侧计数、`extraWorkerMinutes` 与对照组中位数取 `NOT_EVALUATED`，并**显式断言 `!== 0`**（不得输出 0 或空均值伪装成「无额外成本」，硬规则 3b）。另用模块导出的样本下限常量做两向断言：`下限 − 1` ⇒ false，达到下限 ⇒ true（⛔ 测试内不写这个数字的字面量，靠 import）。附三组报告 JSON。
- [x] AC8 — 取假形态（AC-363(e)，必须真红并留痕）：① 把连接键改成**按位置**（数组下标）⇒ 本测试变红；② 样本不足时把数值写成 `0` ⇒ 本测试变红。两次各附非零退出码 + 失败断言原文。注入不得留在落地代码里：恢复后 `git status` 净、落地 diff 与该测试最终内容一致。
- [x] AC9 — 静态面与不越界：① `bash plugin/scripts/capability-catalog.sh --summary` 报 `0 unclassified`（新脚本已在 declarations 六表成组声明）；② `git check-ignore .quay/relaxed-dispatch.jsonl` 命中（`.gitignore` 新增该载体条目）；③ `bash scripts/test.sh plugin/test/carrier-registry-completeness.test.mjs` **exit 0**，且 `docs/carrier-registry.json` 中 `relaxed-dispatch.jsonl` 的 `owner` 指向真实存在的新模块（⛔ 不是 `unowned-yet`）；④ `git diff --stat -- plugin/scripts/driver-filters.ts plugin/scripts/worker-driver.ts` **空**（本条不接线；放宽决策点归 AC-365/366）；⑤ `bash scripts/test.sh plugin/test/duration-report.test.mjs plugin/test/driver-filters.test.mjs` **exit 0**（复用的口径与既有谓词不回归）。附五条命令、退出码与输出。

## Definition of Done

真实落地 = **在 fixture root 上由生产写入器真的追加出账本行、并由生产报告函数从载体文件回读**出连接读数，不是「单测绿了」、也不是「内存对象里有这个字段」。四条逐一对上：① 新测试落地并 exit 0（AC1）；② 从 fixture 载体回读的账本行与报告 JSON 逐字贴出（AC2/AC5）；③ 取假形态两种注入各真红一次（AC8，附红输出）；④ 静态面绿（AC9 的五条命令 + 退出码，含载体登记与能力目录两条登记）。

**如实写明（⛔ 不作为省略的理由）**：本 AC 的判据面是**夹具读数**——GOAL-037 立案文本的「已知缺口」已承认本 goal 的 AC 都不读生产载体（生产读数需人在目标项目启用 shadow/live 并重启 driver，是人工步骤）。因此本条的落地证明止于「夹具载体回读」；生产消费（driver 调写入器、人或 AC-367 读报告）由 AC-365/366/367 承担。⛔ 同时：AC-363 的判据面（测试存在且 55s 内绿）**单独不具备判别力**，它区分不了「真连接」与「恒真断言」——判别力由 AC4 的「按位置投影必须不同」与 AC8 的两次注入红提供，故这两条不得省略、不得只在文字上声称跑过。全部新增测试在 `bash scripts/test.sh --for-task gap-relaxed-dispatch-ledger-and-merge-cost-report-absent` 下绿。

## Touches

- plugin/scripts/relaxed-dispatch-ledger.ts (new)
- plugin/scripts/capability-catalog-declarations.json
- docs/carrier-registry.json
- plugin/test/touches-relax-ledger.test.mjs (new)
- .gitignore
- tasks/gap-relaxed-dispatch-ledger-and-merge-cost-report-absent.md

## Evidence

实现落在 task worktree `quay-worktrees/gap-relaxed-dispatch-ledger-and-merge-cost-report-absent`，分支 `task/gap-relaxed-dispatch-ledger-and-merge-cost-report-absent`，提交 `2827fd494` + 合入 develop 后的 `2c487f1e`。**判据面 = 夹具载体回读**（见 DoD 的如实声明）；下列读数全部来自**真实机件**（生产 `appendRelaxedDispatch` 写入 → 生产 `readRelaxedDispatchLedger` / `buildRelaxedDispatchReport` 从 `.quay/*.jsonl` 文件回读），⛔ 无内存对象充当证据。

### AC1 — 测试落地且 55s 内绿

```
$ head -1 plugin/test/touches-relax-ledger.test.mjs
// @test-group engine
$ timeout 55 node --experimental-strip-types --test plugin/test/touches-relax-ledger.test.mjs
✔ AC2 — 追加两行：从载体文件回读，恰五键、类型正确，且第二行写入后第一行逐字节不变
✔ AC2 — 末尾无换行的旧记录：逐字保留、新记录独立成行、malformed 不因粘行而增加
✔ AC3 — 五类非法输入各拒写一次，reason 指名该字段，且文件字节哈希不变（一个字节都没写）
✔ AC4 — 账本行序 ≠ outcome 行序：连接按任务 id；按位置连接的投影必须与正确读数不同
✔ AC5 — 放宽组 30 分钟 vs 对照组 10/20/30 ⇒ 中位 20 ⇒ extra = 10；且读数 ≠ wall_clock_ms 口径
✔ AC6 — fanInFailureSteps 逐字取自 mechanical_fan_in.step；与 final_state 是两个字段两个词表
✔ AC7 — 三组样本不足的 fixture：evaluated:false + reason 指名不足的一侧 + 数值取 NOT_EVALUATED(≠0)
✔ CLI 参数解析：--report 必需、未知参数与缺值的 --root ⇒ 用法错误（exit 2 的判据）
ℹ tests 8 · pass 8 · fail 0 · duration_ms 232.135935
exit=0   实测墙钟：0.27s（10 次重复跑 10/10 绿，无残留 mkdtemp）
```

### AC2 — 账本形状与追加语义（载体回读）

```
[AC2] 回读行数=2 · 首行字节前缀不变=true · malformed=[]
[AC2] 载体逐字:
{"task":"T-a","blockers":["T-x","T-y"],"overlapFiles":["plugin/scripts/a.ts"],"waitedMinutes":12.5,"dispatchedAt":"2026-10-17T00:00:00.000Z"}
{"task":"T-b","blockers":["b-T-b"],"overlapFiles":[],"waitedMinutes":0,"dispatchedAt":"2026-10-17T00:01:00.000Z"}
[AC2] 末尾无换行: malformed before=1 after=1 · 既有字节前缀逐字保留=true · 补上的字节=0xa · records=2
```
（每行恰五键、顺序固定；`blockers`/`overlapFiles` 为数组。负控制：把同一批内容按「不补换行」粘起来，`malformed` 确实 = before+1 —— 故「不变」这个断言有判别力。）

### AC3 — 写入器 fail-closed（⛔ 缺值不折成 0）

```
[AC3] task 缺失 → ok=false 哈希不变=true reason=task: expected a non-empty task id (got undefined)
[AC3] task 空串 → ok=false 哈希不变=true reason=task: expected a non-empty task id (got string "   ")
[AC3] blockers 空数组 → ok=false 哈希不变=true reason=blockers: expected a non-empty array of task ids (got array(0))
[AC3] overlapFiles 非数组 → ok=false 哈希不变=true reason=overlapFiles: expected an array of file paths (got string "x.ts")
[AC3] waitedMinutes null → ok=false 哈希不变=true reason=waitedMinutes: expected a finite number >= 0 (got null)
[AC3] waitedMinutes NaN → ok=false 哈希不变=true reason=waitedMinutes: expected a finite number >= 0 (got NaN)
[AC3] waitedMinutes 负数 → ok=false 哈希不变=true reason=waitedMinutes: expected a finite number >= 0 (got -3)
[AC3] dispatchedAt 不可 parse → ok=false 哈希不变=true reason=dispatchedAt: expected a Date.parse-able timestamp (got string "not-a-timestamp")
[AC3] hash before=5cfbea4d7386ed76 after=5cfbea4d7386ed76
[AC3] 真正量出来的 0 → ok=true（0 与「缺值」不同形）
```

### AC4 — 连接键是 task id（含「按位置投影必须不同」的判别力）

账本行序 `[T-A, T-B]`；outcome 行序 `[T-C, T-A(run1), T-A(run2), T-B(run1)]` —— 刻意错开。

```
[AC4] 按 id 正确读数 T-A: attempts=2 workerMinutes=30 fanInFailureSteps=["merge-develop"] finalStates={"completed":1,"exited-not-landed":1}
[AC4] 按 id 正确读数 T-B: attempts=1 workerMinutes=15 fanInFailureSteps=["suite"] finalStates={"exited-not-landed":1}
[AC4] 按位置投影(ledger[i]↔outcome[i])={"T-A":{"位置连到":"T-C","workerMinutes":8,"step":null},"T-B":{"位置连到":"T-A","workerMinutes":10,"step":null}} ⇒ 与正确读数不同
[AC4] controlTaskIds=["T-C"]
```
T-A：按 id = 2 次 / 30 分钟 / `merge-develop`；按位置 = 1 次 / 8 分钟 / 无 step。T-B：按 id = 15 分钟 / `suite`；按位置 = 10 分钟 / 无 step。**两者逐项不同 ⇒ 夹具对「按 id 还是按位置」有判别力。**

### AC5 — extraWorkerMinutes 口径与对照组

```
[AC5] relaxedMedian=30 controlMedian=20 extra=10  (= 30 − 20)
[AC5] controlTaskIds=["T-ctl-10","T-ctl-20","T-ctl-30"] controlMinutes=[10,20,30]
[AC5] wall_clock_ms 口径同一条运行 = 90 分钟 ≠ 本读数 30
```
算式：worker 运行段 = `worker_exited_at − dispatched_at`；放宽组 2 条各 30 分钟 ⇒ 中位 30；对照组 `[10,20,30]` ⇒ 中位 20；`extraWorkerMinutes = 30 − 20 = 10`。同一条运行 `wall_clock_ms = 90 分钟`（含 fan-in）⇒ 口径确实换了，⛔ 不是巧合相等。对照组逐任务分钟用同一个 `toAttemptRecord` 独立复算 = `[10,20,30]`，与报告一致。

### AC6 — fanInFailureSteps 的来处与词表隔离

```
[AC6] fanInFailureSteps=["merge-develop","suite"] failuresWithoutStep=2 failedRuns=4 completedRuns=1 attempts=5 finalStates={"exited-not-landed":3,"completed":1,"killed":1}
```
两条失败运行的 `mechanical_fan_in.step` 逐字取到；`failuresWithoutStep=2` = 一条无 `mechanical_fan_in` + 一条有它但无 `step`（⛔ 都没有落成 `"unknown"`、⛔ 都没折成 0）。两字段词表不互串：`fanInFailureSteps` 不含 `exited-not-landed`/`completed`/`landed`/`unknown`，与 `finalStates` 的键集亦不同形。

### AC7 — 样本不足 ⇒ evaluated:false 且不伪装成 0

```
[AC7](a 账本空) {"evaluated":false,"reason":"relaxed side: 0 measurable task(s) < MIN_COMPARABLE_TASKS=1; control side: 0 measurable task(s) < MIN_COMPARABLE_TASKS=1 — both counts: relaxed=0, control=0 (ledger records=0, ledger present=false, window=none)","extra":"NOT-EVALUATED","controlMedian":"NOT-EVALUATED","controlTasks":0}
[AC7](b 有放宽无对照) {"evaluated":false,"reason":"control side: 0 measurable task(s) < MIN_COMPARABLE_TASKS=1 — both counts: relaxed=2, control=0 (ledger records=2, ledger present=true, window=set)","extra":"NOT-EVALUATED","controlMedian":"NOT-EVALUATED","controlTasks":0}
[AC7](c 有对照·放宽侧测不出) {"evaluated":false,"reason":"relaxed side: 0 measurable task(s) < MIN_COMPARABLE_TASKS=1 — both counts: relaxed=0, control=3 (ledger records=1, ledger present=true, window=set)","extra":"NOT-EVALUATED","controlMedian":11,"controlTasks":3}
[AC7] MIN_COMPARABLE_TASKS=1 · 下限−1→evaluated=false · 达下限→evaluated=true extra=20
```
三组的 `extraWorkerMinutes` 全部是 `NOT-EVALUATED`，测试对每组显式断言 `!== 0`。**下限常量取 1 的理由**（⛔ 测试内不写这个字面量，靠 `import { MIN_COMPARABLE_TASKS }`）：本报告此刻的任务是把量**做出来**，不是宣称统计强度；1 是最小的、能把「有可测样本」与「一条都测不出」分开的取值，任何大于 1 的取值都会凭空断言一个此刻并未测量的统计充分性（硬规则 4：成本结构未知前不要设数值阈值）。两侧的实际计数（`measurableTasks`）与逐任务明细一并报出，样本够不够由读者判读。

**与 DoD 逐字的偏差（如实写明）**：AC7 第 (c) 组的对照侧是**可测**的（`controlTasks=3`、中位 11），故 (c) 的 `controlMedian` 是 11 而不是 `NOT-EVALUATED`——「不足的一侧」是放宽侧。AC7 原文的形状（「有对照无放宽」）在报表面只能表达为「有对照、放宽侧一条都测不出」，因为窗口由放宽记录的 `dispatchedAt` 界定：账本完全为空时**窗口不存在**，对照组也无从选取（那正是 (a) 组，两组计数同为 0）。这一条同时被 (a) 覆盖，故三组的语义都被验到。

### AC8 — 两次注入各真红（非零退出码 + 失败断言原文）

注入 ①（连接键改成按位置：`ledger.records.map((rec, i) => collectRunStats([outcome.records[i]]))`）：
```
EXIT=1   ℹ pass 6 · fail 2
✖ AC4 — 账本行序 ≠ outcome 行序：连接按任务 id；按位置连接的投影必须与正确读数不同
✖ AC6 — fanInFailureSteps 逐字取自 mechanical_fan_in.step；与 final_state 是两个字段两个词表
  AssertionError [ERR_ASSERTION]: T-A 在 outcome 里有 2 条运行
  1 !== 2
      at TestContext.<anonymous> (.../plugin/test/touches-relax-ledger.test.mjs:260:10)
  AssertionError [ERR_ASSERTION]: 逐字取自 step，按出现序去重
  + actual - expected
    [ 'merge-develop', - 'suite' ]
```
注入 ②（样本不足时把数值写成 `0`：`… : NOT_EVALUATED` → `… : 0`）：
```
EXIT=1   ℹ pass 7 · fail 1
✖ AC7 — 三组样本不足的 fixture：evaluated:false + reason 指名不足的一侧 + 数值取 NOT_EVALUATED(≠0)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  + 0
  - 'NOT-EVALUATED'
      at TestContext.<anonymous> (.../plugin/test/touches-relax-ledger.test.mjs:407:10)
```
两次注入均已撤回：`grep -n "outcome.records\[i\]" plugin/scripts/relaxed-dispatch-ledger.ts` 与 `grep -n "controlMedian : 0;" …` 各**零命中**；撤回后本文件 10/10 连续绿；`git status` 只有本任务 Touches 内的 5 个文件（无注入残留、无夹具残留）。

### AC9 — 静态面五条命令与退出码

```
① bash plugin/scripts/capability-catalog.sh --summary
   capability-catalog: 385 scripts | 385 declared | 0 unclassified | 380 ship     → (unclassified=0)
② git check-ignore -v .quay/relaxed-dispatch.jsonl
   .gitignore:102:**/.quay/relaxed-dispatch.jsonl	.quay/relaxed-dispatch.jsonl     exit=0
③ bash scripts/test.sh plugin/test/carrier-registry-completeness.test.mjs
   ✔ completeness: every carrier name in code is declared in the registry
   ✔ staleness: every registry entry still appears in code (no stale entry)
   ℹ tests 5 · pass 5 · fail 0                                                   exit=0
   docs/carrier-registry.json → {"name":"relaxed-dispatch.jsonl","kind":"jsonl-log",
     "owner":"plugin/scripts/relaxed-dispatch-ledger.ts","readers":"unaudited"}   （owner = 真实存在的新模块）
④ git diff --stat -- plugin/scripts/driver-filters.ts plugin/scripts/worker-driver.ts
   （空）                                                                          exit=0
⑤ bash scripts/test.sh plugin/test/duration-report.test.mjs plugin/test/driver-filters.test.mjs
   ℹ tests 98 · pass 98 · fail 0                                                 exit=0
```

### 附带：CLI 四种退出码实测（--report）

```
--report --root <fixture> --json     → evaluated:true  · extraWorkerMinutes=5（放宽 30/15 分钟 vs 对照 10/20 分钟中位 10）exit=0
--report --root <fixture>            → 人读文本，逐任务打印 blockers / attempts / workerMin / extra / fanInFailureSteps   exit=0
<bogus arg>                          → usage + 退出码 2
--report --root <空 workspace>       → evaluated:false，reason 指名两侧并带计数（relaxed=0, control=0）  exit=3
```

### 静态检查与作用域门

```
bash scripts/test.sh --for-task gap-relaxed-dispatch-ledger-and-merge-cost-report-absent --allow-thin   exit=0
node --no-warnings --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts \
  --task gap-relaxed-dispatch-ledger-and-merge-cost-report-absent \
  --worktree /home/yale/work/quay-worktrees/gap-relaxed-dispatch-ledger-and-merge-cost-report-absent --merge-target develop
  ANTI-DRIFT OK: … 5 actual file(s), all within declared Touches (6 glob(s))   exit=0
```

### 本条的已知边界（⛔ 不省略）

· 判据面是**夹具载体回读**，不是生产载体（DoD 已如实写明；生产消费归 AC-365/366/367）。
· **接线不在本条**：`relaxed-dispatch-ledger.ts` 目前零生产调用者，写入器要等 AC-365/366 从放宽决策点调用它，报告要等人 / AC-367 按需跑 —— 当前 `rhythm-consumer-check` 判据2 由 catalog 的 CONSUMER 行满足（cadence=按需 ⇒ 必须声明谁按，已声明）。
· 对照组选取以放宽记录 `dispatchedAt` 的最早→最晚为窗口，且对照任务的**全部**运行计入其分钟数（两组的归一化与换算函数同一份，故口径相同是结构性质）。
