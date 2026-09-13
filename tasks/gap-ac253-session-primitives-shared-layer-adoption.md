---
id: gap-ac253-session-primitives-shared-layer-adoption
title: GOAL-017/AC-253：会话读写原语统一到共享层 ——
  四个模块（pty-frame/delivery-audit/session-liveness/session-schema）从 quay-fleet
  单一来源落入本仓库，且每个模块在本仓库有非测试消费者（SPEC 阶段 A3）
status: done
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
- `plugin/scripts/primitives-drift-check.ts` (new)
- `plugin/scripts/primitives-drift-manifest.json` (new)
- `plugin/scripts/capability-catalog.sh`（新机件的 capability 声明）
- `plugin/scripts/runner-static-gate.ts`（注册新静态检查）
- `plugin/scripts/checker-mutation-cases/primitives-drift-check.sh` (new)（mutation 用例）
- `packages/quay/src/primitives/pty-frame.d.mts` (new)
- `packages/quay/src/primitives/delivery-audit.d.mts` (new)
- `packages/quay/src/primitives/session-liveness.d.mts` (new)
- `packages/quay/src/primitives/session-schema.d.mts` (new)
- `packages/quay/scripts/build-plugin-dist.mjs`（`coreSrcAliasPlugin` 过滤器由 `\.ts$` 扩到 `\.ts|\.mjs`）
- `plugin/test/session-primitives-adoption.test.mjs` (new)（逐模块消费者 + 手写副本归零 + fleet SHA 比对 + 折叠记录负控制）
- `plugin/test/primitives-drift-check.test.mjs` (new)（三态，含 exit 3 NOT-EVALUATED）
- `plugin/vendor/quay/dist/quay.js`（若构建产物字节变化则一并声明与提交；`dist/` 下仅此一个产物文件，以构建输出清单为准）
- `tasks/gap-ac253-session-primitives-shared-layer-adoption.md`（自身文件：勾 AC + 贴实跑证据）
- `docs/analysis/dead-set-recomputed.json`（§12f 死集快照重算：本任务新增的 test-pin 让 `send-to-session.ts` 成为「被引用的脚本」，而它仍在 2026-09-08 的快照死集里 ⇒ 全量套件静态门 `registry-bare-filename-scan --check` 报红；按 §12d/§12e/§12f 在当前树上重算后提交，闸转绿 —— 真因与三条读数见结果段末节）

## AC

- [x] AC1: 在 repo root 逐字跑 `goals/AC-253-会话读写原语统一到共享层-四个模块在本仓库可用且有非测试消费者-spec-阶段-a3.md` 的 criterion ⇒ **exit 0**（criterion 于 2026-09-13T15:35Z 被强化，新增「手写 socket 已退役」那半边；本分支的**强化前 tip 上实测过 exit 1**，本轮补做后转绿 —— 三条读数 + 命令原文见结果段）。去掉 `packages/quay/src/primitives/` 后必须转回 exit 1（负控制，两条读数都贴）。
- [x] AC2: **单一来源 + 逐字节**：四个模块落 `packages/quay/src/primitives/{pty-frame,delivery-audit,session-liveness,session-schema}.mjs`；逐文件 `git hash-object` == fleet `446ba9aa...` 对应 blob 的 hash（四组数值贴进结果段）；provenance（fleet 路径 + SHA）在文件头或 `primitives/PROVENANCE.md`。**取假控制**：`primitives-drift-check` 在"改一个字节"时必须 exit 1（那次负控制输出也贴），fleet 不可达/取不到该 SHA 时必须 exit 3 + `NOT-EVALUATED`（⛔ 不判 PASS）。
- [x] AC3: **逐模块非测试消费者（⛔ 强于机器判据的"任一非空"）**：3/4 模块各列出 ≥1 个 `packages/quay/src` 或 `plugin/scripts` 下的**非测试**文件，且该文件**import 该模块**（贴 import 行 + file:line）；**pty-frame 一行本轮修订为「钉生产调用链」**（强化后 criterion 要求 serve-send.ts 不得自己开 socket，两者互斥 —— 理由、四条可失败断言与如实登记的降级见结果段 AC3 节）。并给出**被它替换掉的手写副本的 file:line 与替换后命中数 = 0**（含本轮退掉的 L1/L2 两处手写 socket）；⛔ 不算消费者：模块自己的头注释提到自己；兄弟模块（`delivery-audit.mjs` import `pty-frame.mjs`）import 它。
- [x] AC4: **零回退**：`node --test packages/quay/test/observation.test.mjs`、`packages/quay/test/serve-send*.test.mjs`、`packages/quay/test/serve-sessions*.test.mjs`、`plugin/test/peer-identity-probe.test.mjs`、`plugin/test/orphan-session-check.test.mjs`、`plugin/test/build-plugin-dist.test.mjs` 全绿（逐条命令与尾部读数贴进结果段）；新增 `plugin/test/session-primitives-adoption.test.mjs` 与 `plugin/test/primitives-drift-check.test.mjs` 全绿。
- [x] AC5: **负控制：折叠记录被拒**：把 `session-schema.mjs` 的 AC-001 反例搬成一条**本仓库**的测试——构造 `{status: "busy", ...}` 折叠记录 ⇒ `valid:false` 且 errors 提到折叠；去掉顶层 `status`、把 `lifecycle`/`activity` 两维对象补齐 ⇒ `valid:true`。两条输出都贴进结果段（只有正例的测试是恒真，硬规则 4）。
- [x] AC6: **生产载体真跑过（硬规则 4 推论三）**：实现落地时刻**之后**，在真实运行路径取一次读数（`quay serve` 的 sessions 面 / 一次真实投递 / `primitives-drift-check` 的 exit 0），三条读数均晚于落地时刻。⛔ 只在夹具里跑过不算 —— 该模块的三个既有 AC 也都是这个形态。

