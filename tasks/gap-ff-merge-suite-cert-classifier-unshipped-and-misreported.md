---
id: gap-ff-merge-suite-cert-classifier-unshipped-and-misreported
title: ff-merge 的 suite 证书闸在【安装布局】下把「分类器根本没跑起来」误报成「delta 被 @static-object
  覆盖（非惰性）」——每个任务的首次 fan-in 必然落地失败
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-239
---
## Finding

**实测（2026-09-11，本机直连 orangevps 的一次真实 AC-239 e2e 运行；⛔ 非推断）**

在升级后的第三方副本（meta-cc，`/home/yale/quay-verify-upgrade-3b0932db-root`）上，一条**真实缺陷修复任务**
`ac239-subagent-session-id-scan` 走到了 driver 机械 fan-in，全链路**每一步都绿**，唯独 `ff` 红：

```
{"ts":"2026-09-11T16:51:08.521Z","step":"suite-start","ok":true}
{"ts":"2026-09-11T16:51:12.704Z","step":"suite-end","ok":true,"wall_ms":4178}
{"ts":"2026-09-11T16:51:12.926Z","step":"anti-drift-land","ok":true}
{"ts":"2026-09-11T16:51:13.016Z","step":"ac-gate","ok":true}
{"ts":"2026-09-11T16:51:13.040Z","step":"flip-done","ok":true}
{"ts":"2026-09-11T16:51:13.096Z","step":"ff","exit":2,"ok":false,
 "reason":"fan-in-ff-merge: 本任务 ac239-subagent-session-id-scan 的 suite 证书未满足 —
           suite_head..tip delta classified non-inert (covered); …NOT acquiring the merge lock"}
```

**根因（读代码 + 在生产布局上复现，⛔ 非推断）**

`packages/quay/src/fan-in/ff-merge.ts:286` 判 `suite_head..tip` 的惰性时，spawn 的是
**`.ts` 源路径**：

```js
const classifyScript = path.join(scriptsDir, "select-static-checks-for-touches.ts");
sh(["node","--experimental-strip-types", classifyScript, "--classify-delta", "--root", classifyRoot, ...])
```

而在**任何 npm 安装布局**里该文件不存在——包里只有**编译产物**
`plugin/scripts/dist/select-static-checks-for-touches.js`。生产布局实测：

```
$ find <prefix>/lib/node_modules/quay -name 'select-static-checks-for-touches*'
<prefix>/lib/node_modules/quay/plugin/scripts/dist/select-static-checks-for-touches.js   ← 只有这个
$ node --experimental-strip-types <prefix>/…/plugin/scripts/select-static-checks-for-touches.ts --classify-delta --root <prefix> tasks/x.md
Error: Cannot find module '…/plugin/scripts/select-static-checks-for-touches.ts'
```

⇒ `verdict.status !== 0` ⇒ 证书闸拒绝。而**每一个** `flip-done`（驱动自己把任务翻 done）都必然产生
非空 delta（`tasks/<id>.md`）⇒ **在安装布局下，任何任务的第一次 fan-in 必然在 ff 处失败**。

**第二个、独立的半边（硬规则 3b：读不懂不得与合格/判决同形）**

`:288` 的 reason 模板是 `` `… non-inert (${verdict.stdout.trim() || "covered"})` `` —— stdout 为空
（= 分类器**根本没给出判决**）时打印的是**字面量 `covered`**。实测读数正是 `(covered)`。
⇒ **「分类器跑不起来」被报成了「分类器判它非惰性、被 @static-object 覆盖」**，这是一个具体判决。
本次执行者据此**差点**投出一条更强的错误结论（「安装布局下结构上永不落地」），是靠回头查
`quay-verify-coldstart-a2a5aac0-root` 上 AC-207 的第二次尝试**成功**才自我推翻的——即该误报确实会误导读者。

**第三个半边（执行时才暴露：分类器的【输入】根本没随包出厂）**

`select-static-checks-for-touches --classify-delta` 读注册表 `plugin/scripts/runner-static-gate.ts`
（它的 `TEST_SH_REL` 单一真相源）。该文件是一个**故意命名为 `.ts` 的 BASH 库**（注释解析器要看见它），
**不是 bundle entry**（esbuild 对它报语法错），于是 `package.sh` 的 `find … -name '*.ts' -delete`
把它一起删了 —— **分类器的代码出厂了（`dist/*.js`），它的输入没有**。
实测（两个修复前的真实安装，⛔ 非推断）：本机 `quay-verify-coldstart.npm` 前缀与 orangevps 的
`quay-verify-upgrade-3b0932db.npm` 前缀上 `find … -name 'runner-static-gate*'` 均**零命中**。
⇒ 只修「按布局解析脚本」不够：分类器跑起来了，但 exit 2（registry not found），证书闸仍然判不了。

