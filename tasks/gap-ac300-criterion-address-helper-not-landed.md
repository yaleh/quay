---
id: gap-ac300-criterion-address-helper-not-landed
title: AC-300 判据的地址派生调用 plugin/scripts/live-web-address.ts，而该共享助手尚未落到
  develop/主检出 ⇒ carrier-helper-unavailable(exit=1) ⇒
  FAIL=no-derivable-serve-address；/adr 的五条 chrome 断言在活实例上实测全绿（en nav 计数 2 / zh
  响应 <html lang=zh / zh nav 计数 0 / 本页 title 变为「quay — 架构决策」 / 移动 header
  变为「架构决策」），且判据改写落库与判决 pass→fail 相隔 31 秒而产品代码未动，夹具也同步撕开（仍断言 server.json）——
  助手的拥有者是 in-flight 的 gap-criterion-live-web-address-derivation-17-copies-to-one
status: ready
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-300
---
**type:** execution

## Proposal

**缺口（立案轮直接量，`2026-09-30T08:50:18.488Z`，cwd = 主检出 `/data/home/yale/work/quay`）**

```
$ node packages/quay/bin/quay.js goal gate AC-300 --dry-run --json
⇒ {"id":"AC-300","verdict":"fail","cause":null,
   "reason":"acceptance failed (exit 1) — AC-300 candidate readings (cwd=/data/home/yale/work/quay, nserve=1, ncand=2, nderived=0):;
             pid=1709183 addr=- cause=argv-port-absent,carrier-helper-unavailable(exit=1);
             pid=3077233 addr=- cause=argv-no-serve-subcommand,carrier-helper-unavailable(exit=1)
             FAIL=no-derivable-serve-address -- 1 quay.ts serve process(es) with cwd=/data/home/yale/work/quay, none yielded an address
             (no explicit --port >= 1 on its own argv, and no 活服务状态载体 entry naming that pid with an up web service)",
   "timestamp":"2026-09-30T08:50:18.488Z","dryRun":true}
```

（`pid=3077233` 是 `pgrep -f 'quay.ts serve'` 自匹配到调用方自己的 bash 包装串，`argv-no-serve-subcommand`；真实候选只有生产 serve `pid=1709183`。）

**成因 —— 不是产品退化了，是判据的地址派生引用了一个仓库里不存在的文件**

