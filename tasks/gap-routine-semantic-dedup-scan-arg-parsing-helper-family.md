---
id: gap-routine-semantic-dedup-scan-arg-parsing-helper-family
title: "semantic-dedup-scan: ~60 copies of the same indexOf+next-arg idiom
  across 50+ checker/driver scripts under 9 different names; gate-script-base.ts
  is imported by 246 files yet expor"
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
~60 copies of the same indexOf+next-arg idiom across 50+ checker/driver scripts under 9 different names; gate-script-base.ts is imported by 246 files yet exports no arg helper, and parseJsonArg has 5 copies total (2 more found ad hoc in stage-receipt.ts:833 and workflow-journal.ts:620).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1789723686226` · ts `2026-09-18T09:28:06.226Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`getArgValue`、`argValue`、`getFlagValue`、`parseArg`、`flagVal`、`argvFlag`、`parseJsonArg`、`flag`、`flagValue`
- 涉及文件：finding 列出的 8 条为样本；**全量面见 `## Touches`**（81 个 `plugin/scripts/*.ts` + 1 个测试文件 + **5 个 `experiments/` 镜像副本**）
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Disposition（复核与处置）

**结论：修掉（extract 已落地）。** 结论可核，量法附在下面。

### 1. 复核：finding 成立，且实际面比 finding 记的更大

用「声明体里出现 `(argv|args|process.argv).indexOf(`，且其后 5 行内读到 `[idx + 1]`」这一谓词数
（脚本见本节 §4，`node census.mjs <git-rev|WORKTREE>`）：

```
origin/develop f193716f1（真基准）: 83 declaration(s) of the idiom in 80 file(s)
WORKTREE（merge 后）            : 1 declaration(s) in 1 file(s)   ← gate-script-base.ts (flagValue)，即新正本
```

⇒ **80 个文件里的 83 份手写副本 → 1 份正本。** 副本地毯式覆盖 9 种拼写，其中 finding 未列出的还有
`valueOf`（server-{partial-stop,restart-inflight}-verify）、`getArg`（anti-gaming-guard）、`one`
（channel-probe-server / send-to-session）、`get`（main-thread-edit-check）、`arg`（suite-load-sampler）；
另有 6 份用**前缀变体**（`args.indexOf(`--${name}`)`）——同算法、不同的 needle 构造。

**⚠️ 一处白做的工 + 它暴露的坑（记录，⛔ 不掩盖）**：本 worktree 的分叉点是**本地 `develop`（`b3d0ea5f3`）**，
而 `mirror-measure-history.ts` 已在 `a2530490e`（2026-09-18 04:18Z）被退役、**该提交是 `origin/develop` 的祖先、
却不是 `b3d0ea5f3` 的祖先** ⇒ 本地 `develop` 落后于 `origin/develop`，我因此对一个**上游已死**的文件做了 2 处修改。
merge 时它表现为 `UD` 冲突，处置 = **取 develop 的删除**（`git rm`），该文件**不在本任务 delta 内**、已从 Touches 移除。
⇒ 代价 2 次编辑；教训：**开工时的真基准要取 `origin/develop`，不要取本地 `develop`**（与
`promotion-gate-reads-develop-ref-so-unpropagated-fix-is-invisible` 同族）。

### 2. 处置：三种形态分别对待，⛔ 不是一律合并

**（a）同 arity 的具名函数 → 删掉本地副本，改 import 正本并用正名调用。**
本地名 `getArgValue` / `argValue` / `getFlagValue` / `parseArg` / `flagVal` 在调用点一并改名为
`flagValue`（9 种拼写收敛为 1）。

**（b）闭包 → 收敛为一行 arity 适配器**，⛔ 不是再抄一遍算法：
`const flagVal = (name) => flagValue(args, name);`。这些闭包之所以不是纯粹重复，是因为它们的调用点
只传 flag 名、数组由闭包捕获——适配的是 arity，不是算法。
`inner-wakeup-heartbeat{,-check}` / `pool-quality-judge` / `suite-execution-form-counter` 的
`(name, def)` 双参形态用 `?? def` 保留默认值语义（**精确**：原实现在 flag 存在时返回 `args[i+1]` 原值，
含空串）；`it0-split-or-commit-check` / `ci-runs-collect` / `ci-red-attribute` 的 `null` 返回形态用
`?? null` / `|| null` 逐字保留。前缀变体的 `--` 拼写留在调用点（`flagValue(args, `--${name}`)`），
**token 来源与拼写仍在调用点可见**。

