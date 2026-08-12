# quay 自托管冷启动收官证明（SH4 capstone）——quay 用自己的 `quay:cold-start` skill 在自身上跑通，七键全 true 自证，零 human-in-the-loop 验证步

**任务**: `gap-quay-self-hosting-e2e-proof`（`gap-quay-has-never-self-hosted-its-own-cold-start` 的 SH4 收官 child）
**日期**: 2026-08-12（本任务的实现 + 证据收集）
**前置**: 四个前置任务全部 `done`（pane-state 分类 / observer 单目标 / 冷启动恢复分支 / 裸机建会话），2026-08-12 核实

---

## 1. 运行事实：这次跑的是什么

**2026-08-12 03:07Z，outer 会话 `902b4528-…` 由 `manager-adopt` 新建**（无历史上下文的 fresh 会话——对应 `gap-no-formalized-bare-metal-session-bootstrap` 形式化的「可复现建会话」路径；`quay-0` tmux 拓扑 08-11 已存在，skill step 2 对既有拓扑做了验证而非重建），随即被指示「调用 quay-cold-start 技能，把循环拉起来」。这是规格所述「quay 从未在自身上跑过自己的 `quay:cold-start` skill」缺口的一次**真实验证**——不是手工恢复，不是「冷启动盖在已暖会话上」。

关键时间线（全部来自 outer 会话 transcript 的机械记录，`~/.claude/projects/-home-yale-work-quay/902b4528-….jsonl`）：

| 时间（Z） | 事件 |
|---|---|
| 03:07:52 | outer 会话被 manager-adopt 建出，收到「调用 quay-cold-start 技能」指令 |
| 03:07–03:12 | 跑 skill 前置（step 0 dead-loop-check、step 1b laydown-set 门）、建/验拓扑、挂 Monitor |
| 03:12:07–03:12:25 | 驱动 inner（step 6）：send-keys-reliable.sh 首投 `exit 1`（fresh transcript 未落盘的 ENOENT fail-loud），对**已落盘** transcript 用**同一 checker**（transcript-delivery-check.ts）重判 → `state: delivered, delivered: true`，matched_line 为真实 user 消息（ts 03:12:08） |
| 03:12:56 | 首个 `--task-start` 遥测落盘（`.workflow-events/fm-gap-quay-has-never-self-hosted-its-own-cold-start-1786504579122-0jhwr4.jsonl`） |
| 03:17:06–03:17:18 | outer 完成 step 8/9：七键全 `true` + `LOOP-STATE: cold_start_state=running`，附两条透明发现（都机械解决） |
| 03:22:20 | 20 分钟 cron 首次自主 tick 触发 outer（无人在场） |

**两条透明发现（均为机制层面，机械解决，未人介入——AC2 的诚实记录，不是悄悄抹平）**：

1. **ready 池 C8 self-touch 结构性缺口**：4 个 ready 任务全部 `## Touches` 缺自身文件（`self-touch-missing-c8`），`slot-refill` 判零可派发。outer 按 skill step 7「确保可派发」给首个任务补了 self-touch → 复核 `slot-refill: should_refill:true`。这是 ready-pool 派发机制的事，不是 cold-start skill 的判据缺口。
2. **send-keys-reliable.sh 首次 exit 1 是 ENOENT 误报**：fresh 内层 transcript 尚未落盘时 `--check` 对缺失文件 fail-loud；驱动文本实际已送达（transcript 随后落盘、inner 转 busy、同 checker 对已落盘文件重判 `delivered: true`）。这条在本任务中被落成本文的 skill 改进建议（见 §6）。

---

## 2. 六键表（任务 AC1 的六键，均 true，证据逐条 verbatim）

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

## 3. 现行清单第 7 键 `TOPOLOGY-IN-PLACE`（2026-08-06 增补，晚于本任务撰写）

同一运行中该键亦通过（不属任务六键，单列不混入 §2 计数）：

- 03:17 报告：`topology-check.sh --session quay-0 --json` → `ok: true`，outer/inner 两窗口均有 claude 进程。
- 09:23 复验：`{"session": "quay-0", "ok": true, "windows": {"outer": "ok", "inner": "ok"}}`。

---

## 4. 负对照：与 `docs/analysis/two-oom-recoveries-compared.md` 手工时间线对比

**判据（SPEC AC-SH4 明示）**：**不是「这次更快」**，而是 **「六键判据能不能不靠人工核实就自证」**。下表因此不把「快」当作结论项，只作为旁证。

| 维度 | 两次手工 OOM 恢复（two-oom-recoveries-compared.md） | 本次自动化冷启动（2026-08-12 03:07Z） |
|---|---|---|
| 会话从哪来 | 手工重建 tmux + 手敲会话 | outer 会话由 manager-adopt 新建（fresh、无历史；既有 quay-0 拓扑由 skill step 2 验证） |
| 恢复/启动流程 | 100% 手工：先读历史、写 AC、逐项手修 | 一条 skill 命令：`quay-cold-start` 走完整 0–9 步 |
| 验收判据 | 无统一 checklist，靠简报 + 人追问 | 同一份 AC8c 可证伪清单，七键逐条 `true` + 证据 |
| 缺陷发现→纠正 | 6 条缺陷里 **3 条靠人观察/追问触发**（外层越权、只跑一个任务等） | 2 条发现（C8 self-touch、ENOENT 误报）都**由机制自己暴露并机械解决**，session 内零人工 user 消息（仅 manager-adopt 引导 + cron tick） |
| 人介入次数 | 多次（人观察、人追问、人手动开 tmux） | **0 次验证性介入**；03:07–03:25 内该会话只有 manager-adopt 引导与 cron tick 两条非人工 user 消息 |
| 首次真派发前耗时 | 第二次恢复约 64 分钟（08:52→09:56）；第一次未精确记录（数小时级） | 03:07:52 建会话 → 03:12:56 首任务遥测落盘（约 5 分钟）；首个真实子 agent 派发随后续 tick 落地（旁证，不作判据） |

**结论**：手工恢复的判据是「人看着、人追问、人确认」；本次冷启动的判据是「清单自己报 true + 证据」，**六键（现行七键）全部由机制自证，无任何 human-in-the-loop 验证步**。这正是 SPEC 要求的自托管证明点。

---

## 5. 现行状态复验（2026-08-12 09:23，本任务执行时）

按 skill step 0 的 `cold_start_state=running` 分支（ALREADY-RUNNING），对现行循环复验七键仍 true（全部机械命令，命令+输出见 §2 各键「09:23 复验」列）：

- `monitor-mount-check.sh --json` → `mounted=true, targetOk=true`
- `session-liveness.sh --once` → `SESSION-STATUS quay alive=1 pid=4001662 halted=0`
- `loop-driver-check.sh /home/yale/work/quay` → `LIVE (1)`（exit 0）
- `topology-check.sh --session quay-0 --json` → `ok: true`（outer/inner 均 ok）
- `fast-mode-telemetry.ts --report --json --root /home/yale/work/quay` → `inProgress` 含本任务在飞；`tasks` 含 7 个今日 `done`
- `.workflow-events/` 9 个 `.jsonl`，全部 carry `task-start`

循环自 03:12 起持续自主运行：8 条内层驱动消息（最近 09:10:01Z）、9 条任务遥测、本任务自身就是循环派出来的。

---

## 6. 诚实限度与后续

- **非目标（SPEC 明示）**：本证明只覆盖 quay 自己，未推广到 archguard / meta-cc；不新造第二套判据，AC8c 原样复用。
- **未做破坏性 teardown**：任务 Proposal 设想「拆掉手工 quay-0 再冷启动」。实况是 03:07 的 outer 会话本身就是 manager-adopt 新建的（等价于干净起点），且 09:23 时循环在跑——按 skill step 0 走 `running → ALREADY-RUNNING` 分支复验，而不是把活着的循环拆了重建（那会打断正在派发本任务的循环）。
- **后续建议（候选 follow-up，不在本任务 Touches 内）**：
  1. `send-keys-reliable.sh` 对 fresh transcript 的 ENOENT fail-loud 误报——cold-start skill step 6 目前写「exit 非零即 STOP」，但实测非零可能只是 transcript 未落盘（文本已送达）。建议在 step 6 补一句「先对已落盘 transcript 用同一 checker 重判，再决定 STOP」（本任务 Touches 含 SKILL.md，但该改动需同步 `plugin/test/cold-start-skill.test.mjs`，不在 Touches 内，故记为 follow-up 未擅改）。
  2. ready 池 C8 self-touch 批量补齐（03:17 发现的缺口，后续 tick 已由 outer 陆续处理）。
- **父任务更新**：父任务 `gap-quay-has-never-self-hosted-its-own-cold-start` 的 DoD「六键表贴进父任务体」需要外层在收尾时贴入（父任务文件不在本任务 Touches 授权内，本任务未擅改）。
