---
id: gap-load-sensitive-tests-read-live-host-class-level-seam
title: 负载敏感测试读真实宿主、反复挡住互不相关任务着地——类级 seam 收口（证明实例 = git-graph 那本，失败率 8.55% ≈ 基准线 69 倍）
status: todo
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

- [ ] AC1（判定独立于宿主扰动·双向对照，可取假·核心）：目标测试在两种条件下各跑 ≥3 次并落盘 `.quay/lowconc-deflake-evidence.jsonl`——①人为制造该测试所敏感的扰动（对 git-graph 那本 = 在其取快照窗口内并发产生提交；若改做别本则为高并发/高负载）；②近空载/无扰动。判据：两种条件下**判定一致**（全绿一致或全红一致），每次读数带 `condition` `passed` `durationMs`。⛔ 取假形态：两种条件下判定不同 ⇒ 未达成；⛔ 不得以「重跑绿了」结案。
- [ ] AC2（改前红控制，可取假·⚠️ 允许 not-evaluated）：用**改前版本**在①扰动条件下复现该 flake ≥1 次并落盘（手法：`git show <pre-fix-ref>:<path>` 把旧版换回来跑；⚠️ 跑完换回后必须 `git diff` 验证还原干净——已知陷阱：`git checkout -- <file>` 还原到 HEAD 会把**同文件上未提交的正式改动一起静默抹掉**，故应先提交或先备份）。判据：证据文件含 pre-fix 版本在扰动下的一条 red 读数。⚠️ 若无法复现 ⇒ 记 **not-evaluated** 并写明尝试过的条件，⛔ 不得记为通过——否则无法区分「修好了」与「它本来就偶发、这次恰好没犯」。
- [ ] AC3（seam 是注入而非放宽，可取假·防空转）：注入一个**违反断言**的假宿主值时该测试必须**红**。判据：干跑一次该注入，退出码非 0，命令与输出尾部贴进读数段。⛔ 取假形态：注入错值仍绿 ⇒ seam 把测试改成了空转——**比没有测试更贵**（硬规则 3b：一个恒绿的检查是假的保证，而「没有检查」只是已知的空白）。
- [ ] AC4（硬规则 5b 的兄弟实例枚举，⛔ 非布尔）：在提交信息或读数段贴出「同载体内同形态（读活仓库/活宿主/活进程）的测试」**命中数 + 前 3 条实际内容**。判据：该数字与清单存在。⛔ 写不出这个数 ⇒ 视为只修了被报出来的那一本。⚠️ **若命中数为 0，必须把该谓词对着目标测试自己干跑一次**证明谓词确实命中它（硬规则 2 的零计数配套动作：非零查「命中的是不是我要的」，零查「谓词对真样本命不命中」）。
- [ ] AC5（五本的处置枚举，⛔ 不得留空）：产出 **5 行**表（文件 / 实测失败率 / 妨害任务数 / 同 seam 可否套用 / 处置∈{本任务已修, 已另立案（附任务 id）, 不需要（附理由）}）。判据：表恰好 5 行，每行五列均有取值。
- [ ] AC6（⛔ 不得靠改归组或移出套件回避，可取假）：判据：`git diff` 中 `@test-group` 声明行**零变更**，且目标测试仍在套件的 glob 覆盖内（`scripts/test.sh --list-groups` 的输出仍含该文件）。⛔ 取假形态：把它挪组、加 skip、或移出 glob ⇒ 未达成。（同族既有教训：某测试头注释声称已路由 serial 而 `@test-group` 实为 product ⇒ 判组要读**声明**不读注释。）
- [ ] AC7（生产载体验证·读产物，⚠️ 允许 not-evaluated）：落地后该文件的 `perFile` 失败率应下降。判据：读数段给出四个量——落地时刻、落地前的 runs/fails（117/10）、落地后窗口内的 runs/fails、以及落地后窗口长度。⚠️ 若落地后窗口内 runs 过少（< 20）⇒ 记 **not-evaluated** 并写明 runs 数，⛔ 不得用一个小样本的「0 次失败」宣告修好（8.55% 的事件在 10 次运行里不出现是常态）。

## Definition of Done

- 目标测试与其被测侧的 seam 落地；`.quay/lowconc-deflake-evidence.jsonl` 含 AC1 / AC2 / AC3 的真实读数（AC2 允许 not-evaluated 但须写明）。
- AC5 的 5 行表落地；标为「已另立案」的**已实际存在任务 id**，⛔ 不接受「建议后续处理」。
- AC4 的兄弟实例命中数与前 3 条内容进提交。
- ⛔ 本条**不动**泳道机制（`gap-load-sensitive-tests-undeclared-run-in-main-lane-block-fan-in` / `gap-serial-lowconc-reclassify-post-waterline-cap` / `gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive` 的范围）、⛔ 不再走「放宽阈值」那条路（`gap-observation-ac1-perf-threshold-relax` 已试过且未按住）。
- ⚠️ **Touches 补充义务**：Plan 1 定位出的被测生产文件若超出下列清单，worker 必须先把它追加进本任务 `## Touches` 再提交——fan-in 的 anti-drift 是 HARD-FAIL 步，读 worktree 内任务文件且只算已提交 delta，提交了未声明的文件即红。

## Touches

- tasks/gap-load-sensitive-tests-read-live-host-class-level-seam.md
- packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs
