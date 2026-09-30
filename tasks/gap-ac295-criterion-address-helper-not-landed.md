---
id: gap-ac295-criterion-address-helper-not-landed
title: AC-295 判据的地址派生调用 plugin/scripts/live-web-address.ts，而该共享助手尚未落到
  develop/主检出 ⇒ carrier-helper-unavailable(exit=1) ⇒
  FAIL=no-derivable-serve-address；/needs-human 的四条 chrome 断言在活实例上实测全绿（en nav 计数
  2 / zh 响应 <html lang=zh / zh nav 计数 0 / 本页 title 变为「待人工」），且判据改写落库与判决 pass→fail
  相隔 39 秒而产品代码未动，夹具也同步撕开（仍断言 server.json）—— 助手的拥有者是 in-flight 的
  gap-criterion-live-web-address-derivation-17-copies-to-one
status: todo
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-295
---
**type:** execution

## Proposal

**缺口（立案轮直接量，2026-09-30，cwd = 主检出 `/data/home/yale/work/quay`）**

```
$ node packages/quay/bin/quay.js goal gate AC-295 --dry-run --json
⇒ {"id":"AC-295","verdict":"fail","cause":null,
   "reason":"acceptance failed (exit 1) — AC-295 candidate readings (cwd=/data/home/yale/work/quay,
    nserve=1, ncand=2, nderived=0):; pid=1709183 addr=- cause=argv-port-absent,
    carrier-helper-unavailable(exit=1); pid=2093376 addr=- cause=argv-no-serve-subcommand,
    carrier-helper-unavailable(exit=1) FAIL=no-derivable-serve-address -- 1 quay.ts serve process(es)
    with cwd=/data/home/yale/work/quay, none yielded an address (no explicit --port >= 1 on its own
    argv, and no 活服务状态载体 entry naming that pid with an up web service)",
   "timestamp":"2026-09-30T08:37:03.815Z","dryRun":true}
```

（`ncand=2` 里的 `pid=2093376` 是 `pgrep -f 'quay.ts serve'` 自匹配到调用方自己的 bash 包装串，`argv-no-serve-subcommand`；真实候选只有 `pid=1709183`，故 `nserve=1`。）

**成因 —— 不是产品退化了，是判据的地址派生引用了一个仓库里不存在的文件**

AC-295 判据（`goals/AC-295-needs-human-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md`，2026-09-30 由 `f625ccaf2 goals: AC-295 field:criterion by cli:3971504` 改写）把地址派生那步从「内联读活宿主载体 `.quay/server.json`（node `-e` + python3 两路兜底）」换成了调用共享助手：

```sh
carrier_addr() {
  kill -0 "$1" 2>/dev/null || { echo "candidate-pid-dead"; return; }
  o=$(node --no-warnings --experimental-strip-types "$root/plugin/scripts/live-web-address.ts" "$root" "$1" 2>&1)
  rc=$?
  case "$rc:$o" in
    0:*) printf 'addr=%s\n' "$o" ;;
    1:carrier-web-down) printf 'carrier-web-down\n' ;;
    3:*) printf '%s\n' "${o:-carrier-unreadable}" ;;
    *) printf 'carrier-helper-unavailable(exit=%s)\n' "$rc" ;;
  esac
}
```

但 `plugin/scripts/live-web-address.ts` 在**主检出、`HEAD` 与 `develop` 都不存在**：

```
$ ls plugin/scripts/live-web-address.ts                        ⇒ No such file or directory   (rc=2)
$ git cat-file -e HEAD:plugin/scripts/live-web-address.ts      ⇒ fatal: ... does not exist    (rc=128)
$ git cat-file -e develop:plugin/scripts/live-web-address.ts   ⇒ fatal: ... does not exist    (rc=128)
```

它只存在于在飞任务的 worktree 里（`/data/home/yale/work/quay-worktrees/gap-criterion-live-web-address-derivation-17-copies-to-one/plugin/scripts/live-web-address.ts`，9797 字节；`git -C <wt> rev-list --count develop..HEAD` ⇒ 27）。于是 `node` 以 `MODULE_NOT_FOUND` 退 1，`case` 落进最后一支 ⇒ `carrier-helper-unavailable(exit=1)`。

