---
id: gap-ac294-criterion-address-helper-not-landed
title: AC-294 判据的地址派生调用 plugin/scripts/live-web-address.ts，而该共享助手尚未落到
  develop/主检出 ⇒ carrier-helper-unavailable(exit=1) ⇒
  FAIL=no-derivable-serve-address；/manager 的四条 chrome 断言在活实例上实测全绿（en nav 计数 2 /
  zh 响应 <html lang=zh / zh nav 计数 0 / 本页 title 变为「管理器 / 外层 / 内层」），且判据改写落库与判决
  pass→fail 相隔 39 秒而产品代码未动 —— 助手的拥有者是 in-flight 的
  gap-criterion-live-web-address-derivation-17-copies-to-one
status: done
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-294
---
**type:** execution

## Proposal

**缺口（立案轮直接量，2026-09-30，cwd = 主检出 `/data/home/yale/work/quay`）**

```
$ node packages/quay/bin/quay.js goal gate AC-294 --dry-run --json
⇒ {"id":"AC-294","verdict":"fail","cause":null,
   "reason":"acceptance failed (exit 1) — AC-294 candidate readings (cwd=/data/home/yale/work/quay,
    nserve=1, ncand=2, nderived=0):; pid=1709183 addr=- cause=argv-port-absent,
    carrier-helper-unavailable(exit=1); pid=1990891 addr=- cause=argv-no-serve-subcommand,
    carrier-helper-unavailable(exit=1) FAIL=no-derivable-serve-address -- 1 quay.ts serve process(es)
    with cwd=/data/home/yale/work/quay, none yielded an address (no explicit --port >= 1 on its own
    argv, and no 活服务状态载体 entry naming that pid with an up web service)",
   "timestamp":"2026-09-30T08:34:31.574Z","dryRun":true}
GATE_EXIT=1
```

**成因 —— 不是产品退化了，是判据的地址派生引用了一个仓库里不存在的文件**

AC-294 判据（`goals/AC-294-…md`，2026-09-30 由 `8dced70d3 goals: AC-294 field:criterion by cli:3969723` 改写）把地址派生那步从「内联读活宿主载体」换成了调用共享助手：

```
o=$(node --no-warnings --experimental-strip-types "$root/plugin/scripts/live-web-address.ts" "$root" "$1" 2>&1)
case "$rc:$o" in
  0:*) printf 'addr=%s\n' "$o" ;;
  1:carrier-web-down) printf 'carrier-web-down\n' ;;
  3:*) printf '%s\n' "${o:-carrier-unreadable}" ;;
  *) printf 'carrier-helper-unavailable(exit=%s)\n' "$rc" ;;
esac
```

但 `plugin/scripts/live-web-address.ts` 在**主检出、`HEAD` 与 `develop` 都不存在**（`ls` 报 No such file；`git cat-file -e develop:plugin/scripts/live-web-address.ts` 报 does not exist），只存在于在飞任务的 worktree 里（`git -C <wt> rev-list --count develop..HEAD` ⇒ 27）。于是 `node` 以 `MODULE_NOT_FOUND` 退 1，`case` 落进最后一支 ⇒ `carrier-helper-unavailable(exit=1)`。

生产 serve（pid 1709183，cwd = 仓库根）用默认内核分配端口启动（argv 无 `--port`）⇒ argv 派生分支报 `argv-port-absent`，**载体助手是唯一路径** ⇒ 它的缺席使判据**结构上恒假**，与 `/manager` 的产品行为无关。

**因果对照（硬规则 4 推论四）—— 判据改写与判决翻转相隔 39 秒，产品代码未动**

| 时刻（UTC） | 事件 |
|---|---|
| 2026-09-30T07:48:34.110Z | `gate-events.jsonl` 里 AC-294 的最后一次 **pass** |
| 2026-09-30T08:11:51Z | 判据改写落库（commit `8dced70d3`，2026-09-30 16:11:51 +0800）|
| 2026-09-30T08:12:30.007Z | `gate-events.jsonl` 里 AC-294 的**第一次 fail**（此后每轮持续 fail：08:15:33Z、08:34:00Z 同因）|

⇒ 期间 `/manager` 的产品代码一行未动，判决却由 pass 翻成 fail —— 变量是**判据文本**，不是页面。

