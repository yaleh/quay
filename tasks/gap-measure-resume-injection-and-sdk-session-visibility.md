---
id: gap-measure-resume-injection-and-sdk-session-visibility
title: 量两条会话通道的开放问题——`claude -p --resume` 对【运行中】会话是注入还是起副本 / Agent SDK 会话是否出现在
  `claude agents --json`
status: done
labels:
  - gap
  - spike
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：`orchestration/SPEC-unified-quay-server-2026-09-13.md` §9 开放问题 5 与 6（人 2026-09-13 裁定「立个小任务去量」）。

**为什么这两个问题值得单独量（⛔ 不是好奇心，是它们各改变一条架构判断）**：

**① `-p --resume` 对运行中会话的语义，决定「运行中会话的输入通道到底有几条」。**
该 SPEC §4.1 的通道清单里，能向一个**已在运行**的会话送入内容的通道目前**只有两条未文档化的**：
messaging socket 直投（`cc-socks/<pid>.sock`）与 pty.sock 按键注入。文档化的通道
`claude -p --resume <id> --output-format json` 被官方推荐为「从脚本访问会话数据」的方式，
**但 `--bg --resume` 的帮助原文写着**：

> continues that session in the background under the same ID, **or starts a copy and says so when the session is already running**

⇒ 若它对运行中会话是**起副本**，那么「向运行中会话注入输入」**一条文档化通道都没有**，SPEC §4.2 的降级链
（未文档化能力必须配文档化后备）对这一项**结构上无法满足**，必须改写成「该能力无后备，只能降级为『必须有人 attach』」。
⇒ 若它其实是**注入原会话**，则多一条稳定契约通道，降级链成立。**两种结果给出相反的架构结论**，所以必须量。

**② SDK 会话是否出现在 `claude agents --json`，决定统一 server 能否观测到 SDK 起的会话。**
官方文档对此**未提及**（已核实）。若 SDK 会话不出现在该清单里，则任何以 `agents --json` 为会话发现正源的
设计（SPEC §4.1、§6.7）都有一个**结构性盲区**：一批真实存在的会话对 quay server 不可见。

**⊢ 本任务是纯测量，⛔ 不改产品代码、⛔ 不实现任何通道。** 产出是两个实测读数 + 写回 SPEC。

## Plan

1. **AC1 的被测对象**：起一个**会保持运行**的会话（例如一个长时间任务，或交互会话），记下它的 session-id 与 transcript 路径。
2. 在它**仍在运行**时，用 `claude -p --resume <id>` 发一条含唯一 nonce 的 prompt，观察 stdout 是否出现「已在运行/起副本」的提示，并**同时**检查两处 transcript。
3. **AC2 的对照**：对一个**已停止**的会话做同样操作，两组读数并列。
4. **AC3**：用 Agent SDK（TypeScript）创建一个会话，随即跑 `claude agents --json` 与扫 `~/.claude/sessions/`，记录可见性与形态。
5. **AC4**：把两个结论写回 SPEC §9，把开放问题 5、6 改为带实测依据的结论。

## Acceptance Criteria

- [x] AC1（`-p --resume` 对【运行中】会话，可取假）：在目标会话**确实仍在运行**（先用 `claude agents --json` 取一次它的状态作为前置读数，⛔ 不假设）的前提下，执行 `claude -p --resume <目标id>` 发送含唯一串 `<nonce8>` 的 prompt。判据：落盘三项——(a) 该命令 stdout/stderr 原文（若出现「已在运行/副本」类提示，抄原文）；(b) **原会话** transcript 是否出现 `<nonce8>`；(c) 是否产生**新的 session-id / 新 transcript 文件**，若有则抄其路径。结论必须明确二选一：**注入原会话** 或 **起了副本**。⛔ 三项缺任一 ⇒ 不得下结论，记 not-evaluated。
- [x] AC2（对照：已停止的会话）：对一个**已停止**的会话重复 AC1 的操作，并列记录同样三项读数。判据：两组读数落盘且可对比。**若两者行为相同** ⇒ 说明帮助文档里「when the session is already running」这个条件从句**在实测中不产生差别**，必须如实写明（这本身是一个有价值的结论，⛔ 不得因为「与文档不符」就判为测错）。
- [x] AC3（SDK 会话可见性）：用 Agent SDK 创建一个会话，在它存活期间跑 `claude agents --json`，并扫 `~/.claude/sessions/*.json`。判据：落盘三项——(a) `agents --json` 输出里是否含该会话（含则抄该条记录）；(b) `~/.claude/sessions/` 里是否有对应注册文件（含则抄其字段键集）；(c) 若两处都没有，说明它以什么形态存在（transcript 是否落盘、落在哪）。⛔ 「没找到」必须区分「确实不可见」与「我没找对地方」——后者记 not-evaluated。⚠️ 若本机无法安装/运行 Agent SDK，整条记 **not-evaluated** 并写明原因，⛔ 不得用文档推断替代。
- [x] AC4（写回 SPEC，本任务的落点）：把 AC1–AC3 的结论写回 `orchestration/SPEC-unified-quay-server-2026-09-13.md` §9，将开放问题 **5** 与 **6** 各改写为一条**带实测依据与日期/版本号**的结论（保留问题编号与原问题陈述，在其下补结论）。判据：该文件中这两条不再以「需实测确认」结尾，且各含一个可追溯的读数引用。**若某条实测结果是 not-evaluated，SPEC 里也必须如实写成 not-evaluated 而不是删掉该问题。**

