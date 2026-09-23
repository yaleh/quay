---
id: gap-ac295-criterion-cmdline-port-literal-stale
title: AC-295 判据从 cmdline 的 `--port` 字面量派生地址，而生产启动器默认已是 `--port 0`（内核分配临时端口）⇒
  判据结构上恒假（addr=172.28.0.1:0，curl 失败）；机制本身为真（实测 /needs-human 四条断言全过）——
  重锚地址派生那一步（与 AC-179/288/289/290/291/292/293/294 同族任务同一行）
status: ready
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

**缺口（立案当轮直接量，cwd = 主检出 `/data/home/yale/work/quay`）**

```
node packages/quay/bin/quay.js goal gate AC-295 --dry-run --json
⇒ {"id":"AC-295","verdict":"fail",
   "reason":"acceptance failed (exit 1) — CAUSE=en-fetch-failed -- GET http://172.28.0.1:0/needs-human returned nothing (addr=172.28.0.1:0)",
   "dryRun":true}
```

**成因不是「机制坏了」—— 是判据派生地址的那一步解析了一个启动器已按设计置 0 的字面量。**

同一进程、同一时刻的三个读数（立案轮实测，⛔ 非转述）：

| 面 | 读数 | 取法 |
|---|---|---|
| 生产实例 | pid `2120900`，cwd = `/data/home/yale/work/quay`，cmdline `node --experimental-strip-types packages/quay/bin/quay.ts serve --host 172.28.0.1 --port 0` | `readlink /proc/2120900/cwd` |
| 判据按 cmdline 派生的地址 | `172.28.0.1:0` ⇒ `curl -sf --max-time 10` 失败 ⇒ `CAUSE=en-fetch-failed` | criterion 里 `grep -oE -- '--host [^ ]+ --port [0-9]+'` 那一步 |
| 同一进程的**真实**监听地址（载体 `.quay/server.json`） | `name=="web"` ⇒ `172.28.0.1:13609`（另有 `control 127.0.0.1:33159`，端口不同，取错会打到控制面） | `cat .quay/server.json` / `node packages/quay/bin/quay.js server status --json` |

**机制本身为真（同一轮，用真实端口直接量四条断言；⛔ 不是 grep 源码）**：

```
curl -sf --max-time 10 http://172.28.0.1:13609/needs-human                       → 49559 bytes
curl -sf --max-time 10 -H 'Cookie: lang=zh' http://172.28.0.1:13609/needs-human → 49252 bytes
```

| 断言 | en | zh |
|---|---|---|
| `<html lang>` | `<html lang="en"` | `<html lang="zh"` |
| nav 区块（criterion 自己的 `tr '\n' ' ' \| grep -o '<nav.*</nav>'` 形态）字面量 `Needs Human` | 2 | 0 |
| （对照）nav 区块 `待人工` | 0 | 2 |
| 本页自己的 `<title>` | `quay — Needs Human` | `quay — 待人工` |
| 整段响应 `Needs Human` 残留（硬规则 3：给条数） | 4 | 0 |

⇒ criterion 的两条独立断言臂（nav 字典、本页 chrome 字典）都在活服务上为真；**fail 只发生在派生地址那一步**，且它以具名 `CAUSE=en-fetch-failed` 报出（硬规则 3b：判据没有伪装成通过）。

**⛔ 本任务不是「上一次修复没保住」**：`gap-ac295-needs-human-page-zh-chrome-nav-current-and-own-title`（**done**，实现提交 `925ed7596`，本页 zh 接线已落 develop）修好的机制，本轮实测仍为真（上表）。AC 变假是**载体位移**：启动器按设计把 web 端口改为 `--port 0`（内核分配），端口只存在于活宿主载体 `.quay/server.json` 的 `web` 条目里；判据仍解析 cmdline 字面量 ⇒ **结构上恒假**，与页面实现无关。⇒ 修的是**判据的派生那一步**，不是回退产品。

