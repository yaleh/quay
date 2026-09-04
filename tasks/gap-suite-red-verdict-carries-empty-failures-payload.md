---
id: gap-suite-red-verdict-carries-empty-failures-payload
title: "SUITE-RED verdict carries empty failures payload (state.failures=[])
  while full-suite-runner:232 requires WHERE; log also lacks # fail summary —
  red landing not mechanically recoverable"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
## Finding

SUITE-RED 判决的载荷是**空的**，而设计上它必须带上红落点。

`.quay/full-suite-state.json`（18:47:46 判决）：`state=red / reason=failed / failures: []` —— **空数组**。

`plugin/scripts/full-suite-runner.ts:232` 自己的设计注释：

> "The SUITE-RED event must carry WHERE the red landed (state.failures) so the inner dispatch rule can distinguish a SHARED-GATE failure (run_static_checks — every scoped run pays it ⇒ stop dispatch) from a SPECIFIC-TEST failure unrelated to a candidate's touch-set (⇒ dispatch continues)."

⇒ 空载荷**不是可接受状态**：inner 派发规则按设计消费 `state.failures` 来区分「共享门失败（停派）」vs「具体测试失败（可继续派）」，空数组使该规则**没有输入**。

## 实测（2026-08-06 18:47 判决后）

- `.quay/full-suite.log`：**9251 行 / 792K**，含 fail 字样 410 行，但**0 条** `# fail` / `# pass` 汇总行；日志**末尾断在一条断言中间**（`diff: 'simple'`）。
- **日志本身可用**（2026-08-06 更正）：外层从日志提取出完整逐文件分解（168 assertion fails；quay-init-loop 40 / install-config-driven-e2e 9 / runtime-landing 5 / drift/tmux/laydown ~10）——但要**自己数**（无汇总行）。
- 主红因 = "quay-init --loop would ship skills/tick docs that reference files it does not lay down"（referenced⊆landed 违规）。
- **缺陷不依赖能否绕过**：消费者能从日志绕过（手动数），恰说明本应由 `state.failures` 载荷提供的工作被迫由消费者做。

## 性质

与 `gap-full-suite-runner-marks-test-sh-gate-wait-as-failed`（reason 轴）同族但不同缺口：那条是「red 的 reason 分不清 failed/aborted」，这条是「**red 的 failures 落点字段是空的 + 日志无汇总**」。两者都让 inner 派发规则读不到它需要判定的输入。

## 修复方向（接法留执行时）

1. **runner 捕获失败落点进 `state.failures`**：AC2 已经知道哪条失败行翻转了 red（TAP `location:` / vitest `❯ <file>`），应把 file context best-effort 写进 `state.failures`（runner:236-238 注释已描述意图，但实际产物是空）。
2. **日志汇总行**：套件结尾应有 `# fail N / # pass M` 汇总（node:test 的 TAP 输出应有，可能是 tee/裁剪丢了）；确认 runner 的 tee 不吞汇总。

## AC（draft）

- [x] 一次红判决的 `state.failures` 非空（含失败落点 file/line）
- [x] 负控制：构造 shared-gate 失败 vs specific-test 失败 ⇒ 两条 `failures` 载荷可区分（inner 派发规则能据此决策）
- [x] `full-suite.log` 有 `# fail` 汇总行（不再断在断言中间无汇总）

## DoD（draft）

- [ ] `scripts/test.sh` 全量红时 `.quay/full-suite-state.json` 的 `failures` 带落点
- [ ] inner 派发规则用 `state.failures` 能区分停派/继续
- [ ] 完整套件绿

## Evidence

- `.quay/full-suite-state.json`：`failures=[]`
- **连续三个实例（2026-08-06，管理者交叉核对 + 外层复核）**：red(18:47:46)、running(19:48:03)、red(20:26:23) 三次状态写入 `failures` 均为空——空载荷缺陷第 3 次确认
- `full-suite-runner.ts:230-238`：设计注释明写 state.failures 必须带落点
- `.quay/full-suite.log`：`grep -cE '^# (tests|pass|fail|cancelled)'` = 0；tail 断在 `diff: 'simple'`
- 内层 18:5x：`timeout 300 node --test --test-concurrency=1 plugin/test/quay-init-loop.test.mjs`（另一条路找落点）

## Invoke evidence（2026-08-10，inner 实现）

- **AC1 修复**：`full-suite-runner.ts` 终判区新增 fail-closed catch-all 合成——通用非零退出（无结构化失败行、无 TAP 汇总、无 static-check 标记，如 `echo "something went wrong"; exit 3`）之前写 `reason=failed + failures=[]`；现在合成一条 best-effort 落点（`line` = 最后流行，`file` = best-effort 提取），红判决 `failures` **永不为空**。实测：构造该场景 ⇒ `state=red reason=failed failures=[{"line":"something went wrong"}]`（非空，之前为 `[]`）。
- **AC2 负控制**：新增 e2e `AC2 e2e negative control — a SHARED-GATE red and a SPECIFIC-TEST red produce distinguishable failures[] payloads`——同一 runner 跑 static-check 红（`reason=static-check`，`classifyFailure ⇒ shared-gate`）与 TAP 具体测试红（`classifyFailure ⇒ specific-test`），`shouldDispatchOnRed` 对共享门红停派、对不相关具体测试红继续派——两条载荷可区分，派发规则有输入。
- **AC3 汇总行**：`full-suite-runner.ts` 终判后向 `full-suite.log` 追加 TAP 形式汇总（`# tests N / # pass M / # fail N / # cancelled N / # suite red failed`）。实测：红跑日志以 `# fail 1` 结尾、绿跑以 `# fail 0` 结尾——`grep -cE '^# (tests|pass|fail|cancelled)'` ≥ 4。
- **scoped 测试**：`node --test --test-concurrency=1 plugin/test/full-suite-runner.test.mjs plugin/test/suite-state-trigger.test.mjs plugin/test/red-window-shared-gate.test.mjs` ⇒ 112 pass / 0 fail（runner 75 项含 4 项本任务新增：catch-all 非空、红汇总行、绿 `# fail 0`、shared/specific 负控制）。`./scripts/test.sh --for-task` 的 selector 按 Touches 解析 0 测试（Touches 仅 self-touch），改用显式文件跑；scoped static checks 两门（task-contract / superseded-capability）均 PASS。

## Touches

- tasks/gap-suite-red-verdict-carries-empty-failures-payload.md（自身文件）
- plugin/scripts/full-suite-runner.ts
- plugin/test/full-suite-runner.test.mjs
