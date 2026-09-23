---
id: gap-ac292-criterion-cmdline-port-literal-stale
title: AC-292 判据从 cmdline 的 `--port` 字面量派生地址，而生产启动器默认已是 `--port 0`（内核分配临时端口）⇒
  判据结构上恒假（addr=172.28.0.1:0，curl 失败）；机制本身为真（实测 /board 四条断言全过）—— 重锚地址派生那一步（与
  AC-179/288/289/290/291 在飞任务同一行）
status: done
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-292
---
**type:** execution

## Proposal

**缺口（立案当轮直接量，2026-09-23T08:45:24Z，cwd = 主检出 `/data/home/yale/work/quay`）**

```
node packages/quay/bin/quay.js goal gate AC-292 --dry-run --json
⇒ {"id":"AC-292","verdict":"fail",
   "reason":"acceptance failed (exit 1) — CAUSE=en-fetch-failed -- GET http://172.28.0.1:0/board returned nothing (addr=172.28.0.1:0)",
   "timestamp":"2026-09-23T08:45:24.705Z","dryRun":true}
```

**成因不是「机制坏了」—— 是判据派生地址的那一步解析了一个启动器已按设计置 0 的字面量。**

同一进程、同一时刻的三个读数（立案轮实测，⛔ 非转述）：

| 面 | 读数 | 取法 |
|---|---|---|
| 生产实例 | pid `3239217`，cwd = `/data/home/yale/work/quay`，cmdline `node --experimental-strip-types packages/quay/bin/quay.ts serve --host 172.28.0.1 --port 0` | `pgrep -f 'quay.ts serve'` + `readlink /proc/<pid>/cwd` |
| 判据按 cmdline 派生的地址 | `172.28.0.1:0` ⇒ `curl -sf --max-time 10` 失败 ⇒ `CAUSE=en-fetch-failed` | criterion 第 18 行 `grep -oE -- '--host [^ ]+ --port [0-9]+'` |
| 同一进程的**真实**监听地址（载体 `.quay/server.json`） | `web 172.28.0.1:4601`（另有 `control 127.0.0.1:6065`，端口不同，取错会打到控制面） | `cat .quay/server.json` / `quay server status --json` |

**在真实监听地址上，本 AC 的保证逐条成立**（立案轮对 `http://172.28.0.1:4601/board` curl 直读，四条断言全过）：

```
① en nav 区块（grep -o '<nav.*</nav>'）内字面量 "Board" 计数 = 1   （en 基线在场）
② GET /board (Cookie: lang=zh) → 响应含 <html lang="zh"           （页头真的切了）
③ 同一响应的 nav 区块内 "Board" 计数 = 0                           （英文 nav 标签消失）
④ <title> en = [quay — Board — 三源 join 看板]
     <title> zh = [quay — 看板 — 三源 join 看板]                  （本页自己的 title 逐字不同）
```

⇒ **判据的四段断言（en nav 基线在场 / `<html lang="zh">` / 该英文标签自 nav 消失 / 本页 `<title>` 相对 en 变化）全部为真**。台账的「此刻为假」是**判据的承载体失效**，不是被服务的代码退化。

### 为什么更早的两次修复没兜住（本 AC 上已有两条 done 任务）

| 任务 | done 时刻 | 它做了什么 |
|---|---|---|
| `gap-ac292-board-page-zh-chrome-nav-current-and-own-title` | 2026-09-17 18:40 | 把 `/board` 的 `<html lang>` / `<title>` / nav 当前项逐个接上 lang（其 Proposal 逐条列出了 `serve-board.ts:230-232` 五个 `Board` 字面量的归属） |
| `gap-ac292-criterion-cold-miss-30s-ttl-always-expired` | 2026-09-18 09:53 | 修判据的**间歇假红**：请求路径现付 30s-TTL 冷构建（冷 9.3–16.6s）越过 `curl --max-time 10` |

两条都是真修复，且都**没有碰「地址派生」这一步**——第一条的 AC4 逐字把判据自身的修法排除在自己的 Touches 之外（「⛔ 明令禁止的三种凑绿：改判据（`goals/AC-292-*.md` ⛔ 不在本 Touches 内）」），第二条只治超时。