**机制本身实测为真**（立案轮对**活实例** pid=1709183、监听 `172.28.0.1:20119` 直接真读，⛔ 不是 fixture、⛔ 不读 render 函数的返回值）：

| 段 | 抽取方式 | en | zh（`Cookie: lang=zh`）|
|---|---|---|---|
| ① 文档语言 | `grep -o '<html lang="[^"]*"'` | `<html lang="en"` | `<html lang="zh"` |
| ② nav 区块字面量 | `tr '\n' ' ' \| grep -o '<nav.*</nav>' \| grep -o 'Manager' \| wc -l` | **2** | **0** |
| ③ 本页自己的 `<title>` | `grep -oE '<title>[^<]*</title>'` | `<title>quay — Manager / Outer / Inner</title>` | `<title>quay — 管理器 / 外层 / 内层</title>` |

② 是可取假的那个量：同一谓词在 en 上读 **2**，故「zh = 0」是测量而非空断言。判据的四条断言（默认 nav 区含 `Manager`、zh 响应 `<html lang="zh"`、zh nav 区不含 `Manager`、本页 `<title>` 相对英文基线变化）**全部成立**。

**助手已存在且实测正确**（在飞 worktree 内的真读数，⛔ 非推断）：

```
$ node --no-warnings --experimental-strip-types \
    /data/home/yale/work/quay-worktrees/gap-criterion-live-web-address-derivation-17-copies-to-one/plugin/scripts/live-web-address.ts \
    /data/home/yale/work/quay 1709183
172.28.0.1:20119
HELPER_EXIT=0                      # 与活实例监听地址逐字相同
$ node .../live-web-address.ts /data/home/yale/work/quay 999999
carrier-pid-mismatch
HELPER_EXIT=3
```

⇒ 唯一缺失的是「这个文件进入 `develop`/主检出」。**助手一落地，AC-294 即转 pass，机制侧无需任何改动。**

**为什么上一个修法没保住**：前一个 AC-294 任务 `gap-ac294-manager-page-zh-chrome-nav-current-and-own-title`（done）确实把 `/manager` 接了线，而且**它的产物今天仍然为真**（上表直接量）。失效的不是那次修复，而是**判据的载体** —— 2026-09-30 的 `8dced70d3` 把地址派生整体换成对共享助手的调用，而该助手的实现尚未落进仓库。判据写侧与代码写侧解耦（goal 写立即对 store 可见并推进 develop，代码仍在 worktree）是同日在 AC-288 / AC-293 上被各立一案的同一条机制。

<!-- dedup-ref -->
**归属与现状**：助手的拥有者是 in-flight 的 `gap-criterion-live-web-address-derivation-17-copies-to-one`（`status: ready`，worktree `/data/home/yale/work/quay-worktrees/gap-criterion-live-web-address-derivation-17-copies-to-one`，分支领先 `develop` 27 提交、含该文件），以及同族已另立的 `gap-ac288-criterion-address-helper-not-landed`、`gap-ac293-criterion-address-helper-not-landed`（均 `ready`）—— 本任务是从 AC-294 视角立的同族第三条；三条的判据载体（`goals/AC-2NN-*.md`）与夹具（`packages/quay/test/ac2NN-criterion-address-derivation.test.mjs`）各自独立，只有落地面 `plugin/scripts/live-web-address.ts` 是同一个。**本任务⛔ 不重复实现助手。**

⚠️ **不在本任务收敛范围内的一条相邻欠账**：上游任务的 Evidence 记 AC-294 属于「把地址不可派生记成 exit 1（= FAIL）而非 exit 3（= NOT-EVALUATED）」的 10 条之一。改 exit 码**不会**让本 AC 变绿（它只把「测得为假」改判成「未评估」），故⛔ 不作为本任务的收敛条件；记此以免下一轮误把改 exit 码当成修法。

## Plan

**P1（不重复实现）**：**不要**从零重写助手 —— 它已在在飞分支上可用且实测正确。本任务的正面动作是让助手的产物真正进入 `develop`/主检出（由在飞任务的 fan-in 完成；若那一轮已落地，本步退化为「确认存在」）。

**P2（AC-294 回绿读数）**：对**活实例**复跑 `node packages/quay/bin/quay.js goal gate AC-294 --dry-run --json`（cwd = 仓库根）⇒ 期望 `.verdict == "pass"`；并独立对真实 pid 跑一次助手（exit 0）。

