---
id: gap-arch-worker-fan-in-extract-from-worker-driver
title: 架构：从 worker-driver.ts 抽出机械 fan-in 区域为 worker-fan-in.ts（调查方案第一期；文件已 6063
  行，越过调查设的 3300 行重评线）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**执行 `docs/analysis/worker-driver-decomposition-investigation.md` §AC4 第一期：把 R15 机械 fan-in 区域抽成 `plugin/scripts/worker-fan-in.ts`，`worker-driver.ts` 对其全部导出改 `export { … } from "./worker-fan-in.ts"`，保持既有测试的 import 面不变。**

**为什么现在做**：调查（`gap-worker-driver-god-file-decomposition-investigation`，done）的结论是「值得局部拆，只拆到 R15 为止」，并设了一条可查的重评线：文件超过约 3300 行即需重评。实测 `wc -l plugin/scripts/worker-driver.ts` = 6063（调查时 4445）——重评线已被突破，且期间 fan-in 区域又长了（`runMechanicalFanIn` 现在在 `:4841` 一带，`mirrorMechanicalFanInSuiteState` 在 `:5094`）。

**⚠️ 实现者先重做的一件事**：调查里的行号（2581–3741 等）已作废。**先重新定位 fan-in 区域边界并重测它对文件其余部分的真实调用数**（调查时只有 `scopedGateCommandFor` 一处，现 `:1580` 定义、`:4841` 调用），把新读数写进 notes；若发现已出现第 3 个模块级可变状态或对外回引显著增多，按调查 AC5 反例判据**停下并写明是否仍值得拆**，不得硬拆。

**不做**：不拆第二期候选（R7/R13/R10/R9）；不改任何导出的语义；不动 Provider ABI。`scopedGateCommandFor` 随 scoped 门语义一并迁入 `worker-fan-in.ts`，或保留并注入，二选一并写明理由。

## Notes — 重测读数与落地证据

### 先重做的一件事：区域边界重定位 + 对区域外的真实调用（AC1）

**迁移前基线**：`wc -l plugin/scripts/worker-driver.ts` = **6112**（调查时 4445）。调查的 R15 行号 2581–3741 已作废。

**重新定位后的边界**（1-indexed，迁移前）：

| 块 | 行范围 | 行数 | 内容 |
|---|---|---|---|
| ① 区域本体 | `3709`–`5228` | 1520 | 机械 fan-in：锁事件 / 步骤 trace / suite 日志与 runId / scoped-gate 缓存 / `runMechanicalFanIn` / `spawnMechanicalFanIn` / `mirrorMechanicalFanInSuiteState` |
| ② scoped 门 + doc 检查命令解析 | `1482`–`1602` | 121 | `testShAt` `hasTestSh` `shq` `readLoopTestCommand` `readLoopTestOutput` `ScopedGateResolution` `resolveScopedGateCommand` `scopedGateCommandFor` `docCheckCommandFor` |
| ③ kernel sibling 运行 argv 前缀 | `1604`–`1626` | 23 | `kernelSiblingArgv` `workerDriverSelfArgv` |
| ④ ff-merge Core 模块加载 + 仪器摘要 | `1628`–`1664` | 37 | `FfMergeModule` `loadFfMergeModule` `instrumentSummary` |
| ⑤ scoped-gate 缓存写入签名 | `1666`–`1672` | 7 | `scopedGateCacheWriteSignature` |

区域本体导出 **37 个符号**（= AC2 的 re-export 面，逐字见下方命令输出）。

**对区域外的真实调用（完整枚举，按 import/调用位置判定，非关键词）**：取证手法 = 一个词法枚举器，剥离注释 / 字符串 / **正则字面量** 的文本内容但**保留 `${…}` 插值内的代码**（前一版剥离器把插值整段吞掉、且被含引号的正则字面量带偏——这正是「按位置判定」要求的：先用自测钉住剥离器，再谈命中）。对 ① 全部标识符引用做闭包检查，得 **8 个区域外符号**：

