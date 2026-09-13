---
id: gap-ac253-session-primitives-shared-layer-adoption
title: GOAL-017/AC-253：会话读写原语统一到共享层 ——
  四个模块（pty-frame/delivery-audit/session-liveness/session-schema）从 quay-fleet
  单一来源落入本仓库，且每个模块在本仓库有非测试消费者（SPEC 阶段 A3）
status: ready
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
- `plugin/vendor/quay/dist/quay.js`（若构建产物字节变化则一并声明与提交；`dist/` 下仅此一个产物文件，以构建输出清单为准）
- `tasks/gap-ac253-session-primitives-shared-layer-adoption.md`（自身文件：勾 AC + 贴实跑证据）

## AC

- [x] AC1: 在 repo root 逐字跑 `goals/AC-253-会话读写原语统一到共享层-四个模块在本仓库可用且有非测试消费者-spec-阶段-a3.md` 的 criterion ⇒ **exit 0**（立案当轮实测 exit 1，报四个模块全缺）。改前/改后两条读数 + 两条命令原文都贴进结果段。去掉 `packages/quay/src/primitives/` 后必须转回 exit 1（负控制，两条读数都贴）。
- [x] AC2: **单一来源 + 逐字节**：四个模块落 `packages/quay/src/primitives/{pty-frame,delivery-audit,session-liveness,session-schema}.mjs`；逐文件 `git hash-object` == fleet `446ba9aa...` 对应 blob 的 hash（四组数值贴进结果段）；provenance（fleet 路径 + SHA）在文件头或 `primitives/PROVENANCE.md`。**取假控制**：`primitives-drift-check` 在"改一个字节"时必须 exit 1（那次负控制输出也贴），fleet 不可达/取不到该 SHA 时必须 exit 3 + `NOT-EVALUATED`（⛔ 不判 PASS）。
- [x] AC3: **4/4 逐模块非测试消费者（⛔ 强于机器判据的"任一非空"）**：四个模块**每一个**都列出 ≥1 个 `packages/quay/src` 或 `plugin/scripts` 下的**非测试**文件，且该文件**import 该模块**（贴 import 行 + file:line）；并给出**被它替换掉的手写副本的 file:line 与替换后命中数 = 0**；pty-frame 若走 Plan 第 4 步 lane，额外贴该 lane 的实测搜索读数与实现出处。⛔ 不算消费者：模块自己的头注释提到自己；兄弟模块（`delivery-audit.mjs` import `pty-frame.mjs`）import 它 —— "真被采用"指本仓库产品/脚本代码在用。
- [x] AC4: **零回退**：`node --test packages/quay/test/observation.test.mjs`、`packages/quay/test/serve-send*.test.mjs`、`packages/quay/test/serve-sessions*.test.mjs`、`plugin/test/peer-identity-probe.test.mjs`、`plugin/test/orphan-session-check.test.mjs`、`plugin/test/build-plugin-dist.test.mjs` 全绿（逐条命令与尾部读数贴进结果段）；新增 `plugin/test/session-primitives-adoption.test.mjs` 与 `plugin/test/primitives-drift-check.test.mjs` 全绿。
- [x] AC5: **负控制：折叠记录被拒**：把 `session-schema.mjs` 的 AC-001 反例搬成一条**本仓库**的测试——构造 `{status: "busy", ...}` 折叠记录 ⇒ `valid:false` 且 errors 提到折叠；去掉顶层 `status`、把 `lifecycle`/`activity` 两维对象补齐 ⇒ `valid:true`。两条输出都贴进结果段（只有正例的测试是恒真，硬规则 4）。
- [x] AC6: **生产载体真跑过（硬规则 4 推论三）**：实现落地时刻**之后**，在真实运行路径取一次读数（`quay serve` 的 sessions 面 / 一次真实投递 / `primitives-drift-check` 的 exit 0），三条读数均晚于落地时刻。⛔ 只在夹具里跑过不算 —— 该模块的三个既有 AC 也都是这个形态。

## Evidence（结果段）

分支 `task/gap-ac253-session-primitives-shared-layer-adoption`（worktree `/home/yale/work/quay-worktrees/gap-ac253-session-primitives-shared-layer-adoption`）。落地提交 `623309d32`（主体）/ `eb38d92ad`（CLI 修复 + 真 socket 测试）；scoped 门在 `8fc2191bf`（merge develop 后）绿。

### AC1 — AC-253 criterion 三条读数

命令（逐字，cwd = repo root）：

```
python3 - <<'P'
import sys,pathlib,subprocess
mods=["pty-frame","delivery-audit","session-liveness","session-schema"]
root=pathlib.Path(".")
found={}
for m in mods:
    hits=[p for p in root.rglob("%s.*"%m)
          if "node_modules" not in str(p) and ".claude/worktrees" not in str(p)
          and ".quay/" not in str(p) and p.suffix in (".ts",".mjs",".js")]
    found[m]=[str(p) for p in hits]
missing=[m for m in mods if not found[m]]
if missing:
    sys.stderr.write("AC-253: shared primitive module(s) absent from this repo: %s => stage A3 not landed\n"%",".join(missing)); sys.exit(1)
try:
    r=subprocess.run(["git","grep","-l","-E",r"(pty-frame|delivery-audit|session-liveness|session-schema)",
                      "--","packages/quay/src","plugin/scripts"],capture_output=True,text=True,timeout=60)
except Exception as e:
    sys.stderr.write("AC-253 NOT-EVALUATED: git grep failed (%s)\n"%e); sys.exit(3)
consumers=[l for l in r.stdout.splitlines() if l.strip() and "test" not in l]
if not consumers:
    sys.stderr.write("AC-253: modules present but NO non-test consumer under packages/quay/src or plugin/scripts => vendored dead code, not adopted\n"); sys.exit(1)
sys.exit(0)
P
```

| 读数 | 命令 | 结果 |
|---|---|---|
| **改前**（base commit `0765b439b` 的树 `git archive` 到临时目录后跑） | 同上 | `exit 1` — `AC-253: shared primitive module(s) absent from this repo: pty-frame,delivery-audit,session-liveness,session-schema => stage A3 not landed` |
| **改后**（本 tip） | 同上 | `exit 0`（无输出） |
| **负控制**（`mv packages/quay/src/primitives /tmp/…` 后跑，再移回） | 同上 | `exit 1`，同一条消息（四个 key 全空） |

⇒ 判据在这个状态上真取真、拿掉目录真取假。⚠️ 注意：判据的「有消费者」半边只要求**非空**，所以它无法区分 4/4 与 1/4 —— AC3 是本任务自加的补强。

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
- **一个刻意的性质**：pin 是 **commit SHA 不是 ref**。fleet 分支 tip 前进（工作树天天动）**不**红 —— 这正是 pin 而不是跟工作树的意义；一旦 re-pin 到移动后的 blob 而本地副本未跟，立刻红。

### AC3 — 4/4 逐模块消费者

| 模块 | 消费者（file:line 为 import 行） |
|---|---|
| `pty-frame.mjs` | `packages/quay/src/serve-send.ts:43` — `import { decodeFrames, encodeCtrl, encodeData } from "./primitives/pty-frame.mjs";` |
| `delivery-audit.mjs` | `packages/quay/src/serve-send.ts:44` — `import { appendAuditRecord, summarizePayload } from "./primitives/delivery-audit.mjs";` |
| `session-liveness.mjs` | `packages/quay/src/observation.ts:47`、`plugin/scripts/orphan-session-check.ts:50`、`plugin/scripts/peer-identity-probe.ts:33`、`plugin/scripts/inner-blocked-signal.ts:146` — 四份，均为 `import { … } from "…/primitives/session-liveness.mjs";` |
| `session-schema.mjs` | `packages/quay/src/observation.ts:48` — `import { validateSessionRecord } from "./primitives/session-schema.mjs";` |

⛔ 兄弟模块 import 不算：`delivery-audit.mjs` 内部 import `./pty-frame.mjs`，但 pty-frame 的消费者被单列在上面（`plugin/test/session-primitives-adoption.test.mjs` 里有一条断言专门排除「消费者全在 primitives 目录内」这种形态）。

**被替换的手写副本，替换后命中数 = 0**（硬规则 2：先打印命中再计数）：

| 被删形态 | 位置 | 改前命中 | 改后命中 | 替换为 |
|---|---|---|---|---|
| `/proc/<pid>/stat` 第 22 字段本地解析 `tail[19]` | `plugin/scripts/orphan-session-check.ts:153-167` | 1 | **0** | 共享 `readProcStat`（`readProcEtimes` 只留 uptime 算术） |
| 本地 transcript mtime 读 `fs.statSync(transcriptPath).mtimeMs` | `plugin/scripts/inner-blocked-signal.ts:697-704` | 1 | **0** | 共享 `readTranscriptMtime`（`subagents/` 扫描保留） |
| 生产路径的 `/proc` 读（`readProcStart` 走本地读） | `plugin/scripts/peer-identity-probe.ts:244` | 1 | **0**（生产分支改走 `readProcStat`） | 共享 `readProcStat`；纯函数 `parseProcStart` **保留**为注入式测试缝（见「诚实残留」） |

**pty-frame 的 lane**：Plan 第 4 步的实测搜索 —— `git grep -l -E "pty\.sock|bg-pty-host" <base-tree> -- packages plugin` = **0 命中**（在 base commit 的树上跑，不是在今天的工作树跑：lane 自己就是新的 pty.sock 消费者，搜今天会把本次工作当成「既有命中」），⇒ 确无现存二进制帧消费者，lane 是造出来的。实现出处：`packages/quay/src/serve-send.ts` 的 `sendKeysToSession()`（用共享 `encodeCtrl`/`encodeData`/`decodeFrames` + 共享 `appendAuditRecord`/`summarizePayload`），入口 `plugin/scripts/send-to-session.ts --keys --sock <pty.sock>`。它落在 CLAUDE.md 记为不可替代用途的控制面缺口上（`/clear` 等斜杠命令原生通道办不到、手搓 tmux send-keys 禁止）。

### AC4 — 零回退（逐条命令与尾部读数）

| 命令 | 读数 |
|---|---|
| `node --test packages/quay/test/observation.test.mjs` | `tests 51 / pass 51 / fail 0` |
| `node --test packages/quay/test/serve-handlers.test.mjs` | `tests 63 / pass 63 / fail 0`（⚠️ 仓内**没有** `serve-send*.test.mjs`；serve-send 的覆盖在 serve-handlers.test.mjs 里，该文件即本任务的 serve-send 回归面） |
| `node --test packages/quay/test/serve-sessions.test.mjs` | `tests 8 / pass 8 / fail 0` |
| `node --test plugin/test/peer-identity-probe.test.mjs` | `tests 23 / pass 23 / fail 0` |
| `node --test plugin/test/orphan-session-check.test.mjs` | `tests 14 / pass 14 / fail 0` |
| `node --test plugin/test/build-plugin-dist.test.mjs` | `tests 24 / pass 24 / fail 0` |
| `node --test plugin/test/session-primitives-adoption.test.mjs`（新） | `tests 8 / pass 8 / fail 0` |
| `node --test plugin/test/primitives-drift-check.test.mjs`（新） | `tests 7 / pass 7 / fail 0` |
| `node --test plugin/test/inner-blocked-signal.test.mjs` | `tests 37 / pass 37 / fail 0` |
| `npx tsc --noEmit -p packages/quay` | `0 error`（fan-in 的 typecheck 步） |
| `bash scripts/test.sh --for-task gap-ac253-session-primitives-shared-layer-adoption --allow-thin` | `pass 273 / fail 0`，`SCOPED_EXIT=0`；静态门里 `primitives-drift-check: PASS`，无 `STATIC_CHECK_FAILED` / `STATIC_CHECK_NOT_EVALUATED` |
| `bash plugin/scripts/checker-mutation-check.sh --check --only primitives-drift-check` | `MUTATION primitives-drift-check: pass`；`checkers_with_mutation: 73`、`uncovered: 0` |