**（c）空串这一格是这些副本唯一真正分歧的输入，取多数形态并把它钉成控制。**
`argv[idx + 1]` 原值返回（多数）vs `argv[idx + 1] ? … : undefined`（falsy 形态，12 处）只在
`prog --flag ""` 上不同：前者 `""`，后者 `undefined`。正本取 `""`——falsy 形态让**用户确实传了的**值
读成「没给」，随后调用点的 `?? default` 静默替换为默认值（硬规则 3b）。
`plugin/test/gate-script-base.test.mjs` 的 `CONTROL:` 用例把**已退役的谓词逐字写出来**，断言两者在该
输入上**可区分**、在其余输入上**逐格一致** ⇒ 若抽取时误选了另一份副本作基准，该用例会红。
（`--flag=value` 形态正本**不支持**：被替换的副本也都不支持（`indexOf` 匹配整 token），
支持它等于一次改动全部调用点的输入语言——已在正本头注释写明。）

### 3. ⛔ 明确【没有】合并的残余，及各自的理由

| 残余 | 量 | 为什么不并入 |
|---|---|---|
| `parseJsonArg` | **6 份声明**（finding 记 5，实测 6：`finding-backpropagate` / `run-identity` / `inner-wakeup-heartbeat` / `execution-policy` / `workflow-journal` / `stage-receipt`） | **三种互不相同的错误契约**：裸 `JSON.parse`（带引号剥离，无包装）/ `throw receiptError("invalid-json", …)` / `throw new Error("invalid-json: …")` / `throw new Error(`${flagName} requires a value`)`（后者 arity 也不同）。合并＝替它们挑一个错误策略，属**决策**不属 dedup；只有 2 份是逐字相同的一对。留待独立任务。 |
| **内联形态** | `(argv\|args)\.indexOf("--…")` 出现在 **28 个文件**（`--root` 独占 16） | **是另一种形态，不是一个函数**：索引是 `main()` 里的局部量，默认值 / `path.resolve` 直接焊在调用点（`const rootArg = args.indexOf("--root"); const root = rootArg === -1 ? … : args[rootArg + 1];`）。抽它要**先定每个调用点的默认值策略**，不是「多提一个 reader」——本任务不顺手改 28 处调用点的取值语义。已量出、已记录，⛔ 不当作「也做完了」。 |

### 4. 可核读数（复现方法）

```js
// census.mjs — node census.mjs <git-rev|WORKTREE>
import { execFileSync } from "node:child_process"; import fs from "node:fs";
const rev = process.argv[2];
const files = rev === "WORKTREE"
  ? fs.readdirSync("plugin/scripts").filter(f => f.endsWith(".ts")).map(f => `plugin/scripts/${f}`)
  : execFileSync("git", ["ls-tree","-r","--name-only",rev,"--","plugin/scripts"], {encoding:"utf8"}).trim().split("\n").filter(f => f.endsWith(".ts"));
const hits = [];
for (const f of files) {
  const src = rev === "WORKTREE" ? fs.readFileSync(f,"utf8") : execFileSync("git",["show",`${rev}:${f}`],{encoding:"utf8"});
  const L = src.split("\n");
  for (let i = 0; i < L.length; i++) {
    if (!/(?:argv|args|process\.argv)\.indexOf\(/.test(L[i])) continue;
    if (!/\+\s*1\s*\]/.test(L.slice(i,i+5).join(" "))) continue;
    for (let j = i; j >= 0 && i - j < 12; j--) {
      const m = L[j].match(/^(?:export )?function (\w+)\s*\(/) || L[j].match(/^\s*(?:const|let) (\w+)\s*=\s*\(/);
      if (m) { if (!["main","resolveRoot","classifyArgv"].includes(m[1])) hits.push({f, n:m[1]}); break; }
    }
  }
}
console.log(`${rev}: ${hits.length} declaration(s) in ${new Set(hits.map(h=>h.f)).size} file(s)`);
```

