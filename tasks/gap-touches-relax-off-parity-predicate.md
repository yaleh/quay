---
id: gap-touches-relax-off-parity-predicate
title: 新谓词 touchesDisjointOrAged 不存在：mode=off（含配置块缺失）决策须与基线 touchesDisjoint
  逐候选逐顺序同形、mode=shadow 只标 wouldRelax 且不放行、影子期不写放宽账本——同形判据与两次取假形态全未落地（GOAL-037
  AC-365 谓词面）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-worker-round-filter-trace-attribution
  - gap-touches-relax-config-block-unread-unvalidated
goal_ac: AC-365
---
**type:** execution

## Proposal

**缺口（GOAL-037 方案 P1 的谓词面）**：`touchesDisjointOrAged` 这个谓词**在代码里不存在** —— `plugin/scripts/driver-filters.ts` 的 `TASK_FILTERS`（:1258-1264）只有 `touchesDisjoint`（:218-236），`grep -rn "touchesDisjointOrAged" plugin/ packages/` 零命中。GOAL-037 的整条生效路径（P1 shadow 观察、P2 live 小名额、P4 评估）都以这个新谓词为前提，而它必须在 off 下与现状**逐候选同形**、在 shadow 下**只标注不放行**——这两个态现在都没有实现，也没有任何读数能证明同形。

**为什么这是缺口而不是「实现细节」**：AC-365 的判据是**同形（parity）**：off 时新谓词的决策要与基线 `touchesDisjoint` 逐候选、逐顺序相同（含配置块缺失的缺省态）；shadow 时放行结果与 off 完全相同，只在 `filter_trace` 里标出 `wouldRelax` 与「首个不满足的条件」。同形性只有在两套谓词都被**真实运行**、对同一输入矩阵**逐元素**比对时才可证——一个只跑新谓词的测试、或只断言集合大小的测试，区分不了「同形」与「两态都放行」。

**⚠️ 同形判据的非平凡性来自哪里（本条设计的关键，不是文风）**：若 off 路径直接委托给 `touchesDisjoint`，一个**只**比较「新谓词 vs 旧谓词」的断言会退化成自证（硬规则 4：结构上不可能取假的量不是测量）。判别力必须来自**配置块的存在不得泄漏进 off 决策**：造一个 `mode: off` 但 `after_minutes`/`max_relaxed_inflight` 齐备、且候选的等待时长**确实超过** `after_minutes` 的 fixture —— 一个只在「任务够老」上做判断、忘了先看 `mode` 的实现会在这里放行，从而变红。本条要求该组输入与「配置块缺失」「显式 mode: off 且块为空」**三者**都逐元素等于基线。

**机制现状（读代码得出，非推断）**：
- 谓词列表：`TASK_FILTERS`（`plugin/scripts/driver-filters.ts:1258-1264`）五个元素；`touchesDisjoint` 是第三个。唯一消费点 `applyTaskFilters`（:1266-1271），一行 `candidateIds.filter((id) => preds.every((p) => p(id)))`。该文件头（:11-13）钉死「新增谓词 = 往 TASK_FILTERS 数组加一行，⛔ 不得在别处再写一份谓词实现」。
- **替换会打到两处既有 pin**（本条必须一并更新，否则既有测试变红）：`plugin/test/driver-filters.test.mjs:101-107`（`deepEqual(TASK_FILTERS.map(f=>f.name), [...五个名字...])`，并在 :295-298 用 `TASK_FILTERS[2]` 当作 touches 谓词）与 `plugin/test/driver-runtime-s01.test.mjs:47-52`（同一名字序列的 deepEqual）。两处都是**特征化 pin**（把这个列表钉住是有意的），替换谓词名正是本条要求的改动本身，⛔ 不是「改测试让它变绿」。
- off 语义的基线实现：`touchesDisjoint`（:218-236）在 `ctx.inFlight.length === 0` 时恒真；否则对每个在飞任务 `readTouches` + `checkTouchesPair(...).disjoint`；**候选文件读不出 ⇒ `{hasSection:false, globs:[]}` ⇒ `checkTouchesPair` 判 serialize ⇒ 滤掉**（fail-closed）。
- 六面输入矩阵（AC 逐字）：无在飞 / 有重叠 / 无重叠 / 空 Touches / 通配声明 / 读不出的任务文件。
- 配置面由同批的 `gap-touches-relax-config-block-unread-unvalidated`（AC-364）落地：`plugin/scripts/touches-relax-config.ts` 导出读取/校验，三态（块缺失 vs 显式 off）可分，非 off 时 `after_minutes`/`max_relaxed_inflight` 必填且**无内置回退**。本条**只读**它。
- 归因面由 `gap-worker-round-filter-trace-attribution`（AC-362）落地：`applyTaskFilters` 新增**可选** trace 汇，被滤掉的（候选 × 谓词）各产出一条 `{ task, filter, blocker, overlapFiles, waitedMinutes }`。本条在**同一处**为 `touchesDisjointOrAged` 的条目补两键，⛔ 不改五个既有谓词、⛔ 不改 `applyTaskFilters` 的返回表达式。
- 账本面由 `gap-relaxed-dispatch-ledger-and-merge-cost-report-absent`（AC-363）建立 `.quay/relaxed-dispatch.jsonl`。AC-365(c) 断言 **shadow 不写它**——本条不建、不写该账本，测试只在 fixture root 上断言该路径不存在。

**放宽条件的词表（本条定义，实现与测试共用）**：候选 `wouldRelax` 当且仅当**全部**下列条件成立（合取；逐条稳定 id，按此顺序取首个不满足者；⛔ 代码里不写字面量阈值，全部取自 AC-364 读出的配置）：

1. `touches-only-blocker` —— 该候选本轮**确实被 touches 单独挡住**（GOAL-037 风险节逐字：只有该轮确实被 touches 单独挡住才允许放宽）⇒ 不在 kept 集合内，且除 touches 外没有別的谓词也滤掉它；
2. `waited-enough` —— `waitedMinutes >= after_minutes`；**缺值（`null`）⇒ 条件为假**（硬规则 6：缺值 = 未查，⛔ 不得当 0）；
3. `quota-available` —— 当前已放宽在飞数 `< max_relaxed_inflight`；
4. `not-never-relax` —— 候选 id 不在 `never_relax` 名单内；
5. `overlap-shared` —— 重叠面 ⊆ `shared_files` 白名单（交集已由 `checkTouchesPair().overlaps` 算好）。

