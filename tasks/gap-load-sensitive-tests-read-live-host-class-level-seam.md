---
id: gap-load-sensitive-tests-read-live-host-class-level-seam
title: 负载敏感测试读真实宿主、反复挡住互不相关任务着地——类级 seam 收口（证明实例 = git-graph 那本，失败率 8.55% ≈ 基准线 69 倍）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：2026-09-13 本会话对「worker 退出时未落地率 62%」的实证调查（`.quay/worker-outcome.jsonl` 1801 条：exited-not-landed 1062 / completed 637 / failed 99）。

**读数一（跨任务复发是 B 类的主形态）**：窗口 2026-09-04…09-13 的 B 类（行为测试红）**145 轮**中——
- 失败测试落在该轮**当时** `## Touches` 之外的占 **92.4%**（用 `git show <该轮时刻的 sha>:tasks/<id>.md` 去污染后测得；用**当天**的 Touches 会得到 24.1% 的假象，因为 worker 修完 blocker 会把它补进 Touches）；
- **88.3% 的轮（128/145）含「在别的任务下也红过」的测试文件**；153 个不同失败文件里 **55 个在 ≥2 个不同任务下红过**；
- **25/145 轮（17.2%）含声明为 `lowconc`/`serial` 的失败测试** ⇒ 其判定依赖「不被并发执行」。

⇒ 这些红的**主形态不是本 delta 的缺陷**，而是共享闸门的负载敏感条件。

**读数二（逐文件真读数，取自 `.quay/verification-round.jsonl` 的 `perFile` 聚合 —— ⚠️ 本条已按台账核过，⛔ 不要用更早那版粗读数）**：

| 测试文件 | runs / fails | 失败率 | 末次失败 | 挡过的不同任务数 | `@test-group` |
|---|---|---|---|---|---|
| `packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs` | 117 / 10 | **8.55%（当前最高）** | 2026-09-11 | 7 | product |
| `packages/quay/test/observation.test.mjs` | 700 / 25 | 3.57% | 2026-09-09 | **≥8**（按 taskId 可核到 8） | lowconc |
| `plugin/test/worker-driver-resident.test.mjs` | 610 / 17 | 2.79% | 2026-09-09 | 8 | lowconc |
| `plugin/test/suite-bucket-reattr-ratchet-check.test.mjs` | 645 / 10 | 1.55% | 2026-09-08 | 5 | engine |
| `packages/quay/test/ts-typecheck-gate-config-wiring.test.mjs` | 532 / 5 | 0.94% | 2026-09-09 | 5 | lowconc |

**参照基准线**：`gap-perfile-failure-rate-baseline-step-change`（done）实测全历史 642 轮 / 243954 条 perFile 的**总体失败率 = 0.1246%** ⇒ 上表五本是基准线的 **7.5 倍 ~ 69 倍**。

**读数三（⚠️ 两种更便宜的修法已经各试过一次，都没按住 —— 这是本条必须是【类级】的理由）**：
- **泳道重分类**：`gap-load-sensitive-tests-undeclared-run-in-main-lane-block-fan-in`（done）把事实上负载敏感的文件声明到 lowconc/serial。`observation.test.mjs` 现在头行就是 `// @test-group lowconc` ⇒ **该修法已对它生效过，而它仍在红（3.57%）**。
- **阈值放宽**：`gap-observation-ac1-perf-threshold-relax`（done，人 2026-09-01 裁定：冷 <1.5s→<3s、预热 <200ms→<500ms）⇒ **也已对它生效过，而它仍在红**。
- **逐文件修补**：已有 9+ 条 done 的单文件任务（`gap-measure-suite-heavy-wait-ratio-load-sensitive-flaky` / `gap-full-suite-runner-test-poll-timeout-load-flake` / `gap-install-config-driven-e2e-load-flake` / `gap-worker-driver-resident-loop-intermittent-hang` 等），**每条只修一个文件**。
⇒ **存在的是「逐文件修补 + 2 条泳道机制 + 1 条阈值放宽」，不存在类级收口**（硬规则 5b：在某处修好 X ≠ X 只在那一处；缺陷是成簇的）。本条就是那个收口。

**为什么这是仪器缺陷而不是产品缺陷**：一个结果随宿主负载变化的测试**测的是宿主，不是代码**（硬规则 4b：代理量会与实际偏离，应优先观测直接量）。它的红与「代码坏了」同形，而实际归因是宿主并发度 ⇒ 账被算在一个无关任务头上。

