---
id: gap-ac291-criterion-cmdline-port-literal-stale
title: AC-291 判据从 cmdline 的 `--port` 字面量派生地址，而生产启动器默认已是 `--port 0`（内核分配临时端口）⇒
  判据结构上恒假（addr=172.28.0.1:0，curl 失败）；机制本身为真（实测 /live 四条断言全过）—— 重锚地址派生那一步（与
  AC-179/288/289/290 在飞任务同一行）
status: done
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-291
---
**type:** execution

## Proposal

**缺口（立案当轮直接量，2026-09-23T08:38Z，cwd = 主检出 `/data/home/yale/work/quay`）**

```
node packages/quay/bin/quay.js goal gate AC-291 --dry-run --json
⇒ verdict: fail
   reason: acceptance failed (exit 1) — CAUSE=en-fetch-failed -- GET http://172.28.0.1:0/live
           returned nothing (addr=172.28.0.1:0)
```

**成因不是「机制坏了」—— 是判据派生地址的那一步解析了一个启动器已按设计置 0 的字面量。**

同一进程、同一时刻的三个读数（立案轮实测，⛔ 非转述）：

| 面 | 读数 | 取法 |
|---|---|---|
| 生产实例 | pid `3239217`，cwd = `/data/home/yale/work/quay`，cmdline `node --experimental-strip-types packages/quay/bin/quay.ts serve --host 172.28.0.1 --port 0` | `pgrep -f 'quay.ts serve'` + `readlink /proc/<pid>/cwd` |
| 判据按 cmdline 派生的地址 | `172.28.0.1:0` ⇒ `curl -sf --max-time 10` 失败 ⇒ `CAUSE=en-fetch-failed` | criterion 里 `grep -oE -- '--host [^ ]+ --port [0-9]+'` 那一步 |
| 同一进程的**真实**监听地址（载体 `.quay/server.json`） | `web 172.28.0.1:4601`（另有 `control 127.0.0.1:6065`，端口不同，取错会打到控制面） | `cat .quay/server.json` / `quay server status --json` |

**在真实监听地址上，本 AC 的保证逐条成立**（立案轮 `curl` 直读，四条断言全过）：

```
① GET http://172.28.0.1:4601/live                    → <title>quay — Live — loop activity</title>
② GET http://172.28.0.1:4601/live (Cookie: lang=zh)  → <html lang="zh"
③ 同一次响应                                          → <title>quay — 实时 — 循环活动</title>   （≠ ①，逐字不同）
④ nav 区块内 "Live" 字面量计数：默认语言 1 ⇒ zh 0      — en 基线在场、zh 下消失
```

⇒ **判据的四段断言（en nav 基线在场 / `<html lang="zh">` / 该英文标签自 nav 消失 / 本页 `<title>` 相对 en 变化）全部为真**。台账的「此刻为假」是**判据的承载体失效**，不是被服务的代码退化。

### 为什么更早的修复没兜住（本 AC 上已有一条 done 任务）

`gap-ac291-live-page-zh-chrome-nav-current-and-own-title`（status **done**）**做出了机制**：它把 `serve-live.ts` 的 `<html lang>`、`<title>`、`renderMobileChrome`/`renderSiteNav` 与 `<h1>` 逐个接上 `lang`，并留下 `packages/quay/test/serve-live-zh-chrome.test.mjs`。上面四条断言逐条为真 ⇒ **它从来不是「机制缺失」**。

但该任务的 AC4 逐字**把判据自身的修法排除在自己的 Touches 之外**：

> ⛔ **明令禁止**的三种「凑绿」：改判据（`goals/AC-291-*.md` ⛔ 不在本 Touches 内）、改别的任务的 title、把 zh 值写成含英文 `Live` 的混合串。

（`tasks/gap-ac291-live-page-zh-chrome-nav-current-and-own-title.md:152`；其 `## Touches` 第 176-179 行只有 `serve-live.ts` / `serve-i18n.ts` / 自测 / self-touch，**不含 `goals/`**。）

⇒ **从未有任何任务碰过「地址派生」这一步**，而这次坏掉的恰是它。目标文件自那以后**未再改动**：`git log -- goals/AC-291-*.md` 末次提交 `5da30099e`（status active→achieved），早于本次红；当前 `md5 83abed46263532b45459bdb55c338621`。

