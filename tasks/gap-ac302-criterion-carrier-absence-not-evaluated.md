---
id: gap-ac302-criterion-carrier-absence-not-evaluated
title: "AC-302 判据把「活载体缺席/地址不可派生」记成「此刻为假」—— 四条可评估性分支（goals/AC-302-*.md 第
  20/94/100/104 行）以 exit 1 出声，违反仓库约定（exit 3 = not-evaluated，goal-store.ts
  逐字示例「NOT-EVALUATED: carrier absent」）⇒ goal-driver 每轮判它 confirmed-failing
  重新立案；而保证本身实测为真（活实例 172.28.0.1:20119 上 en→zh 四条断言全绿）。修法=四处 exit 1→3（同族
  AC-301/AC-303 已由同形同伴落地 done）+ 夹具同步 + 助手落地后活实例上真 pass"
status: ready
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-302
---
**type:** execution

## Proposal

**缺口（立案轮直接量，2026-09-30，cwd = 主检出 `/data/home/yale/work/quay`）**

```
node packages/quay/bin/quay.js goal gate AC-302 --dry-run --json
⇒ {"id":"AC-302","verdict":"fail","cause":null,
   "reason":"acceptance failed (exit 1) — AC-302 candidate readings (cwd=/data/home/yale/work/quay,
             nserve=1, ncand=2, nderived=0):; pid=105489 addr=- cause=argv-no-serve-subcommand,
             carrier-helper-unavailable(exit=1); pid=1709183 addr=- cause=argv-port-absent,
             carrier-helper-unavailable(exit=1)
             FAIL=no-derivable-serve-address -- 1 quay.ts serve process(es) with cwd=/data/home/yale/work/quay,
             none yielded an address …",
   "timestamp":"2026-09-30T08:57:21.713Z","dryRun":true}
GATE_EXIT=1
```

台账尾（`.quay/gate-events.jsonl`，`item_id=AC-302`）连续两条同形 `fail`：`2026-09-30T08:45:43.734Z` 与 `08:56:58.320Z`，都是 `exit 1` + `nderived=0`。两条的 `payload.criterionHash` 均为 `null`（goal gate 事件不带指纹）。

**成因：不是产品退化，是【判据把「此地无法评估」记成了「此刻为假」】**

AC-302 判据的四条**可评估性**分支（`goals/AC-302-*.md` 第 20 / 94 / 100 / 104 行）全部以 `exit 1` 出声：

| 行 | 分支 | 它回答的问题 |
|---|---|---|
| 20 | `FAIL=workspace-root-unresolvable` | 连 root 都解析不出 |
| 94 | `FAIL=no-derivable-serve-address` | 有 serve 候选，但**派不出地址** |
| 100 | `FAIL=no-reachable-serve-address` | 派出了地址，但**够不着** |
| 104 | `CAUSE=no-running-serve-instance` | **没有** cwd=仓库根的活实例 |

这四条回答的都是「**在本地能不能评估**」，不是「这条保证是否成立」。`packages/quay/src/gate/acceptance-runner.ts:105-113` 把 `exit 3` 映射为 `verdict:"not-evaluated" / cause:"declared"`；`plugin/scripts/goal-driver.ts:407-452` 的 `runPrefilingRecheck` 对 `not-evaluated` 返回 `failing: []` ⇒ **不再立案**；`exit 1` 则被判 `confirmed-failing` ⇒ **每轮重新立案一次**（本轮即该路径的产物）。仓库自己的约定就在 `packages/quay/src/goal-store.ts`，逐字举例 `NOT-EVALUATED: carrier absent`。⇒ 这是硬规则 3b 的教科书形态：一个读不懂输入的判定，返回了与「不合格」同形的值。

**本轮的实测：保证本身为真，只有判据读不到它**

生产 serve（pid 1709183，cwd = 仓库根，argv 无 `--host/--port`）在 `.quay/server.json` 里登记为 `172.28.0.1:20119`。对它直接 curl（2026-09-30 立案轮）：

```
curl -sf                      http://172.28.0.1:20119/doc ⇒ <html lang="en"  <title>quay — Docs</title>  nav 'Docs' ×2
curl -sf -H 'Cookie: lang=zh' http://172.28.0.1:20119/doc ⇒ <html lang="zh"  <title>quay — 文档</title>  nav 'Docs' ×0
   （en 35094 B / zh 35080 B；nav 区块 en 2655 B / zh 2454 B；
     zh 侧 mobile-header-page=文档、<h1>=托管文档 (1)）
```