**<!-- dedup-ref -->去重核对（机制维度，非症状关键词）**：`grep -rn '^goal_ac: AC-295$' tasks/*.md` ⇒ 1 命中 = `gap-ac295-needs-human-page-zh-chrome-nav-current-and-own-title`，其 `status: done` ⇒ 不是重复（重复只算 in-flight）。同族机制（同一条 `--port` 派生行）另有 8 个在飞任务：`gap-ac179/288/289/290/291/292/293/294-criterion-cmdline-port-literal-stale`（均 `ready`），**AC-295 是本族里唯一还没立案的那一格**；每个任务只重锚自己那一份 goal 文件（见 AC5 的逐文件差量），互不代劳——同族任务的 AC5 也按同一约定写成差量而非绝对值。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-295 --dry-run --json` ⇒ `verdict: fail` 且 `addr=172.28.0.1:0`；同一时刻 `cat .quay/server.json` 取 `name=="web"` 的端口读数，**两者必须指向同一 pid**（`server.json` 的 `pid` 字段 vs `pgrep`）。
2. **确认依赖可读 + 读【实际】签名**：`grep -n 'export function readServerState\|export interface ServerServiceEntry\|export function pidAlive\|export function probeAddress' packages/quay/src/server-state.ts`、`node packages/quay/bin/quay.js server status --json`。⛔ 不按本任务 Plan 预写的签名假设：以实际导出为准；任一无命中 ⇒ **停下报缺**。
3. **重锚 AC-295 的判据**：把 `goals/AC-295-*.md` 的 criterion 里「从 cmdline `--host … --port …` 派生 addr」那一步替换为「活宿主载体派生」（**两种部署形态都要覆盖**：显式端口实例与 `--port 0` 实例），其余逐字不动；经 `quay goal write AC-295 --criterion "$(cat <新判据文件>)"` 落库。⛔ 不得直接 `Edit` goal 文件。
4. **两个负控制**（硬规则 4 推论三：判据必须能取假）：① 无实例时仍非 0（`CAUSE=no-running-serve-instance`）；② 把候选地址指向一个必然连不上的端口 ⇒ 非 0 且成因可区分（`CAUSE=en-fetch-failed`）。⛔ 不得靠改 `expect` 或放宽断言来「凑绿」。
5. **落账**：`node packages/quay/bin/quay.js goal gate AC-295` ⇒ exit 0，且台账新增一条 `verdict:"pass"` 事件，其 `payload.criterionHash` **≠ 修订前的指纹**。

## AC

- [x] **AC1（承载体已重锚且不减强度）**：`goals/AC-295-*.md` 的 criterion 不再解析 `--port [0-9]+` 字面量派生地址，改从活宿主载体取；`expect` 与正文语义（chrome 作用域断言：导航只匹配 `<nav>…</nav>`、标题只匹配 `<title>`，⛔ 不对整段响应体做子串匹配）逐字不变（贴 `git diff`，只有派生那一步与「为什么改」的说明变化）。⛔ 除非经 `quay goal write` 落库否则不算。
  - **已核实**：criterion 里 `grep -oE -- '--host [^ ]+ --port [0-9]+'` 出现次数 = **0**；`expect` / `origin` / `title` / `status` / `kind` / `goal` 六键与修订前 **逐字节相同**（对照立案轮 `goal show --json` 快照）；旧判据从 `en=$(curl` 起的**尾部 2442 字节逐字节保留**（全部 chrome 作用域断言未动）。落库经 `quay goal write AC-295 --criterion …`（⛔ 非 Edit）。
- [x] **AC2（判据能取假 —— 两个负控制）**：① 无运行实例时 `quay goal gate AC-295` 非 0 且以 `CAUSE=no-running-serve-instance` 可区分；② 候选地址指向必然连不上的端口时非 0 且成因可区分（`CAUSE=en-fetch-failed`）。两条均贴退出码与逐字 stderr。
  - **①** `quay goal gate AC-295 --root <task worktree>`（该 root 无 serve 实例）⇒ **EXIT=1**，逐字 stderr：`CAUSE=no-running-serve-instance -- no quay.ts serve process with cwd=/data/home/yale/work/quay-worktrees/gap-ac295-criterion-cmdline-port-literal-stale; /needs-human cannot be evaluated on a live surface (AC-179 probe pattern)`，且带逐候选报告 `(… nserve=0, ncand=1, nderived=0):; pid=3732611 addr=- cause=argv-no-serve-subcommand,carrier-absent`。
  - **②** 夹具 root（真实 serve 形进程 cwd=root + 载体 `web` 指向一次性监听器）⇒ **EXIT=1**，逐字 stderr：`CAUSE=en-fetch-failed -- GET http://127.0.0.1:19447/needs-human returned nothing (addr=127.0.0.1:19447)`。
  - ⚠️ **实测差异（诚实记录）**：重锚后的区块**先探活再采纳**地址，所以「候选地址必然连不上」现在由**更早**的 `FAIL=no-reachable-serve-address`（`connection-refused`）捕获，`CAUSE=en-fetch-failed` 只剩「探活时通、判定时不通」这个 TOCTOU 窗口可达（② 正是用一次性监听器命中该窗口）。两态均以具名 token 报出、均可区分 ⇒ 判据能取假成立；改名的那一步只是把同一条拒绝提前了一层。
- [x] **AC3（正控制：修订后在活实例上为真）**：`node packages/quay/bin/quay.js goal gate AC-295` ⇒ **exit 0**，逐字贴出；且同一时刻四条断言各自独立可核（en nav `Needs Human` 计数 / zh 响应含 `<html lang="zh">` / zh nav `Needs Human` 计数 = 0 / zh `<title>` ≠ en `<title>`），并贴出 zh 响应里 `Needs Human` 的残留条数（硬规则 3：给条数，不给单一布尔）。
  - **EXIT=0**，`{"id":"AC-295","verdict":"pass","reason":"acceptance passed (exit 0)","timestamp":"2026-09-23T15:22:41.128Z","actor":"goal-cli"}`。
  - 同一时刻（活实例 pid 850862，载体 `web` = `0.0.0.0:16377` ⇒ 归一化 `127.0.0.1:16377`）四条断言**各自独立**读数：en 响应 45384 bytes / zh 响应 44073 bytes；nav 区块 en `Needs Human` = **2**；zh 含 `<html lang="zh">` = **1**；nav 区块 zh `Needs Human` = **0**（对照 zh `待人工` = **2**）；`t_en = quay — Needs Human` ≠ `t_zh = quay — 待人工`。**zh 整段响应 `Needs Human` 残留条数 = 0**。
- [x] **AC4（地址覆盖两种部署形态）**：对显式端口实例与 `--port 0` 实例（或用两种 cmdline 的夹具）各断言派生地址正确；贴出两种形态下的派生结果。⛔ 不把本机当前端口写进任何被提交的文件。
  - 用**落库后的区块本身**（从 criterion 逐字抽出）在 `git init` 夹具 root 里跑两次：
    - 形态 A（显式端口，载体缺席）：`--host 127.0.0.1 --port 1793` ⇒ `DERIVED_ADDR=127.0.0.1:1793`，`DERIVED_SRC=argv`，`cause=derived-from-argv-fetch-answered`。
    - 形态 B（`--port 0`，载体在场）：argv 端口 0、载体 `web` = 25107 ⇒ `DERIVED_ADDR=127.0.0.1:25107`，`DERIVED_SRC=carrier`，`cause=derived-from-carrier-fetch-answered`。
  - 另：**活生产实例本身就是形态 B**（cmdline `--port 0`），派生结果 `127.0.0.1:16377` 来自载体（见 AC3）。
  - 以上端口全是**一次性夹具/临时端口**，只出现在本任务正文与运行输出里；⛔ 未写进任何被提交的文件（夹具内 `listen(0)` 取内核分配端口）。
- [x] **AC5（不回归 + 作用域枚举）**：① `bash scripts/test.sh --for-task gap-ac295-criterion-cmdline-port-literal-stale` 绿；② 作用域举证：`grep -rlF "grep -oE -- '--host [^ ]+ --port [0-9]+'" goals/` **逐文件**贴出并与立案基线对照（**立案基线 16**，含 AC-295）：本任务后 **AC-295 那一条 1→0**，其余 **15 个文件不受本条影响**（各自归自己的立案轮）。⛔ 若同族在飞任务已落地，本条判据是**逐文件差量**，不是绝对值。
  - **①** `bash <worktree>/scripts/test.sh --for-task gap-ac295-criterion-cmdline-port-literal-stale --allow-thin` ⇒ **SCOPED_GATE_EXIT=0**（14/14 本任务夹具通过；`test-selection-thin` 1/3 为 selected-test 计数，非失败）。
  - **②** 立项基线 16（含 AC-295）。本任务后 `grep -rlF` 还剩 **9** 个文件：AC-179、AC-289、AC-296、AC-298、AC-299、AC-300、AC-301、AC-302、AC-303；**AC-295 已不在其中（1→0）**。差额 16−9 = **7** = 同族在飞任务各自重锚的那一格（`grep -rlF '# >>> addr-derivation' goals/` ⇒ AC-288/290/292/293/294/297 **6 个** + 本任务的 AC-295）。逐文件差量对账：**9 + 7 = 16 ✓**，本次作用域只有 AC-295 那一格。分支对 goal 文件的改动：`git diff --stat develop...task/gap-ac295-… -- goals/ tasks/` ⇒ **1 file changed**（AC-295 的 goal 文件）。
- [x] **AC6（新指纹落账）**：台账 `.quay/gate-events.jsonl` 中 `item_id=AC-295` 的最后一条为 `verdict:"pass"`，且其 `payload.criterionHash` ≠ 修订前指纹（贴两行）。
  - 尾条：`2026-09-23T15:22:41.128Z | pass | goal-cli | hash: <none>`（`reason:"acceptance passed (exit 0)"`）。
  - 指纹行：`2026-09-23T15:22:35.592Z | pass | goal-amend | hash: 7631739f3aeeeafc` —— **修订前为 `bf42948d03aef763`**（全 109 条事件的唯一旧指纹，绿 34 次 2026-09-18T00:09:33.947Z→2026-09-23T05:08:45.828Z、红 2 次 08:36:03.396Z/14:54:39.524Z）。
  - **指纹自核**：磁盘上 criterion 的 `criterionFingerprint(...)` = `7631739f3aeeeafc`，与 amendment 事件记录值一致 ⇒ 该 pass **确系对修订后文本**。
  - ⚠️ **诚实标注（不掩盖）**：`goal gate` **按设计不写 `criterionHash`**（`goal-store.ts` 只在轮转事件上落指纹；goal-cli 事件的 payload 键集实测仅 `{reason}`），且 goal-driver 每轮 `goal gate` 都会追加无指纹事件 ⇒ 「尾条必带指纹」在结构上是**瞬时态**、不可能持久。故本 AC 按**实质**满足：台账含一条对**新**文本的 `pass`（`goal-amend`，指纹 `7631739f3aeeeafc` ≠ 旧 `bf42948d03aef763`），且尾条为 `pass`。**未采用**「把全量 achieved 群体强制轮转一遍（`--min-age-ms 0 --budget 46`）把自己的事件挪到队尾」——那会对 46 个 AC 产生真实复评副作用（可能新触发立案），为凑一个瞬时读数而扰动生产，不做。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本改了、dry-run 绿了」，而是 **一条真实的、在活服务上为真的判据落了账**：

1. **落地对象**：`goals/AC-295-*.md` 的 criterion 经 `quay goal write` 落库（⛔ 非手工 Edit），且 `quay goal gate AC-295` 在**运行中的** `quay.ts serve`（cwd = 仓库根）上返回 exit 0。✅（AC1/AC3）
2. **台账**：`.quay/gate-events.jsonl` 出现 `item_id=AC-295` / `gate=goal` / `verdict=pass` / `actor=goal-cli` 的新事件，`criterionHash` 与修订前不同 —— 一条 dry-run 输出**不算**。✅（AC3/AC6；指纹由同轮 amendment 事件 `goal-amend` 携带并自核一致）
3. **负控制留痕**：两个负控制（无实例 / 连不上的端口）的退出码与 `CAUSE=` 逐字留存，证明判据不是恒真（硬规则 4 推论三）。✅（AC2）
4. **家族差量**：AC5 的逐文件计数表贴出，证明本次作用域**只有 AC-295 那一格**发生变化。✅（AC5：9+7=16，分支只改 1 个 goal 文件）
5. **⛔ 三种「凑绿」明令禁止**：改 `expect` 语义、把端口写死回固定值、把 `/needs-human` 的判据放宽成整段响应体子串匹配（`origin` 明写这是 chrome 作用域断言）。✅ 三项均未发生：`expect`/`origin` 逐字节未改；criterion 与夹具里无任何固定端口字面量（全部 `listen(0)` / 一次性端口）；`<nav>`/`<title>` 作用域断言原样保留（尾部 2442 字节逐字节相同）。
   - **夹具加固（本任务新增的独立读数）**：夹具只抽 `>>> addr-derivation` 区块，看不到区块外的缺陷 —— 这不是假设：本任务**首次落库**把 WHY 注释写成「硬换行」，goal store 按空行折行，续行回读成**代码**，`goal gate AC-295` 以 `/bin/sh: 2: Syntax error: ")" unexpected`（exit 2）失败，而 13 条区块内测试**全绿**。故新增一条测试对**整段 criterion** 跑 `sh -n`（只解析不执行）；负控制实测：坏形态 `EXIT=2`、好形态 `EXIT=0`。

## Touches

- `goals/AC-295-needs-human-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md`
- `packages/quay/test/ac295-criterion-address-derivation.test.mjs` (new)
- `tasks/gap-ac295-criterion-cmdline-port-literal-stale.md`

（说明：第一条是本任务的落地面 —— criterion 的地址派生那一步，经 `quay goal write AC-295 --criterion …` 落库，`expect` 与正文语义逐字不变；第二条是配套夹具（两种部署形态的派生正/负控制，与 `packages/quay/test/ac294-criterion-address-derivation.test.mjs` 同族、页面各一）；第三条是 self-touch。⛔ 不新增 `plugin/scripts/*.ts` —— 派生助手若要抽出，默认放 `packages/quay/src/`；若最终落在 `plugin/scripts/`，必须同时把 outline、`plugin/scripts/capability-catalog-declarations.json` 与本任务 Touches 一并更新。⛔ `packages/quay/src/serve-needs-human.ts` / `serve-i18n.ts` **不在本 Touches 内** —— 它们已被本 AC 的 done 任务修好且本轮实测为真。）

## Evidence — 上一轮 fan-in suite 红 30 条的真因（本轮实测，供下一轮/管理者直接用）

**本任务实现已完成且自检全绿**（`task_check` ok:true，6/6 AC；scoped gate `EXIT=0`，14/14；develop 已并入，worktree clean）。上一轮 30 条 suite 红**不是本任务 delta 造成的**，真因是**环境泄漏**，不是代码缺陷：

- 常驻 `driver-anchor`（本工作区 pid 2391720，`/proc/2391720/environ` 实测）带着 **`QUAY_GOAL_ACCEPTANCE_ACTIVE=1`**。
- `plugin/scripts/suite-driver.ts:176` 的 spawn 用 `env: { ...process.env, … }` ⇒ 该变量随 fan-in 一路传进 `scripts/test.sh` ⇒ `node --test`；`scripts/test.sh` 只 `unset FORCE_COLOR`（`:176` 那条注释的用意正是「入口清干净让每个子进程继承」，本条漏了）。
- 后果：goal 重入闸（`goal-store.ts:1784/1992`、`goal-driver.ts:639`）在**每一条** goal 判据/轮转路径上短路 ⇒ goal 家族测试批量假红。

逐文件实测（同一 worktree、同一 HEAD，测试文件与 develop **逐字节相同** ⇒ 与 delta 无关）：加 `env -u QUAY_GOAL_ACCEPTANCE_ACTIVE` 后 `goal-invariants-standing` 19/19、`goal-driver-s12` 4/4、`s13` 3/3、`s02` 14/14、`s10` 4/4、`s04` 14/14、`goal-store` 72/72、`gap-webui-dashboard-tests-card-latest-round-no-live-signal` 4/4 —— 即上一轮日志里红的 8 个文件**全绿，0 失败**。上一轮同样文件的 `passed=false` 行见 `.quay/fan-in-suite-gap-ac295-…-468cbf.log`。

一行复现：`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node --test plugin/test/goal-invariants-standing.test.mjs`（带该变量 ⇒ 红；不带 ⇒ 绿）。

⚠️ 本任务 Touches 不含 `scripts/test.sh` / `plugin/scripts/suite-driver.ts` ⇒ **不在本任务内修**（越界写会被 fan-in 的 anti-drift 拒）。同族 8 个 in-flight 任务（`gap-ac179/288/289/290/291/292/293/294-…`）同样会被这条卡住 ⇒ 建议单独立案（最小修法：`scripts/test.sh` 入口 `unset QUAY_GOAL_ACCEPTANCE_ACTIVE`，与既有 `unset FORCE_COLOR` 同形；或在 `suite-driver.ts` 的 spawn env 里剔除）。

## Evidence — 本轮（2026-09-24，第 4 轮）· 卡点已收敛到单一环境缺陷，实现侧零改动

**本轮复验（同一 worktree，HEAD = `6a2d0ab8e`，已并入 develop）：**

- `task_check` ⇒ `ok:true`，**6/6** AC。
- **scoped gate**（与 fan-in 同一条命令，**裸跑**、⛔ 不加 `env -u`）：`bash scripts/test.sh --for-task gap-ac295-criterion-cmdline-port-literal-stale --allow-thin` ⇒ **EXIT=0**，`tests 14 / pass 14 / fail 0`。
- **AC-295 判据在活实例上仍为真**：`node packages/quay/bin/quay.js goal gate AC-295 --dry-run --json` ⇒ **exit 0**，`payload.reason = "acceptance passed (exit 0)"`。
- **AC6 台账尾**：`item_id=AC-295` 最后一条 = `2026-09-23T18:03:41.416Z | pass | goal-sweep | hash 7631739f3aeeeafc`（= 修订后指纹，⛔ 非旧 `bf42948d03aef763`）；该 AC 累计 116 条事件。
- 分支 delta 对 develop = **1 file**：`packages/quay/test/ac295-criterion-address-derivation.test.mjs`（`goals/AC-295-*.md` 的重锚已在 develop 上）。worktree clean，merge 已提交。
- `--write-scoped-gate-cache` ⇒ `{ok:true, key: "gap-ac295-…\tedf5fa9d8b4a16c2c624c34a4d00054fcba6c78e"}`。

**上一轮 suite 红的归因本轮升级为机制自身的判词（⛔ 不再是人工推断）**：直接调用生产判定函数 `judgeRetryExemption`（`plugin/scripts/worker-driver.ts`）喂入本任务最后一条 `exited-not-landed` 记录 ⇒ `verdict: "unrelated-flaky-exempt"`；`recurredTasks: ["gap-fan-in-delta-classify-declared-doc-surfaces"]`；`failingTestFiles` = 上一轮那 8 个 goal 家族文件。⇒ **「与 delta 无关」已被机制自身认定**。但该判词把动作定为 `count-and-retry`（`decideExitedNotLandedAction`，⛔ **不是**放行落地），而 fan-in 的 suite 步对红一律 `failSuite` fail-closed ⇒ **本任务仍无法落地**。

**30 条红的成分核对（硬规则 3：给条数不给单一布尔）**：上一轮日志 `__PERFILE__ … passed=false` 恰好 **8 个文件**（`goal-driver-s02/s04/s10/s12/s13`、`l1-delivery-surface-check`、`goal-store`、`goal-invariants-standing`），其余文件全部 `passed=true`；`# fail 30` **全部**落在这 8 个文件内 ⇒ 无第二种成因。

**环境泄漏本轮仍在**：`/proc/2391720/environ`（driver-anchor，root=`/data/home/yale/work/quay`，2026-09-24T02:33 启动）实测含 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1`；本 worker 会话进程亦继承（父链直上该 anchor）。

**⇒ 上一节的「建议单独立案」本轮已兑现（⛔ 不重复诊断第 4 次）**：新任务 `gap-goal-acceptance-active-leaks-into-suite-via-driver-anchor-env`（`labels: gap/defect`，`status: todo`，5 条 AC，`task_check` 的 `author->ready` 读作 `ok:true, shape: finding`）——内含泄漏链逐层证据、发生率（`.quay/worker-outcome.jsonl` 两条带 `suiteSignatures` 的记录）、逐项同族枚举 AC，与最小修法（`scripts/test.sh` 既有入口归一化块补一个成员 / `suite-driver.ts` spawn env 剔除）。⛔ 本任务**仍未**越界修它（`## Touches` 不含 `scripts/test.sh`）。

## Evidence — 本轮（2026-09-24，第 5 轮）· 受控 A/B 复验；卡点确认仍在飞

**实现侧零改动**（分支 delta 对 develop 仍 = 1 file：`packages/quay/test/ac295-criterion-address-derivation.test.mjs`）。

- `task_check` ⇒ `ok:true`，**6/6** AC（`acTotal:6, acChecked:6`）。
- `goal gate AC-295 --dry-run --json` ⇒ **EXIT=0**（活实例上判据仍为真）。
- **scoped gate（与 fan-in 同一条命令、裸跑、⛔ 不加 `env -u`）**：`bash scripts/test.sh --for-task gap-ac295-… --allow-thin` ⇒ **EXIT=0**，`tests 14 / pass 14 / fail 0`。
- `git merge --no-edit develop` ⇒ **Already up to date**，无未合并路径；worktree clean。
- `--write-scoped-gate-cache` ⇒ `{"key":"gap-ac295-…\t1f884c10fa76bcdb67686c9b49f17a615f079f7a","ok":true}`。
  ⚠️ 该缓存文件实测是**单条记录**（写入前内容为 `gap-anchor-state-nonatomic-…\ta6a730c9…`）⇒ 本次写入顶掉了对端那条；对端只会因此多跑一次 scoped 门，无正确性影响。

**上一轮 `# fail 29` 本轮受控 A/B 复验（硬规则 4 推论四：给出「若因不成立则结果会不同」的对照）**

同 worktree、同 HEAD、同一组 7 个测试文件，**唯一变量** = `QUAY_GOAL_ACCEPTANCE_ACTIVE`：

| 条件 | 读数 |
|---|---|
| `QUAY_GOAL_ACCEPTANCE_ACTIVE=1`（= 环境现状） | **`pass 101 / fail 29`** —— 与 fan-in 日志 `# fail 29` **逐数一致** |
| `env -u QUAY_GOAL_ACCEPTANCE_ACTIVE` | **`pass 130 / fail 0`** |

⇒ 29 条红**全部**由该环境变量造成，与 delta 无关（对照存在且能取假）。7 个文件：`goal-driver-s02/s04/s10/s12/s13`、`goal-invariants-standing`、`goal-store`。

**泄漏链本轮直接量（⛔ 非转述，读的是当前进程的 `/proc/*/environ`）**

- 本 worker 会话（pid 1015613）的**父进程 = driver-anchor pid 2391720**，其 environ 含 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1`。
- **正在跑的 fan-in 进程 pid 910685**（`worker-driver.ts --mechanical-fan-in --task gap-anchor-state-nonatomic-and-declaration-outruns-log --root /data/home/yale/work/quay`）environ **同样含该变量**，PPID = 2391720 ⇒ 泄漏在**本轮 fan-in 路径上仍然生效**。
- 本会话自身 environ 亦含该变量（继承）。

**⇒ 第 5 轮仍无法落地的原因与前一轮同一条；修复已确认在被并行实现**

姊妹任务 `gap-goal-acceptance-active-leaks-into-suite-via-driver-anchor-env` 已 `todo→ready`，其 worktree
`quay-worktrees/gap-goal-acceptance-active-leaks-into-suite-via-driver-anchor-env` **于 03:05 建立**，与 peer worker
会话 pid 544836 的启动时刻 `03:05:16` 吻合 ⇒ **该修复正在被实现中**。它一旦落地（其自身 fan-in 跑的是**它分支上**已
`unset` 的 `scripts/test.sh` ⇒ 能绿、能落），develop 的 `scripts/test.sh` 即带上该 `unset`，本任务下一轮 fan-in 的
suite 步即可绿。

⛔ 本任务**未**越界改 `scripts/test.sh`（不在 `## Touches`，会被 anti-drift 拒）；**未**重启 driver-anchor
（driver 生命周期是 manager 层的人授常设权，本 worker 无此权；且第二个 driver 会劫持在飞 worker）。

## Evidence — 本轮（2026-09-24，第 6 轮）· 剩余 3 条 suite 红经隔离复跑判定为负载敏感 flake（非 delta）

**实现侧零改动**（分支 delta 对 develop 仍 = 1 file：`packages/quay/test/ac295-criterion-address-derivation.test.mjs`；`git merge --no-edit develop` ⇒ **Already up to date**，无未合并路径，worktree clean）。

上一轮 exit-not-landed 的真因日志为 `# fail 3`（**⛔ 不再是 goal 家族那 30 条** —— 泄漏修复已落地，29→3），三条各落在一个**逐字节等于 develop** 的测试文件上（`git diff --stat develop...HEAD -- <三门文件>` 为空）：

| 文件 | 断言 | 本轮隔离复跑 |
|---|---|---|
| `plugin/test/ready-pool-check-s22.test.mjs:192` | AC5 N=2000 `cached < uncached*0.75`（套件内实测 ratio 0.80，该文件耗时 23078ms；隔离下 9836ms） | **pass 8/8** |
| `plugin/test/driver-anchor-declaration.test.mjs:242` | AC5 `readAnchorJson(root)` 读到 `null` ⇒ 读 `.kinds` 抛 TypeError（anchor.json 非原子写） | **pass 3/3** |
| `packages/quay/test/gap-git-graph-…-decorate-labels.test.mjs:224` | AC6 `rows[0]`(=`fedaf8156` 本分支头) ≠ oracle(=`6ddd6f15a` develop)；且 `[ref-window]` 重试闸未报 refs-moved | **pass 7/7** |

⇒ 三条**全部转绿**；三条文件与 develop 逐字节相同；`QUAY_TEST_GIT_GRAPH_LIVE_REFS` 全树 `grep` 只出现在注释与 `=== "1"` 判定里，**套件从不 export 它**（该文件自述「NEVER set by the suite」）⇒ 判为**套件并发 / 宿主负载下的时序敏感**（当前 loadavg ≈ 30，2 个在飞 worker），非本 delta 造成。第一条与既有经验（该断言 load-independent ~25% 抖动）吻合。

**本轮 scoped 门（与 fan-in 同一条命令、裸跑、⛔ 不加 `env -u`）**：`bash scripts/test.sh --for-task gap-ac295-… --allow-thin` ⇒ **EXIT=0**，`tests 14 / pass 14 / fail 0`。`--write-scoped-gate-cache` ⇒ `{"key":"gap-ac295-…\t6ddd6f15a7e7d424a67c87b022197d5423e8f5b6","ok":true}`。

**六条 AC 本轮逐条复验**：AC1 criterion 内旧派生字面量计数 = **0**、`# >>> addr-derivation` 区块在场；AC3 `goal gate AC-295 --dry-run --json` ⇒ **EXIT=0**；AC5② `grep -rlF` 旧字面量在 `goals/` 只剩 **1** 个文件（AC-289，同族在飞）—— **AC-295 不在其中（1→0）**，符合 AC5「同族落地后按逐文件差量、非绝对值」的约定；AC6 台账累计 **117** 条，尾条 `2026-09-23T19:26:08.603Z | pass | goal-cli`，且存在对**新**文本的 pass（`goal-sweep`，`criterionHash 7631739f3aeeeafc` ≠ 旧 `bf42948d03aef763`）。

**⛔ 未越界**：三个红文件均不在本任务 `## Touches`，改它们会被 fan-in 的 anti-drift 拒。建议由拥有 `scripts/test.sh` / 注册表的任务把 `ready-pool-check-s22` 的 AC5 断言登记为 load-sensitive 或加宽判据 —— **本条只记录，不在本任务内修**。