**行为对照（能取假的量）**：`plugin/scripts/*.ts` 全量逐文件 import/parse 冒烟（每个文件独立子进程，捕获
模块加载错误），**改动前后同为 `252/254` 通过**（merge 前 `253/255`：develop 退役了 1 个文件，故分母 −1）；
2 个失败是**既存**且与本改动无关（`runner-static-gate.ts` 是 fixture；`stale-ready-audit.ts` 需要 `--root`）。
⇒ 若本次改动的任一 import 打错，该数会下降——它是可证伪的对照，不是恒真的回显。
另：merge 后对**已删辅助名**做了悬挂调用扫描（`parseArg(` / `getArgValue(` / `getFlagValue(` / `argValue(`
在注释与声明之外的出现数），**全为 0** —— ⛔ 这是 import 冒烟查不到的一类错（函数体内的 ReferenceError
只有到运行才炸，而 merge 会把 develop 的新代码带进来）。

### 6. 第一次 scoped gate 抓到的一个真缺陷（⛔ 记下来，因为它是这类抽取的**通用**坑）

第一次 `scripts/test.sh --for-task …` 在静态相 **RED**：
`STATIC_CHECK_FAILED: mirror-pair-drift-check exit=1`（fail-closed，测试相未跑）。

根因：本仓库有 **mirror-pair 纪律** —— 5 个被改的 `plugin/scripts/*.ts` 在
`experiments/quay-perpetual-stream/scripts/` 下有**逐字节相同的镜像副本**
（`anti-gaming-guard` / `build-evidence-collector` / `build-evidence-gate` / `gate-script-base` /
`it0-split-or-commit-check`）。**逐字节相同已先在基准提交上核实**（md5 两两相等），所以这不是既存漂移：
是**我只改了镜像的一半**。修法 = 把 5 个 plugin 副本原样拷到镜像侧；checker 随即报
`40 pairs, 38 consistent / 2 drifted (2 allowed)`（2 个 allowed 是既存的 shell 路径深度豁免，与本任务无关）。

⇒ **通用教训**：`experiments/` 下的镜像副本是**生产输入**（实验循环读它们），不是文档投影。
**任何 `plugin/scripts/*.ts` 的改动都要问一句「它有镜像吗」**——`mirror-pair-drift-check` 是机械答案，
但它在**静态相**才跑，所以本地 `--help` 冒烟（我做的 253/255 对照）**结构上抓不到它**。
同一次 gate 还暴露了第二处：我给 53 个文件写的面包屑注释里嵌了**副本计数**，而且是两个不同值
（2 个写 `~57`、50 个写 `~73`，而实测基准是 83 份）——两个数说同一件事就是记录里的缺陷，
且计数写在 53 处必然漂移。**已改为不含计数**，正本数字只留在 `flagValue` 头注释与本节 §1/§4 各一处。

### 7. 遗留（⛔ 不以「已注意到」结案，故写成可执行的下一步）