⇒ 判据要断言的**四条**（nav 区块里的英文标签消失、`<html lang="zh">`、本页 `<title>` 与 en 基线不同、en 基线仍在）此刻**全部为真**。红只因两件**探针侧**的事同时成立：

1. 该实例是 `quay.ts serve` 默认启动，**argv 没有 `--port`** ⇒ argv 派生分支报 `argv-port-absent`；
2. 兜底的**载体助手 `plugin/scripts/live-web-address.ts` 不在主检出、也不在 `develop`**（`test -f` 报 No such file；`git show develop:plugin/scripts/live-web-address.ts` 报 does not exist；`git log --all` 显示它只存在于 commit `525318919`）⇒ `node` 以 `MODULE_NOT_FOUND` 退 1 ⇒ 判据的 `case` 落进最后一支 `carrier-helper-unavailable(exit=1)`。

<!-- dedup-ref -->
**为什么上一轮的修法没保住（同族痕迹，可追溯）**：本 AC 前两条任务都已 `done` 且都没保住这条判据 —— `gap-ac302-criterion-cmdline-port-literal-stale` 把地址派生从「argv 里的 `--port` 字面量」重锚到「**内联**读 `.quay/server.json` 载体」，当时有效；随后 commit `c7075a155`（属另一条任务的 P2「17 条判据改调共享助手」）把那段内联块**整体换成**了对助手 `plugin/scripts/live-web-address.ts` 的调用，而同一任务的 P1（**新增该助手**）尚未落到 `develop`/主检出 —— 判据写侧（goal 写立即对 store 可见并推进 develop）与代码写侧（仍在 worktree）解耦，是这条缺口的机制。而 `gap-ac301-criterion-carrier-absence-not-evaluated` 与 `gap-ac303-criterion-carrier-absence-not-evaluated`（**均已 done**）给同族的 AC-301 / AC-303 补上的四条可评估性分支 `exit 3`，**AC-302 从未拿到**（实测：`AC-301 → not-evaluated`、`AC-303 → not-evaluated`，而 `AC-302 → fail`）。

**家族枚举（本任务为何不是重复立案）**：这 15 页家族里，`carrier-absence-not-evaluated` 已存在 7 条（AC-289 / 290 / 291 / 292 / 297 / 301 / 303），`address-helper-not-landed` 已存在 8 条（AC-288 / 293 / 294 / 295 / 296 / 298 / 299 / 300）——**AC-302 是唯一两条同伴都没有的 AC**。本任务补的是第一条（判据侧的退出码），⛔ 不碰第二条（助手的落地，另有归属，见下段）。