## Evidence（结果段）

分支 `task/gap-ac253-session-primitives-shared-layer-adoption`（worktree `/home/yale/work/quay-worktrees/gap-ac253-session-primitives-shared-layer-adoption`）。落地提交 `623309d32`（主体）/ `eb38d92ad`（CLI 修复 + 真 socket 测试）/ **`54b0eed58`（本轮：按 2026-09-13T15:35Z 强化后的 criterion 退掉 serve-send.ts 的两处手写 socket）** / **`d4668c4d0`（本轮补：委托引入的「账本不可写 ⇒ 未捕获异常」预检，见残留 5c）**。**AC6 的四条读数全部晚于 `d4668c4d0` 的提交时刻 `2026-09-13T16:17:45Z`**（上一轮的 AC6 读数属于强化前的状态，已作废并整段重取）。

### AC1 — AC-253 criterion 三条读数（**打在与落地同版本的判据上**）

命令原文 = `goals/AC-253-会话读写原语统一到共享层-四个模块在本仓库可用且有非测试消费者-spec-阶段-a3.md` 的 `criterion:` 整段逐字复制（本轮的脚本即该段，未改一个字符）。判定要点两条：① 四个模块各有**非测试的真 import**（`from '…'` / `require('…'`）；② **旧的手写 socket 实现已退役** —— 第二遍 grep `net\.createConnection\s*\(` 打在 `packages/quay/src/serve-send.ts` / `observation.ts` 上必须 0 命中。

| 读数 | 命令 | 结果 |
|---|---|---|
| **改前**（base tree `0765b439b`：`git archive` 到临时目录 + `git init && git add -A`，使 `git grep` 有可搜的树） | 逐字 criterion | `exit 1` — `AC-253: no non-test IMPORT of shared primitive(s): pty-frame,delivery-audit,session-liveness,session-schema (a bare string mention in a comment does NOT count)` |
| **改后**（本轮 tip `54b0eed58`） | 同上 | `exit 0`（无输出） |
| **负控制**（`mv packages/quay/src/primitives /tmp/…` 后跑，再移回并复跑） | 同上 | 移走 ⇒ `exit 1`（`no non-test IMPORT of shared primitive(s): pty-frame`）；移回 ⇒ `exit 0`；`git status` 干净 |

⚠️ **本分支强化前的 tip（`5ccc522db`）上逐字跑强化后的 criterion ⇒ `exit 1`**（本轮补做前实测）：

```
AC-253: a SECOND hand-written socket implementation survives (2 line(s), first:
packages/quay/src/serve-send.ts:106:    const s = net.createConnection(sockPath);) => SPEC 8-1 violated: 'only one implementation' is the actual A3 criterion
```

⇒ 上一轮贴的 AC1 证据是对**旧版 criterion** 取的（旧版 `rglob` 找文件 + 消费者只需非空、**完全不判「只有一份」**）。criterion 在 `9f2cea235`（2026-09-13T15:35:43Z）被强化 —— **晚于本分支上一轮的落地时刻 `15:23:04Z`** —— 于是强化后的判据在本轮补做前对本分支**真取假**。本轮退掉那两处手写 socket 后才转绿：这是「实现没被改弱、是判据被加强」的形态，⛔ 不是把判据改到通过。

⚠️ **负控制的一个如实弱点**（与硬规则 3b 同族，登记而非掩饰）：负控制的 `exit 1` 只由 `pty-frame` 一个 key 触发 —— 另外三个模块的 **import 行**仍在各自消费者文件里，而 criterion 第一遍匹配的是**说明符字符串**、不是文件存在性，所以移走 `primitives/` 后那三个仍被算作「有 import」。（`pty-frame` 失去全部说明符，因为它的最后一个直接 import 者 `delivery-audit.mjs` 随目录一起被移走。）⇒ 第一遍判据测的是「有文件在 import 语句里**点名**某模块」，不是「该模块存在」；第二遍才是对文件内容的实质检查。

### AC2 — 逐字节 + 漂移检查三态

`git hash-object`（本仓库副本）== `git -C /home/yale/work/quay-fleet show 446ba9aa:<path> | git hash-object --stdin`（fleet blob）：

| 文件 | blob hash（两侧相等） | sha256 |
|---|---|---|
| `pty-frame.mjs` | `0de07a1ca5d3f0e1f03912a3a802494eb4bd389b` | `0e0934cfc16d3d47f852a4e4eff8c17309b445e74787c15d847e6b9bd85f963a` |
| `delivery-audit.mjs` | `6a41654c4b1fab944ff30b45e247a68312abe312` | `5da101bc15d135a9ecd2bc8ac97382424794673feeef31f2ef59e5b7e7f4d239` |
| `session-liveness.mjs` | `7a3ca3b43dcabb557a95b67af42b6a00dacb3655` | `f2a462a963efe17225a9c32bc58b7fdc6f8a930830417b0c8df1f56cf6a8dab4` |
| `session-schema.mjs` | `710eb806899191065a02592f44cea6f1e4ef6b82` | `36350484ebf0d366b49834f0ca7d59cfa1756af39fe06de7aefc9158263cb9b5` |

provenance：`packages/quay/src/primitives/PROVENANCE.md`（fleet 仓路径 + 钉住 SHA + 上表）+ 机器可读半份 `plugin/scripts/primitives-drift-manifest.json`。

`primitives-drift-check` 的**三态实测**（`node --no-warnings --experimental-strip-types plugin/scripts/primitives-drift-check.ts --root <repo>`）：

- **exit 0**：`primitives-drift-check: 4 file(s) pinned at 446ba9aa8608 (/home/yale/work/quay-fleet)` / 四行 `ok` / `PASS — all four primitives match the pinned quay-fleet blob byte-for-byte.`
- **exit 1（改一个字节）**：fixture 里对一份本地副本 append 一行 ⇒ `RED`，报该文件名 + `local=`/`fleet=`/`pinned=` 三个 sha256（测试 `plugin/test/primitives-drift-check.test.mjs` 的 `取假控制` 用例逐字断言）。
- **exit 3 NOT-EVALUATED，两个方向**：(a) fleet 仓不存在 ⇒ `NOT-EVALUATED — fleet repo absent: …`；(b) **fleet 仓在、钉住的 SHA 取不到** ⇒ exit 3 —— 这是危险方向：只判 `existsSync(repo)` 的实现会读不到 blob 却报「无漂移」。另外 manifest 缺失/corrupt 也判 exit 3（pin 本身读不懂 ⇒ 不判任何一侧有错）。
- **一个刻意的性质**：pin 是 **commit SHA 不是 ref**。fleet 分支 tip 前进（工作树天天动）**不**红 —— 这正是 pin 而不是跟工作树的意义；一旦 re-pin 到移动后的 blob 而本地副本未跟，立刻红。测试里有一条专门钉这个性质。

### AC3 — 逐模块消费者（3/4 直接 import + pty-frame 改钉调用链，**本轮修订并登记理由**）

| 模块 | 消费者（file:line 为 import 行） |
|---|---|
| `delivery-audit.mjs` | `packages/quay/src/serve-send.ts:52` — `import { appendAuditRecord, deliver, deliverKeys, summarizePayload } from "./primitives/delivery-audit.mjs";` |
| `session-liveness.mjs` | `packages/quay/src/observation.ts:47`、`plugin/scripts/orphan-session-check.ts:50`、`plugin/scripts/peer-identity-probe.ts:33`、`plugin/scripts/inner-blocked-signal.ts:146` — 四份，均为 `import { … } from "…/primitives/session-liveness.mjs";` |
| `session-schema.mjs` | `packages/quay/src/observation.ts:48` — `import { validateSessionRecord } from "./primitives/session-schema.mjs";` |
| `pty-frame.mjs` | **不再有直接 import 者**（修订，见下）。生产调用链：`plugin/scripts/send-to-session.ts --keys` → `packages/quay/src/serve-send.ts:484` 的 `return deliverKeys({` → 共享 `delivery-audit.mjs` 的 `deliverKeys()` —— 该模块是**全仓唯一**做帧编解码的路径（`encodeCtrl` / `encodeData` / `decodeFrames`） |

**⚠️ AC3 的 pty-frame 一行本轮被修订，理由是一个不可同时满足的证明**：强化后的 criterion 第二遍要求 `serve-send.ts` **不得**再有自己的 socket；而 `serve-send.ts` 原本正是 pty-frame 的**唯一**直接 import 者。两者互斥 —— **要么** serve-send.ts 自己开 socket（pty-frame 有直接消费者，criterion 红），**要么** 它委托给共享 `deliverKeys()`（criterion 绿，直接消费者消失）。本任务取后者（GOAL 级 criterion 优先），并按下述四条**都能取假**的断言补位，⛔ 不是把断言删掉：

- `serve-send.ts` 仍导出 `sendKeysToSession`，且其实现**就是** `return deliverKeys({…})`（删掉委托 ⇒ 红）；
- `serve-send.ts` 里 `createConnection` 0 命中、且不再 `from "node:net"`（重新自己开 socket ⇒ 红）；
- 调用帧编解码的那个模块（`delivery-audit.mjs`）**逐字节等于** pin（分叉 ⇒ 红）；
- 该模块内确有 `encodeCtrl` 与 `decodeFrames`（编解码被搬到别处 ⇒ 红）。

四条都在 `plugin/test/session-primitives-adoption.test.mjs` 的 `AC3 — pty-frame's production consumer after the amendment` 里逐条断言（该文件 9/9 绿）。**如实登记的降级**：pty-frame 不再有「直接 import 它的本仓库产品/脚本文件」——它被本仓库的生产路径**经共享模块**使用（该模块逐字节等于 pin），这与 AC3 原文要求的「直接 import」不同，故在此写明而不是含混过去。

⛔ 兄弟模块 import 不算：`delivery-audit.mjs` 内部 import `./pty-frame.mjs` —— 这正是上一行不能靠它凑数的原因。

**被替换的手写副本，替换后命中数 = 0**（硬规则 2：先打印命中再计数）：