**P3（兜底：助手迟迟不落地时）**：若在飞任务卡住（`needs-human` / fan-in 反复不过）⇒ 本任务接管把助手落进仓库（Touches 已含 `plugin/scripts/live-web-address.ts`），并在同一变更内把 AC-294 判据与 `packages/quay/test/ac294-criterion-address-derivation.test.mjs` 对齐。⛔ 不得把 AC-294 判据改回内联读载体（`.quay/server.json`）—— 那是上游要收敛掉的重复形态，也违背本任务的方向。

**P4（夹具一致）**：`packages/quay/test/ac294-criterion-address-derivation.test.mjs` 与判据文本逐字绑定；改判据必须同一变更同步该夹具，两者都要绿（经 `quay goal write AC-294 --criterion …` 落库，⛔ 不手改 `goals/*.md`）。

## AC

- [x] **AC1（助手在库内）** 主检出与 `develop` 都存在该文件：`ls plugin/scripts/live-web-address.ts` exit 0 **且** `git cat-file -e develop:plugin/scripts/live-web-address.ts` exit 0。
- [x] **AC2（四条 chrome 断言·活实例·各自独立）** 对 cwd=仓库根的运行中 `quay.ts serve` 真读 `/manager`：① en nav 区块字面量 `Manager` 计数 = **2**；② zh 响应含 `<html lang="zh"`；③ zh nav 区块 `Manager` 计数 = **0**（同一谓词在 en 上 = 2 ⇒ 该量能取假，不是空断言）；④ zh 的 `<title>` 与 en 的 `<title>` 逐字不同。**四段分开贴原始片段**，⛔ 只报「整页看起来翻了」不算（硬规则 3）。
- [x] **AC3（判据回绿·活实例）** `node packages/quay/bin/quay.js goal gate AC-294 --dry-run --json` 的 `.verdict == "pass"`（cwd = 仓库根；需有 cwd=仓库根的 `quay.ts serve` 实例在跑）。
- [x] **AC4（助手真调用·非回声）** 对真实载体 `node --no-warnings --experimental-strip-types plugin/scripts/live-web-address.ts <repo-root> <web-pid>` ⇒ exit 0 且 stdout 的 `host:port` 与活实例监听地址逐字相同；传不存在的 pid ⇒ exit 3 且 stderr 为 `carrier-pid-mismatch`。
- [x] **AC5（真呼叫·负控）** 把助手临时改名 ⇒ AC-294 判据非 0 退出且 stderr 出现 `carrier-helper-unavailable`；改回 ⇒ 回绿。两次读数并排贴出。
- [x] **AC6（夹具绿）** `node --test packages/quay/test/ac294-criterion-address-derivation.test.mjs` exit 0。

## DoD

AC-294 判据在**生产载体**（主检出 cwd=仓库根的活 `quay.ts serve` + 真实载体读数）上真跑过一次并 exit 0（`verdict: pass`）—— 四条 `/manager` chrome 断言（默认 nav 含 `Manager`、zh 响应 `<html lang="zh"`、zh nav 不含 `Manager`、本页 `<title>` 相对英文基线变化）都在**运行中的服务**的 HTTP 响应上取到读数，⛔ 不是 fixture、也不是 render 函数返回值（硬规则 4 推论三）。并且 `plugin/scripts/live-web-address.ts` 在 `develop` 与主检出可见（`git show develop:` 可读），即 AC-294 的地址派生不再引用一个不存在的路径。

## Touches

- plugin/scripts/live-web-address.ts
- goals/AC-294-manager-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- packages/quay/test/ac294-criterion-address-derivation.test.mjs
- tasks/gap-ac294-criterion-address-helper-not-landed.md

（说明：第一条是 P3 兜底时的落地面，也是判据解析地址所必需的唯一文件 —— 其**实现**归 in-flight 的 `gap-criterion-live-web-address-derivation-17-copies-to-one`，本任务不重复实现；第二条是判据载体（经 `quay goal write` 落库，⛔ 不手改 `goals/*.md`）；第三条是与判据文本逐字绑定的夹具；第四条为 self-touch。）

## Evidence（执行轮，2026-09-30，worker worktree `/data/home/yale/work/quay-worktrees/gap-ac294-criterion-address-helper-not-landed`，主检出 `/data/home/yale/work/quay`）

### 走的是哪条路：P1 的【退化分支】—— 修复已由上游落地，本任务做确认 + 生产回绿读数