| 符号 | 定义行 | 区域外的消费者 | 处置 |
|---|---|---|---|
| `scopedGateCommandFor` | `:1590` | 无（仅区域） | 随 ② 迁入 |
| `docCheckCommandFor` | `:1599` | 无（仅区域） | 随 ② 迁入 |
| `readLoopTestOutput` | `:1533` | 无（仅区域） | 随 ② 迁入 |
| `loadFfMergeModule` | `:1651` | 无（仅区域） | 随 ④ 迁入 |
| `instrumentSummary` | `:1660` | 无（仅区域） | 随 ④ 迁入 |
| `hasTestSh` | `:1490` | 只在 ② 簇内（`resolveScopedGateCommand` / `docCheckCommandFor`） | 随 ② 迁入 |
| `readLoopTestCommand` | `:1503` | 只在 ② 簇内 | 随 ② 迁入 |
| `kernelSiblingArgv` | `:1614` | 只在 ③ 簇内（`workerDriverSelfArgv`） | 随 ③ 迁入 |

**与调查「1 处」逐条对账**：调查报的是 **1**（`scopedGateCommandFor`），但其取证命令是
`sed -n '2581,3741p' … | grep -oE "\b(computeLandingState|scopedGateCommandFor)\b"` —— **只查两个预先点名的符号，不是枚举**（硬规则 5：来源不完备时「搜不到」≠「不存在」）。把**同一个完整枚举器**跑在调查时点的版本上（`develop@a39e61ed2`，4445 行，R15 = `2581`–`3741`），真实读数是 **2**：

```
1  scopedGateCommandFor  (declared :950)
1  WorkerRunResult       (declared :1976)   ← 类型引用，调查的 grep 看不见
```

⇒ **真实增长是 2 → 8**（不是 1 → 8）。且逐条看这 8 个：**5 个只被区域消费**（本属误置，不是共享）；余 3 个全部落在**同一段连续的 180 行**（`1482`–`1664`，即 ②③④⑤）里，簇内互调——是**一条缝**，不是网状散布。

**是否仍值得拆（按调查 AC5 反例判据逐条判）**：

- **触发条件一：文件越过 ~3300 行 ⇒ 已触发**（6112 > 3300）。
- **触发条件二：出现第 3 个模块级可变状态 ⇒ 未触发**。重测模块级私有声明 41 个，可变者为 **0**（全部是 `const` 字面量 / `ReadonlySet` / `readonly string[]`）；调查的「无共享可变单例可破」这条安全前提**至今仍成立**。
- **新增触发条件（本任务加的）：对外回引显著增多 ⇒ 判为「是，但这不否定拆分，反而支持它」**。理由：新增的 5 个独占依赖分别来自**新功能**——第三方项目支持（`hasTestSh`/`readLoopTestCommand`/`readLoopTestOutput`/`docCheckCommandFor`）与 ff 持锁段模块化（`loadFfMergeModule`/`instrumentSummary`）——**这些新依赖的消费者全在区域内**，抽取把它们一起带走，**不产生新的回指**。换句话说：回引从 2 涨到 8，**正是因为 fan-in 子系统自己长了**，而不是因为它与驱动主线缠得更紧。

⇒ **结论：仍值得拆**；边界从「R15 本体」扩到「R15 + ②③④⑤ 工具面」。**未硬拆**：8 个回引全部可单向（worker-driver → worker-fan-in）取得，无一处需要反向 import。

**`scopedGateCommandFor` 的二选一（Proposal 要求写明理由）**：**选「随 scoped 门语义一并迁入」**。理由：① 它与同在区域里的 `scopedGateKey` / `readScopedGateCache` / `writeScopedGateCache` 是同一条「scoped 门」语义的读写两半，分居两文件会让该语义重新裂开（硬规则 5b）；② 它的两个区域外消费者 `resolveScopedGateCommand` / `docCheckCommandFor` 本身也只在 ② 簇内被消费，整簇迁走是零成本；③ 留下的「注入」方案要求 worker-driver 把 `opts.scopedGateCommand` 的缺省值喂回去，那只是把同一处依赖换了个写法，不减少耦合。

**迁移后**：`plugin/scripts/worker-fan-in.ts`（1772 行）**零反向依赖**——不 import `worker-driver.ts`（AC4 的两条独立判据都过）。