**打包缺口（Plan 第 41 行预告的那个读数）**：`.mjs` **确实**漏出过产物 —— 第一次 scoped 门在 `packages/quay/test/npm-pack-e2e.test.mjs` 红：`build-plugin-dist failed: Could not resolve "../../packages/quay/src/primitives/session-liveness.mjs"`（`plugin/scripts/inner-blocked-signal.ts:146`）。根因：`packages/quay/scripts/build-plugin-dist.mjs` 的 `coreSrcAliasPlugin` 过滤器只认 `\.ts$`，于是 repo-root 相对路径在**暂存的** `packages/quay/plugin/` 布局下没有改指（`packages/quay/plugin/packages/quay/src/…` 不存在）。修法 = 把过滤器扩到 `\.ts|\.mjs`（映射本就按 `packages/quay/src/` 后缀做，扩展名只决定「是否认领」），**没有**改成「在 plugin/scripts 下重写一份」。修后 `npm-pack-e2e.test.mjs` 9/9 绿。（`packages/quay/src` 内部的相对 import 从不经过该过滤器，所以 Core dist 一直能构建 —— 这就是「同一个 .mjs 在 Core bundle 里正常、在 plugin bundle 里炸」的原因。）

### AC5 — 折叠记录负控制的真实输出

`plugin/test/session-primitives-adoption.test.mjs` 直接 import 共享校验器（不是复刻一份判据）：

- 折叠例 `{status: "busy", sessionKeyScope: "local-only", lifecycle: {…}, activity: {…}}` ⇒ `valid: false`，errors 含 `record has a folded top-level `status` field — lifecycle and activity must stay separate objects`。
- 去掉顶层 `status`、两维各自带 `source`/时间戳 ⇒ `valid: true`（errors 空）。
- **第三个读数**（防恒真）：把 `lifecycle.source` 置空 ⇒ `valid: false` —— 校验器不是只查值域。
- 生成侧真接线：`observation.ts` 的 `attachValidatedSession` 只有 `verdict.valid` 才附加 `session`，否则 `session: null` + `sessionRefusal: verdict.errors`；`serve-sessions.ts` 渲染 `状态记录不可用（共享 schema 拒收）：…` 而**不是**渲染一个折叠值。

### AC6 — 生产载体（三条读数，均晚于落地时刻 `2026-09-13T15:23:04Z`）

| # | 时刻（UTC） | 真实路径 | 读数 |
|---|---|---|---|
| 1 | `15:25:31Z` | `primitives-drift-check` 打在真实检出上 | `exit 0`，四行 `ok`，`PASS — all four primitives match the pinned quay-fleet blob byte-for-byte.` |
| 2 | `15:26:03Z` | `quay serve` 的 `/sessions`（**worktree 的代码**，served root 是真的工作区 ⇒ 真有会话卡） | HTTP `200`、`95758` bytes、`session.lifecycle=` 命中 **35** 条，例：`session.lifecycle=working · session.activity=idle（age 230824s）`。该面同时走 session-liveness（transcript mtime 供 `activity.ageSec`）与 session-schema（两维记录 + 校验器） |
| 3a | `15:27:45Z` | 一次**真 HTTP 投递**（`POST /send`，well-formed 但无端点的 UUID） | HTTP `200`，页面渲染 `投递失败`；**失败路径**真的写了账：`{"sessionId":"0765b439-…ac53","name":null,"message":"ac253 production-carrier probe","state":"error","sentAtMs":1789313265266,"payloadSummary":{"length":30,"sha256_12":"944bacee7821","firstLine":"ac253 production-carrier probe"}}` —— 旧代码在这条路径上**一条记录都不写** |
| 3b | `15:27:45Z` | 一次**真 keys 投递**：shipped CLI `send-to-session.ts --keys` 打到**真的 unix socket** | 对端收到的线上字节：`{"tag":1,"declaredLen":32,"payload":"{\"t\":\"auth\",\"token\":\"tok-ac253\"}"}` 然后 `{"tag":0,"declaredLen":6,"payload":"/clear"}`（DATA 帧**原样**，控制字节未改写）；共享账本记 `delivered:true` + `payloadSummary {length:6,sha256_12:"ddf7839cb8fc",firstLine:"/clear"}` |