上游 `gap-criterion-live-web-address-derivation-17-copies-to-one` 已落地：助手随 commit `525318919`
（`converge live-web-address derivation to one definition point; 17 criteria call it`）进入 `develop`，
即 `git log -- plugin/scripts/live-web-address.ts` 在本轮只有这一条。故 P1 的正面动作退化为「确认存在」、
P2 退化为「复取读数」，**P3 兜底不触发**。

⇒ **无代码 delta**：`git -C <wt> diff develop --stat` 对本任务 Touches 的四个路径全为空
（唯一的 develop 侧差异是同轮 peer `gap-worker-prompt-guards-file-tools-not-bash` 的 task_write，不是本任务的改动）。
本任务的 delta 只有 `tasks/gap-ac294-criterion-address-helper-not-landed.md`（本轮 AC 打勾 + 本节）。

### AC 逐条读数

- **AC1（助手在库内）**：真命令退出码，非肉眼看文件树 ——
  `ls plugin/scripts/live-web-address.ts` ⇒ **exit 0**（9797 B）；
  `git cat-file -e develop:plugin/scripts/live-web-address.ts` ⇒ **exit 0**；
  且两侧 blob **字节相同**（`git hash-object <主检出>/plugin/scripts/live-web-address.ts` = `fa13316c3f7dfa7e4fbec119172128a1a8d0586f`
  = `git rev-parse develop:plugin/scripts/live-web-address.ts`）⇒ 不是「同名不同物」。
- **AC2（四条 chrome 断言·活实例·各自独立）**：见下「DoD」段，四段原始片段分开贴出。
- **AC3（判据回绿·活实例）**：`node packages/quay/bin/quay.js goal gate AC-294 --dry-run --json`（cwd = 主检出）⇒
  `verdict: "pass"`、`cause: null`、`reason: "acceptance passed (exit 0)"`、`GATE_EXIT=0`。
  立案轮同一条命令读的是 `verdict: "fail"` + `carrier-helper-unavailable(exit=1)` ⇒ **该判据能取假**，不是恒真。
- **AC4（助手真调用·非回声）**：对**真实载体** pid=1709183（生产活实例）——
  stdout `172.28.0.1:20119`、`HELPER_EXIT=0`；与两条独立读数逐字相同：`ss -ltnp` 的
  `LISTEN 0 511 172.28.0.1:20119 … users:(("MainThread",pid=1709183,fd=24))`，以及 `.quay/server.json` 的
  `services[name=web] {host:"172.28.0.1", port:20119, up:true}`。
  传 `pid=999999` ⇒ `HELPER_EXIT=3`、**stdout 为空**、stderr 恰为 `carrier-pid-mismatch`（分通道实测，⛔ 非合并 `2>&1` 的目测）。
- **AC5（真呼叫·负控）**：两臂各三读数，判据**原文**经 `/bin/sh` 跑出并单独捕获 stderr（⛔ 不是转述 goal-cli 折进 `reason` 的那份），见下节。
- **AC6（夹具绿）**：`node --test packages/quay/test/ac294-criterion-address-derivation.test.mjs` ⇒ **13/13 pass, 0 fail**，exit 0。
  该夹具在运行期 `readFileSync` `goals/AC-294-…md` 并抽出 `>>> addr-derivation` / `<<< addr-derivation` 之间的区块**逐字执行**
  ⇒ 它绑的是**当前**判据文本，故 P4「夹具一致」在本轮**无需改动即成立**。

### AC5 负控（两臂）

**臂 1 —— 生产根（主检出）**：判据需 root = 主检出，故对主检出助手 `mv` 走，
**窗口约 1 秒**并以 `trap` 保还原（该臂短暂动过共享检出，故补臂 2）：

| 臂 | 读数 |
|---|---|
| A 助手在位（基准） | `EXIT=0`，stdout 含 `OK -- /manager: … <title>="quay — Manager / Outer / Inner"` |
| B 助手 `mv` 走 | `EXIT=1`，stderr 逐字含 `cause=argv-port-absent,carrier-helper-unavailable(exit=1)` + `FAIL=no-derivable-serve-address` |
| C `mv` 回 | `EXIT=0`，与 A 同形 |