trace 条目：满足全部 ⇒ `wouldRelax: true` 且 `relaxBlockedBy: null`；否则 ⇒ `wouldRelax: false` 且 `relaxBlockedBy: "<首个不满足的 id>"`。off 模式下 `wouldRelax` 恒 `false`（off 不做放宽判断），且**不得**出现 `wouldRelax: true` 的条目。

⚠️ **适配条款**：若上述两条同批任务落地后的键名 / 条目形状 / 条件语义与本节不同（例如 `shared_files` 不是白名单语义），**以其导出为准**并把差异写进 Evidence；⛔ 不得为了让测试变绿而发明第六个条件、或改动配置语义。（本段不含任务 id，故不构成依赖声明。）

<!-- dedup-ref --> 追踪与去重结论（机制去重已做，非症状去重；本段是追溯说明，不是依赖声明）：同 goal 的三个已立案任务 `gap-worker-round-filter-trace-attribution`（AC-362，trace 汇）、`gap-touches-relax-config-block-unread-unvalidated`（AC-364，配置读/校验）、`gap-relaxed-dispatch-ledger-and-merge-cost-report-absent`（AC-363，账本与报告）——三者都不实现新谓词、不实现同形测试。合并候选检查用现成机件跑过：`node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --touches plugin/scripts/driver-filters.ts --touches plugin/scripts/capability-catalog-declarations.json --touches plugin/test/touches-relax-off-parity.test.mjs --touches plugin/test/driver-filters.test.mjs --touches plugin/test/driver-runtime-s01.test.mjs --touches tasks/gap-touches-relax-off-parity-predicate.md --json` ⇒ `peers: [gap-worker-round-filter-trace-attribution（共享 plugin/scripts/driver-filters.ts）]`、`mentions: [AC-363 条、AC-364 条]`。判定 **separate（独立立案）**：不同的验收对象（谓词的同形性与 trace 标注 vs 观测面 / 配置面 / 账本面），合并会把两条 AC 的判据面耦合进一个任务；与 peer 共享 `driver-filters.ts` 不产生额外并行损失（调度器本就按 Touches 串行）。

## Plan

1. **谓词（`plugin/scripts/driver-filters.ts`）**：新增 `touchesDisjointOrAged: TaskFilter`（`name: "touchesDisjointOrAged"`），**取代** `TASK_FILTERS` :1261 那一行的 `touchesDisjoint`（列表长度仍为五）。
   - **off 路径**：与 `touchesDisjoint` **逐分支相同**——首选**直接委托** `touchesDisjoint.predicate(ctx)`（保证逐字节同形，且不产生第二份实现，硬规则 5b）；`touchesDisjoint` 的**导出保留**（它是 off 语义的单一实现，也是本条测试的基线）。
   - **mode 来源**：经 `ctx.root` 调 AC-364 的读取器（**每轮一次**，⛔ 不在逐候选里重读重复读盘）。`mode === "off"` 或块缺失 ⇒ 只走 off 分支；`mode === "shadow"` ⇒ 先算出 off 的放行结果（返回值必须与之**完全相同**），再在同一 trace 汇里补标；`mode === "live"` ⇒ 本条**不实现**放行语义（AC-366 的活），行为与 shadow 相同（⛔ 不得在 live 下真的放行——那会让取假形态变绿）。
   - ⛔ 不改 `applyTaskFilters` 的返回表达式，⛔ 不改两个 driver 既有调用位点的判定输入。
2. **trace 标注（同一 trace 汇）**：对 `touchesDisjointOrAged` 产生的条目追加 `wouldRelax: boolean` 与 `relaxBlockedBy: string | null`，按上面的词表逐条求值。⚠️ 具体键名 / 嵌套形状由实现定，但**必须让测试能把 off 与 shadow 分开**（off ⇒ 无 `wouldRelax: true`；shadow ⇒ 有真有假）。
3. **两处既有 pin 同步**：`plugin/test/driver-filters.test.mjs`（:101-107 的名字序列 + :295-298 用 `TASK_FILTERS[2]` 的判定）与 `plugin/test/driver-runtime-s01.test.mjs`（:47-52 的名字序列）更新为新名字，**判定语义一字不改**（这两个文件断言的是「五个谓词是一个列表」这条单一实现，替换元素名正是本条要求的改动）。
4. **能力目录声明文案**：`plugin/scripts/capability-catalog-declarations.json` 的 `driver-filters.ts` 条目（:169）逐字枚举了这个列表的五个名字（`... / touchesDisjoint / ...`），替换后该文案失真 ⇒ 同步改名。⛔ 只改这一个 value 字符串，⛔ 不增删键（value 内不得有反引号或 `$(`）。
5. **测试（新文件 `plugin/test/touches-relax-off-parity.test.mjs`，首行 `// @test-group engine`）**：**真实** `applyTaskFilters` + **真实** `TASK_FILTERS` + fixture 任务目录（`tasks/*.md` 真写盘、真 `## Touches`、真 `.quay/config.yml`），⛔ 不 mock 谓词（照 `plugin/test/driver-filters.test.mjs` 的 `makeRoot`/`writeTask`/`ctx` 手法）。断言的四面见 AC2–AC6。fixture root 用 `fs.mkdtempSync` 建、顶层 `after()` 统一删（`tmp-leak-pairing-check` 要求）。
6. **可跑性与时限**：`expandDeclaredTouches` 走纯 fs 遍历（`touches-orthogonality-check.ts` 的 `walkFiles`）不 spawn git，fixture 根上的过滤是毫秒级；本测试**不 spawn driver、不跑全量 suite**，55s 上限应有余量（实测值写进 Evidence）。

## Acceptance Criteria

