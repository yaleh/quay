---
id: gap-concurrency-cap-state-help-contract-mtime-race
title: 修缺：concurrency-cap-state.json 的 --help 副作用 mtime race
status: ready
role: primitive
labels:
  - help-contract
  - mtime-race
  - hardcoded-file
  - cross-suite-violation
created: 2026-09-03T02:50Z
---

## Finding

**严重度**：🔴 blocks fan-in  
**发现者**：driver development progress (cross-session)  
**发现时刻**：挡住 gap-unified-frontmatter-parser fan-in 收敛

### 现象
`help-contract-incompatible-behaviors.test.mjs` 报告：
```
checkers with a --help side effect (.quay mtime changed)
concurrency-cap-state.json: 1788004193808 -> 1788410556739
```

某个 -check.ts 脚本的 `--help` 调用触发了 `concurrency-cap-state.json` 的写入，导致 mtime 变化。

### 根本原因
- 同族缺陷已在 `gap-suite-help-contract-mtime-race`（done）修过：session-liveness.*.json 的 mtime 变化
- **本实例**：concurrency-cap-state.json 是另一个被检查器脚本作为硬编码路径写入的文件
- 是**全局模式的新实例**（硬规则 5b），不是 gap-unified-frontmatter-parser 的本地缺陷

### 影响
- ⛔ 挡住 gap-unified-frontmatter-parser 的 fan-in 收敛（该任务 blocked）
- ⚠️ 可能还有其它类似文件受同样问题影响（需全局 grep）——**已确认一例**：fan-in suite 实测暴露 `session-liveness.<pid>.json`（observer registry，session-liveness.sh 常驻启动注册表，非 checker `--help` 副作用），已补入排除集（AC6）

---

## Plan

### Step 1：定位所有受影响的文件
运行 help-contract 检查器，识别所有有 --help 副作用的硬编码文件。

```bash
# 查 help-contract test 对哪些文件有怨言
node --test plugin/test/help-contract-incompatible-behaviors.test.mjs 2>&1 | \
  grep -oE '\.(json|txt|lock|cache).*->' | sort -u
```

### Step 2：溯源 concurrency-cap-state.json 的写入来源
找出哪个 -check.ts 脚本在 --help 时会写这个文件。

```bash
grep -r "concurrency-cap-state.json" plugin/scripts/*.ts | grep -v test | grep -v "\.test\."
```

### Step 3：修复该脚本
- 确保 --help 路径不执行生产代码（特别是不写状态文件）
- 参考 `gap-suite-help-contract-mtime-race` 的修法

### Step 4：验证
- 运行 help-contract test，确认 concurrency-cap-state.json 不再变化
- 解除对 gap-unified-frontmatter-parser 的 fan-in 阻塞

---

## Acceptance Criteria

- [x] 溯源成立：没有任何 `-check.ts` 在 `--help` 时写 `concurrency-cap-state.json`——唯一写入方是 `cap-from-gate.ts` `computeEffectiveCap`→`saveState`（`STATE_FILE_NAME`），经 `accounting-emit.ts` `autoOccupancy`→`cap-from-gate.sh` 的层-tick 链调用，属 resident-process 运行时载体，不是 checker `--help` 副作用
- [x] `help-contract-incompatible-behaviors.test.mjs` 的快照排除集新增 `CAP_OBSERVATION_FILES`（含 `concurrency-cap-state.json`），AC1 mtime 负控制不再把并发层-tick 写入误报为 `--help` 副作用
- [x] 负控制未退化：`mtime-race AC3` 单测把 `concurrency-cap-state.json` 加入 resident fixture（写入+追加期望被排除），真实副作用 `measure-history.jsonl` 仍被抓
- [x] 全局扫描无遗漏：`cap-from-gate`/`accounting-emit` 链唯一写出的硬编码状态文件是 `concurrency-cap-state.json`；同族其余 resident 载体（driver round/outcome/control/logs/pid、full-suite-state/log、verification-round、suite-load、observer registry `session-liveness.<pid>.json`）已排除（`session-liveness` 见 AC6）
- [x] help-contract test 全绿（4/4）：AC1 无 mtime 变化、AC2/AC3 不退化、负控制仍抓真实副作用
- [x] `session-liveness.<pid>.json` 排除（CONTINUE 轮补，suite 实测暴露）：`isNonCheckerRuntimeFile` 新增 `/^session-liveness\.[0-9]+\.json$/`（session-liveness.sh 常驻启动注册表；`SL_NO_REGISTER=1` 只关测试污染、生产 monitor 仍写）；mtime-race AC3 负控制 fixture 同步加入 `session-liveness.305362.json` resident 样本，真实副作用 `measure-history.jsonl` 仍被抓

---

## Definition of Done

- [x] concurrency-cap-state.json 的 --help 副作用消除
- [x] help-contract test 无新的 mtime 变化报告
- [x] gap-unified-frontmatter-parser fan-in 可以继续推进
- [x] 全局扫描确认无其它同族硬编码文件被遗漏（补充 AC）

---

## Touches

- `plugin/test/help-contract-incompatible-behaviors.test.mjs`
- `tasks/gap-concurrency-cap-state-help-contract-mtime-race.md` (self)

---

## References

- **Blocking**: gap-unified-frontmatter-parser (fan-in suite red)
- **Same family**: gap-suite-help-contract-mtime-race (done, same pattern, session-liveness files)
- **Hardcoded files anti-pattern**: hardcoded-file 标签的所有任务