残留核查（B→C 之间无痕）：`git status --porcelain -- plugin/scripts/live-web-address.ts` 为空、
`plugin/scripts/` 下无 `.hidden`/`.renamed` 残留、文件复原为 9797 B；生产实例 pid 1709183 全程存活。

**臂 2 —— 本任务 worktree 内（⛔ 全程未碰主检出）**：worktree 自起
`serve --host 172.28.0.1 --port 0`（pid 1404051 ⇒ `172.28.0.1:18655`，跑完即按 pid 精确 kill）。
`--port 0` 使 argv 派生落 `argv-port-kernel-assigned` ⇒ **强制走载体/助手分支**，
即本案的分支；⛔ 若用 `--port N≥1` 则 helper 根本不被调用，负控会退化成空转：

| 臂 | 读数 |
|---|---|
| A 助手在位 | `EXIT=0`，`addr=172.28.0.1:18655 cause=derived-from-carrier-fetch-answered` |
| B 助手 `mv` 走 | `EXIT=1`，stderr 逐字含 `cause=argv-port-kernel-assigned,carrier-helper-unavailable(exit=1)` + `FAIL=no-derivable-serve-address` |
| C `mv` 回 | `EXIT=0`，与 A 同形 |

⇒ B 臂逐字复现了立案轮的症状形态，证明这条调用是**真调用**（硬规则 2：按位置命中调用行，不是注释/字符串）；
A/C 两臂同形且为绿，证明该负控**不是恒真**（硬规则 4：一个只会报成功的判定不是测量）。

### DoD（生产载体上的真读数，硬规则 4 推论三）

四条 `/manager` chrome 断言在**运行中的生产服务**上逐条取到读数
（`172.28.0.1:20119`，pid 1709183，cwd = 主检出），⛔ 非 fixture、⛔ 非 render 函数返回值：

**① en 响应的 `<html lang=…>`**
```
$ curl -sf http://172.28.0.1:20119/manager | grep -o '<html lang="[^"]*"'
<html lang="en"
```

**② en nav 区块的 `Manager` 计数 = 2**
```
$ curl -sf http://172.28.0.1:20119/manager | tr '\n' ' ' | grep -o '<nav.*</nav>' | grep -o 'Manager' | wc -l
2
$ … | grep -o '<nav.*</nav>' | head -c 120
<nav class="mobile-menu" aria-label="Site navigation">  <div class="mobile-menu-group">  <div class="mobile-menu-group-label">Core</div>  <a class="mobile-menu-item" href="/dashboard">Dashboard</a>…
```

**③ zh（`Cookie: lang=zh`）响应 `<html lang="zh"`，且同一谓词下 nav 区块 `Manager` 计数 = 0**
```
$ curl -sf -H 'Cookie: lang=zh' http://172.28.0.1:20119/manager | grep -o '<html lang="[^"]*"'
<html lang="zh"
$ … | tr '\n' ' ' | grep -o '<nav.*</nav>' | grep -o 'Manager' | wc -l
0
$ … | grep -o '<nav.*</nav>' | head -c 120
<nav class="mobile-menu" aria-label="Site navigation">  <div class="mobile-menu-group">  <div class="mobile-menu-group-label">核心</div>  <a class="mobile-menu-item" href="/dashboard">仪表盘</a>…
```

**④ 本页自己的 `<title>` 相对英文基线变化**
```
en: <title>quay — Manager / Outer / Inner</title>
zh: <title>quay — 管理器 / 外层 / 内层</title>
```

② 是可取假的那个量：同一谓词在 en 上读 **2**，故「zh = 0」是测量而非空断言（硬规则 3/4）。

⇒ `verdict: pass` 是在**真实载体 + 运行中的服务**上跑出来的，与立案轮「四条断言全绿、只缺地址派生」的归因一致：
**缺的是探针侧那一环，产品行为从未退化。**

### 欠账（承接上游同族，⛔ 不在本任务范围）

上游 `gap-criterion-live-web-address-derivation-17-copies-to-one` 已记：10 条判据（含 **AC-294**）把
「地址不可派生」记成 `exit 1`（= FAIL）而非仓库约定的 `exit 3`（= NOT-EVALUATED），归属
`gap-ac2XX-criterion-carrier-absence-not-evaluated` 家族（本任务两臂的 B 读数正是这条：`EXIT=1`）。
本轮⛔ **不改** AC-294 判据这一支（Plan P1 明令不重复实现、不重写判据），仅原样转记。