**为什么这条不能靠「前移到 worker 自验」解决**：这批测试恰恰是**最不可能在 worker 侧忠实复现**的一类——判定依赖于**不**被并发执行，而 worker 侧预跑天然处在别的负载条件下。⇒ 只能从**测试本身**下手。

**修法手法已知（⚠️ 出处要说准）**：注 seam 让测试不读真实宿主。**该手法有 memory 记录的实证（例程单测漏注 `resourceGateArgv` ⇒ 读真实宿主 `resource-gate.sh` ⇒ 套件内红单跑绿、账算在无关任务头上），但 `tasks/` 下并无对应任务** ⇒ 本条引用它时只能说「已有记录在案的手法」，⛔ 不得声称「已有任务先例」。

**首本（证明实例）选 git-graph 那本，理由三条**：①**失败率当前最高**（8.55%，≈基准线 69 倍）；②**根因已诊断在案**——它读活仓库做 2–3 次快照，与 suite 之外的并发提交赛跑，提交落在该文件约 2s 窗口内必红（实测 end_ms 13:39:32.630 vs 一个提交落在 13:39:31）⇒ **是一个干净的「读活宿主」面，正好是 seam 的目标形态**；③记录在案的结论明确写着 **⛔ 不是撞上它的那个任务的缺陷、别重实现** ⇒ 与本条「账不该算在受害任务头上」的立场一致。

## Plan

1. **先定位，后动手**：查明 git-graph 那本的判定究竟读了哪个宿主量（活仓库提交流 / 活进程 / 并发度 / 时钟），定位到**具体测试用例 + 具体读法**。
2. 注 seam（形状对齐记录在案的 `resourceGateArgv` 手法）让该量**可注入**；断言改为对注入值成立。
   ⛔ 不是放宽断言、⛔ 不是加 retry、⛔ 不是加 sleep、⛔ 不是改 `@test-group` 挪组——那四种都只是让红消失，不是让判定可靠。
3. **硬规则 5b**：修完后在同一载体里 grep 该形态（读活仓库/活宿主）的**兄弟实例**，把命中数与前 3 条实际内容贴进提交。
4. 对其余 4 本各给出「同一 seam 形态可否套用」的判断——能套用的直接修；不能的**实际立案**（附失败率与妨害数以便排序）。

## Acceptance Criteria