⚠️ 这一轮真读数**抓到一个只跑测试抓不到的缺陷**：`send-to-session.ts` 的 `--keys` 块曾写在 `const args = process.argv.slice(2)` **之前** ⇒ 每次调用都 `ReferenceError: args is not defined`（连原本可用的模式也一起死）。静态断言（「文件里提到 --keys」）会通过；只有**真跑一次**才暴露。已修（`const args` 提到块之前）并补了真 socket 回归测试（`plugin/test/session-primitives-adoption.test.mjs` 的 `AC3/AC6 — the shipped keys CLI really runs`：断言线上 tag 序列 `[1,0]`、DATA 帧内容原样、成功与失败**两条路径各写一条账**、`--keys` 缺 `--sock` 时 exit 2）。

### 诚实残留（不满足 AC3/DoD 字面要求的部分，逐条列出而不是藏起来）

1. **`packages/quay/src/observation.ts` 的 `procStartTimeMs` 未替换**（本地 `fields[19]` 命中仍 = 1）。原因：该函数的 `procDir` 参数是**注入式测试缝**（`readLiveWorkerProcesses(procDir)`，`packages/quay/test/observation.test.mjs:358-380` 用假 `/proc` 断言 `startedAtMs === (btimeSec + 100) * 1000`），而共享 `readProcStat(pid)` 把 `/proc/<pid>/stat` 硬编码、**不提供内容注入缝**。两个可选做法都不好：改测试缝 = 动既有回归测试，留本地读 = 留一份副本。⇒ 如实登记为**未替换的残留**，⛔ 不声称归零。observation.ts 的消费者身份由 **session-schema** 提供（`attachValidatedSession` + `validateSessionRecord`），另加 session-liveness 的 `readTranscriptMtime`（`:47`）。
2. **`plugin/scripts/peer-identity-probe.ts` 的纯函数 `parseProcStart` 保留**（`fields[19]`/`rest[19]` 命中 = 2，含注释）。同上：它是 `FactIo` 注入缝的读法，共享 reader 无内容注入缝。**生产路径**（无注入 `io` 时）已改走 `readProcStat`，所以重复的只剩「给注入缝用的纯解析」。
3. **`plugin/scripts/supervisor-preempt-candidates.ts:135-137` 未替换，且立案描述有误**：那三行解析的是 `/proc/<pid>/stat` 的 **pgrp（字段 5，`fields[2]`）**，**不是第 22 字段 starttime** —— 共享模块的 `readProcStat` 只返回 `{starttime}`，无法服务 pgrp。⇒ 立案把「同一段按最后一个 `)` 切分的纪律」误记为「第三份第 22 字段解析」。未改动该文件。
4. **`plugin/scripts/driver-runtime.ts:1029` 是另一份 starttime 解析**（不在原 Touches 里），未替换 —— 它另有 CLK_TCK 自推导（`/proc/self/stat` + `/proc/uptime`），换掉会改变它自己的推导语义，越出「零新功能」边界。登记为已知残留。
5. **fleet 的 `deliver` / `deliverKeys` / `readAuditTrail` 未被本仓库调用**。L2 lane 用的是那两个原语（帧编解码 + 审计账），编排（端点约定、grace 推断、账本路径、返回形态）是本仓库自己的 —— 理由：`deliverKeys` 是 fleet 形态的 facade，其 endpoint/token/ledger 约定是 fleet 的；而 SPEC §3.3 逐字禁止的是**四个模块**的第二份手写实现，本仓库对帧编解码与审计账各只有一份（⛔ 没有第二份 codec、没有第二份 ledger）。`readAuditTrail` 未接：它按 delivery `id` 检索，而本仓库的 `message-receipts.jsonl` 读者按 `sessionId` 检索，接上会改既有读契约。
6. **journal 文件格式未变**（Plan 第 5 步要求的决定）：`message-receipts.jsonl` 的**写入实现**换成共享 `appendAuditRecord`，写出字节与原来逐字相同（同一个 `mkdirSync(dirname)` + `appendFileSync(JSON.stringify(record)+"\n")`），新增的 `payloadSummary` 是**增量字段**（既有读者忽略未知键，`readMessageReceipts` 亦如此）。⇒ 既有读者零回退。
7. **`.d.mts` 声明文件**（四份，本地手写、不参与逐字节比对）：root tsconfig 是 `allowJs` + `checkJs`，被 import 的 `.mjs` 会被一起类型检查，而冻结副本里不能写 `// @ts-nocheck`（会破坏逐字节同一性）。⇒ 用兄弟 `.d.mts` 声明类型。drift manifest 只钉四个 `.mjs`。
8. **scoped-gate 缓存的 sha 用的是 `HEAD^2` 而不是写缓存那刻的 `rev-parse develop`**：我 merge 到的 develop tip 是 `69aac66d`，而写缓存时 develop 已前进到 `cd63c8dd`。缓存记的是**门实际 gated 的那个 tip**（`69aac66d`）——记一个没跑过的 tip 会让 fan-in 错误跳过门；记实际跑过的 tip 最多让 fan-in 重跑一次门（成本，不是错误）。

