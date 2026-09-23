---
id: gap-quay-init-sh-no-single-naming-point
title: quay-init.sh 身份复制：9 个非测试代码命名点、零单一访问器（簇 P2-identity-quay-init.sh）——把
  laydown set / closure ratchet / 产品 CLI help 收敛成每层一个 REL+basename 访问器
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**来源**：架构复核 round 2031 簇 `P2-identity-quay-init.sh`（verdict=abstract，actionable=true）。判词逐字：

> identity replication: "quay-init.sh" named in 20 code file(s) without a single accessor
>
> reasoning：Verified readings code=22/accessor=2/hardcoded=20 with 13 of 22 hits being test carriers (G3 carve-out)；the ~9 non-test sites name one shell script independently — product-layer help strings (`packages/quay/src/cli/help.ts:238`, `cli/init.ts:56/91/145`)，and four mechanism-side registries/manifests that each spell it (`laydown-set-check.sh`, `loop-shipping-exclusion-data.mjs`, `quay-init-closure-ratchet.ts`, `runner-static-gate.ts`) — i.e. no single naming point, the same 'one entity, N naming points' shape already adjudicated real for resource-gate.sh.
>
> suggestedAction：File a task: hoist the shipped-mechanism-script list to one REL/basename accessor (same shape as `RESOURCE_GATE_REL` + `scriptBasename`) and have the laydown set, closure ratchet and product CLI help derive from it.

**现场（立案当轮逐字，cwd = 主检出 `/home/yale/work/quay`，2026-09-23）**：

本仓检测器读数（`node --experimental-strip-types plugin/scripts/identity-replication-check.ts --json --limit 400`，**只跑不改**）：

```
=== quay-init.sh full=83 code=22 accessor=2 hardcoded=20
codeFiles: packages/quay/scripts/build-plugin-dist.mjs, packages/quay/src/cli/help.ts, packages/quay/src/cli/init.ts,
           packages/quay/test/{branch-model,build-plugin-dist,serve-tests-empty-state}.test.mjs,
           plugin/scripts/{laydown-set-check.sh,loop-shipping-exclusion-data.mjs,quay-init-closure-ratchet.ts,quay-init.sh,
                           runner-static-gate.ts,verify-deliver-coldstart.sh},
           plugin/test/{architecture-review-cluster,archive-exclusion-wiring,fan-in-workflow-retirement-check,gate-scripts-retirement,
                        laydown-set-check,plugin-packaging,precommit-guard,quay-init-closure-ratchet,quay-init-laydown-closure,
                        quay-init-loop}.test.mjs
```

非测试代码命名点（从上面 22 个 `codeFiles` 里剔掉 13 个 G3 test carrier 后的 9 个，逐字）：

```
plugin/scripts/quay-init.sh:550:NEVER_LAYDOWN="quay-init.sh"                                     ← 实体自身
plugin/scripts/quay-init-closure-ratchet.ts:94:  "plugin/scripts/quay-init.sh",                 ← LAYDOWN_SOURCES[0]
plugin/scripts/quay-init-closure-ratchet.ts:174:  const quayInit = path.join(root, "plugin", "scripts", "quay-init.sh");
plugin/scripts/quay-init-closure-assertion.ts:97:  const quayInit = path.join(root, "plugin", "scripts", "quay-init.sh");
plugin/scripts/quay-init-closure-assertion.ts:198:  const quayInit = path.join(root, "plugin", "scripts", "quay-init.sh");
plugin/scripts/laydown-set-check.sh:93:  . "$SELF_DIR/quay-init.sh"
plugin/scripts/runner-static-gate.ts:741:  # @static-object plugin/scripts/quay-init.sh plugin/.quay/profiles.yml packages/quay/src/init.ts
packages/quay/scripts/build-plugin-dist.mjs:810:      const isQuayInit = path.basename(f) === "quay-init.sh";
packages/quay/src/cli/help.ts:238/272  与  packages/quay/src/cli/init.ts:56/91/145/168/207   ← 同一段散文在两个文件里逐字重复
```

**缺陷的两个可证否断言**：