### 是什么时候失效的

`ce0f47518`（2026-09-18，`gap-serve-same-root-admission-lock`，done）把 web 端口默认改成**内核分配临时端口**：`start-drivers.ts:26-28` 逐字「临时端口下真实端口只在载体里可知」、`:58-59` `--port` 可选且默认 `0`。**在那之前** web 由人以显式端口启动 ⇒ cmdline 里恰好有可解析的端口、判据活着。生产实例于 `2026-09-23T08:37:40Z` 按该默认重启（`.quay/server.json` `startedAt`；上一代 pid 1211545 同期退出）⇒ 判据自此结构上恒假。

**同轮还观测到第二种红法（记录，⛔ 不是本任务的修法）**：`08:36:03Z` 的 sweep 读到 `CAUSE=no-running-serve-instance`（那一刻实例确实不在，`08:37:39` 才起来）。那是探针**设计内的 fail-closed 前提**（AC 的 `origin` 明写「必须有一个 cwd = 仓库根的 `quay.ts serve` 实例在跑」），修法是运维前提而非代码；本任务只修**承载体**那一条。

### 家族（枚举，硬规则 3；⛔ 不是一个布尔）

同一条派生逐字出现在 **17 个** goal 文件里：

```
grep -rlF "grep -oE -- '--host [^ ]+ --port [0-9]+'" goals/ | wc -l   ⇒ 17
头三条：goals/AC-179-web-card-and-cli.md / goals/AC-295-… / goals/AC-297-…
其中含 goals/AC-291-…（本任务对象）
```

其中 AC-179 / AC-288 / AC-289 / AC-290 的同一缺口**已各有在飞任务**（`gap-ac179-criterion-cmdline-port-literal-stale` / `gap-ac288-criterion-cmdline-port-literal-stale` / `gap-ac289-criterion-cmdline-port-literal-stale` / `gap-ac290-criterion-cmdline-port-literal-stale`，四条 status 均 `ready`）。**AC-291 不在其中** —— 这正是本条要补的那一格。

**本任务只重锚 AC-291 一条**：其余 AC（AC-292…303）的页面断言与各自 `<title>` 基线本任务**未逐一实测**，把未测量的判据写进 Touches 正是本仓库禁止的形态；它们的修法与本条**同一行、同一步骤**，可由后续各轮各自的立案复用本条给出的形态。

### 四个修法的取舍

- ✗ **把 web 钉回固定端口**（让部署迁就判据）：拒绝。临时端口默认**有理由**（`start-drivers.ts:20-23` 逐字：一个占住硬编码端口的无关进程曾回答 200，于是脚本报出了假绿）；钉回去等于把那条假绿重新引入，且在判据里写死端口正是硬规则 4 推论二点名的形态。
- ✗ **`superseded` 本 AC**：拒绝。GOAL-024 的退出条件要求切换机制在真实 Web 上可用（本 AC 的 `origin` 即该契约的可执行规格），这条保证**今天仍是本仓库的意图**，且**实测为真**；退役它等于删掉守卫。
- ✗ **`long-term: true`**：不解决。它只把本 AC 搬进 AC-216 复验域（每轮重跑），判据本身仍为假。
- ✓ **重锚判据的派生那一步**：改从**活宿主的载体**取真实监听地址，而不是解析一个已按设计置 0 的字面量。作用对象（`/live`）、判定方式（对运行中实例的外部 HTTP GET + chrome 作用域匹配）、`expect` 全部逐字不变 ⇒ **不减强度**。

### 修法必须满足的性质（⛔ 缺一不可）