**影响（实测，⛔ 不夸大）**

- **不是**「永不落地」：`quay-verify-coldstart-a2a5aac0-root` 的 `e2e-verify-207` 第 1 次 ff 同样红、
  第 2 次 ff 绿（`01:43:20 ff ok=false` → 驱动 reset done→ready → `01:48:53 flip-done ok / ff ok=true`）。
  收敛机制是：第 1 次已把 done 提交留在**任务分支**上，第 2 次的 `flip-done` 成为 **no-op** ⇒ delta 为空 ⇒ 证书通过。
- **但代价是真的**：每个任务至少多烧一轮 fan-in；且本次 ac239 的**落地最终没有发生** ——
  实测（2026-09-11T17:09:34Z）：`git merge-base --is-ancestor task/ac239-subagent-session-id-scan develop` = **NO**，
  `develop` 上只有任务文件提交，实现提交 `e7d7d67`（4 文件：`internal/mcp/query/query.go`、
  `internal/mcp/executor/provider_query.go` + 两个测试）**从未落地**；而该任务的 `status` 在 develop 上
  已是 `done`（fan-in 的 `flip-done` 写进工作树后被 doc 面同步带过去）⇒ 出现「**任务 done 而其实现提交未落地**」
  的漂移。该漂移本应由驱动的 done→ready reset 收敛，但 ac239 在本次观察窗口内没有再被重试
  （`worker-round.jsonl` 最后一轮 16:53:14，此后无新轮）。

**为什么没被发现**：判据 `classifyScript` 指向的路径在**开发检出**里存在（`plugin/scripts/*.ts` 就在那儿），
只在**安装产物**里缺失 ⇒ 该判据**只被「实现所在的目录」这个夹具满足**，从没在生产载体（npm 安装布局）
上取过一次真读数（硬规则 4 推论三）。与 `gap-upgrade-verify-transport-missing-binding-checker`（⑤）**同族**：
**枚举式交付面漏掉了一个被调用的兄弟**，只是这次是在包的 `files`/打包面，而不是跨主机 scp 面。

## Proposal

方向（⛔ 具体落点由执行者按实际形态定，本段不是预设结论）：

1. **让判据解析到实际存在的那一份**：`ff-merge` 调用 `select-static-checks-for-touches` 时应按布局解析
   （编译产物 `dist/*.js` 与 `.ts` 源二选一，与仓库别处同形），或把该 `.ts` 一并纳入打包面。
   ⛔ 不要只在 `package.sh` 里加一行而不问「还有没有别的 `plugin/scripts/*.ts` 被运行时 spawn」。
2. **`can't-evaluate` 必须与「判决为惰性/非惰性」有可区分取值**：分类器缺失/崩溃时不得报成一个判决
   （现状 `(covered)` 即硬规则 3b 的教科书违例）。修法与仓库既有做法同形（`evaluated:false` /
   `NOT-EVALUATED` 独立取值）。
3. **`classifyRoot` 值得一并核**：`path.resolve(scriptsDir, "..", "..")` 在安装布局下 = **安装前缀**
   （实测 = `<prefix>/lib/node_modules/quay`），而它该是**被合并的那个项目**的 root（注册表 `scripts/test.sh`
   在那儿）。本次不是成因（分类器压根没跑起来），但第 1 条修好后它会立刻变成成因 ⇒ 一并核，
   ⛔ 但不要预设它一定是错的。
4. **5b 产物（必须）**：grep 出所有「运行时 spawn `plugin/scripts/*.ts`」的位点，列一份「在安装布局下
   解析不到」的清单（命中数 + 前 3 条），证明修的不是被报出来的这一个。

## 落地（2026-09-11 执行）

三条半边**全部落在产品面**，⛔ 无豁免、⛔ 无 `|| true`：