- `parseJsonArg` 的错误契约统一（6 份 / 3 契约）——**独立任务**，需先裁定错误策略。
- 内联 `--root` 形态（28 文件 / 16 处 `--root`）——**独立任务**，需先裁定「缺省值 vs fail-closed」策略。
  两件都**不在本任务范围内**，此处只登记量与理由，不冒充已做。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `arg-parsing-helper-family`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1789723686226`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `experiments/quay-perpetual-stream/scripts/anti-gaming-guard.ts`
- `experiments/quay-perpetual-stream/scripts/build-evidence-collector.ts`
- `experiments/quay-perpetual-stream/scripts/build-evidence-gate.ts`
- `experiments/quay-perpetual-stream/scripts/gate-script-base.ts`
- `experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts`
- `plugin/scripts/allowed-tools-plugin-prefix-check.ts`
- `plugin/scripts/anti-drift-touches-check.ts`
- `plugin/scripts/anti-gaming-guard.ts`
- `plugin/scripts/build-evidence-collector.ts`
- `plugin/scripts/build-evidence-gate.ts`
- `plugin/scripts/cap-counts-subagents-check.ts`
- `plugin/scripts/channel-probe-server.ts`
- `plugin/scripts/checker-count-drift-check.ts`
- `plugin/scripts/checker-mechanical-spine-check.ts`
- `plugin/scripts/ci-red-attribute.ts`
- `plugin/scripts/ci-runs-collect.ts`
- `plugin/scripts/claim-task.ts`
- `plugin/scripts/concurrency-literal-check.ts`
- `plugin/scripts/criterion-failure-attribution-check.ts`
- `plugin/scripts/dark-axis-record-check.ts`
- `plugin/scripts/deletion-closure-check.ts`
- `plugin/scripts/direct-to-develop-bypass-check.ts`
- `plugin/scripts/external-dogfooding-check.ts`
- `plugin/scripts/fan-in-ac-completion-gate.ts`
- `plugin/scripts/fan-in-ff-protocol-check.ts`
- `plugin/scripts/fan-in-materialize-check.ts`
- `plugin/scripts/fan-in-runid-check.ts`
- `plugin/scripts/fan-in-ts-typecheck-gate.ts`
- `plugin/scripts/fan-in-workflow-retirement-check.ts`
- `plugin/scripts/fast-mode-telemetry.ts`
- `plugin/scripts/fork-baseline.ts`
- `plugin/scripts/full-suite-runner.ts`
- `plugin/scripts/gate-event-coverage-check.ts`
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/goal-driver-task-boundary-check.ts`
- `plugin/scripts/host-repo-surface-ratchet.ts`
- `plugin/scripts/identity-replication-check.ts`
- `plugin/scripts/inner-blocked-signal.ts`
- `plugin/scripts/inner-wakeup-heartbeat-check.ts`
- `plugin/scripts/inner-wakeup-heartbeat.ts`
- `plugin/scripts/instrument-failure-check.ts`
- `plugin/scripts/it0-split-or-commit-check.ts`
- `plugin/scripts/kernel-sibling-resolution-check.ts`
- `plugin/scripts/known-load-sensitive.ts`
- `plugin/scripts/l1-delivery-surface-check.ts`
- `plugin/scripts/landing-target-check.ts`
- `plugin/scripts/main-thread-edit-check.ts`
- `plugin/scripts/measure-trend-check.ts`
- `plugin/scripts/mirror-pair-drift-check.ts`
- `plugin/scripts/outer-retirement-precondition-check.ts`
- `plugin/scripts/pane-state-classify.ts`
- `plugin/scripts/per-task-suite-record-check.ts`
- `plugin/scripts/per-task-suite-record.ts`
- `plugin/scripts/pool-quality-judge.ts`
- `plugin/scripts/pre-verified-round-record.ts`
- `plugin/scripts/primitives-drift-check.ts`
- `plugin/scripts/quay-init-closure-ratchet.ts`
- `plugin/scripts/red-window-triage.ts`
- `plugin/scripts/registry-bare-filename-scan.ts`
- `plugin/scripts/rhythm-consumer-check.ts`
- `plugin/scripts/select-static-checks-for-touches.ts`
- `plugin/scripts/select-tests-for-touches.ts`
- `plugin/scripts/semantic-observer-judge.ts`
- `plugin/scripts/send-to-session.ts`
- `plugin/scripts/server-partial-stop-verify.ts`
- `plugin/scripts/server-restart-inflight-verify.ts`
- `plugin/scripts/spec-declaration-point-check.ts`
- `plugin/scripts/suite-bucket-attribution.ts`
- `plugin/scripts/suite-bucket-drift-check.ts`
- `plugin/scripts/suite-bucket-hub-list.ts`
- `plugin/scripts/suite-bucket-reattr-ratchet-check.ts`
- `plugin/scripts/suite-bucket-select.ts`
- `plugin/scripts/suite-duration-exceed-check.ts`
- `plugin/scripts/suite-execution-form-counter.ts`
- `plugin/scripts/suite-fs-trace.ts`
- `plugin/scripts/suite-load-sampler.ts`
- `plugin/scripts/suite-lock-slots.ts`
- `plugin/scripts/suite-params.ts`
- `plugin/scripts/suite-slot-ssot-check.ts`
- `plugin/scripts/suite-state-trigger.ts`
- `plugin/scripts/supervisor-preempt-candidates.ts`
- `plugin/scripts/target-identity-literal-check.ts`
- `plugin/scripts/task-file-bypass-check.ts`
- `plugin/scripts/test-framework-policy-check.ts`
- `plugin/scripts/test-group-downgrade-check.ts`
- `plugin/scripts/test-isolation-check.ts`
- `plugin/test/gate-script-base.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-arg-parsing-helper-family.md`