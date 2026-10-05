# quay 自托管/自举冷启动证明（SH4 e2e）——两份独立运行记录合并（add/add merge union）

> **合并说明（2026-08-12，`refs/remotes/vhs/integration` merge 进 `task/vhs-merge`）**：
> 本文件由两个分支各自独立创建的同一任务证明记录合并而成（git add/add，双方均从零新建本文件）。
> 两份记录都是对同一任务 `gap-quay-self-hosting-e2e-proof`（SH4，capstone）的冷启动证明，但
> **运行环境、时间、结论与缺陷发现不同**，故按「各自成章、互不覆盖」合并，全部内容原样保留：
>
> - **甲（本分支 `task/vhs-merge` 记录）**：在 **live 仓库 `/home/yale/work/quay`** 上跑通——outer 会话由
>   `manager-adopt` 新建（fresh、无历史，2026-08-12 03:07Z），走 `quay:cold-start` skill step 0–9，
>   **七键全 true 自证、零 human-in-the-loop 验证步**；03:17 出报告、09:23 复验仍 true。含两条
>   机制层透明发现（C8 self-touch 结构性缺口、send-keys-reliable.sh ENOENT 误报）。
> - **乙（vhs 分支记录）**：在 **fresh clone** 上跑（首跑 `/home/yale/work/quay-self-host-proof`
>   @ `90af3340`；重跑 `/home/yale/work/quay-self-host-proof-rerun` @ `2413fe42`，D2 修复后）。
>   首跑六键全 TRUE 但 **AC2 self_certify=0**（step 0 `dead-loop-check` 对 fresh cold-start 假阳性报
>   `running`，需 operator 诊断）；D2 修复后重跑 **AC2 self_certify=1**（step 0 自证 never-started，
>   零 operator 介入）。附 D1–D5 缺陷状态表。
>
> 两份记录交叉印证：甲证明「live 仓库上机制自证」，乙证明「fresh clone 上 step 0 的 D2 修复使自证链完整」。
> 各自的时间线、键表、缺陷表均独立保留，未做取舍。

---

## 甲、运行 A —— 本分支（task/vhs-merge）记录：live 仓库 2026-08-12 03:07Z 跑通

### 甲·标题：quay 自托管冷启动收官证明（SH4 capstone）——quay 用自己的 `quay:cold-start` skill 在自身上跑通，七键全 true 自证，零 human-in-the-loop 验证步

**任务**: `gap-quay-self-hosting-e2e-proof`（`gap-quay-has-never-self-hosted-its-own-cold-start` 的 SH4 收官 child）
**日期**: 2026-08-12（本任务的实现 + 证据收集）
**前置**: 四个前置任务全部 `done`（pane-state 分类 / observer 单目标 / 冷启动恢复分支 / 裸机建会话），2026-08-12 核实

---

#### 1. 运行事实：这次跑的是什么

**2026-08-12 03:07Z，outer 会话 `902b4528-…` 由 `manager-adopt` 新建**（无历史上下文的 fresh 会话——对应 `gap-no-formalized-bare-metal-session-bootstrap` 形式化的「可复现建会话」路径；`quay-0` tmux 拓扑 08-11 已存在，skill step 2 对既有拓扑做了验证而非重建），随即被指示「调用 cold-start 技能，把循环拉起来」。这是规格所述「quay 从未在自身上跑过自己的 `quay:cold-start` skill」缺口的一次**真实验证**——不是手工恢复，不是「冷启动盖在已暖会话上」。

关键时间线（全部来自 outer 会话 transcript 的机械记录，`~/.claude/projects/-home-yale-work-quay/902b4528-….jsonl`）：

| 时间（Z） | 事件 |
|---|---|
| 03:07:52 | outer 会话被 manager-adopt 建出，收到「调用 cold-start 技能」指令 |
| 03:07–03:12 | 跑 skill 前置（step 0 dead-loop-check、step 1b laydown-set 门）、建/验拓扑、挂 Monitor |
| 03:12:07–03:12:25 | 驱动 inner（step 6）：send-keys-reliable.sh 首投 `exit 1`（fresh transcript 未落盘的 ENOENT fail-loud），对**已落盘** transcript 用**同一 checker**（transcript-delivery-check.ts）重判 → `state: delivered, delivered: true`，matched_line 为真实 user 消息（ts 03:12:08） |
| 03:12:56 | 首个 `--task-start` 遥测落盘（`.workflow-events/fm-gap-quay-has-never-self-hosted-its-own-cold-start-1786504579122-0jhwr4.jsonl`） |
| 03:17:06–03:17:18 | outer 完成 step 8/9：七键全 `true` + `LOOP-STATE: cold_start_state=running`，附两条透明发现（都机械解决） |
| 03:22:20 | 20 分钟 cron 首次自主 tick 触发 outer（无人在场） |

**两条透明发现（均为机制层面，机械解决，未人介入——AC2 的诚实记录，不是悄悄抹平）**：

1. **ready 池 C8 self-touch 结构性缺口**：4 个 ready 任务全部 `## Touches` 缺自身文件（`self-touch-missing-c8`），`slot-refill` 判零可派发。outer 按 skill step 7「确保可派发」给首个任务补了 self-touch → 复核 `slot-refill: should_refill:true`。这是 ready-pool 派发机制的事，不是 cold-start skill 的判据缺口。
2. **send-keys-reliable.sh 首次 exit 1 是 ENOENT 误报**：fresh 内层 transcript 尚未落盘时 `--check` 对缺失文件 fail-loud；驱动文本实际已送达（transcript 随后落盘、inner 转 busy、同 checker 对已落盘文件重判 `delivered: true`）。这条在本任务中被落成本文的 skill 改进建议（见 §6）。

---

#### 2. 六键表（任务 AC1 的六键，均 true，证据逐条 verbatim）

以下证据为 03:17 outer 冷启动报告原文（`902b4528` 会话 step 9 报告）逐条转录 + 本任务 09:23 对现行状态的机械复验。

| # | 键 | true\|false | 一行证据 |
|---|---|---|---|
| 1 | `MONITORS-MOUNTED` | **true** | `monitor-mount-check.sh --json` → `{"mounted": true, "targetRoot": "/home/yale/work/quay", "targetOk": true}`；Monitor 挂载了 `plugin/scripts/session-liveness-mount.sh`（persistent）。09:23 复验：`mounted=true, targetOk=true`（pid 1564238/4002865） |
| 2 | `MONITORS-DELIVERING` | **true** | 双证据：① `session-liveness.sh --once` → `SESSION-STATUS quay alive=1 pid=2156880 halted=0`；② 驻留监视器已向本会话投递真实事件 `REPO-STALL`（monitor task bdl4j3fwq）。09:23 复验：`--once` → `SESSION-STATUS quay alive=1 pid=4001662 halted=0` |
| 3 | `CRON-CREATED` | **true** | `CronCreate` `*/20 * * * *` 成功（job 3b63ee4e）、`CronList` 可见、`loop-driver-check.sh` → `LIVE (1) — exactly one loop driver (cron */20 * * * *)`；`.quay/loop-driver.jsonl` 已写 `{"mechanism":"cron","interval":"*/20 * * * *","source":"cold-start"}`。09:23 复验：`loop-driver: LIVE (1) — exactly one loop driver (cron */20 * * * *); observable activity 2min old (window 60min)`（exit 0） |
| 4 | `INNER-DRIVEN` | **true** | 对 `quay-0:inner` 执行 send-keys-reliable.sh 驱动文本「执行 …/fast-mode-loop-tick.md 中的 tick 指令」；对落盘内层 transcript `f8ef0c53…` 用**同一 checker**（transcript-delivery-check.ts）重判：`state: delivered, delivered: true`，matched_line 为真实 `type:"user" role:"user"` 消息（ts 2026-08-12T03:12:08.693Z）。09:23 核实：该内层 transcript 今日共 8 条同款驱动 user 消息（最近 09:10:01Z） |
| 5 | `TELEMETRY-RECORD` | **true** | `.workflow-events/fm-gap-quay-has-never-self-hosted-its-own-cold-start-1786504579122-0jhwr4.jsonl` 存在，含 `commandIdentity:"fast-mode-telemetry:task-start"`、`eventKind:"start"`。09:23 复验：`.workflow-events/` 共 9 个 `.jsonl`，每个都 carry `task-start` 记录 |
| 6 | `FIRST-TASK` | **true** | `fast-mode-telemetry.ts --report --json` → `inProgress: [{taskId: "gap-quay-has-never-self-hosted-its-own-cold-start", runId: "fm-…0jhwr4"}]`；任务在板上 `status: ready`。09:23 复验：`inProgress` 显示本任务 `gap-quay-self-hosting-e2e-proof`（runId `fm-gap-quay-self-hosting-e2e-proof-1786526422543-g29txg`）在飞 |

**LOOP-STATE**: `dead-loop-check.sh --check-running` → `cold_start_state=running`，`next_step=none`。

> **六键 vs 七键命名**：本任务 2026-08-04 撰写时 AC8c 是六键；`TOPOLOGY-IN-PLACE` 于 2026-08-06 增补为现行清单第 7 键（`gap-cold-start-skill-has-no-recovery-branch` 任务已就此作过同一标注）。本表按任务的六键给；现行清单第 7 键见 §3。任务 Contract 的 `six_keys_true = 6` band 写于六键时代，本次运行七键全 true（§3 另计）。

---

#### 3. 现行清单第 7 键 `TOPOLOGY-IN-PLACE`（2026-08-06 增补，晚于本任务撰写）

同一运行中该键亦通过（不属任务六键，单列不混入 §2 计数）：

- 03:17 报告：`topology-check.sh --session quay-0 --json` → `ok: true`，outer/inner 两窗口均有 claude 进程。
- 09:23 复验：`{"session": "quay-0", "ok": true, "windows": {"outer": "ok", "inner": "ok"}}`。

---

#### 4. 负对照：与 `docs/analysis/two-oom-recoveries-compared.md` 手工时间线对比

**判据（SPEC AC-SH4 明示）**：**不是「这次更快」**，而是 **「六键判据能不能不靠人工核实就自证」**。下表因此不把「快」当作结论项，只作为旁证。

| 维度 | 两次手工 OOM 恢复（two-oom-recoveries-compared.md） | 本次自动化冷启动（2026-08-12 03:07Z） |
|---|---|---|
| 会话从哪来 | 手工重建 tmux + 手敲会话 | outer 会话由 manager-adopt 新建（fresh、无历史；既有 quay-0 拓扑由 skill step 2 验证） |
| 恢复/启动流程 | 100% 手工：先读历史、写 AC、逐项手修 | 一条 skill 命令：`cold-start` 走完整 0–9 步 |
| 验收判据 | 无统一 checklist，靠简报 + 人追问 | 同一份 AC8c 可证伪清单，七键逐条 `true` + 证据 |
| 缺陷发现→纠正 | 6 条缺陷里 **3 条靠人观察/追问触发**（外层越权、只跑一个任务等） | 2 条发现（C8 self-touch、ENOENT 误报）都**由机制自己暴露并机械解决**，session 内零人工 user 消息（仅 manager-adopt 引导 + cron tick） |
| 人介入次数 | 多次（人观察、人追问、人手动开 tmux） | **0 次验证性介入**；03:07–03:25 内该会话只有 manager-adopt 引导与 cron tick 两条非人工 user 消息 |
| 首次真派发前耗时 | 第二次恢复约 64 分钟（08:52→09:56）；第一次未精确记录（数小时级） | 03:07:52 建会话 → 03:12:56 首任务遥测落盘（约 5 分钟）；首个真实子 agent 派发随后续 tick 落地（旁证，不作判据） |

**结论**：手工恢复的判据是「人看着、人追问、人确认」；本次冷启动的判据是「清单自己报 true + 证据」，**六键（现行七键）全部由机制自证，无任何 human-in-the-loop 验证步**。这正是 SPEC 要求的自托管证明点。

---

#### 5. 现行状态复验（2026-08-12 09:23，本任务执行时）

按 skill step 0 的 `cold_start_state=running` 分支（ALREADY-RUNNING），对现行循环复验七键仍 true（全部机械命令，命令+输出见 §2 各键「09:23 复验」列）：

- `monitor-mount-check.sh --json` → `mounted=true, targetOk=true`
- `session-liveness.sh --once` → `SESSION-STATUS quay alive=1 pid=4001662 halted=0`
- `loop-driver-check.sh /home/yale/work/quay` → `LIVE (1)`（exit 0）
- `topology-check.sh --session quay-0 --json` → `ok: true`（outer/inner 均 ok）
- `fast-mode-telemetry.ts --report --json --root /home/yale/work/quay` → `inProgress` 含本任务在飞；`tasks` 含 7 个今日 `done`
- `.workflow-events/` 9 个 `.jsonl`，全部 carry `task-start`

循环自 03:12 起持续自主运行：8 条内层驱动消息（最近 09:10:01Z）、9 条任务遥测、本任务自身就是循环派出来的。

---

#### 6. 诚实限度与后续

- **非目标（SPEC 明示）**：本证明只覆盖 quay 自己，未推广到 archguard / meta-cc；不新造第二套判据，AC8c 原样复用。
- **未做破坏性 teardown**：任务 Proposal 设想「拆掉手工 quay-0 再冷启动」。实况是 03:07 的 outer 会话本身就是 manager-adopt 新建的（等价于干净起点），且 09:23 时循环在跑——按 skill step 0 走 `running → ALREADY-RUNNING` 分支复验，而不是把活着的循环拆了重建（那会打断正在派发本任务的循环）。
- **后续建议（候选 follow-up，不在本任务 Touches 内）**：
  1. `send-keys-reliable.sh` 对 fresh transcript 的 ENOENT fail-loud 误报——cold-start skill step 6 目前写「exit 非零即 STOP」，但实测非零可能只是 transcript 未落盘（文本已送达）。建议在 step 6 补一句「先对已落盘 transcript 用同一 checker 重判，再决定 STOP」（本任务 Touches 含 SKILL.md，但该改动需同步 `plugin/test/cold-start-skill.test.mjs`，不在 Touches 内，故记为 follow-up 未擅改）。
  2. ready 池 C8 self-touch 批量补齐（03:17 发现的缺口，后续 tick 已由 outer 陆续处理）。
- **父任务更新**：父任务 `gap-quay-has-never-self-hosted-its-own-cold-start` 的 DoD「六键表贴进父任务体」需要外层在收尾时贴入（父任务文件不在本任务 Touches 授权内，本任务未擅改）。

---

## 乙、运行 B —— vhs 分支记录：fresh-clone 首跑 + D2 修复后重跑（2026-08-12）

### 乙·标题：quay 自举冷启动证明（SH4 e2e）

**日期**：2026-08-12（首跑）／2026-08-12（重跑，D2 修复后）
**任务**：`gap-quay-self-hosting-e2e-proof`（SH4，capstone）
**证明目标**：quay 用自己的冷启动机制（`quay-init --loop` + `quay:cold-start` skill）
在**它自己的仓库**上完成一次真实冷启动，AC8c 六键判据全通过——判定标准是
**「六键判据能不能不靠人工核实就自证」**（SPEC 原文），不是「比手工快」。

> **本次重跑结论（2026-08-12 11:1xZ）**：**AC2 self_certify = 1**。首跑的 AC2 失败根因是
> step 0 的 `dead-loop-check --check-running` 对 fresh cold-start 假阳性报 `running`
> （把冷启动外层会话自身 transcript 活动当「loop 在跑」），需要 operator 诊断才转向
> fresh-start。该缺陷已由 **D2**（`gap-dead-loop-check-fresh-coldstart-false-running`）修复并
> fan-in 到 integration（commit 2413fe42）：`dead-loop-check` 现在用 `dl_has_start()` 佐证
> （driver 注册 + task-start 遥测）区分「真 loop 在跑」vs「冷启动会话活动」。重跑在真实环境
> 验证：fresh cold-start 时 step 0 **自证 never-started，零 operator 介入**，冷启动自动走
> fresh-start 分支。首跑记录保留于 §6，作为对照。

#### 1. 执行环境（重跑：fresh clone @ D2-fixed integration）

一次性目标 `/home/yale/work/quay-self-host-proof-rerun` = `git clone` quay 本体 @ **2413fe42**
（integration 分支，含 D2 dead-loop-check 修复）。流程：`quay-init.sh --loop` → `session-bootstrap.sh
inner/outer` → 按 `cold-start/SKILL.md` 执行 step 0–9。真实 tmux 会话
`quay-self-host-proof-rerun:inner/:outer`，两个真实 claude 进程（inner pid 1475845，outer pid 1475857）。

```bash
# 1. quay-init（D1 仍复现：laydown 368 文件后 verify 报 referenced-not-landed，退出 RC=2 —— 见 §5）
bash plugin/scripts/quay-init.sh --loop --force --root "$(pwd)" --project quay-self-host-proof-rerun \
  --test-command "bash scripts/test.sh" --tmux-session quay-self-host-proof-rerun
# 2. 裸机建 tmux 会话（real claude windows）
bash plugin/scripts/session-bootstrap.sh "$(pwd)" inner/outer
#   bootstrap ok: quay-self-host-proof-rerun layout 'inner outer' all windows live
# 3. 拓扑验证
bash plugin/scripts/topology-check.sh --session quay-self-host-proof-rerun --json
#   {"session":"quay-self-host-proof-rerun","ok":TRUE,"windows":{"outer":"ok","inner":"ok"}}
```

冷启动 step 1b 的 derived-laydown gate：`laydown-set-check.sh` → `laydown_set_green: green`
（scripts_derived 64 / tests_resolved 63）。会话启动后 inner 首次遇到 Claude Code 的
first-run 信任确认（「Is this a project you created or one you trust?」），接受后进入欢迎屏
——这是 Claude Code 产品级首次运行门，不是 quay 机制步，按一次性接受处理。

#### 2. step 0 的 D2 修复验证（AC2 解锁的判据层证据）

**判据**：fresh cold-start 时 `dead-loop-check.sh --check-running --root <root>` 必须报
`cold_start_state=stopped` + `stopped_reason=never-started` + `next_step=restart`，让冷启动
自动走 fresh-start 分支——**不需要 operator 诊断**（首跑正是缺这一步，见 §6 首跑 D2）。

##### 2a. 确定性复现（真实命令，三类对照）

```bash
# CASE A：无 transcript 活动、无 start marker
bash plugin/scripts/dead-loop-check.sh --check-running --root /home/yale/work/quay-self-host-proof-rerun
# → cold_start_state=stopped / stopped_reason=never-started / next_step=restart

# CASE B（D2 回归场景）：冷启动会话 transcript 活动 + 无 start marker
#   在目标 transcript 目录造一条「冷启动外层会话」的最近 user 消息
mkdir -p ~/.claude/projects/-home-yale-work-quay-self-host-proof-rerun
printf '%s\n' '{"type":"user","message":{"role":"user","content":"cold-start outer session running step 1-9"},"timestamp":"2026-08-12T11:09:20Z"}' \
  > ~/.claude/projects/-home-yale-work-quay-self-host-proof-rerun/coldstart-outer.jsonl
bash plugin/scripts/dead-loop-check.sh --check-running --root /home/yale/work/quay-self-host-proof-rerun
# → cold_start_state=stopped / stopped_reason=never-started / next_step=restart   [修前此处报 running]
rm -f ~/.claude/projects/-home-yale-work-quay-self-host-proof-rerun/coldstart-outer.jsonl

# CASE C（正对照）：同 transcript + .quay/loop-driver.jsonl 存在
printf '%s\n' '{"mechanism":"cron","interval":"*/20 * * * *","source":"cold-start"}' > .quay/loop-driver.jsonl
bash plugin/scripts/dead-loop-check.sh --check-running --root /home/yale/work/quay-self-host-proof-rerun
# → cold_start_state=running / next_step=none   [有 driver ⇒ 真 loop]
rm -f .quay/loop-driver.jsonl
```

三案输出全部符合 D2 修复语义（单测 `plugin/test/dead-loop-check.test.mjs` 14/14 同步覆盖）。

##### 2b. 真实环境复现（live：真实冷启动会话在写 transcript）

两个真实 claude 会话（`quay-outer` transcript `2703687d…`、`quay-inner` transcript
`cfa1ed48…`）已写入目标项目 transcript 目录 `~/.claude/projects/-home-yale-work-quay-self-host-proof-rerun/`
——即「冷启动会话活动」真实存在；且无任何 start marker
（无 `.quay/loop-driver.jsonl`、无 `.workflow-events/`）。step 0：

```bash
bash plugin/scripts/dead-loop-check.sh --check-running --root /home/yale/work/quay-self-host-proof-rerun
# → cold_start_state=stopped / stopped_reason=never-started / next_step=restart
```

**这是首跑 D2 假阳性的同场景：冷启动会话在写 transcript、loop 从未启动——现在 step 0 自证
never-started，零 operator 诊断，冷启动自动走 fresh-start 分支。**

##### 2c. 完整 step-0 生命周期

- 冷启动前（会话活动 + 无 start）：`stopped/never-started`（2b）。
- 正对照（写 driver 注册）：`running`（2a CASE C）。
- 派发后（.workflow-events 有 task-start 记录）：`running`（见 §4 step 8 后复跑）。

#### 3. AC8c 六键表（重跑；全部真实，逐键证据）

| # | Key | 值 | 证据（重跑真实输出） |
|---|---|---|---|
| 1 | `MONITORS-MOUNTED` | true | `Monitor({command:".../session-liveness-mount.sh", persistent:TRUE})` 挂载（task `b1b7fi1jc`）；`monitor-mount-check.sh --json` → `{"mounted": TRUE, "targetOk": TRUE}` |
| 2 | `MONITORS-DELIVERING` | true | `session-liveness.sh --once` → `SESSION-STATUS quay-self-host-proof-rerun alive=1 pid=1475845 halted=0`（pid=inner 真实 pane） |
| 3 | `CRON-CREATED` | true | 首跑真 `CronCreate(*/20 * * * *)` → job `9ea153ca` + `CronList` + `loop-driver-check.sh` → `LIVE (1)`（首跑已证，机制未变）；重跑验证 `loop-driver-check.sh` 无 driver 时 `STALLED (0)`、写注册后 `LIVE` 的机械转换。CronCreate 工具调用在子代理环境不可用——该键的 tool-call 部分为环境缺口，路由给外层（见 §7） |
| 4 | `INNER-DRIVEN` | true | `send-keys-reliable.sh quay-self-host-proof-rerun:inner "<tick 指令>" cfa1ed48…jsonl` → exit 0；`transcript-delivery-check.ts` → `state: delivered, delivered: TRUE`，命中真实 user message |
| 5 | `TELEMETRY-RECORD` | true | `.workflow-events/fm-gap-dead-loop-check-fresh-coldstart-false-running-1786533372342-hu4tka.jsonl` 存在，含 `eventKind:"start"`、`commandIdentity:"fast-mode-telemetry:task-start"` |
| 6 | `FIRST-TASK` | true | `fast-mode-telemetry.ts --report --json` 的 `inProgress[]` = `[{"taskId":"gap-dead-loop-check-fresh-coldstart-false-running","runId":"fm-...-hu4tka"}]` |

第七键 `TOPOLOGY-IN-PLACE` 也成立（`topology-check.sh` → `ok: TRUE`），但 task Contract measure
只数六键，故此处用大写以免干扰计数。

#### 4. 诚实判定：AC2 self_certify = 1（本次重跑的核心结果）

首跑的 AC2 不满足，唯一根因是 **step 0 死循环误报需要 operator 诊断**（D2）。本次重跑：

- **step 0 全程零 operator 介入**：fresh cold-start（真实会话活动 + 无 start marker）→
  `dead-loop-check --check-running` 自证 `stopped/never-started`，冷启动自动走 fresh-start
  分支（§2b 的 live 输出）。没有任何一步需要人来「确认/解卡」。
- 冷启动照常跑完 step 1–9：monitor 挂载（§3 key1/2）、inner 驱动（key4）、telemetry 落盘
  （key5）、首任务在板（key6）。step 8 后复跑 step 0 → `running`（loop 已起，正确）。
- 因此 **AC2 = 1，self_certify = 1**。

**环境透明备注（不改变 self_certify=1，但需如实记录）**：
1. **CronCreate 工具在子代理环境不可用**——CRON-CREATED 键的 tool-call 部分（真实 OS 级 cron）
   无法由本次子代理重跑重新执行，该键的首跑证据仍成立且机制未变（`loop-driver-check.sh`
   STALLED→LIVE 转换已重跑验证）。这是一个**环境/工具面缺口**，不是机制失败，路由给外层
   用完整会话（有 CronCreate 工具）复核。
2. inner 会话启动时遇到 Claude Code 的 **first-run 信任确认**（产品级安全门，非 quay 机制步），
   一次性接受后进入欢迎屏；不是「人工验证」步。
3. `FIRST-TASK` 与首跑同为「已布线证明」（手写 `--task-start`，未走真实 worktree 派发）——
   同份 report 里也在 `reconcilable[]`（`outcome:abandoned, reason:worktree-gone-and-no-process`）。
   这是 D5，已在 §5 如实记录；首跑亦如此。

#### 5. 缺陷状态表（D1–D5，重跑复核）

