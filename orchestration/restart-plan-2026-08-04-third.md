# 第三次重启计划 —— 管理者的目标与 AC

**日期**：2026-08-04（管理者）
**触发**：人指出「你使用了错误的命令启动 outer 和 inner」。本文件先如实记错，再给出证据支撑的正确命令与判据。

---

## 0. 我错在哪（先记，再改）

我自拟了启动命令，没有先查历史。实际错了三处：

| 项 | 我起的 | 历史证据里的正确值 | 证据 |
|---|---|---|---|
| **inner 的服务商** | Anthropic `claude`（默认 = **Opus 5 · Claude Max**，pane 实证） | **`claude-deepseek`**（deepseek 官方 API，独立 key） | 崩溃前 inner 会话 `74cfbc0e` 的 `message.model` 全部是 `deepseek-v4-flash`；另有 3 个 inner 会话同值 |
| **inner 的上下文环境** | 无 | `CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000` `CLAUDE_CODE_AUTO_COMPACT_WINDOW=917000` `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80` | `~/.bash_history`：这三个变量**只**和 `claude-deepseek --model deepseek-v4-flash` 同行出现 |
| **outer 的模型** | 默认（Opus） | 上次实跑是 `--model sonnet`；`QUAY-OUTER-HANDOFF.md:3` 写的是 Opus ⇒ **有冲突，需人裁定** | outer 会话 `0e28a885` = `claude-sonnet-5`；更早的 `dc6a47bd` = `claude-opus-5` |

**教训（与今天已记的那条同型）**：我把「我知道该怎么起一个 claude 会话」当成了「我知道该怎么起**这个**会话」。
拓扑/模型/服务商是**本机与本项目的事实**，只能查，不能推。

---

## 1. 正确的启动命令（逐字来自 `~/.bash_history` + 会话 model 字段实证）

三个窗口的约定（`outer-phase-goal.md:3`、`QUAY-OUTER-HANDOFF.md:3`）：
`quay-0:manager` / `quay-0:outer` / `quay-0:inner`。

**outer 与 inner 用同一条命令**（人 2026-08-04 裁定：outer 也走 deepseek，不用 Anthropic）：
```
CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000 CLAUDE_CODE_AUTO_COMPACT_WINDOW=917000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80 CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 CLAUDE_CODE_DISABLE_MOUSE=1 claude-deepseek --model deepseek-v4-flash --permission-mode bypassPermissions
```

⇒ `QUAY-OUTER-HANDOFF.md:3` 的「Opus」与最近一次实跑的 `claude-sonnet-5` **都已过时**，该顺带订正
（这条留给外层改自己的交接文档，不由管理者代笔）。

`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` + `CLAUDE_CODE_DISABLE_MOUSE=1` + `bypassPermissions`
是 ADR-016 明列的「可被远程驱动的会话」前置条件，不是可选项。

**不加 `env -u TMUX`**（见 AC4）。

---

## 2. 我这次重启的目标

> 让 quay 双层在**正确的服务商/模型/环境**下重新跑起来，并让人指定的 A–F 六条架构裁定
> **真正进入任务板**——而不是只把两块屏幕点亮、把结论停在简报里。

---

## 3. AC（判据先写，证据后填）

- [~] **AC1 — 启动命令与裁定一致，用 model 字段实证，不看 pane 上的字**
      判据：outer 与 inner 两个会话 transcript 的 `message.model` **都** == `deepseek-v4-flash`。
      **负控制**：任一侧若是 `claude-*` 值，AC1 判定不成立（这正是本次犯的错）。
      **2026-08-04 14:0xZ 证据**：新 outer 会话 `e8e80f27` → `deepseek-v4-flash` ✅。
      **14:2xZ 补齐**：inner 会话 `6a950975` → `deepseek-v4-flash` ✅，
      且其首条消息为「执行 fast-mode-loop-tick.md 的 tick。外层已裁定 A-F 并立案…」
      ⇒ **驱动者是外层，不是管理者**（AC7 边界的旁证）。本条整条成立。
      **负控制确实响了**：错启动留下的旧 outer 会话 `27c03bf0` → `claude-opus-5`，
      与判据预言的失败形态逐字吻合。**这是本次 AC 里唯一一条被真实反例验证过的判据。**

- [x] **AC2 — 三个窗口命名符合寻址约定**
      判据：`tmux list-windows -t quay-0` 得到 `manager` / `outer` / `inner`。
      **证据**：实测输出 `0 manager` / `1 outer` / `2 inner`（我自己的窗口原叫 `claude`，已改名）。

- [x] **AC3 — 监视器一次挂载覆盖 outer + inner 两个目标，且确实在投递**
      判据：收到过带这两个目标名的真实事件。
      **证据**：`SESSION-BACK quay-outer (pid 2600919)` 与 `SESSION-BACK quay-inner (pid 2600928)`
      两条均由同一次挂载投递到管理者会话。
      理由：单飞设计下只覆盖一半，会让别人的挂载变成静默 no-op，把另一半永久晾着（上次的自伤）。