生产 serve（`pid=1709183`，`cmdline = node --no-warnings --experimental-strip-types …/packages/quay/bin/quay.ts serve`，**argv 上无 `--port`**，cwd = 仓库根）用默认内核分配端口启动 ⇒ argv 派生分支报 `argv-port-absent`，**载体助手是唯一路径** ⇒ 它的缺席使判据**结构上恒假**，与 `/needs-human` 的产品行为无关。

**因果对照（硬规则 4 推论四）—— 判据改写落库与判决翻转相隔 39 秒，产品代码未动**

| 时刻（UTC） | 事件 |
|---|---|
| 2026-09-30T08:08:58.795Z | `gate-events.jsonl` 里 AC-295 的最后一次 **pass** |
| 2026-09-30T08:11:52Z | 判据改写落库（commit `f625ccaf2`，2026-09-30 16:11:52 +0800；该提交同时可达 `author` 与 `develop`）|
| 2026-09-30T08:12:31.348Z | `gate-events.jsonl` 里 AC-295 的**第一次 fail**（此后 08:15:34Z、08:34:01Z 每轮同因持续 fail）|

⇒ 期间 `/needs-human` 的产品代码一行未动，判决却由 pass 翻成 fail —— 变量是**判据文本**，不是页面。

（另注：`d1f305bbd goals: AC-295 field:criterion by cli:3508448`（2026-09-30T15:56:44+08:00 = 07:56:44Z）是同一改写的更早一次，但它**只落在在飞任务的 `task/gap-criterion-live-web-address-derivation-17-copies-to-one` 分支上**（`git branch --contains d1f305bbd` ⇒ 只有该分支；`git merge-base --is-ancestor d1f305bbd f625ccaf2` ⇒ 否），`author`/`develop` 上的权威副本那时仍是内联版，故 08:08:58Z 仍判 pass。真正的翻转提交是 `f625ccaf2`。）

**机制本身实测为真**（立案轮对**活实例** `pid=1709183`、地址由助手派生得 `172.28.0.1:20119`，直接真读，⛔ 不是 fixture、⛔ 不读 render 函数的返回值）：

| 段 | 抽取方式 | en | zh（`Cookie: lang=zh`）|
|---|---|---|---|
| ① 文档语言 | `grep -o '<html lang="[^"]*"'` | `<html lang="en"` | `<html lang="zh"` |
| ② nav 区块字面量 | `tr '\n' ' ' \| grep -o '<nav.*</nav>' \| grep -o 'Needs Human' \| wc -l` | **2** | **0** |
| ③ 本页自己的 `<title>` | `grep -oE '<title>[^<]*</title>'` | `<title>quay — Needs Human</title>` | `<title>quay — 待人工</title>` |

（同轮响应体大小：en 48124 字节 / zh 47817 字节 —— **不相等**，与「两条响应逐字节相同」的未接线形态相反。）

② 是可取假的那个量：同一谓词在 en 上读 **2**（两条命中都是 chrome 当前项：`<span class="mobile-menu-item nav-current" aria-current="page">Needs Human</span>` 与 `<div class="nav-item nav-current" aria-current="page">Needs Human</span>`），故「zh = 0」是测量而非空断言。判据的四条断言（默认 nav 区含 `Needs Human`、zh 响应 `<html lang="zh"`、zh nav 区不含 `Needs Human`、本页 `<title>` 相对英文基线变化）**全部成立**。

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

⇒ 唯一缺失的是「这个文件进入 `develop`/主检出」。**助手一落地，AC-295 即转 pass，机制侧无需任何改动。**

**同一次改写还把夹具撕开了（判据写侧与夹具读侧的独立读数）**

`packages/quay/test/ac295-criterion-address-derivation.test.mjs` 与判据文本逐字绑定（它的 `derivationBlock()` 从 goal 文本里抽块并断言块内含 `server.json`）。改写在 `develop`/主检出落库时**没有同一变更同步夹具**：`git show --stat f625ccaf2` ⇒ 只改了 goal 文件 1 个文件（+10/−36）。

