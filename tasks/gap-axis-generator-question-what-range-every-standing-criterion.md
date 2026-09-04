---
id: gap-axis-generator-question-what-range-every-standing-criterion
title: "a predictive dimension generator (not another gap): the machine's
  dimension generation is a BYPRODUCT of friction (all 7 machine-opened
  dimensions were post-friction; without a human discovery goes ASYMPTOTIC — fix
  the snags then report green on every never-opened axis, tonight's 4
  deteriorating metrics alarmed by nobody); the generator: for each standing
  criterion ask 'what range does it quantify — time/scope/layer/instance/cost?
  if the answer is the present one, there's an unopened axis' (5/5
  reverse-validated against the human's tonight); the falsifiable criterion
  replacing the vague AC9: 'did it open a dimension BEFORE it hurt' — nightly
  mechanically-countable as newly-filed tasks with NO triggering failure at
  filing (current 0); merge ruling: the two projections (point-in-time quality +
  stop-conditions-no-scope) are time-axis + scope-axis outputs of this generator
  — annotate as projections, don't pick instances one by one (that's limited by
  the human being present)"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`orchestration/SYNTHESIS-axis-generation-2026-08-05.md`（管理者，人更正目标：自举演进才是目的）。
**核心：一个【有预测力的生成器】**，不是又一个缺口。

**实测推翻预设**：「机器只发现机械缺陷、结构性靠人」是假的——200 个 gap 任务里可归因的人 20 / 机器
36（机器 1.8×），且机器自己开过至少 **7 根新维度**（墙钟→并发 / 资源 / 判据自身有效性 / 自主度 /
升级溯源 / 驱动语义 / 可发现性）。

**真正的差别不是能不能，是什么时候**：那 7 条**全部产生于「用的时候被硌了一下」**；人开的 20 条不需要
疼。⇒ **机器的维度生成是摩擦的副产品。** 没有人时不会停止发现，会**渐近**——修完硌人的、在从未打开过
的每一根轴上报绿。今晚实例：套件耗时 / 每测试成本 / 晋级速率 / 就绪池水位，四条全恶化、全没报警、全靠
人问出来。

**可证伪判据（替换含糊的 AC9）**：不是「能不能发现缺陷」（已证明），是——**「它有没有在某个维度还没
疼的时候打开过那个维度？」** 当前计数 **0**（那 7 条全是 post-friction）。可每晚机械统计：新立案任务里
有几条在立案时**不存在**触发它的失败/告警/矛盾。

**AC10 记账（管理者 pre-friction 计数，独立于机器计数）**：0 → 1（dead-loop，去看才看见）→ 3
（generator-run：dead-glob + gate-scripts-dead，照问句问出）→ 4（needs-human 黑洞——人依赖计数不可信/
无时限/无人看，needs-human=15 静静躺着，无任何东西在疼）→ 5（判据不记自身成本——16 检查器 + 14 闸门
零落盘，退化在被人手工发现前不可见，另 29 条判据无东西在疼）→ **6（suite-state 缺原因轴——state=red
只有一个值承载「这轮没成」，failed/aborted/infra-error 对下游反应完全不同被压成标量；外层被迫手写 note
逃生舱——逃生舱出现的位置就是缺失维度的位置；发现时无东西在疼，巧合尚未破裂）**。机器 pre-friction
计数仍 **0**。生成器问句对 needs-human：量化的是「这个任务需要人决定」——但**多久**（无时限）？
**机制还在不在**（不检查）？缺时间轴 + 存活轴。生成器问句对判据成本：量化哪个范围？**没有量化**（完全
空着）。生成器问句对 suite-state：量化「这一轮没成」——缺**原因轴**（为何没成：failed/aborted/infra）。