### DoD 自查

四个原语在本仓库**只有一份**（AC2，含三态漂移检查），且**每一个**都有本仓库产品/脚本代码在 import（AC3，4/4；⛔ 无「只 import 一个」、无兄弟模块凑数、无「新加 import 旧副本留着」——被替换的副本已逐条归零，残留逐条登记）；折叠记录负控制真被拒（AC5）；在这个状态上 AC-253 criterion 逐字 exit 0、移走 `primitives/` 转 exit 1；三条读数均在生产载体上、均晚于落地时刻（AC6）。

## DoD

**真 landed 的判据是「四个原语在本仓库只有一份、且这一份真被本仓库的代码在用」，不是「criterion exit 0」**：`packages/quay/src/primitives/` 下四个文件逐字节等于 fleet 钉住的 SHA（AC2，含漂移检查的三态）；每个模块各有一个非测试消费者在 import 它、且被替换的手写副本命中数归零（AC3）；折叠记录的负控制真的被拒（AC5）；在**这个状态上** AC-253 的 criterion 逐字 exit 0，移走 `primitives/` 则转 exit 1（负控制，两条读数都贴）。

⛔ 不接受的替代物：把四个文件拷进来只 import 一个（机器判据绿、另外三个是 vendored 死代码 —— 正是判据"有消费者"那一半要防的形态）；**手写第二份实现**（SPEC §3.3 逐字"唯一不可接受"）；"新加 import、旧手写副本留着"（三份）；用模块自己的头注释或兄弟模块的 import 冒充消费者；跨仓漂移检查在 fleet 不可达时判 PASS（硬规则 3b：读不懂输入却返回与合格同形）；照抄 fleet 工作树而不是钉 SHA（fleet 份今天还在动，第二天即分叉）；只在单测夹具里跑过。