1. **一个布局感知的 sibling 解析器**（`ff-merge.ts:siblingScriptArgv`）：dev 树取 `.ts`（带
   `--experimental-strip-types`），安装布局取 `dist/<name>.js`（不带 flag）；`scriptsDir` **本身**
   是 dist 目录时也对（生产正是如此：`resolveKernelScriptsDir()` = 被 bundle 的 kernel 所在目录）。
   语义与 `driver-runtime.resolveKernelSibling` / 插件层既有 `resolvePluginScriptExec` 同形。
   **本文件里的 4 个 spawn 位点全部改走它**（分类器 ×2 / anti-drift 落点 / reaper）——即修的是这一族。
2. **注册表随包出厂**（`package.sh`）：`-name '*.ts' -delete` 是本条缺陷的第二个半边（**形态匹配**
   而非「是不是模块」）。改为排除 `runner-static-gate.ts` 并在同一处**fail-closed 断言**它还在
   （未来的编辑若重新放宽删除，打包当场红）。
3. **三态取值**（`ff-merge.ts:classifyDeltaVerdict`）：`inert` / `non-inert(paths)` / `not-evaluated(detail)`，
   `not-evaluated` 的措辞**不与 `non-inert` 共用任何输出词**、⛔ 不再出现字面量 `covered`。
   `classifyRoot` 改为**存在性校验的候选根**，由分类器**自己的退出码**接受（⛔ 不再有第二份注册表路径可漂移）。

### 落地（第二轮 — 同一族的第四个半边：候选根从不含被合并的那个 `root`）

**续做现场（⛔ 不是推断，是驱动 fan-in 日志 `/home/yale/work/quay/.quay/fan-in-gap-ff-merge-suite-cert-classifier-unshipped-and-misreported-wk-prod-1789139008.log:25`）**：
第一轮落地后 `ff` 仍红，但**读数变了** —— 从 `Cannot find module` 变成 `classifier produced no verdict`：

```
suite_head..tip delta NOT-EVALUATED — classifier produced no verdict —
  root=/home/yale/work/quay/packages/quay/plugin          exit=2 (… registry file … not found at …/plugin/plugin/scripts/runner-static-gate.ts);
  root=/home/yale/work/quay/packages/quay                 exit=2 (… not found at …/packages/quay/plugin/scripts/runner-static-gate.ts);
  root=/home/yale/work/quay/packages/quay/plugin/scripts  exit=2 (… not found at …/plugin/scripts/plugin/scripts/runner-static-gate.ts)
```

**根因**：`classifyRootCandidates` 只从 `scriptsDir` 出发做 `..` 跳。而**本仓库自己的循环**里
`resolveKernelScriptsDir()` 返回的是**被 bundle 的 kernel 所在目录** =
`<repo>/packages/quay/plugin/scripts/dist` —— 一个 **gitignored 的构建产物树**（`.gitignore:26`
`packages/quay/plugin/`）⇒ **仓库根在它五跳之上，没有任何 `..` 公式够得到**；而注册表
`plugin/scripts/runner-static-gate.ts` 只在**被合并的那个 `root`** 上（`git ls-files` 可证它被跟踪）。
⇒ dev 布局下只要 delta 非空，ff 必然 NOT-EVALUATED；而任务分支的 `flip-done` 提交**本身就是**这样的
delta（`tasks/<id>.md`）⇒ **每个任务都白烧一轮 fan-in**（正是 Finding 里那条代价的机制）。

**修法（与 AC2–AC4 同一族，⛔ 不是给这一处打补丁）**：`classifyRootCandidates(root, scriptsDir)` 把
**`root`（被合并的那个树 —— delta 路径正是相对它取的 `git diff --name-only`）排在第一位**，三个
`..` 跳候选仅作**装机布局的兜底**保留（消费方项目自己的 root 不带注册表时仍走它们）。
语义与 `driver-runtime.ts:295 resolveKernelPluginRoot`（对 `dist` 显式三态）同源：**先问布局，再谈跳数**。

**5b 扫描（其余 `scriptsDir`-跳候选的处置）**：全仓 grep `resolve(scriptsDir` / `scriptsDir, ".."`
只命中两处 —— 本文件（已修）与 `plugin/scripts/loadbearing-test-gate.ts:241`
（`testDir` 缺省 = **调用方显式传入的** `--scripts` 的兄弟 `test/`，不是自定位解析 ⇒ **不在本族**，未改）。
`driver-runtime.ts:295 resolveKernelPluginRoot` / `:305 resolveKernelSibling` 已按 `dist` 显式分支 ⇒ 不在本族。

## Acceptance Criteria