```
$ git diff --stat develop -- packages/quay/test/ac295-criterion-address-derivation.test.mjs   ⇒ 空（develop 与主检出一致）
$ git show develop:packages/quay/test/ac295-criterion-address-derivation.test.mjs | grep -c 'server.json'  ⇒ 4
$ node --test packages/quay/test/ac295-criterion-address-derivation.test.mjs                  ⇒ exit 1
   12 个 "test at" 块全部失败：AssertionError [ERR_ASSERTION]: extracted block does not contain server.json
```

⇒ `develop` 上是**撕开**的：判据文本已无 `server.json`，夹具仍断言它。该夹具的修订版同样只在在飞分支上（`git -C <wt> diff --stat develop -- …ac295-…test.mjs` ⇒ +20/−45）。

**为什么上一个修法没保住**：前一个 AC-295 任务 `gap-ac295-needs-human-page-zh-chrome-nav-current-and-own-title`（done）确实把 `/needs-human` 接了线，而且**它的产物今天仍然为真**（上表四条直接量）。失效的不是那次修复，而是**判据的载体** —— 2026-09-30 的 `f625ccaf2` 把地址派生整体换成对共享助手的调用，而该助手的实现尚未落进仓库，夹具也没同步。判据写侧与代码写侧解耦（goal 写立即对 store 可见并推进 develop，代码仍在 worktree），是同日在 AC-288 / AC-293 / AC-294 上被各立一案的同一条机制。

<!-- dedup-ref -->
**归属与现状**：助手的拥有者是 in-flight 的 `gap-criterion-live-web-address-derivation-17-copies-to-one`（`status: ready`，worktree `/data/home/yale/work/quay-worktrees/gap-criterion-live-web-address-derivation-17-copies-to-one`，分支领先 `develop` 27 提交、含该文件与该夹具的修订版，并已在 `plugin/scripts/capability-catalog-declarations.json` 里完成注册），以及同族已另立的 `gap-ac288-criterion-address-helper-not-landed`、`gap-ac293-criterion-address-helper-not-landed`（均 `ready`）、`gap-ac294-criterion-address-helper-not-landed`（`todo`）—— 本任务是从 AC-295 视角立的同族第四条；各条的判据载体（`goals/AC-2NN-*.md`）与夹具（`packages/quay/test/ac2NN-criterion-address-derivation.test.mjs`）各自独立，只有落地面 `plugin/scripts/live-web-address.ts` 是同一个。**本任务⛔ 不重复实现助手，也⛔ 不重复注册 capability-catalog（已在在飞分支完成）。**

⚠️ **不在本任务收敛范围内的一条相邻欠账**：上游任务的 Evidence 记 AC-295 属于「把地址不可派生记成 exit 1（= FAIL）而非 exit 3（= NOT-EVALUATED）」的 10 条之一。改 exit 码**不会**让本 AC 变绿（它只把「测得为假」改判成「未评估」），故⛔ 不作为本任务的收敛条件；记此以免下一轮误把改 exit 码当成修法。

## Plan

**P1（不重复实现）**：**不要**从零重写助手 —— 它已在在飞分支上可用且实测正确。本任务的正面动作是让助手的产物真正进入 `develop`/主检出（由在飞任务的 fan-in 完成；若那一轮已落地，本步退化为「确认存在」）。

**P2（AC-295 回绿读数）**：对**活实例**复跑 `node packages/quay/bin/quay.js goal gate AC-295 --dry-run --json`（cwd = 仓库根）⇒ 期望 `.verdict == "pass"`；并独立对真实 pid 跑一次助手（exit 0）。

**P3（兜底：助手迟迟不落地时）**：若在飞任务卡住（`needs-human` / fan-in 反复不过）⇒ 本任务接管把助手落进仓库（Touches 已含 `plugin/scripts/live-web-address.ts`），并在同一变更内把 AC-295 判据与 `packages/quay/test/ac295-criterion-address-derivation.test.mjs` 对齐。⛔ 不得把 AC-295 判据改回内联读载体（`.quay/server.json`）—— 那是上游要收敛掉的重复形态，也违背本任务的方向。