<!-- dedup-ref -->
**归属与现状（可追溯，不是前置声明）**：载体助手 `plugin/scripts/live-web-address.ts` 的实现归属 in-flight 的 `gap-criterion-live-web-address-derivation-17-copies-to-one`（其 worktree 内已有该文件，实测对真实载体返回 `172.28.0.1:20119` / `exit 0`）；把共享助手落进 develop 是那一条的产物，本任务**不重复实现**。本任务的正面动作是**判据侧的退出码**：与 AC-301 / AC-303 已落地的同形修改一致，使 AC-302 在「载体读不到」时报 `not-evaluated`（而不是「为假」），从而停止每轮的虚假立案；助手一旦落地，同一条判据即在活实例上转 `pass`。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-302 --dry-run --json; echo "GATE_EXIT=$?"`，逐字贴出并具名 `FAIL=` / `CAUSE=`。
2. **只改四条可评估性分支的退出码**（`goals/AC-302-*.md` 第 20 / 94 / 100 / 104 行）：`exit 1` → `exit 3`，**经 `quay goal write AC-302 --criterion …` 落库**（⛔ 不手改 `goals/*.md`）。`expect` 与**十条断言侧**分支（`en-fetch-failed` / `zh-fetch-failed` / `no-nav-region` / `no-nav-region-zh` / `english-baseline-missing` / `no-title-tag` / `html-lang-not-zh` / `nav-label-untranslated` / `no-title-tag-zh` / `title-unchanged`，第 114 / 120 / 129 / 132 / 137 / 145 / 149 / 153 / 159 / 164 行）**逐字不动、仍 `exit 1`** —— 它们回答「这页接没接 zh」，只要有可评估的实例就仍可答、且可能为假，判据必须保留牙。
3. **补一段 WHY 注释**（照 AC-301 / AC-303 的落地形态，写在 `>>> addr-derivation` 标记**之前**）：说清四条可评估性分支为何取 `exit 3` —— `exit 3` → `acceptance-runner` 的 `declared` → `goal-driver.runPrefilingRecheck` 的 `not-evaluated` ⇒ `failing: []`；并具名 `NOT_RUNNABLE_EXIT_CODES = {126,127}`（故 3 不是 runner 失败码）。⛔ 不把它写成对产品行为的新断言，它只是退出码取值的理由。
4. **夹具同步**（`packages/quay/test/ac302-criterion-address-derivation.test.mjs`）：该文件把判据的 `addr-derivation` 块**逐字**抽出执行，7 个可评估性负例在第 385 / 410 / 429 / 448 / 468 / 490 / 509 行断言 `r.code === 1` ⇒ 同步为 `3`；7 个正例的 `r.code === 0` 与第 510 行 `stdout === ""` 不动。**并新增一条整条 criterion 的断言侧负控制**（真监听但 zh 未翻译的 `/doc` ⇒ 整条 `exit 1` + `CAUSE=nav-label-untranslated`），证明断言分支仍有牙。⛔ 活面由夹具自造，⛔ 不得改 `packages/quay/src/serve-*.ts`。
5. **双向读数**：① 主检出根（有活实例、且助手已落地时）⇒ `verdict:"pass"`；② worktree 根 / 无活实例 ⇒ `verdict:"not-evaluated"` / `cause:"declared"`（⛔ 不是 `"fail"`）。两条 JSON 逐字并排贴。
6. **收口**：`node --test packages/quay/test/ac302-criterion-address-derivation.test.mjs` 绿；`bash scripts/test.sh --for-task gap-ac302-criterion-carrier-absence-not-evaluated --allow-thin` 绿；`git diff --name-only develop...HEAD` 只含本任务 Touches。

## AC

- [ ] **AC1（四条可评估性分支已取 exit 3，十条断言分支逐字未动）**：`grep -c 'exit 3' goals/AC-302-*.md` = **4**，`grep -c 'exit 1' goals/AC-302-*.md` = **10**；逐行贴出第 20 / 94 / 100 / 104 行改为 `exit 3` 的 criterion diff，并**逐条列出**仍为 `exit 1` 的十条断言分支（⛔ 不报一个总数，硬规则 3）。⛔ 未经 `quay goal write AC-302 --criterion …` 落库不算。
- [ ] **AC2（不可评估 ≠ 为假·活读数）**：在**地址不可派生**的时刻，`node packages/quay/bin/quay.js goal gate AC-302 --dry-run --json` ⇒ `.verdict == "not-evaluated"` 且 `.cause == "declared"`，`reason` 含 `no-derivable-serve-address`；⛔ **不是** `"fail"`。并排贴**改前**（`fail` / `exit 1`，立案轮 `2026-09-30T08:57:21.713Z`）与**改后**（`not-evaluated` / `exit 3`）两条完整 JSON。
- [ ] **AC3（夹具同步 + 该项是可取的假）**：`packages/quay/test/ac302-criterion-address-derivation.test.mjs` 的 7 个可评估性负例断言 `code === 3`（第 385 / 410 / 429 / 448 / 468 / 490 / 509 行）、7 个正例仍 `code === 0`、整条 criterion 的 fetch 失败断言仍 `code === 1`；`node --test <该文件>` 全绿；并贴出**修订前**该文件在 `code === 1` 断言下的对照（`git show <old>:<file>`）证明这 7 条确实 1 → 3。
- [ ] **AC4（强度不减·负控，行为证据不是文本 diff）**：夹具自造活面上跑**整条** criterion：真接线的 zh `/doc` ⇒ `exit 0`；未接线的 zh `/doc` ⇒ `exit 1` 且 `CAUSE=nav-label-untranslated`（**断言分支不得变成 3**）。两次读数并排贴。⛔ 不得改任何 `packages/quay/src/serve-*.ts`。
- [ ] **AC5（正控制：活实例上真 pass）**：在载体助手已落地、且存在 cwd = 仓库根的活 `quay.ts serve` 时，`node packages/quay/bin/quay.js goal gate AC-302` ⇒ **exit 0**，逐字贴出；同一时刻贴 `pgrep -af 'quay.ts serve'` + `readlink /proc/<pid>/cwd`，确认该进程 cwd = 仓库根。⚠️ 若助手仍未落地 ⇒ **如实报「助手未落地，此条取 not-evaluated」**（硬规则 3b），⛔ 不勾「已达成」后靠文字补救。
- [ ] **AC6（不回归 + 家族枚举 + 作用域）**：① `bash scripts/test.sh --for-task gap-ac302-criterion-carrier-absence-not-evaluated --allow-thin` 绿；② `node --test packages/quay/test/ac301-criterion-address-derivation.test.mjs packages/quay/test/ac303-criterion-address-derivation.test.mjs` 绿（同族已落地的两条**必须保持绿**）；③ 家族枚举逐文件贴出（`ls tasks/ | grep -c 'carrier-absence-not-evaluated'` 由 **7 → 8**（含本任务）；`ls tasks/ | grep -c 'address-helper-not-landed'` 仍 **8**，本任务不改它们）；④ `git diff --name-only develop...HEAD` **逐条**贴出，证明只有本任务 Touches 里的路径被动过。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「四条分支改了退出码」，而是**同一份判据在两种真实载体状态下给出两个可区分的取值**，且两种取值都能在**生产载体**上复算：

1. **不可评估态可区分**：无活实例 / 地址不可派生时，`quay goal gate AC-302 --dry-run --json` ⇒ `verdict:"not-evaluated"`、`cause:"declared"`；对照是立案轮的 `verdict:"fail"`（两条 JSON 都要贴）。
2. **为真态仍可取到**：载体助手落地 + cwd = 仓库根的活 `quay.ts serve` ⇒ `verdict:"pass"`，且该实例上四条断言各自独立可核（en nav `Docs` ×2 / zh `<html lang="zh"` / zh nav `Docs` ×0 / zh `<title>` ≠ en `<title>`）。⛔ 断言分支的牙由 AC4 的负控**行为**证据证明（真监听但未翻译 ⇒ `exit 1`）。
3. **判据裁决诚实**：AC5 若因助手未落地而取 `not-evaluated`，**如实记录**，⛔ 不勾「已达成」后靠 Evidence 描述补救。
4. **作用域**：AC6④ 的 `--name-only` 证明 `plugin/scripts/*`、`packages/quay/src/serve-*.ts`、以及 8 条 `address-helper-not-landed` 同伴的载体**一字未改** —— 本任务只动 AC-302 一条判据的退出码与其夹具。
5. **可回滚**：写明回滚形态（`quay goal write AC-302` 回原 criterion 文本 + `git checkout -- packages/quay/test/ac302-criterion-address-derivation.test.mjs`），纯本地、无外部状态。
6. **证据留痕**：红 / 改后两条 JSON、criterion diff、夹具修订前后对照、负控两次读数、家族计数、`--name-only`，落成**任务体内联**或**未跟踪** scratch 文件（`.quay/ac302-*`），可被下一轮独立复算。

## Touches

- `goals/AC-302-doc-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md`
- `packages/quay/test/ac302-criterion-address-derivation.test.mjs`
- `tasks/gap-ac302-criterion-carrier-absence-not-evaluated.md`

（说明：第一条是本任务的落地面 —— 四条**可评估性**分支的**退出码**，经 `quay goal write AC-302 --criterion …` 落库，`expect` 与十条断言分支文本逐字不变；第二条是与该块逐字绑定、随之同步的夹具（7 个可评估性负例 + 一条整条 criterion 的断言侧负控制）；第三条是 self-touch。⛔ `plugin/scripts/live-web-address.ts`、任何 `plugin/scripts/*.ts`、任何 `packages/quay/src/serve-*.ts` **均不在本 Touches 内**：助手的落地归 in-flight 的 `gap-criterion-live-web-address-derivation-17-copies-to-one`，本任务不重复实现；后者是夹具自造活面的约束。）