- [x] AC1 复现：在**安装布局**（npm 全局装出的 prefix，⛔ 不是开发检出）上跑
      `ff-merge` 判 delta 惰性的那条命令，修复前取到 `Cannot find module` / 非零（真实输出贴回）。
- [x] AC2 修复后同一现场取到一个**真实判决**（惰性 ⇒ 空输出且 exit 0；非惰性 ⇒ 非空输出），真实输出贴回。
- [x] AC3 负控制（判据可取假）：塞一个**真的**被 change/full 检查器 `@static-object` 覆盖的路径 ⇒
      必须仍被判非惰性并拒绝；塞一个纯 doc 面路径 ⇒ 必须放行。
- [x] AC4 可区分取值：注入「分类器缺失 / 崩溃」⇒ 输出必须是一个**独立的 not-evaluated 取值**，
      ⛔ 不得是 `covered`、也不得与「非惰性判决」同形（真实输出贴回）。
- [x] AC5 5b 产物：给出一份「运行时 spawn 的 `plugin/scripts/*.ts` 在安装布局下是否存在」的机械清单
      （命中数 + 前 3 条），并逐条说明处置。
- [x] AC6 **同一族的第四个半边**：候选根必须含**被合并的那个 `root`** —— 在**生产 `scriptsDir`**
      （`<repo>/packages/quay/plugin/scripts/dist`）上，`--root <repo>` ⇒ `tasks/<id>.md` 判**惰性**
      （空输出 + exit 0）、code 路径判**非惰性**；三个 `..` 跳候选 ⇒ 逐条 exit 2（真实输出贴回）。
      ⛔ 不是「dev 树另开一条路」，而是 `root` 进候选集；唯一变量 = `root`。

## Definition of Done

- [x] 修的是**产品面**（`ff-merge` 的判据解析 / 打包面 / 取值词表），⛔ 不是给某个 AC 加豁免、
      ⛔ 不是在 `fan-in-ff-merge.sh` 里塞一个 `|| true`。
- [x] AC3 的正负两侧都在**同一现场**取到，互为对照（同一判据、唯一变量是被判的路径）。
- [x] 落地效果的判据是**产物**：在安装布局上，一个任务**第一次** fan-in 就能 ff 成功
      （⛔ 不是「我加了个解析分支」）—— 见 Evidence「AC2 端到端」：`suite_head` = 分支点（delta = 那条
      `flip-done` 提交 = `tasks/<id>.md`），**第一次**就把 develop 快进到任务 tip。
- [x] AC6 的判据同样落在**产物**上：同一现场、唯一变量 = `root`（`root` ⇒ 惰性/非惰性两侧都取到；
      三个 `..` 跳候选 ⇒ 逐条 exit 2），且单测做了**红/绿对照**（pre-AC6 版本红、当前 39/39 绿）。

## Touches

- `packages/quay/src/fan-in/ff-merge.ts`
- `packages/quay/scripts/package.sh`
- `plugin/test/fan-in-ff-merge.test.mjs`
- `plugin/test/ac214-freshness-subject-set.test.mjs`
- `tasks/gap-ff-merge-suite-cert-classifier-unshipped-and-misreported.md`

## Evidence

（本条由 gap-aged-project-post-upgrade-driver-e2e 的一次真实 e2e 派生；原始读数见该任务体的
`## Evidence` 一节，⛔ 不复刻第二份。）

### 落地读数（2026-09-11，本机；现场 = 从本 worktree 打出的 npm 全局前缀 `/tmp/quay-ac-ff/lib/node_modules/quay`）

命令里的 `$SD` = 该前缀的 `plugin/scripts/dist` —— **正是生产里 worker-driver 传给 ff-merge 的
`resolveKernelScriptsDir()`**。

**AC1（修复前，同一前缀上的那条命令）**

```
$ node --experimental-strip-types <prefix>/plugin/scripts/select-static-checks-for-touches.ts \
      --classify-delta --root <prefix> tasks/x.md
Error: Cannot find module '/tmp/quay-ac-ff/lib/node_modules/quay/plugin/scripts/select-static-checks-for-touches.ts'
    code: 'MODULE_NOT_FOUND'
$ echo $?  →  1
```

（同形在两个**修复前就存在的真实安装**上独立复现：本机 `quay-verify-coldstart.npm` 前缀、
orangevps 的 `quay-verify-upgrade-3b0932db.npm` 前缀 —— `find … -name 'runner-static-gate*'` 均零命中。）

