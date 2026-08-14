---
id: gap-fan-in-execute-three-unverified-paths
title: fan-in-execute.js 三条未测承重点——code_delta 正则 / --agent-id 自找 head -1 / flip sed 静默不替换（manager 11:0xZ 报，实调已证「唯一验证=实调」）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（fan-in-execute.js 三条未测承重点——manager 2026-08-14 11:0xZ 报；同日实调已两次实证「改 workflow 的唯一有效验证 = 实调一次 Workflow」，node --check 不够）**。

**背景**：AC78 落地 `fan-in-execute.js`（workflow 模板 + 子代理自足 prompt）。第一条 workflow 派发（touches）实调即捕到 `meta is not defined`（返回消息构造，runner 作用域语义错——node --check 语法过）。**同日两坑**（meta scope + `String.raw` 反引号提前终止）都只被实调捕到 ⇒ **该文件的每条承重代码路径都需要被真实调用覆盖，不能靠语法检查或 fixture-only**。

**三条未测承重点（manager 逐行指出，位置以落地时核）**：
```
① code_delta 正则（约 :60）   delta 断言面判定（AC75 merge-not-rebase）：正则分类 doc/代码/测试面——
                             判错 ⇒ 该跑全量却跳过（漏检）或该跳却重跑（浪费）。未测分类正确性。
② --agent-id 自找 head -1（约 :88）  workflow 生成 prompt 让 subagent 自找 subagents/agent-<自己>.jsonl，
                              代码取 head -1 ⇒ 若目录里多个 agent 文件（并行子代理），head -1 可能取错
                              文件 ⇒ --agent-id 填成别的 subagent 的 id。未测多文件情形。
                              ⭐ 已实证（2026-08-14 11:18）：DIR-127 与 DIR-128 并行时，DIR-127 的 ff
                              lock-event agentId=a017ce6b7fab53eb9（DIR-128 的实现子代理，提 DIR-127 41 次
                              且更新）——自找启发式（ls -t 最近 + grep 任务名）在并发下误选。
                              修法方向：限定 subagents/workflows/<本次 run>/agent-<自己>.jsonl（workflow-run
                              子代理真实落点）或用自身 transcript uuid——精确而非启发式（4b）。
                              ⭐ checker 半边已拆为独立小修（2026-08-14 11:2x 裁）：DIR-128 a8ebef25
                              判 unresolvable（假 RED，活套件阻塞）——subagentStems 只扫平铺不递归
                              workflows/<run>/ ⇒ inner 直接派 checker-fix 子代理独立修（正交：checker
                              解析 vs workflow 自定位），不等本任务。本任务承重点② 只修 workflow 侧。
③ flip sed 静默不替换（约 :83）  flip done 用 sed 替换 status: ready→done；若行形不匹配（如 status 带
                              前导空格/大小写/非首行），sed 静默不改 ⇒ flip 没发生而记录说 done。未测失败路径。
```

**判据1**：三条承重点各补一个真实路径测试/验证——① code_delta 正则对 doc/代码/测试三种 delta 的分类断言；② 自找逻辑在【多个 agent-*.jsonl】时的确定性（或显式 fail-closed 拒多义）；③ flip sed 的失败路径（行形不匹配 ⇒ 报错而非静默绿）。
**判据2（能取假）**：每条用【现状未测】为真样本——① 一个该判「全量」的代码面 delta 现判成「doc」类 ⇒ 红；② 目录含两个 agent 文件时 head -1 取错 ⇒ 红（**真样本 = DIR-127/DIR-128 并发实证**：DIR-127 ff agentId=a017ce6b7fab53eb9 取错为 DIR-128 实现者——回放该场景必须红）；③ 行形不匹配时 sed 静默改 0 行而 exit 0 ⇒ 红。
**判据3**：测试走真实调用路径（不是 fixture-only 的纯函数 mock）——同日实证「fixture-only 假绿」。

