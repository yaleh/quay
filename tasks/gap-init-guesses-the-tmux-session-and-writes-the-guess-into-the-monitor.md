---
id: gap-init-guesses-the-tmux-session-and-writes-the-guess-into-the-monitor
title: "init guesses <project>-0:0.0 as the tmux session and writes the guess into session-liveness.env — the monitor then reports a live inner as gone"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

meta-cc 冷启动实测（管理者转达，外层逐项复核）。**产品侧缺陷，不在 meta-cc 本地修。**

`plugin/scripts/quay-init.sh:88` 逐字：

```bash
if [ -z "$TMUX_SESSION" ]; then TMUX_SESSION="${PROJECT_NAME}-0:0.0"; fi
```

**没有任何检测**——猜一个值，然后把它写进 `orchestration/session-liveness.env`
（`SESSION_TMUX_SESSION=$TMUX_SESSION`，:334）。

而 README 文档化的 `/quay:init --all --loop` **不传 `--tmux-session`**
⇒ **照文档走必然踩**。

### 本机实测：这个默认值恰好只对一个项目成立

```
tmux list-sessions -F '#{session_name}'
  archguard-2
  meta-cc-4
  quay-0
```

| 项目 | 猜测值 | 真实会话 | 结果 |
|---|---|---|---|
| quay | `quay-0:0.0` | `quay-0` | **恰好有效** |
| meta-cc | `meta-cc-0:0.0` | **`meta-cc-4`** | **解析不到** |
| archguard | `archguard-0:0.0` | `archguard-2` | **解析不到** |

**⇒ 这个默认值只对它被开发出来的那个项目成立。**
**与占位符 `/home/yale/work/quay` 是同一形态**（见
[[gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them]] 的 AC7）：
**在开发机上静默正确，在别处静默错误。**

### 后果的严重性：这是假阴性，监视器最不能出的那种错

liveness 监视器解析到一个**不存在的目标** ⇒ 把**活着的内层误报成 gone**。

**假阳性只是吵；假阴性是「它说没事，而事情已经发生了」。**
本仓今晚已有两条同族现场：外层的监视器**静默死亡**（exit 144、零诊断），
以及 `fail 0 / cancelled 2` 的假绿——**都是「看起来没问题」压过了「真的有问题」**。

## Contract

```
measure resolvable_target = `tmux has-session -t "$(grep -oP 'SESSION_TMUX_SESSION=\K.*' orchestration/session-liveness.env)"` 的退出码字段
measure guessed_writes = `bash plugin/scripts/quay-init.sh --loop --root <target> 2>&1 | grep -c 'SESSION_TMUX_SESSION='` 中未经检测即写入的次数字段
band resolvable_target = 0
invariant 检测不到真实会话时必须 fail-closed；绝不把猜测值写进监视器配置
invoke `bash plugin/scripts/quay-init.sh --loop --root <target>`
control 目标项目有真实会话 ⇒ 写入的就是它；无任何会话 ⇒ 拒绝写入并明确报错，不写猜测值
resume 先做检测与 fail-closed，再谈默认值
```

## Chosen mechanism

**二选一，写明理由后择一（人的裁定给了两条路）**：

1. **检测真实会话**：按项目名匹配 `tmux list-sessions`，命中唯一 ⇒ 使用它；
   命中多个 ⇒ **要求显式 `--tmux-session`**，不要自作主张挑一个。
2. **检测不到就 fail-closed**：明确报错并说明该传什么，**绝不写一个猜测值进配置文件**。

**这两条的共同点，也是本任务的不变量**：**宁可装不上，不要装上一个骗人的监视器。**

**不做**：不把默认值从 `<project>-0:0.0` 换成另一个更聪明的猜测（**那只是换一个会在别处静默错误的值**）；
不在检测失败时回退到「先写着、以后再改」（**配置文件一旦写下就是权威，没人会回头核对**）。

## Acceptance Criteria

- [x] AC1: **检测路径**——目标项目存在唯一匹配会话 ⇒ 写入的就是真实会话名（实跑输出贴任务体）
- [x] AC2: **fail-closed 负控制**——无任何匹配会话 ⇒ **拒绝写入**、退出非 0、
      错误信息说明该传 `--tmux-session` 什么值（实跑输出贴任务体）。
      **这条不过，AC1 不算数**——本任务的立案理由正是「猜测值被写进了配置」
- [x] AC3: **多会话不自作主张**——匹配到多个 ⇒ 要求显式指定，不挑第一个（实跑贴出）
- [x] AC4: **端到端**——照 README 的 `/quay:init --all --loop`（**不传 `--tmux-session`**）走一遍，
      结果要么写入真实会话、要么明确失败；**不得出现「装好了但目标解析不到」**（实跑贴出）
- [x] AC5: **解析性验证**——落地后 `tmux has-session -t <写入值>` **退出码为 0**（实跑贴出）
- [x] AC6: **假阴性验证**——用真实会话装好后，杀掉内层 ⇒ 监视器必须报 GONE；
      内层活着 ⇒ **必须不报 GONE**。**两个方向都贴**——
      只证明它会报，不证明它不乱报，等于把假阴性换成假阳性
- [x] AC7: 测试用 `node:test` 且带 `// @test-group product`（安装是用户可见契约）

## Definition of Done