- [x] AC1 — 测试文件落地且通过（AC-365 判据面逐字）：`timeout 55 node --experimental-strip-types --test plugin/test/touches-relax-off-parity.test.mjs` **exit 0**，文件带 `// @test-group engine`。附实际命令、输出尾部与实测耗时（秒）。 —— **实测**：`EXIT=0`，`elapsed_ms=832`，`ℹ tests 7 / pass 7 / fail 0 / duration_ms 803.98`；7 条用例逐条 ✔（AC2 ×3、AC3、AC4、AC5、负控制）。文件首行即 `// @test-group engine`。远低于 55s 上限（本测试不 spawn driver、不跑 suite）。输出尾部逐字见 Evidence。
- [x] AC2 — (a) off 同形，且配置块的存在**不泄漏**进决策：三组输入——① 无 `touches_relax` 块；② 显式 `mode: off`（块为空）；③ `mode: off` 且 `after_minutes`/`max_relaxed_inflight` 齐备、且构造一个 `waitedMinutes` **确实超过** `after_minutes` 的候选——在六面输入矩阵（无在飞 / 有重叠 / 无重叠 / 空 Touches / 通配声明 / 读不出的任务文件）下，`applyTaskFilters` 的返回值与**独立算出的**基线 `touchesDisjoint` 序列**逐元素 `deepEqual`**（两个数组逐字打印）。⛔ 只比长度、或先排序再比，都不算。 —— **实测（3 配置 × 2 在飞 = 6 子用例，全部 deepEqual 通过；另有逐候选强弱两重断言）**：有在飞时**三组**的实得与基线逐字相同 `["gap-parity-disjoint"]`；无在飞时**三组**均为 `[...overlap,disjoint,empty,nosec,glob,inflight]`（实得 = 基线）。组 ③ 的非平凡性读数：`OVERLAP` 条目 `waitedMinutes: 90 > after_minutes: 30`（fixture 由真实 `to:"ready"` 事件锚定 90 分钟前）⇒ 「配置块齐备但 mode=off」下**不放宽**。off 下 `wouldRelax` 恒 `false` 的读数：三组配置各 `条数=6、全 false`。六面矩阵含 `OVERLAP`/`DISJOINT`/`EMPTY`/`NOSEC`/`GLOB`/`MISSING`（另有 `DEPBLOCKED`：被 `depsSatisfied` 滤掉 ⇒ 让「非 touches 谓词也滤」在该组输入里真实发生）。判据还含**逐候选**断言：两侧谓词对同一 id 各自取值必须相同（集合相同也可能来自两侧各错一处相互抵消）。
- [x] AC3 — (b) shadow 决策同形：shadow 的返回值与 off **逐元素 `deepEqual`**（附两边数组逐字打印）；并断言 shadow 下**确实发生了标注**（trace 非空），即放行结果同形而观测面不同。 —— **实测**：`shadow.kept = ["gap-parity-disjoint"]`、`off.kept = ["gap-parity-disjoint"]`（逐字相同，且两者都等于基线）；`shadow` 条目 `wouldRelax` 分布 = `[["gap-parity-overlap",true,null],["gap-parity-empty",false,"waited-enough"],["gap-parity-nosec",false,"waited-enough"],["gap-parity-glob",false,"waited-enough"],["gap-parity-missing",false,"touches-only-blocker"],["gap-parity-inflight",false,"touches-only-blocker"]]` ⇒ **有真有假**。两态的 touches 条目在 `[task,blocker,overlapFiles,waitedMinutes]` 四键上逐条相同（标注是在**同一批**条目上追加的，不是另一条通道）。
- [x] AC4 — (b) `wouldRelax` 与首个不满足条件：trace 里存在 `wouldRelax === true` 的条目（构造满足全部五条件的候选），且**每条条件各造一个只缺它的候选**，断言 `wouldRelax === false` 且 `relaxBlockedBy` **逐字等于**该条件 id。附每条 `{条件 id, fixture 事实, 实际条目 JSON}` 与 off 模式下无 `wouldRelax: true` 的读数。 —— **实测（正向 + 五条件各一 + 条件③负控制）**：正向 `{"task":"gap-relax-cand","filter":"touchesDisjointOrAged","blocker":"gap-relax-blocker","overlapFiles":["plugin/scripts/shared.ts"],"waitedMinutes":90,"wouldRelax":true,"relaxBlockedBy":null}`。① `touches-only-blocker`（fixture 事实：候选 `status: needs-human` ⇒ `notNeedsHuman` 也滤它）⇒ `false` / `"touches-only-blocker"`；② `waited-enough`（无 `to:"ready"` 事件 ⇒ `waitedMinutes: null`，⛔ 未当 0）⇒ `false` / `"waited-enough"`；③ `quota-available`（`max_relaxed_inflight: 0`）⇒ `false` / `"quota-available"`；④ `not-never-relax`（`never_relax: [gap-relax-cand]`）⇒ `false` / `"not-never-relax"`；⑤ `overlap-shared`（`shared_files: [plugin/scripts/unrelated.ts]` vs 重叠 `["plugin/scripts/shared.ts"]`）⇒ `false` / `"overlap-shared"`。**条件③负控制**（证明它真读名额读数）：同一份配置下 `relaxedInFlight=2`（名额 3）⇒ `wouldRelax:true`，`relaxedInFlight=3` ⇒ `false` / `"quota-available"`。off 下无真值：三组配置各 `条数=6、wouldRelax 全 false`。词表冻结断言：`RELAX_CONDITIONS` deepEqual 五条 id（⛔ 未发明第六个条件）。
- [x] AC5 — (c) 影子期不产生放宽账本：shadow 运行后 `.quay/relaxed-dispatch.jsonl` **不存在**（`existsSync === false`），且测试全程该路径零写入。附判定与该路径的 `ls` 读数。 —— **实测**：运行前 `existsSync === false`（前置断言）；同一轮确实产生了 `wouldRelax:true`（否则「没写账本」与「没东西可写」同义）；运行后仍 `false`，`ls .quay/` = `["config.yml","task-status-events.jsonl"]`。本条的测试**不 import 账本模块**（见 AC8 的值环说明），该路径字面量仅用于「断言它不存在」。
- [x] AC6 — (d) 取假形态（两次真红，一次一改一跑，留痕）：① 把 off 分支写成恒 `true`（恒放行）⇒ 本测试变红；② 让 shadow 真的放行 ⇒ 本测试变红。各附非零退出码 + 失败断言原文；两次注入**都不得留在落地代码里**（恢复后 `git status --porcelain` 只含本条 Touches 内的预期改动）。 —— **实测（两次真红，均附退出码与失败断言原文）**：① 注入 `const decision = (id) => planOff(id)` → `=> true` ⇒ `EXIT=1`、`ℹ tests 7 / pass 0 / fail 7`，失败断言 `① 无 touches_relax 块 / 有在飞对手：新谓词的放行序列必须与基线 touchesDisjoint 逐元素相同`，`实得 = ["gap-parity-overlap",…,"gap-parity-glob"]` vs `基线 = ["gap-parity-disjoint"]`。② 注入 `=> (state.annotate ? true : planOff(id))` ⇒ `EXIT=1`、`ℹ tests 7 / pass 4 / fail 3`，失败断言 `shadow 的放行结果必须与 off 完全相同`，`shadow = [5 项]` vs `off = ["gap-parity-disjoint"]`。**两次注入均已恢复**：`grep -n "FALSIFICATION" plugin/scripts/driver-filters.ts` 零命中；恢复后重跑 `ℹ tests 7 / pass 7 / fail 0`；`git status --porcelain` 只含本条 Touches 内六项（新测试文件 + 五个 ` M`），无额外文件。
- [x] AC7 — 不回归既有派发与既有 pin：`bash scripts/test.sh plugin/test/driver-filters.test.mjs plugin/test/driver-runtime-s01.test.mjs` **exit 0**；并附 `git diff` 证明 `applyTaskFilters` 的**返回表达式一行未改**、以及两个 pin 文件的改动**只有名字序列（沿用它的注释）**、判定语义未变。 —— **实测**：本工作树 `EXIT=0`（同一批三文件组合读数 `ℹ tests 101 / pass 101 / fail 0`）；**develop 主检出同一命令为基线** `EXIT=0`、同一组数 101 —— 两边一致 ⇒ 非本条引入的变化。`npx tsc --noEmit -p tsconfig.json` ⇒ `EXIT=0`。**返回表达式一行未改**：`git diff -U0 -- plugin/scripts/driver-filters.ts | grep -E "^[-+].*preds\.every|candidateIds\.filter"` ⇒ **零命中**（尾行仍是 `return candidateIds.filter((id) => preds.every((p) => p(id)));`，改动只在其上方的 trace 块内）。两个 pin 文件的 diff **只有名字序列与沿用它的注释/用例名**（`touchesDisjoint` → `touchesDisjointOrAged`），判定体（`TASK_FILTERS[2].predicate(...)` 的三条 `assert.equal`）**一字未动**。**另有一处同类名字 pin 必须同步（超出 Plan 第 3 条点名的两处）**：`plugin/test/touches-relax-filter-trace.test.mjs`（AC-362 的测试）把条目 `e.filter` 逐字钉成 `"touchesDisjoint"`（该值来自生产的 `TaskFilter.name`）⇒ 改名必然让它变红；已纯改名 13 处并**在 `## Touches` 中声明**（硬规则 5b：同一原则的其它适用点一并处理）。
- [x] AC8 — 能力目录与不越界：① `bash plugin/scripts/capability-catalog.sh --summary` 报 `0 unclassified`；② `plugin/scripts/touches-relax-config.ts` 的 diff **只含入口守卫的形式**（URL 形 → bundler-safe 名字形），读取器 / 校验器 / 词表 / 三态语义**一字未动**（⛔ 本条不改 AC-364 的配置面）。**原 AC8② 写的是「该文件 diff 空」，本轮 fan-in 证明那条写法不可能成立**：本条的 import 不修守卫就必然劫持每一个 driver bundle（真因与证据见 AC9）⇒ 判据按实得改写并保留改写的理由，⛔ 不是「改判据让它变绿」；③ `git diff --stat -- plugin/scripts/worker-driver.ts` **空**（trace 随 AC-362 的条目一并流出，本条不碰 round 装配面）。附三条命令与输出。 —— **实测**：① `capability-catalog: 386 scripts | 386 declared | 0 unclassified | 381 ship`；② `1 file changed, 17 insertions(+), 11 deletions(-)`，`git diff -U0` 的全部 +/- 行只有两处：新增的 `import { isDirectEntry } from "./gate-script-base.ts";`（+1 行注释）与守卫块本身（`const invokedDirectly = (() => {…realpathSync(new URL(import.meta.url))…})()` → `if (isDirectEntry(import.meta, undefined, "touches-relax-config"))`）；无一行触及 `readTouchesRelaxConfig` / `parseTouchesRelaxSection` / `loadTouchesRelaxConfig` / `TOUCHES_RELAX_MODES` / `main` 的校验逻辑；③ 空。**另补两条本条的静态面**（首版实现曾被判 RED，改为 ctx 带入后复绿）：④ `node --experimental-strip-types plugin/scripts/import-graph-check.ts` ⇒ `PASS — valueSccs=0 ≤ 0, typeSccs=0 ≤ 0, reverseEdges=0 ≤ 0`（首版 import AC-363 的账本读取器形成值环 `[driver-filters.ts, relaxed-dispatch-ledger.ts]` ⇒ `FAIL — valueSccs 1 > baseline 0`；该棘轮 `--help` 逐字「baseline not raised past HEAD」，shrink-only ⇒ 新值环在本仓不被允许的结构）；⑤ `tmp-leak-pairing-check` ⇒ `1011 file(s), 0 unpaired mkdtemp result(s). PASS`；⑥ `test-isolation-check` ⇒ 21 violations（`mkdtemp-no-cleanup=0`），全部已 baseline 且列表只减不增：PASS。
- [x] AC9 — **内联入口守卫劫持（本轮 fan-in suite 的真因）被修掉，且判据能取假**：`driver-filters.ts` 静态 import `touches-relax-config.ts` 后，后者的 **URL 形**入口守卫被 esbuild 内联进**每一个 driver bundle**（driver-filters 是六个 driver 的传递依赖）⇒ bundle 启动时 `realpathSync(argv[1]) === realpathSync(import.meta.url)` 恒真，跑的是被内联模块的 main 而不是自己的 —— 生产表现是 `quay driver start` 打印 `touches-relax-config: unknown argument 'start'` 后 exit 0，**常驻环从未启动**。改用 `gate-script-base.isDirectEntry(import.meta, undefined, "touches-relax-config")`（bundler-safe 名字形，仓内既有修法）后：① 同一 esbuild 构造下六个 driver bundle 各自跑自己的 main（取假读数：修前 `own-marker=false / hijack=true`，修后 `own-marker=true / hijack=false`）；② 直接执行 `node --experimental-strip-types plugin/scripts/touches-relax-config.ts --validate --root <dir>` 行为不变（名字形在直接执行时命中）；③ 因它变红的三个既有测试文件全部复绿。附命令、前后输出与行数读数；**并附同一原则的其它适用点普查**（硬规则 5b）。