**而破坏这一步的提交落在两条 done 之后**：`ce0f47518`（2026-09-18 **10:22**，`gap-serve-same-root-admission-lock`）把 web 端口默认改成内核分配临时端口（`start-drivers.ts:58-59` 逐字：`--port` 可选且默认 `0`；`:27-28` 逐字「the default port is now kernel-assigned, so the carrier is the only place the port is knowable」）。**在那之前** web 由人以显式端口启动 ⇒ cmdline 里恰好有可解析的端口、判据活着。生产实例于 2026-09-23T08:37:40Z 按该默认重启（`.quay/server.json` `startedAt`）⇒ 判据自此**结构上恒假**。

目标文件自 2026-09-17 起未再改动：`git log -1 -- goals/AC-292-*.md` = `c35b74766`（status active→achieved），当前 `md5 14baa347832692830b19c821e64af226`。

### 家族（枚举，硬规则 3；⛔ 不是一个布尔）

同一条派生逐字出现在 **17 个** goal 文件里：

```
grep -rlF "grep -oE -- '--host [^ ]+ --port [0-9]+'" goals/ | wc -l   ⇒ 17
其中含 goals/AC-292-…（本任务对象）
```

<!-- dedup-ref -->
去重（按机制，⛔ 不按症状关键词）：顶层 `grep -rn '^goal_ac: AC-292' tasks/*.md` ⇒ **2 命中**，`gap-ac292-board-page-zh-chrome-nav-current-and-own-title` 与 `gap-ac292-criterion-cold-miss-30s-ttl-always-expired`，**status 均 done** ⇒ 本 AC 无在飞主，本条不是重复立案，而是「承载体搬迁 ⇒ 判据 stale」这一机制在本 AC 上的实例。同机制、不同 AC 的在飞任务：`gap-ac179-criterion-cmdline-port-literal-stale`、`gap-ac288-criterion-cmdline-port-literal-stale`、`gap-ac289-criterion-cmdline-port-literal-stale`、`gap-ac290-criterion-cmdline-port-literal-stale`、`gap-ac291-criterion-cmdline-port-literal-stale`（五条均 `ready`）——各自重锚自己那一条，均不覆盖 AC-292，与本条互不重复。同型先例（承载体搬迁后把判据移到真正承载该角色的地方）：`gap-ac286-fanin-merge-target-criterion-carrier-stale`（done）、`gap-ac157-catalog-carrier-moved-criterion-stale`（done）。引入临时端口默认的 `gap-serve-same-root-admission-lock`（done）改的是**启动器**，从未重锚过任何判据——相关但不同机制。

### 本任务只重锚 AC-292 一条

其余 AC（AC-293…AC-303）的页面断言与各自 `<title>` 基线本任务**未逐一实测**，把未测量的判据写进 Touches 正是本仓库禁止的形态；它们的修法与本条**同一行、同一步骤**，可由后续各轮各自的立案复用本条给出的形态。

### 四个修法的取舍

- ✗ **把 web 钉回固定端口**（让部署迁就判据）：拒绝。临时端口默认**有理由**（`start-drivers.ts:20-23` 逐字：一个占住硬编码端口的无关进程曾回答 200，于是脚本报出了假绿）；钉回去等于把那条假绿重新引入，且在判据里写死端口正是硬规则 4 推论二点名的形态。
- ✗ **`superseded` 本 AC**：拒绝。GOAL-024 的退出条件要求切换机制在真实 Web 上可用（本 AC 的 `origin` 即该契约的可执行规格），这条保证**今天仍是本仓库的意图**，且**实测为真**；退役它等于删掉守卫。
- ✗ **`long-term: true`**：不解决。它只把本 AC 搬进 AC-216 复验域（每轮重跑），判据本身仍为假。
- ✓ **重锚判据的派生那一步**：改从**活宿主的载体**取真实监听地址，而不是解析一个已按设计置 0 的字面量。作用对象（`/board`）、判定方式（对运行中实例的外部 HTTP GET + chrome 作用域匹配）、`expect` 全部逐字不变 ⇒ **不减强度**。

### 修法必须满足的性质（⛔ 缺一不可）