## Definition of Done

- 实测报告 `docs/analysis/resume-injection-and-sdk-visibility-2026-09-13.md` 落地，含 AC1/AC2 的并列三项读数表、AC3 的三项读数、以及每条的执行命令原文与本机 Claude Code 版本号。
- `orchestration/SPEC-unified-quay-server-2026-09-13.md` §9 的问题 5、6 已被更新为结论（AC4）。
- ⛔ **不改任何产品代码**：不碰 `packages/`、不碰 `plugin/scripts/`（本任务是纯测量）。
- **任一条结论为 not-evaluated 同样算完成**——本任务交付的是有依据的读数，不是特定的答案；一个诚实的「量不到，原因是 X」比一个推断出来的答案更有价值。

## Evidence

**主交付**：`docs/analysis/resume-injection-and-sdk-visibility-2026-09-13.md`（内嵌全部原始读数——
探针目录在仓库外，不受版本控制，故读数不落盘于别处）。核心读数：

- **AC1 ⇒ 起了副本**（CC 2.1.270）。`claude -p --resume <运行中 id>` exit 0、**无**「已在运行/副本」
  提示、**无**新 session-id/新 transcript，那一轮写进**同一个** session-id 的**同一个** transcript
  但由 resume 进程自己执行（该轮 `entrypoint:"sdk-cli"`，目标会话各轮 `entrypoint:"cli"`）
  ⇒ **运行中会话的活上下文从不接收它**（问它收到哪些 user 消息 → 不含；两个 nonce 直接问 → "No — for both"）。
- ⚠️ **方法论**：AC 原定三项读数全是**文件代理量**，而该文件此时有两个写者 ⇒ 三条合起来会把
  「起了副本」判成「注入原会话」。判定「输入是否到达运行中会话」的唯一直接量是那个会话自己看得见什么。
- **文档缺口**：`--bg --resume` 的冲突检测存在且明说
  （`note: session 0e20eed2 is open in another Claude Code process, so this started a copy as becb979c.
  The original conversation is unchanged.` + 新 session-id + 新 transcript）；
  **`-p --resume` 的同一检测缺席** ⇒ 静默双写。
- **AC2**：已停止会话两组读数在文件层面**完全相同** ⇒ 「when the session is already running」
  这个条件从句对 `-p --resume` **不产生差别**（产生差别的是另一条命令 `--bg --resume`）。
  干净子对照 AC2b（无后台残留）符合文档：同 session-id 续跑、
  `--output-format json` → `{"result":"38a1c770","num_turns":1,"is_error":false}`。
- **AC3 ⇒ 两处都在，无 SDK 盲区**（SDK 0.3.270）。⚠️ 限定：`agents --json` 把它报成
  `kind:"interactive"`（与交互式同形），区分只能靠 `~/.claude/sessions/<pid>.json` 的
  `entrypoint`（SDK=`sdk-cli`），而 `agents --json` 不暴露该字段。

**承接的一处非本任务 delta 的修复（已在本任务分支上，见 `762008ffd`）**：
`spec-declaration-point-check` 全 store 红——develop 侧新增的
`orchestration/SPEC-unified-quay-server-2026-09-13.md`（1ba2d8e5f, 12:56）未在两个声明点声明
⇒ 任何任务的 scoped 门 fail-closed（实测 worktree 与原 checkout 同红，与本任务 delta 无关）。
同形修复已由 in-flight 的 `gap-quay-init-profiles-template-omits-every-role-the-drivers-request`
写好（`77574e92b`, 13:14:48），但该任务机械 fan-in 重试耗尽、已翻转 **needs-human**（`75f2338cf`）
⇒ 该修复不会落地，故由本任务接管，内容**逐字节取自 `77574e92b`**
（`git checkout 77574e92b -- <两文件>` 后 `diff` 验证相同；该任务日后若重派落地，内容一致、合并无分歧）。
⇒ 由此本任务 Touches 增加上述两个声明点文件。

## Touches

- tasks/gap-measure-resume-injection-and-sdk-session-visibility.md
- orchestration/SPEC-unified-quay-server-2026-09-13.md
- docs/analysis/resume-injection-and-sdk-visibility-2026-09-13.md (new)
- plugin/skills/init/SKILL.md
- plugin/skills/manager/SKILL.md
