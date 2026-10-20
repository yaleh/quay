---
id: gap-ac347-criterion-reanchor-after-core-sink
title: AC-347 判据重锚：parseFidelityVerdict 的委托已随 core/ 下沉重落到
  core/criterion-fidelity.ts（src 根文件只剩转发），恢复范围护栏
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-347
---
**type:** execution

## Proposal

AC-347 当前记录为 FALSE（本轮直接重跑判据，不是账本尾巴：exit 1，`CAUSE=fidelity-not-delegated — criterion-fidelity.ts does not call parseBinaryVerdict`）。但被测量的对象本身仍然成立——偏掉的是**判据里的路径钉**，不是实现。

**为什么上一次的修复没能保持**：任务 `gap-goal032-verdict-parser-kernel-extraction` 在提交 `ec0b1a8f7` 把委托落在 `packages/quay/src/criterion-fidelity.ts`，AC-347 于 2026-10-09 判过 pass。之后提交 `35dc5da93`（`refactor(core): sink the gate substrate into src/core to break the ""<->gate directory SCC`）把实现整体下沉到 `packages/quay/src/core/criterion-fidelity.ts`，src 根文件改为纯转发（`export * from "./core/criterion-fidelity.ts";`）。没有机制把「判据钉的路径」与「实现实际所在的路径」对齐检查，于是代码没退化、判据却转红。

**当前事实（本轮在主检出实测，不是推断）**：

- `packages/quay/src/kernel/verdict-parse.ts:39` — `export function parseBinaryVerdict(...)`，零 import，kernel 边界成立。
- `packages/quay/src/core/criterion-fidelity.ts:76-78` — `export function parseFidelityVerdict(...)` 薄包装，`return parseBinaryVerdict(stdout, exitCode, "faithful", "vacuous");`；`:226` 的调用点 `parseFidelityVerdict(res.stdout, res.exitCode)` 逐字未变。
- `plugin/scripts/goal-driver.ts:1205` — 经 `parseBinaryVerdict` 委托；`:1377` 的调用点 `parseSemanticSufficiencyVerdict(r.stdout, r.status)` 逐字未变。
- `packages/quay/src/criterion-fidelity.ts` — 只剩转发 re-export；其文件头明令禁止把实现加回来（那会重新拉回 src-root ↔ gate 的目录 SCC）。
- 四个 routine-quota 文件对 develop 的 diff 为空。

**所以修法是 re-anchor，不是搬代码**：把判据的「实现落点」改成当前位置，并把「旧函数是薄包装」这条断言写成**位置无关**的（在 `packages/quay/src` 下恰好存在一个 `export function parseFidelityVerdict` 定义，且它调用 `parseBinaryVerdict`）。⛔ 不要把实现搬回 src 根，⛔ 不改 routine-quota 文件。这样下一次文件再搬家时，判据仍然测的是同一件事，而不是同一串路径。

## Plan

1. 在暂存文件里写出重锚后的判据（例如 `.quay/ac347-reanchor-criterion.sh`），保持三态契约：0 = pass；1 = fail 且带 `CAUSE=`；3 = 未评估。

   必须包含的检查（可调整写法，但不得弱化）：
   - a. kernel 正本：`packages/quay/src/kernel/verdict-parse.ts` 存在、含 `export function parseBinaryVerdict`、import 只允许 `./` 或 `node:`（与现判据同形）。
   - b. fidelity 薄包装，**位置无关**：`grep -rl --include='*.ts' -E '^export function parseFidelityVerdict' packages/quay/src` 的结果**恰好 1 个文件**；该文件同时含 `parseBinaryVerdict`。数量 ≠ 1 ⇒ `CAUSE=fidelity-not-thin-wrapper-or-duplicated`（两个定义 = 半搬壳；零个定义 = 函数被删）。
   - c. 同一文件里调用点逐字不变：`parseFidelityVerdict(res.stdout, res.exitCode)`。
   - d. 公共导入面未破：`packages/quay/src/criterion-fidelity.ts` 仍转发到 core（`export * from "./core/criterion-fidelity.ts"`）。
   - e. goal-driver：含 `parseBinaryVerdict`、含 `export function parseSemanticSufficiencyVerdict`、调用点 `parseSemanticSufficiencyVerdict(r.stdout, r.status)` 不变。
   - f. 范围护栏不变：`git diff develop --` 对 `plugin/scripts/drivers.yml`、`driver-config.ts`、`routine-file-gate.ts`、`probe-routine.ts` 四者均无内容。

   判据注释里写明「为什么是 re-anchor」：理由是 core 下沉后的转发结构，⛔ 不要把已退役的旧路径当作理由。