- [x] AC1（判定独立于宿主扰动·双向对照，可取假·核心）：目标测试在两种条件下各跑 ≥3 次并落盘 `.quay/lowconc-deflake-evidence.jsonl`——①人为制造该测试所敏感的扰动（对 git-graph 那本 = 在其取快照窗口内并发产生提交）；②近空载/无扰动。判据：两种条件下**判定一致**（全绿一致或全红一致），每次读数带 `condition` `passed` `durationMs`。✅ **6 条读数全绿一致**：近空载 ×3（540/562/657ms）、扰动 ×3（538/562/588ms；扰动 = 后台提交者每 0.4–0.5s 落一条 `tasks: 翻 gap-frozen-achieved-ac-no-owner done（driver 机械 fan-in）`，跑测期间实测落 1–2 条）。⛔ 未以「重跑绿了」结案——扰动是与 AC2 同一条件、只是被测文件换成改后字节。
- [x] AC2（改前红控制，可取假·⚠️ 允许 not-evaluated）：用**改前版本**在①扰动条件下复现该 flake ≥1 次并落盘。✅ **改前字节（`testSha 466b193ac7…`，与改后同一份克隆、唯一差异是被测文件本身）在同一扰动下 3/3 红**：失败尾部 `group count (6) == subject-mention count (11)` / `(8)/(13)` / `(10)/(15)`；同一克隆近空载 ×3 绿 ⇒ 构成**双向对照**。⚠️ 还原用 `git checkout <pre-fix-sha> -- <file>` 落成一个提交（⛔ 不是 `git checkout -- <file>`，那会抹掉同文件上未提交的改动）；克隆与工作树无任何共享可写状态，工作树 `git status` 全程只有本条自己的两处改动。
- [x] AC3（seam 是注入而非放宽，可取假·防空转）：注入一个**违反断言**的假宿主值时该测试必须**红**。✅ 干跑 `QUAY_DEFLAKE_POISON=unattributed node --experimental-strip-types --test packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs` ⇒ **EXIT=1**，`✖ AC3: a real task id spans ≥2 git columns but is exactly one task group` / `AssertionError: some real task id spans ≥2 git columns in this window`（injection = seam 供给一个「所有 subject 都归属不到任何 id」的宿主）。⇒ 判定确实**穿过** seam，不是空转。命令与输出尾部见证据文件 `kind=AC3`。
- [x] AC4（硬规则 5b 的兄弟实例枚举，⛔ 非布尔）：✅ 载体 = 套件 glob 的 **632** 个 `*.test.mjs`。谓词 = 同一文件里既 `readGitHistory(` 又直接 `("git", ["-C", REPO_ROOT, "log"`（即**两次独立读同一宿主窗口并互相对账**）：**命中 7**（6 个兄弟 + 本文件）。前 3 条实际内容：①`gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs:38: const out = execFileSync("git", ["-C", REPO_ROOT, "log", "--graph", "--all", "-n", String(n), "--pretty=format:%x01%H"],` ②同文件 `:56: … "log", "--all", "--topo-order", "-n", String(n), "--pretty=format:%H%x1f%P" …` ③同文件 `:72: const history = readGitHistory(REPO_ROOT, { limit: LIMIT });`。零计数配套动作照做：谓词对**已知为真**的目标文件干跑命中（`:48` 与 `:83`）。
- [x] AC5（五本的处置枚举，⛔ 不得留空）：✅ 5 行见下方「落地读数」的 AC5 表；标「已另立案」的两本**已实际存在**：`gap-suite-wallclock-budgets-literals-depend-on-host-capacity`、`gap-suite-bucket-zombie-check-bills-the-next-unrelated-task`。
- [x] AC6（⛔ 不得靠改归组或移出套件回避，可取假）：✅ `git diff` 中 `@test-group` 声明行**零变更**（文件头仍是 `// @test-group product`）；目标测试仍在覆盖内——`bash scripts/test.sh --group product --list-files` 命中该文件，`bash scripts/test.sh --list-groups` 首行 `test-group-downgrade-check … PASS: no test file was moved out of the default {product,engine} set without a commit-message reason`（baseline 622 glob files），`scripts/test.sh:796` 的 glob 字面量未动。
- [x] AC7（生产载体验证·读产物，⚠️ 允许 not-evaluated）：⚠️ **not-evaluated（落地后窗口 runs=0 < 20）**。落地前 117/10（8.55%，末次 2026-09-11T12:52:28Z）；本记录写于 fan-in 之前（ff 在本 worker 退出后才发生）⇒ 落地后窗口长度 0、runs=0。⛔ 不用「0 次失败」宣告修好。复评法：落地后从 `.quay/verification-round.jsonl` 取该文件 `perFile` 行、窗口限定在落地提交时刻之后，runs ≥ 20 再判。

## Definition of Done

- 目标测试与其被测侧的 seam 落地；`.quay/lowconc-deflake-evidence.jsonl` 含 AC1 / AC2 / AC3 的真实读数（AC2 允许 not-evaluated 但须写明）。
- AC5 的 5 行表落地；标为「已另立案」的**已实际存在任务 id**，⛔ 不接受「建议后续处理」。
- AC4 的兄弟实例命中数与前 3 条内容进提交。
- ⛔ 本条**不动**泳道机制（`gap-load-sensitive-tests-undeclared-run-in-main-lane-block-fan-in` / `gap-serial-lowconc-reclassify-post-waterline-cap` / `gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive` 的范围）、⛔ 不再走「放宽阈值」那条路（`gap-observation-ac1-perf-threshold-relax` 已试过且未按住）。
- ⚠️ **Touches 补充义务**：Plan 1 定位出的被测生产文件若超出下列清单，worker 必须先把它追加进本任务 `## Touches` 再提交——fan-in 的 anti-drift 是 HARD-FAIL 步，读 worktree 内任务文件且只算已提交 delta，提交了未声明的文件即红。

## 落地读数（AC1–AC7；原始读数 19 条在 `.quay/lowconc-deflake-evidence.jsonl`）

**改了什么**：① 生产侧 seam —— `packages/quay/src/observation.ts` 的 `readGitHistory(root, { exec })`，默认 `realGitExec` 与原先的内联 `execFileSync` 逐字等价（两处调用点 `exec(args, {timeout})`），**注入时绕过 30s 缓存**（fixture 不得顶着生产键留在缓存里，硬规则 3b）；② 目标测试对活仓库的三次独立读改为**一次冻结快照**（`snapshotExec`，fail-closed：不认识的调用直接 throw）；③ AC6 的计数对账从**活窗口**挪到**受控窗**（每条 subject 声明其应得归属，含两种发散形态作显式负例）。

