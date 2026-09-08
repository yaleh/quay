---
id: gap-dead-set-judgment-fail-closed-text-and-removal-proof
title: 死集判定改为文本 fail-closed + 移除证明前移判据（停止枚举调用形式；人 2026-09-08 裁定）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-dead-set-closure-misses-four-reference-kinds
---
## Proposal

**人 2026-09-08 逐字裁定**：「停止补正则、改用『临时 worktree 全量 git mv + 跑 suite』的移除证明作为前移判据，并把收集器改为文本 fail-closed。」

**为何不再补正则（三轮同形，每轮都在派发之后才拦下）**：
- 第一轮 112 名单混入 ≥14 个活 checker → `gap-dead-set-closure-repo-root-call-form-false-positive`（done）补了 `#` 注释屏蔽 + `__dirname` + `$SCRIPT_DIR`。
- 第二轮 82 名单混入 `suite-slot-lib.sh` 等 → `gap-dead-set-closure-misses-four-reference-kinds`（ready，在飞）补了 source/. 内建、活测试钉、config gate、wrapper 委托四类。
- **第三轮（本任务立案当轮实测，2026-09-08）**：该修复产出的 31 名单**仍混入至少 7 个活脚本**，而它自己的闸打印 `PASS: … none in dead set (after=31)`。

**7 个活脚本与各自活证据（逐条实测，非转述）**：

| 脚本 | 活证据 |
|---|---|
| `overhead-instrument.sh` | `scripts/test.sh:951` `source "${repo_root}/plugin/scripts/overhead-instrument.sh"` |
| `run-namespace-sweep-kill.mjs` | `scripts/test.sh:1126/1280/1646` `node --experimental-strip-types "${repo_root}/…"` |
| `state-worded-clause-check.ts` | `scripts/test.sh:313` `run_checker` + `checker-mutation-cases/state-worded-clause-check.sh` |
| `refresh-worktree-quay.sh` | `scripts/test.sh:209` `bash "${repo_root}/…"` |
| `send-to-session.ts` | `driver-runtime.ts:449` `path.join(opts.root,"plugin","scripts","send-to-session.ts")` 后 spawn |
| `tmux-session.ts` | `plugin/test/helpers/hermetic-tmux.mjs:21` `import { tmux } from "../../scripts/tmux-session.ts"`，6+ 活测试经此 helper |
| `tmux-test-isolation-check.ts` | `checker-mutation-cases/tmux-test-isolation-check.sh` |

其中前 4 个由 `scripts/test.sh` **每轮亲自执行** ⇒ 一旦 AC158 按该名单 `git mv`，下一次 suite 立刻失败。

**已证实的根因之一（带能取假的对照）**：`registry-bare-filename-scan.ts` 的 `maskComments` 把 `scripts/test.sh:792` 的**非注释代码行** `local glob=(packages/*/test/*.test.mjs …)` 里的 `/*` 当块注释起点，吞掉其后全部内容。对照：`:222/:270/:465` 三条 `source`（在 792 之前）掩码后存活，`:951`（在其后）被整行抹白；把同一条 `SOURCE_BUILTIN_RE` 对**未掩码**原文跑，四条全中。这与已 done 的第一轮是**同一根因类**——上一轮只修了「`#` 注释里的 `/*`」，没修「代码行里的 `/*`」（硬规则 5b：在某处修好 X ≠ X 只在那一处）。

**但另外 5 个不由它解释**（`:209`/`:313` 都在 792 之前却同样未被收集；`driver-runtime.ts` 的 `path.join(root,…)` 形态、`plugin/test/helpers/` 的相对 import、mutation-case fixture 三类各自独立）⇒ **这不是再补一个正则的问题，是判定范式的问题**：枚举「怎么算引用它」是无界的，而每一轮的负控制都只钉上一轮已知的名字，对新形态恒绿（硬规则 3b：一个恒绿的闸比没有闸更贵）。

**关联**：`gap-ac158-execute-archive-batch-one`（needs-human，被本任务阻塞）、`gap-dead-set-closure-misses-four-reference-kinds`（ready 在飞，本任务 `depends_on` 它以避开 `registry-bare-filename-scan.ts` 的 Touches 冲突；其四类收集器是严格增量，被本任务的 fail-closed 判定吸收而非推翻）、`gap-dead-set-closure-repo-root-call-form-false-positive`（done，第一轮同形）。

## Plan

**① 收集器改文本 fail-closed（`registry-bare-filename-scan.ts`）**
判定改为：**死 ⇔ 窗口内零执行 ∧ 在 `plugin/`、`packages/`、`scripts/`、`.quay/` 下零文本出现**（豁免仅两处：脚本自身文件、其自带测试 `plugin/test/<stem>.test.mjs`）。
- **纯注释提及不自动豁免**：写进显式驳回清单 `docs/analysis/dead-set-comment-only-dismissals.tsv`（四字段 `script · carrier · line · reason`），**未登记即判活**。这把「枚举所有调用形式」（无界）换成「显式驳回 N 条注释提及」（有界、可审）。
- **任何读取/解析失败 ⇒ 判活**，且输出取值与「死」可区分（`NOT-EVALUATED`，⛔ 不与合格共用取值，硬规则 3b）。
- 既有四类/调用形式正则**降级为候选提示**（只用于自动预填驳回清单的 carrier/line 列），**不再参与判定**——判定唯一依据是文本出现与驳回清单。

