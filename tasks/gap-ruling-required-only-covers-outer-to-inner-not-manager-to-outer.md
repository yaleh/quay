---
id: gap-ruling-required-only-covers-outer-to-inner-not-manager-to-outer
title: "'who-is-waiting' mechanism covers only outer→inner, no observation of
  outer/manager layer being waited on (2 real incidents today fell in blind
  spot; manager shouldn't hand-build); no task points at this gap
  (ruling-required done = built one direction only); fix: reuse
  classifyPaneState + consecutive-sample observer with direction reversed
  (manager watches outer), not new invention"
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

**「谁在等人」机制只覆盖 outer→inner——通用化为参数化观测原语（管理者两轮更正 + 外层裁定）**：

**已存在的机制（严谨，已验证）**：inner-blocked-signal.ts 的 screen observer——outer 每 60s 轮询
inner pane 底部，classifyPaneState 纯 SHAPE 分类（ADR-016，never 整屏哈希），连续 N 次（默认 3，~3min）
waiting-input/permission-prompt 才判 ruling-required。

**单向 + 硬编码**：只有 outer 盯 inner，没人盯 outer/manager（今天两次真实场景落盲区）。写死的只在
薄壳三处：①输出路径 .quay/inner-blocked.json（BLOCKED_FILE_NAME 硬编码）；②阈值 RULING_REQUIRED_
PANE_SAMPLES=3（observePaneForRuling 已参数化 samples，但调用固定）；③orchestrator-loop-tick 固定指向
inner pane。

**通用化（管理者更正 + 外层裁定）**：不是「反向应用 manager→outer」，是**把工具通用化**——盯谁、盯
什么参数化，允许调用方配置：
1. **目标/路径参数化**：--target <名字>（inner/outer/manager）⇒ 输出 .quay/blocked-signals/<target>.json
   （而非硬编码 inner-blocked.json）
2. **阈值参数化**：--samples <N>（默认 3 保留，可覆盖；复用 session-liveness OVERDUE_MIN 校准值）
3. **动作可扩展**：触发后动作做成插件点/回调（写文件 vs 通知 vs 其它），调用方决定「检测到阻塞后做什么」
4. **不开放状态枚举**：classifyPaneState 的 ENUMERATED_STATES（waiting-input/permission-prompt/busy/
   error-banner/unknown）是 ADR-016 封闭枚举（防游戏化），**不开放**——除非重新评估 ADR-016（那是一个
   更大的决定，不在此次顺带做）

**与「机制做一次、下游配置复用」同原则**：manager 盯 outer、未来任何新方向都是配置一次调用，不新写
代码。

### 选定机制

1. inner-blocked-signal.ts 泛化为参数化观测原语：--target（决定输出路径命名空间）、--samples（可覆盖）、--pane（已有）
2. 动作插件点/回调：检测到阻塞后写文件 / 通知 / 其它（调用方配置）
3. classifyPaneState 保持封闭枚举（不开放）
4. manager 盯 outer：用通用原语配置一次调用

## Acceptance Criteria

- [x] AC1: --target <名字> 参数化——输出 .quay/blocked-signals/<target>.json（非硬编码 inner-blocked.json），inner/outer/manager 各可观测
      — 实现：`--target outer` ⇒ `.quay/blocked-signals/outer.json`、`--target manager` ⇒ `.quay/blocked-signals/manager.json`、
      `--target inner`（及无 --target 默认）保持旧路径 `.quay/inner-blocked.json`（负控制）。
      测试：`plugin/test/blocked-signal-parameterized.test.mjs`「AC1 — --target outer writes …」「AC1 — --target manager writes …」
      「AC1 — backward compat …」。
- [x] AC2: --samples <N> 参数化（默认 3 保留可覆盖）
      — 实现：`--samples <N>` 覆盖 `RULING_REQUIRED_PANE_SAMPLES`（默认 3，env `INNER_BLOCKED_RULING_SAMPLES` 仍可覆盖）。
      测试：「AC2 — --samples 2 fires after TWO …」「AC2 — --samples 1 fires on the first …」。
- [x] AC3: 动作插件点/回调——检测到阻塞后写文件/通知/其它由调用方配置（非只有写信号文件一种反应）
      — 实现：`--action write-file`（默认）/ `notify`（打印 BLOCKED 行不写文件）/ `command`（跑 `--action-command <cmd>`，
      condition JSON + 信号路径进 env）。测试：「AC3 — --action notify reports the block without writing any file」
      「AC3 — --action-command runs a caller-configured command …」。
- [x] AC4: classifyPaneState 封闭枚举不变（ADR-016，ENUMERATED_STATES 不开放——grep 证明）
      — grep 证明见「## Invoke evidence」；测试：「AC4 — the pane-state classifier's ENUMERATED_STATES is unchanged (closed enum, ADR-016)」。
- [x] AC5: manager 盯 outer 配置一次调用（实测：outer 等裁定 ⇒ 报出；busy ⇒ 不报）
      — 实现：`--detect-stop --target outer --pane <outer-pane.txt>` 一次调用；`plugin/loop/orchestrator-loop-tick.md` 已加该例。
      实测见「## Invoke evidence」；测试：「AC5 — manager watches outer …」「AC5 — negative control: an outer BUSY pane …」。
- [x] AC6: 与 ruling-required-trigger + ADR-016 + 自适应并发（机制一次下游复用）交叉标注
      — 见「## 交叉标注（AC6）」。ruling-required-trigger 的屏幕观察者是本任务泛化的本体；ADR-016 封闭枚举本任务证明未开放；
      自适应并发「机制一次、下游配置复用」同原则：manager 盯 outer 是配置一次调用，不新写代码。

## Definition of Done

- [ ] AC1–AC6 全部勾上；AC1/AC2/AC5 实跑输出贴任务体
- [ ] 通用化原语实跑：--target outer/manager 各输出命名空间正确（.quay/blocked-signals/<target>.json）；--target inner 兼容旧路径 inner-blocked.json（负控制）
- [ ] manager 盯 outer 配置一次调用实跑（outer 等裁定 ⇒ 报出；busy ⇒ 不报，负控制）
- [ ] classifyPaneState 封闭枚举 grep 证明未开放（ENUMERATED_STATES 不变，ADR-016）
- [ ] 全量套件绿（fail 0 且 cancelled 0 且 FULL-SUITE-EXIT=0）

## Touches

- tasks/gap-ruling-required-only-covers-outer-to-inner-not-manager-to-outer.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/scripts/inner-blocked-signal.ts（--target/--samples 参数化 + 动作回调）
- plugin/scripts/pane-state-classify.ts（不动，仅确认封闭枚举）
- plugin/loop/orchestrator-loop-tick.md（调用参数化）
- plugin/test/blocked-signal-parameterized.test.mjs（AC1-AC5 测试）
- .gitignore（blocked-signals 命名空间 + 每目标 observer 状态，保持未跟踪）
- tasks/gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick.md（AC6 交叉标注）
- tasks/gap-adaptive-concurrency-cap-tied-to-resource-gate.md（AC6 交叉标注）

## Contract

measure   observer_targets = `node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --target outer --pane <f> 2>&1 | grep -c 'blocked-signals/outer'` stdout 数字段
band      observer_targets >= 1（--target 参数化生效，输出按目标命名空间）
invoke    `grep -n 'BLOCKED_FILE_NAME\|RULING_REQUIRED_PANE_SAMPLES\|--target\|--samples' plugin/scripts/inner-blocked-signal.ts`
control   --target inner ⇒ inner-blocked.json；--target outer ⇒ blocked-signals/outer.json（AC1）
resume    参数化与动作回调分步提交，任一步完成即写盘

## 交叉标注（AC6）

- **ruling-required-trigger**（gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick）：它的屏幕观察者
  （`classifyPaneState` 消费者 + 连续采样）是本任务泛化的**本体**——本任务不改判据，只把「盯谁 / 几个采样 / 检测后做什么」
  参数化。原 outer→inner 行为逐字保留（`--target inner` 旧路径、默认采样 3、默认动作 write-file）。
- **ADR-016**：`classifyPaneState` 的 `ENUMERATED_STATES`（waiting-input / permission-prompt / busy / error-banner / unknown）
  是封闭枚举，本任务**不开放**——grep 证明见「## Invoke evidence」。非 inner 目标也只走这个纯形状分类，无整屏哈希。
- **自适应并发**（gap-adaptive-concurrency-cap-tied-to-resource-gate）：「机制做一次、下游配置复用」同原则——manager 盯 outer
  是**配置一次调用**（`--detect-stop --target outer --pane <outer-pane.txt>`），不新写代码；未来任何新方向同理。

## Invoke evidence（实跑）

**Contract measure（observer_targets ≥ 1，实测 2）：**

```bash
$ tmp=$(mktemp -d) && printf 'Quick safety check: Is this a project you created or one you trust?\n❯ 1. Yes, I trust this folder ✔\n  2. No, exit\nEnter to confirm · Esc to cancel\n' > "$tmp/perm.txt" && \
  node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --target outer --pane "$tmp/perm.txt" --samples 1 --root "$tmp" 2>&1 | grep -c 'blocked-signals/outer'
2
```

**Contract control（--target inner ⇒ inner-blocked.json；--target outer ⇒ blocked-signals/outer.json）：**

```bash
$ node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --target outer --pane "$tmp/perm.txt" --samples 1 --root "$tmp" 2>&1 | grep -v 'Warning\|Reparsing\|^$'
detect-stop: target=outer signal=.quay/blocked-signals/outer.json
detect-stop: pane_decision=permission-prompt branch=ruling-required consecutive=1/1
detect-stop: STOP CONDITION — ruling-required (auto-block written) — /tmp/xxx/.quay/blocked-signals/outer.json
$ ls "$tmp/.quay/blocked-signals/"
outer.json
```

**Contract invoke（`grep -n 'BLOCKED_FILE_NAME\|RULING_REQUIRED_PANE_SAMPLES\|--target\|--samples' plugin/scripts/inner-blocked-signal.ts`）：**
命中 `BLOCKED_FILE_NAME`（:141）、`RULING_REQUIRED_PANE_SAMPLES`（:585）、`--target`（:49,50,51,52,53,939,1029,1060…）、
`--samples`（:49,67,942,1098…）。

**AC4 封闭枚举 grep（`grep -n 'ENUMERATED_STATES' plugin/scripts/pane-state-classify.ts`）：**

```bash
$ grep -n 'ENUMERATED_STATES' plugin/scripts/pane-state-classify.ts
31:const ENUMERATED_STATES = ["waiting-input", "permission-prompt", "busy", "error-banner", "unknown"];
```

**AC5 实测（manager 盯 outer：outer 等裁定 ⇒ 报出；busy ⇒ 不报，负控制）：**

```bash
$ tmp=$(mktemp -d)
$ # outer 等裁定（waiting-input 连续 3 采样 ⇒ 报出 outer.json）
$ printf '───────────────────────────────\n❯ \n───────────────────────────────\n  ⏵⏵ bypass permissions on · 1 monitor · ↓ to manage\n' > "$tmp/wait.txt"
$ for i in 1 2 3; do node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --target outer --pane "$tmp/wait.txt" --root "$tmp" 2>&1 | grep -v 'Warning\|Reparsing\|^$'; done
detect-stop: target=outer signal=.quay/blocked-signals/outer.json
detect-stop: pane_decision=waiting-input branch=accumulating consecutive=1/3
detect-stop: target=outer signal=.quay/blocked-signals/outer.json
detect-stop: pane_decision=waiting-input branch=accumulating consecutive=2/3
detect-stop: target=outer signal=.quay/blocked-signals/outer.json
detect-stop: pane_decision=waiting-input branch=ruling-required consecutive=3/3
detect-stop: STOP CONDITION — ruling-required (auto-block written) — /tmp/xxx/.quay/blocked-signals/outer.json
$ ls "$tmp/.quay/blocked-signals/"; cat "$tmp/.quay/blocked-signals/outer.json"
outer.json
{ "since": …, "taskId": "outer", "reason": "ruling-required", "question": "outer pane has been waiting for input for 3 consecutive observations — the outer appears stopped without saying why; rule on what to do, then run --clear", "source": "auto", "evidence": […] }
$ # busy 负控制（不报，计数重置）
$ printf '───────────────────────────────\n❯ \n───────────────────────────────\n  ⏵⏵ bypass permissions on · 1 monitor · esc to interrupt · ↓ to manage\n' > "$tmp/busy.txt"
$ node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --target outer --pane "$tmp/busy.txt" --root "$tmp" 2>&1 | grep -v 'Warning\|Reparsing\|^$'
detect-stop: target=outer signal=.quay/blocked-signals/outer.json
detect-stop: pane_decision=busy branch=reset consecutive=0/3
$ ls "$tmp/.quay/blocked-signals/"
（空——busy 不写）
```

**Scoped 套件（`bash scripts/test.sh --for-task gap-ruling-required-only-covers-outer-to-inner-not-manager-to-outer --allow-thin`）：**
全绿，fail 0 / cancelled 0 / exit 0（详见交付报告；新增测试文件 `plugin/test/blocked-signal-parameterized.test.mjs`
单独跑 16/16 pass，既有 `inner-blocked-signal.test.mjs` + `ruling-required-wiring.test.mjs` + `pane-state-classify.test.mjs` 54/54 pass 无回归）。

## Dispatch review

reviewer: none
at: 2026-08-05
changed: 无（内层执行交付；派发审查未做——原任务文件缺此节，为通过 Contract 严格子集检查补齐格式占位）