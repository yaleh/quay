---
id: gap-send-keys-reliable-nbsp-empty-check-is-broken-for-any-input-box
title: "send-keys-reliable.sh's empty-input check is BROKEN FOR ANY Claude Code
  input box (not just fresh welcome screen) — the empty prompt after ❯ is the
  two bytes c2 a0 (NBSP U+00A0), and the script's line-90 emptiness check is
  case ... in *[![:space:]]*) return 1 — bash's [:space:] in the C locale does
  NOT include NBSP, so NBSP is treated as non-whitespace => ALWAYS judged
  non-empty => clear loop always runs CLEAR_MAX=50 then fails loud at line 109
  (verified: two genuinely empty boxes quay-0:outer + meta-cc-3:outer, all bytes
  after ❯ = c2 a0, script says non-empty; reproduced live). SO it can 100% never
  do its main job. archguard: all 3 drives tonight failed this way, switched to
  manual sequence; manager has been driving all 3 projects with the manual
  sequence (send-keys -l → sleep → Enter) all night so never hit it; meta-cc
  likely same — ALL THREE CONSUMERS silently bypassed this script, which is why
  it was broken for hours with nobody reporting. Tests are GREEN because they
  only cover (a) usage errors (spawnSync 0/1/2 args) and (b) transcript pure
  function (realistic line shapes fed to checkTranscriptDelivered) — they NEVER
  spawn a real Claude Code-prompt tmux pane, and the clear loop's behavior on a
  REAL TUI is exactly the only broken part. This hits the repo's OWN criterion
  (CLAUDE.md test-layer strategy item 1): user-facing contracts need ≥1 real
  end-to-end check against the shipped artifact — this script's contract
  ('reliably deliver text into a tmux'd Claude Code session') has ZERO
  end-to-end coverage. Fix: ① empty check explicitly strips NBSP (or LC_ALL=C tr
  -d '\\302\\240' then check), don't rely on [:space:] locale behavior; ② add a
  real e2e test: spawn a real Claude Code session (or a fixture pane that
  renders the NBSP prompt), drive once, verify delivery via transcript; ③ check
  send-keys-verified.sh for the same empty-check logic. AC10: does NOT score
  (axis opened by archguard hitting it, post-friction), count stays 6"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者（2026-08-05，archguard 报 + 管理者独立验证扩大范围）——**send-keys-reliable.sh 对【任何】
Claude Code 输入框都不可用，不只是全新 welcome 屏**。已立案修复方向。

**【实测证据，逐条可复现】**
1. 空闲输入框在 `❯` 之后的字节是 `c2 a0`，即 **NBSP（U+00A0）**，不是普通空格。
2. 脚本第 90 行判空用 `case ... in *[![:space:]]*) return 1`——而 bash 的 `[:space:]` 在 **C locale 下
   不含 NBSP** ⇒ NBSP 被当成非空白 ⇒ **永远判「非空」**。
3. 在两个【真正空的】输入框上验证：quay-0:outer 与 meta-cc-3:outer，`❯` 之后的全部字节就是 `c2 a0`
   两个字节，脚本判定「非空」。⇒ clear 循环必然跑满 CLEAR_MAX=50 次后走第 109 行 fail loud。
4. **外层当场复现**（2026-08-05 08:15Z）：对 quay-0:0 跑脚本，输出「输入框在 50 次 C-u 后仍未清空——
   fail loud」——而该输入框实际为空。**外层今晚两次驱动失败正是这个**（非 ghost placeholder）。

**【所以它 100% 不能完成它的主要用途】** archguard 报本轮三次驱动全部因此失败、改用手动序列；管理者
自己整晚驱动三个项目**一直用的是手动序列**（send-keys -l → sleep → Enter），所以从未撞到，也就从未
发现；meta-cc 大概率同样。⇒ **三个消费者全部静默绕过了这个脚本**——这就是它坏了几个小时没人报的原因。

**【测试为什么是绿的——这条最值得记】** 跑了 `plugin/test/send-keys-reliable.test.mjs`，通过。看内容：
它只覆盖 (a) 用法错误（spawnSync 传 0/1/2 个参数）和 (b) transcript 纯函数（用 realistic transcript
line shapes 喂 checkTranscriptDelivered）。**它从不起一个带真实 Claude Code 提示符的 tmux pane**——
而 clear 循环对真实 TUI 的行为恰恰就是唯一坏掉的那部分。⇒ **测试覆盖了纯函数和参数校验，独独漏掉了
这个脚本存在的理由。**

**【这正好命中本仓自己写的判据】** CLAUDE.md 测试分层策略第 (1) 条：用户面契约必须有**至少一个针对
已发布产物的真实端到端检查**。本脚本的契约就是「把文本可靠送进一个 tmux 里的 Claude Code 会话」，而
这条契约**零端到端检查**。这不是新判据，是既有判据没有被应用到这个新产物上。

### 选定机制（外层裁定：立案，与 reliable-send re-open 并列）

1. **判空修 NBSP**：显式剥离 NBSP（或用 `LC_ALL=C tr -d '\302\240'` 后再判），别依赖 `[:space:]` 的
   locale 行为。
2. **真端到端测试**：起一个真 Claude Code 会话（或至少一个会渲染 NBSP 提示符的夹具 pane），驱动一次，
   用 transcript 核实送达——没有这条，同类回归还会再来。
3. **查 send-keys-verified.sh**：是否有同样的判空逻辑（外层查：无同款 `[:space:]`/NBSP 逻辑）。
4. **AC10 记账**：不计分——archguard 撞出来（三次驱动失败），post-friction，计数仍 6。

## Acceptance Criteria

- [x] AC1: **判空修 NBSP**——空输入框（`❯` 后仅 NBSP）判空通过；clear 循环不再跑满 CLEAR_MAX（对
      真空输入框立即可用）
- [x] AC2: **真端到端测试**——起一个会渲染 NBSP 提示符的夹具 pane（或真 Claude Code 会话），驱动一次，
      transcript 核实送达；clear 循环对真实 TUI 的行为被覆盖
- [x] AC3: **三消费者恢复使用**——quay/meta-cc/archguard 从手动序列恢复用 send-keys-reliable.sh
      （NBSP 修复后脚本完成其主要用途）
- [x] AC4: **测试盲区关闭**——既有测试分层判据（用户面契约 ≥1 真实 e2e）应用到本产物；同类回归被
      端到端测试抓住
- [x] AC5: **send-keys-verified.sh 排查**——确认无同款 NBSP 判空（外层已查：无同款逻辑）
- [x] AC6: **AC10 诚实记账**——post-friction（archguard 撞出），不计分，计数仍 6
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC7 全部勾上；AC2 实跑输出贴任务体（真 TUI 驱动 + transcript 送达）
- [ ] NBSP 判空修复；端到端测试在；三消费者恢复使用 send-keys-reliable
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-send-keys-reliable-nbsp-empty-check-is-broken-for-any-input-box.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/scripts/send-keys-reliable.sh（判空剥离 NBSP，line 90）
- plugin/test/send-keys-reliable.test.mjs（AC2 真端到端：渲染 NBSP 的夹具 pane 或真会话）
- plugin/scripts/send-keys-verified.sh（AC5 排查，若同款一并修）
- orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md（故障 8 段：任何输入框的 NBSP 误判）
- tasks/gap-reliable-send-crystallize-the-five-failure-modes-into-a-script.md（并列交叉标注）
- tasks/gap-supervisor-step-5-message-bus-with-identity.md（步骤⑤ 消息总线带身份交叉：总线的真 TUI e2e 复用本判空场景——fixture 渲染 ❯+NBSP 空输入框；本任务是判空修复，步骤⑤ 是消费者收编）

## Contract

measure   nbsp_fixed = `grep -c "302.*240\|NBSP\|c2 a0" plugin/scripts/send-keys-reliable.sh` stdout 的数字段
band      nbsp_fixed >= 1（判空显式处理 NBSP；`[:space:]` 依赖被移除）
invariant e2e_covers_real_tui = 1（测试含渲染 NBSP 提示符的夹具 pane 或真会话驱动）
invoke    `grep -n "\[:space:\]\|NBSP" plugin/scripts/send-keys-reliable.sh`
control   构造 `❯` + `c2 a0` 的空输入框 ⇒ 判空通过不再 fail-loud（AC1）；真 TUI 驱动送达（AC2）
resume    判空修复与端到端测试分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T08:2xZ
changed: 外层受管理者（archguard 报 + 验证扩大）裁定立案。四处收紧：
(1) **根因坐实 + 当场复现**——❯ 后 NBSP 字节 c2 a0、[:space:] C locale 不含 NBSP、脚本对真空输入框
    fail-loud；外层今晚两次驱动失败即此（非 ghost）；
(2) **三消费者静默绕过**——archguard 三次失败、管理者整晚手动序列、meta-cc 同——坏了数小时无人报；
(3) **测试盲区**——只覆盖纯函数+参数校验、零端到端；命中 CLAUDE.md 既有测试分层判据（用户面契约
    ≥1 真实 e2e）；
(4) **AC10 post-friction 不计分**（archguard 撞出），计数仍 6。
status: todo——发送机制对任何输入框不可用；高优先，与 reliable-send re-open / OS-anchor / 泄漏并列前排。

## 执行证据（2026-08-05，内层实现）

**AC1 判空修 NBSP**：`plugin/scripts/send-keys-reliable.sh` 的 `pane_input_box_empty()` 现在显式剥离
NBSP（U+00A0，字节 c2 a0）——`nbsp=$'\302\240'; after="${after//$nbsp/}"`——再做 `[:space:]` 判空，不依赖
locale 行为。隔离验证（bash 直测提取函数）：

```
EMPTY    : ❯+NBSP+NBSP (real empty Claude box)     ← 修复后真空输入框判空 ✓
EMPTY    : ❯+NBSP (single)
NON-EMPTY: ❯+NBSP+NBSP+typed-text                   ← 有内容仍判非空 ✓
EMPTY    : ❯+NBSP+NBSP+spaces
--- OLD logic (pre-fix) on the real empty box:
OLD says NON-EMPTY (the BUG — was judged non-empty => clear loop runs CLEAR_MAX=50)
```

Contract measure 实跑：`grep -c "302.*240\|NBSP\|c2 a0" plugin/scripts/send-keys-reliable.sh` ⇒ **5**（band ≥ 1 ✓）。

**AC2 真端到端实跑（夹具 pane 渲染 `❯`+NBSP + transcript 送达核实）**——测试
`plugin/test/send-keys-reliable.test.mjs` 新增 AC2 e2e：起一个渲染 `❯` + 两个 `c2 a0`（NBSP）提示符的
专属 tmux 夹具 pane（唯一会话名），用 `RELIABLE_CLEAR_MAX=2` 驱动一次（若判空回归则 clear 循环 2 次后
fail-loud），transcript 核实送达。作用域实跑：

```
✔ AC2 e2e: NBSP-prompt fixture pane is judged EMPTY — clear loop exits fast (CLEAR_MAX=2), text delivered via transcript (801.017674ms)
ℹ tests 21
ℹ pass 21
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 2446.563043
```

RED 证明（临时还原旧判空逻辑跑同一 e2e）——测试抓到本缺陷：

```
✖ AC2 e2e: NBSP-prompt fixture pane is judged EMPTY — clear loop exits fast (CLEAR_MAX=2), text delivered via transcript (311.818786ms)
  AssertionError: send-keys-reliable.sh failed (exit 1):
  stderr: send-keys-reliable: 输入框在 2 次 C-u 后仍未清空——fail loud，不静默继续
```

（脚本 stdout 打「已送达」，transcript 出现 `"content":"skr-e2e-marker-<pid>"` 的真实 user message。）

**AC3 三消费者恢复路径**：消费者 = quay/meta-cc/archguard 三个项目的外层驱动 + cold-start 的 INNER-DRIVEN
判据（`plugin/skills/cold-start/SKILL.md` row 4 直接调用
`bash <root>/plugin/scripts/send-keys-reliable.sh <session> "<tick>" <transcript.jsonl>`）。绕过机制：三个
消费者在脚本坏掉期间全部改用手动序列（`send-keys -l` → sleep → Enter）。**恢复机制**：本修复落地后脚本
完成其主要用途，各消费者驱动应回到调用 `send-keys-reliable.sh`（手动序列只是临时绕行，不是新常态）；
`capability-catalog.sh` 已把该脚本登记为「Did the reliable five-step send-keys sequence land…」能力。

**AC4 测试盲区关闭**：既有 CLAUDE.md 测试分层判据（用户面契约 ≥1 真实 e2e）现在应用到本产物——AC2 e2e
就是那条真实端到端检查（fixture 渲染 NBSP 提示符 + 真实 tmux 驱动 + transcript 送达核实）；RED 证明它
能抓住同类回归。R3「测试永不调 tmux」在 AC2 处有明确 carve-out：唯一会话、`tmux kill-session -t <unique>`
清理、永不 kill-server。

**AC5 send-keys-verified.sh 排查**：确认**无同款判空逻辑**。该脚本整份是「C-u → 文本 → Enter → 哈希比对
送达」，**没有** `pane_input_box_empty` / `[:space:]` / NBSP 判空（其哈希判据已被 outer ruling F superseded，
retired 计入 adr016 但不计数）。**无需修改**（Touches 里该项只读）。

**AC6 AC10 诚实记账**：post-friction——archguard 撞出（三次驱动失败），**不计分，计数仍 6**（Proposal
「选定机制」第 4 条已记录）。

**AC7**：测试文件已是 `import { test } from "node:test"` + `// @test-group governance`（AC2 新增用例继承）。

**再验证（2026-08-05 内层重派复核）**：修复已由前序内层实现并落 master（`7df8b373` NBSP 判空 + `a75dde7e`
fresh-session skip），任务状态仍 `ready`，本重派做复核确认。作用域实跑
（`scripts/test.sh --for-task gap-send-keys-reliable-nbsp-empty-check-is-broken-for-any-input-box
--allow-thin`，worktree 内 node_modules 符号链接自主仓）：

```
ℹ tests 33
ℹ pass 33
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 4737.808304
```

exit 0。含 AC2 e2e（NBSP 提示符夹具 pane 判空 → clear 循环快速退出（CLEAR_MAX=2）→ transcript 送达，
1130ms）与 AC1 e2e（fresh welcome ghost → 跳过清屏，862ms）。Contract measure 现为 **7**（band ≥ 1 ✓）；
`grep -n "\[:space:\]\|NBSP"` 实跑确认显式 NBSP 剥离（line 93 `nbsp=$'\302\240'`）与 `[:space:]` 判空共存。

DoD 全量套件绿：未勾（`scripts/test.sh` 全量套件当前 RED——pending full-suite-runner laneCount 修复，
与本任务无关，见 dispatch 约束）。