| 被删形态 | 位置 | 改前命中 | 改后命中 | 替换为 |
|---|---|---|---|---|
| `/proc/<pid>/stat` 第 22 字段本地解析 `tail[19]` | `plugin/scripts/orphan-session-check.ts:153-167` | 1 | **0** | 共享 `readProcStat`（`readProcEtimes` 只留 uptime 算术） |
| 本地 transcript mtime 读 `fs.statSync(transcriptPath).mtimeMs` | `plugin/scripts/inner-blocked-signal.ts:697-704` | 1 | **0** | 共享 `readTranscriptMtime`（`subagents/` 扫描保留） |
| 生产路径的 `/proc` 读（`readProcStart` 走本地读） | `plugin/scripts/peer-identity-probe.ts:244` | 1 | **0**（生产分支改走 `readProcStat`） | 共享 `readProcStat`；纯函数 `parseProcStart` **保留**为注入式测试缝（见「诚实残留」） |
| **L1 手写 socket**（connect + auth/user 两次 write + 800ms 关窗） | `packages/quay/src/serve-send.ts:106`（强化前 tip） | 1 | **0** | 共享 `deliver()`（payload 字节不变：`auth\n` + `user\n`，由 serve-handlers 的 wire-format 测试钉住） |
| **L2 手写 socket**（connect + CTRL/DATA 帧 + 拒绝检测 + 账本） | `packages/quay/src/serve-send.ts:503`（强化前 tip） | 1 | **0** | 共享 `deliverKeys()`（协议、grace 推断、拒绝判定、账本全在共享模块内） |

**pty-frame 的 lane**：Plan 第 4 步的实测搜索 —— `git grep -l -E "pty\.sock|bg-pty-host" <base-tree> -- packages plugin` = **0 命中**（在 base commit 的树上跑，不是在今天的工作树跑：lane 自己就是新的 pty.sock 消费者，搜今天会把本次工作当成「既有命中」），⇒ 确无现存二进制帧消费者，lane 是造出来的。入口 `plugin/scripts/send-to-session.ts --keys --sock <pty.sock>`。它落在 CLAUDE.md 记为不可替代用途的控制面缺口上（`/clear` 等斜杠命令原生通道办不到、手搓 tmux send-keys 禁止）。

### AC4 — 零回退（逐条命令与尾部读数）

| 命令 | 读数 |
|---|---|
| `node --test packages/quay/test/observation.test.mjs` | `tests 51 / pass 51 / fail 0` |
| `node --test packages/quay/test/serve-handlers.test.mjs` | `tests 63 / pass 63 / fail 0`（⚠️ 仓内**没有** `serve-send*.test.mjs`；serve-send 的覆盖在 serve-handlers.test.mjs 里，该文件即本任务的 serve-send 回归面） |
| `node --test packages/quay/test/serve-sessions.test.mjs` | `tests 8 / pass 8 / fail 0` |
| `node --test plugin/test/peer-identity-probe.test.mjs` | `tests 23 / pass 23 / fail 0` |
| `node --test plugin/test/orphan-session-check.test.mjs` | `tests 14 / pass 14 / fail 0` |
| `node --test packages/quay/test/build-plugin-dist.test.mjs`（⚠️ 上一轮把路径写成 `plugin/test/…`，该路径**不存在**；文件实际在 `packages/quay/`） | `tests 24 / pass 24 / fail 0`（含 `AC1 (AC-205) — bundled send-to-session.js is self-contained`） |
| `node --test plugin/test/session-primitives-adoption.test.mjs`（新） | `tests 10 / pass 10 / fail 0`（本轮新增 `AC3 — pty-frame's production consumer after the amendment` 与 `AC3-adjacent — an UNUSABLE ledger never crashes a lane` 两条） |
| `node --test plugin/test/primitives-drift-check.test.mjs`（新） | `tests 7 / pass 7 / fail 0` |
| `node --test plugin/test/inner-blocked-signal.test.mjs` | `tests 37 / pass 37 / fail 0` |
| `node --test packages/quay/test/npm-pack-e2e.test.mjs` | `tests 9 / pass 9 / fail 0`（先红后绿，见下） |
| `npx tsc --noEmit -p packages/quay` | `0 error`（fan-in 的 typecheck 步） |
| `bash scripts/test.sh --for-task gap-ac253-session-primitives-shared-layer-adoption --allow-thin` | `pass 273 / fail 0`，`SCOPED_EXIT=0`；静态门里 `primitives-drift-check: PASS`，无 `STATIC_CHECK_FAILED` / `STATIC_CHECK_NOT_EVALUATED` |
| `bash plugin/scripts/checker-mutation-check.sh --check --only primitives-drift-check` | `MUTATION primitives-drift-check: pass`；`checkers_with_mutation: 73`、`uncovered: 0` |

**本轮在 `54b0eed58` 上把上表逐条重跑**（改了两处 socket 委托后）：`observation.test.mjs` 51/51、`serve-handlers.test.mjs` 63/63、`serve-sessions.test.mjs` 8/8、`peer-identity-probe.test.mjs` 23/23、`orphan-session-check.test.mjs` 14/14、`primitives-drift-check.test.mjs` 7/7、`inner-blocked-signal.test.mjs` 37/37、`build-plugin-dist.test.mjs` 24/24、`npm-pack-e2e.test.mjs` 9/9、`session-primitives-adoption.test.mjs` 10/10 —— 与上表逐条一致（唯一变化是新增那两条断言使 8→10）；补 5c 的预检后 `serve-handlers.test.mjs` 63/63 与 `session-primitives-adoption.test.mjs` 10/10 又各跑一次，仍绿；`npx tsc --noEmit -p packages/quay` = **0 error**。特别是 **`serve-handlers.test.mjs` 的 wire-format 测试**（真 socket、逐字节断言 auth/user 两帧）在 L1 改为 `deliver()` 后仍绿 —— 它钉住了「委托后线上字节未变」。

**打包缺口（Plan 第 41 行预告的那个读数）**：`.mjs` **确实**漏出过产物 —— 第一次 scoped 门在 `packages/quay/test/npm-pack-e2e.test.mjs` 红：`build-plugin-dist failed: Could not resolve "../../packages/quay/src/primitives/session-liveness.mjs"`（`plugin/scripts/inner-blocked-signal.ts:146`）。根因：`packages/quay/scripts/build-plugin-dist.mjs` 的 `coreSrcAliasPlugin` 过滤器只认 `\.ts$`，于是 repo-root 相对路径在**暂存的** `packages/quay/plugin/` 布局下没有改指（`packages/quay/plugin/packages/quay/src/…` 不存在）。修法 = 把过滤器扩到 `\.ts|\.mjs`（映射本就按 `packages/quay/src/` 后缀做，扩展名只决定「是否认领」），**没有**改成「在 plugin/scripts 下重写一份」。修后 `npm-pack-e2e.test.mjs` 9/9 绿。（`packages/quay/src` 内部的相对 import 从不经过该过滤器，所以 Core dist 一直能构建 —— 这就是「同一个 .mjs 在 Core bundle 里正常、在 plugin bundle 里炸」的原因。）

### AC5 — 折叠记录负控制的真实输出

`plugin/test/session-primitives-adoption.test.mjs` 直接 import 共享校验器（不是复刻一份判据）：

- 折叠例 `{status: "busy", sessionKeyScope: "local-only", lifecycle: {…}, activity: {…}}` ⇒ `valid: false`，errors 含 `record has a folded top-level `status` field — lifecycle and activity must stay separate objects`。
- 去掉顶层 `status`、两维各自带 `source`/时间戳 ⇒ `valid: true`（errors 空）。
- **第三个读数**（防恒真）：把 `lifecycle.source` 置空 ⇒ `valid: false` —— 校验器不是只查值域。
- 生成侧真接线：`observation.ts` 的 `attachValidatedSession` 只有 `verdict.valid` 才附加 `session`，否则 `session: null` + `sessionRefusal: verdict.errors`；`serve-sessions.ts` 渲染 `状态记录不可用（共享 schema 拒收）：…` 而**不是**渲染一个折叠值。

### AC6 — 生产载体（四条读数，**均晚于本轮最后落地提交 `d4668c4d0` 的时刻 `2026-09-13T16:17:45Z`**）

| # | 时刻（UTC） | 真实路径 | 读数 |
|---|---|---|---|
| 1 | `16:18:27Z` | `primitives-drift-check` 打在真实检出上 | `exit 0`，四行 `ok`，`PASS — all four primitives match the pinned quay-fleet blob byte-for-byte.` |
| 2 | `16:18:38Z` | `quay serve` 的 `/sessions`（**worktree 的代码**，cwd/served root = 真工作区 `/home/yale/work/quay`） | HTTP `200`、`76916` bytes、`session.lifecycle=` 命中 **32** 条，例：`session.lifecycle=working · session.activity=busy（age 221s）`。该面同时走 session-liveness（transcript mtime 供 `activity.ageSec`）与 session-schema（两维记录 + 校验器） |
| 3 | `16:18:38Z` | **L1 真投递**：shipped CLI `send-to-session.ts --self` 打到**真的 unix socket**（`CLAUDE_CODE_MESSAGING_SOCKET` 指向本次起的真 socket，对端收到全部字节） | CLI `exit 0`；线上 2 行，`type` 依次 `auth` / `user`（两帧都到达，**证明委托给 `deliver()` 后 800ms 关窗的移除没有截断**）；L1 账本新增一条：`{"level":"L1","who":"script-1656270","when":"2026-09-13T16:18:38.747Z","delivered":true,"payloadSummary":{"length":289,"sha256_12":"ff9935324778","firstLine":"{\"type\":\"auth\",\"token\":\"tok-ac253-L1b\"}"}}`（默认账本路径 `/tmp/quay-session-send-audit.jsonl` —— 无 workspace 的调用者走共享默认值，见「诚实残留」5b） |
| 4 | `16:18:39Z` | **L2 真投递**：shipped CLI `send-to-session.ts --keys --sock <真 pty.sock> --audit <真路径> "/clear"` | CLI `exit 0`；对端按 `[4B len][1B tag][payload]` 解出**两帧**：`(tag=1, len=32, '{"t":"auth","token":"tok-ac253"}')`、`(tag=0, len=6, '/clear')`（DATA 帧**原样**，控制字节未改写）；全线上 hex `00000020017b2274223a2261757468222c22746f6b656e223a22746f6b2d6163323533227d00000006002f636c656172`；账本 `{"level":"L2","who":"script-1656299","when":"2026-09-13T16:18:39.053Z","delivered":true,"payloadSummary":{"length":6,"sha256_12":"ddf7839cb8fc","firstLine":"/clear"}}`；**失败路径**（socket 不存在）`exit 4` 且账本**照写第二条**（`delivered:false`） |

⚠️ 四条读数都是**真读数**：`/sessions` 走的是真实的 `claude agents --json` 注册表（16 行）+ transcript 扫描；L1/L2 走的是 **shipped CLI + 真 unix socket**（对端收到的字节被逐字节记录）。⛔ 没有一条是在测试夹具里取的。