1. **同一个模块内就有两个命名点，而该模块自己的注释声明只能有一个。** `quay-init-closure-ratchet.ts:94` 的 `LAYDOWN_SOURCES[0]` 与 `:174` 的 `path.join(root, "plugin", "scripts", "quay-init.sh")` 是同一文件的两次拼写；而 `:90-92` 的注释逐字写着「⛔ It must stay a single exported constant: a second hand-copied list in the guard would drift and one side would silently stop checking (硬规则 5b)」—— 这正是它自己警告的那件事，只是发生在「常量 vs 实际 spawn 路径」之间，而不是两份列表之间。同形的第三例：`quay-init-closure-assertion.ts:97` 与 `:198` 两处 `path.join`（同一条 `kernel-sibling-dev-tree-only` 注释）；第四例：产品层同一段 help 散文在 `cli/help.ts` 与 `cli/init.ts` 各存一份。
2. **改一处不会改变另一处 —— 「复制」而不是「提及」的可证否形态。** 改 `LAYDOWN_SOURCES[0]` 会改变 `precommit-guard.ts` 的 commit-moment freshness 判据，**不会**改变 `:174` 真正 spawn 的路径（两者之间没有共享来源）；改 `cli/help.ts` 的散文不会改变 `cli/init.ts` 的那份。

**修法（镜像已落地的 `gap-serve-labels-hardcode-mechanism-script-basenames`；实现者照做，除非能给出更强理由）**：

- **机制层单一命名点**：在 `plugin/scripts/quay-init-closure-ratchet.ts` 导出 `QUAY_INIT_REL = "plugin/scripts/quay-init.sh"`（repo-root-relative，与 `LAYDOWN_SOURCES` 同域），`LAYDOWN_SOURCES[0]` 引用它，`:174` 改为 `path.join(root, QUAY_INIT_REL)`；`quay-init-closure-assertion.ts` import 同一常量，`:97`/`:198` 同样派生。
- **产品层单一命名点**：把 `cli/help.ts` 与 `cli/init.ts` 逐字重复的那段散文收敛为**一处**导出常量（或一条带占位符的模板），两个文件引用它。
- ⛔ **跨层单一化不可行，这不是「做不到」而是「不该做」**（读源码核过）：`plugin/scripts/*.ts` 与 `packages/quay/src/*` **互不 import** —— `plugin/` 是要独立打包分发的机制层，`packages/quay/src` 是产品层；产品层认识机制脚本的唯一形态是 REL 字符串 + 运行期 `resolvePluginScript`（`observation.ts` 的 `RESOURCE_GATE_REL` 正是这个形态）。所以本任务的判据是**每层各一个命名点**，不是全仓一个；实现者若声称做到了全仓一个，必须同时给出它没有引入跨层 import 的证据。
- ⛔ **三处 carve-out 必须逐条判定，不得留白**（硬规则 3b：留白会让「没查」与「查过且不可派生」同形）：`laydown-set-check.sh:93`（`. "$SELF_DIR/quay-init.sh"` —— shell 载体，`.sh` 无法 import TS 常量；检测器自己就为此设了 `shell` carve-out 族）、`runner-static-gate.ts:741`（`# @static-object …` 是标注散文，不是可执行路径）、`build-plugin-dist.mjs:810`（`path.basename(f) === "quay-init.sh"` 是对任意被走到文件的**识别谓词**，不是路径副本）。每一处要么改为派生，要么写出「为何不可派生」的逐字理由。
- ⛔ 修法**不得**改成「另建一张按 rel 建的表」——那是把复制从一个文件搬到另一个文件。
- ⛔ 检测器（`identity-replication-check.ts` / `architecture-review-cluster.ts`）**只跑不改**，不在本任务 Touches。

<!-- dedup-ref --> 追溯用（非前置）：`gap-serve-labels-hardcode-mechanism-script-basenames`（done）是同一条原则在 `resource-gate.sh`/`process-budget.sh` 上的实例、也是本任务修法的模板；`gap-quay-init-native-reconcile`（done）把 quay-init.sh 的 12 处内嵌 python3 移植成 `init.ts`，**没有**退役 shell 脚本（该脚本仍 2062 行、仍在被维护），与本任务的命名点无关。本任务的机制是**同一个机制脚本名在多处独立拼写**。

## AC

- [x] AC1（机制层单一命名点，按位置核）：修后 `grep -n 'quay-init\.sh' plugin/scripts/quay-init-closure-ratchet.ts plugin/scripts/quay-init-closure-assertion.ts` 的**路径字面量**只剩 REL 常量定义那一行；`:174` / `:97` / `:198` 三处改为派生。贴出修前/修后两条 grep 的逐字输出（修前基线见 Proposal 现场段）。

