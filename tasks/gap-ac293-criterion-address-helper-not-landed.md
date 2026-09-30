---
id: gap-ac293-criterion-address-helper-not-landed
title: AC-293 判据的地址派生调用 plugin/scripts/live-web-address.ts，而该共享助手尚未落到
  develop/主检出 ⇒ carrier-helper-unavailable(exit=1) ⇒
  FAIL=no-derivable-serve-address；/system 的四条 chrome 断言实测全绿（默认 nav 含 "System"、zh
  响应 <html lang="zh"、zh nav 不含 "System"、本页 title 相对英文基线变化），仅「助手未落地」这一步悬空 ——
  助手的拥有者是 in-flight 的 gap-criterion-live-web-address-derivation-17-copies-to-one
status: todo
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-293
---
**type:** execution

## Proposal

**缺口（立案轮直接量，2026-09-30，cwd = 主检出 `/data/home/yale/work/quay`）**

`node packages/quay/bin/quay.ts goal gate AC-293 --dry-run --json` ⇒ `verdict: "fail"`：

```
AC-293 candidate readings (cwd=/data/home/yale/work/quay, nserve=1, ncand=2, nderived=0):
  pid=800458 addr=- cause=argv-no-serve-subcommand,carrier-helper-unavailable(exit=1)
  pid=1709183 addr=- cause=argv-port-absent,carrier-helper-unavailable(exit=1)
FAIL=no-derivable-serve-address -- 1 quay.ts serve process(es) with cwd=/data/home/yale/work/quay,
none yielded an address (no explicit --port >= 1 on its own argv, and no 活服务状态载体 entry
naming that pid with an up web service)
```

**成因 —— 不是产品退化了，是判据的地址派生引用了一个仓库里不存在的文件**

AC-293 判据（`goals/AC-293-system-…md`，2026-09-30 由 `5cb3bbc74 goals: AC-293 field:criterion` 改写）把地址派生那步从「内联读 `.quay/server.json`」换成了调用共享助手：

```
o=$(node --no-warnings --experimental-strip-types "$root/plugin/scripts/live-web-address.ts" "$root" "$1" 2>&1)
case "$rc:$o" in
  0:*) printf 'addr=%s\n' "$o" ;;
  1:carrier-web-down) printf 'carrier-web-down\n' ;;
  3:*) printf '%s\n' "${o:-carrier-unreadable}" ;;
  *) printf 'carrier-helper-unavailable(exit=%s)\n' "$rc" ;;
esac
```

但 `plugin/scripts/live-web-address.ts` 在**主检出与 `develop` 都不存在**（`ls plugin/scripts/live-web-address.ts` 报 No such file；`git cat-file -e develop:plugin/scripts/live-web-address.ts` 报 does not exist）。于是 `node` 以 `MODULE_NOT_FOUND` 退 1，`case` 落进最后一支 ⇒ `carrier-helper-unavailable(exit=1)`。

生产 serve（pid 1709183，cwd = 仓库根）用默认内核分配端口启动（argv 无 `--port`）⇒ argv 派生分支报 `argv-port-absent`，**载体助手是唯一路径** ⇒ 它的缺席使判据**结构上恒假**，与 /system 的产品行为无关。

**机制本身实测为真**（立案轮用 in-flight worktree 内的助手对活实例 1709183 真读，逐条 curl `/system`）：

- 无 cookie ⇒ `<nav>` 区块含 `System` ✓（默认基线）
- `Cookie: lang=zh` ⇒ 响应 `<html lang="zh"` ✓
- `Cookie: lang=zh` 的 `<nav>` 区块**不含** `System`（已翻译）✓
- 本页 `<title>`：en = `quay — System — system status`，zh = `quay — 系统 — 系统状态` ⇒ **不相等** ✓

⇒ 四条断言全绿，唯一取不到的是「派生地址」这一步 ⇒ 这是一条**探针侧**缺陷，不是产品缺陷。

**为什么上一个修法没保住**：`gap-ac293-criterion-cmdline-port-literal-stale`（done）把派生重锚到「内联读 `.quay/server.json`」，一直有效 —— 直到 2026-09-30 的 `5cb3bbc74`（属于 `gap-criterion-live-web-address-derivation-17-copies-to-one` 的 P2「17 条判据改调共享助手」）把那段内联块整体换成助手调用，**而同一任务的 P1（新增助手）尚未落进仓库**。判据写侧与代码写侧解耦（goal 写立即对 store 可见并推进 develop，代码仍在 worktree）是这条缺口的机制。