### 落地与证据

**AC2（导出面逐字不变）**——两条独立枚举，迁前 / 迁后各跑一次：

```
# ① 运行期 value 导出面（真 import 面，.mjs 测试消费的那一面）
$ node --experimental-strip-types -e \
  "const b=await import('/tmp/ac2/plugin/scripts/worker-driver-before.ts');const a=await import('./plugin/scripts/worker-driver.ts');\
   const B=Object.keys(b).sort(), A=Object.keys(a).sort();
   console.log(B.length, A.length, JSON.stringify(B.filter(x=>!A.includes(x))), JSON.stringify(A.filter(x=>!B.includes(x))))"
174 174 [] []
⇒ 174 → 174，missing []，added []
（迁前文件取 `git show HEAD:plugin/scripts/worker-driver.ts`，放进 /tmp/ac2/ 的软链沙箱使相对 import 可解析）

# ② 源码级导出名集合（含被运行期擦除的 type/interface 导出）
$ node /tmp/enum-exports.mjs /tmp/ac2/plugin/scripts/worker-driver-before.ts > before.txt
$ node /tmp/enum-exports.mjs plugin/scripts/worker-driver.ts                > after.txt
$ wc -l before.txt after.txt && diff before.txt after.txt
204 before.txt   204 after.txt     ← diff 输出为空
⇒ 源码级导出名 204 → 204，diff 空
```

**AC3（判据取假）**——临时从 re-export 里删掉 `mechSh` 一行（`worker-driver.ts:307`，`grep -c '^  mechSh,$'` 迁前 = 1）：

```
$ sed -i "307d" plugin/scripts/worker-driver.ts && node --test --experimental-strip-types plugin/test/worker-driver-fan-in-s*.test.mjs
# tests 18 / # pass 0 / # fail 18
does not provide an export named 'mechSh'
$ cp /tmp/ac2/wd-backup.ts plugin/scripts/worker-driver.ts && diff -q …   ⇒ 逐字节相同
# tests 102 / # pass 102 / # fail 0
```
⇒ 删一个 re-export 就红（18/18 文件全红，且是**具名**错误不是语法错误），撤销后绿。

**AC4（无新环）**：

```
$ node --experimental-strip-types plugin/scripts/import-graph-check.ts --json
valueSccs []   typeSccs []   reverseEdges []   verdict.ok true
$ grep -n 'worker-driver' plugin/scripts/worker-fan-in.ts | grep '^.*import'   ⇒ 无命中
```

**AC5（回归面）**（命令与读数，均为本 worktree 实跑）：

```
$ node --test --experimental-strip-types plugin/test/worker-driver-fan-in-s*.test.mjs
# tests 102 / # pass 102 / # fail 0

$ node --test --experimental-strip-types plugin/test/worker-driver*.test.mjs \
    plugin/test/driver-*.test.mjs plugin/test/fan-in-*.test.mjs
# tests 742 / # pass 741 / # fail 1
唯一红：`AC2 — S=1 via the .concurrency file is read identically by the bash and TS canons`
⇒ **既有红，与本改动无关**：在 pristine `develop@db5e0943b` 的对照 worktree 上跑同一文件，
  同样 4 pass / 1 fail，失败文本逐字相同（仅 duration_ms 不同）。对照读数：
  baseline = # pass 4 / # fail 1 ；本 worktree = # pass 4 / # fail 1

$ node --test --experimental-strip-types packages/quay/test/serve.test.mjs
# tests 1 / # pass 1 / # fail 0        （唯一跨包消费者 computeWorkerRoundRecord 走 re-export 面，未回归）

$ bash scripts/test.sh --for-task gap-arch-worker-fan-in-extract-from-worker-driver --allow-thin
ℹ tests 218 / pass 218 / fail 0 / duration_ms 40997.87   （exit 0）
⇒ 本轮 pre-merge 的 scoped 门（= driver fan-in 跑的同一条命令）全绿；绿后按
  `--write-scoped-gate-cache --task … --develop-sha f0ee648c4… --root <root>` 写缓存
  ⇒ `<root>/.quay/scoped-gate-cache.json` = {"key":"<task>\tf0ee648c4…","ok":true}，
  供 fan-in 跳过这次已冗余的 scoped 门。
```