**② 移除证明脚本（`plugin/scripts/dead-set-removal-proof.ts`）**
`--candidates <json> --root <root>`：建临时 worktree（off `develop`）→ 把候选集全部 `git mv` 进 archive 布局 → 跑 `scripts/test.sh` → 绿则出证明；红则从失败输出定位到脚本名、摘出、重跑至绿。
产物 `docs/analysis/dead-set-removal-proof.json`：候选集逐名清单及其 sha、`suiteVerdict`、摘出名单与各自红证据、`generatedAt`。
**判据**：产物的候选集必须与当轮 `after.dead` 逐名一致，否则报 stale（⛔ 不得采信旧产物）。

**③ 前移**：把 ② 接成【名单面】的 AC（本任务 AC4/AC5），**而不是等 AC158 执行时才由它的 AC5「全量 suite 绿」发现**——后者要烧掉一整个派发周期才拦下，前三轮正是如此。

**④ 重算与同源**：在合并后的树上重跑生成器产出新的 `after.dead`，同步 SPEC §12e 两条机读行 `- 扫描前死集: N` / `- 扫描后死集: N`。⛔ 不手工编辑 JSON。

**⑤ 注册连带**：新脚本进 `capability-catalog.sh` 六表；改 catalog ⇒ 跑 `quay-init-closure-ratchet.ts --reanchor`，并把 `docs/analysis/quay-init-closure-ratchet.baseline.json` 计入本任务 Touches。

## AC

- [ ] AC1 负控制（本轮就能取假）：在**当前 31 名单**上跑新判定 ⇒ **exit 非 0**，且输出**逐条列出**七名 `overhead-instrument.sh` / `run-namespace-sweep-kill.mjs` / `state-worded-clause-check.ts` / `refresh-worktree-quay.sh` / `send-to-session.ts` / `tmux-session.ts` / `tmux-test-isolation-check.ts` 及各自命中载体行（当前实测为 `exit 0` + `PASS … none in dead set (after=31)`，故本条能区分修没修）
- [ ] AC2 fail-closed 取值可区分：对一个构造的不可读/解析失败输入，判定输出 `NOT-EVALUATED`（或等价第三态）而非「死」；一条命令打印该取值，且该取值 ≠ 合格取值
- [ ] AC3 驳回清单双向各取一次：任取一个仅有注释提及的脚本（如 `checker-cost.sh` ← `full-suite-runner.ts:754` 注释），**未登记时判活、登记后判死**，两次取值都打印（⛔ 只跑一个方向不算）
- [ ] AC4 移除证明真跑真 suite：`dead-set-removal-proof.ts` 在临时 worktree 全量 `git mv` 后跑 `scripts/test.sh`，产物 `docs/analysis/dead-set-removal-proof.json` 的 `suiteVerdict == "green"` ∧ `candidates` 与 `after.dead` 逐名一致 ∧ `generatedAt` 晚于本任务实现落地时刻。⊢ 反例判据：把 fixture/注入 seam 关掉后本条仍须通过（硬规则 4 推论三）
- [ ] AC5 移除证明能取假：把已知活脚本 `overhead-instrument.sh` 塞进候选集重跑 ⇒ `suiteVerdict == "red"` 且红证据里出现该脚本名
- [ ] AC6 范式切换的行为判据（临时 workspace，不落库）：造一个零执行记录的探针脚本，并在同一临时树的某个 `.ts` 里以**四类调用形式正则都不认的形式**提及它（如数组字面量 `const S = ["<probe>"]`）⇒ 新判定判它**活**；删掉该提及后重跑 ⇒ 判它**死**。两次取值都打印（⛔ 只跑一个方向不算；旧判定两次都判死，故本条能区分范式是否真的切换）
- [ ] AC7 SPEC 同源：`grep '^- 扫描后死集: ' orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` 取出的数字 == 重算后 `docs/analysis/dead-set-recomputed.json` 的 `after.deadCount`
- [ ] AC8 provenance 已刷新：`dead-set-recomputed.json` 的 `generatedAt` 严格晚于本任务实现落地时刻（⛔ 手工改 JSON 会留旧 `generatedAt`，本条据此取假）
- [ ] AC9 `node plugin/scripts/task-schema-check.ts tasks/gap-dead-set-judgment-fail-closed-text-and-removal-proof.md` exit 0
- [ ] AC10 全量 `scripts/test.sh` exit 0（待外部）

## DoD

死集判定的唯一依据变为「窗口内零执行 ∧ 四目录下零文本出现，注释提及须显式驳回」，读不懂时判活且取值与「死」可区分；`dead-set-removal-proof.ts` 以**真 `scripts/test.sh`** 在临时 worktree 上跑出候选集的移除证明并留产物，该证明成为名单面 AC（在派发 AC158 **之前**执行）；重算后的 `after.dead` 由移除证明背书，SPEC §12e 机读行与之同数。

⛔ 只加正则不改判定范式 / ⛔ 驳回清单由程序自动填理由而无人复核 / ⛔ 移除证明用 fixture 或注入数据代替真 suite / ⛔ 判定在读不懂时返回与「死」同形的值 / ⛔ 手工编辑 JSON 绕过重跑 —— 均**不算达成**。

## Touches

- plugin/scripts/registry-bare-filename-scan.ts
- plugin/test/registry-bare-filename-scan.test.mjs
- plugin/scripts/dead-set-removal-proof.ts
- plugin/test/dead-set-removal-proof.test.mjs
- plugin/scripts/capability-catalog.sh
- docs/analysis/quay-init-closure-ratchet.baseline.json
- docs/analysis/dead-set-recomputed.json
- docs/analysis/dead-set-comment-only-dismissals.tsv
- docs/analysis/dead-set-removal-proof.json
- orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md
- tasks/gap-dead-set-judgment-fail-closed-text-and-removal-proof.md