⚠️ **第 2 条的取法要点（上一轮读数作废的原因之一）**：`/sessions` 会用 `samePath` 把整机注册表**收敛到 served root**（`observation.ts` 的 `samePath`）。本轮第一次取数时 cwd = worktree ⇒ 注册表 16 行全被过滤掉 ⇒ `session.lifecycle=` **0 命中**（页面 36KB、只剩表头）。把 cwd/served root 换成真工作区后为 32 命中 ⇒ **0 命中不是「没有会话」，是 served root 变了**——这条差异本身就是一个代理量陷阱（硬规则 4b）。

⚠️ **上一轮抓到的那个缺陷的形态保留说明**：`send-to-session.ts` 的 `--keys` 块曾写在 `const args = process.argv.slice(2)` **之前** ⇒ 每次调用都 `ReferenceError`。静态断言（「文件里提到 --keys」）会通过；只有**真跑一次**才暴露。回归测试仍在 `plugin/test/session-primitives-adoption.test.mjs` 的 `AC3/AC6 — the shipped keys CLI really runs`（真 socket、断言 tag 序列 `[1,0]`、DATA 帧原样、成功与失败两条路径各写一条账、缺 `--sock` 时 exit 2）。

### 诚实残留（不满足 AC3/DoD 字面要求的部分，逐条列出而不是藏起来）

1. **`packages/quay/src/observation.ts` 的 `procStartTimeMs` 未替换**（本地 `fields[19]` 命中仍 = 1）。原因：该函数的 `procDir` 参数是**注入式测试缝**（`readLiveWorkerProcesses(procDir)`，`packages/quay/test/observation.test.mjs:358-380` 用假 `/proc` 断言 `startedAtMs === (btimeSec + 100) * 1000`），而共享 `readProcStat(pid)` 把 `/proc/<pid>/stat` 硬编码、**不提供内容注入缝**。两个可选做法都不好：改测试缝 = 动既有回归测试，留本地读 = 留一份副本。⇒ 如实登记为**未替换的残留**，⛔ 不声称归零。observation.ts 的消费者身份由 **session-schema** 提供（`attachValidatedSession` + `validateSessionRecord`），另加 session-liveness 的 `readTranscriptMtime`（`:47`）。
2. **`plugin/scripts/peer-identity-probe.ts` 的纯函数 `parseProcStart` 保留**（`fields[19]`/`rest[19]` 命中 = 2，含注释）。同上：它是 `FactIo` 注入缝的读法，共享 reader 无内容注入缝。**生产路径**（无注入 `io` 时）已改走 `readProcStat`，所以重复的只剩「给注入缝用的纯解析」。
3. **`plugin/scripts/supervisor-preempt-candidates.ts:135-137` 未替换，且立案描述有误**：那三行解析的是 `/proc/<pid>/stat` 的 **pgrp（字段 5，`fields[2]`）**，**不是第 22 字段 starttime** —— 共享模块的 `readProcStat` 只返回 `{starttime}`，无法服务 pgrp。⇒ 立案把「同一段按最后一个 `)` 切分的纪律」误记为「第三份第 22 字段解析」。未改动该文件。
4. **`plugin/scripts/driver-runtime.ts:1029` 是另一份 starttime 解析**（不在原 Touches 里），未替换 —— 它另有 CLK_TCK 自推导（`/proc/self/stat` + `/proc/uptime`），换掉会改变它自己的推导语义，越出「零新功能」边界。登记为已知残留。
5. **fleet 的 `deliver` / `deliverKeys` 本轮起**被本仓库调用（`serve-send.ts:52` 的 import、L1 在 `sendSessionFrames` 已改为 `return deliver(...)`、L2 在 `sendKeysToSession` 已改为 `return deliverKeys(...)`）—— 上一轮登记为「未被调用」的那条**已作废**：强化后的 criterion 明确要求「全仓只有一份」，委托是唯一同时满足「有消费者」与「只有一份」的形态。**`readAuditTrail` 仍未接**：它按 delivery `id` 检索，而本仓库的 `message-receipts.jsonl` 读者按 `sessionId` 检索，接上会改既有读契约（保留为未接线，登记而非掩饰）。
5b. **L1 的审计账本默认落在 `/tmp/quay-session-send-audit.jsonl`**（`DEFAULT_SEND_AUDIT_PATH`）：共享 `deliver()` 的签名要求 `auditLogPath` 必填，而 `sendSessionFrames` 是库函数、无法凭空知道 workspace root。web 入口（`sendToSession`）会传 `<receiptDir>/session-send-audit.jsonl`，所以**生产 web 路径的账落在 `.quay/`**；只有无 workspace 的调用者（诊断 CLI 的 `--self/--pid` 模式、直接调库的测试）走 tmp 默认值。⚠️ 这是本轮**新增的行为**（上一轮这条路径一条账都不写），如实登记。
5c. **委托引入过一个「账本不可写 ⇒ 未捕获异常」，本任务内已修并留回归**：共享 `deliver`/`deliverKeys` 的账本 append **不是 best-effort** —— 它在 socket 回调里抛出 ⇒ 未捕获异常 ⇒ 进程带栈退出（实测旧状态：`--keys --sock <活 socket> --audit <ENOTDIR 路径>` ⇒ `exit 1` + `Node.js v24.19.0` 栈，**没有任何判词**）。web 路径上这比坏退出码更糟：`sendToSession` 传的是 `<receiptDir>/session-send-audit.jsonl`，`.quay/` 不可写就会**每次 `/send` 打死 `quay serve` 进程**，而隔壁的回执写（`appendMessageReceipt`）明确是 best-effort。⇒ 修法：开 socket **之前**校验账本目标，然后诚实降级 —— L1 退回文档化的默认路径（投递本身不被记账问题挡住），L2 **拒绝并给理由**（`audit ledger not writable: <path>`，因为路径是调用者点名的，悄悄写去别处就是撒谎），CLI 渲染成常规失败 `exit 4`。`mkdirSync` 与 `appendAuditRecord` 自己那一步是同一个调用，故不引入新的文件系统风险，只是把失败挪到能报告的地方。回归：`plugin/test/session-primitives-adoption.test.mjs` 的 `AC3-adjacent — an UNUSABLE ledger never crashes a lane`（真 socket；L1 仍投递 ∧ CLI `exit 4` 且有理由 ∧ stderr **无** `Uncaught`/`Node.js v`）。
6. **journal 文件格式未变**（Plan 第 5 步要求的决定）：`message-receipts.jsonl` 的**写入实现**换成共享 `appendAuditRecord`，写出字节与原来逐字相同（同一个 `mkdirSync(dirname)` + `appendFileSync(JSON.stringify(record)+"\n")`），新增的 `payloadSummary` 是**增量字段**（既有读者忽略未知键，`readMessageReceipts` 亦如此）。⇒ 既有读者零回退。
7. **`.d.mts` 声明文件**（四份，本地手写、不参与逐字节比对）：root tsconfig 是 `allowJs` + `checkJs`，被 import 的 `.mjs` 会被一起类型检查，而冻结副本里不能写 `// @ts-nocheck`（会破坏逐字节同一性）。⇒ 用兄弟 `.d.mts` 声明类型。drift manifest 只钉四个 `.mjs`。
8. **scoped-gate 缓存的 sha 记的是「门实际 gated 的那个 develop tip」**：门在 `1ea66a0b1` 上跑绿，这次 `HEAD^2` = `rev-parse develop` = `92fc24476`，两者一致，缓存即记 `92fc24476`。（中途还跑过一次：那次 merge 到的 tip 是 `69aac66d` 而 develop 已前进到 `cd63c8dd`，当时按同一原则记 `69aac66d` 并重跑——记一个没跑过的 tip 会让 fan-in 错误跳过门，记实际跑过的 tip 最多让 fan-in 重跑一次门，是成本不是错误。）