1. **地址从活宿主派生，覆盖两种部署形态**：cmdline 显式端口（`--port N`，N ≥ 1）**与**内核分配端口（`--port 0`／无 `--port`，启动器默认）都要能解析。后者真实端口只在**载体**里可知：`.quay/server.json`（`schemaVersion:1`，`pid` + `services[{name,pid,host,port,up}]`）或其结构化读面 `quay server status --json`。正本 reader = `packages/quay/src/server-state.ts`（`readServerState` / `ServerServiceEntry` / `pidAlive` / `probeAddress`）。⛔ 不得把本机当前的端口/主机写成字面量（换台机器或重启即失效）。
2. **载体只用来派生地址，不作判定真值**：判定仍由对 `/live` 的外部 HTTP GET 作出（硬规则 4b：不用被测对象自报的量判它活着）。必须校验 `pid` 是活进程 ∧ `/proc/<pid>/cwd` == `$root`，并**只取 `name == "web"` 那条服务**（同文件里 `control` 端口不同，取错即打到控制面）。
3. **不丢强度**：`expect` 与作用域逐字不变——导航标签只对 `<nav>…</nav>` 区块匹配、`<title>` 只对 `<title>` 匹配（`origin` 明写：⛔ 不对整段响应体做子串匹配，否则 `/board` 的页内 CSS 注释与 `/dashboard` 的活动流任务标题会造成不可满足的假红）；判据仍能取假（AC2）。
4. **候选逐个累积，不被自身进程抹掉**：判据文本本身含 `quay.ts serve` 一词，而 gate 以 `sh -c ". <env> && <criterion>"` 运行（`packages/quay/src/gate/acceptance-runner.ts:151`）⇒ runner 自己的 `sh` 进程也命中 `pgrep`、其 cwd 恰等于 `$root`。任何候选都不得把已派生的地址清空；失败时逐个候选写出 `pid` + 派生地址 + 该候选的成因（地址不可派生 / 连接被拒 / 超时 / 断言不过），⛔ 不得退化成无成因或 `addr=` 空。
5. **fail-closed 保持**：没有活候选 ⇒ 仍非 0（⛔ 不得为了让台账变绿改成 0）；「查不成」与「合格」必须可区分（硬规则 3/3b）。
6. **修订经 goal 写面**（`quay goal write AC-291 --criterion …`，`packages/quay/src/cli/goal.ts:192`）落库，并在记录里写明**为什么改**（承载体搬迁 + 上述读数）。
7. **修订后新 criterionHash 至少有一条独立 `quay goal gate AC-291` 落账**（AC-242 的修订入闸要求：`payload.criterionHash` ≠ 当前指纹的旧轮转 verdict 不得再计 fresh，`packages/quay/src/goal-store.ts:248/286`）。