**AC2（修复后，同一现场，真实判决）**

```
$ node $SD/select-static-checks-for-touches.js --classify-delta --root <prefix> tasks/ac239-….md
stdout=''  exit=0                                          ← 惰性 = 空输出 + exit 0
$ node $SD/select-static-checks-for-touches.js --classify-delta --root <prefix> \
      packages/quay/src/fan-in/ff-merge.ts scripts/test.sh
stdout='packages/quay/src/fan-in/ff-merge.ts
scripts/test.sh'   exit=0                                  ← 非惰性 = 非空输出（真实路径）
```

证书闸端到端（同前缀、`--scripts-dir $SD`、`suite_head` = 分支点 ⇒ delta 非空）：

```
[doc-only delta，第一次尝试]  fan-in-ff-merge: OK — develop fast-forwarded to task/ac-ff (<tip>); measure ff_only_locked=true   EXIT=0
[code delta]                  … suite 证书未满足 — suite_head..tip delta classified non-inert (packages/quay/src/fan-in/ff-merge.ts); …   EXIT=2
```

**AC3（同一现场、同一判据，唯一变量 = 被判的路径）**

- **负侧**（真被 change/full 检查器覆盖的路径）⇒ 判**非惰性并拒绝**：上面 `[code delta]`，reason 里是
  **真实路径**而非 `covered`。
- **正侧**（纯 doc 面 `tasks/<id>.md`）⇒ **放行**：上面 `[doc-only delta]`，develop 快进到任务 tip。
- **混合 delta**（一个 doc + 一个 code）⇒ 只打印 code 那一条：

```
… delta classified non-inert (packages/quay/src/fan-in/ff-merge.ts); …        ← doc 那条没被打印
```

⇒ 是**逐路径**判定，不是一个整体布尔。

**AC4（分类器缺失 / 崩溃 ⇒ 独立取值）**

```
[分类器缺失]  … delta NOT-EVALUATED — classifier not resolvable under /tmp/ac-empty-scripts
              (neither select-static-checks-for-touches.ts nor dist/select-static-checks-for-touches.js);
              证书闸按未知 delta fail-closed（⛔ 这不是判决：既非惰性、也非被 @static-object 覆盖）        EXIT=2
[分类器崩溃]  … delta NOT-EVALUATED — classifier produced no verdict —
              root=… exit=3 (boom: injected classifier crash); …                                     EXIT=2
```

两侧都**不含**字面量 `covered`、也**不含** `classified non-inert` —— 这两条在单测里是断言（取假）。

**AC2 对照（证明「注册表要随包出厂」这半边是承重的）**：同一条命令、同一个分类器，打在**修复前的真实包**上：

```
$ SD_OLD=<coldstart 前缀>/plugin/scripts/dist   # 修复前打出的真包
… delta NOT-EVALUATED — classifier produced no verdict —
  root=…/quay/plugin exit=2 (… registry file (runner-static-gate.ts) not found at …/quay/plugin/plugin/scripts/runner-static-gate.ts);
  root=…/quay        exit=2 (… registry file (runner-static-gate.ts) not found at …/quay/plugin/scripts/runner-static-gate.ts);
  …                                                                            EXIT=2
```

（第一条正是旧公式 `resolve(scriptsDir,"../..")` 的 `plugin/plugin/…` —— 深了一层。）

**AC5 —— 5b 机械清单**

扫描面 = shipped kernel（`plugin/scripts/*.{ts,mjs,js}` 顶层 + `packages/quay/src/**/*.ts`）；
判据 = 「运行时 spawn 的 sibling `.ts`」是否在**安装布局**里解析得到（= 是否进了
`build-plugin-dist.deriveEntries` 的派生入口集 ⇒ 有 `dist/<name>.js`）。
**修复前：命中 14 个不同名字；其中 11 个有 dist bundle、2 个没有。**
前 3 条：`fast-mode-telemetry.ts`（`accounting-emit.ts:204`）、`full-suite-runner.ts`
（`suite-state-trigger.ts:1285`）、`goal-driver.ts`（`driver-runtime.ts:213`）。逐条处置：

