---
id: gap-residue-check-crystallized-as-tool-mode
title: "\"box has text vs actually submitted\" must be a tool judgment, not role
  memory — add a --check-residue mode (empty / real-unsubmitted-text /
  ghost-suggestion-only) reusing D's bottom-region + shape"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---


**type:** execution

## Proposal

人裁定（2026-08-05，经管理者转达）：**「框里有字 vs 真的提交了」这个判断不该靠角色记住去区分，
要结晶到工具、更可靠且算力更省。**

### 背景（外层实锤的失效）

今晚多次因读输入框文字误判内层行动：
- R2 AC8 反向踩坑——把框内备忘读成「已提交的行动」（`产品机制自我修正闭环运转` 是 false claim，
  transcript 核实 0 命中）；
- 可靠发送故障 6——ghost-suggestion 无法硬清空（C-u/C-a+C-k 循环 pane 不变），被误读为真残留。

**判据靠人/角色目测 = 每次失败都在复读同一形态。** 人裁定：把它做成工具。

### 选定机制

**在 `pane-state-classify.ts`（复用 D 的底部区域 + 形状判断）新增 `--check-residue` 模式**：

```
输入: pane 文本（或 tmux 目标，运行时探针）
输出: empty | real-unsubmitted-text | ghost-suggestion-only
```

- **empty**：输入框行为 `❯ `（无内容）。
- **real-unsubmitted-text**：输入框有文本，且 **C-u 能清掉**（运行时探针：capture → C-u → capture，
  文本消失 = 真输入残留）。
- **ghost-suggestion-only**：输入框有文本，且 **C-u 清不掉**（pane 逐字不变 = gray ghost-suggestion，
  故障 6 判据机械化）。

**运行时探针是判据**：静态 pane 文本无法区分「真输入」与「ghost」（plain-text capture 无样式信息），
区分只能靠 C-u 清除行为（故障 6 的判定：C-u 循环 N 次 pane 不变 ⇒ ghost）。工具把这条判据从
「角色目测」变成「命令产物」。

## Acceptance Criteria

- [x] AC1: `pane-state-classify.ts --check-residue` 存在——给定 pane 文本/目标，输出三态之一
      （empty / real-unsubmitted-text / ghost-suggestion-only），复用 `bottomRegion` 与五态形状逻辑
- [x] AC2: **运行时探针（fault-6 判据机械化）**——real-unsubmitted 的判定包含「C-u 后文本消失」；
      ghost 的判定包含「C-u 循环 N 次 pane 逐字不变」（探针有界、fail-loud）
- [x] AC3: 夹具三态各 ≥1 张真实录制（empty 输入框 / 真输入未提交 / ghost-suggestion 占位），附录制来源
- [x] AC4: **负控制（双向）**——真输入残留 ⇒ C-u 清掉 ⇒ 判 real-unsubmitted；ghost ⇒ C-u 不清 ⇒ 判
      ghost-suggestion-only（两次实跑贴任务体）
- [x] AC5: 与 transcript 交叉验证——判 real-unsubmitted 后，查 transcript 确认该文本**未**作为 user
      message 出现（若已提交则判错）；判 ghost 后，transcript 同样无该文本（实跑贴出）
- [x] AC6: 测试用 `node:test` 且带 `// @test-group engine`（与 D 同类）
- [x] AC7: 标注与故障 6 的关系——结晶文档故障 6 的运行时判定逻辑由此工具承载（源头消除后仍作历史兜底）

## AC4/AC5 实跑输出（贴任务体，2026-08-06，throwaway pane 真实录制，未触碰 quay-b 活会话）

### AC4 实跑 1 —— 真输入残留 ⇒ C-u 清掉 ⇒ 判 real-unsubmitted

```
$ tmux send-keys -t residue-fix:0.0 -l 'AC4 real unsubmitted check text'   # 打字未回车
$ tmux capture-pane -p -t residue-fix:0.0 | grep '❯' | tail -1
❯ AC4 real unsubmitted check text
$ node --experimental-strip-types plugin/scripts/pane-state-classify.ts --check-residue residue-fix:0.0
{"state":"real-unsubmitted-text","reason":"C-u cleared the input line at cycle 1","captures":2,"target":"residue-fix:0.0","maxClicks":50}
$ tmux capture-pane -p -t residue-fix:0.0 | grep '❯' | tail -1   # 探针已 C-u 清空
❯
```

### AC4 实跑 2 —— ghost ⇒ C-u 不清 ⇒ 判 ghost-suggestion-only（有界 3 次 C-u）