AC-300 判据（`goals/AC-300-*.md`，2026-09-30 由 `3e57e6f7a goals: AC-300 field:criterion by cli:3976388` 改写）把地址派生那步从「内联读活宿主载体」换成了调用共享助手：

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
$ ls plugin/scripts/live-web-address.ts                       ⇒ No such file or directory (rc=2)
$ git cat-file -e HEAD:plugin/scripts/live-web-address.ts     ⇒ fatal: ... does not exist (rc=128)
$ git cat-file -e develop:plugin/scripts/live-web-address.ts  ⇒ fatal: ... does not exist (rc=128)
```

它只存在于在飞任务的 worktree 里（`/data/home/yale/work/quay-worktrees/gap-criterion-live-web-address-derivation-17-copies-to-one/plugin/scripts/live-web-address.ts`，9797 字节；`git -C <wt> rev-list --count develop..HEAD` ⇒ 30）。于是 `node` 以 `MODULE_NOT_FOUND` 退 1，`case` 落进最后一支 ⇒ `carrier-helper-unavailable(exit=1)`。

生产 serve（`pid=1709183`，`readlink /proc/1709183/cwd` = `/data/home/yale/work/quay`，argv 上**无** `--host`/`--port` ⇒ 默认内核分配端口）⇒ argv 派生分支报 `argv-port-absent`，**共享助手是唯一路径** ⇒ 它的缺席使判据**结构上恒假**，与 `/adr` 的产品行为无关。

**因果对照（硬规则 4 推论四）—— 判据改写落库与判决 pass→fail 相隔 31 秒，产品代码未动**

| 时刻（UTC） | 事件 | 取法 |
|---|---|---|
| 2026-09-30T07:42:49.139Z | AC-300 的最后一次 **pass**（criterionHash `c1abce198079dcf3`）| `.quay/gate-events.jsonl` |
| 2026-09-30T08:11:58Z | 判据改写落库（`3e57e6f7a`，`git log -1 --format=%ci` = 2026-09-30 16:11:58 +0800）| `git show --stat 3e57e6f7a` |
| 2026-09-30T08:12:29.744Z | AC-300 的**第一次 fail**（criterionHash `f5d64ed6a2f74ea2`）| `.quay/gate-events.jsonl` |

`git show --stat 3e57e6f7a` ⇒ 1 file changed, +10/−36，**只改了 goal 文件 1 个文件，未同步夹具**。⇒ 期间 `/adr` 的产品代码一行未动，判决却由 pass 翻成 fail —— 变量是**判据文本**，不是页面。

**机制本身实测为真**（立案轮对**活实例** `pid=1709183`、地址由在飞 worktree 内的助手派生得 `172.28.0.1:20119`，直接真读 HTTP 响应，⛔ 不是 fixture、⛔ 不读 render 函数的返回值）：

| 段 | 抽取方式 | en | zh（`Cookie: lang=zh`）|
|---|---|---|---|
| ① nav 区块字面量 `ADRs` | `tr '\n' ' ' \| grep -o '<nav.*</nav>' \| grep -o 'ADRs' \| wc -l` | **2** | **0** |
| ② 文档语言 | `grep -o '<html lang="[^"]*"'` | `<html lang="en"` | `<html lang="zh"` |
| ③ 本页自己的 `<title>` | `grep -oE '<title>[^<]*</title>'` | `quay — ADRs` | `quay — 架构决策` |
| ④ 移动 header 页名 | `grep -o 'mobile-header-page[^>]*>[^<]*'` | `mobile-header-page">adrs` | `mobile-header-page">架构决策` |
| ⑤ `<h1>` | `grep -oE '<h1>[^<]*</h1>'` | `<h1>ADRs (36)</h1>` | `<h1>架构决策 (36)</h1>` |

（同轮响应体大小：en 44099 字节 / zh 44110 字节 —— **不相等**，与「两条响应逐字节相同」的未接线形态相反。）

① 是可取假的那个量：同一谓词在 en 上读 **2**，故「zh = 0」是测量而非空断言。判据的四条断言（默认 nav 区含 `ADRs`、zh 响应 `<html lang="zh"`、zh nav 区不含 `ADRs`、本页 `<title>` 相对英文基线变化）**全部成立**。

**助手已存在且实测正确**（在飞 worktree 内的真读数，⛔ 非推断）：

```
$ node --no-warnings --experimental-strip-types <wt>/plugin/scripts/live-web-address.ts /data/home/yale/work/quay 1709183
172.28.0.1:20119              HELPER_EXIT=0     # 与 .quay/server.json 的 web 服务（up:true, port 20119）逐字相同
$ node --no-warnings --experimental-strip-types <wt>/plugin/scripts/live-web-address.ts /data/home/yale/work/quay 999999
carrier-pid-mismatch          HELPER_BADPID_EXIT=3
```

⇒ 唯一缺失的是「这个文件进入 `develop`/主检出」。**助手一落地，AC-300 即转 pass，机制侧无需任何改动。**

**同一次改写还把夹具撕开了（判据写侧与夹具读侧的独立读数）**

`packages/quay/test/ac300-criterion-address-derivation.test.mjs` 与判据文本逐字绑定（其 `derivationBlock()` 从 goal 文本抽块并断言块内含 `server.json`）。改写在 `develop`/主检出落库时**没有同一变更同步夹具**（`git show --stat 3e57e6f7a -- packages/quay/test/` ⇒ 空）。实测：

```
$ grep -c 'server.json' packages/quay/test/ac300-criterion-address-derivation.test.mjs   ⇒ 4（仍断言）
$ grep -c 'server.json' goals/AC-300-*.md                                                ⇒ 0（判据已不再含该字面量）
$ node --test packages/quay/test/ac300-criterion-address-derivation.test.mjs             ⇒ exit 1
   AssertionError [ERR_ASSERTION]: extracted block does not contain server.json
      at derivationBlock (…/ac300-criterion-address-derivation.test.mjs:103:12)
