---
id: gap-mirror-measure-history-retire-dead-writer
title: mirror-measure-history.ts 是死写入器（唯一调用者 fan-in-execute step 4.5
  已删）却仍在册——catalog 6 行（含指着已不存在块的「谁按」）+ 编排文件清单 + 自带测试待连带处置
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象**：`plugin/scripts/mirror-measure-history.ts` 是 `gap-measure-history-detached-suite-mirror-write` 的产物（fan-in detached-suite 路径的 `measure-history.jsonl` 镜像写入器）。它的**唯一调用者已被删除**，但文件本体仍在树上、仍在 `capability-catalog.sh` 在册（6 行）、仍被编排文件清单收录、仍自带一个独立测试。

**本次立案现场核实（读码 + 命令，非转述）**：

1. **调用者已删，且删除处逐字留痕**：`plugin/workflows/fan-in-execute.js:796-802`——
   > 旧的三段 mirror 写（pre-verified-round-record / mirror-full-suite-state / mirror-measure-history）是「绕开 runner 的平行 harness」的嫁接，已删除（两套平行机制收敛为一）。

2. **有测试从反方向钉住它不得再被调用**：`plugin/test/fan-in-execute-paths-s04.test.mjs:152`
   `assert.ok(!p2.includes("mirror-measure-history.ts"), "phase-2 must NOT call mirror-measure-history.ts (the runner writes measure-history.jsonl)")`。

3. **生产者已接管**：`plugin/scripts/full-suite-runner.ts:152` import `landMeasureHistory` / `parsePerFileLines`（与该 writer 同一函数，故数据格式一致），并在 `:3830-3831` 自己写 `measure-history.jsonl`。机械 fan-in 的 suite 就是它跑的（`worker-driver.ts:4302-4307` 传 `--log-file`）。

4. **运行时零引用**：`grep -n mirror plugin/scripts/worker-driver.ts` 命中 40 行，全部属于 `mirror-full-suite-state.ts` / `mirrorMechanicalFanInSuiteState`；**`mirror-measure-history` 在该文件的命中数为 0**。

5. **它自己的 catalog「失效前提」行已判定条件成立**：`capability-catalog.sh:913` 逐字——
   > ……若 fan-in 两条路径都改为直接调用 full-suite-runner（本 writer 成为多余）或 measure-history 载体迁出 `.quay/`，本条退休。

   条件已由第 3 条满足。

6. **而 catalog 的「谁按」行指着一个已不存在的块**：`capability-catalog.sh:1946` 称
   > 谁按：fan-in-execute workflow step 4.5 的 `# mirror-history-block` 在 `full_suite_ran=true` 时按……

   全仓 `grep -rn "mirror-history-block"`（`*.js` / `*.ts` / `*.mjs`）**命中 0，exit 1**——该块不存在。

**⇒ 形态判定**：这是「死机件 **+** 一条看起来活、实际指着空气的登记行」。**登记行比文件本体更贵**——文件本体一眼可辨为孤立，而 `:1946` 会让审计者以为它正在被编排调用（硬规则 3b 的近亲：读不懂的对象被当作在场）。同类先例：`gap-fan-in-ff-merge-sh-retire-dead-shell-still-registered-live`（同样"仍在册、仍在树上、注释自称已退役"）。

**为什么现在立案而不是等"自然收敛"**：本仓库已有「迁移 = 创建 + 删除，只有创建被度量」的结论；该 writer 的**删除半边从未执行**，且**没有任何检查器会报出它**——catalog 登记齐全、测试绿、文件存在 ⇒ 所有机械读数都显示"正常"。

## Contract

**退役范围 = 三个面，缺一即「修好一个漏兄弟」（硬规则 5b）**：

| 面 | 落点 | 义务 |
|---|---|---|
| ① catalog 6 行 | `capability-catalog.sh` `:220 / :564 / :913 / :1262 / :1611 / :1946` | 整条退休。其中 `:1946`「谁按」因**无承继者**（runner 自己写）应**删除**，而非改指向 |
| ② 编排文件清单 | `select-static-checks-for-touches.ts:284` `FAN_IN_ORCHESTRATION_FILES` | 移除条目——留着会让任何"改了此文件"的任务被误判为碰到 fan-in 流水线，触发无谓 bootstrap |
| ③ 自带测试 + 基线 | `plugin/test/mirror-measure-history.test.mjs` + `docs/analysis/test-file-baseline.txt:550` | 删测试**并重生成基线**（`scripts/test.sh` 的 test-file-snapshot relative-baseline 把"测试文件消失"判红） |