**⚠️ 根因与任务书所载不同（附对照，非解释）**：任务书写的是「读活仓库 2–3 次快照，提交落在 ~2s 窗口内必红」。实测**否证**：
- ① 10 次记录在案的失败，该轮文件运行的 −180s..+60s 内**可达提交数为 0（10/10）**；
- ② 失败**成簇**（1404/1405/1406、1438/1439、1445/1446、1542/1543）——瞬态竞态不会连续三轮同形；
- ③ 失败轮 `load` 均值 **21.3 < 通过轮 25.4**（n=10/107）——与「负载敏感」相反。
- **真根因**：AC6 的独立读数用 `subject.includes(id)`，而**子串 ≠ 归属**——生产窗口里 **4/45** 个分组发散（3 个前缀相撞 `gap-ac242` ⊂ `gap-ac242-derived-…`，1 个散文提及 `… 三选一之① DIR-131 AC6 口径澄清`）。
- **决定性对照**：静态仓库、零并发、运行窗内零提交，只落一条 `tasks: 翻 gap-frozen-achieved-ac-no-owner done` ⇒ AC6 红（`group count (2) == subject-mention count (7)`）；换个非前缀相撞的 id ⇒ 绿。
- ⇒ 活窗口上的「条数相等」不是**代码**的性质而是**数据**的性质；任何 count 要么重实现抽取规则（成为被测代码的回声，硬规则 4），要么在数据上发散。故修法随之改变：seam 仍落地（把宿主读取变成可控），但**计数对账挪到受控窗**；活窗口保留结构判据（AC3/AC4）。

**AC5 五本处置（5 行，每行五列）**

| 文件 | 实测失败率 | 妨害任务数 | 同 seam 可否套用 | 处置 |
|---|---|---|---|---|
| `packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs` | 8.55%（117/10） | 7 | ✅ 可（本任务已落地） | **本任务已修** |
| `packages/quay/test/observation.test.mjs` | 3.57%（701/25） | 15 | ❌ 量是**经过的墙钟时间**（AC1 冷 <3s / 预热 <500ms；红时实测 32.4s–65.2s），注入时钟＝把性能断言变空转 | **已另立案** `gap-suite-wallclock-budgets-literals-depend-on-host-capacity` |
| `plugin/test/worker-driver-resident.test.mjs` | 2.78%（611/17） | 13 | ❌ 同上；断言体是 `waitFor(…, 10000)` 的裸字面上限（已从 5000 抬到 10000，仍红） | **已另立案** `gap-suite-wallclock-budgets-literals-depend-on-host-capacity` |
| `plugin/test/suite-bucket-reattr-ratchet-check.test.mjs` | 1.55%（646/10） | 8 | ❌ 对账两端是【已提交 reattr 表】vs【活盘套件文件集】，注入任一端＝取消该检查本身；真问题是归因错位（删除者不承担，下一个跑套件的任务承担） | **已另立案** `gap-suite-bucket-zombie-check-bills-the-next-unrelated-task` |
| `packages/quay/test/ts-typecheck-gate-config-wiring.test.mjs` | 0.94%（532/5） | 5 | ❌ 跑真 `npx tsc --noEmit` 的**真接线检查本身**；`.quay/config.yml:95-98` 的 `timeoutMs` 已从 60000 抬到 120000（注释自述「~25s 隔离 / >60s 满载」）仍被击穿 | **已另立案** `gap-suite-wallclock-budgets-literals-depend-on-host-capacity` |

（妨害任务数 = `.quay/verification-round.jsonl` 中该文件 `perFile.passed=false` 的**不同 `taskId` 数**，2026-09-13 逐条复算；任务书表列 `≥8 / 8 / 5` 系另一口径，此处取复算值。）

**scoped 门**：`bash scripts/test.sh --for-task gap-load-sensitive-tests-read-live-host-class-level-seam --allow-thin` ⇒ **exit 0**，140 tests / 0 fail（含目标文件 7/7 绿）。回归侧另核：`gap-dashboard-parallelize.test.mjs`（`readGitHistory` 的 30s 缓存回归）13/13 绿 ⇒ 默认路径未变。

## Touches

- tasks/gap-load-sensitive-tests-read-live-host-class-level-seam.md
- packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs
- packages/quay/src/observation.ts