1. **地址从活宿主派生，覆盖两种部署形态**：cmdline 显式端口（`--port N`，N ≥ 1）**与**内核分配端口（`--port 0`／无 `--port`，启动器默认）都要能解析。后者真实端口只在**载体**里可知：`.quay/server.json`（`schemaVersion:1`，`pid` + `services[{name,pid,host,port,up}]`）或其结构化读面 `quay server status --json`。正本 reader = `packages/quay/src/server-state.ts`（实测导出 `readServerState` `:142` / `ServerServiceEntry` `:53` / `pidAlive` `:187` / `probeAddress` `:220`）。⛔ 不得把本机当前的端口/主机写成字面量（换台机器或重启即失效）。
2. **载体只用来派生地址，不作判定真值**：判定仍由对 `/board` 的外部 HTTP GET 作出（硬规则 4b：不用被测对象自报的量判它活着）。必须校验 `pid` 是活进程 ∧ `/proc/<pid>/cwd` == `$root`，并**只取 `name == "web"` 那条服务**（同文件里 `control` 端口不同，取错即打到控制面）。
3. **不丢强度**：`expect` 与作用域逐字不变——导航标签只对 `<nav>…</nav>` 区块匹配、`<title>` 只对 `<title>` 匹配（`origin` 明写：⛔ 不对整段响应体做子串匹配，否则 `/board` 页内 CSS 注释那一行 `...and the Board NEW badge. */` 会造成不可满足的假红）；判据仍能取假（AC2）。
4. **候选逐个累积，不被自身进程抹掉**：判据文本本身含 `quay.ts serve` 一词，而 gate 以 `sh -c ". <env> && <criterion>"` 运行（`packages/quay/src/gate/acceptance-runner.ts:151`）⇒ runner 自己的 `sh` 进程也命中 `pgrep`、其 cwd 恰等于 `$root`。任何候选都不得把已派生的地址清空；失败时逐个候选写出 `pid` + 派生地址 + 该候选的成因（地址不可派生 / 连接被拒 / 超时 / 断言不过），⛔ 不得退化成无成因或 `addr=` 空。
5. **fail-closed 保持**：没有活候选 ⇒ 仍非 0（⛔ 不得为了让台账变绿改成 0）；「查不成」与「合格」必须可区分（硬规则 3/3b）。
6. **修订经 goal 写面**（`quay goal write AC-292 --criterion …`，`packages/quay/src/cli/goal.ts:192`）落库，并在记录里写明**为什么改**（承载体搬迁 + 上述读数）。
7. **修订后新 criterionHash 至少有一条独立 `quay goal gate AC-292` 落账**（AC-242 的修订入闸要求：`payload.criterionHash` ≠ 当前指纹的旧轮转 verdict 不得再计 fresh，`packages/quay/src/goal-store.ts:248/286`）。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-292 --dry-run --json` ⇒ `verdict: fail` 且 `addr=172.28.0.1:0`；同一时刻 `cat .quay/server.json` 取 `name=="web"` 的端口读数，**两者必须指向同一 pid**。
2. **确认依赖可读 + 读【实际】签名**：`grep -n 'export function readServerState\|export interface ServerServiceEntry\|export function pidAlive\|export function probeAddress' packages/quay/src/server-state.ts`、`node packages/quay/bin/quay.js server status --json`。**⛔ 不按本任务 Plan 预写的签名假设**：以实际导出为准；任一无命中 ⇒ **停下报缺**。
3. **重锚 AC-292 的判据**：把 `goals/AC-292-*.md` 的 criterion 里「从 cmdline `--host … --port …` 派生 addr」那一步替换为「活宿主载体派生」（两种形态都覆盖），其余逐字不动；经 `quay goal write AC-292 --criterion "$(cat <新判据文件>)"` 落库。
4. **两个负控制**（硬规则 4 推论三：判据必须能取假）：① 无实例时仍非 0（`CAUSE=no-running-serve-instance`）；② 把候选地址指向一个必然连不上的端口 ⇒ 非 0 且成因可区分。**⛔ 不得直接在 `goals/AC-292-*.md` 上手改**（必须走 `quay goal write`）。
5. **落账**：`node packages/quay/bin/quay.js goal gate AC-292` ⇒ exit 0，且台账新增一条 `verdict:"pass"` 的事件，其 `payload.criterionHash` **≠ 修订前的指纹**。

## AC

- [x] **AC1（承载体已重锚且不减强度）**：`goals/AC-292-*.md` 的 criterion 不再解析 `--port [0-9]+` 字面量派生地址，改从活宿主载体取；`expect` 与正文语义逐字不变（贴 `git diff`，只有派生那一步与「为什么改」的说明变化）。⛔ 除非经 `quay goal write` 落库否则不算。
- [x] **AC2（判据能取假 —— 两个负控制）**：① 无运行实例时 `quay goal gate AC-292` 非 0 且以 `CAUSE=no-running-serve-instance` 可区分；② 候选地址指向必然连不上的端口时非 0 且成因可区分。两条均贴退出码与逐字 stderr。
- [x] **AC3（正控制：修订后在活实例上为真）**：`node packages/quay/bin/quay.js goal gate AC-292` ⇒ **exit 0**，逐字贴出；且同一时刻四条断言各自独立可核（en nav `Board` 计数 ≥1 / zh 响应含 `<html lang="zh"` / zh nav `Board` 计数 =0 / zh `<title>` ≠ en `<title>`）。
- [x] **AC4（地址覆盖两种部署形态）**：对显式端口实例与 `--port 0` 实例（或用两种 cmdline 的夹具）各断言派生地址正确；贴出两种形态下的派生结果。⛔ 不把本机当前端口写进任何文件。
- [x] **AC5（不回归 + 作用域枚举）**：① `bash scripts/test.sh --for-task gap-ac292-criterion-cmdline-port-literal-stale` 绿；② 作用域举证：`grep -rlF "grep -oE -- '--host [^ ]+ --port [0-9]+'" goals/` **逐文件**贴出并与立案基线对照（总数 **17**）：本任务后 **AC-292 那一条 1→0**，其余 **16 个文件不受本条影响**（它们各自归自己的立案轮）。⛔ 若同族在飞任务已落地，本条判据是**逐文件差量**，不是绝对值。
- [x] **AC6（新指纹落账）**：台账 `.quay/gate-events.jsonl` 中 `item_id=AC-292` 的最后一条为 `verdict:"pass"`，且其 `payload.criterionHash` ≠ 修订前指纹（贴两行）。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本改了、dry-run 绿了」，而是 **一条真实的、在活服务上为真的判据落了账**：

1. **落地对象**：`goals/AC-292-*.md` 的 criterion 经 `quay goal write` 落库（⛔ 非手工 Edit），且 `quay goal gate AC-292` 在**运行中的** `quay.ts serve`（cwd = 仓库根）上返回 exit 0。
2. **台账**：`.quay/gate-events.jsonl` 出现 `item_id=AC-292` / `gate=goal` / `verdict=pass` / `actor=goal-cli` 的新事件，`criterionHash` 与修订前不同 —— 一条 dry-run 输出**不算**。
3. **负控制留痕**：两个负控制（无实例 / 连不上的端口）的退出码与 `CAUSE=` 逐字留存，证明判据不是恒真。
4. **家族差量**：AC5 的逐文件计数表贴出，证明本次作用域**只有 AC-292 那一格**发生变化。
5. **⛔ 三种「凑绿」明令禁止**：改 `expect` 语义、把端口写死回固定值、把 `/board` 的判据放宽成整段响应体子串匹配（`origin` 明写这会因页内 CSS 注释 `...and the Board NEW badge. */` 造成不可满足的假红）。

## Touches

- `goals/AC-292-board-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md`
- `packages/quay/test/ac292-criterion-address-derivation.test.mjs` (new)
- `tasks/gap-ac292-criterion-cmdline-port-literal-stale.md`

（说明：第一条是本任务的落地面——criterion 的地址派生那一步，经 `quay goal write AC-292 --criterion …` 落库，`expect` 与正文语义逐字不变、只补「为什么改」；第二条是配套夹具（两种部署形态的派生正/负控制）；第三条是 self-touch。⛔ 不新增 `plugin/scripts/*.ts`——派生助手若要抽出，默认放 `packages/quay/src/`；若最终落在 `plugin/scripts/`，必须同时把 outline、`plugin/scripts/capability-catalog-declarations.json` 与本任务 Touches 一并更新。⛔ `packages/quay/src/serve-board.ts` 等页面实现文件不在本 Touches 内——它们已被本 AC 的两条 done 任务修好且实测为真。）