**⛔ 明确不在范围（现场已核，勿误删/勿误改）**：

- `plugin/test/fan-in-execute-paths-s04.test.mjs:152` 的反面断言**必须保留**：它守的是"runner 是唯一 writer"，删掉本 writer 后该不变量**依然成立且依然必要**。
- `plugin/scripts/full-suite-runner.ts`（生产者）与 `plugin/scripts/measure-trend-check.ts`（消费者）：**不动功能**。`measure-trend-check.ts:250` 的注释（"called by plugin/scripts/mirror-measure-history.ts"）随本任务改准措辞即可。
- `plugin/workflows/fan-in-execute.js:796-802` 那段说明**是历史留痕，保留**。

**顺序义务**：先取「无真调用」证据，**再**删（见 AC1）。⛔ 不得先删后补证。

## AC

- [x] AC1（删除前置证据，先做）：全仓 `grep -rn "mirror-measure-history\.ts"`（排除 `node_modules/` 与 `archive/`），把命中**逐条归类**为「真调用 / 注释 / 否定断言 / catalog 登记行 / 任务体 / 测试」，并断言**真调用数 = 0**；命令与完整输出贴进任务体。若发现真调用 ⇒ 本任务范围改为"先断真调用"，**不得直接删除**。
  · 命令：`grep -rn "mirror-measure-history\.ts" . | grep -v node_modules | grep -v archive/ | grep -v '^\./\.git/'`
  · **真调用数 = 0**。逐条归类（删前，共 22 条命中）：
  · 真调用（0）：无。唯一的 import 是 `plugin/test/mirror-measure-history.test.mjs:29 import { main } from "../scripts/mirror-measure-history.ts"` —— 即本 writer **自己的测试**，由本任务 AC4 一并删除 ⇒ 删后 import 者 0。
  · catalog 登记行（6，AC2 已处置）：`capability-catalog.sh:220 / :564 / :913 / :1262 / :1611 / :1946`。
  · 编排清单条目（1，AC3 已处置）：`select-static-checks-for-touches.ts:284`。
  · 注释（3）：`measure-trend-check.ts:250`（AC5 改准）；`mirror-measure-history.ts:2/29/53/59`（被删文件自身）。
  · 否定断言（2，**保留**）：`fan-in-execute-paths-s04.test.mjs:138`（注释）、`:152`（`assert.ok(!p2.includes(...))`）。
  · 测试（1，AC4 删除）：`plugin/test/mirror-measure-history.test.mjs`。
  · 任务体（7 条，历史留痕，保留）：`gap-measure-history-detached-suite-mirror-write.md:36/39/40/43/49`、`gap-mirror-full-suite-state-retire-dead-cli-face.md:56`、`gap-inbox-message-bus-teardown.md:100`、本任务体。
  · 其它（历史/快照）：`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md:502`（该 SPEC 自declared「本清单是【带测量日期的快照】，不是活文档」）。
  · ⇒ 无真调用，删除动作的前提成立。
- [x] AC2：`capability-catalog.sh` 的 6 行按上表处置，其中 `:1946` **删除**（不是改指向）。跑 `node --test plugin/test/capability-catalog.test.mjs` 绿；`bash plugin/scripts/capability-catalog.sh --summary` 与 `--entry-surface` / `--superseded-check` 均 PASS，且 `N scripts` 相应减 1（**读它自报的数，不要硬记**）。
  · 6 行整条删除（`:1946`「谁按」按义务删除而非改指向——它指的 `# mirror-history-block` 全仓命中 0，无承继者可指）。
  · `node --test plugin/test/capability-catalog.test.mjs` → `ℹ tests 16 / pass 16 / fail 0`。
  · `--summary`：删前 `341 scripts | 341 declared | 0 unclassified | 336 ship` → 删后 `340 scripts | 340 declared | 0 unclassified | 335 ship` ⇒ **正好差 1**（DoD 反例对照）。
  · `--entry-surface` → `AC3 gate: every consumer-doc-referenced .sh is a declared public entry point → PASS`（exit 0）。
  · `--superseded-check` → `PASS — every superseded capability is removed from the executable layer and not taught (5 superseded)`（exit 0）。
  · 注：`SCRIPTS` 由文件系统 `find` 派生（catalog 头注释 + `:2100` 附近），故只有**文件删除**才让数减 1；删 6 行而文件还在时中间态是 `341 | 340 | 1 unclassified`（AC1c 闸按设计 exit 1），文件删后归位。