```
$ tmux capture-pane -p -t residue-ghost:0.0 | grep '❯' | tail -1
❯ Try "fix lint errors"
$ node --experimental-strip-types plugin/scripts/pane-state-classify.ts --check-residue residue-ghost:0.0 --max-clicks 3
{"state":"ghost-suggestion-only","reason":"input line byte-identical through all C-u cycles (fault 6) (probe ran 3 C-u cycles, cap 3)","captures":4,"target":"residue-ghost:0.0","maxClicks":3}
$ tmux capture-pane -p -t residue-ghost:0.0 | grep '❯' | tail -1   # 逐字不变
❯ Try "fix lint errors"
```

### AC5 transcript 交叉验证（判后 grep 全部 quay workspace transcript，只数 user-message 内容命中）

```
real-unsubmitted 文本 'AC4 real unsubmitted check text' → user-message hits = 0（从未被提交）
ghost 文本 'Try "fix lint errors"'                       → user-message hits = 0（从未被提交）
```
说明：早期按字节 grep 出的 1–2 处命中是**本任务自己的 subagent transcript 里那条 `tmux send-keys`
工具调用命令行**（type=tool_use，不是 user message）——恰是 AC5 要防的「把命令/工具痕迹当成已提交」
的区分点；按 `type=="user" && message.role=="user" && content 含该文本` 过滤后为 0。

### 真实使用（DoD 实跑，非构造——真 Claude Code TUI，throwaway 会话，未触碰 quay-b 活会话）

生产配置（`CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false claude --prompt-suggestions false`，
冷启动 REQUIRED 参数）下，输入框为空；打字未回车后用 `--check-residue` 判框态，C-u 清掉 ⇒ real：

```
$ node --experimental-strip-types plugin/scripts/pane-state-classify.ts --check-residue residue-claude:0.0
{"state":"empty","reason":"input line after ❯ is empty (probe: no C-u needed)","captures":1,"target":"residue-claude:0.0","maxClicks":50}
$ tmux send-keys -t residue-claude:0.0 -l 'REAL USE residue marker 20260806b'   # 打字未回车
$ tmux capture-pane -p -t residue-claude:0.0 | grep '❯' | tail -1
❯ REAL USE residue marker 20260806b
$ node --experimental-strip-types plugin/scripts/pane-state-classify.ts --check-residue residue-claude:0.0 --max-clicks 5
{"state":"real-unsubmitted-text","reason":"C-u cleared the input line at cycle 2","captures":3,"target":"residue-claude:0.0","maxClicks":5}
$ tmux capture-pane -p -t residue-claude:0.0 | grep '❯' | tail -1   # 探针已清空
❯
```
该 throwaway 会话从未提交任何 user message（transcript 文件未创建），marker 从未作为 user message
出现在任何 transcript——与「real-unsubmitted（未提交）」判一致。

无生产 flag（带 ghost-suggestion）的同一真 Claude TUI 上，输入框是**真实 gray ghost-suggestion**
（`❯ Try "fix typecheck errors"`），`--check-residue` 判 ghost ⇒ C-u 逐字不变：

```
$ tmux capture-pane -p -t residue-claude:0.0 | grep '❯' | tail -1
❯ Try "fix typecheck errors"
$ node --experimental-strip-types plugin/scripts/pane-state-classify.ts --check-residue residue-claude:0.0 --max-clicks 3
{"state":"ghost-suggestion-only","reason":"input line byte-identical through all C-u cycles (fault 6) (probe ran 3 C-u cycles, cap 3)","captures":4,"target":"residue-claude:0.0","maxClicks":3}
$ tmux capture-pane -p -t residue-claude:0.0 | grep '❯' | tail -1   # 逐字不变
❯ Try "fix typecheck errors"
```
（在无生产 flag 的会话里打字后探针会因「清掉后被 ghost 重新渲染」而 fail-loud 报 unknown——这是正确
的 fail-loud：`--prompt-suggestions false` 已从源头消除该形态，工具对意外形态不猜。）

### AC6 作用域测试输出（`scripts/test.sh --for-task gap-residue-check-crystallized-as-tool-mode`）

```
✔ AC1: --check-residue pure functions exist; a single snapshot yields only the static part
✔ AC1: --check-residue CLI is wired — a file/target argument emits one JSON line whose state field is one of the three
✔ AC1: the residue check reuses bottomRegion — an upper-screen ❯ cannot fake the input line
✔ AC2: the fault-6 criterion is mechanized in the pure verdict — C-u cleared ⇒ real; byte-identical ⇒ ghost; bounded + fail-loud
✔ AC3: residue fixtures are real recordings — on disk, multi-line, non-trivial, and classifiable
✔ AC4: bidirectional negative control — cleared ⇒ real (never ghost); unchanged ⇒ ghost (never real); both decisive
ℹ tests 17   ℹ pass 17   ℹ fail 0   ℹ cancelled 0
EXIT=0
```

