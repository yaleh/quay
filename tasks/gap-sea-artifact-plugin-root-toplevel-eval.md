---
id: gap-sea-artifact-plugin-root-toplevel-eval
title: SEA 产物的 quay serve 可用：plugin-root.ts 顶层求值 import.meta.url 归零（惰性化进函数）+ 立起
  ci-runs.jsonl 的 seaVerify 载体字段（AC-267）
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-267
---
**type:** execution

## Finding

**缺口一｜AC-267 的静态臂今天有且只有 1 个命中，且就是立案时点名的那个位置（直接量）**

2026-09-15 立案当轮，逐字重跑 AC-267 的 criterion（代码取 `goals/AC-267-goal.md` 的 `criterion:` 块）：

```
CAUSE=top-level-eval-remains — 1 hit(s): [(33, 'const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));')]
EXIT=1
```

与该 AC 的 origin 逐字一致（`plugin-root.ts:33`）。⇒ **静态臂的基线是「1」，不是「未知」；修复后的合格读数是「0」。**

**缺口二｜修它不是删一行：`MODULE_DIR` 是解析链的锚，动的是求值时机，不是取值**

`packages/quay/src/plugin-root.ts` 全文只有 3 处用到它：

```
:33  const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));   ← 模块顶层，import 即执行
:92  const main = mainCheckoutRoot(MODULE_DIR);                         ← resolvePluginRoot() 内
:98  return resolvePluginRootFrom(MODULE_DIR);                          ← resolvePluginRoot() 内
```

`MODULE_DIR` 未导出，只有 `resolvePluginRoot()` 两个调用点消费它 ⇒ **惰性化的改动面是封闭的**：把求值搬进一个函数、`resolvePluginRoot()` 改为调用该函数；对外签名（含 `resolvePluginRootFrom(startDir)` 这个 test seam）不变。

**⚠️ 缺口三｜照抄已 done 的兄弟修复会【静默不达标】**（本案最容易踩的坑）

同类缺陷在 `packages/quay/src/gate/registry.ts:14` 已于 `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH`（status: done）修过，其形状是：

```ts
declare const __dirname;
var moduleDir = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
```

**这一行仍然是「缩进 0 + 含 `import.meta.url` + 含 `var`」⇒ 会命中 AC-267 的按位置判定。** 该形状靠三元短路在**运行时**避开求值，而**判据判的是位置，不是短路**。⇒ 本任务必须采用**函数体内求值**的形状（判据注释逐字：「A mention inside a function body is indented and is exactly the fix shape, so it must NOT match」）。

硬规则 5b 的扫描（立案当轮全仓按同一谓词跑）只有两个顶层站点：`plugin-root.ts:33`（本 AC 管）与 `gate/registry.ts:14`（**本 AC 不管**，⛔ 不要顺手改它以制造 Touches 外的 delta）。

**⚠️ 同族陷阱：判据只剥 `//`，不剥 `/* */`。** 若把 `import.meta.url` 留在缩进 0 的 `/** */` 块注释行上、且该行还含 `=` 或 `const|let|var`，**照样命中**。修复必须避开这个形状。

**缺口四｜载体臂今天结构性不可达：`seaVerify` 全仓没有任何生产者**

- `.quay/ci-runs.jsonl` **不存在**（`ls` 实测 No such file）。
- 全仓 grep `seaVerify`：**只出现在 `goals/AC-267-goal.md` 自己**（其余 0 处）。
- 兄弟任务都不产出它：AC-265 的 `plugin/scripts/ci-runs-collect.ts` 规约的是 `testFiles`；AC-269 的 `plugin/scripts/ci-red-attribute.ts` 规约的是 `attribution`。**没有任何任务规约 `seaVerify`。**

⇒ **即使代码修得完全正确，AC-267 仍会停在 `CAUSE=carrier-absent`。** 这正是硬规则 4 推论三（「实现了、测试绿了、但生产没跑过」）的另一半形态：这里连「能产出该读数」的**载体字段本身**都还没有 ⇒ 本任务必须**同时**把 `seaVerify` 的字段契约立起来，否则本 AC 是一个永久红。