| # | 名字 | 位点 | 安装布局下存在? | 处置 |
|---|---|---|---|---|
| 1 | `select-static-checks-for-touches.ts` | `ff-merge.ts:282`,`:336` | 有 `dist/*.js` | **本任务修**：改走 `siblingScriptArgv` ⇒ AC2 实测真判决 |
| 2 | `touches-orthogonality-check.ts` | `ff-merge.ts:209` | 有 | **本任务修**（同一解析器，anti-drift 落点） |
| 3 | `worktree-process-reaper.ts` | `ff-merge.ts:408`；`full-suite-runner.ts:1978` | **无** | ff-merge 侧改走同一解析器 + 解析不到时**显式报** `reaper SKIPPED (not-evaluated)`（⛔ 不再与「没有孤儿」同形）；`full-suite-runner.ts:1978` 的下半**未修**（⛔ 不在本任务 Touches／属 build-plugin-dist 派生面） |
| 4 | `suite-load-sampler.ts` | `full-suite-runner.ts:2163` | **无** | **未修**，同上（同因同源） |
| 5–14 | 其余 10 个（driver kinds：`promotion/outer/meta/goal/quality-gate/worker-driver` + `ready-pool-check`/`send-to-session`/`full-suite-runner`/`fast-mode-telemetry`） | `driver-runtime.ts` 等 | 有 `dist/*.js` | 无需处置 |

第 3/4 项的共同根因（读代码得，非推断）：`build-plugin-dist.mjs:scanPluginSelfReferences` 的扫描
**只覆盖 `driver-runtime.ts` 一个文件**（该函数注释自己写明 "Scoped to driver-runtime.ts on purpose"），
于是 `full-suite-runner.ts` 里**已经用对了 API** 的 `resolveKernelSibling("suite-load-sampler.ts")`
这类调用点也进不了派生入口集 ⇒ 打包删除 ⇒ 运行时 `resolveKernelSibling` 返回 null ⇒ 落到 fallback
的裸 `.ts` join。⇒ 正确修法在那条派生的 **scope**（`packages/quay/scripts/build-plugin-dist.mjs`）
＋ `plugin/scripts/full-suite-runner.ts`，**本任务未修、记录在案**（硬规则 5b：列整族 + 逐条处置，
⛔ 不是只修被报出来的那一个）。

另一条**不属于 spawn 面、但同属「被调用的兄弟被交付面丢掉」**的：分类器**读**的注册表
`plugin/scripts/runner-static-gate.ts`（`fs.readFileSync`，不是 spawn）—— 见上面 AC2 对照，
不随包出厂则证书闸永远判不了，故一并修（`package.sh`）。

**机械自证（本文件那一族被整体修掉）**：同一扫描在修复后**降到 12 个名字**（`ff-merge.ts` 的 3 个位点
不再使用裸 `.ts` join 形态）——⛔ 不是「我加了个解析分支」。

**单测（`plugin/test/fan-in-ff-merge.test.mjs`，第一轮新增 3 条）**：在**一个**夹具里（安装布局形状）
钉住「安装布局解析」与「三态词表」，唯一变量 = 被判的路径。**取假对照**：把 `ff-merge.ts` 换回
`develop` 版本（pre-fix），3 条**全红**（`node --test --test-name-pattern=…`，3 tests / 0 pass）；
换回后 38/38 绿（第一轮结束时读数；第二轮加 AC6 后为 **39/39**）。

**AC6 —— 生产载体上的真读数（⛔ 不是夹具）**

现场 = **本仓库自己的 `scriptsDir`**（= 生产里 `resolveKernelScriptsDir()` 的返回值）
`/home/yale/work/quay/packages/quay/plugin/scripts/dist`：

```
[A] node $SD/select-static-checks-for-touches.js --classify-delta --root /home/yale/work/quay tasks/<本任务>.md
    stdout=''   exit=0                          ← 惰性（本条 `flip-done` 提交的 delta）
[B] 三个 `..` 跳候选（= 修复前的【全部】候选；⛔ 逐字复现驱动日志的失败读数）：
    root=<repo>/packages/quay/plugin          exit=2  registry file (runner-static-gate.ts) not found at …/plugin/plugin/scripts/runner-static-gate.ts
    root=<repo>/packages/quay                 exit=2  registry file (runner-static-gate.ts) not found at …/packages/quay/plugin/scripts/runner-static-gate.ts
    root=<repo>/packages/quay/plugin/scripts  exit=2  registry file (runner-static-gate.ts) not found at …/plugin/scripts/plugin/scripts/runner-static-gate.ts
[C] 同一 root、一个 code 路径 ⇒ 仍判**非惰性**：
    node $SD/select-static-checks-for-touches.js --classify-delta --root /home/yale/work/quay packages/quay/src/fan-in/ff-merge.ts
    stdout='packages/quay/src/fan-in/ff-merge.ts'   exit=0
```

