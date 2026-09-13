---
id: gap-ac253-session-primitives-shared-layer-adoption
title: GOAL-017/AC-253：会话读写原语统一到共享层 ——
  四个模块（pty-frame/delivery-audit/session-liveness/session-schema）从 quay-fleet
  单一来源落入本仓库，且每个模块在本仓库有非测试消费者（SPEC 阶段 A3）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-253
---
## Proposal

**AC-253 立案当轮实测（取假形态）**：逐字跑 criterion ⇒ exit 1，报 `AC-253: shared primitive module(s) absent from this repo: pty-frame,delivery-audit,session-liveness,session-schema => stage A3 not landed`。四个模块在本仓库一个都没有（rglob `.ts/.mjs/.js`，排除 `node_modules` / `.claude/worktrees` / `.quay/` ⇒ 0 命中，四个 key 全空）。与 AC 记录的 expect 逐字一致。

**正本在哪（立案当轮实测）**：`/home/yale/work/quay-fleet/packages/agent-core/src/`（包名 `@quay-fleet/agent-core`）：

```
pty-frame.mjs          61 行  encodeFrame/encodeCtrl/encodeData/decodeFrames（部分帧返回 {frames, rest}）
delivery-audit.mjs    235 行  appendAuditRecord/summarizePayload/deliver/deliverKeys/recordStatusChangeObserved/readAuditTrail
session-liveness.mjs  146 行  readProcStat/localPidNamespace/isSamePidNamespace/isPidAlive/slugifyCwd/transcriptPathFor/readTranscriptMtime/readLastCommitAt/computeLiveness
session-schema.mjs     82 行  validateSessionRecord
```

零外部依赖（只 import `node:*`）；`delivery-audit.mjs` 内部 import `./pty-frame.mjs`。**fleet 侧四个文件最后改动 = `446ba9aa860833206945068c92ceac8d0064082b`（2026-09-13 14:47:32Z，"global sessionKey uses pidDomain+full sessionId (phase 2 cross-machine prep)"）；fleet HEAD = `b7c5d9c5`。⚠️ fleet 那份【今天还在动】⇒ 取用必须钉 SHA，⛔ 不能照 fleet 工作树拷一份（第二天即分叉）。**

**判据的「有消费者」那一半比 SPEC 意图弱，本任务自加逐模块控制**：criterion 的消费者检查是 `git grep -l -E "(pty-frame|delivery-audit|session-liveness|session-schema)" -- packages/quay/src plugin/scripts`，随后只要求结果**非空**。⇒ 四个名字里任意一个、在那两个目录里被任意非测试文件提到一次，判据即 exit 0：把四个模块拷进去、只 import 一个，机器判据照样绿，另外三个是 vendored 死代码。SPEC §3.3 的意图（GOAL 风险 3 逐字：「「有消费者」这一半是防伪」）是**每个模块都真被采用**。⇒ 本任务自加 AC3（4/4 逐模块消费者；⛔ 模块自己的头注释提到自己不算、兄弟模块 import 不算），与硬规则 4 推论三（只能被 fixture 满足的判据不是测量）同形。

**本仓库已存在的同一套手写实现（立案当轮逐文件实测 —— 这些是 adoption 目标，不是新功能）**：

- **session-liveness** 的三件事（`/proc/<pid>/stat` 第 22 字段 starttime、`kill(pid,0)`、transcript mtime）在本仓库有至少四份独立手写副本：`packages/quay/src/observation.ts:843-847 procStartTimeMs`（第 22 字段 + btime）、`:897 liveSessionIdForPid`（读 `~/.claude/sessions/<pid>.json`）、`:2284`（cmdline）；`plugin/scripts/peer-identity-probe.ts:51 parseProcStart` + `:66 buildPidDomain` + `:71 parsePidNamespaceLink` + `:244 readProcStart` + `:252 readPidDomain`（SPEC 的 A0 spike，同日落地）；`plugin/scripts/orphan-session-check.ts:153-167`（第 22 字段）、`:233` / `:251`（`kill(pid,0)`）；`plugin/scripts/supervisor-preempt-candidates.ts:135-137`（第三份第 22 字段解析）；`plugin/scripts/inner-blocked-signal.ts:697-704 transcriptHeartbeatMtimeMs`（transcript mtime + `subagents/` 目录）。
- **delivery-audit**：`packages/quay/src/serve-send.ts` 自带一条投递账（`DeliveryState = delivered|held|expired|error`:44、`MESSAGE_RECEIPTS_FILENAME = "message-receipts.jsonl"`:60、`sendSessionFrames`:77、`verifyTranscriptDelivery`:154、`appendMessageReceipt`:243、`readMessageReceipts`:254）；`plugin/scripts/transcript-delivery-check.ts` 与 `plugin/scripts/send-to-session.ts` 是投递判词与入口侧。fleet 模块把两条纪律结构化了：①成功与失败走**同一条写入路径** ②payload 只存 `{length,sha256_12,firstLine}` ⛔ 不落原文（"只记成功不叫审计"）——这正是本仓库现在缺的那条。
- **session-schema**：SPEC §6.7 逐字要求「状态词表三层不许折叠（`session.lifecycle` / `session.activity` / `task.status`），字段一律带层前缀，并由 `session-schema.mjs` 强制（出现顶层 `status` 即 invalid）」。本仓库现在的会话面是折叠的：`packages/quay/src/observation.ts:98 RunLiveness = "alive"|"orphan"|"unknown"`、`:1140`、`packages/quay/src/serve-sessions.ts` 的 `s.alive` 单值渲染。⇒ 消费者是把校验器用在**本仓库自己的会话记录输出边界**上。
- **pty-frame**：本仓库**没有**二进制帧消费者（立案当轮实测 `git grep "pty.sock\|bg-pty-host" -- packages/quay/src plugin/scripts` = **0 命中**）；唯一同形的是 `plugin/scripts/peer-identity-probe.ts:157 splitFrames(buffer) → {lines, rest}`——**文本**行帧的「部分帧 + 余量」纪律，不是 PTY 字节帧，⛔ 不能拿它冒充。⚠️ 这是本任务里唯一需要「造出真消费者」而非「替换手写副本」的模块，Plan 第 4 步给了具体 lane（fleet 已有实现，属阶段 A 的"合并已有实现"，⛔ 不是新功能）。

**单一来源纪律**：SPEC §3.3 逐字「唯一不可接受的是第二份手写实现」；GOAL 退出条件逐字「会话读写原语在本仓库只有一份（与 quay-fleet 共享）」。⇒ 落入本仓库的这一份必须是 fleet 那几个文件的**逐字节副本**（钉 SHA + 记 provenance），且 adoption 时**删掉被替换的手写副本**——⛔ 不是"新加一个 import、旧实现留着"（那反而是三份）。

**取用形态（SPEC §9 开放问题 4 仍未决，本任务必须选定并写下理由）**：候选 = 共享包 / vendored 复制 / fleet 发 npm 包。立案当轮实测两条硬约束：① `plugin/scripts/*.ts` 已大量 `import ../../packages/quay/src/*.ts`（实测 **38** 个文件），反向（`packages/quay/src` 的代码 import `plugin/scripts`）没有 ⇒ 把原语放在 `packages/quay/src/` 下**两个必需目录都能消费**，反过来不行；② `packages/quay` 是产品面、`plugin/` 是安装面（`plugin/vendor/{quay,quay-native}` 是本仓库自己 packages 的 dist 镜像），跨仓 npm 包需要发布/升级通道，SPEC 未授权。⇒ **默认落 `packages/quay/src/primitives/`（`.mjs` 逐字节副本 + provenance）**；若实现期发现 dist/vendor 打包（`packages/quay/test/build-plugin-dist.test.mjs`）把 `.mjs` 漏出产物，把该读数写进结果段并改选次优形态，⛔ 不得静默改成"在 plugin/scripts 下重写一份"。

**零新功能（阶段 A 硬边界）**：本任务不新造能力，只做两件事——把已有实现搬成单一来源、把已有手写副本换成它。⛔ 不改 driver 判定语义、⛔ 不动 web 路由行为（GOAL 风险 2 逐字：那一半由既有测试套件承担，本任务不假装判据覆盖了它）。

<!-- dedup-ref -->
**关联（仅登记，本任务不被它们收窄）**：`gap-ac251-unified-server-web-control-same-process`（ready）= web+control 合进程，动 `packages/quay/src/serve.ts`；`gap-ac252-control-plane-hoist-to-layer0`（ready）= `serveControlPlane` 上收 Layer 0，动 `driver-runtime.ts` / `worker-driver.ts`；`gap-quay-server-lightweight-peer-identity-spike`（done）= A0 spike，落了 `plugin/scripts/peer-identity-probe.ts`（本任务的 session-liveness 消费目标之一）。全仓 `goal_ac: AC-253` 命中 = 0（立案当轮实测），无重复立案。

## Plan

1. **定形态并把四个模块逐字节搬进本仓库（单一来源）**：在 `packages/quay/src/primitives/` 落 `pty-frame.mjs` / `delivery-audit.mjs` / `session-liveness.mjs` / `session-schema.mjs`，内容 = fleet `446ba9aa...` 的**逐字节**内容（⛔ 不改一个字节，含注释；`delivery-audit.mjs` 的 `import "./pty-frame.mjs"` 因同目录而天然成立）；另加 `primitives/PROVENANCE.md` 记 fleet 仓路径 + 钉住 SHA + 四个文件的 sha256。**取假控制**：落地后逐文件 `git hash-object` 与 `git -C /home/yale/work/quay-fleet show <SHA>:<path> | git hash-object --stdin` 比对，四个都相等才继续。

2. **跨仓漂移检测（两份副本的唯一机械防线）**：新增 `plugin/scripts/primitives-drift-check.ts`，manifest 里写钉住的 SHA + 四文件 sha256，逐字节校验本仓库副本。⚠️ 三态（硬规则 3b）：相等 ⇒ exit 0；不等 ⇒ exit 1（报哪个文件、两侧 sha256）；**fleet 仓不可达 / 该 SHA 取不到 ⇒ exit 3 + `NOT-EVALUATED`**，⛔ 不得判 PASS。仓内先例 `plugin/scripts/mirror-pair-drift-check.ts`（同族两副本纪律）。**新建 `plugin/scripts/*.ts` 的三处登记缺一不可**（capability-catalog 声明 + outline/runner-static-gate 注册 + laydown 表），Touches 里已列。

3. **session-liveness 的消费者（替换，不是新增）**：`packages/quay/src/observation.ts:843-847 procStartTimeMs` 与 `:897 liveSessionIdForPid` 改经 `primitives/session-liveness.mjs` 的 `readProcStat` / `transcriptPathFor`；`plugin/scripts/orphan-session-check.ts:153-167` 与 `plugin/scripts/supervisor-preempt-candidates.ts:135-137` 的第 22 字段解析副本删除、改用同一模块；`plugin/scripts/peer-identity-probe.ts` 的 `parseProcStart`/`buildPidDomain`/`parsePidNamespaceLink`/`readProcStart`/`readPidDomain` 改为薄 wrapper 或 re-export（⚠️ 该文件被 `plugin/test/peer-identity-probe.test.mjs` 覆盖，保持导出名不变）。**删除判据（取假控制）**：每个被删形态替换后跑一次 grep，命中数 = 0；逐 pattern 的**前后两个数**与前 3 条命中贴进结果段（硬规则 2）。

4. **pty-frame 的消费者（唯一条需要"造出真消费者"的）**：先按位置实测搜索现存字节帧消费者，命令与读数写进结果段（立案当轮 = 0 命中）。lane = **fleet 的 `deliverKeys`（`delivery-audit.mjs:128`，用 `encodeCtrl`/`encodeData` 走 pty.sock 的 DATA 帧）搬到本仓库已有的投递入口**：`plugin/scripts/send-to-session.ts`（已是"从非 Claude 进程给会话发消息"的入口）或 `packages/quay/src/serve-send.ts`（web 发送入口与脚本共用的同一实现）。这是合并 fleet 已有实现，⛔ 不是新写；且它落在 CLAUDE.md 已记为**不可替代用途**的缺口上（"控制面——`/clear` 等斜杠命令原生通道办不到…只能走 tmux 输入"；手搓 tmux send-keys 在本仓库明令禁止）。⚠️ 若实现期判定该 lane 越出阶段 A 的"零新功能"边界，必须把该判定与实测依据写进结果段，并给出一个**仍满足 AC3 的替代消费者**（例如把 `decodeFrames` 的「部分帧不抛」用在某个现存的流式读取边界上）；⛔ 不得用「模块自己提到自己」或「兄弟模块 import 它」凑数（AC3 逐字排除）。

5. **delivery-audit 的消费者**：`packages/quay/src/serve-send.ts` 的投递账改用 `appendAuditRecord` / `summarizePayload` / `readAuditTrail`（⛔ 不再自己拼 journal 行、不再自己算 payload 摘要），失败路径与成功路径走**同一条写入**（该模块存在的理由逐字："只记成功不叫审计"）；`plugin/scripts/transcript-delivery-check.ts` 的判词面与 `readAuditTrail` 重合则对接。⚠️ **零回退**：`packages/quay/test/serve-send*.test.mjs` 与 message-receipts 相关测试必须继续绿；若 journal **文件格式**变化会破坏既有读者，则保留格式、只换实现（决定写进结果段）。