<!-- dedup-ref -->
去重（按机制，⛔ 不按症状关键词）与可追溯性：顶层 `grep -rn '^goal_ac: AC-291' tasks/*.md` ⇒ **1 命中**，`gap-ac291-live-page-zh-chrome-nav-current-and-own-title`，status **done** ⇒ 本 AC 无在飞主，本条不是重复立案，而是「承载体搬迁 ⇒ 判据 stale」这一机制在本 AC 上的实例。同机制、不同 AC 的在飞任务：`gap-ac179-criterion-cmdline-port-literal-stale`、`gap-ac288-criterion-cmdline-port-literal-stale`、`gap-ac289-criterion-cmdline-port-literal-stale`、`gap-ac290-criterion-cmdline-port-literal-stale`（四条均 `ready`）——各自重锚自己那一条，均不覆盖 AC-291，与本条互不重复。同型先例（承载体搬迁后把判据移到真正承载该角色的地方）：`gap-ac286-fanin-merge-target-criterion-carrier-stale`（done）、`gap-ac157-catalog-carrier-moved-criterion-stale`（done）。引入临时端口默认的 `gap-serve-same-root-admission-lock`（done）改的是**启动器**，从未重锚过任何判据——相关但不同机制。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-291 --dry-run --json` ⇒ `verdict: fail` 且 `addr=172.28.0.1:0`；同一时刻 `cat .quay/server.json` 取 `name=="web"` 的端口读数，**两者必须指向同一 pid**。
2. **确认依赖已落地 + 读【实际】签名**：`git cat-file -e develop:packages/quay/src/server-state.ts`、`grep -n 'export function readServerState\|export interface ServerServiceEntry\|export function pidAlive\|export function probeAddress' packages/quay/src/server-state.ts`、`node packages/quay/bin/quay.js server status --json`。**⛔ 不按本任务 Plan 预写的签名假设**：以实际导出为准；任一无命中 ⇒ **停下报缺**。
3. **重锚 AC-291 的判据**：把 `goals/AC-291-*.md` 的 criterion 里「从 cmdline `--host … --port …` 派生 addr」那一步替换为「活宿主载体派生」（两种形态都覆盖），其余逐字不动；经 `quay goal write AC-291 --criterion "$(cat <新判据文件>)"` 落库。
4. **两个负控制**（硬规则 4 推论三：判据必须能取假）：① 无实例时仍非 0（`CAUSE=no-running-serve-instance`）；② 把候选地址指向一个必然连不上的端口 ⇒ 非 0 且成因可区分。**⛔ 不得直接在 `goals/AC-291-*.md` 上手改**（必须走 `quay goal write`）。
5. **落账**：`node packages/quay/bin/quay.js goal gate AC-291` ⇒ exit 0，且台账新增一条 `verdict:"pass"` 的事件，其 `payload.criterionHash` **≠ 修订前的指纹**。

## AC

- [x] **AC1（承载体已重锚且不减强度）**：`goals/AC-291-*.md` 的 criterion 不再解析 `--port [0-9]+` 字面量派生地址，改从活宿主载体取；`expect` 与正文语义逐字不变（贴 `git diff`，只有派生那一步与「为什么改」的说明变化）。⛔ 除非经 `quay goal write` 落库否则不算。
- [x] **AC2（判据能取假 —— 两个负控制）**：① 无运行实例时 `quay goal gate AC-291` 非 0 且以 `CAUSE=no-running-serve-instance` 可区分；② 候选地址指向必然连不上的端口时非 0 且成因可区分。两条均贴退出码与逐字 stderr。
- [x] **AC3（正控制：修订后在活实例上为真）**：`node packages/quay/bin/quay.js goal gate AC-291` ⇒ **exit 0**，逐字贴出；且同一时刻四条断言各自独立可核（en nav `Live` 计数 ≥1 / zh 响应含 `<html lang="zh"` / zh nav `Live` 计数 =0 / zh `<title>` ≠ en `<title>`）。
- [x] **AC4（地址覆盖两种部署形态）**：对显式端口实例与 `--port 0` 实例（或用两种 cmdline 的夹具）各断言派生地址正确；贴出两种形态下的派生结果。⛔ 不把本机当前端口写进任何文件。
- [x] **AC5（不回归 + 作用域枚举）**：① `bash scripts/test.sh --for-task gap-ac291-criterion-cmdline-port-literal-stale` 绿；② 作用域举证：`grep -rc "grep -oE -- '--host \[^ \]+ --port \[0-9\]+'" goals/` **逐文件**贴出并与立案基线对照（总数 **17**）：本任务后 **AC-291 那一条 1→0**，其余 **16 个文件计数一字未动**（它们各自归自己的立案轮）。⛔ 若同族在飞任务已落地，本条判据是**逐文件差量**，不是绝对值。
- [x] **AC6（新指纹落账）**：台账 `.quay/gate-events.jsonl` 中 `item_id=AC-291` 的最后一条为 `verdict:"pass"`，且其 `payload.criterionHash` ≠ 修订前指纹（贴两行）。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本改了、dry-run 绿了」，而是 **一条真实的、在活服务上为真的判据落了账**：

1. **落地对象**：`goals/AC-291-*.md` 的 criterion 经 `quay goal write` 落库（⛔ 非手工 Edit），且 `quay goal gate AC-291` 在**运行中的** `quay.ts serve`（cwd = 仓库根）上返回 exit 0。
2. **台账**：`.quay/gate-events.jsonl` 出现 `item_id=AC-291` / `gate=goal` / `verdict=pass` / `actor=goal-cli` 的新事件，`criterionHash` 与修订前不同 —— 一条 dry-run 输出**不算**。
3. **负控制留痕**：两个负控制（无实例 / 连不上的端口）的退出码与 `CAUSE=` 逐字留存，证明判据不是恒真。
4. **家族差量**：AC5 的逐文件计数表（17 格）贴出，证明本次作用域**只有 AC-291 那一格**发生变化。
5. **⛔ 三种「凑绿」明令禁止**：改 `expect` 语义、把端口写死回固定值、把 `/live` 的判据放宽成整段响应体子串匹配（`origin` 明写这会因页内 CSS 注释/活动流任务标题造成不可满足的假红）。

## Touches

- `goals/AC-291-live-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md`
- `packages/quay/test/ac291-criterion-address-derivation.test.mjs` (new)
- `tasks/gap-ac291-criterion-cmdline-port-literal-stale.md`

（说明：第一条是本任务的落地面——criterion 的地址派生那一步，经 `quay goal write AC-291 --criterion …` 落库，`expect` 与正文语义逐字不变、只补「为什么改」；第二条是配套夹具（两种部署形态的派生正/负控制）；第三条是 self-touch。⛔ 不新增 `plugin/scripts/*.ts`——派生助手若要抽出，默认放 `packages/quay/src/`；若最终落在 `plugin/scripts/`，必须同时把 outline、`plugin/scripts/capability-catalog-declarations.json` 与本任务 Touches 一并更新。）

## Evidence（执行轮，2026-09-23T14:20–14:35Z，worker worktree `/home/yale/work/quay-worktrees/gap-ac291-criterion-cmdline-port-literal-stale`）

⛔ 本节的每条读数都是本执行轮的**直接量**；未跟踪的原始 bundle 在同 worktree 的 `.quay/ac291-*.txt` / `.quay/ac291-*.sh`（下一轮可用同样脚本独立复算）。

### 落库与指纹（AC1 / AC6 的载体）

```
cf5a0a7bf goals: AC-291 field:criterion by cli:1138007     ← worktree 终版（argv 版派生）
4aa2fc0d4 goals: AC-291 field:criterion by cli:4051302
0748b9920 goals: AC-291 field:criterion by cli:3732539
e6ee77ab8 test(ac291): bind the re-anchored address derivation to the stored criterion
26e13c0fa / 8a3c9ccbf  goals: AC-291 field:criterion …      ← 主检出（生产 goal store；终版已随 doc 同步可见于 develop）
```

- 旧 criterionHash（台账 `2026-09-23T05:08:40.467Z` goal-sweep pass 与 `08:36:03.044Z` fail **同一值**）：`848bfb6418f2a892`
- 新 criterionHash：`f455d4534f8067e9`（`criterionFingerprint` 实算，非目测）
- 新 criterion md5：`e13b1ab9ad8530581d6c17522522036a`
- 主检出与 worktree 的 goal 文件**逐字相同**（`diff` 空 ⇒ fan-in 无冲突）
- `expect` 字段：`git diff` 无变化（逐字保留）；断言块（`<nav>` 区块抽取 / `title_of()` / `<html lang="zh"` / `nav-label-untranslated` / `title-unchanged` / `echo OK`）与 11 条 `CAUSE=` 文本逐字保留；改的只有「派生那一步」+「为什么改」注释块。
  - 旧派生 = `grep -oE -- '--host [^ ]+ --port [0-9]+'`（从 joined cmdline 取端口字面量）；新派生 = `awk` **逐 argv 元素**认 `serve` 子命令 + `--host`/`--port`（显式 N≥1 直接用），否则回落活宿主载体 `$root/.quay/server.json`（**只取 `name=="web"`**，并校验 `carrier.pid == 候选 pid` ∧ 候选 `/proc/<pid>/cwd == $root`）。
  - ⛔ 判据仍能取假（见 AC2），⛔ 判据里没有任何 host/port 字面量（每次运行重新派生）。

### 勾选写面

AC1–AC6 的勾选经 **Provider ABI** 落库：`quay-native task edit gap-ac291-… --body "$(cat <新 body>)"` —— body 由脚本从**当前 body** 生成（`- [ ]` → `- [x]` 只动 6 行的复选框字符，AC 正文逐字不变；再追加本节），⛔ 不是手改 `- [ ]` 字符。
落库后 `task_check` 独立确认 AC 全勾 ⇒ `ok:true`。

### AC1 —— 承载体重锚（活生产实例上为真，见 AC3）

### AC2 —— 两个负控制（同一判据文本，worktree root）

```
$ node packages/quay/bin/quay.js goal gate AC-291 --root <worktree>     # 无 serve 实例
GATE_EXIT=1
reason: acceptance failed (exit 1) — AC-291 candidate readings (cwd=…, nserve=0, ncand=1, nderived=0):
  ; pid=1694355 addr=<none> argv=argv-no-serve-subcommand cause=carrier-unreadable
  CAUSE=no-running-serve-instance -- no quay.ts serve process with cwd=…; /live cannot be evaluated on a live surface (AC-179 probe pattern)

$ sh .quay/ac291-e3b-deadport.sh /tmp/ac291/stored-criterion.sh           # 活候选 + 载体指向死端口
--- criterion run (cwd=/tmp/ac291-dead.rT1mC2) ---
AC-291 candidate readings (cwd=/tmp/ac291-dead.rT1mC2, nserve=1, ncand=2, nderived=1):
  ; pid=1694568 addr=127.0.0.1:11355 argv=argv-port-kernel-assigned cause=fetch-failed(connection-refused) -- curl: (7) Failed to connect to 127.0.0.1 port 11355 after 0 ms: Couldn't connect to server
  ; pid=1695340 addr=<none> argv=argv-no-serve-subcommand cause=carrier-pid-mismatch
CAUSE=no-reachable-serve-address -- 1 derivable address(es) among 1 candidate(s) for cwd=…, none answered /live (connection refused / timed out / non-2xx)
CRITERION_EXIT=1
```

**三态可区分**（硬规则 3）：`nserve=0` ⇒ `no-running-serve-instance`；`nserve=1 nderived=0` ⇒ `no-derivable-serve-address`；`nserve=1 nderived=1` 但连不上 ⇒ `no-reachable-serve-address`（第三条由夹具单测同样覆盖）。每个候选都带 `pid` + `addr` + `argv`（派生来源）+ `cause`，⛔ 无 `addr=` 空、无无成因行。
**runner 自身也在候选里**（gate 以 `sh -c` 跑判据 ⇒ 其 cwd == `$root` 且 cmdline 含判据文本）——上表 `pid=… argv=argv-no-serve-subcommand cause=carrier-pid-mismatch` 那行就是它；它**不计入 `nserve`**，这正是 `no-running-serve-instance` 在 gate 路径上仍然可达（不被自身进程抹掉）的原因。

### AC3 —— 正控制：修订后的判据在**运行中的生产实例**上为真

```
$ cd /data/home/yale/work/quay && sh -c "$(cat /tmp/ac291/stored-criterion.sh)"   # cwd = 仓库根 = 生产实例 cwd
EXIT=0
stderr: AC-291 candidate readings (cwd=/data/home/yale/work/quay, nserve=1, ncand=2, nderived=1):
  ; pid=1449431 addr=127.0.0.1:15147 argv=argv-port-kernel-assigned cause=fetch-answered
  ; pid=1594202 addr=<none> argv=argv-no-serve-subcommand cause=carrier-pid-mismatch
stdout: OK -- /live: default nav region carries "Live" and <title>="quay — Live — loop activity"; under Cookie: lang=zh the response is <html lang=zh>, that English nav label is gone from the nav region, and this page's own <title> became "quay — 实时 — 循环活动"
```

四条断言各自独立复算（对生产端口 `127.0.0.1:15147` 的两条响应体直读，`.quay/ac291-four-assertions.mjs`）：

```
(1) en nav region: "Live" count = 2        (>=1 required)
(2) zh response contains <html lang="zh": true
(3) zh nav region: "Live" count = 0        (0 required)
(4) en title = "<title>quay — Live — loop activity</title>"
    zh title = "<title>quay — 实时 — 循环活动</title>"   titles differ: true
```

同时 `node packages/quay/bin/quay.js goal gate AC-291 --root /data/home/yale/work/quay` ⇒ `exit 0`（`actor: goal-cli`）。修订前同一命令在生产上是 **fail**：`verdict: fail — CAUSE=en-fetch-failed -- GET http://127.0.0.1:0/live returned nothing (addr=127.0.0.1:0)`（同轮 dry-run 重测 `2026-09-23T14:25:35.236Z`，`verdict: fail`；台账另有 `14:26:03.814Z` actor=goal-cli 的 fail 一条，同一成因）。

### AC4 —— 两种部署形态（各对**真实例**，非夹具；夹具单测同覆盖）

```
shape 2（启动器默认 --port 0）: cmdline `… serve --host 127.0.0.1 --port 0`；carrier web = 127.0.0.1:6409
  ⇒ pid=1634432 addr=127.0.0.1:6409 argv=argv-port-kernel-assigned cause=fetch-answered   CRITERION_EXIT=0
shape 1a（显式 --port 8391）: cmdline `… serve --host 127.0.0.1 --port 8391`；carrier web = 127.0.0.1:8391
  ⇒ pid=1642585 addr=127.0.0.1:8391 argv=argv-explicit-port cause=fetch-answered           CRITERION_EXIT=0
shape 1b（同一活实例，**删掉载体**）: carrier: absent
  ⇒ pid=1642585 addr=127.0.0.1:8391 argv=argv-explicit-port cause=fetch-answered           CRITERION_EXIT=0
```

shape 1b 是关键：载体不存在时仍派生出 8391 ⇒ 该形态确实走 argv 而非载体；shape 2 的 `--port 0` 被 `argv-port-kernel-assigned` 拒绝后由载体给出真实端口。⛔ 本机当前端口未写进任何受控文件（只在未跟踪 evidence 里）。

### AC5 —— 不回归 + 作用域逐文件枚举

① scoped 门：`bash scripts/test.sh --for-task gap-ac291-criterion-cmdline-port-literal-stale --allow-thin` ⇒ **exit 0**（13/13 单测通过）。跑了**两次**：第一次在 `Merge branch 'develop'`（`936522f87`）之后（`developSha=8a3c9ccbf7b5418c5cd8b01e36d770cda25d5978`），随后 develop 又前进到 `291c5121e`（本任务的 AC 勾选落库 + 同族 AC-293 的 goal 修订，都是 doc 面），于是**再 merge 一次 develop**（`edbef2bb9`）并**重跑**同一命令 ⇒ 仍 exit 0（13/13）。scoped-gate 缓存按最终 tip 落：`developSha=291c5121e7411ee5cff6213367f7741ed4e531ac`。

② 家族计数（`grep -F -c "grep -oE -- '--host [^ ]+ --port [0-9]+'"`；before = 本任务 fork 点 `bed012a86`）：

```
file (goals/)                 before  after
AC-179                           1      1
AC-289                           1      1
AC-291                           1      0   <== 唯一变化
AC-292                           1      1
AC-293                           1      1
AC-294                           1      1
AC-295                           1      1
AC-296                           1      1
AC-298                           1      1
AC-299                           1      1
AC-300                           1      1
AC-301                           1      1
AC-302                           1      1
AC-303                           1      1
TOTAL files with the literal    14     13
```

- 本任务只动 AC-291 那一格（1→0），其余 13 个文件计数**一字未动**。
- ⚠️ 与立案轮（Proposal/AC5 写的 **17**）的差：立案后同族 **AC-288 / AC-290 / AC-297** 的重锚已先后落地（`git log develop -- goals/`：`51ad3c709` / `ffc11ee98` / `c7615c52e`），故 fork 点基线已是 14。按 AC5 自己的口径（「若同族在飞任务已落地，本条判据是逐文件差量，不是绝对值」）以逐文件差量为准。

### AC6 —— 新指纹落账（生产台账 `.quay/gate-events.jsonl`，`item_id=AC-291` 末三条）

```
{"ts":"2026-09-23T14:29:49.013Z","gate":"goal","actor":"goal-cli","verdict":"pass","criterionHash":"(absent)","reason":"acceptance passed (exit 0)"}
{"ts":"2026-09-23T14:29:52.196Z","gate":"goal","actor":"goal-amend","verdict":"pass","criterionHash":"f455d4534f8067e9","reason":"acceptance passed (exit 0)"}
```

最后一条 = `verdict:"pass"` 且 `payload.criterionHash = f455d4534f8067e9 ≠ 848bfb6418f2a892`（修订前指纹）✅；`actor:"goal-cli"` 的 pass 事件紧随其前（DoD 第 1/2 条的 actor+verdict）。
**两条读数都不是手写的**：`goal-cli` 那条由 `quay goal gate AC-291` 产出；`goal-amend` 那条由 goal 机制自己的**有界轮转**（`sweepFrozen({budget:1})`，同一方法 `goal check --stale-pass --sweep` 调用）产出——它把 AC-291 排在第一位是因为**修订优先**（上一条轮转 verdict 的 hash 与当前判据不符）。⛔ 未手写任何 ledger 行。

### 负控制留痕之外的两条自检

- `anti-drift-touches-check.ts --task gap-ac291-… --worktree <worktree> --merge-target develop` ⇒ `ANTI-DRIFT OK: 1 actual file(s), all within declared Touches`。
- 本任务 Touches 三条声明与实际 delta 一致（分支对 develop 的 delta = 新单测一个文件；goal 文件已随 doc 同步在 develop 上，故不在 delta 内）。

## Evidence（复验轮，2026-09-23T17:15–17:20Z，worker worktree `/data/home/yale/work/quay-worktrees/gap-ac291-criterion-cmdline-port-literal-stale`）

上一轮（执行轮）读数里的 pid / 端口已随生产实例重启失效，故本轮**重取全部直接量**；六条 AC 的判定与上一轮一致，**无一条状态变化**。原始留痕：worktree 内 `.quay/ac291-r2-*.txt|sh|mjs`（未跟踪）。

- **AC3 正控制**：生产实例 pid `2035152`，cwd = 仓库根，cmdline `… serve --host 0.0.0.0 --port 0`；criterion 直跑 ⇒ **exit 0**，逐字：
  `AC-291 candidate readings (cwd=/data/home/yale/work/quay, nserve=1, ncand=1, nderived=1):; pid=2035152 addr=127.0.0.1:10539 argv=argv-port-kernel-assigned cause=fetch-answered`
  四条断言各自独立复算（对 `127.0.0.1:10539` 的两条响应体直读）：en nav `Live` 计数 = **2**（≥1）/ zh 响应含 `<html lang="zh"` = **true** / zh nav `Live` 计数 = **0** / en `<title>` `quay — Live — loop activity` ≠ zh `<title>` `quay — 实时 — 循环活动`。
  `node packages/quay/bin/quay.js goal gate AC-291` ⇒ **exit 0**，台账新增 `actor:"goal-cli"` / `verdict:"pass"` / `2026-09-23T17:15:43.159Z`。同一命令在修订前是 fail（`CAUSE=en-fetch-failed … addr=…:0`）。
- **AC2 两个负控制（本轮重取）**：① `goal gate AC-291 --root <worktree>`（无实例）⇒ **exit 1**，`CAUSE=no-running-serve-instance`（`nserve=0`；gate 自身的 `sh -c` runner 确实出现在候选里、以 `argv-no-serve-subcommand` 被排除出 `nserve`）；② 活候选（cwd = 临时仓库根，argv 带 `--port 0`）+ 载体指向无人监听的端口 `8841` ⇒ **exit 1**，`CAUSE=no-reachable-serve-address`，逐候选 `cause=fetch-failed(connection-refused)`。三态（`no-running-serve-instance` / `no-derivable-serve-address` / `no-reachable-serve-address`）可区分。
- **AC4 两种部署形态（本轮重取，均对真实例）**：显式端口（worktree 内起 `serve --host 127.0.0.1 --port 29843`，pid `2959726`）⇒ `argv=argv-explicit-port addr=127.0.0.1:29843 cause=fetch-answered`，**exit 0**；**把载体移走后重跑仍 exit 0**（另一候选 `carrier-unreadable`）⇒ 证明该形态走 argv 而非载体。内核分配端口（生产实例 `--port 0`）⇒ `argv-port-kernel-assigned`，真实端口由载体给出 `10539` ⇒ **exit 0**。`0.0.0.0` 归一化由生产实例（bind `0.0.0.0`）实测覆盖；「无 `--port`」由夹具覆盖。
- **AC6 指纹**：本轮实算当前 `criterionFingerprint` = `f455d4534f8067e9` ≠ 修订前 `848bfb6418f2a892`；台账该 AC 另有 `goal-amend`（`2026-09-23T14:29:52.196Z`）与 `goal-sweep`（`2026-09-23T16:11:33.354Z`）两条带此指纹的 `pass`。
- **AC5 家族逐文件差量**（fork `bed012a86` ⇒ develop，`git grep -F -c`）：**14 文件 → 2 文件**，每文件计数 1；**AC-291 那格 1→0**，其余 13 格的下降各归其自身立案轮 —— 本任务只动 AC-291 一格。scoped 门 `bash scripts/test.sh --for-task gap-ac291-… --allow-thin` ⇒ **exit 0**（13/13）；scoped-gate 缓存按 `develop=7b6042c87746d1c0dcbe886d3a567546624cf00c` 落。
- 分支对 develop 的 delta = 单个新文件 `packages/quay/test/ac291-criterion-address-derivation.test.mjs`（goal 文件已随 doc 同步在 develop 上，故不在 delta 内）。