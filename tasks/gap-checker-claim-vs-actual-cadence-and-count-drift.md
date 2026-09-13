---
id: gap-checker-claim-vs-actual-cadence-and-count-drift
title: 两处 checker 自述与实际脱节：cadence 声明未被调度消费 + 头注释数量与实测不符
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: finding
---
**type:** finding

## Finding

两处独立但同族的证据，均为一手核实（读码 + 现场跑注册表统计），非转述：

1. **cadence 声明无调度落点**：`plugin/scripts/capability-catalog.sh:706` 声明
   `task-status-drift-check.ts` 的 cadence 为「每轮」，但 `plugin/scripts/routine-scheduler.ts`
   全文没有任何一处读取 catalog 的 cadence 字段去驱动调度——这个声明没有任何机械消费者，是纯文档，
   与实际调度行为脱节。进一步核实：`task-status-drift-check.ts` 本身**没有被**
   `runner-static-gate.ts` 的 `run_static_checks()`/`run_operational_checks()` 任何一个注册表
   `run_checker` 调用注册，也不在 `ready-pool-check.ts`/`slot-refill.ts`/`worker-driver.ts` 的任何
   阻塞派发路径里被整体调用（这几个文件里只有个别导出的纯函数被 `ready-pool-check.ts` 局部借用于别的
   判断，不构成「该检测器被机械调度」）。即：它既没有被声明的 cadence 调度，也没有被任何写入路径
   调用——是一个完全悬空的检测器，声明的 cadence 是它唯一存在过的「调度承诺」，而这个承诺从未兑现。

2. **头注释数量与实测不符**：`plugin/scripts/runner-static-gate.ts` 文件头注释自称
   "35 checkers" 与 "11 runtime-state checkers"。现场实测：`run_static_checks()` 函数体
   （59-783 行区间）含 **54** 个 `run_checker` 调用标签（对应 **51** 个不同的底层脚本文件，
   个别脚本被多次以不同标签调用）；`run_operational_checks()` 函数体（795-991 行区间）含
   **13** 个 `run_checker` 调用标签。两个数字（35 / 11）都与实测值（54或51 / 13）不符，且差距不小
   （前者相差 16-19，后者相差 2）。这正是 CLAUDE.md 硬规则 2「按位置判定，不按关键词」与文档漂移
   模式的一个新实例——文件自己头部写死的数字从未随后续新增的 checker 同步更新，且没有任何机械检查
   会发现这种漂移（`capability-manifest-check.ts` 一类的一致性检查器覆盖的是别的载体，不覆盖
   `runner-static-gate.ts` 自己的头注释）。

### 实测更正（2026-09-13，worker 在本任务 worktree 重测）

上面 finding 里的 54/51/13 是立案时点的读数；本任务落地时在同一棵树上按「命令位置的 run_checker
调用」重测（命令与输出见 ## Evidence）：`run_static_checks` = **58**（去重后仍是 58，本文件没有
同脚本多标签的情形）、`run_operational_checks` = **11**、`scripts/test.sh` 的 `run_doc_checks` =
**8**（头注释散文写「the 7 DOC-class」——第三处同形漂移，本次一并修）。⇒ 声明与实际不符的是
**两个方向都有**：静态面 35→58（少报 23），文档面 7→8（少报 1）；运行态面 11 恰好是对的，但它同样
是一个「没人比对过」的数字，故一并用同一机制管起来。

## Acceptance Criteria

- [x] AC1（cadence 归宿二选一，能取假）：把 `capability-catalog.sh` 的 cadence 声明修正为与实际
  相符的值 —— 「每轮」→「按需」，并在新增的 CONSUMER 行里逐条列出真实按的人与条件（web `/board`
  经 `packages/quay/src/observation.ts` 的 `readBoardLanding` spawn 本脚本、`restart-readiness-check.sh`
  的 `--stranded` 段、cold-start skill、`goals-and-ac.md` 的判据配方）。选项一（接进
  `routine-scheduler`）未被采用，理由落地在 CONSUMER 行内：routine-scheduler 的文法
  （`every(N)`/`interval:<N>m`/`on(<event>)`）表达不出「每轮」，`every(N)` 依赖的迭代计数器随
  ADR-022 退役，且该脚本读全库 git-log 面（本仓实测 >150s），2026-09-02 passive-machine ruling
  正是把读运行态的检查器搬出默认套件。落地后现场验证：每轮调用点实测 0 处（命令见 ## Evidence），
  `rhythm-consumer-check.ts --check` OK（判据2 judged 96→97，0 violation），
  `capability-catalog.sh --entry-surface` exit 0。改动前后 catalog 声明原文对比见 ## Evidence。