<!-- dedup-ref -->
**去重与归属（机制级，非关键词级）**：`seaVerify` 的写入面是 `plugin/scripts/ci-runs-collect.ts` —— 该文件在 `tasks/gap-develop-ci-first-decisive-green.md`（AC-265）与 `tasks/gap-ci-red-attribution-classifier.md`（AC-269）的 `## Touches` 里各已声明一次。本任务**不重复它们的规约**，只加 `seaVerify` 一族派生；三个任务的 Touches 互斥会按设计串行，先落地者先写、后到者 rebase。⛔ 本段只作溯源，不构成前置声明。

**载体窗口的一个已知特性（不是本案的缺陷，但读数时会遇到）**：AC-267 的 `land` 取 `git log -1 --format=%cI -- packages/quay/src/plugin-root.ts` ⇒ **任何人此后再次提交该文件，窗口起点都会前移**，早先的 release run 会被挤出窗口。收口时按当轮的 `land` 实际读数记录，不要假定它等于本任务的落地时刻。

## Requested action

1. **惰性化 `plugin-root.ts` 的自定位**：把 `MODULE_DIR` 的求值搬进一个函数（如 `function moduleDir(): string`），函数体内用 `typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url))` 或等价的 SEA-safe 形式；`resolvePluginRoot()` 的两处消费改为调用该函数。⛔ 缩进 0 处不得再留任何含 `import.meta.url` 的声明/赋值行（含 `/** */` 注释行）。
2. **保住解析行为**：`resolvePluginRoot()` 的解析顺序（`QUAY_PLUGIN_ROOT` → 工作树 main-checkout → walk-up）与返回值不变；`resolvePluginRootFrom(startDir)` 这个 test seam 的签名不变。
3. **落地 `seaVerify` 字段**：在 `ci-runs-collect.ts` 中对 `workflow ∈ {release.yml, Release}` 的记录派生 `seaVerify`，取值来自 release workflow 的 SEA 验证 job（`sea-verify-node-free`，跨平台 counterpart `sea-verify-node-free-cross-platform`）的 conclusion：**全部存在且全为 success ⇒ `"success"`**；任一失败 ⇒ 非 `"success"`；job 缺失/读不到 ⇒ 一个**独立取值**（如 `"absent"`）。⛔ 不得回落到常量 `"success"`（硬规则 3b/4：恒值字段与「一切正常」同形）。
4. **如实交代载体臂**：若收口时不存在「ts 晚于 `plugin-root.ts` 落地」的 release run（那需要 AC-268 真发一次版本），**逐字记为「静态臂已闭合、载体臂待一次真实 release run」**；⛔ 不伪造 `.quay/ci-runs.jsonl` 记录去骗 AC-267，也不把该缺口说成已完成（同 `tasks/gap-release-run-tests-hangs-on-shared-mcp-client-leak.md` 对 AC-266 的处理）。
5. **⛔ 不顺手改 `gate/registry.ts`**：它不在本 AC 的判据面内，改了只会制造 Touches 外的 delta。

## Acceptance Criteria

- [x] **AC1（静态臂，逐字重跑判据）**：把 `goals/AC-267-goal.md` 的 `criterion:` 块逐字跑一遍，贴出 exit code 与 stderr 全文；**必须不再是 `CAUSE=top-level-eval-remains`**（修复后应为 `CAUSE=carrier-absent` 或 `CAUSE=no-sea-verify-after-fix`，即静态臂已过、载体臂待闭合）。立案基线：exit 1，1 hit @ line 33。
  - 判据**逐字抽出**（YAML 解析 `goals/AC-267-goal.md` 的 `criterion:` 块，非手抄），在 worktree 根目录跑；`SRC = "packages/quay/src/plugin-root.ts"` 相对 cwd。
  - **修复前（基线复现）**：stderr = `CAUSE=top-level-eval-remains — 1 module-top-level evaluation(s) of import.meta.url remain in packages/quay/src/plugin-root.ts (first 1: [(33, 'const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));')]) => …`，stdout 空，`EXIT=1`。
  - **修复后（`74e565fde`，worktree 真实树）**：stderr 全文 = `CAUSE=carrier-absent — .quay/ci-runs.jsonl does not exist => the static arm holds but no release run has ever been recorded, so the SEA artifact has never been exercised`，stdout 空，`EXIT=1`。
  - ⇒ **静态臂已闭合**（不再报 `top-level-eval-remains`；0 个模块顶层求值点），**载体臂待闭合**（见 AC6）。