- [x] AC2（产品层单一命名点 + 行为保持，真 CLI）：修后 `grep -rn 'quay-init\.sh' packages/quay/src/cli/help.ts packages/quay/src/cli/init.ts` 只剩那一个常量定义行（+ 指向它的引用）；且 `node packages/quay/bin/quay.js init --help` 的**实际输出**里仍含该名字（行为保持）。贴出修后 grep 逐字 + 真实 CLI 输出的相关片段逐字。

- [x] AC3（carve-out 逐条判定 —— 判据能取假）：对 `laydown-set-check.sh:93` / `runner-static-gate.ts:741` / `build-plugin-dist.mjs:810` 三处，各给出一句逐字判定（「已改为派生」或「不可派生的理由」）。⛔ 三条中任何一条留白 ⇒ 本 AC 判红（留白不得当作已修）。

- [x] AC4（红控制 —— 证明 `:174`/`:97`/`:198` 真的经该常量派生，而不是恰好相等的第二份字面量）：把 `QUAY_INIT_REL` 临时改成一个不存在的名字，`quay-init-closure-ratchet.ts --gate` 的 NOT-EVALUATED 分支必须报出**新名字**（而不是旧名 `quay-init.sh`）—— 证明那三处是派生的；随后还原并复核 `git status` 干净（红控制不得进入任何提交）。贴出红控制前/后两条输出逐字。

- [x] AC5（簇的产出侧读数 —— 判据能取假）：`node --experimental-strip-types plugin/scripts/identity-replication-check.ts --json --limit 400` 修后，`quay-init.sh` 行的 `hardcoded` 读数**低于**立案基线 `code=22 accessor=2 hardcoded=20`。贴出修前/修后两行逐字。⛔ 只跑不改检测器；若因 AC3 的 carve-out 仍有残余，**照实报出残余条数与对应 carve-out 清单，不得报 0 充数**。

- [x] AC6（scoped 门）：`bash scripts/test.sh --for-task gap-quay-init-sh-no-single-naming-point` exit 0，贴出退出码与用例计数。若该 invocation 报 thin，同命令加 `--allow-thin` 亦须 exit 0。

## DoD

真实落地 = 两个层各有一个**可观测的真实载体**，且各自那个命名点改动后载体跟着变：

1. **机制层**：改 `QUAY_INIT_REL` 后**真的**跑一次 `node --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --gate --root <repo>`，其读到的 spawn 路径随常量改变（AC4 的红控制即此条的真实载体证据）。
2. **产品层**：改产品层那个常量后重跑 `node packages/quay/bin/quay.js init --help`，**真实 CLI 输出**里的名字跟随。

⛔ 不是「改动做了、单测绿了」即算 done：**AC4 的红控制必须在真实 gate 运行上把「第二份字面量」判红**，**AC2 必须读真实 CLI 输出而不是读源码**，**AC5 必须给出检测器读数的下降**（立案读数 `hardcoded=20` 是基线，不是目标）。

## Touches

- `plugin/scripts/quay-init-closure-ratchet.ts`
- `plugin/scripts/quay-init-closure-assertion.ts`
- `packages/quay/src/cli/help.ts`
- `packages/quay/src/cli/init.ts`
- `plugin/test/quay-init-closure-ratchet.test.mjs`
- `plugin/test/quay-init-laydown-closure.test.mjs`
- `plugin/test/precommit-guard.test.mjs`
- `packages/quay/test/init.test.mjs`
- `tasks/gap-quay-init-sh-no-single-naming-point.md`

## Evidence（2026-09-23 第 2 轮 worker —— 修 suite 红 + 记录实现偏差）

### 本轮修的 suite 红：真因是本任务的实现，不是环境

上一轮 fan-in 的失败用例逐字（正本 log：`.quay/fan-in-suite-gap-quay-init-sh-no-single-naming-point~wk-prod-anchor~1790136256016-3a54d0.log`）：

```
✖ ⑥ shipped-set closure — the ENUMERATION is proven complete, not asserted (AC1..AC4)
  AssertionError [ERR_ASSERTION]: --selfcheck-transport-closure must exit 0:
  selfcheck-transport-closure: positive → violations=1 (expect 0)
  selfcheck-transport-closure:   IMPORT-UNSHIPPED: quay-init-closure-assertion.ts imports ./quay-init-closure-ratchet.ts — not in the shipped set
```