<!-- dedup-ref -->
**归属与现状**：助手的拥有者是 in-flight 的 `gap-criterion-live-web-address-derivation-17-copies-to-one`（`status: ready`，worktree `/data/home/yale/work/quay-worktrees/gap-criterion-live-web-address-derivation-17-copies-to-one`，其分支已含该文件与 commit `525318919`）；同一机制在 AC-288 上已另立 `gap-ac288-criterion-address-helper-not-landed`（`status: todo`）—— 本任务是从 AC-293 视角立的同族任务，判据载体与夹具与 AC-288 各自独立。立案轮对助手做过真实载体读数：`node --no-warnings --experimental-strip-types <worktree>/plugin/scripts/live-web-address.ts /data/home/yale/work/quay 1709183` ⇒ stdout `172.28.0.1:20119`、exit 0。**⇒ 助手只要落进 develop/主检出，AC-293 即转为 pass（助手已实测正确，机制侧无需任何改动）。**

## Plan

**P1（不重复实现）**：**不要**从零重写助手 —— 它已在 in-flight 分支上可用且正确。本任务的正面动作是让助手的产物真正进入 `develop`/主检出（由 `gap-criterion-live-web-address-derivation-17-copies-to-one` 的 fan-in 完成；若那一轮已落地，本步退化为「确认存在」）。

**P2（AC-293 回绿读数）**：对**活实例**复跑 `node packages/quay/bin/quay.ts goal gate AC-293 --dry-run --json`（cwd = 仓库根）⇒ 期望 `.verdict == "pass"`；并独立对真实 pid 跑一次助手（exit 0）。

**P3（兜底：助手迟迟不落地时）**：若上游任务卡住（`needs-human` / fan-in 反复不过）⇒ 本任务接管把助手落进仓库（Touches 已含 `plugin/scripts/live-web-address.ts`），并在同一变更内把 AC-293 判据与 `packages/quay/test/ac293-criterion-address-derivation.test.mjs` 对齐。⛔ 不得把 AC-293 判据改回内联读 `.quay/server.json` —— 那是上游要收敛掉的重复形态，也违背本任务的方向。

**P4（夹具一致）**：`packages/quay/test/ac293-criterion-address-derivation.test.mjs` 与判据文本逐字绑定；改判据必须同一变更同步该夹具，两者都要绿（经 `quay goal write AC-293 --criterion …` 落库，⛔ 不手改 `goals/*.md`）。

## AC

- [ ] AC1（助手在库内）主检出与 `develop` 都存在该文件：`ls plugin/scripts/live-web-address.ts` exit 0 **且** `git cat-file -e develop:plugin/scripts/live-web-address.ts` exit 0。
- [ ] AC2（判据回绿·活实例）`node packages/quay/bin/quay.ts goal gate AC-293 --dry-run --json` 的 `.verdict == "pass"`（cwd = 仓库根，需有 cwd=仓库根的 `quay.ts serve` 实例在跑）。
- [ ] AC3（助手真调用·非回声）对**真实载体** `node --no-warnings --experimental-strip-types plugin/scripts/live-web-address.ts <repo-root> <web-pid>` ⇒ exit 0 且 stdout 的 `host:port` 与活实例地址一致；传不存在的 pid ⇒ exit 3 且 stderr 为 `carrier-pid-mismatch`。
- [ ] AC4（呼叫是真呼叫·负控）把助手临时改名 ⇒ AC-293 判据非 0 退出且 stderr 出现 `carrier-helper-unavailable`；改回 ⇒ 回绿。
- [ ] AC5（夹具绿）`node --test packages/quay/test/ac293-criterion-address-derivation.test.mjs` exit 0。

## DoD

AC-293 判据在**生产载体**（主检出 cwd=仓库根的活 `quay.ts serve` + 真实载体读数）上真跑过一次并 exit 0（`verdict: pass`），四条 /system chrome 断言（默认 nav 含 `System`、zh 响应 `<html lang="zh"`、zh nav 不含 `System`、本页 `<title>` 相对英文基线变化）都在**运行中的服务**上取到读数，⛔ 不是 fixture（硬规则 4 推论三）。并且 `plugin/scripts/live-web-address.ts` 在 `develop` 与主检出可见（`git show develop:` 可读），即 AC-293 的地址派生不再引用一个不存在的路径。

## Touches

- plugin/scripts/live-web-address.ts
- goals/AC-293-system-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- packages/quay/test/ac293-criterion-address-derivation.test.mjs
- tasks/gap-ac293-criterion-address-helper-not-landed.md

（说明：第一条是 P3 兜底时的落地面，也是判据解析地址所必需的唯一文件 —— 其**实现**归 in-flight 的 `gap-criterion-live-web-address-derivation-17-copies-to-one`，本任务不重复实现；第二条是判据载体（经 `quay goal write` 落库，⛔ 不手改）；第三条是与判据文本逐字绑定的夹具；第四条为 self-touch。）