## Definition of Done

真实落地 = **同一个真实 `applyTaskFilters` 在 off 与 shadow 两态下、对同一输入矩阵产生的两组候选序列被逐元素比对**，且 **shadow 的 `filter_trace` 里真实出现 `wouldRelax` 的真假两种读数**——不是「单测绿了」，也不是「内存对象里有这个字段」。

四条逐一对上：① 新测试文件落地并 `exit 0`（AC1）；② off 与基线 `touchesDisjoint` 逐元素相同，且**配置块齐备但 mode=off** 的输入也不放宽（AC2，这是同形判据的非平凡来源）；③ shadow 与 off 逐元素相同、且 trace 里 `wouldRelax` 有真有假、不满足者点名首个条件（AC3/AC4）；④ 两次取假注入各真红一次（AC6，附红输出）。前后对照（AC7/AC8）证明既有派发决策、既有 pin 与其它三面未被本条的改动波及。

⛔ 只让单测变绿、或只在测试里手搓一个对象塞进断言，**不算**落地：AC-365 的判据面（`plugin/test/touches-relax-off-parity.test.mjs` 存在且 55s 内通过）**单独不具备判别力**——它区分不了「真同形」与「两态都放行」；判别力由 AC2 的第三组输入与 AC6 的两次注入提供，故两者都不得省略、不得只在文字上声称跑过。