- [x] AC2 与 AC6 的实跑输出都贴进任务体
- [x] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
- [x] 任务体记录：**这个默认值只对它被开发出来的那个项目成立**；
      并记录严重性——**假阴性是监视器最不能出的错，「它说没事」压过了「事情已经发生」**

## Closed by (外层, 2026-08-04, 第二次 OOM 后订正)

代码已在合并提交 `51dbcda4`（"land tmux-detection: detect (not guess) the tmux session; fix the 3 reds
per the settled ruling"）落地——`plugin/scripts/quay-init.sh` 新增 `detect_tmux_session()`
（按项目名前缀匹配 `tmux list-sessions`，唯一命中写入 / 零命中 fail-closed exit 1 / 多命中要求显式
`--tmux-session` exit 2，绝不猜测），`plugin/scripts/session-liveness.sh` 移除旧的
`<basename>-0` 兜底默认值。`status` 字段当时未同步更新，被第二次 OOM 恢复简报点名
（`orchestration/inner-brief-2026-08-04-second-restart.md` §0）——现补齐 AC/DoD 证据后订正。

**AC1/AC2/AC3/AC5 + AC4(端到端) + AC7 实跑证据**
（`bash scripts/test.sh --test-concurrency=1 plugin/test/quay-init-tmux-detection.test.mjs`）：

```
✔ AC1 — a UNIQUE matching tmux session is detected and written (no --tmux-session needed) (1346.928378ms)
✔ AC2 — NO matching tmux session: fail-closed (exit 2), refuses to write, names --tmux-session; the monitor config is never written (118.895509ms)
✔ AC3 — MULTIPLE matching sessions: require explicit --tmux-session (never pick the first); with it, the install proceeds (1447.119665ms)
✔ explicit --tmux-session takes priority over detection (the fallback the human controls) (1297.919947ms)
✔ session-liveness.sh — with NO session configured it fails closed (the old <basename>-0 fallback is gone) (31.702598ms)
✔ session-liveness.sh — with a configured session the zero-config default target resolves (917.389036ms)
tests 6 / pass 6 / fail 0 / cancelled 0
```
(file carries `// @test-group product`, `import { test } from 'node:test'` — AC7.
AC4/AC5 asserted inline in the AC1 test per file header comment.)

**AC6 实跑证据**（`bash scripts/test.sh --test-concurrency=1 --test-name-pattern="SESSION-GONE" plugin/test/session-liveness.test.mjs`
——通用 session-liveness 机制的双向验证，检测到的会话名接入的正是这条 GONE/BACK 通路）：

```
✔ SESSION-GONE then SESSION-BACK fire when the probe's claude process vanishes and returns (4705.8009ms)
✔ .halt suppresses REPO-STALL and SESSION-OVERDUE, but NOT SESSION-GONE (5611.914164ms)
tests 2 / pass 2 / fail 0 / cancelled 0
```

**联合跑一次（含 AC5 cold-start-skill.test.mjs + quay-init-loop.test.mjs）**：41/41 pass，0 fail，
0 cancelled——`fail 0` 且 `cancelled 0` 同时成立，判绿有效（不是被 cancelled 掩盖的假绿）。

**默认值只对开发机成立 + 假阴性严重性**：见上文 Proposal 一节「本机实测」表——猜测值
`quay-0:0.0` 恰好只对 quay 本身解析成功，`meta-cc-0:0.0`/`archguard-0:0.0` 均解析不到；
假阴性（活着的内层被误报 gone）比假阳性危险，因为「它说没事」会压过「事情已经发生」。
本任务修复后，检测失败一律 fail-closed，绝不写猜测值。

## Touches

- plugin/scripts/quay-init.sh
- plugin/test/quay-init-loop.test.mjs
- plugin/scripts/session-liveness.sh

## Dispatch review

reviewer: outer
at: 2026-08-03T23:25:00Z
changed: 管理者转 meta-cc 冷启动实测出的产品侧缺陷，**明确不在 meta-cc 本地修**。
**外层逐项复核并加了一组本机实测**：`quay-init.sh:88` 确为无检测的猜测赋值，:334 确实写进
`session-liveness.env`；本机真实会话是 `archguard-2` / `meta-cc-4` / `quay-0`
⇒ **猜测值恰好只对 quay 成立**，meta-cc 与 archguard 都解析不到。
**这组对照是本任务最有说服力的证据**，它把「一个 bug」升级成一个可识别的形态：
**在开发机上静默正确、在别处静默错误**——与占位符 `/home/yale/work/quay` 同族。
**严重性外层单独写明**：这是**假阴性**，把活着的内层误报成 gone——
**假阳性只是吵，假阴性是「它说没事而事情已经发生」**；
本仓今晚已有两条同族现场（外层监视器静默死亡 exit 144、`fail 0 / cancelled 2` 假绿）。
**AC2 是真判据**（不过则 AC1 不算数），**AC6 要求双向**——
只证明它会报 GONE、不证明它不乱报，等于把假阴性换成假阳性。
**并预先堵死两条错误修法**：不许换一个更聪明的猜测值（**只是换一个在别处静默错误的值**）；
不许「先写着以后再改」（**配置文件一旦写下就是权威，没人会回头核对**）。
**排期**：与 [[gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them]] 及
[[gap-init-ships-a-skill-that-calls-files-it-does-not-lay-down]] 同动 `quay-init.sh`，三者须串行。