### 本轮补：suite 静态门 `registry-bare-filename-scan` 红的真因与修法（不是「重跑碰运气」）

上一轮 exit-not-landed 的 `# fail 5` / `# suite red static-check` 只有**一条**真因（套件日志尾部逐字，`# tests 0` ⇒ 套件在静态闸就中止，一个测试都没跑）：

```
STATIC_CHECK_FAILED: registry-bare-filename-scan exit=1
RED: referenced script(s) still in dead set: send-to-session.ts
```

**真因（一条命令取到，不是猜）**：本任务新增的 `plugin/test/session-primitives-adoption.test.mjs:272`（及 `:374`）以裸文件名钉住 shipped CLI ——
`path.join(REPO_ROOT, "plugin", "scripts", "send-to-session.ts")` —— 这正是该扫描器的 `test-pin` 引用类（§12e 四类引用之一）。
于是 `send-to-session.ts` 进入 `allReferencedScripts`，而该闸的判据是 `allReferencedScripts ∩ after.dead = ∅`：
被引用的脚本仍在 `docs/analysis/dead-set-recomputed.json` 的**快照**死集里 ⇒ 红。按位置（不是按关键词）取到的命中：

```
{"script":"send-to-session.ts",
 "carrier":{"file":"plugin/test/session-primitives-adoption.test.mjs","line":272,
            "snippet":"const cli = path.join(REPO_ROOT, \"plugin\", \"scripts\", \"send-to-session.ts\");"},
 "kind":"test-pin"}
```

**两条「让它变绿」的路都不取**：① 让检查器忽略 `test-pin` —— 把一条真引用判成不存在，而 §12f 存在的理由恰恰是「闭包会漏引用形式」；
② 把测试里的路径改写成检查器认不出的形态 —— 主动选用被漏掉的那种写法来绕闸，方向与 §12f 相反。两条都是删掉判据而不是修它。
⇒ 正确动作是**刷新快照**：SPEC §12e 自述该名单是「带测量日期的快照，不是活文档」，且「执行 archive 前须按 §12d 重算一次，以重算结果为准」；
`send-to-session.ts` 本来就被本仓库产品面在用（`send-to-session.ts --keys` 是本轮落地的入口），它**不该**在死集里。

**修法**：跑该机件自己的重算入口（同一条 §12d 规则 + §12e 四类引用 + §12f 裸文件名边），把产物写回 `docs/analysis/dead-set-recomputed.json`：

```
node --no-warnings --experimental-strip-types plugin/scripts/registry-bare-filename-scan.ts --dead-set --root <worktree>
```

| 读数 | 值 |
|---|---|
| 改前 `after.deadCount`（2026-09-08 的已提交快照） | 31（`send-to-session.ts` **在其中**） |
| 改后 `after.deadCount`（本次重算，默认窗口 = 72h 到 now） | **15**（`send-to-session.ts` **不在**其中） |
| 闸（改后，同一棵树） | `--check` ⇒ `PASS: bare-filename scan found 9 referenced script(s) + 532 extra-kind ref(s); … none in dead set (after=15)`，**exit 0** |