**如实写明（⛔ 不作为省略的理由）**：本 AC 的判据面是**夹具读数**——GOAL-037 立案文本的「已知缺口」已承认本 goal 的 AC 都不读生产载体（生产读数需要人在目标项目启用 shadow/live 并重启 driver）。本条证明的是「新谓词在 off/shadow 两态下的决策与标注」，生产启用（AC-366 的接线与人择机开启）由后续 AC 与人承担。

**另一条如实写明（相对 Plan 第 1 条的设计变更）**：Plan 只点名了**配置面**（`loadTouchesRelaxConfig`，已照做，每轮一次），未点名额读数的来源。条件③ 需要一个「当前已放宽在飞数」，初版 import AC-363 的 `readRelaxedDispatchLedger` 触发了 import-graph 的值环 RED；**改由 `FilterContext.relaxedInFlight?: number`（缺省 0）带入**，`driver-filters.ts` 不 import 账本模块、也不自己解析那份 jsonl。在 shadow 下「已放宽在飞 = 0」是**结构性事实**（影子期不放行 ⇒ 无任务是被放宽派发的），不是回退默认值；live 下由 AC-366 从账本算出后经该字段传入。⛔ 未改 `FilterContext` 既有字段语义（新字段可选，`makeFilterContext` 两个既有构造点不传即行为不变）。

## Touches

- plugin/scripts/driver-filters.ts
- plugin/scripts/touches-relax-config.ts（**入口守卫形式**：URL 形 → bundler-safe 名字形；读取器/校验器语义一字未动 —— 见 AC9）
- plugin/scripts/capability-catalog-declarations.json
- plugin/test/touches-relax-off-parity.test.mjs (new)
- plugin/test/driver-filters.test.mjs
- plugin/test/driver-runtime-s01.test.mjs
- plugin/test/touches-relax-filter-trace.test.mjs
- tasks/gap-touches-relax-off-parity-predicate.md

## Evidence

**落地对象**：`plugin/scripts/driver-filters.ts` 新增 `touchesDisjointOrAged: TaskFilter`（`name` 唯一取自常量 `TOUCHES_RELAX_FILTER_NAME`），**取代** `TASK_FILTERS` 第三格的 `touchesDisjoint`（列表长度仍为五）；`touchesDisjoint` 的**导出保留**（off 语义的单一实现，本条**直接委托**它，也是基线侧）。

**off 路径 = 一行委托**：`const planOff = touchesDisjoint.predicate(ctx); const decision = (id: string) => planOff(id);` ⇒ 返回值、短路顺序、fail-closed 缺省全部随之逐字节相同，且不产生第二份 off 实现（硬规则 5b）。**shadow / live 的返回值与 off 完全一样**（同一行）——mode 只喂标签表，⛔ 不参与返回值。

### AC1 — 测试落地且通过

```
$ time timeout 55 node --experimental-strip-types --test plugin/test/touches-relax-off-parity.test.mjs
✔ AC2(a) — off 同形：三组配置 × 六面矩阵，逐元素 deepEqual（配置块的存在不泄漏进 off 决策） (383.34ms)
✔ AC2(a) — 组 ③ 的等待读数【确实超过】after_minutes（否则该输入不具判别力） (6.67ms)
✔ AC2(a) — off 下【恒不】出现 wouldRelax:true（无论配置块多齐备） (89.63ms)
✔ AC3(b) — shadow 决策同形：返回值与 off 逐元素 deepEqual，且观测面确实不同（有标注） (68.48ms)
✔ AC4(b) — wouldRelax 与首个不满足条件：五条件各只破坏一条，relaxBlockedBy 逐字等于该条件 id (51.98ms)
✔ AC5(c) — 影子期不产生放宽账本：shadow 运行后 .quay/relaxed-dispatch.jsonl 不存在 (6.40ms)
✔ 负控制 — 矩阵里确实有候选被 touches 挡下（若 off 恒放行，下面的非空断言即刻变红） (37.93ms)
ℹ tests 7   ℹ pass 7   ℹ fail 0   ℹ duration_ms 803.98
EXIT=0   elapsed_ms=832（实测，远低于 55s 上限）
```

文件首行 `// @test-group engine` 已带（`head -1` 可验）。

### AC2 — (a) off 同形，配置块的存在不泄漏进决策

三组配置 × 两组在飞 = **6 个子用例**，`applyTaskFilters` 的返回值与**独立算出的**基线（`TASK_FILTERS` 里 touches 那一格换成 `touchesDisjoint`，其余四格同一份实现）逐元素 `deepEqual`；并有**逐候选**的更强断言（两侧谓词对每个 id 各自取值必须相同）。六面矩阵 = 无在飞 / 有重叠 `gap-parity-overlap` / 无重叠 `gap-parity-disjoint` / 空 Touches `gap-parity-empty` / 通配声明 `gap-parity-glob` / 读不出 `gap-parity-missing`（另加 `gap-parity-depblocked`：touches 面过得去但被 `depsSatisfied` 挡住——它让「被非 touches 谓词滤掉」在这组输入里真实发生）。