**四处源码结构判据随代码搬家（⛔ 不是删断言）**：`worker-driver-fan-in-s06` / `worker-driver.test.mjs` / `fan-in-driver-mechanical-orchestration.test.mjs` 里读 `worker-driver.ts` 源码的 `assert.match` 断言，其目标代码已迁走 ⇒ 改为读 `worker-fan-in.ts`（`FAN_IN` / `FANIN_SRC`）。**负臂（「某坏形态已消失」）不降级**：改为对**两个文件都查**——代码从哪搬走都不许在任一处重现。

**第五条同类断言（由 fan-in 全量 suite 抓出；本轮修复）**：上面那四处是迁移者自己扫出来的，**还有第五处漏网**——`plugin/test/archguard-structural-gate-fan-in.test.mjs`（`gap-fan-in-remove-archguard-gate` 的 AC4）**按路径硬读 `worker-driver.ts`**，断言「archguard 步被移除之处仍文档化按需命令」（`/archguard-runner\.ts --root/`）。机械 fan-in 的 5.5 archguard 说明随代码迁进 `worker-fan-in.ts` ⇒ 该断言红（fan-in 全量 suite：`# tests 6153 / pass 6152 / fail 1`，红的就是它）。

**为何窄跑抓不到它（这也是全量 suite 不可被 scoped 门替代的一条实证）**：AC5 的窄跑 glob 是 `worker-driver*` / `driver-*` / `fan-in-*`，而该文件名以 `archguard-` 开头、不在任何一条 glob 内；`--for-task` 的 scoped 门也没选中它（那轮 218 条不含它）⇒ **只有 fan-in 的全量 suite 会看到它**。

**修法与「搬家」是两种不同的处置（写明为何不能照搬前者）**：该断言**不能**改成读 `worker-fan-in.ts`——① 该测试文件**不在本任务 Touches**（改它 ⇒ out-of-Touches 红）；② 它的正文字面就要求「文档化在 `worker-driver.ts` 的移除说明里」，那是 `gap-fan-in-remove-archguard-gate` 的既有不变量，搬家者无权单方面改写**别人**的断言。⇒ 改为**在 `worker-driver.ts` 的抽取说明处留一块指路牌**：写明步链不含 archguard 步 + 按需命令字面量 + 「步链本体与该说明的正本住在 `worker-fan-in.ts`」。既不与 `worker-fan-in.ts` 的正本冲突（正本仍在代码旁），又让读 `worker-driver.ts`（机械 fan-in 的**驱动侧入口**）的人在同一处看得到这件事。

**验证**：`node --test plugin/test/archguard-structural-gate-fan-in.test.mjs` ⇒ **3/3 绿**（修复前 1 红）。改动只增注释 ⇒ AC2（导出面）不受影响（注释不产生导出/绑定），AC4 重跑 `import-graph-check --json` 仍为 `valueSccs []` / `typeSccs []` / `reverseEdges []` / `kernelViolations []`。

**AC6（生产载体）—— 已完成的半边 + 余下待外部**：

用**生产入口本身**（`spawnMechanicalFanIn` 构造的同一 argv：`worker-driver.ts --mechanical-fan-in --task … --worktree … --root … --json`）在本 worktree 的 kernel 上跑了一次**真实机械 fan-in**（无任何 `opts.*` 测试缝，hermetic 目标仓，非 test 进程）：