**P4（夹具一致）**：`packages/quay/test/ac295-criterion-address-derivation.test.mjs` 与判据文本逐字绑定；改判据必须同一变更同步该夹具，两者都要绿（经 `quay goal write AC-295 --criterion …` 落库，⛔ 不手改 `goals/*.md`）。

## AC

- [ ] **AC1（助手在库内）** 主检出与 `develop` 都存在该文件：`ls plugin/scripts/live-web-address.ts` exit 0 **且** `git cat-file -e develop:plugin/scripts/live-web-address.ts` exit 0。
- [ ] **AC2（四条 chrome 断言·活实例·各自独立）** 对 cwd=仓库根的运行中 `quay.ts serve` 真读 `/needs-human`：① en nav 区块字面量 `Needs Human` 计数 = **2**；② zh 响应含 `<html lang="zh"`；③ zh nav 区块 `Needs Human` 计数 = **0**（同一谓词在 en 上 = 2 ⇒ 该量能取假，不是空断言）；④ zh 的 `<title>` 与 en 的 `<title>` 逐字不同。**四段分开贴原始片段**，⛔ 只报「整页看起来翻了」不算（硬规则 3）。
- [ ] **AC3（判据回绿·活实例）** `node packages/quay/bin/quay.js goal gate AC-295 --dry-run --json` 的 `.verdict == "pass"`（cwd = 仓库根；需有 cwd=仓库根的 `quay.ts serve` 实例在跑）。
- [ ] **AC4（助手真调用·非回声）** 对真实载体 `node --no-warnings --experimental-strip-types plugin/scripts/live-web-address.ts <repo-root> <web-pid>` ⇒ exit 0 且 stdout 的 `host:port` 与活实例监听地址逐字相同；传不存在的 pid ⇒ exit 3 且 stderr 为 `carrier-pid-mismatch`。
- [ ] **AC5（真呼叫·负控）** 把助手临时改名 ⇒ AC-295 判据非 0 退出且 stderr 出现 `carrier-helper-unavailable`；改回 ⇒ 回绿。两次读数并排贴出。
- [ ] **AC6（夹具绿）** `node --test packages/quay/test/ac295-criterion-address-derivation.test.mjs` exit 0（当前主检出上它 12 个块全红、exit 1，原因见 Proposal）。

## DoD

AC-295 判据在**生产载体**（主检出 cwd=仓库根的活 `quay.ts serve` + 真实载体读数）上真跑过一次并 exit 0（`verdict: pass`）—— 四条 `/needs-human` chrome 断言（默认 nav 含 `Needs Human`、zh 响应 `<html lang="zh"`、zh nav 不含 `Needs Human`、本页 `<title>` 相对英文基线变化）都在**运行中的服务**的 HTTP 响应上取到读数，⛔ 不是 fixture、也不是 render 函数返回值（硬规则 4 推论三）。并且 `plugin/scripts/live-web-address.ts` 在 `develop` 与主检出可见（`git show develop:` 可读），即 AC-295 的地址派生不再引用一个不存在的路径，且其绑定的夹具在同一变更内同步变绿。

## Touches

- plugin/scripts/live-web-address.ts
- goals/AC-295-needs-human-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- packages/quay/test/ac295-criterion-address-derivation.test.mjs
- tasks/gap-ac295-criterion-address-helper-not-landed.md

（说明：第一条是 P3 兜底时的落地面，也是判据解析地址所必需的唯一文件 —— 其**实现**与 capability-catalog 注册归 in-flight 的 `gap-criterion-live-web-address-derivation-17-copies-to-one`，本任务不重复实现、不重复注册；第二条是判据载体（经 `quay goal write` 落库，⛔ 不手改 `goals/*.md`）；第三条是与判据文本逐字绑定的夹具；第四条为 self-touch。）