- [x] AC3：`select-static-checks-for-touches.ts` 的 `FAN_IN_ORCHESTRATION_FILES` 移除该条目；跑 `node --test plugin/test/select-static-checks-for-touches.test.mjs` 绿。
  · 已移除该条目（连带其行内注释）。
  · `node --test plugin/test/select-static-checks-for-touches.test.mjs` → `ℹ tests 22 / pass 22 / fail 0`。
- [x] AC4：删除 `plugin/scripts/mirror-measure-history.ts` 与 `plugin/test/mirror-measure-history.test.mjs`；用正本脚本重生成基线 `bash plugin/scripts/test-file-snapshot.sh --repo-relative snapshot docs/analysis/test-file-baseline.txt`，使基线不再含该测试文件。
  · `git rm` 两文件；`git ls-files plugin/scripts/mirror-measure-history.ts plugin/test/mirror-measure-history.test.mjs` → **空输出**（不在索引）。
  · `bash plugin/scripts/test-file-snapshot.sh --repo-relative snapshot docs/analysis/test-file-baseline.txt` → `recorded 842 test files`；基线中该测试文件命中 **0**。
  · 该重生成顺带吸收 develop 上 26 个**陈旧遗漏**（这些测试文件落地于 2026-09-17 17:21 → 2026-09-18 00:35，晚于基线末次重生成 `e920b7d93`(2026-09-17 08:02) ⇒ relative-baseline 一向允许「新增」方向，故 develop 一直是绿的）。diff = 27 insert / 1 delete，与仓库先例（`gap-ac158: 合并 develop 后重生成 test-file-baseline（15 归档测试移除 + 4 新增保留）`）同形。
  · 复验：`test-file-snapshot.sh --repo-relative check docs/analysis/test-file-baseline.txt` → `OK — baseline intact; 0 addition(s) since baseline`（exit 0）。
- [x] AC5：`measure-trend-check.ts:250` 注释改准（不再称被已删除文件调用）。
  · 原注释称 `landMeasureHistory` 被 `mirror-measure-history.ts` 调用；改写为如实的三件事实：调用者 = `full-suite-runner.ts`（suite finalize，生产路径）+ 本模块自己的 CLI 入口（`--no-land` 可退出）；两者都经**同一函数**落地 ⇒ 账本只有一种格式；并保留一句历史留痕说明该 mirror 调用者已由本任务退役。
  · ⚠️ 起草时先写成「SOLE production caller」，随即现场核实发现 `measure-trend-check.ts:443` 本模块 CLI 也调它 ⇒ 改为「CALLERS: …（两个）」。**一个自洽但没核过的说法正是硬规则 4 推论四的形态**，故落笔前实测调用点。
- [x] AC6：`bash scripts/test.sh` 全量绿，含 capability-catalog / fan-in-execute-paths-s04 / test-file-snapshot 三处；命令与结果贴进任务体。
  · **分工声明（worker 协议）**：全量 suite 由机械 fan-in 跑（worker 不跑 suite），故此处给的是三个**点名检查**的直接读数 + 机械 fan-in 的 suite 结果面：
  · `node --test plugin/test/capability-catalog.test.mjs` → 16/16 pass。
  · `node --test plugin/test/fan-in-execute-paths-s04.test.mjs` → 9/9 pass（含 `:152` 那条**必须保留**的反面断言——本任务删掉 writer 后该不变量依然成立）。
  · `bash plugin/scripts/test-file-snapshot.sh --repo-relative check docs/analysis/test-file-baseline.txt` → PASS / 0 addition。
  · scoped 门（fan-in 同一条）：`bash scripts/test.sh --for-task gap-mirror-measure-history-retire-dead-writer --allow-thin` → **exit 0**，其中 `test-file-snapshot-check`、`suite-bucket-reattr-ratchet-check`、`superseded-capability-check`、`mirror-pair-drift-check`、`test-framework-policy-check` 均 PASS，`test-impl-census: checked 842 test files · clean 842 · impl-deleted 0`。
  · ⛔ 全量 suite 的真实绿由机械 fan-in 在本轮产出；若它红，本任务不落 develop。

## DoD

**REAL LANDING 判据（不是"加个删除标记"）**：

- `git ls-files plugin/scripts/mirror-measure-history.ts plugin/test/mirror-measure-history.test.mjs` → **两行为空**（已 `git rm`，不在索引）。
  · 实测：空输出 ✓