```
$ node --experimental-strip-types plugin/scripts/worker-driver.ts --mechanical-fan-in \
    --task gap-af6-probe --worktree /tmp/ac6/wt --root /tmp/ac6/ws --run-id ac6-probe-1 --json
exit=0
{"outcome":"landed","verdict":null,"lockHoldSecs":6,"suiteOutcome":"done",
 "landedSha":"a33d29391b764e22e71a0187febb6f6800663276",
 "fanInLog":"fan-in-gap-af6-probe-ac6-probe-1.log",
 "instruments":{"classifier":{"evaluated":false,…},
                "reaper":{"evaluated":true,"detail":"node --experimental-strip-types
                 /home/yale/work/quay-worktrees/gap-arch-worker-fan-in-extract-from-worker-driver/plugin/scripts/worktree-process-reaper.ts"}}}
```
`instruments` 里的 kernel 路径**证明这次 fan-in 跑的是本 worktree（拆分后）的 kernel**；目标仓落地产物：
```
…/.quay/fan-in-gap-af6-probe-ac6-probe-1.log：
{"step":"ac-gate","ok":true} {"step":"flip-done","ok":true} {"step":"ff","ok":true}
{"step":"append-complete-gate-event","ok":true} {"step":"cleanup","ok":true} {"step":"release-fan-in-lock","ok":true}
$ git -C /tmp/ac6/ws log --oneline | head -1
a33d293 tasks: 翻 gap-af6-probe done（driver 机械 fan-in）
```

**取假负控制（判据能取假）**：把模块挪开，**同一个生产入口**必须失败——
```
$ mv plugin/scripts/worker-fan-in.ts /tmp/ac6/worker-fan-in.ts.aside
$ node … --mechanical-fan-in … --run-id ac6-probe-2 --json     ⇒ exit=1
Cannot find module '…/plugin/scripts/worker-fan-in.ts' imported from '…/plugin/scripts/worker-driver.ts'   (ERR_MODULE_NOT_FOUND)
$ mv /tmp/ac6/worker-fan-in.ts.aside plugin/scripts/worker-fan-in.ts   ⇒ 恢复后同一入口再次执行（ac6-probe-3 起，正常走到步骤判定）
```
⇒ 生产 fan-in 路径**结构上依赖** `worker-fan-in.ts`，不是「测试绿而已」。

**余下的半边（为何是待外部，不是没做）**：AC6 要的是「**落地后**时间窗内、`.workflow-events/` 或 dispatch 记录里**生产 driver** 完成的 fan-in 记录」。**驱动侧的执行器锚点使它结构上只能在落地后成立**：`spawnMechanicalFanIn` 用 `kernelSiblingArgv("worker-driver.ts")` 锚在**本 kernel 安装位置**（不是 worktree——`gap-fan-in-spawn-stale-worktree-executor-missing-argv` 的既定语义），而**常驻 worker-driver 跑在主检出**上；实测两条读数：
```
从本 worktree 解析 ⇒ …/quay-worktrees/gap-arch-worker-fan-in-extract-from-worker-driver/plugin/scripts/worker-driver.ts
从主检出解析     ⇒ /home/yale/work/quay/plugin/scripts/worker-driver.ts
```
主检出要等本改动**落地到 develop**（并经 doc→develop 同步）才持有 `worker-fan-in.ts` ⇒ 本任务自身那次 fan-in 走的仍是拆分前的代码，**「落地后由生产 driver 走通」的那条记录**要由**下一次** fan-in 产生。这正是任务库既有的「（待外部）」形态（先例：`tasks/gap-ac134-promotion-outcome-ledger.md` 的 AC2/DoD，done 且注明「（待外部）」）；标注后 fan-in 的 `flipAcGateVerdict` 判为 `pass-external`（`isLandedCodeComplete` 的既定语义），不阻塞翻 done。**本任务的 fan-in 日志已实证这一点**：`.quay/fan-in-gap-arch-worker-fan-in-extract-from-worker-driver-wk-prod-anchor.log` 里 `{"step":"ac-precheck","ok":true}` 且 `acTicked=6/7`。

**AC7（行数只作旁证，⛔ 不作通过判据）**：

```
迁移前  plugin/scripts/worker-driver.ts   6112 行   （git show HEAD:… | wc -l）
迁移后  plugin/scripts/worker-driver.ts   4453 行   （-1659，-27.1%）
修复后  plugin/scripts/worker-driver.ts   4459 行   （+6 = 上述「第五条断言」的指路牌注释；⛔ 行数仍只作旁证）
新增    plugin/scripts/worker-fan-in.ts   1772 行   （未变）
```

**边界说明（保持可复核）**：`worker-fan-in.ts` 内含**注释与文档**（原样平移，未删减），故 1772 行 ≈ ① 1520 + ②③④⑤ 188 + 新增导入/头注释 64。行数**只是旁证**：承重判据是 AC2（导出面 diff 空）、AC3（能取假）、AC4（无新环）、AC6（生产路径真的走了它）。

