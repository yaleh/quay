---
id: gap-ac288-criterion-address-helper-not-landed
title: AC-288 判据在 2026-09-30 16:11（commit c7075a155）被重写为调用
  plugin/scripts/live-web-address.ts，而该共享助手尚未落到 develop/主检出 ⇒ 地址派生
  carrier-helper-unavailable(exit=1) ⇒ CAUSE=no-derivable-address；机制本身实测为真（en /
  ?lang=zh / cookie 三断言全绿），仅「助手未落地」这一步悬空 —— 助手的拥有者是 in-flight 的
  gap-criterion-live-web-address-derivation-17-copies-to-one（其 worktree
  内已有该文件，对真实载体返回 172.28.0.1:20119 / exit 0）
status: todo
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-288
---
**type:** execution

## Proposal

**缺口（立案轮直接量，2026-09-30，cwd = 主检出 `/data/home/yale/work/quay`）**

`node packages/quay/bin/quay.js goal gate AC-288 --dry-run --json` ⇒ `verdict: "fail"`：

```
acceptance failed (exit 1) — CAUSE=no-derivable-address -- pgrep -f 'quay.ts serve' x
cwd=/data/home/yale/work/quay matched candidate(s) but none yielded a live web address
(an explicit --port >= 1 on the process's own argv, or this root's live-service state
carrier naming that pid's web service)
CANDIDATES: | pid=1709183 addr=- cause=argv-port-absent,carrier-helper-unavailable(exit=1)
```

**成因 —— 不是机制退化了，是判据的地址派生引用了一个仓库里不存在的文件**

AC-288 判据（`goals/AC-288-…md`，2026-09-30T16:11:45+08:00 commit `c7075a155`，已在 `develop`）把地址派生那步从「内联读 `.quay/server.json`」换成了调用共享助手：

```
o=$(node --no-warnings --experimental-strip-types "$root/plugin/scripts/live-web-address.ts" "$root" "$1" 2>&1)
case "$rc:$o" in
  0:*) printf 'addr=%s\n' "$o" ;;
  1:carrier-web-down) printf 'carrier-web-down\n' ;;
  3:*) printf '%s\n' "${o:-carrier-unreadable}" ;;
  *) printf 'carrier-helper-unavailable(exit=%s)\n' "$rc" ;;
esac
```

但 `plugin/scripts/live-web-address.ts` 在**主检出与 `develop` 都不存在**（`test -f plugin/scripts/live-web-address.ts` 报 No such file；`git show develop:plugin/scripts/live-web-address.ts` 报 does not exist）。于是 `node` 以 `MODULE_NOT_FOUND` 退 1，`case` 落进最后一支 ⇒ `carrier-helper-unavailable(exit=1)`。

生产 serve（pid 1709183，cwd = 仓库根）是用默认内核分配端口启动的（argv 无 `--port`），argv 派生分支 ⇒ `argv-port-absent`，**载体助手是唯一路径** ⇒ 它的缺席使判据**结构上恒假**，与产品行为无关。

**机制本身实测为真**（对 `.quay/server.json` 的 web 条目 `172.28.0.1:20119` 逐条 curl，2026-09-30 立案轮）：

- 无 query、无 cookie ⇒ `<html lang="en"`
- `?lang=zh` ⇒ `<html lang="zh"`，且响应头含 `Set-Cookie: lang=zh; Path=/; Max-Age=31536000; SameSite=Lax`
- 仅 `Cookie: lang=zh`（URL 无 `?lang=`）⇒ `<html lang="zh"`

⇒ 这是一条**探针侧**缺陷，不是产品缺陷：断言 1/2/3/4 全绿，只有「派生地址」这一步取不到地址。

**为什么上一个修法没保住**：`gap-ac288-criterion-cmdline-port-literal-stale`（done）把派生重锚到「内联读 `.quay/server.json`」，一直有效 —— 直到今天的 `c7075a155`（属于 `gap-criterion-live-web-address-derivation-17-copies-to-one` 的 P2「17 条判据改调共享助手」）把那段内联块整体换成了助手调用，**而同一任务的 P1（新增助手）尚未落地**。上游任务自己的正文写着「P1 与 P2 必须同一次落地」；实际发生的是 **P2 单独先落地** ⇒ 17 条判据（含 AC-288）此刻全部引用一个不存在的路径。判据写侧与代码写侧解耦（goal 写立即对 store 可见并推进 develop，代码仍在 worktree）是这条缺口的机制。