- [x] AC2（头注释数量修正，能取假）：`runner-static-gate.ts` 的计数不再写在散文里，改为每个注册表
  函数上挂一条 `# @checker-count <N>` 注解（`run_static_checks` 59、`run_operational_checks` 11），
  `scripts/test.sh` 的 `run_doc_checks` 同挂 8；散文改为指向注解。修正后跑统计命令核对：三处
  声明数 == 实测 `run_checker` 条数（59/59、11/11、8/8）。统计命令与输出、以及修正后的头注释原文
  见 ## Evidence。
- [x] AC3（防再漂移，能取假）：新增机械检查 `plugin/scripts/checker-count-drift-check.ts`（挂在既有
  静态检查框架内：登记进 `run_static_checks`，带 `@static-tier change` + `@static-object`，六张
  catalog 表各一行，配 mutation case 与单测）。它断言每个注册表函数的 `# @checker-count` 声明数
  等于该函数体命令位置的 `run_checker` 条数：不等 ⇒ exit 1；载体/函数/注解读不到 ⇒ exit 3
  NOT-EVALUATED（⛔ 不与 PASS 同形，硬规则 3b）。负控制已跑：故意把声明数改成 57（另一方向改成 1、
  以及文档面改成 7）⇒ 真报红 exit 1；移走载体 ⇒ exit 3。mutation case（5 个注入方向）exit 0；
  全量 manifest `checker-mutation-check.sh --check` PASS（77/77，stayed_green=0）。
- [x] AC4（既有测试不回归）：覆盖 `runner-static-gate.ts` 的既有测试全绿 ——
  `select-static-checks-for-touches.test.mjs` + `scoped-static-checks.test.mjs` +
  `capability-catalog.test.mjs` + `rhythm-consumer-check.test.mjs` 共 68 tests / 68 pass / 0 fail
  （exit 0）；新增检查器的测试 `plugin/test/checker-count-drift-check.test.mjs` 7 tests / 7 pass
  / 0 fail。⚠️ AC 点名的 `plugin/test/runner-static-gate*.test.mjs` **不存在**（`ls` 无匹配），
  故按 AC 的「或覆盖 runner-static-gate 的既有测试文件」执行上述四份——它们都直接解析/断言
  `runner-static-gate.ts`（注解选择器、scoped 分层、两个注册表的 mutation manifest）。

## Definition of Done

`task-status-drift-check.ts` 的 cadence 声明已改实（「按需」+ CONSUMER 行逐条列出真实按的人与条件）
且可现场验证（`rhythm-consumer-check --check` 绿、catalog 入口闸绿）；`runner-static-gate.ts` 与
`scripts/test.sh` 的注册表计数以 `# @checker-count` 注解单点声明，实测值一致（59/11/8）；
新增一致性检查器落地并通过负控制验证（故意制造漂移真报红，改错方向两个都验）；相关既有测试全绿。
不是「看代码逻辑上应该修好」，命令与输出为证（见 ## Evidence）。

## Evidence

（2026-09-13，worker 在 worktree `/home/yale/work/quay-worktrees/gap-checker-claim-vs-actual-cadence-and-count-drift` 实测）

**AC1 —— 选「声明改实」，catalog diff 原文**（`git diff plugin/scripts/capability-catalog.sh`）：

```
-  [task-status-drift-check.ts]="每轮"
+  [task-status-drift-check.ts]="按需"
+  [task-status-drift-check.ts]="谁按：①packages/quay/src/observation.ts 的 readBoardLanding（web /board
+   每次页面请求 spawn 本脚本 --json，30s 短 TTL 缓存 + 秒级硬顶）——机器按，最常走的路径；②…restart-
+   readiness-check.sh 的 --stranded 段…；③plugin/skills/cold-start/SKILL.md…；④orchestration/goals-and-ac.md…
+   ⛔ 原声明「每轮」为假：没有每轮的调用点…（全文见 catalog CONSUMER 行）"
```

「每轮调用点实测 0 处」（position 计数，非关键词）：

```
$ grep -c 'task-status-drift-check' orchestration/manager-tick-core.md orchestration/fast-mode-tick-core.md \
    plugin/loop/manager-tick-core.md plugin/loop/fast-mode-tick-core.md plugin/scripts/worker-driver.ts
orchestration/manager-tick-core.md:0
orchestration/fast-mode-tick-core.md:0
plugin/loop/manager-tick-core.md:0
plugin/loop/fast-mode-tick-core.md:0
plugin/scripts/worker-driver.ts:0
```

闸：

```
$ node --experimental-strip-types plugin/scripts/rhythm-consumer-check.ts --check
rhythm-consumer-check: OK — rhythm-consumer-check-pass
  [判据2-按需-consumer] ok — 97 judged, 0 violation(s)      ← 立案前为 96 judged（本行新增 1）
$ bash plugin/scripts/capability-catalog.sh --entry-surface ; echo $?
0
```