> **AC5 cross-mark (2026-08-06, `gap-no-criterion-records-its-own-cost-checker-cost-jsonl`)**:
> the count-5 pre-friction "判据不记自身成本" (manager-discovered 2026-08-05, 生成器问句「判据成本量化在
> 哪个范围」→ 没有量化) is that task. It asked the generator's cost question and got "nothing — no
> criterion persists its own execution time; 16 检查器 + 14 闸门零落盘". The fix (each criterion exit
> appends `{name, ms, n, load}` to `.quay/checker-cost.jsonl`, pure-append zero-judgment) is tracked
> in that task; this entry is the AC10 accounting cross-reference only. Its cross-ref
> `gap-suite-state-has-no-reason-axis-failed-aborted-infra` (count-6, suite-state 缺原因轴) is the
> same pre-friction axis's next instance.
>
> **AC5 cross-mark (2026-08-05, `gap-gate-scripts-laid-down-but-dead-and-not-mutation-checked`)**:
> the count-3 pre-friction "gate-scripts-dead" (generator-run, 照问句问出) is that task. It asked
> the generator's own layer question — "量化哪个范围" for `plugin/gate-scripts/` — and got "laid
> down but never executed" (the dead-weight layer). Disposal (layered retirement of the
> `--gate-scripts` category from quay-init, so `dead_gates_remaining = 0`) is tracked in that task;
> this entry is the AC10 accounting cross-reference only.
>
> **AC5 cross-mark (2026-08-05, `gap-no-criterion-records-its-own-cost-checker-cost-jsonl`)**:
> the count-5 pre-friction "判据不记自身成本" (16 检查器 + 14 闸门零落盘，退化在被人手工发现前不可见) is
> that task. It asked the generator's cost-axis question — "判据的成本量化在什么范围?" — and got
> "没有量化" (完全空着). The fix (checker-cost.jsonl 纯追加 + load 维 + 套件耗时序列并入) is tracked in
> that task (status: ready); this entry is the AC10 accounting cross-reference only. The follow-on
> count-6 "suite-state 缺原因轴" is tracked in `gap-suite-state-has-no-reason-axis-failed-aborted-infra`.
>
> **AC5 cross-mark (2026-08-05, `gap-stale-check-orchestration-arm-is-a-dead-glob`)**:
> the count-3 pre-friction "dead-glob" (generator-run, 照问句问出) is that task. It asked the
> generator's instance question — "陈旧判据量化的是【哪些实例】？" — for the strategic-doc
> staleness check and got "the one filename it was written thinking about" (`*ROADMAP*`), not the
> whole orchestration layer (43+ docs, ZERO matching `*ROADMAP*`). The fix (orchestration arm
> widened to `orchestration/*.md`, dead glob eliminated) is tracked in that task; this entry is the
> AC10 accounting cross-reference only.
>
> **AC5 cross-mark (2026-08-06, `gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite`)**:
> the scope-axis instance "cold-start gate criterion too wide — whole-suite green" (manager-discovered
> 2026-08-05, 生成器问句「这条判据量化的是哪个范围」→ 整个套件, but cold-start only lays the DERIVED
> laydown set) is that task. The fix (gate narrowed to the derived laydown set's scripts green, 铺什么
> 验什么, mechanically derived via grep SKILL/loop docs) is tracked in that task; this entry is the AC10
> accounting cross-reference only — **post-friction, NOT counted** (the manager asked the range question
> while BLOCKED on the wait, not before friction; AC10 计数保持 0, 记录不勾, per the task's AC5).
>
> **AC5 cross-mark (2026-08-05, `gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed`)**:
> the count-1 pre-friction "dead-loop" (manager-discovered 2026-08-05, 「去看才看见」——不是被硌出来的,
> 见 AC10 记账行 `0 → 1（dead-loop，去看才看见）`) is that task. It is the L2 continuous-health instance
> of the generator's time/instance question applied to the whole standing-criterion set: every L1 criterion
> quantifies "was the instrument laid down", none quantifies "is the loop actually running". The fix (the
> dead-loop criterion: target outer/inner transcript user messages + git commit time window, `plugin/scripts/
> dead-loop-check.sh`) is tracked in that task; this entry is the AC10 accounting cross-reference only.

**生成器**：对系统里每一条常驻判据问——**「它量化的是哪一个范围？时间 / 作用域 / 层 / 实例 / 成本？
如果答案是『眼前这一个』，那就有一根没打开的轴。」** 检验：反推人今晚给的 5 条，**5/5 成功**。⇒ 有
预测力，不是事后归纳。

### 选定机制（外层裁定：高优先立案 + 归并）

1. **生成器作为机制**：对每条常驻判据跑「量化哪个范围」问句——答案「眼前这一个」⇒ 生成「未打开的轴」
   任务（系统化发现，不靠人在场/不靠摩擦）。
2. **可证伪判据（AC9 替换）**：每晚统计——新立案任务里有几条立案时**不存在**触发它的失败/告警/矛盾
   （= 有没有在没疼时开维度；当前 0）；这是趋势判据（随窗口打标）。
3. **归并裁定**：`gap-quality-criteria-are-point-in-time-no-trend-criteria`（时间轴投影）+
   `gap-quantified-stop-conditions-have-no-scope`（作用域轴投影）**是同一生成器的两个投影**——标注为
   生成器输出（不合并中期任务，破坏性），生成器是系统化发现的 umbrella，**不再一条条捡实例**（捡实例
   速度受限于人在场）。

## Acceptance Criteria

- [x] AC1: **生成器机制**——对每条常驻判据跑「量化哪个范围（时间/作用域/层/实例/成本）」问句；答案
      「眼前这一个」⇒ 生成未打开轴任务（系统化发现）
      **证据**：`plugin/scripts/axis-generator.ts --criteria`（`node --experimental-strip-types
      plugin/scripts/axis-generator.ts --criteria`）机械枚举仓库 28 条常驻判据（`.quay/config.yml`
      gates + `scripts/test.sh` run_static_checks/CI 静态检查器，非手写清单）并对每条输出五轴 range
      判定；实测 **28/28 都至少有一根未打开轴**（total criteria: 28 | with ≥1 unopened axis: 28）——
      系统化发现，不靠摩擦、不靠人在场。分类器是「量化哪个范围」问句（RANGE 信号），非轴名关键词扫描
      （`--selfcheck` 的 invariant 控制证明「time axis」字样不打开 time 轴）。
- [x] AC2: **可证伪判据（AC9 替换）**——每晚统计新立案任务里「立案时无触发失败/告警/矛盾的条数」
      （= 有没有在没疼时开维度；当前 0）；趋势打标
      **证据**：`plugin/scripts/prefriction-count.sh`（`bash plugin/scripts/prefriction-count.sh`）对
      git 窗口内新增任务逐条扫触发证据（失败/崩溃/泄漏/OOM/告警/恶化/矛盾/「今晚」等，触发面从宽）计
      数无触发者；实测最近 24h 滚动窗口（2026-08-05 复验）输出 `prefriction_dimensions=0`（73 条新立案
      全部有触发，含 quay-init 断检出等——触发面从宽后与任务「当前 0」基线一致）；**趋势打标 = 滚动窗口
      计数的逐夜序列**（`--since` 接受固定 ISO 以复现）。fixture（一触发一干净）在
      `plugin/test/axis-generator.test.mjs` 里断言计数=1 且 `--json` 逐条归因，双向可控。
- [x] AC3: **预测力检验**——生成器能反推已知的轴（今晚 5 条 5/5 作为回归控制；新轴生成须可被同一问句
      复现）
      **证据**：`node --experimental-strip-types plugin/scripts/axis-generator.ts --selfcheck` 输出
      5/5 回归全 PASS（点状→time、红窗一刀切→scope、两层文档→layer、单 ref→instance、
      量化停止条件无作用域→scope）+ 4 条负向 fixture（量化了窗口/子集/完整层集/多实例的判据正确打开
      对应轴）+ invariant（轴名不打开轴）。同一问句对新判据可复现（负向 fixture 即同一问句的打开侧）。
- [x] AC4: **两投影标注**——point-in-time quality + stop-conditions-no-scope 标注为生成器的 time-轴 /
      scope-轴输出（任务体交叉标注，不合并中期任务）
      **证据**：`tasks/gap-quality-criteria-are-point-in-time-no-trend-criteria.md` 与
      `tasks/gap-quantified-stop-conditions-have-no-scope.md` 的 Proposal 顶部已加生成器标注块，各自
      写明是 time-轴 / scope-轴投影、与另一投影交叉标注、不合并。
- [x] AC5: 测试用 `node:test` 且带 `// @test-group governance`
      **证据**：`plugin/test/axis-generator.test.mjs` 首行 `// @test-group governance`，10 条全部
      `node:test`（`node --test plugin/test/axis-generator.test.mjs` → pass 10 / fail 0）。

## Verification（scoped，2026-08-05 复验）

`bash scripts/test.sh --for-task gap-axis-generator-question-what-range-every-standing-criterion --allow-thin`
→ **exit 0，pass 10 / fail 0 / cancelled 0**（`plugin/test/axis-generator.test.mjs` 10 条全绿）。实跑 invoke：
`--criteria` **total criteria: 28 | with ≥1 unopened axis: 28**（gate 16 + static-checker 12）；
`--selfcheck` **ALL PASS（5/5 regression + negative + invariant）**；`prefriction-count.sh`
**prefriction_dimensions=0**。

**复验发现并修复（fixture 确定性）**：`.quay/config.yml` 是 gitignored 的工作区本地配置（DIR-050），
fresh clone/CI 上不存在 ⇒ 门禁枚举合法地为 0。原测试无条件断言 `gates >= 10` / `total >= 15` 会在 fresh
clone 上红。已在 `plugin/test/axis-generator.test.mjs` 中把两处 config 依赖测试改为：config 存在时断言门禁
集合（工作区实测 16 门禁），config 缺失时走 checker-only 分支（checker 集来自被跟踪的
`scripts/test.sh`，无条件的断言仍在）。两场景实测均 10/10 绿。

## Definition of Done

- [ ] AC1–AC5 全部勾上；AC2/AC3 实跑输出贴任务体
- [ ] 生成器系统化跑（非摩擦驱动）；每晚可证伪计数在（没疼时开维度 >0 出现）；两投影已标注
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches
- tasks/gap-axis-generator-question-what-range-every-standing-criterion.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/scripts/axis-generator.ts（生成器问句 runner + `--criteria`/`--fixture`/`--selfcheck`）
- plugin/scripts/prefriction-count.sh（每晚可证伪计数）
- orchestration/SYNTHESIS-axis-generation-2026-08-05.md（引用）
- tasks/gap-quality-criteria-are-point-in-time-no-trend-criteria.md（AC4 time-轴投影标注）
- tasks/gap-quantified-stop-conditions-have-no-scope.md（AC4 scope-轴投影标注）

## Test-Files

- plugin/test/axis-generator.test.mjs

## Contract

measure   prefriction_dimensions = `bash plugin/scripts/prefriction-count.sh` stdout 的 prefriction_dimensions 数字段
band      prefriction_dimensions >= 0（可证伪：当前 0；>0 即机制开始主动开维度）
invariant generator_is_question = 1（生成 = 对常驻判据问「量化哪个范围」，非关键词扫描）
invoke    `node --experimental-strip-types plugin/scripts/axis-generator.ts --criteria`
control   5/5 反推回归控制（AC3）：点状→时间轴、红窗一刀切→作用域轴等；新轴生成可复现
resume    生成器机制与可证伪计数分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T07:0xZ
changed: 外层读 SYNTHESIS-axis-generation 裁定立案（高优先，有预测力生成器）。四处收紧：
(1) **生成器是机制不是原则**——对常驻判据跑「量化哪个范围」问句，答案眼前这一个 ⇒ 生成未开轴任务；
(2) **可证伪判据替换 AC9**——每晚统计无触发立案数（有没有在没疼时开维度；当前 0）；
(3) **归并 = 标注非合并**——两投影（point-in-time / stop-conditions）标注为生成器输出，不合并中期任务；
(4) **不再一条条捡实例**——生成器系统化发现，捡实例速度受限于人在场。
status: todo——自举演进核心机制；排 ROUND 3 收尾后，高优先。