- [x] **AC2（负控制：判据能取假）**：用同一条按位置谓词对【修复前】的文件（`git show <pre-fix-sha>:packages/quay/src/plugin-root.ts`）干跑，**必须命中 line 33 并打印源文**；对【修复后】的文件必须为 0 命中。贴出两次输出。⚠️ 只有「修复后 0 命中」而没有「修复前命中」的证据，等于没证明判据能取假（硬规则 4）。
  - 两次跑的是**同一条判据**（criterion 原样）、**同一份临时仓库布局**（`packages/quay/src/plugin-root.ts`），唯一自变量是被判文件的内容：
  - **修复前**（`git show aec9227f50f7285fd2af6aa2cb414fd734f11fe6:packages/quay/src/plugin-root.ts`）⇒ `CAUSE=top-level-eval-remains — 1 module-top-level evaluation(s) … (first 1: [(33, 'const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));')])`，`EXIT=1` ← **命中 line 33 且打印了源文**。
  - **修复后**（worktree 真实树同一路径）⇒ `CAUSE=carrier-absent`（即静态命中 = **0**），`EXIT=1`（在载体臂上停住，而不是在静态臂上）。
  - ⇒ 判据**能取假**：同一个谓词对修复前的文件报红、对修复后的文件不报。
- [x] **AC3（惰性化是真的，不是把求值挪到别处）**：一条机械判据证明 `import` 该模块**不触发** `fileURLToPath`/`import.meta.url` 求值 —— 例如在子进程里把 `node:url` 的 `fileURLToPath` 换成会记录调用的探针（PATH shim / 加载钩子同类手法）后 `import` 模块，断言零调用；且该断言在【修复前】的文件上必红。贴出双向读数。
  - **手法**：子进程 `node --experimental-strip-types --import <register>.mjs <probe>.mjs <模块路径>`。register 经 `createRequire` 把 `node:url` 的 `fileURLToPath` 换成计数探针（`--import` 保证在目标模块之前执行），probe 只 `await import(<模块>)` 并数「import 本身」造成的调用（**不调用任何导出函数**）。
  - **修复前**（`plugin-root.prefix.ts`）⇒ `{"fileURLToPathCallsDuringImport":1,"samples":["file:///…/plugin-root.prefix.ts"]}` ← **必红**，探针确实抓到了那次顶层求值。
  - **修复后**（worktree 真实树 `packages/quay/src/plugin-root.ts`）⇒ `{"fileURLToPathCallsDuringImport":0,"samples":[]}`。
  - **探针可达性自检**（否则「0 次」可能只是探针没装上）：同一探针在一个顶层静态 `import { fileURLToPath } from "node:url"` 并调用的夹具上读到 `calls: 1`；register 自身打印 `ESM binding sees probe? true`。
  - **SEA 条件对照**（直接复现 origin 的那条崩溃）：按 `packages/quay/scripts/build-sea.sh` 的方式（esbuild ESM→CJS，`import.meta` 被编成 `{}`）打包后 `require()`：
    - 修复前 ⇒ `THREW: TypeError: The "path" argument must be of type string or an instance of URL. Received undefined`（= origin 里 `quay serve` 起手即崩的那条）。
    - 修复后 ⇒ `LOADED ok; resolvePluginRoot is a fn: function`。
  - **反向陷阱验证**（Finding 缺口三点名的形状）：把已 done 的兄弟修复形状（`gate/registry.ts:14-15` 的三元短路）打成 CJS，`require()` **能加载成功**（运行时短路生效）—— 而同一份文件经 AC-267 谓词判定仍报 `CAUSE=top-level-eval-remains`（1 hit）⇒ **判据判位置、不判运行时**；照抄兄弟形状会静默不达标。本案采用的是函数体内求值。
- [x] **AC4（解析行为未回归）**：`packages/quay/test/plugin-root.test.mjs` 全绿，且显式覆盖三条解析路径 —— `QUAY_PLUGIN_ROOT` 优先、worktree→main-checkout、walk-up（含 `resolvePluginRootFrom(startDir)` test seam 的传参形态）。贴出 `node --test` 的通过行。
  - `node --experimental-strip-types --test packages/quay/test/plugin-root.test.mjs` ⇒ `ℹ tests 18` / `ℹ pass 18` / `ℹ fail 0`。
  - 三条路径各有**指名**断言，全 `✔`：`AC4 path ① QUAY_PLUGIN_ROOT — the env pointer WINS over every other path (explicit priority)`；`AC4 path ② worktree → MAIN checkout: a module loaded FROM a linked worktree relocates (AC139-4)`（把该模块**真的拷进一个 linked worktree 并 import 那份拷贝**，且**两棵树都放了带 kernel 的 `plugin/`** ⇒ 「回落到 worktree 自己的拷贝」会被抓到）；`AC4 path ③ walk-up — resolvePluginRootFrom(startDir) climbs to an ANCESTOR's plugin/ (seam form)`（含「无锚点 ⇒ null」的负控制）。
  - **红控制**：把 `QUAY_PLUGIN_ROOT` 优先与 worktree 重定位一起拆掉（`resolvePluginRoot()` 直接 `return resolvePluginRootFrom(moduleDir())`）⇒ path ①、② 两条 `✖`（path ③ 仍 `✔`，它测的是 seam 本身，本就不该受影响）⇒ 这两条断言**能取假**。已还原（`cmp` 逐字节相同），还原后 18/18 绿。
- [x] **AC5（`seaVerify` 字段能取多值，非恒值）**：夹具驱动（⛔ 断言关系，不写快照）：`sea-verify-node-free` conclusion=`success` ⇒ `seaVerify="success"`；=`failure` ⇒ `seaVerify != "success"`；**job 缺失/读不到 ⇒ 一个独立取值（如 `"absent"`）且该值 ≠ `"success"`**。贴出三条夹具输入 → 三条输出；**负控制**：证明它不是回落到常量（硬规则 4）。
  - 夹具驱动走**真实的 `collect()`**（离线缝 `runs` + `jobsByRun`，零 gh 调用），三条输入 → 三条输出：
    ```
    ① 两个 SEA 验证 job 全在且全 success ⇒ seaVerify="success"
    ② 一个 job = failure                 ⇒ seaVerify="failure"
    ③ job 缺失 / 读不到                  ⇒ seaVerify="absent"
    ```
    三条取值**两两不同**，且「没评估成」（`absent`）与「确证红」（`failure`）分开 —— ⛔ 没有「读不懂 ⇒ success」的路径（硬规则 3b）。另有一态 `incomplete`（只到了一部分 job，≠ 其余三者）。
  - **真实入口读数（DoD 3）**：`node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --from-file <真实 gh run> --repo yaleh/quay --carrier <tmp> --dry-run`。输入是真从 Actions API 拉下来的 release run `34845477762`（`name=Release`、`created_at=2026-09-14T12:48:42Z`），job 由真 gh 取回 ⇒ 输出 `workflow=Release conclusion=failure seaVerify=failure jobs=9`，与 gh 上 `sea-verify-node-free` / `sea-verify-node-free-cross-platform` 实际全红一致。
  - **负控制（硬规则 4）**：把写面改成常量 `rec.seaVerify = "success"` 后跑**同一套**测试 ⇒ 6 条 seaVerify 测试中 **5 条 `✖`**（含「它不是恒值」那条）⇒ 这组断言不是回声。已还原（`cmp` 逐字节相同）。
  - 另有一条：非 release workflow 的记录**没有** `seaVerify` 键（缺 ≠ `absent`，硬规则 6）；同一夹具只把 `name` 换成 `Release` 即出现该键（正控制），`release.yml` 写法也认。
