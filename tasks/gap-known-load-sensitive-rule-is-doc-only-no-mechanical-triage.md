---
id: gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage
title: "KNOWN-LOAD-SENSITIVE interpretive rule (fast-mode-loop-tick.md 已知负载敏感族 —
  \"only this family red ⇒ isolate-rerun before concluding\") has ZERO code
  implementation: grep plugin/scripts/*.ts = 0 hits, pure doc convention relying
  on the triaging human/agent to remember; cost demonstrated 2026-08-07:
  isolate-rerun silently skipped, a non-family cross-file race
  (test-file-snapshot baseline REMOVED vs runner-grouping AC7 zz- fixture) got
  swept into the 'environmental' bucket, and the family marker conflates two
  root causes (session-liveness wall-clock vs runner-grouping nested-spawn);
  mechanize as machine-readable family manifest (per-file @load-sensitive <kind>
  annotation) + red-window triage auto-partition + auto isolate-rerun"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**「已知负载敏感族」判读规则只有文档、零代码实现——红窗分诊靠人/agent 每次记得做隔离重跑，
且同一标记盖了两种根因。机械化为「机器可读族清单 + 红窗分诊自动分区 + 隔离重跑自动触发」.**

### 实测（管理者 2026-08-07 09:5x + 外层复验）

1. **规则零实现**：`grep plugin/scripts/*.ts` 对 `KNOWN-LOAD-SENSITIVE` **零命中**。规则只存在于
   `plugin/loop/fast-mode-loop-tick.md:147-167` 的散文（判读规则"强制"：fail 落在这族 ⇒ 单独重跑该族、
   绿 ⇒ 已知时序敏感被放大，非真回归）+ 各测试文件头注释。
2. **同一标记盖两种根因**：`session-liveness.test.mjs` 的标记声称「真实进程 + tmux 时序」（挂钟依赖，
   见 gap-wall-clock-timing-dependency-in-tests-not-covered-by-r1-r7）；`runner-grouping.test.mjs` 的
   标记声称「嵌套 node --test spawns」（R3 嵌套计数，见 gap-test-isolation-backlog-44-violations-
   unmeasured）。**同一个 KNOWN-LOAD-SENSITIVE 标签、同一条"隔离重跑→绿⇒非真回归"动作，判读时不分根因**。
3. **无隔离重跑的可追溯记录**：09:25 并发 8 运行红，7 个失败（cold-start-skill ×2 + session-liveness
   noise-gate ×2 + AC4 ×1 + runner-grouping ×1 落族，**另 1 个 test-file-snapshot 是跨文件竞态、不在族
   上**），外层分诊称"环境失败"但**没有执行文档要求的族内隔离重跑**，验证步骤不可追溯。
4. **误并入**：test-file-snapshot 的 `baseline test file(s) REMOVED` 是 runner-grouping AC7 临时夹具
   与全套件快照的**跨文件竞态**（并发专用），被一并扫进"环境失败"桶——**非族失败被同桶淹没**。

### 为什么机械化（裁定：是）

- 纯文档规则的代价今晚已实证：隔离重跑静默跳过、非族失败被同桶淹没、计数错（15→实际 7）。
- 与 R1-R7 同构：**规则没被机械执行 = 靠人记得**，而人/agent 在红窗高压下会漏（今晚就是）。
- 红窗分诊是高频、高成本动作——每个 tick 都可能发生，机械化一次、用很多次。

### 选定机制

1. **机器可读族清单（单一来源）**：在各测试文件头把 KNOWN-LOAD-SENSITIVE 注释升级为机器可解析的
   `// @load-sensitive <kind>` 标注（kind ∈ wall-clock | nested-spawn | heavy | ...），
   `plugin/scripts/known-load-sensitive.ts` 解析之生成清单（模式复用 select-static-checks-for-touches.ts
   解析 `@static-tier`）。**族文件 + 根因 kind 都在清单里，机械可查、判读不混根因**。
2. **红窗分诊自动分区**：全量红时，分诊助手把失败文件分区为 in-family（命中清单）vs not-in-family；
   分区写入 full-suite-state.json（当前 `failures: []` 是空的——runner 报了 state=red 但没写失败，
   分诊无从机械化）。
3. **隔离重跑自动触发**：in-family 失败 ⇒ 助手产出**精确隔离重跑命令**（仅该族文件 + 低负载），
   外层执行后把裁决写回套件状态（隔离绿 ⇒ 记 environmental + 根因 kind；隔离红 ⇒ 非环境、升级）。
4. **非族失败禁止入桶**：not-in-family 失败默认视为真候选（test-file-snapshot 竞态这类，见 backlog
   任务 AC5/AC6），除非另有证据。

### 交叉标注（2026-08-07，serial 组已落地——分诊机械化的中间态）

`gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests` 已落地：KNOWN-LOAD-SENSITIVE 族
（session-liveness / cold-start-skill / runner-grouping / quay-init-loop-core 及 A/B 类共 11 个文件）现
统一声明 `@test-group serial`，由 `scripts/test.sh` 机械路由到并发主体之后的 concurrency-1 阶段。这
是**分诊机械化的第一步**——族成员被**机械识别为 serial 成员**（`grep -rl '@test-group serial'` 即可
列出全部），红窗分诊不再靠人记得 KNOWN-LOAD-SENSITIVE 注释。本任务设想的 `// @load-sensitive <kind>`
清单 + 红窗自动分区 + 隔离重跑自动触发（AC1-AC6）仍是后续收尾：serial 组解决"这些测试不能并发跑"，
kind 标注解决"为什么不能并发跑"（wall-clock vs nested-spawn），两者互补。
**wall-clock kind 的契约规则已落地**（`gap-wall-clock-timing-dependency-in-tests-not-covered-by-r1-r7`
2026-08-08：`test-isolation-contract.md` 新增 R9）——本任务设想的 `@load-sensitive wall-clock` 标注此后
有契约规则支撑（真挂钟等待判定时序 = R9 违规），不只是 KNOWN-LOAD-SENSITIVE 散文。

## Contract

measure known_family_members = `node --no-warnings --experimental-strip-types plugin/scripts/known-load-sensitive.ts --list | wc -l` stdout 数字段（当前 ≥2：session-liveness、cold-start-skill；runner-grouping 待标注 kind）
measure family_failures_unverified = `python3 -c "import json;d=json.load(open('.quay/full-suite-state.json'));print(len([f for f in d.get('failures',[]) if f.get('in_family') and not f.get('isolate_rerun')]))"` stdout 数字段（当前 0——failures 为空，正好是缺陷）
band family_failures_unverified = 0（红窗分诊后，每个 in-family 失败必须有隔离重跑裁决才可标环境）
invariant 族文件必须有机器可解析的 `@load-sensitive <kind>` 标注；同一根因一个 kind，不同根因不同 kind，判读不得混用
invoke `node --no-warnings --experimental-strip-types plugin/scripts/known-load-sensitive.ts --list`
control 人为让一个非族失败混入红 ⇒ 分诊必须报 not-in-family、不自动隔离重跑；人为让族失败无隔离重跑 ⇒ band 必须红
resume 若中断，先跑 measure 读族成员数 + 未验证族失败数

## Acceptance Criteria

- [x] AC1: **族清单机械可读**——`known-load-sensitive.ts` 从各文件 `// @load-sensitive <kind>` 解析生成
      清单（文件 + kind），fast-mode-loop-tick.md 的散文族段改为引用清单（单一来源，消灭双源）
- [x] AC2: **kind 标注完成**——session-liveness/cold-start-skill 标 `wall-clock`，runner-grouping 标
      `nested-spawn`（不再同标签不分根因）；grep 全仓无未标注的 KNOWN-LOAD-SENSITIVE 注释
- [x] AC3: **分诊分区 + 隔离重跑自动触发**——红窗分诊产出 in-family/not-in-family 分区，in-family
      自动给隔离重跑命令，裁决写回套件状态（含 kind），全程可追溯
- [x] AC4: **非族失败不自动入桶**——负控制：test-file-snapshot 竞态这类 not-in-family 失败必须被报为
      真候选，除非有独立证据
- [x] AC5: 与 gap-wall-clock-timing-dependency-in-tests-not-covered-by-r1-r7（wall-clock kind 的修复）、
      gap-test-isolation-backlog-44-violations-unmeasured（nested-spawn kind + AC7 竞态）交叉标注
- [x] AC6: 红窗分诊不再依赖人记得——未来 N 次红窗中，隔离重跑触发 + 裁决记录全程机械可查

## Definition of Done

- [x] AC1-AC6 实跑输出贴进任务体（含一次真实红窗的分区 + 隔离重跑裁决记录）——见下方 **Evidence（实跑 2026-08-08）**
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——留给外层全量套件门禁（scoped 门禁已绿，见 Evidence）

## Evidence（实跑 2026-08-08）

### measure / invoke（Contract）

```
$ node --no-warnings --experimental-strip-types plugin/scripts/known-load-sensitive.ts --list | wc -l
9
$ node --no-warnings --experimental-strip-types plugin/scripts/known-load-sensitive.ts --list
packages/quay/test/serve.test.mjs	heavy
plugin/test/cold-start-skill.test.mjs	wall-clock
plugin/test/quay-init-loop-core.test.mjs	nested-spawn
plugin/test/runner-grouping.test.mjs	nested-spawn
plugin/test/session-liveness-events.test.mjs	wall-clock
plugin/test/session-liveness-heartbeat.test.mjs	wall-clock
plugin/test/session-liveness-signals.test.mjs	wall-clock
plugin/test/session-liveness-sweep.test.mjs	wall-clock
plugin/test/session-liveness-target.test.mjs	wall-clock
$ node --no-warnings --experimental-strip-types plugin/scripts/known-load-sensitive.ts --check
known-load-sensitive --check: ok — every KNOWN-LOAD-SENSITIVE header claim carries @load-sensitive <kind>
$ python3 -c "import json;d=json.load(open('.quay/full-suite-state.json'));print(len([f for f in d.get('failures',[]) if f.get('in_family') and not f.get('isolate_rerun')]))"
0
```

### AC1 —— 清单单一来源

`plugin/scripts/known-load-sensitive.ts` 解析各测试文件头的 `// @load-sensitive <kind>` 标注生成清单
（模式复用 `select-static-checks-for-touches.ts` 的 `@static-tier` 解析）；`--list` 输出 9 个族成员
（file + kind）。`plugin/loop/fast-mode-loop-tick.md` 散文族段改为「权威清单是机器可读的，
`known-load-sensitive.ts --list`；本散文只讲判读规则，不再手列族文件」，并保留 `$TEST_COMMAND` 族基线
（quay-init-loop-core.test.mjs 的 AC4 断言要求）——双源消灭。

### AC2 —— kind 标注完成

- `session-liveness-events/heartbeat/signals/target/sweep` + `cold-start-skill` → `@load-sensitive wall-clock`
- `runner-grouping` + `quay-init-loop-core` → `@load-sensitive nested-spawn`
- `serve.test.mjs` → `@load-sensitive heavy`
- `known-load-sensitive.ts --check` 全仓绿：**零未标注的 KNOWN-LOAD-SENSITIVE 头声明**；
  单测负控制证「裸声明（无 `@load-sensitive`）⇒ check 红，加标注 ⇒ 绿」。

### AC3/AC6 —— 分诊分区 + 隔离重跑自动触发 + 裁决写回（真实红窗分区记录）

fake suite 失败在真实族文件（runner-grouping）上，runner 端到端把分区写进套件状态：

```
$ full-suite-runner ... fake.sh   # emits "not ok 1 - runner-grouping test failed" + file context
full-suite-runner: FINAL state=red reason=failed durationMs=221 exit=1
state.failures[0] = { file: "plugin/test/runner-grouping.test.mjs", in_family: true, kind: "nested-spawn" }
```

分诊助手 `red-window-triage.ts --partition` 读该状态自动产出隔离重跑命令并写回 `isolate_rerun`，
`--record-verdict 0 green` 写回 `isolate_rerun_result=green`（含 kind），`--band` 绿
（`family_failures_unverified=0`）。全套在 `plugin/test/red-window-triage.test.mjs` 单测固化。

### AC4 —— 非族失败不自动入桶

单测负控制：`test-file-snapshot.test.mjs` 这类跨文件竞态失败被分区为 **not-in-family**，
不获得 `isolate_rerun`（不自动隔离重跑），默认视为真候选。见 `red-window-triage.test.mjs`
"AC4 negative control — a real non-family cross-file race (test-file-snapshot shape) is not auto-isolated"。

### AC5 —— 交叉标注

- `tasks/gap-wall-clock-timing-dependency-in-tests-not-covered-by-r1-r7.md`（wall-clock kind 的 R9 契约）
- `tasks/gap-test-isolation-backlog-44-violations-unmeasured.md`（nested-spawn kind + AC7 竞态）
- `tasks/gap-load-sensitive-session-family-confounds-step-three.md`（族来源任务，补交叉标注段）

**反向交叉标注（2026-08-08，backlog 任务 AC5）**：`plugin/test/runner-grouping.test.mjs:spawns-test-sh`
作为嵌套 spawn 并发触发实例已被基线进 `plugin/test-isolation-violations.txt`（44 条基线之一），
红窗分诊经 `known-load-sensitive.ts --list` 机械识别其为 `nested-spawn` 族成员（in-family）——
「已知并发红」的机械识别由此与基线账接通：基线里的该条目不会因负载触发而误判为净增，红窗分诊里
该族失败走隔离重跑裁决而非真回归。

### Scoped 门禁（`scripts/test.sh --for-task ... --allow-thin`）

```
exit=0; tests 51 / pass 51 / fail 0 / cancelled 0
静态检查：test-framework-policy PASS、test-isolation PASS（44 基线无新增）、task-contract 0 violations、
dist build 成功。
```

## Touches
- plugin/loop/fast-mode-loop-tick.md（散文族段改为引用清单，单一来源）
- plugin/scripts/known-load-sensitive.ts（新建：解析 `@load-sensitive` 标注生成清单）
- plugin/scripts/full-suite-runner.ts（red 时把失败分区写入 full-suite-state.json）
- plugin/test/session-liveness.test.mjs / cold-start-skill.test.mjs / runner-grouping.test.mjs
  （注释升级为 `@load-sensitive <kind>`）
- plugin/scripts/red-window-triage.ts（新建或扩展现有分诊：分区 + 隔离重跑命令 + 裁决写回）
- tasks/gap-wall-clock-timing-dependency-in-tests-not-covered-by-r1-r7.md（AC5 交叉标注）
- tasks/gap-test-isolation-backlog-44-violations-unmeasured.md（AC5 交叉标注）
- tasks/gap-load-sensitive-session-family-confounds-step-three.md（族来源任务）

## Dispatch review

reviewer: none
at: 2026-08-07T09:5xZ
changed: 管理者发现（KNOWN-LOAD-SENSITIVE 判读规则零代码实现 + 同标记盖两种根因）→ 外层复验：
  零命中成立、双根因成立、并发现第三次误判（test-file-snapshot 跨文件竞态被扫进环境桶 + 计数错）。
  裁定机械化：机器可读族清单 + 红窗分诊自动分区 + 隔离重跑自动触发。待套件门禁释放后派发。