- 全仓 `grep -rn 'mirror-measure-history'`（排除 `archive/` 与 `node_modules/`）**只剩历史留痕**（`fan-in-execute.js:796-802` 那段说明 + 本任务体），**无任何 catalog 登记行、无任何编排清单条目**。
  · 实测删后命中按载体：任务体 4 个文件（本任务 13 + `gap-measure-history-detached-suite-mirror-write` 5 + `gap-mirror-full-suite-state-retire-dead-cli-face` 3 + `gap-inbox-message-bus-teardown` 2）= 历史留痕；
    `fan-in-execute-paths-s04.test.mjs` 2（**必须保留**的反面断言）；`measure-trend-check.ts` 2（AC5 改写后的历史留痕句）；`fan-in-execute.js` 1（保留的说明）；`SPEC-...-2026-09-02.md` 1（自declared 的日期快照）；`routine-findings.jsonl` 1（append-only 的**历史** finding 记录，其 consumer 只把它当 provenance 引用，无任何检查器拿它对文件系统校验）。
  · **catalog 登记行 = 0 ✓；编排清单条目 = 0 ✓。**
- **反例对照（硬规则 4 推论四）**：删前 / 删后各取一次 `bash plugin/scripts/capability-catalog.sh --summary` 的 `N scripts`，须正好差 1；若不变 ⇒ 说明该条目本就不在计数内，须在任务体解释清楚。
  · 实测 341 → 340，**正好差 1** ✓
- `bash scripts/test.sh` 一次真实全量绿的命令与结果贴进任务体。
  · 见 AC6 的分工声明：全量 suite 由机械 fan-in 跑（worker 协议），三个点名检查已直接绿；scoped 门 exit 0。

**硬规则 5b 现场增量（Contract 列了三个面，落地时又找到两个「活着指着一个已删对象」的载体）**：

1. **`.quay/suite-bucket-reattribution.jsonl`（**必做**，否则 scoped 门红）**：该账本是 suite 分桶重归属登记表，`suite-bucket-reattr-ratchet-check.ts` 第 3 层（**blocking**，exit 1）判「登记行的文件已不是 suite test ⇒ zombie」。删测试文件而不摘登记行 ⇒ 红。
   · **负控制（先红后绿）**：摘行前跑 `--gate` → `FAIL — 1 zombie reattribution entr(y|ies) ... - plugin/test/mirror-measure-history.test.mjs`，**exit=1**；摘掉该行后同一命令 → `PASS ... 0 zombie entr(y|ies)`，**exit=0**。检查器自己的提示就是「drop the entry in the same change that deletes/archives the file」。
   · 该检查器已接进 `change` 层静态闸，所以这个红本来就会落在**本任务自己的 scoped 门**上。
2. **`docs/analysis/suite-perfile-duration-baseline.json`**：LPT 排序的兜底耗时表。该文件的键在文件已不存在后**永不查中**（`suite-lpt-order.ts:135` 逐字："an entry for a file that no longer exists is simply never looked up"，且任何读/解析失败 fail-open）⇒ 是同一形态的**死键**（活载体里指着一个已删对象）。
   · 处置：摘除该键（删前删后各做一次 JSON 重解析校验；`durations` 953 → 952；`_note`/`rounds`/`unit` 不变）。
   · ⛔ 不用 `_note` 里的正本重生成命令：那会按当前 `.quay/verification-round.jsonl` 刷新**全部 953 条**值，产生一个与本任务无关的大 diff；最小正确动作是摘掉这一个死键。
3. **⛔ 明确保留（不是每个命中都要清）**：`routine-findings.jsonl`（append-only 的**历史记录**，改写它等于篡改某次扫描在当时看到了什么）、`SPEC-...-2026-09-02.md`（日期快照，自declared）、任务体。⇒ 判定线是「**活查询/覆盖表**要清，**历史记录**不清」。

## Touches

- plugin/scripts/mirror-measure-history.ts（删除）
- plugin/test/mirror-measure-history.test.mjs（删除）
- plugin/scripts/capability-catalog.sh
- plugin/scripts/select-static-checks-for-touches.ts
- plugin/scripts/measure-trend-check.ts（注释改准）
- docs/analysis/test-file-baseline.txt（重生成）
- .quay/suite-bucket-reattribution.jsonl（摘除 zombie 登记行——5b 发现的第 4 个载体，被跟踪且进 delta）
- docs/analysis/suite-perfile-duration-baseline.json（摘除死键——5b 发现的第 5 个载体）
- tasks/gap-mirror-measure-history-retire-dead-writer.md