6. **session-schema 的消费者**：在本仓库会话记录的**输出边界**接 `validateSessionRecord` —— `packages/quay/src/observation.ts` / `serve-sessions.ts` 那条 `alive` / `RunLiveness` 单值面按 SPEC §6.7 的层前缀（`session.lifecycle` / `session.activity`）输出，并在输出前自校验（出现折叠的顶层 `status` 即拒绝渲染，而不是渲染一个折叠值）。⚠️ 这是唯一可能改动**用户可见读数形态**的一步：若实现期判定改名会破坏既有 web 契约/测试，则保留既有字段、把校验器用在**生成侧**（记录里落带层前缀的对象，渲染时再投影），理由写进结果段。**负控制见 AC5**。

7. **零回退 + 新测试**：新增 `plugin/test/session-primitives-adoption.test.mjs`（逐模块断言：四个模块各被哪个非测试文件 import、被替换的手写副本命中数 = 0、与 fleet SHA 逐字节相等、折叠记录负控制）；新增 `plugin/test/primitives-drift-check.test.mjs`（三态，含 fleet 不可达 ⇒ exit 3 的那一态）。回归面至少 `packages/quay/test/observation.test.mjs`、`packages/quay/test/serve-send*.test.mjs`、`packages/quay/test/serve-sessions*.test.mjs`、`plugin/test/peer-identity-probe.test.mjs`、`plugin/test/orphan-session-check.test.mjs`、`plugin/test/build-plugin-dist.test.mjs` 全绿；**全量套件由 fan-in 承担**（⛔ 不在本任务里跑全量）。⚠️ 若 `packages/quay/src/*.ts` 的改动使 `plugin/vendor/quay/dist` 或 `packages/quay/plugin/scripts/dist/**` 的产物字节变化，按 anti-drift 两副本纪律一并重建、声明并提交（⛔ 漏声明会红 anti-drift-touches-check）。

8. **真落地（生产载体，硬规则 4 推论三）**：实现落地**之后**在真实路径取一次读数——`quay serve` 的 sessions 面（走 session-liveness + session-schema 的消费者）与一次真实投递（走 delivery-audit），把 ①读数时刻 ②该路径命中的共享模块名 ③`primitives-drift-check` 的读数贴进结果段。⛔ 只在单测夹具里跑过不算。

## Touches

- `packages/quay/src/primitives/pty-frame.mjs` (new)（fleet `446ba9aa` 逐字节副本）
- `packages/quay/src/primitives/delivery-audit.mjs` (new)（同上）
- `packages/quay/src/primitives/session-liveness.mjs` (new)（同上）
- `packages/quay/src/primitives/session-schema.mjs` (new)（同上）
- `packages/quay/src/primitives/PROVENANCE.md` (new)（fleet 路径 + 钉住 SHA + 四文件 sha256）
- `packages/quay/src/observation.ts`（`:843-847` / `:897` / `:98` / `:1140` 的 session-liveness 与 session-schema 消费点）
- `packages/quay/src/serve-send.ts`（delivery-audit 消费点 + pty-frame lane 之一）
- `packages/quay/src/serve-sessions.ts`（session-schema 输出边界）
- `plugin/scripts/orphan-session-check.ts`（删第 22 字段 + `kill(pid,0)` 副本，改共享模块）
- `plugin/scripts/supervisor-preempt-candidates.ts`（删第三份第 22 字段副本）
- `plugin/scripts/peer-identity-probe.ts`（改为薄 wrapper / re-export，导出名不变）
- `plugin/scripts/inner-blocked-signal.ts`（transcript mtime + `subagents/` 解析改共享模块）
- `plugin/scripts/transcript-delivery-check.ts`（delivery-audit 判词面）
- `plugin/scripts/send-to-session.ts`（pty-frame / deliverKeys lane 的另一候选入口）
- `plugin/scripts/primitives-drift-check.ts` (new) + 其 capability-catalog 声明 + outline/runner-static-gate 注册 + laydown 表三处登记
- `plugin/test/session-primitives-adoption.test.mjs` (new)（逐模块消费者 + 手写副本归零 + fleet SHA 比对 + 折叠记录负控制）
- `plugin/test/primitives-drift-check.test.mjs` (new)（三态，含 exit 3 NOT-EVALUATED）
- `plugin/vendor/quay/dist/`（若构建产物字节变化则一并声明与提交；具体文件以构建输出清单为准）
- `tasks/gap-ac253-session-primitives-shared-layer-adoption.md`（自身文件：勾 AC + 贴实跑证据）