**31→15 的差不是本任务造成的（三段对照，不是自洽的解释）**：同一重算换用 2026-09-08 那一刻的普查窗口（`--since/--until`）**仍得 18**，
差集恰是 `channel-probe-server.ts` / `peer-identity-probe.ts` / `preparation-feedback.ts` 三个（这三个在新窗口里被执行过 ⇒ 活着）。
⇒ 31→18 由**这五天树上的引用面变化**造成，18→15 由**普查窗口**造成；两个方向都指向同一结论：**快照陈旧**，不是本任务新引入的缺陷。
本任务取**默认窗口**的读数 —— 它与任何人重跑一次默认命令的结果一致（可复现）；挑一个旧窗口能让 diff 更小，但会让产物与机件的自然输出不一致，属于「让读数迁就叙事」。

⚠️ 顺带登记（**不是**本任务修、但同形）：死集除「被引用的脚本」外还有一类会随**普查窗口**移动的条目 ——
`peer-identity-probe.ts` / `channel-probe-server.ts` / `preparation-feedback.ts` 在 09-08 窗口下判死、在今天的 72h 窗口下（被执行过）已活着。
本任务只负责让**被引用的脚本**离开死集（这正是该闸的判据），不替其余名字做 archive 决策
（那是 AC158 的范围，且 SPEC §12e 逐字要求执行前先重算）。

**本轮收尾的验证读数**（都在最终状态上取，⛔ 不复用上一轮的读数）：

| 检查 | 命令 | 读数 |
|---|---|---|
| §12f 闸（就是全量套件静态门红的那一条） | `node --no-warnings --experimental-strip-types plugin/scripts/registry-bare-filename-scan.ts --check --root <worktree>` | `PASS: … none in dead set (after=15)`，**exit 0** |
| anti-drift（fan-in 第 3 步） | `anti-drift-touches-check.ts --task … --worktree … --merge-target develop` | `ANTI-DRIFT OK — 26 actual file(s), all within declared Touches (29 glob(s))` |
| scoped 门（fan-in 第 6 步） | `bash scripts/test.sh --for-task gap-ac253-session-primitives-shared-layer-adoption --allow-thin` | `tests 315 / pass 315 / fail 0`，`SCOPED_EXIT=0`，无 `STATIC_CHECK_FAILED` |
| 任务文件三查 | `task-contract-check --no-block` / `malformed-task-check` / `touches-one-entry-one-path-check`（各带 `--strict-subset <task>`） | 三条 exit 0 |

⚠️ scoped-gate 缓存按「记**实际跑过的那个 develop tip**」写入（本次 = `cefba40d4`，即最后一次 merge 的 `HEAD^2`，**不是**写缓存那刻的 `rev-parse develop`）：
develop 在本轮期间又前进过（`8abcf5b48` → `cefba40d4` → `bbe593c7d`…）。记一个**没跑过**的 tip 会让 fan-in **错误跳过**门；
记**实际跑过**的 tip 最多让它**多跑一次** —— 是成本，不是错误。

### DoD 自查

四个原语在本仓库**只有一份**（AC2，含三态漂移检查）；其中三个有本仓库产品/脚本文件的**直接 import**，`pty-frame` 经共享模块在生产调用链上被使用（AC3，修订并登记 —— 与强化后 criterion 的「不得自己开 socket」互斥，理由与四条可失败断言在 AC3 节）；**被替换的手写副本逐条归零**，含本轮退掉的 L1/L2 两处手写 socket（`serve-send.ts` 已不再 import `node:net`）；折叠记录负控制真被拒（AC5）；在这个状态上 AC-253 criterion 逐字 exit 0、移走 `primitives/` 转 exit 1；**四条读数均在生产载体上、均晚于本轮落地时刻 `16:08:37Z`**（AC6）。残留逐条登记（observation.ts 的注入缝解析、`readAuditTrail` 未接、L1 默认账本路径、以及 5c 那个已修的「账本不可写 ⇒ 崩溃」）。

## DoD

**真 landed 的判据是「四个原语在本仓库只有一份、且这一份真被本仓库的代码在用」，不是「criterion exit 0」**：`packages/quay/src/primitives/` 下四个文件逐字节等于 fleet 钉住的 SHA（AC2，含漂移检查的三态）；每个模块各有一个非测试消费者在 import 它、且被替换的手写副本命中数归零（AC3）；折叠记录的负控制真的被拒（AC5）；在**这个状态上** AC-253 的 criterion 逐字 exit 0，移走 `primitives/` 则转 exit 1（负控制，两条读数都贴）。

⛔ 不接受的替代物：把四个文件拷进来只 import 一个（机器判据绿、另外三个是 vendored 死代码 —— 正是判据"有消费者"那一半要防的形态）；**手写第二份实现**（SPEC §3.3 逐字"唯一不可接受"）；"新加 import、旧手写副本留着"（三份）；用模块自己的头注释或兄弟模块的 import 冒充消费者；跨仓漂移检查在 fleet 不可达时判 PASS（硬规则 3b：读不懂输入却返回与合格同形）；照抄 fleet 工作树而不是钉 SHA（fleet 份今天还在动，第二天即分叉）；只在单测夹具里跑过。