```

在飞分支上该夹具**已同步**（断言 `live-web-address.ts` 而非 `server.json`，并 import `packages/quay/test/helpers/live-web-address-fixture.mjs`；`capability-catalog-declarations.json` 亦已含 9 处注册）—— 又一次说明缺的只是**落地**。

**为什么上一个修法没保住**：前两个 AC-300 任务 —— `gap-ac300-adr-page-zh-chrome-nav-current-and-own-title`（done）与 `gap-ac300-criterion-cmdline-port-literal-stale`（done，2026-09-23 重锚地址派生到「内联读 `.quay/server.json`」）—— **它们的产物今天仍然为真**（上表五条直接量）。缺口来自 2026-09-30 的 `3e57e6f7a`（属于 `gap-criterion-live-web-address-derivation-17-copies-to-one` 的「17 条判据改调共享助手」）把那段内联块整体换成助手调用，**而同一任务的「新增助手」尚未落进仓库**。判据写侧与代码写侧解耦（goal 写立即对 store 可见并推进 develop，代码仍在 worktree）是这条缺口的机制，同日已在 AC-288 / AC-293 / AC-294 / AC-295 / AC-296 / AC-298 / AC-299 上各立一案。

**拒绝语与事实不符（硬规则 3b 相邻）**：判据打出的是 `FAIL=no-derivable-serve-address`，其正文断言「no 活服务状态载体 entry naming that pid with an up web service」—— 但载体**确实** naming 该 pid（`.quay/server.json` ⇒ `pid 1709183` / `name:"web"` / `up:true` / `port:20119`）。真实的失败是「读载体的助手不存在」，却被报成「载体没命名它」，使该取值同时承担两种互不相同的成因。

⚠️ **不在本任务收敛范围内的一条相邻欠账**：本判据属于「把地址不可派生/不可评估记成 exit 1（= FAIL）而非 exit 3（= NOT-EVALUATED）」的同族（`packages/quay/src/goal-store.ts:305-318` 逐字给出 `NOT-EVALUATED: carrier absent` 恰为该约定之例）。改 exit 码**不会**让本 AC 变绿（它只把「测得为假」改判成「未评估」），故⛔ 不作为本任务的收敛条件；该族由 `gap-ac292-criterion-carrier-absence-not-evaluated` 承载，记此以免下一轮误把改 exit 码当成修法。

<!-- dedup-ref -->
**归属与现状**：助手的拥有者是 in-flight 的 `gap-criterion-live-web-address-derivation-17-copies-to-one`（`status: ready`，worktree `/data/home/yale/work/quay-worktrees/gap-criterion-live-web-address-derivation-17-copies-to-one`，分支领先 `develop` 30 提交，含该文件）。同族已另立 `gap-ac288-criterion-address-helper-not-landed`、`gap-ac293-criterion-address-helper-not-landed`、`gap-ac294-criterion-address-helper-not-landed`、`gap-ac295-criterion-address-helper-not-landed`、`gap-ac296-criterion-address-helper-not-landed`、`gap-ac298-criterion-address-helper-not-landed`、`gap-ac299-criterion-address-helper-not-landed` —— 本任务是从 AC-300 视角立的同族第八条；各条的判据载体（`goals/AC-2NN-*.md`）与夹具（`packages/quay/test/ac2NN-criterion-address-derivation.test.mjs`）各自独立，只有落地面 `plugin/scripts/live-web-address.ts` 是同一个。**本任务⛔ 不重复实现助手，也⛔ 不重复注册 capability-catalog（已在在飞分支完成）。**

## Plan

**P1（不重复实现）**：**不要**从零重写助手 —— 它已在在飞分支上可用且实测正确。本任务的正面动作是让助手的产物真正进入 `develop`/主检出（由在飞任务的 fan-in 完成；若那一轮已落地，本步退化为「确认存在」）。

**P2（AC-300 回绿读数）**：对**活实例**复跑 `node packages/quay/bin/quay.js goal gate AC-300 --dry-run --json`（cwd = 仓库根）⇒ 期望 `.verdict == "pass"`；并独立对真实 pid 跑一次助手（exit 0）。

**P3（兜底：助手迟迟不落地时）**：若在飞任务卡住（`needs-human` / fan-in 反复不过）⇒ 本任务接管把助手落进仓库（Touches 已含 `plugin/scripts/live-web-address.ts`），并在同一变更内把 AC-300 判据与 `packages/quay/test/ac300-criterion-address-derivation.test.mjs` 对齐。⛔ 不得把 AC-300 判据改回内联读载体（`.quay/server.json`）—— 那是上游要收敛掉的重复形态，也违背本任务的方向。

**P4（夹具一致）**：`packages/quay/test/ac300-criterion-address-derivation.test.mjs` 与判据文本逐字绑定；改判据必须同一变更同步该夹具，两者都要绿（经 `quay goal write AC-300 --criterion …` 落库，⛔ 不手改 `goals/*.md`）。

## AC

- [ ] **AC1（助手在库内）** 主检出与 `develop` 都存在该文件：`ls plugin/scripts/live-web-address.ts` exit 0 **且** `git cat-file -e develop:plugin/scripts/live-web-address.ts` exit 0。
- [ ] **AC2（四条 chrome 断言·活实例·各自独立）** 对 cwd=仓库根的运行中 `quay.ts serve` 真读 `/adr`：① en nav 区块字面量 `ADRs` 计数 ≥ 1；② zh 响应含 `<html lang="zh"`；③ zh nav 区块 `ADRs` 计数 = **0**（同一谓词在 en 上 ≥ 1 ⇒ 该量能取假，不是空断言）；④ zh 的 `<title>` 与 en 的 `<title>` 逐字不同。**四段分开贴原始片段**，⛔ 只报「整页看起来翻了」不算（硬规则 3）。
- [ ] **AC3（判据回绿·活实例）** `node packages/quay/bin/quay.js goal gate AC-300 --dry-run --json` 的 `.verdict == "pass"`（cwd = 仓库根；需有 cwd=仓库根的 `quay.ts serve` 实例在跑）。
- [ ] **AC4（助手真调用·非回声）** 对真实载体 `node --no-warnings --experimental-strip-types plugin/scripts/live-web-address.ts <repo-root> 1709183` ⇒ exit 0 且 stdout 的 `host:port` 与 `.quay/server.json` 的 web 服务逐字相同；传不存在的 pid ⇒ exit 3 且 stderr 为 `carrier-pid-mismatch`。
- [ ] **AC5（真呼叫·负控）** 把助手临时改名 ⇒ AC-300 判据非 0 退出且 stderr 出现 `carrier-helper-unavailable`；改回 ⇒ 回绿。两次读数并排贴出。
- [ ] **AC6（夹具绿）** `node --test packages/quay/test/ac300-criterion-address-derivation.test.mjs` exit 0（当前主检出与 `develop` 上均 `exit 1`，块内报 `extracted block does not contain server.json`，见 Proposal）。

## DoD

AC-300 判据在**生产载体**（主检出 cwd=仓库根的活 `quay.ts serve` + 真实载体读数）上真跑过一次并 exit 0（`verdict: pass`）—— 四条 `/adr` chrome 断言（默认 nav 含 `ADRs`、zh 响应 `<html lang="zh"`、zh nav 不含 `ADRs`、本页 `<title>` 相对英文基线变化）都在**运行中的服务**的 HTTP 响应上取到读数，⛔ 不是 fixture、也不是 render 函数返回值（硬规则 4 推论三）。并且 `plugin/scripts/live-web-address.ts` 在 `develop` 与主检出可见（`git show develop:` 可读），即 AC-300 的地址派生不再引用一个不存在的路径，且其绑定的夹具在同一变更内同步变绿。

## Touches

- plugin/scripts/live-web-address.ts
- goals/AC-300-adr-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- packages/quay/test/ac300-criterion-address-derivation.test.mjs
- tasks/gap-ac300-criterion-address-helper-not-landed.md

（说明：第一条是 P3 兜底时的落地面，也是判据解析地址所必需的唯一文件 —— 其**实现**与 capability-catalog 注册归 in-flight 的 `gap-criterion-live-web-address-derivation-17-copies-to-one`，本任务不重复实现、不重复注册；第二条是判据载体（经 `quay goal write` 落库，⛔ 不手改 `goals/*.md`）；第三条是与判据文本逐字绑定的夹具；第四条为 self-touch。）