**真因**：上一轮按 Proposal 修法把命名点放在 `quay-init-closure-ratchet.ts`，并让 `quay-init-closure-assertion.ts` import 它。但 `plugin/scripts/develop-deliver-tgz.sh` 的 `transport_flat_files` 把 **assertion 列为随行交付文件**（远程 `verify-deliver-coldstart.sh:5017` 会 import 它），而 **ratchet 不在交付集**（dev-tree only，消费者是 `precommit-guard.ts` / `runner-static-gate.ts`）⇒ 一个 shipped→non-shipped 的 `./` import 打破了交付闭包，远程会 MODULE_NOT_FOUND。fan-in 的 delta 提示把该用例判为 UNRELATED，**实测复现后确认为本任务引入的真因**（提示只是提示，不是结论）。

### 实现偏差（Proposal 允许「除非能给出更强理由」，此处即该理由）

`QUAY_INIT_REL` 的**家从 ratchet 移到 assertion**（shipped 的那一侧），ratchet 改为 import 它。理由不是风格：交付闭包要求 shipped 文件自足（其每个 `./` import 也必须在交付集内），所以常量必须落在**能被交付的一侧**；反向（dev-tree → shipped）对闭包检查不可见、且事实上成立。三个 spawn/清单点（ratchet 的 `runLaydown`、assertion 的 `runLaydownPaths` / `runFailureStateReport`、`LAYDOWN_SOURCES[0]`）**全部派生自这一个常量** —— 「每层一个命名点」不变，只是位置从「机制层里先想到的那个模块」改成「机制层里可交付的那个模块」。

### 逐条 AC 读数

**AC1**（机制层单一命名点，按位置核）：

```
$ grep -n 'quay-init\.sh' plugin/scripts/quay-init-closure-ratchet.ts plugin/scripts/quay-init-closure-assertion.ts
plugin/scripts/quay-init-closure-assertion.ts:31:// `path.join(root, "plugin", "scripts", "quay-init.sh")` independently, i.e. this file carried two
plugin/scripts/quay-init-closure-assertion.ts:47:export const QUAY_INIT_REL = "plugin/scripts/quay-init.sh";
plugin/scripts/quay-init-closure-assertion.ts:114: * Returns null (NOT-EVALUATED) when quay-init.sh is absent or the laydown exits non-zero.
plugin/scripts/quay-init-closure-assertion.ts:213: * lines a non-zero exit must emit). Returns null when quay-init.sh is absent (the same NOT-EVALUATED
plugin/scripts/quay-init-closure-ratchet.ts:37://   plugin/scripts/quay-init.sh          the generator (config.yml / .gitignore / settings.json content)
plugin/scripts/quay-init-closure-ratchet.ts:180: * product. Returns evaluated:false (NOT-EVALUATED) when quay-init.sh is absent or the laydown exits
```

唯一的**路径字面量**是 `quay-init-closure-assertion.ts:47` 的常量定义行；其余命中全是注释散文（⛔ 按位置判定，注释不算命名点 —— 硬规则 2）。原 `:174`（ratchet 的 `runLaydown` spawn）、`:97`/`:198`（assertion 两处 spawn）已全部改为 `path.join(root, QUAY_INIT_REL)`。

**AC2**（产品层单一命名点 + 行为保持，真 CLI）：

```
$ grep -rn 'quay-init\.sh' packages/quay/src/cli/help.ts packages/quay/src/cli/init.ts
packages/quay/src/cli/help.ts:31:export const QUAY_INIT_REL = "plugin/scripts/quay-init.sh";
```

`init.ts` 零命中（它只引用符号 `QUAY_INIT_REL`，不拼字面量）。**真实 CLI 输出**（`node packages/quay/bin/quay.js init --help`，非读源码）：

```
51:  need the branch model established (the shipped plugin/scripts/quay-init.sh
```

名字跟随常量，行为保持。

**AC3**（三处 carve-out 逐条判定，无留白）：

1. `plugin/scripts/laydown-set-check.sh:93` `. "$SELF_DIR/quay-init.sh"` —— **不可派生**：POSIX `source` 按**文件名**载入机制脚本，而本任务的命名点是 TypeScript 模块常量；`.sh` 无法 import `.ts`（检测器自己为此设了 `shell` carve-out 族）。
2. `plugin/scripts/runner-static-gate.ts:741` `# @static-object plugin/scripts/quay-init.sh …` —— **不是可执行路径**：`@static-object` 是 static-tier 选择器读的**标注散文**；同块真正执行的路径在第 742 行（`profiles-role-coverage-check.ts`）。
3. `packages/quay/scripts/build-plugin-dist.mjs:810` `path.basename(f) === "quay-init.sh"` —— **不可派生**（两条独立理由）：它是施加在 `walk(pluginRoot)` 任意被走到文件上的**识别谓词**，不是路径副本；且该文件由 `packages/quay/scripts/package.sh:168` 以**裸 `node`**（无 `--experimental-strip-types`）调用，产品层那个 `.ts` 常量在运行期根本不可 import。