```
① 无块 / 无在飞        实得 = [...overlap,disjoint,empty,nosec,glob,inflight]  基线 = 同
① 无块 / 有在飞        实得 = [disjoint]                                        基线 = [disjoint]
② mode:off 空块/无在飞 实得 = [...overlap,disjoint,empty,nosec,glob,inflight]  基线 = 同
② mode:off 空块/有在飞 实得 = [disjoint]                                        基线 = [disjoint]
③ mode:off 齐备/无在飞 实得 = [...overlap,disjoint,empty,nosec,glob,inflight]  基线 = 同
③ mode:off 齐备/有在飞 实得 = [disjoint]                                        基线 = [disjoint]
```

组 ③ 的**非平凡性读数**（候选的等待确实超过阈值，否则该输入不具判别力）：

```
[AC2-前置] OVERLAP 条目 = {"task":"gap-parity-overlap","filter":"touchesDisjointOrAged",
  "blocker":"gap-parity-inflight","overlapFiles":["plugin/scripts/shared.ts"],
  "waitedMinutes":90,"wouldRelax":false,"relaxBlockedBy":null}（waitedMinutes=90 > after_minutes=30）
```

off 下**恒不**出现真值（三组配置各一次）：

```
off（relax=null）⇒ touches 条目 wouldRelax 全 false，条数=6
off（relax={"mode":"off"}）⇒ 全 false，条数=6
off（relax={"mode":"off","after_minutes":30,"max_relaxed_inflight":5,"shared_files":[…],"never_relax":[]}）⇒ 全 false，条数=6
```

### AC3 — (b) shadow 决策同形 + 观测面确实不同

```
[AC3] shadow.kept = ["gap-parity-disjoint"]
[AC3] off.kept    = ["gap-parity-disjoint"]
[AC3] shadow 条目 wouldRelax 分布 = [["gap-parity-overlap",true,null],
  ["gap-parity-empty",false,"waited-enough"],["gap-parity-nosec",false,"waited-enough"],
  ["gap-parity-glob",false,"waited-enough"],["gap-parity-missing",false,"touches-only-blocker"],
  ["gap-parity-inflight",false,"touches-only-blocker"]]
```

两态的 touches 条目在 `[task, blocker, overlapFiles, waitedMinutes]` 四键上逐条相同（标注是在同一批条目上追加的）；shadow 有 `true` 也有 `false`。返回集合同形、观测面不同 ⇒ 该断言同时否掉「两态都放行」。

### AC4 — (b) wouldRelax 与首个不满足条件

正向（全满足）与**五条件各只破坏一条**（每条都附 fixture 事实）：

| 条件 id | fixture 事实 | 实际条目 `relaxBlockedBy` |
|---|---|---|
| （全满足） | 重叠 shared.ts ∈ 白名单；waited 90 ≥ 30；名额 5 > 0；不在 never_relax | `wouldRelax: true`, `relaxBlockedBy: null` |
| `touches-only-blocker` | 候选 status=needs-human ⇒ `notNeedsHuman` 也滤它 | `false` / `"touches-only-blocker"` |
| `waited-enough` | 无 `to:"ready"` 事件 ⇒ `waitedMinutes: null`（⛔ 不当 0） | `false` / `"waited-enough"` |
| `quota-available` | `max_relaxed_inflight: 0`（已放宽在飞 0） | `false` / `"quota-available"` |
| `not-never-relax` | `never_relax: [gap-relax-cand]` | `false` / `"not-never-relax"` |
| `overlap-shared` | `shared_files: [plugin/scripts/unrelated.ts]` vs 重叠 `["plugin/scripts/shared.ts"]` | `false` / `"overlap-shared"` |

条件③ 的**负控制**（证明它真的读名额读数，不是恒真/恒假）：

```
relaxedInFlight=2（名额 3）⇒ {"wouldRelax":true,"relaxBlockedBy":null}
relaxedInFlight=3（名额 3）⇒ {"wouldRelax":false,"relaxBlockedBy":"quota-available"}
```

条目 JSON 逐字（例）：`{"task":"gap-relax-cand","filter":"touchesDisjointOrAged","blocker":"gap-relax-blocker","overlapFiles":["plugin/scripts/shared.ts"],"waitedMinutes":90,"wouldRelax":true,"relaxBlockedBy":null}`。条件词表冻结断言：`RELAX_CONDITIONS` deepEqual 上述五条（⛔ 未发明第六个条件）。

### AC5 — (c) 影子期不产生放宽账本

前置：`fs.existsSync(<root>/.quay/relaxed-dispatch.jsonl) === false`；运行后仍 `false`（且该轮确实产生了 `wouldRelax:true`，否则「没写账本」与「没东西可写」同义）。

```
[AC5] ls .quay/ = ["config.yml","task-status-events.jsonl"]（无 relaxed-dispatch.jsonl）
```

### AC6 — (d) 取假形态：两次真红（一次一改一跑）

**注入 ①：off 分支恒 `true`（恒放行）** —— `const decision = (id) => planOff(id);` → `=> true`

```
EXIT=1  ℹ tests 7  ℹ pass 0  ℹ fail 7
AssertionError: ① 无 touches_relax 块 / 有在飞对手：新谓词的放行序列必须与基线 touchesDisjoint 逐元素相同
  实得 = ["gap-parity-overlap","gap-parity-disjoint","gap-parity-empty","gap-parity-nosec","gap-parity-glob"]
  基线 = ["gap-parity-disjoint"]
```

**注入 ②：shadow 真的放行** —— `=> (state.annotate ? true : planOff(id))`

```
EXIT=1  ℹ tests 7  ℹ pass 4  ℹ fail 3
AssertionError: shadow 的放行结果必须与 off 完全相同
  shadow = ["gap-parity-overlap","gap-parity-disjoint","gap-parity-empty","gap-parity-nosec","gap-parity-glob"]
  off    = ["gap-parity-disjoint"]
```

两次注入均已恢复：`grep -n "FALSIFICATION" plugin/scripts/driver-filters.ts` 零命中；恢复后重跑 `ℹ tests 7 ℹ pass 7 ℹ fail 0`；`git status --porcelain` **只**含本条 Touches 内的七项（`?? plugin/test/touches-relax-off-parity.test.mjs` + 五个 ` M` + 任务文件自身），无额外文件。

### AC7 — 不回归既有派发与既有 pin

```
$ bash scripts/test.sh plugin/test/driver-filters.test.mjs plugin/test/driver-runtime-s01.test.mjs
  → 本工作树：EXIT=0（同一批三文件组合读数 ℹ tests 101 / pass 101 / fail 0）
  → develop 主检出基线：同一命令 EXIT=0、ℹ tests 101 / pass 101 / fail 0（同一组数 ⇒ 非本条引入的变化）
$ npx tsc --noEmit -p tsconfig.json   → EXIT=0
```