## AC

- [ ] AC1: 在 repo root 逐字跑 `goals/AC-253-会话读写原语统一到共享层-四个模块在本仓库可用且有非测试消费者-spec-阶段-a3.md` 的 criterion ⇒ **exit 0**（立案当轮实测 exit 1，报四个模块全缺）。改前/改后两条读数 + 两条命令原文都贴进结果段。去掉 `packages/quay/src/primitives/` 后必须转回 exit 1（负控制，两条读数都贴）。
- [ ] AC2: **单一来源 + 逐字节**：四个模块落 `packages/quay/src/primitives/{pty-frame,delivery-audit,session-liveness,session-schema}.mjs`；逐文件 `git hash-object` == fleet `446ba9aa...` 对应 blob 的 hash（四组数值贴进结果段）；provenance（fleet 路径 + SHA）在文件头或 `primitives/PROVENANCE.md`。**取假控制**：`primitives-drift-check` 在"改一个字节"时必须 exit 1（那次负控制输出也贴），fleet 不可达/取不到该 SHA 时必须 exit 3 + `NOT-EVALUATED`（⛔ 不判 PASS）。
- [ ] AC3: **4/4 逐模块非测试消费者（⛔ 强于机器判据的"任一非空"）**：四个模块**每一个**都列出 ≥1 个 `packages/quay/src` 或 `plugin/scripts` 下的**非测试**文件，且该文件**import 该模块**（贴 import 行 + file:line）；并给出**被它替换掉的手写副本的 file:line 与替换后命中数 = 0**；pty-frame 若走 Plan 第 4 步 lane，额外贴该 lane 的实测搜索读数与实现出处。⛔ 不算消费者：模块自己的头注释提到自己；兄弟模块（`delivery-audit.mjs` import `pty-frame.mjs`）import 它 —— "真被采用"指本仓库产品/脚本代码在用。
- [ ] AC4: **零回退**：`node --test packages/quay/test/observation.test.mjs`、`packages/quay/test/serve-send*.test.mjs`、`packages/quay/test/serve-sessions*.test.mjs`、`plugin/test/peer-identity-probe.test.mjs`、`plugin/test/orphan-session-check.test.mjs`、`plugin/test/build-plugin-dist.test.mjs` 全绿（逐条命令与尾部读数贴进结果段）；新增 `plugin/test/session-primitives-adoption.test.mjs` 与 `plugin/test/primitives-drift-check.test.mjs` 全绿。
- [ ] AC5: **负控制：折叠记录被拒**：把 `session-schema.mjs` 的 AC-001 反例搬成一条**本仓库**的测试——构造 `{status: "busy", ...}` 折叠记录 ⇒ `valid:false` 且 errors 提到折叠；去掉顶层 `status`、把 `lifecycle`/`activity` 两维对象补齐 ⇒ `valid:true`。两条输出都贴进结果段（只有正例的测试是恒真，硬规则 4）。
- [ ] AC6: **生产载体真跑过（硬规则 4 推论三）**：实现落地时刻**之后**，在真实运行路径取一次读数（`quay serve` 的 sessions 面 / 一次真实投递 / `primitives-drift-check` 的 exit 0），三条读数均晚于落地时刻。⛔ 只在夹具里跑过不算 —— 该模块的三个既有 AC 也都是这个形态。

## DoD

**真 landed 的判据是「四个原语在本仓库只有一份、且这一份真被本仓库的代码在用」，不是「criterion exit 0」**：`packages/quay/src/primitives/` 下四个文件逐字节等于 fleet 钉住的 SHA（AC2，含漂移检查的三态）；每个模块各有一个非测试消费者在 import 它、且被替换的手写副本命中数归零（AC3）；折叠记录的负控制真的被拒（AC5）；在**这个状态上** AC-253 的 criterion 逐字 exit 0，移走 `primitives/` 则转 exit 1（负控制，两条读数都贴）。

⛔ 不接受的替代物：把四个文件拷进来只 import 一个（机器判据绿、另外三个是 vendored 死代码 —— 正是判据"有消费者"那一半要防的形态）；**手写第二份实现**（SPEC §3.3 逐字"唯一不可接受"）；"新加 import、旧手写副本留着"（三份）；用模块自己的头注释或兄弟模块的 import 冒充消费者；跨仓漂移检查在 fleet 不可达时判 PASS（硬规则 3b：读不懂输入却返回与合格同形）；照抄 fleet 工作树而不是钉 SHA（fleet 份今天还在动，第二天即分叉）；只在单测夹具里跑过。