### 重新分派执行器复核（2026-08-06，既有实现 commit 793f0204 验证 + 全量套件复跑）

任务在任务分支已有完整实现（commit 793f0204），重新分派后执行器逐项复核（非新构造）：

- **Contract measure/invoke 复跑（夹具）**：`empty` → exit 0；real pair（`--after`）→ `real-unsubmitted-text`
  exit 0；ghost pair（`--after`，逐字相同）→ `ghost-suggestion-only` exit 0；单张静态快照带文本 →
  `unknown` exit 1（fail-loud，静态无样式信息）。
- **live 探针实跑（throwaway tmux pane `residue-verify:0.0`）**：空框 → `empty`；
  `send-keys -l 'LIVE PROBE residue marker 20260806x'`（未回车）→
  `{"state":"real-unsubmitted-text","reason":"C-u cleared the input line at cycle 1","captures":2}` exit 0，探针清空框。
- **AC5 transcript 交叉复核**：三个 marker 文本（`AC4 real unsubmitted check text`、`Try "fix lint errors"`、
  `LIVE PROBE residue marker 20260806x`）在全部 quay workspace transcript 中 genuine user-text content 命中均 = 0；
  `AC4 real unsubmitted check text` 的唯一原始命中位于任务自身 body 的 AC4 证据文本
  （jsonl path `/mcpMeta/structuredContent/tasks[19]/body`）——是文档不是提交，恰是 AC5 要防的区分点。
- **AC6 作用域测试**：`scripts/test.sh plugin/test/pane-state-classify.test.mjs` → tests 17, pass 17, fail 0, cancelled 0。
- **AC7 标注已就位**：`orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md` 2026-08-06 标注写明故障 6
  运行时判定由 `pane-state-classify.ts --check-residue` 承载，源头消除后作历史兜底。
- **全量套件复跑**：worktree 首次全量套件因两个 gitignored 本地工件缺失（`.quay/config.yml` 工作区配置、
  `packages/quay/plugin/` pack-time 快照，git worktree 不携带）致 workspace 依赖的 gate/loop-shipping 测试
  fail-closed；补齐两个 gitignored 工件后复跑 → **tests 2866, pass 2821, fail 0, cancelled 0, skipped 45（预期：
  governance group、live-github 无凭据、tmux 无环境等），FULL-SUITE-EXIT=0**，且套件自带 clean-tree 断言通过。

## Definition of Done

- [x] AC1–AC7 全部勾上；AC4/AC5 实跑输出逐字贴任务体
- [x] 一次真实使用：外层驱动内层后用 `--check-residue` 判内层框态，结果与 transcript 一致（非构造）
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches
- tasks/gap-residue-check-crystallized-as-tool-mode.md（自身文件：勾 AC + 贴 invoke 证据授权）


- tasks/gap-residue-check-crystallized-as-tool-mode.md
- plugin/scripts/pane-state-classify.ts
- plugin/test/pane-state-classify.test.mjs（或新增 residue-check 测试）
- plugin/test/fixtures/pane-states/（补三态夹具）
- orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md（AC7 标注）

## Contract

measure   residue_state = `node --experimental-strip-types plugin/scripts/pane-state-classify.ts --check-residue <pane.txt|target>` stdout 的 state 字段
band      residue_state = empty|real-unsubmitted-text|ghost-suggestion-only（恰好三态之一）
invariant runtime_probe_is_judgment = 1（真输入 vs ghost 靠 C-u 清除行为判，不靠静态文本）
invoke    `node --experimental-strip-types plugin/scripts/pane-state-classify.ts --check-residue <pane.txt>`
control   真输入⇒C-u 清掉⇒real；ghost⇒C-u 不清⇒ghost（AC4 双向）
resume    模式实现与夹具分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T00:1xZ
changed: 外层受人裁定立案。四处收紧：
(1) **运行时探针是判据**——plain-text 无样式信息，静态无法分 ghost/真输入，只能靠 C-u 清除行为
（故障 6 判据机械化，从角色目测变命令产物）；
(2) **AC5 与 transcript 交叉**——判 real-unsubmitted 后必须确认 transcript 无该文本，否则「真输入
残留」与「已提交」混淆（今晚的 R2 AC8 反向坑）；
(3) **AC3 夹具真实录制**——三态各 ≥1 张，附录制来源（E 的纯函数纪律：夹具是录的 .txt）；
(4) **AC7 与故障 6 挂钩**——运行时判定逻辑由本工具承载，源头消除后仍作历史兜底。
status: todo——排 gap-init-ships（管理者优先裁定，卡自建目标）之后。