**AC2 —— 声明 == 实测**（同一命令三条，逐函数统计命令位置 `run_checker` 条数并与注解比对）：

```
$ for pair in plugin/scripts/runner-static-gate.ts:run_static_checks \
              plugin/scripts/runner-static-gate.ts:run_operational_checks \
              scripts/test.sh:run_doc_checks; do f=${pair%%:*}; fn=${pair##*:}; \
    ann=$(grep -B200 "^${fn}() {" "$f" | grep -E '^#[[:space:]]*@checker-count' | tail -1); \
    s=$(grep -n "^${fn}() {" "$f" | head -1 | cut -d: -f1); e=$(awk -v s=$s 'NR>s && /^}$/{print NR; exit}' "$f"); \
    n=$(awk -v s=$s -v e=$e 'NR>s && NR<e' "$f" | grep -cE '^[ \t]*run_checker[ \t]+"'); \
    echo "$f:$fn  $ann  measured=$n"; done

plugin/scripts/runner-static-gate.ts:run_static_checks    # @checker-count 59 ...  measured=59
plugin/scripts/runner-static-gate.ts:run_operational_checks  # @checker-count 11 ...  measured=11
scripts/test.sh:run_doc_checks                            # @checker-count 8 ...   measured=8
```

修正后的头注释原文（节选）：`# @checker-count 59 — the number of run_checker entries in the FUNCTION
BELOW (counted by plugin/scripts/checker-count-drift-check.ts). Adding/removing a checker means updating
this line, and the check is what tells you; do not restate the number in prose.`；散文处改为
「(count declared by this function's own `# @checker-count` annotation … machine-checked by
plugin/scripts/checker-count-drift-check.ts)」，并删除了原 "35 checkers" / "the 7 DOC-class" / 
"the 11 OPERATIONAL-class" 三处散文复述。

**AC3 —— 负控制（故意改错声明数 ⇒ 真报红；不是恒绿）**（temp root 上的副本，真树不动）：

```
$ sed -i 's/@checker-count 59 /@checker-count 57 /' $TMP/plugin/scripts/runner-static-gate.ts
$ node --experimental-strip-types plugin/scripts/checker-count-drift-check.ts --root $TMP
  [MISMATCH] plugin/scripts/runner-static-gate.ts:run_static_checks — declared 57, measured 59
FAIL — 1 declared count(s) disagree with the function body: … set the annotation … to 59
EXIT=1
$ sed -i 's/@checker-count 8 /@checker-count 7 /' $TMP/scripts/test.sh     # 第三个载体、另一方向
  [MISMATCH] scripts/test.sh:run_doc_checks — declared 7, measured 8       EXIT=1
$ rm $TMP/scripts/test.sh                                                  # 载体读不到
NOT-EVALUATED — 1 registry dimension(s) could not be read …               EXIT=3
```

框架内验证：`bash plugin/scripts/checker-mutation-cases/checker-count-drift-check.sh <tmp>` → exit 0；
`bash plugin/scripts/checker-mutation-check.sh --check` → `checkers_total: 77 / checkers_with_mutation:
77 / mutations_that_stayed_green: 0 / uncovered: 0 / RESULT: PASS`；
`node --experimental-strip-types plugin/scripts/checker-mechanical-spine-check.ts --root .` → 125
checker(s), 0 violation(s)。

**AC4 —— 既有测试不回归**：

```
$ node --experimental-strip-types --test plugin/test/select-static-checks-for-touches.test.mjs \
    plugin/test/scoped-static-checks.test.mjs plugin/test/capability-catalog.test.mjs \
    plugin/test/rhythm-consumer-check.test.mjs
ℹ tests 68   ℹ pass 68   ℹ fail 0        EXIT=0
$ node --experimental-strip-types --test plugin/test/checker-count-drift-check.test.mjs
ℹ tests 7    ℹ pass 7    ℹ fail 0        EXIT=0
$ ls plugin/test/runner-static-gate* 
ls: cannot access 'plugin/test/runner-static-gate*': No such file or directory
```

## Touches

- plugin/scripts/capability-catalog.sh
- plugin/scripts/routine-scheduler.ts
- plugin/scripts/task-status-drift-check.ts
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/checker-count-drift-check.ts
- plugin/scripts/checker-mutation-cases/checker-count-drift-check.sh
- plugin/test/runner-static-gate.test.mjs
- plugin/test/checker-count-drift-check.test.mjs
- scripts/test.sh
- tasks/gap-checker-claim-vs-actual-cadence-and-count-drift.md