- [x] **AC4 — 不把未经验证的改动捆进重启**
      具体：`env -u TMUX`（L0）**不进**启动命令。它作为一条独立改动交给外层走正常流程（判据+测试）落地。
      理由：重启不是引入新变量的地方；且 F 条关掉那条杀手任务后，即时危险面已经变小。
      **证据**：本次实发命令与 `bash_history` 中那条逐字一致，未含 `env -u TMUX`。

- [x] **AC5 — 驱动送达只用非哈希证据核实**
      判据：pane 内容或 transcript 新增条目；**不采信** `send-keys-verified.sh` 的 exit 0。
      **证据**：`capture-pane` 显示外层已读文件并在跑 `monitor-mount-check.sh` / `inner-blocked-signal.ts`；
      且新 outer transcript `e8e80f27` 的首条 user 消息即本次驱动文本。
      理由：该判据正是 A–F 里判定不可信的那个，用它自证是循环论证。

- [~] **AC6 — 六条裁定真的落到任务板，不是停在简报里**
      判据：A–F 每条对应一个 task 文件或一条明确的关闭裁定；ADR-016 的 carve-out 有实际文本修改。
      **前半 ✅**（提交 `45c0f91a` / `25eb1c30`）：裁定书 `outer-rulings-2026-08-04-A-F.md`（177 行）+
      三条新任务（A=`...the-whole-screen-hash-it-was-meant-to-forbid`、
      D=`...not-classified-so-needs-input-is-unobservable`、
      B=`...trigger-is-dead-code-never-wired-into-any-tick`）+ F 判 `done + superseded`。
      **后半 ❌ 未到**：ADR-016 最后一次提交仍是 `fe7e7b92`，carve-out 尚未改字。

      **这条 AC 的写法本身有缺陷，如实记**：我把「外层立案」（分钟级）和「内层落地改字」（一个任务的寿命）
      塞进了同一条判据。按现在的措辞，它要么长期不能勾，要么被人在「已做到的那半」上勾掉——
      **正是本仓已记录的那个失效形态**（见 `gap-the-one-condition-the-channel-was-built-for-still-has-no-trigger`：
      「一条 AC 的文本跨度大于实现，于是它在『已实现的那部分』上被勾上」）。
      **我在写 AC 时又犯了一次。** 正确写法应拆成两条：AC6a 立案（管理者可验），AC6b 落地（跟随任务生命周期）。

- [ ] **AC7 — 我不越界**
      判据：本次重启我不写任务体/AC/DoD、不直接改代码、不直接派 `Agent` 做实现。
      那些是外层与内层的活（`manager-loop-tick.md` §0）。

- [ ] **AC8 — 如实记录本次自伤**
      判据：本文件第 0 节存在，且被后续 tick 引用过一次。
      理由：第 0 节是这次唯一新增的方法论产出；不被引用就等于没记。

---

## 4. 已裁定（2026-08-04，人）

**outer 用 sonnet 还是 opus？** —— **都不是：outer 也走 `claude-deepseek` + `deepseek-v4-flash` + 917k。**
证据当时是冲突的（最近实跑 `claude-sonnet-5`，交接文档写 Opus），我无法自行裁定 ⇒ 按 §1.5 问了，没猜。
**结果证明两个候选都不对**——这条记下来：证据冲突时，「在两个已见过的值里挑一个」本身就是一种越界推断。

## 5. 一条未结的事实

两个窗口在我启动后不久整体消失（连 pane shell 一起）。我没有证据判定是人手动关闭，
还是我那条命令导致的。**未查清前不作结论**——但 AC4 已经把这条不确定性隔离在启动路径之外。

---

## 6. 更新 2026-08-05 —— 三次崩溃根因获具体机制（AC6, gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause）

管理者 2026-08-05 实测：**本仓库测试套件每轮跑完都泄漏一批 tmux server 进程**（217 个，最老 12h，
全部来自 `plugin/test/send-keys-verified.test.mjs` 的 `skv-ok` 会话，各自带隔离 `TMUX_TMPDIR=/tmp/skv-*/sock`）。
清理后 PSI cpu avg10 从 **94.18 → 31.47**、`resource-gate.sh --for full-suite` 从 **WAIT → GO**、tmux server
从 **217 → 10**。

**这给三次崩溃的根因调查补上了此前缺失的机制环节**：各 tick/记录里把「负载飙升」当作未排除候选，
而负载为什么在崩溃前飙升一直无定论。现在机制是具体的——**套件随轮数累积泄漏 tmux server，每轮几十个
孤儿进程 → 崩溃前负载被拖到 90+ → 资源压力击穿（OOM / ABORT）**。这解释了 07:26 资源 ABORT 与 07:50
跨项目暂停为何当时判得对、但归因不完整（主因是套件泄漏，不是 laneCount、不是另外两个项目）。