<!-- dedup-ref -->
**归属与现状**：助手的拥有者是 in-flight 的 `gap-criterion-live-web-address-derivation-17-copies-to-one`（`status: ready`，worktree `/data/home/yale/work/quay-worktrees/gap-criterion-live-web-address-derivation-17-copies-to-one`，分支 `task/gap-criterion-live-web-address-derivation-17-copies-to-one` 已含 commit `525318919`）。立案轮对该分支上的助手做过**真实载体**读数：`node --no-warnings --experimental-strip-types <worktree>/plugin/scripts/live-web-address.ts /data/home/yale/work/quay 1709183` ⇒ stdout `172.28.0.1:20119`、exit 0；传不存在的 pid ⇒ stderr `carrier-pid-mismatch`、exit 3。**⇒ 助手只要落地，AC-288 即转为 pass（三态助手已实测正确，机制侧无需任何改动）。**

## Plan

**P1（不重复实现）**：**不要**从零重写助手 —— 它已在 in-flight 分支上可用且正确。本任务的正面动作是让 P1 的产物真正进入 `develop`/主检出（由 `gap-criterion-live-web-address-derivation-17-copies-to-one` 的 fan-in 完成；若那一轮已落地，本步退化为「确认」）。

**P2（AC-288 回绿读数）**：对**活实例**复跑判据 `node packages/quay/bin/quay.js goal gate AC-288 --dry-run --json`（cwd = 仓库根）⇒ 期望 `.verdict == "pass"`；并独立对真实 `.quay/server.json` 跑一次助手（exit 0）。

**P3（兜底：助手迟迟不落地时）**：若上游任务卡住（`needs-human` / fan-in 反复不过）⇒ 本任务接管把助手落进仓库（Touches 已含 `plugin/scripts/live-web-address.ts`），并在同一变更内把 AC-288 判据与 `packages/quay/test/ac288-criterion-address-derivation.test.mjs` 对齐。⛔ 不得把 AC-288 判据改回内联读 `.quay/server.json` —— 那正是上游 P4 的复发检查器 `criterion-carrier-inline-check.ts` 会判红的重复形态，也违背本任务要收敛的方向。

**P4（夹具一致）**：`packages/quay/test/ac288-criterion-address-derivation.test.mjs` 与判据文本逐字绑定；改判据必须同一变更同步该夹具，两者都要绿（经 `quay goal write AC-288 --criterion …` 落库，⛔ 不手改 `goals/*.md`）。

## AC

- [ ] AC1（助手在库内）主检出与 `develop` 都存在该文件：`test -f plugin/scripts/live-web-address.ts` exit 0 **且** `git show develop:plugin/scripts/live-web-address.ts >/dev/null` exit 0。
- [ ] AC2（判据回绿·活实例）`node packages/quay/bin/quay.js goal gate AC-288 --dry-run --json` 的 `.verdict == "pass"`（cwd = 仓库根，需有 cwd=仓库根的 `quay.ts serve` 实例在跑）。
- [ ] AC3（助手真调用·非回声）对**真实载体** `node --no-warnings --experimental-strip-types plugin/scripts/live-web-address.ts <repo-root> <web-pid>` ⇒ exit 0 且 stdout 的 `host:port` 与 `.quay/server.json` 的 web 条目**逐字相同**；传不存在的 pid ⇒ exit 3 且 stderr 为 `carrier-pid-mismatch`。
- [ ] AC4（呼叫是真呼叫·负控）把助手临时改名 ⇒ AC-288 判据非 0 退出且 stderr 出现 `carrier-helper-unavailable`；改回 ⇒ 回绿。证明判据确实经助手取地址，而不是静默通过。
- [ ] AC5（夹具绿）`node --test packages/quay/test/ac288-criterion-address-derivation.test.mjs` exit 0。

## DoD

AC-288 判据在**生产载体**（主检出 cwd=仓库根的活 `quay.ts serve` + 真实 `.quay/server.json`）上真跑过一次并 exit 0（`verdict: pass`），且助手对同一真实载体的读数（`host:port`）与 `.quay/server.json` 的 web 条目逐字一致 —— 都是真对象上的读数，⛔ 不是 fixture（硬规则 4 推论三）。并且 `plugin/scripts/live-web-address.ts` 在 `develop` 与主检出可见（`git show develop:` 可读），即 AC-288 的地址派生不再引用一个不存在的路径。

## Touches

- plugin/scripts/live-web-address.ts
- goals/AC-288-切换机制本身可用-默认-en-lang-zh-生效并种下持久化-cookie-cookie-单独在无-query-参数的.md
- packages/quay/test/ac288-criterion-address-derivation.test.mjs
- tasks/gap-ac288-criterion-address-helper-not-landed.md

（说明：第一条是 P3 兜底时的落地面，也是判据解析地址所必需的唯一文件 —— 其**实现**归 in-flight 的 `gap-criterion-live-web-address-derivation-17-copies-to-one`，本任务**不重复实现**；第二条是判据载体（经 `quay goal write` 落库，⛔ 不手改）；第三条是与判据文本逐字绑定的夹具；第四条为 self-touch。）