**不覆盖**：不改 fan-in 协议本身（AC62/AC75 已定）；不引入新机制。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 fan-in-execute.js 三条承重点（:60 code_delta / :88 head -1 / :83 sed）+ 其现有测试覆盖。
2. 判据1：三条各补真实路径测试。
3. 判据2 能取假：三条现状未测为真样本回放红。
4. 判据3：测试走真实调用（实调 workflow 或等效真实执行路径）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：三条承重点（code_delta 分类 / --agent-id 自找确定性 / flip sed 失败路径）各补真实路径测试。
- [x] AC2 判据2 能取假：①代码面 delta 判成 doc ⇒ 红；②多 agent 文件 head -1 取错 ⇒ 红；③sed 静默不替换 ⇒ 红。
- [x] AC3 判据3：测试走真实调用路径，非 fixture-only mock。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] fan-in-execute.js 三条承重点被真实路径测试覆盖（能取假）+ 全绿。

## Touches

- .claude/workflows/fan-in-execute.js（三条承重点；承重点②：自定位限定 `subagents/workflows/<run>/` 落点 + fail-closed；③ flip sed 加前/后自检 fail-closed；另修 ① `printf '%s\n'`→`'%s\\n'` 模板字面量 `\n` 陷阱）
- plugin/test/fan-in-execute-paths.test.mjs (new)
- tasks/gap-fan-in-execute-three-unverified-paths.md（自身）
- （checker 半边 subagentStems 递归为独立小修，inner 已派——不重复）

## Test-Files

- plugin/test/fan-in-execute-paths.test.mjs

## Evidence

**实现（三条承重点，全部真实执行）**：

- **① code_delta 正则**：保留原正则；测试经【vm 实执行 fan-in-execute.js → 从真实 prompt 提取 step-2 bash → 在真实 temp git repo 跑 fork/merge-base/diff/code_delta 流水线】断言 doc/代码/测试三面分类。**暴露并修了一个真实缺陷**：模板串里 `printf '%s\n'` 的 `\n` 被 JS 展开成真换行，发出的 prompt 里 bash 行断裂（`printf '%s` + 换行 + `' ...`）——改 `'%s\\n'`。node --check 与静态读都捕不到，只有实调捕到（AC78 判据3 再次证实）。
- **② --agent-id 自找**：原平铺 `ls -t ~/.claude/projects/*/subagents/agent-*.jsonl` 启发式在并发下误选。改为只查 workflow-run 真实落点 `~/.claude/projects/*/*/subagents/workflows/*/agent-*.jsonl`（两段通配），候选计数 + 零候选 fail-closed exit 2 + 多个候选取最近修改（当前 run 正在写入 ⇒ 必然最新，确定性）。
- **③ flip sed**：原 `sed -i 's/^status: ready/status: done/'` 行形不匹配静默改 0 行且 exit 0。改为锚定 `$` 只翻 frontmatter 精确行 + 前自检（恰 1 行 `^status: ready$`）+ 后自检（`^status: done$` 存在），任一不符 exit 2（FATAL），body 的 `status: ready——注解` 不误翻。

**测试结果（`bash scripts/test.sh --for-task gap-fan-in-execute-three-unverified-paths --allow-thin`，exit 0）**：

```
✔ ① REAL code delta — .claude/workflows/fan-in-execute.js must classify as code (rerun full suite)
✔ ① REAL test delta — plugin/test/*.test.mjs must classify as code (test assertion face reruns)
✔ ① REAL doc delta — tasks/ + docs/ + .md only must classify as doc (skip full suite)
✔ ① REAL decision — code delta ⇒ rerun decision, doc delta ⇒ skip decision (AC75 semantics)
✔ REAL-INVOCATION — the workflow file vm-executes and emits the full subagent prompt (AC78)
✔ ② DIR-127/DIR-128 replay — the workflows/-scoped self-location picks the workflow-run subagent, NOT the flat trap
✔ ② regression canary — the OLD flat-glob heuristic WOULD mis-pick the trap (判据2 ② 能取假)
✔ ② zero candidates ⇒ fail-closed exit 2 (refuses to guess an agent id)
✔ ② determinism — multiple workflow-run candidates for the SAME task pick the newest (current run)
✔ ③ normal flip — 'status: ready' → 'status: done', body 'status: ready——注解' preserved
✔ ③ line-shape mismatch (status:Ready) ⇒ exit 2 + FATAL, file NOT flipped (no silent green)
✔ ③ multiple exact 'status: ready' matches ⇒ exit 2 + FATAL (refuses to multi-flip)
ℹ tests 12  ℹ pass 12  ℹ fail 0
```

**ts-typecheck**：`fan-in-ts-typecheck-gate.ts --task ... --merge-target develop` → exit 0（Touches 无新增/移动 .ts，`ADMITTED`）。