**修正 2026-08-05 09:2xZ（第四次全灭后）**：管理者实测「`tmux kill-server` 在隔离 `TMUX_TMPDIR` 下安全」
时，环境变量在两次独立 Bash 调用间静默丢失 → `kill-server` 落到默认 socket → 清空整机 tmux（含
quay-0 / meta-cc-3 / archguard-4 与 outer/inner 驱动会话）。**结论已撤回并写入任务体**：测试 teardown 一律
用 `tmux kill-session -t <名>`（爆炸半径只限指名会话，最坏是「无此会话」报错，绝不清空默认 socket），
绝不用 `kill-server`。第四次崩溃是本次泄漏修复的派生事故，不是第三次崩溃的复发。

关联：`tasks/gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause.md`（本任务，AC1-AC7）；
`tasks/gap-tests-never-clean-up-their-tmpdirs.md`（同族交叉标注，AC5）。

---

## 7. 更新 2026-08-05 —— AC1 那类「选错命令」已机械可查（gap-crystallize-launch-config）

§0 记的「我自拟启动命令，没有先查历史」——那种错误现在**不再依赖人先查历史**：启动参数已结晶进
检查进仓库的 `.claude/launch.settings.json`，冷启动走 `plugin/scripts/quay-launch.sh <role>`（manager|outer|inner）。

- **启动前可验**（正控）：`bash plugin/scripts/quay-launch.sh <role> --dry-run` 输出逐字来自 settings 文件。
- **负控**（防 §0 那类错）：刻意改 `_launchSpec.roles.<role>.model`（如 flash→pro）⇒ `--dry-run` 输出即变；
  `plugin/test/launch-settings.test.mjs` 有机械断言（AC4）。§1 的 `--model deepseek-v4-flash` 现在由
  settings 文件 + launcher 承载，不是一条要手打的 shell 一行。
- **invoke 校验**：`claude --settings .claude/launch.settings.json --version`（settings 文件本身可加载）。
- 逐角色命令见 `orchestration/session-launch-recipes.md` §7。

---

## 8. 更新 2026-08-06 —— ghost-suggestion 源头消除为**必带参数（REQUIRED）**（gap-ghost-suggestion-eliminated-at-source）

人 2026-08-05 裁定：可靠发送故障 6（gray ghost-suggestion 无法硬清空）**从源头消除**，验证成功后
作为**冷启动要求（REQUIRED，非可选）**。2026-08-06 throwaway 会话双向实测通过（AC1/AC2，见任务体逐字证据）。

**启动命令规范的必带参数**（三条路线，缺一不可，`plugin/test/launch-settings.test.mjs` 机械断言）：

1. **CLI 参数**：`--prompt-suggestions false` —— `_launchSpec.promptSuggestions=false` 由
   `plugin/scripts/quay-launch.sh` 翻译成 CLI 参数（settings.json 无 promptSuggestions 键，flag-only）。
2. **环境变量**：`CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` —— settings 文件 `env` 块承载
   （官方环境变量路线是禁用的正确形态，RESEARCH-claude-code-cli-config §结果回写）。
3. **验证判据**：`bash plugin/scripts/quay-launch.sh <role> --dry-run` 输出**必须含**
   `--prompt-suggestions false`（负控：删 `_launchSpec.promptSuggestions` ⇒ 输出即变，测试红）。

**throwaway 会话也可带 `--bare`**（一次性验证，不长驻）。任何角色（manager|outer|inner）的启动命令
都不再可选地省略这两条——省略即启动规范不达标。
## 8. 更新 2026-08-06 —— ghost-suggestion 从源头消除是 **REQUIRED 冷启动参数**（人裁定）

可靠发送结晶文档的**故障 6**（gray ghost-suggestion 无法硬清空——C-u/C-a+C-k 循环后 pane 内容逐字不变）
的根是把输入框里的灰色占位建议读成「内层已提交的行动」——**从源头关掉，故障 6 不再出现**。
人 2026-08-05 裁定：验证成功后作为冷启动要求，**REQUIRED 非可选**。验证实跑见
`tasks/gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false.md` AC1/AC2（throwaway 双向对照：
带配置 ⇒ 输入框 `❯` 后无建议；不带配置 ⇒ `❯ Try "edit <filepath> to..."` 灰色建议出现）。

**必带参数（两条，缺一不可）**：

```bash
--prompt-suggestions false                          # flag-only 形式（launcher 从 _launchSpec.promptSuggestions=false 翻译）
CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false          # 环境变量形式（settings 文件顶层 env，经 --settings 加载）
```

**REQUIRED 机械落实**：
- `.claude/launch.settings.json`：顶层 `env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION="false"`（已在）；
  `_launchSpec.promptSuggestions: false`（新增，flag-only）。
- `plugin/scripts/quay-launch.sh`：`_launchSpec.promptSuggestions === false` ⇒ 每个角色命令都追加
  `--prompt-suggestions false`（`--dry-run` 可验）。
- `plugin/test/launch-settings.test.mjs`：机械断言每个角色 dry-run 命令都含 `--prompt-suggestions false`；
  负控把 `promptSuggestions` 翻成 `true` ⇒ flag 消失（REQUIRED 被改掉的形态可检出）。
- **manager 角色同样必带**（ghost 会误导任何一层，不只 outer/inner）。