## AC

- [x] AC1（重测在先）notes 里贴出重新定位后的 fan-in 区域起止行、导出个数，以及该区域对区域外的真实调用清单（按 import/调用位置判定，非关键词），与调查的「1 处」逐条对账 —— 见 `## Notes` 第 1 节：区域本体 `3709`–`5228`（1520 行）、导出 37 个、区域外真实调用 **8 个**；对账结论 = 调查的「1」是**两点名 grep 非枚举**，同一枚举器在调查时点的真实读数是 **2**（`scopedGateCommandFor` + 类型引用 `WorkerRunResult`），故真实增长 2 → 8；8 个中 5 个只被区域消费，余 3 个同处一段连续 180 行的单缝内。**结论：仍值得拆**（触发条件一已触发、二未触发、无新增网状纠缠）。
- [x] AC2（导出面不变）迁移前后 `worker-driver.ts` 的导出名集合逐字相同：迁前迁后各跑一次导出枚举命令，两份输出 diff 为空（贴 diff 命令与结果）—— 见 `## Notes`：运行期 value 导出 **174 → 174**（missing/added 均 `[]`）+ 源码级导出名 **204 → 204**（`diff` 输出为空），两条独立枚举各跑一次。本轮只增注释 ⇒ 该面不受影响。
- [x] AC3（判据取假）临时从 `worker-driver.ts` 的 re-export 里删掉一个导出（`mechSh`），`plugin/test/worker-driver-fan-in-s*.test.mjs` 必须红；撤销后绿。两次结果贴进 notes —— 见 `## Notes`：删后 `# tests 18 / pass 0 / fail 18`，报 `does not provide an export named 'mechSh'`；撤销（逐字节还原）后 `# tests 102 / pass 102 / fail 0`。
- [x] AC4（无新环）`node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` ⇒ `valueSccs=[]`、`typeSccs=[]`、`reverseEdges=[]`、`verdict.ok=true`；`worker-fan-in.ts` 不得 import `worker-driver.ts` —— 见 `## Notes`：四条读数全部如上；`worker-fan-in.ts` 对 `worker-driver` 的 import 命中数为 0。本轮改后重跑，四条读数不变（`kernelViolations` 亦空）。
- [x] AC5（回归面）`plugin/test/worker-driver-fan-in-s01..s12.test.mjs` 与 `worker-driver*.test.mjs` 全绿，且 `scripts/test.sh --for-task gap-arch-worker-fan-in-extract-from-worker-driver` 全绿 —— 见 `## Notes`：s01–s18 合计 **102/102 绿**；`worker-driver*.test.mjs` + `driver-*.test.mjs` + `fan-in-*.test.mjs` 合计 **741/742**，唯一红是 **pristine develop 上同样红**的既有失败（`fan-in-workflow-lock` 的 `.concurrency` 条目，对照读数 4 pass/1 fail 两边逐字相同）；跨包 `packages/quay/test/serve.test.mjs` 1/1 绿；`scripts/test.sh --for-task gap-arch-worker-fan-in-extract-from-worker-driver --allow-thin` **218/218 绿**（exit 0），绿后已写 scoped-gate 缓存（`{"ok":true}`）。**（补记：窄跑与 scoped 门的覆盖缺口）** 第五处同类断言的文件名以 `archguard-` 开头，既不在任何窄跑 glob 内、scoped 门也未选中 ⇒ **它只被 fan-in 的全量 suite 抓到**（本轮已修复，见 `## Notes` 的「第五条同类断言」段）。
- [ ] AC6（生产载体，硬规则 4 推论三）拆分落地后 driver 的一次真实机械 fan-in 走通新模块：`.workflow-events/` 或 dispatch 记录里出现落地后时间窗内、由 `worker-fan-in` 路径完成的 fan-in 记录 ≥1 条（贴该记录）；关掉测试注入缝后仍成立 —— **这半边的证据只能在落地后产生**：生产 fan-in 的执行器锚在 **kernel 安装位置**（`spawnMechanicalFanIn` → `kernelSiblingArgv("worker-driver.ts")`），而常驻 worker-driver 跑在**主检出**上，主检出要等本改动落地并同步后才持有 `worker-fan-in.ts` ⇒ 本任务自身那次 fan-in 仍走拆分前代码，该记录须由**下一次** fan-in 产生。**落地前能做的半边已做完并留下读数**（见 `## Notes`）：生产入口 `--mechanical-fan-in`（无任何测试缝）在本 worktree 的 kernel 上跑出 `outcome:landed`（`landedSha=a33d293…`，目标仓落 `tasks: 翻 gap-af6-probe done（driver 机械 fan-in）`，`instruments` 回读的 kernel 路径 = 本 worktree），且**取假负控制**成立（模块挪开 ⇒ 同一入口 `ERR_MODULE_NOT_FOUND` 于 `worker-driver.ts` 的 import；恢复后再次执行）。（待外部）
- [x] AC7（行数只作旁证）notes 里记 `wc -l` 前后读数；⛔ 不得以行数作通过判据 —— 见 `## Notes`：6112 → 4453（-1659，-27.1%），本轮修复的指路牌注释使其为 4459（+6）；新增 `worker-fan-in.ts` 1772 行；并写明行数**只作旁证**，承重判据是 AC2/AC3/AC4/AC6。