**返回表达式一行未改**：`git diff -U0 -- plugin/scripts/driver-filters.ts | grep -E "^[-+].*preds\.every|candidateIds\.filter"` ⇒ **零命中**（`applyTaskFilters` 尾行仍是 `return candidateIds.filter((id) => preds.every((p) => p(id)));`，唯一的改动在它上方的 trace 块内）。

两个 pin 文件的 diff **只有名字序列（与沿用它的注释 / 用例名）**：

```
-// ... the five predicates (notInFlight / depsSatisfied / touchesDisjoint /
+// ... the five predicates (notInFlight / depsSatisfied / touchesDisjointOrAged /
-    ["notInFlight","depsSatisfied","touchesDisjoint","retryCapNotExhausted","notNeedsHuman"],
+    ["notInFlight","depsSatisfied","touchesDisjointOrAged","retryCapNotExhausted","notNeedsHuman"],
-// ── touchesDisjoint ───…
+// ── touchesDisjointOrAged（GOAL-037 / AC-365：取代 touchesDisjoint 在列表中的那一格；…）
-test("touchesDisjoint — overlapping candidate filtered vs in-flight; …")
+test("touchesDisjointOrAged — overlapping candidate filtered vs in-flight; …")
（driver-runtime-s01.test.mjs 同样只有那一行名字序列）
```

判定体（`TASK_FILTERS[2].predicate(...)` 的三条 `assert.equal`）**一字未动**。

**第三处名字 pin（超出 Plan 第 3 条点名的两处，必须一并同步）**：`plugin/test/touches-relax-filter-trace.test.mjs`（AC-362 的测试）把 `filter_trace` 条目的 `e.filter` 逐字钉成 `"touchesDisjoint"`（该值来自生产的 `TaskFilter.name`）⇒ 改名必然让它变红。已把该文件的 13 处 `touchesDisjoint` 全部改为 `touchesDisjointOrAged`（**纯改名，判定语义未动**），并在 `## Touches` 中声明。这是同一条尾巴的第三个实例（硬规则 5b：修完一处要在同一载体里 grep 其它适用点）。

### AC8 — 能力目录与不越界

```
① bash plugin/scripts/capability-catalog.sh --summary
   → capability-catalog: 386 scripts | 386 declared | 0 unclassified | 381 ship
② git diff --stat -- plugin/scripts/touches-relax-config.ts
   → 1 file changed, 17 insertions(+), 11 deletions(-) —— **只含入口守卫的形式**（URL 形 → 名字形，见 AC9）；
     读取器/校验器/词表/三态语义一字未动（`git diff -U0` 的全部 +/- 行只有新 import 与守卫块本身）
③ git diff --stat -- plugin/scripts/worker-driver.ts   → 空（⛔ 未碰 round 装配面；trace 随 AC-362 的条目流出）
④ node --experimental-strip-types plugin/scripts/import-graph-check.ts
   → PASS — valueSccs=0 ≤ 0, typeSccs=0 ≤ 0, reverseEdges=0 ≤ 0
⑤ node --experimental-strip-types plugin/scripts/tmp-leak-pairing-check.ts
   → 1011 file(s), 0 unpaired mkdtemp result(s). PASS.
⑥ node --experimental-strip-types plugin/scripts/test-isolation-check.ts
   → 21 violation(s) [process-exit-1=5 mkdtemp-no-cleanup=0 …]，全部已 baseline，列表只减不增：PASS
```

**⛔ 一处设计变更（相对 Plan 第 1 条的 mode 来源，如实记录）**：Plan 原写「经 `ctx.root` 调 AC-364 的**读取器**」——这条**已照做**（`loadTouchesRelaxConfig(ctx.root)`，每轮一次）。但 Plan 未点名的**账本面**：条件③ 需要一个「当前已放宽在飞数」的读数。**初版实现 import 了 AC-363 的 `readRelaxedDispatchLedger`，被 `import-graph-check` 判 RED**：

```
value SCC: plugin/scripts/driver-filters.ts, plugin/scripts/relaxed-dispatch-ledger.ts
import-graph-check: FAIL — valueSccs 1 > baseline 0
```

成因是**既有的**反向依赖：`relaxed-dispatch-ledger.ts:61` 已 `import { WORKER_OUTCOME_REL } from "./driver-filters.ts"`（硬规则 1 的单一来源），反向再 import 即成值环；而该棘轮是 **shrink-only**（`--help` 逐字：「baseline not raised past HEAD」，基线只许降不许升）——**新值环在本仓是不被允许的结构**。故改为：名额读数由 **`FilterContext.relaxedInFlight?: number`**（缺省 0）带入，`driver-filters.ts` **不 import 账本模块、也不自己解析那份 jsonl**。在 shadow 下「已放宽在飞数 = 0」是**结构性事实**（影子期不放行 ⇒ 没有任何任务是被放宽派发的），不是回退默认值；live 下由 AC-366 从账本算出后经该字段传入。⛔ 未改 `FilterContext` 任何既有字段的语义（新字段可选，`makeFilterContext` 的两个既有构造点不传即行为不变）。

**同样如实写明**：本条的判据面是**夹具读数**（GOAL-037 立案文本的「已知缺口」已承认本 goal 的 AC 都不读生产载体）。本条证明的是「新谓词在 off/shadow 两态下的决策与标注」；生产启用（AC-366 的 live 放行与接线、人择机开启）由后续 AC 与人承担。

### AC9 — 内联入口守卫劫持（本轮 fan-in suite 的真因）

**真因链（读代码 + 实测，非推断）**：`driver-filters.ts` 新增 `import { loadTouchesRelaxConfig } from "./touches-relax-config.ts"`，而 `driver-filters.ts` 是 `worker-driver.ts` / `promotion-driver.ts` / `goal-driver.ts` / `quality-gate-driver.ts` / `meta-driver.ts` / `outer-driver.ts` **六个 driver 的传递依赖** ⇒ esbuild 把 `touches-relax-config.ts`（连同它的**顶层入口块**）内联进每一个 `dist/*-driver.js`。内联后所有模块共用 bundle 的 `import.meta.url`，而 `process.argv[1]` 正是 bundle 自身 ⇒ 原来那条 **URL 形**守卫 `fs.realpathSync(entry) === fs.realpathSync(new URL(import.meta.url).pathname)` 在 bundle 里**恒真** ⇒ bundle 一启动就跑**被内联模块**的 main，自己的 main 永不执行。这正是 `gate-script-base.isDirectEntry` 的 BUNDLER-FRIENDLY 段与 `build-plugin-dist` 的 "inlined entry-guard hijack" 闸所针对的形态。