- [x] **AC6（载体臂如实交代）**：检查 `.quay/ci-runs.jsonl` —— 若不存在、或其中无 `ts > plugin-root.ts 落地时刻` 的 release run，逐字记录「静态臂已闭合、载体臂待一次真实 release run（AC-268 范围）」，并贴出当轮 `git log -1 --format=%cI -- packages/quay/src/plugin-root.ts` 的读数作为交接证据。⛔ 本条的判据是「没有伪造记录」，不是「载体臂已闭合」。
  - `.quay/ci-runs.jsonl`：worktree 内**不存在**（`ls` → No such file or directory）；主检出 `/home/yale/work/quay/.quay/ci-runs.jsonl` 也**不存在** ⇒ 载体里没有任何 release run 记录，更不存在 `ts > 落地时刻` 的。
  - 当轮读数（worktree）：`git log -1 --format=%cI -- packages/quay/src/plugin-root.ts` = **`2026-09-15T14:52:36+00:00`**（= 本任务提交 `74e565fde`）；修复前该读数为 `2026-09-14T13:05:47+00:00`。
  - ⇒ **逐字记录：静态臂已闭合、载体臂待一次真实 release run（AC-268 范围）。** ⛔ 本任务**没有**创建或伪造任何 `.quay/ci-runs.jsonl` 记录：全部 seaVerify 证据都写在临时载体（`/tmp/ac267-eval/tmp-carrier.jsonl`，且命令行带 `--dry-run`）上，真实载体路径至今未被创建。
  - 已知窗口特性（Finding 末段）：此后任何人再提交 `packages/quay/src/plugin-root.ts`，`land` 都会前移并可能把 post-fix release run 挤出窗口 —— 收口时按当轮实际读数判定。

## Definition of Done

**REAL LANDING 是门槛，产物必要非充分（DIR-026 Reading A）**：

1. `packages/quay/src/plugin-root.ts` 的惰性化**在真实树上**落地（有 commit），且 AC-267 判据的**静态臂在真实树上不再报 `top-level-eval-remains`** —— ⛔ 不是「夹具里跑过」。**⇒ 落地于 `74e565fde`（本任务分支 `task/gap-sea-artifact-plugin-root-toplevel-eval`）；AC1 的读数就在这棵真实树上取。**
2. AC3 的惰性化证明是**穿过真实 import 路径**取到的读数（真实模块 + 真实子进程），不是对源码文本的正则断言。**⇒ 探针是「`node --import` 换掉 `node:url` 的 `fileURLToPath` 后真 `import` 模块」；另有 esbuild→CJS→`require()` 的 SEA 条件对照。**
3. `seaVerify` 的派生**在采集器的真实入口上被执行过**（喂它一份真实 `gh`-形状的 release run 输入），不是只跑单测里的私有函数。**⇒ 见 AC5：`ci-runs-collect.ts` 的 CLI 入口 + 真 gh run `34845477762`。**
4. **载体臂的闭合如实分离**：端到端「SEA 二进制 `quay serve` 真起来」的证明属于一次 post-fix release run —— 那是 AC-268 的范围；本案必须**明确记录这条未闭合的臂**，不声称已闭合。⛔ 一个恒绿的静态臂 + 一句「应该没问题了」不是本 AC 的完成形态。**⇒ 见 AC6，逐字记录该臂未闭合。**

## Touches

- packages/quay/src/plugin-root.ts
- packages/quay/test/plugin-root.test.mjs
- plugin/scripts/ci-runs-collect.ts
- plugin/test/ci-runs-collect.test.mjs
- plugin/scripts/capability-catalog.sh
- tasks/gap-sea-artifact-plugin-root-toplevel-eval.md