## DoD

真实落地：新模块在生产 driver 上被一次真实机械 fan-in 走过（AC6），而不是只有测试绿。导出面 diff 为空（AC2）、无新环（AC4）。若重测结论是「不该再拆」，则以 AC1 的证据关闭本任务并注明，不算失败。

**本轮状态**：AC2（导出面 diff 空）、AC4（无新环）已达成；AC6 的**落地前半边**已达成并留读数（生产入口真实 fan-in 走到 `landed` + 取假负控制），**另半边**（落地后由常驻生产 driver 完成的那条记录）标注「（待外部）」——见 `## Notes` 的 AC6 节与 `tasks/gap-arch134-promotion-outcome-ledger.md` 的同一形态先例。重测结论是**「仍值得拆」**（AC1 已给出逐条依据），故不走「以 AC1 证据关闭本任务」的免失败分支。

**本轮补记**：抽取漏了一处**别人的**源码结构断言（`archguard-structural-gate-fan-in.test.mjs`），由 fan-in 全量 suite 抓出并已修复（见 `## Notes` 的「第五条同类断言」段）：按「指路牌留在 `worker-driver.ts`、正本随代码住 `worker-fan-in.ts`」处置，⛔ 未改该测试文件（不在本任务 Touches）。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/scripts/worker-fan-in.ts (new)
- plugin/scripts/capability-catalog-declarations.json
- plugin/test/worker-driver-fan-in-s01.test.mjs
- plugin/test/worker-driver-fan-in-s02.test.mjs
- plugin/test/worker-driver-fan-in-s03.test.mjs
- plugin/test/worker-driver-fan-in-s04.test.mjs
- plugin/test/worker-driver-fan-in-s05.test.mjs
- plugin/test/worker-driver-fan-in-s06.test.mjs
- plugin/test/worker-driver-fan-in-s07.test.mjs
- plugin/test/worker-driver-fan-in-s08.test.mjs
- plugin/test/worker-driver-fan-in-s09.test.mjs
- plugin/test/worker-driver-fan-in-s10.test.mjs
- plugin/test/worker-driver-fan-in-s11.test.mjs
- plugin/test/worker-driver-fan-in-s12.test.mjs
- plugin/test/worker-driver-fan-in-s13.test.mjs
- plugin/test/worker-driver-fan-in-s14.test.mjs
- plugin/test/worker-driver-fan-in-s15.test.mjs
- plugin/test/worker-driver-fan-in-s16.test.mjs
- plugin/test/worker-driver-fan-in-s17.test.mjs
- plugin/test/worker-driver-fan-in-s18.test.mjs
- plugin/test/worker-driver.test.mjs
- plugin/test/fan-in-driver-mechanical-orchestration.test.mjs
- tasks/gap-arch-worker-fan-in-extract-from-worker-driver.md