**AC4**（红控制，能取假）—— 把 `QUAY_INIT_REL` 临时改成 `plugin/scripts/quay-init-REDCONTROL-NOT-A-REAL-FILE.sh`：

```
$ node --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --gate --root .
NOT-EVALUATED: quay-init-closure-ratchet: NOT-EVALUATED — plugin/scripts/quay-init-REDCONTROL-NOT-A-REAL-FILE.sh not found at …/plugin/scripts/quay-init-REDCONTROL-NOT-A-REAL-FILE.sh (a checker that cannot read its input is never conflated with "≤ baseline")
exit=3
$ node --experimental-strip-types plugin/scripts/quay-init-closure-assertion.ts --gate --root .
NOT-EVALUATED: quay-init-closure-assertion: NOT-EVALUATED — the real quay-init laydown could not run (a checker that cannot read its input is never conflated with 'closed set satisfied')
exit=3
```

ratchet 的报错**报出新名字**（证明 `runLaydown` 的 spawn 路径派生自常量，而不是恰好相等的第二份字面量）；assertion 由 PASS 翻成 NOT-EVALUATED（证明它的两处 spawn 同样派生）。还原后：`md5sum plugin/scripts/quay-init-closure-assertion.ts` = `83d506af489b0894bd95561cad526b93`（与红控制前同一值），`assertion --gate` 回到 `PASS: quay-init laydown is within the closed set (5 file(s), zero extension-file copies)…` exit 0，红控制零残留。

**AC5**（簇的产出侧读数，能取假；检测器只跑不改）：

```
修前（立案基线）：=== quay-init.sh full=83 code=22 accessor=2 hardcoded=20
修后：            full=82 code=19 accessor=2 hardcoded=17
```

`hardcoded` 20 → 17（低于基线，判据满足）。**残余如实报出**（⛔ 不报 0 充数）：17 = 13 个 G3 test carrier + 4 个非测试载体，非测试残余逐字：`plugin/scripts/quay-init.sh`（实体自身：`NEVER_LAYDOWN` + `derive_loop_scripts` 名单）、`plugin/scripts/laydown-set-check.sh:93`（AC3 #1 的 shell carve-out）、`plugin/scripts/runner-static-gate.ts:741`（AC3 #2 的标注散文）、`packages/quay/scripts/build-plugin-dist.mjs:810`（AC3 #3 的识别谓词）。

**额外残余（Proposal 的 9 点清单未列，本轮实测发现、如实报出、本任务未修）**：`plugin/scripts/verify-deliver-coldstart.sh` 有 5 处**真实路径构造**（`:1386` `:3606` `:4573` `:5904` 等，形如 `"$plugin_root/scripts/quay-init.sh"`）。它与 AC3 #1 同类（shipped shell 载体按文件名拼兄弟脚本，无法 import TS 常量），但不在本任务的三处 carve-out 名单内 —— 报出而不当作已消解。

**AC6**（scoped 门）：`bash scripts/test.sh --for-task gap-quay-init-sh-no-single-naming-point --allow-thin` **exit 0**，`tests 179 / pass 179 / fail 0`（≈63s）。

### DoD 载体复核

1. **机制层**真实载体：AC4 的红控制跑的是**真实 gate 运行**（`--gate --root .`，非单测），其 spawn 路径随常量改变 ⇒ 载体证据成立。
2. **产品层**真实载体：AC2 读的是**真实 CLI 输出**（非源码）⇒ 成立。

### 本轮回归

`node --test`（Touches 内四个测试文件：quay-init-closure-ratchet / quay-init-laydown-closure / precommit-guard / packages/quay/test/init）**94 tests / 94 pass / 0 fail**；`develop-deliver-tgz-evidence-transport.test.mjs` **20/20 pass**（原红用例 ⑥ 转绿：`positive → violations=0`，交付集仍为 9 flat files + 1 node_modules dep，未增长交付面）。