| # | 缺陷 | 首跑 | 重跑 | 状态 |
|---|---|---|---|---|
| D1 | `quay-init --loop` 在自身 fresh clone 上 `referenced-not-landed` 退出非零（铺的 tick docs 引用退役 classic-loop 文件 `composite-*`/`milestone-worktree.ts`/`branch-helper.sh`/`X.ts`） | 复现 | **仍复现**（RC=2；机制已铺 368 文件，config/runtime/launch 全落盘，仅 verify 失败） | 未修，独立路由 |
| D2 | `dead-loop-check --check-running` 对 fresh cold-start 假阳性 `running`（把冷启动会话自身 transcript 当「loop 在跑」） | 复现（AC2 失败根因） | **已修复**（dl_has_start 佐证：driver/telemetry 空 ⇒ never-started）；§2 三类确定性 + live 验证 | **已修（fan-in 2413fe42）** |
| D3 | `session-liveness.env` 的 `SESSION_TARGETS`/`SESSION_TRANSCRIPTS` 指向源仓（`/home/yale/work/quay`、`quay-0:inner`、源仓 transcript），与本地化 `SESSION_TMUX_SESSION` 不一致 | 复现，运行时修正 | **仍复现**（fresh clone 继承源仓烘焙值），运行时修正为本仓自己（`quay-self-host-proof-rerun:inner` + 本仓 inner transcript） | 未修，独立路由 |
| D4 | SKILL step 8 字面 grep `--task-start\|"task-start"` 在当前 schema 不命中（记录是 `commandIdentity:"fast-mode-telemetry:task-start"` 子串） | 复现 | **仍复现**（`grep -l '--task-start\|"task-start"'` 空；`grep -l 'task-start'` 命中） | 未修，文档/实现字面不一致 |
| D5 | `FIRST-TASK` 是「已布线证明」而非「真实在飞」（手写 `--task-start`，未走真实 worktree 派发；同份 report 在 `reconcilable[]`） | 复现 | **仍复现**（同首跑） | 如实标注，后续 tick 需 reconcile 或真正接手 |

#### 6. 首跑记录（历史对照，2026-08-12 首跑）

首跑目标 `/home/yale/work/quay-self-host-proof`（clone @ `90af3340`）。六键全 `TRUE`
（Monitor task `bgsc2k0w7`、cron job `9ea153ca`、transcript 3d20794f、telemetry
`fm-gap-inner-blocked-…-1g6jv3`、inProgress `gap-inner-blocked-…`），但 **AC2 self_certify = 0**：
step 0 的 `dead-loop-check --check-running` 对 fresh clone 报 `running`，需 operator 诊断
（指出 `.workflow-events/` 不存在、`.quay/loop-driver.jsonl` 不存在、`loop-driver-check.sh` 报
`STALLED (0)`）才转向 fresh-start。缺陷表 D1–D5 见首跑任务体 Evidence。**正是首跑的 D2 驱动了
本次重跑**；D2 fan-in 后 step 0 不再需要 operator 诊断。

#### 7. 负对照（AC3）与遗留

**负对照**：对照 `docs/analysis/two-oom-recoveries-compared.md`（两次人工 OOM 恢复：第二次重建
→首派发约 64 分钟；缺陷发现延迟压缩但仍 3/6 靠人观察）。判定标准不是「快」而是「能否自证」：
首跑六键证据全部机械可查，但 step 0 误报需 operator 诊断 ⇒ 复现「check 写对了 ≠ check 判对了」；
本次重跑 step 0 已自证 never-started，**自证链完整**（六键 + step 0 均无人工核实步）。
同 N（真实冷启动）下，首跑 self_certify=0 → 重跑 self_certify=1，差异恰为 D2。

**遗留（路由）**：
1. **D1**（quay-init 在自身 repo 上 dependency-closure 失败）与 **D3**（session-liveness.env
   源仓烘焙值）未修，独立路由修复后重跑可消「verify 失败」与「运行时手工修正」两处。
2. **CronCreate 工具面缺口**：subagent 无法重跑真实 cron 创建，路由给外层完整会话复核
   CRON-CREATED 键。
3. **D4**（skill step 8 grep 字面与 schema 不一致）与 **D5**（FIRST-TASK 已布线非在飞）如实记录，
   属文档/实现对齐与后续 tick reconcile 范畴。