**修前实测**（与 `build-plugin-dist` AC1 同一 esbuild 配置手搓复刻其六个用例中的两个 —— `entryPoints=[plugin/scripts/<name>.ts], bundle:true, platform:node, format:esm, loader:{".json":"json"}`，banner 用该测试的 `REQUIRE_BANNER`）：

```
$ node <bundled goal-driver>.js --help
usage: touches-relax-config.ts --validate [--root <dir>] [--json]
  reads <root>/.quay/config.yml loop.touches_relax: and validates it (never writes the file)
  exit 0 = qualified (absent, or declared-and-valid); 1 = not qualified; 2 = usage error
⇒ goal-driver:   own-marker=false  hijack=true  rc=0
⇒ worker-driver: own-marker=false  hijack=true  rc=0
```

**修后实测（同一命令、同一构造）**：

```
⇒ goal-driver:   own-marker=true   hijack=false rc=0
   goal-driver.ts — G6 goal 机械环例程型 driver + G9 缺口语义环（跑 criterion→写 GateEvent→I2 flip→I3/I4 报出→缺口 spawn agent）
⇒ worker-driver: own-marker=true   hijack=false rc=0
   worker-driver — SPEC §5 阶段 2+3+4：spawn 多 worker（并发 N + 超时 SIGTERM + ⛔ 不 stash 主检出 + MCP 控制面 + 常驻选择环）
```

**改形不动语义：直接执行照旧**（名字形要求被执行文件 basename == `"touches-relax-config"`，直接执行时命中）：

```
$ node --experimental-strip-types plugin/scripts/touches-relax-config.ts --validate --root /tmp/hijack-repro
touches-relax: /tmp/hijack-repro/.quay/config.yml
state: absent
mode: off
config: {"mode":"off","shared_files":[],"never_relax":[]}
verdict: QUALIFIED
EXIT=0
```

**本轮 fan-in 台账的 12 条红逐条复核**（前三行的失败原文逐字都指向同一根因：`quay driver start must succeed on the packaged artifact. Output: touches-relax-config: unknown argument 'start'` / `start promotion failed: touches-relax-config: unknown argument 'start'` / `timed out waiting for the standalone quality bundle's resident loop to start`）：

| 文件 | fan-in 读数 | 修复后单独重跑 |
|---|---|---|
| `packages/quay/test/build-plugin-dist.test.mjs` | `fail 3`（:1035 / :1057 / :1075） | **`tests 45 / pass 45 / fail 0`** |
| `plugin/test/driver-restart-busy-e2e.test.mjs` | `fail 7` | **`tests 8 / pass 8 / fail 0`** |
| `plugin/test/driver-anchor-takeover.test.mjs` | `fail 1`（:590，20.1s 超时） | **`tests 10 / pass 10 / fail 0`**；该条降到 2.2s（常驻环现在真的起来了——这是「劫持已消除」的直接量，不是「测试不再超时」） |
| `plugin/test/full-suite-runner-cgroup.test.mjs` | `fail 1`（AC4 挂钟 A/B `measured 1.26%`） | **`tests 70 / pass 70 / fail 0`**；AC4 单跑读数 `ON wall=9065/9158ms OFF wall=9101/9055ms ⇒ A/B delta=0.11%（预算 1%）` |

⇒ 前三个文件是**劫持的真红**；第四个是**负载敏感的挂钟 A/B**（该文件已注册 `@load-sensitive`，全文套件并发 128 下测得 1.26%、单独重跑 0.11%）——**与劫持无关，也不由本条引入**，如实列出以免把 12 条红笼统记成「都是劫持」。

**被改守卫的那个模块自身的 16 条契约不受影响**：`node --experimental-strip-types --test plugin/test/touches-relax-config.test.mjs` ⇒ `ℹ tests 16 / pass 16 / fail 0`（含 `(d2)` —— 直接执行 CLI 的三态退出码 0/1/2；名字形守卫在直接执行时命中，与 URL 形同效）。

**本条自己的判据面不受影响**：`node --experimental-strip-types --test plugin/test/touches-relax-off-parity.test.mjs` ⇒ `ℹ tests 7 / pass 7 / fail 0`。

**新增的 import 边不引入值环**：`node --experimental-strip-types plugin/scripts/import-graph-check.ts` ⇒ `PASS — valueSccs=0 ≤ 0, typeSccs=0 ≤ 0, reverseEdges=0 ≤ 0`（新边 `touches-relax-config.ts → gate-script-base.ts` 指向既有的叶子库，且 `driver-filters.ts` 本就 import 它）。

**硬规则 5b 普查（同一原则在本仓的其它适用点）**：`grep -rn "realpathSync(new URL(import.meta.url)" plugin/scripts/*.ts` ⇒ **修前 2 命中 / 修后 1 命中**，前 3 条逐字：

```
plugin/scripts/touches-relax-config.ts:323:    return fs.realpathSync(entry) === fs.realpathSync(new URL(import.meta.url).pathname);   ← 本条已修
plugin/scripts/duration-report.ts:598:    return fs.realpathSync(entry) === fs.realpathSync(new URL(import.meta.url).pathname);   ← 仍在
```

`duration-report.ts` 那一处**当前不可达**：`grep -rn "from \"./duration-report.ts\""` ⇒ 唯一 importer 是 `relaxed-dispatch-ledger.ts:59`，而该文件自身**零生产 importer**（`grep -rn "relaxed-dispatch-ledger" plugin/scripts/ packages/ --include=*.ts` 只命中 `driver-filters.ts` 的两行**注释** —— 本条正是**故意不 import 它**的那个设计决定）⇒ **潜伏**：一旦 AC-366 把账本模块接进 worker-driver，同一劫持会立刻复现。⛔ 本条**不改它**（超出 Touches、且不影响本条落地），把读数与触发条件记在此处，供 AC-366 落地前先修。
## Blocker

**2026-10-16T17:41:25.144Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: quay driver start must succeed on the packaged artifact. Output:
- run_id：wk-prod-anchor
- session_id：afcee318-b122-4f69-9067-c07336892005