2. 两侧验证（硬规则 2：一个会失败的量，必须同时给出它会通过、也会失败的读数）：
   - **必须通过**：在当前树上原样跑新判据 ⇒ `PASS`，exit 0。
   - **必须能假**：在 `/tmp` 下建一个一次性 git 仓库桩（含 kernel 文件 + 一个定义了 `parseFidelityVerdict` 但**不**调用 `parseBinaryVerdict` 的 `core/criterion-fidelity.ts` + 其余被钉的文件），在同一判据下运行 ⇒ exit 1、`CAUSE=fidelity-not-delegated`。证不出这条 ⇒ 谓词是空转的，不得结案。
   - 两个退出码与首行输出都贴进 `## Evidence`。

3. 把新判据写入 goal record（AC-347 的正本是 record 本身，不是任务体）：
   `node packages/quay/bin/quay.js goal write AC-347 --criterion "$(cat <criterion-file>)" --expect "<同样 0/1/3 契约，CAUSE 列表有变就同步>" --root /data/home/yale/work/quay`
   （更新时 `--origin` 可选，patch 语义）。确认 `goals/AC-347-*.md` 内含新判据；store 若未自动提交，就随本任务一起提交该 goal 文件。⛔ 不手工改 AC-347 的 status——它由 goal driver 依 gate verdict 翻转。

4. 用**record 自己的**判据再跑一次（不是跑副本）：`node packages/quay/bin/quay.js goal gate AC-347 --root /data/home/yale/work/quay` ⇒ exit 0 / `pass`。这一条读数才是把账本尾巴翻绿的那条。

5. 自检并落地：`node plugin/scripts/task-schema-check.ts tasks/gap-ac347-criterion-reanchor-after-core-sink.md` exit 0；`node packages/quay/bin/quay.js task check gap-ac347-criterion-reanchor-after-core-sink --json` 的 `missing` 为 `[]`；随后按任务落地路径提交（只含 goal 文件与本任务文件）。

## Acceptance Criteria

- [ ] AC1：AC-347 record 内已含重锚后的判据——`node packages/quay/bin/quay.js goal show AC-347 --json --root /data/home/yale/work/quay` 的输出里可见：(i) kernel `parseBinaryVerdict` 检查，(ii) 位置无关的 `export function parseFidelityVerdict` 唯一性扫描，(iii) src 根转发检查，(iv) goal-driver 三项，(v) 四个 routine-quota 文件；命令 exit 0
- [ ] AC2：判据在当前树为真——`node packages/quay/bin/quay.js goal gate AC-347 --root /data/home/yale/work/quay` 报 `pass` / exit 0；把同一判据抽出为脚本单独跑也输出 `PASS` / exit 0（两者都贴）
- [ ] AC3：判据能取假——同一脚本对「缺委托」的一次性桩仓库运行 ⇒ 输出 `CAUSE=fidelity-not-delegated` / exit 1（贴命令与输出）。⛔ 给不出这条读数的判据视为空转
- [ ] AC4：未搬代码、未越界——`grep -c "export function parseFidelityVerdict" packages/quay/src/criterion-fidelity.ts` 为 0，且该文件仍以 `export * from "./core/criterion-fidelity.ts";` 转发；四个 routine-quota 文件 `git diff develop --stat` 为空；本任务分支 `git diff --name-only develop` 只出现 goal record（以及任务协议自身落地的本任务文件）
- [ ] AC5：委托行为仍被既有测试钉住——`node --experimental-strip-types --test packages/quay/test/verdict-parse.test.mjs plugin/test/criterion-fidelity-gate.test.mjs` exit 0，且未改任何测试断言
- [ ] AC6：留痕——本任务 `## Evidence` 含 before（`exit 1`、`CAUSE=fidelity-not-delegated`）与 after（`exit 0`、`PASS`）读数、负对照读数、以及承载新判据的 commit sha

## Definition of Done

AC-347 的 record 本身携带重锚后的判据；该已记录判据对当前树判 `pass`（exit 0），对「委托被摘掉」的桩判 `CAUSE=fidelity-not-delegated`（exit 1）；委托实现仍在 `packages/quay/src/core/criterion-fidelity.ts`，src 根文件仍是转发 re-export；routine-quota 文件未被触碰；goal record 的变更已提交。

## Evidence

（待执行者填写：before/after 退出码、负对照、commit sha）

## Touches

- goals/AC-347-结构与范围护栏-kernel-verdict-parse-ts-提供-parsebinaryverdict-两个旧函数薄.md
- tasks/gap-ac347-criterion-reanchor-after-core-sink.md