**唯一变量 = `root`**：[A] 放行、[C] 拒绝（⛔ 没有退化成「什么都惰性」，判据仍可取假）；
[B] 三条**逐字复现**了驱动日志里那三行 —— 即修复前该布局下**必然** NOT-EVALUATED。

**AC6 单测（`plugin/test/fan-in-ff-merge.test.mjs`，第 4 条）**：夹具 = **本循环真正跑的那个布局**
（`root` 带注册表、而 `scriptsDir` 在一个 `..` 链上够不到注册表的构建产物树）——夹具**先自证形状**
（断言三个跳候选**都没有**注册表，否则 `AssertionError: fixture broken`），再跑正负两侧。
**取假对照**：把 `ff-merge.ts` 换回本分支 pre-AC6 版本（`git show HEAD:packages/quay/src/fan-in/ff-merge.ts`
⇒ 当前分支 55a5865fb 的版本），AC6 **红**（读到 `NOT-EVALUATED` 而非具名路径）；换回后 **39/39 绿**
（`node --test plugin/test/fan-in-ff-merge.test.mjs`）。

> ⚠️ 夹具自己也修了一处**会伪造结论**的形态：注册表原先以**未跟踪**文件植入，会被 `makeTaskBranchWith`
> 的 `git add -A` 扫进任务提交、再被随后的 `git checkout develop` 删掉 —— 夹具于是量到「哪里都没有
> 注册表」，与真实布局无关。**同一形状的「未跟踪文件被 checkout 清掉」在本仓库其它夹具里同样致命。**

### 附带修：AC-244 的接线钉在 AC-239 并入 NEED 后过期（**develop 侧**红，非本任务引入）

本任务的 suite 步红在 `plugin/test/ac214-freshness-subject-set.test.mjs`，**与本任务 delta 无关**：
该测试文件与 `goals/AC-214-*.md` 都与 `develop` 逐字相同（`git diff develop -- <两者>` 为空）。
但它挡下了**每一个**在飞任务的 fan-in（fail-closed ⇒ 算在当轮任务头上），故按纪律一并修、并登记进 Touches。

**根因（由一条命令的对照确定，硬规则 4 推论四）**：该测试原先**自己也复制了一份真相源** —— 硬写
`NEED_IDS = [201,203,205,207,232,238]`，并把 `239` 当「NEED 之外」的探针。而 `a26bd6c66`
把 `GOAL-009-AC-239` **正确地**并入了 AC-214 的 `NEED`：AC-239 的判据正文只读
`.quay/productization-verification.jsonl`，`SRC_RE` 在其正文上**零命中** ⇒ 按 AC-244 自己的规则就是载体型。
于是那份硬写副本过期，AC4 由「守卫指名 239」翻转成「守卫沉默 + `no evidence yet: …AC-239`」
——**看起来像守卫坏了**，实则测试钉死了一个已不成立的假设。

**对照（唯一变量 = 239 是否在 NEED 里；同一条命令、同一个夹具）**：

```
NEED 含 239（= develop 现状）   AC4 ✖   stderr = "no evidence yet: …AC-207,AC-232,AC-238,AC-239"
NEED 摘掉 239（临时改判据）     AC4 ✔   5/5 全绿
```

**修法（⛔ 不是把 239 换成另一个写死的 id —— 同形会再犯）**：`needSubjectSet(CRITERION)` 从真判据正文
机械推导主体集合，探针取 `max(NEED)+1`（**按构造**在 NEED 之外 ⇒ NEED 今后再增员也不会让它过期）。
两个独立读法互校（按行取 `NEED = [` vs 全文取所有带引号的 `GOAL-009-AC-<n>`），计数不一致即报错 ——
防某个正则静默少读几条、把一个更弱的判据跑成绿的（硬规则 3b）。

**验证**：5/5 绿（AC5 现覆盖全部 7 条 NEED 成员，标题由推导值渲染）。
**取假对照**：在判据的 `if unwired:` 前插一行 `unwired = []` 把守卫打瞎 ⇒ AC4 立刻红（连带 3 条兄弟红），
证明这条钉仍可取假、不是被改成恒绿。
