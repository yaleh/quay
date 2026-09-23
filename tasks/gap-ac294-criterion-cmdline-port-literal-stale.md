---
id: gap-ac294-criterion-cmdline-port-literal-stale
title: AC-294 判据从 cmdline 的 `--port` 字面量派生地址，而生产启动器默认已是 `--port 0`（内核分配临时端口）⇒
  判据结构上恒假（addr=172.28.0.1:0，curl 失败）；机制本身为真（实测 /manager 四条断言全过）—— 重锚地址派生那一步（与
  AC-179/288/289/290/291/292/293 同族任务同一行）
status: ready
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

**缺口（立案当轮直接量，2026-09-23T08:51:11.043Z，cwd = 主检出 `/data/home/yale/work/quay`）**

```
node packages/quay/bin/quay.js goal gate AC-294 --dry-run --json
⇒ {"id":"AC-294","verdict":"fail",
   "reason":"acceptance failed (exit 1) — CAUSE=en-fetch-failed -- GET http://172.28.0.1:0/manager returned nothing (addr=172.28.0.1:0)",
   "timestamp":"2026-09-23T08:51:11.043Z","dryRun":true}
```

**成因不是「机制坏了」—— 是判据派生地址的那一步解析了一个启动器已按设计置 0 的字面量。**

同一进程、同一时刻的三个读数（立案轮实测，⛔ 非转述）：

| 面 | 读数 | 取法 |
|---|---|---|
| 生产实例 | pid `3239217`，cwd = `/data/home/yale/work/quay`，cmdline `node --experimental-strip-types packages/quay/bin/quay.ts serve --host 172.28.0.1 --port 0` | `readlink /proc/3239217/cwd` ⇒ `/data/home/yale/work/quay` |
| 判据按 cmdline 派生的地址 | `172.28.0.1:0` ⇒ `curl -sf --max-time 10` 失败 ⇒ `CAUSE=en-fetch-failed` | criterion 里 `grep -oE -- '--host [^ ]+ --port [0-9]+'` 那一步 |
| 同一进程的**真实**监听地址（载体 `.quay/server.json`） | `web 172.28.0.1:4601`（另有 `control 127.0.0.1:6065`，端口不同，取错会打到控制面） | `cat .quay/server.json` / `node packages/quay/bin/quay.js server status --json` |

载体读数逐字：`{"schemaVersion":1,"pid":3239217,"startedAt":"2026-09-23T08:37:40.213Z","services":[{"name":"web","pid":3239217,"host":"172.28.0.1","port":4601,"up":true},{"name":"control","pid":3239217,"host":"127.0.0.1","port":6065,"up":true}]}`；结构化读面 `quay server status --json` 对 web 条目的活性 = `{"evaluated":true,"alive":true,"source":"http:GET /health","detail":"http://172.28.0.1:4601/health → HTTP 200 ok:true (stale:false)"}`。

**在真实监听地址上，本 AC 的保证逐条成立**（立案轮对 `http://172.28.0.1:4601/manager` curl 直读，判据的四段断言全过）：

```
① en nav 区块（grep -o '<nav.*</nav>'，2647 bytes）内字面量 "Manager" 计数 = 2   （en 基线在场）
② GET /manager (Cookie: lang=zh) → 响应含 <html lang="zh">                       （页头真的切了）
③ 同一响应的 nav 区块（2446 bytes）内 "Manager" 计数 = 0                          （英文 nav 标签消失）
④ <title> en = [quay — Manager / Outer / Inner]
     <title> zh = [quay — 管理器 / 外层 / 内层]                                   （本页自己的 title 逐字不同）
```

⇒ **判据的四段断言（en nav 基线在场 / `<html lang="zh">` / 该英文标签自 nav 消失 / 本页 `<title>` 相对 en 变化）全部为真**。台账的「此刻为假」是**判据的承载体失效**，不是被服务的代码退化。

⚠️ 判据刻意**不**对整段响应体做子串匹配（`origin` 明写）：本页整体响应里 `Manager` 字面量计数 = 5，比 nav 区块的 2 多出的 3 处是非 chrome 命中（CSS 注释 / 数据），永远不会被翻译。这正是 `origin` 2026-09-17 实测后把断言收窄到 `<nav>…</nav>` 与 `<title>` 两个作用域的原因 —— 本任务**必须保住**这一收窄，任何修法都不得放宽成整段。

### 同一判据在立案同日的两种承载体失败态（枚举，硬规则 3；⛔ 不是一个布尔）

`.quay/gate-events.jsonl` 里 `item_id=AC-294` 的当日尾段逐字：

```
08:36:03.310Z actor=goal-sweep  CAUSE=no-running-serve-instance  criterionHash=597695d4730a8e33
08:36:27.609Z actor=goal-cli    CAUSE=no-running-serve-instance
08:43:44.375Z actor=goal-cli    CAUSE=en-fetch-failed -- addr=172.28.0.1:0
```

⇒ 两个成因**可区分**、且都不是「机制为假」：前者是探不到 cwd=仓库根的活实例（该窗内实例尚未起，载体 `startedAt` = 08:37:40Z 在其之后），后者是实例起了但判据把 `--port 0` 当端口。AC-242 的 stale-pass 扫描把 AC-294 列进「frozen achieved AC(s) whose criterion is CURRENTLY false」。

### 为什么更早的那条 done 任务「没兜住」（本 AC 上已有一条 done 任务）

| 任务 | done 时刻 | 它做了什么 | 今天是否仍为真 |
|---|---|---|---|
| `gap-ac294-manager-page-zh-chrome-nav-current-and-own-title` | 2026-09-17 23:47 | 把 `/manager` 的 `<html lang>` / 本页 `<title>` / nav 当前项逐个接上 lang | **是** —— 立案轮实测四段断言全过（见上） |

⛔ **本条不是「更早的修复退化了」**：那条 done 任务是**真修复、且实测仍为真**。它当时的失败成因是 `CAUSE=html-lang-not-zh`（页面未接线），今天该成因不再出现。它**没有碰「地址派生」这一步**（其 Touches 把改判据明确排除在外）。

**而破坏这一步的提交落在该 done 之后**：`ce0f47518`（2026-09-18 10:22:19，`gap-serve-same-root-admission-lock`）把 web 端口默认改成内核分配临时端口（`plugin/scripts/start-drivers.ts:58-59` 逐字：`--port` OPTIONAL 且 defaults to 0）。**在那之前** web 由人以显式端口启动 ⇒ cmdline 里恰好有可解析的端口、判据活着。生产实例于 2026-09-23T08:37:40Z 按该默认重启（载体 `startedAt`）⇒ 判据自此**结构上恒假**。

目标文件自 2026-09-17 起未再改动：`git log -1 -- goals/AC-294-*.md` = `2cf806b3d`（2026-09-17 23:47:28，status active→achieved），当前 `md5 49913684051ff22491690d10accf5866`。

### 家族（枚举，硬规则 3；⛔ 不是一个布尔）

同一条派生逐字出现在 **17 个** goal 文件里：

```
grep -rlF "grep -oE -- '--host [^ ]+ --port [0-9]+'" goals/ | wc -l   ⇒ 17
其中含 goals/AC-294-…（本任务对象，已逐字确认在列）
```

<!-- dedup-ref -->
去重（按机制，⛔ 不按症状关键词）：顶层 `grep -rn '^goal_ac: AC-294' tasks/*.md` ⇒ **1 命中**，`gap-ac294-manager-page-zh-chrome-nav-current-and-own-title`，**status done** ⇒ 本 AC 无在飞主，本条不是重复立案，而是「承载体搬迁 ⇒ 判据 stale」这一机制在本 AC 上的实例。同谓词对 AC-293 命中 2 条，证明该谓词本身可用、不是恒零（硬规则 3 的零计数配套动作）。同机制、不同 AC 的在飞任务：`gap-ac179-criterion-cmdline-port-literal-stale`、`gap-ac288-…`、`gap-ac289-…`、`gap-ac290-…`、`gap-ac291-…`、`gap-ac292-…`、`gap-ac293-…`（各自 `ready`/`todo`）——各自重锚自己那一条，均不覆盖 AC-294，与本条互不重复。同型先例（承载体搬迁后把判据移到真正承载该角色的地方）：`gap-ac286-fanin-merge-target-criterion-carrier-stale`、`gap-ac157-catalog-carrier-moved-criterion-stale`（均 done）。引入临时端口默认的 `gap-serve-same-root-admission-lock`（done）改的是**启动器**，从未重锚过任何判据——相关但不同机制。本任务与上列任何任务**没有依赖边**：顶层 `depends_on` 为空，各自独立立在自己的 AC 上。

### 本任务只重锚 AC-294 一条

其余 AC（AC-295…AC-303）的页面断言与各自 `<title>` 基线本任务**未逐一实测**；把未测量的判据写进 Touches 正是本仓库禁止的形态。它们的修法与本条**同一行、同一步骤**，可由后续各轮各自的立案复用本条给出的形态。

### 四个修法的取舍

- ✗ **把 web 钉回固定端口**（让部署迁就判据）：拒绝。临时端口默认**有理由**（`plugin/scripts/start-drivers.ts:20-23` 逐字：一个占住硬编码端口的无关进程曾回答 200，于是脚本报出了假绿）；钉回去等于把那条假绿重新引入，且在判据里写死端口正是硬规则 4 推论二点名的形态。
- ✗ **`superseded` 本 AC**：拒绝。GOAL-024 的退出条件要求切换机制在真实 Web 上可用（本 AC 的 `origin` 即该契约的可执行规格），这条保证**今天仍是本仓库的意图**，且**实测为真**；退役它等于删掉守卫。
- ✗ **`long-term: true`**：不解决。它只把本 AC 搬进 AC-216 复验域（每轮重跑），判据本身仍为假。
- ✓ **重锚判据的派生那一步**：改从**活宿主的载体**取真实监听地址，而不是解析一个已按设计置 0 的字面量。作用对象（`/manager`）、判定方式（对运行中实例的外部 HTTP GET + chrome 作用域匹配）、`expect` 全部逐字不变 ⇒ **不减强度**。

### 修法必须满足的性质（⛔ 缺一不可）

1. **地址从活宿主派生，覆盖两种部署形态**：cmdline 显式端口（`--port N`，N ≥ 1）**与**内核分配端口（`--port 0`／无 `--port`，启动器默认）都要能解析。后者真实端口只在**载体**里可知：`.quay/server.json`（`schemaVersion:1`，`pid` + `services[{name,pid,host,port,up}]`）或其结构化读面 `quay server status --json`。正本 reader = `packages/quay/src/server-state.ts`（实测导出 `readServerState` / `ServerServiceEntry` / `pidAlive` / `probeAddress`；**以实际导出为准，⛔ 不按本任务预写的行号假设**）。⛔ 不得把本机当前的端口/主机写成字面量（换台机器或重启即失效）。
2. **载体只用来派生地址，不作判定真值**：判定仍由对 `/manager` 的外部 HTTP GET 作出（硬规则 4b：不用被测对象自报的量判它活着）。必须校验 `pid` 是活进程 ∧ `/proc/<pid>/cwd` == `$root`，并**只取 `name == "web"` 那条服务**（同文件里 `control` 端口不同，取错即打到控制面）。
3. **不丢强度**：`expect` 与作用域逐字不变——导航标签只对 `<nav>…</nav>` 区块匹配、`<title>` 只对 `<title>` 匹配（`origin` 明写：⛔ 不对整段响应体做子串匹配；本页整段有 5 处 `Manager`、nav 内仅 2 处）；判据仍能取假。
4. **候选逐个累积，不被自身进程抹掉**：判据文本本身含 `quay.ts serve` 一词，而 gate 以 `sh -c ". <env> && <criterion>"` 运行（`packages/quay/src/gate/acceptance-runner.ts`）⇒ runner 自己的 `sh` 进程也命中 `pgrep`、其 cwd 恰等于 `$root`。任何候选都不得把已派生的地址清空；失败时逐个候选写出 `pid` + 派生地址 + 该候选的成因（地址不可派生 / 连接被拒 / 超时 / 断言不过），⛔ 不得退化成无成因或 `addr=` 空。
5. **fail-closed 保持**：没有活候选 ⇒ 仍非 0（⛔ 不得为了让台账变绿改成 0）；「查不成」与「合格」必须可区分（硬规则 3/3b）—— 本案已有的 `CAUSE=no-running-serve-instance` 与 `CAUSE=en-fetch-failed` 两个可区分成因必须原样保住。
6. **修订经 goal 写面**（`quay goal write AC-294 --criterion …`，`packages/quay/src/cli/goal.ts`）落库，并在记录里写明**为什么改**（承载体搬迁 + 上述读数）。
7. **修订后新 criterionHash 至少有一条独立 `quay goal gate AC-294` 落账**（AC-242 的修订入闸要求：`payload.criterionHash` ≠ 当前指纹的旧轮转 verdict 不得再计 fresh，`packages/quay/src/goal-store.ts`）。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-294 --dry-run --json` ⇒ `verdict: fail` 且 `addr=172.28.0.1:0`；同一时刻 `cat .quay/server.json` 取 `name=="web"` 的端口读数，**两者必须指向同一 pid**。
2. **确认依赖可读 + 读【实际】签名**：`grep -n 'export function readServerState\|export interface ServerServiceEntry\|export function pidAlive\|export function probeAddress' packages/quay/src/server-state.ts`、`node packages/quay/bin/quay.js server status --json`。**⛔ 不按本任务 Plan 预写的签名假设**：以实际导出为准；任一无命中 ⇒ **停下报缺**。
3. **重锚 AC-294 的判据**：把 `goals/AC-294-*.md` 的 criterion 里「从 cmdline `--host … --port …` 派生 addr」那一步替换为「活宿主载体派生」（两种形态都覆盖），其余逐字不动；经 `quay goal write AC-294 --criterion "$(cat <新判据文件>)"` 落库。
4. **两个负控制**（硬规则 4 推论三：判据必须能取假）：① 无实例时仍非 0（`CAUSE=no-running-serve-instance`）；② 把候选地址指向一个必然连不上的端口 ⇒ 非 0 且成因可区分。**⛔ 不得直接在 `goals/AC-294-*.md` 上手改**。
5. **落账**：`node packages/quay/bin/quay.js goal gate AC-294` ⇒ exit 0，且台账新增一条 `verdict:"pass"` 的事件，其 `payload.criterionHash` **≠ 修订前的指纹**。

## AC

- [x] **AC1（承载体已重锚且不减强度）**：`goals/AC-294-*.md` 的 criterion 不再解析 `--port [0-9]+` 字面量派生地址，改从活宿主载体取；`expect` 与正文语义逐字不变（贴 `git diff`，只有派生那一步与「为什么改」的说明变化）。⛔ 除非经 `quay goal write` 落库否则不算。
- [x] **AC2（判据能取假 —— 两个负控制）**：① 无运行实例时 `quay goal gate AC-294` 非 0 且以 `CAUSE=no-running-serve-instance` 可区分；② 候选地址指向必然连不上的端口时非 0 且成因可区分。两条均贴退出码与逐字 stderr。
- [x] **AC3（正控制：修订后在活实例上为真）**：`node packages/quay/bin/quay.js goal gate AC-294` ⇒ **exit 0**，逐字贴出；且同一时刻四条断言各自独立可核（en nav `Manager` 计数 = 2 / zh 响应含 `<html lang="zh">` / zh nav `Manager` 计数 = 0 / zh `<title>` ≠ en `<title>`）。
- [x] **AC4（地址覆盖两种部署形态）**：对显式端口实例与 `--port 0` 实例（或用两种 cmdline 的夹具）各断言派生地址正确；贴出两种形态下的派生结果。⛔ 不把本机当前端口写进任何文件。
- [x] **AC5（不回归 + 作用域枚举）**：① `bash scripts/test.sh --for-task gap-ac294-criterion-cmdline-port-literal-stale` 绿；② 作用域举证：`grep -rlF "grep -oE -- '--host [^ ]+ --port [0-9]+'" goals/` **逐文件**贴出并与立案基线对照（总数 **17**）：本任务后 **AC-294 那一条 1→0**，其余 **16 个文件不受本条影响**（它们各自归自己的立案轮）。⛔ 若同族在飞任务已落地，本条判据是**逐文件差量**，不是绝对值。
- [x] **AC6（新指纹落账）**：台账 `.quay/gate-events.jsonl` 中 `item_id=AC-294` 的最后一条为 `verdict:"pass"`，且其 `payload.criterionHash` ≠ 修订前指纹（贴两行）。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本改了、dry-run 绿了」，而是 **一条真实的、在活服务上为真的判据落了账**：

1. **落地对象**：`goals/AC-294-*.md` 的 criterion 经 `quay goal write` 落库（⛔ 非手工 Edit），且 `quay goal gate AC-294` 在**运行中的** `quay.ts serve`（cwd = 仓库根）上返回 exit 0。
2. **台账**：`.quay/gate-events.jsonl` 出现 `item_id=AC-294` / `gate=goal` / `verdict=pass` / `actor=goal-cli` 的新事件，`criterionHash` 与修订前不同 —— 一条 dry-run 输出**不算**。
3. **负控制留痕**：两个负控制（无实例 / 连不上的端口）的退出码与 `CAUSE=` 逐字留存，证明判据不是恒真。
4. **家族差量**：AC5 的逐文件计数表贴出，证明本次作用域**只有 AC-294 那一格**发生变化。
5. **⛔ 三种「凑绿」明令禁止**：改 `expect` 语义、把端口写死回固定值、把 `/manager` 的判据放宽成整段响应体子串匹配（`origin` 明写这是 chrome 作用域断言）。

## Touches

- `goals/AC-294-manager-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md`
- `packages/quay/test/ac294-criterion-address-derivation.test.mjs` (new)
- `tasks/gap-ac294-criterion-cmdline-port-literal-stale.md`

（说明：第一条是本任务的落地面——criterion 的地址派生那一步，经 `quay goal write AC-294 --criterion …` 落库，`expect` 与正文语义逐字不变、只补「为什么改」；第二条是配套夹具（两种部署形态的派生正/负控制）；第三条是 self-touch。⛔ 不新增 `plugin/scripts/*.ts`——派生助手若要抽出，默认放 `packages/quay/src/`；若最终落在 `plugin/scripts/`，必须同时把 outline、`plugin/scripts/capability-catalog-declarations.json` 与本任务 Touches 一并更新。⛔ `packages/quay/src/serve-manager.ts` 等页面实现文件不在本 Touches 内——它们已被本 AC 的 done 任务修好且实测为真。）

## 执行记录（落地读数 / 修法 / 为什么改）

**为什么改**：`ce0f47518`（`gap-serve-same-root-admission-lock`，done）把 web 端口默认改成内核分配（`--port 0`）⇒ 旧派生那一步解析出的字面量恒为 `0`，`<host>:0` 是**结构性**不可 fetch 的地址，本 AC 在任何使用该默认的部署上恒假。台账逐字证明**承载体搬迁、被服务的代码没有退化**：`item_id=AC-294` 的**同一个** `criterionHash 597695d4730a8e33` 在 `2026-09-23T05:08:45.174Z`（goal-sweep）为 pass、在 `2026-09-23T08:36:03.310Z` 为 fail（生产实例按新默认重启、绑定新端口）。

**修法（只此一步）**：把 criterion 里「从 cmdline `grep -oE -- '--host [^ ]+ --port [0-9]+'` 派生 addr」那一段替换为自包含的 `# >>> addr-derivation` … `# <<< addr-derivation` 块——候选仍由 `pgrep -f 'quay.ts serve'` × `/proc/<pid>/cwd == $root` 产生；每个候选：① 先读**它自己的 argv**（NUL 分隔、**按位置**判 `serve … --host H --port N`，N ≥ 1）⇒ `H:N`；② 否则读 `$root/.quay/server.json`（`schemaVersion:1` ∧ 顶层 `pid` == 该候选 ∧ `kill -0` 活 ∧ `services[]` 中 `name == "web"` ∧ `up` 为真）⇒ `host:port`；③ 两者取不到 ⇒ 记该候选成因并**继续下一个候选**，⛔ 不清空已派生地址、⛔ 不放弃后续候选。派生出的地址先被**同一条 `GET $ROUTE` 探一次**才被接受（「派生到地址」与「派生到**可达**地址」不塌缩成一个读数）。载体只用于**派生地址**，判定仍是外部 HTTP GET（硬规则 4b）；只取 `name == "web"`（⛔ 不取 control——两者同 pid，取错即打到 JSON-RPC 口）。失败路径分两个**新的、可区分**的 `FAIL=`（`no-derivable-serve-address` / `no-reachable-serve-address`），逐候选写 `pid` + `addr=<host:port>`（或 `addr=-`）+ `cause`；旧有的 11 条 `CAUSE=` 分支（含 `CAUSE=no-running-serve-instance` 与 `CAUSE=en-fetch-failed`）逐字保住。`0.0.0.0` / `::` → `127.0.0.1` 的既有归一化保留。修法**没有**放宽作用域：`/manager` 的断言仍只对 `<nav>…</nav>` 与 `<title>` 匹配（⛔ 不对整段响应体），`expect` / `origin` / `title` 逐字 SAME。

**落地对象**：`goals/AC-294-…md` 经 `quay goal write AC-294 --criterion …` 落库（task branch commits `021a5e97b` / `6ec1261b1`；同一文本已在 develop：`git diff develop -- goals/AC-294-…md` 为空），criterion md5 `878fd3a7676f53d51e5c85634e843716`（10099 B）。frontmatter 仅 `criterion` 变；`expect`/`origin`/`title`/`status`/`kind`/`goal` 逐字 SAME（程序化比对）。

**AC1** 派生块逐字 diff（对 fork point `fbe7d2fd5`）：`1 file changed, 175 insertions(+), 6 deletions(-)`，删掉的 6 行**恰好**是旧派生的 6 行（`addr=""` / 那条 `grep -oE -- '--host … --port …'` / `[ -n "$a" ] || continue` / `0.0.0.0` 归一化 / `addr="$a"` / `break`）；`if [ -z "$addr" ] … CAUSE=no-running-serve-instance …; exit 1; fi` 与候选筛选循环在两侧**逐字相同**（diff 里是 context 行而非改动）。块之后的 §-尾（`en=$(curl …` 起）与修订前**逐字相同**（2442 chars，程序化断言）。criterion 内**无端口字面量**（正则 `:[0-9]{4,5}` 零命中；仅有的 IP 字面量 `0.0.0.0`/`127.0.0.1` 是归一化常量，修订前同样存在）。证据：`.quay/ac294-evidence/ac1-ac6-final.txt`。

**AC2（两个负控制，两侧都贴）**：
- ① `ac2a-stdout.txt` / `ac2a-stderr.txt` —— 在**无活实例**的 root（本任务 worktree）上跑存储的判据：`CRITERION_EXIT=1`，stderr 逐字 `AC-294 candidate readings (cwd=…/gap-ac294-…, nserve=0, ncand=1, nderived=0):; pid=1423973 addr=- cause=argv-no-serve-subcommand,carrier-absent` + `CAUSE=no-running-serve-instance -- no quay.ts serve process with cwd=…`。
- ② `ac2b-deadport.txt` —— 真进程（argv 含 `quay.ts serve --host 127.0.0.1 --port 0`）+ 真载体（`web` 指到一个**刚被释放**的端口）：`CRITERION_EXIT=1`，`FAIL=no-reachable-serve-address …`，逐候选 `pid=1501213 addr=127.0.0.1:6683 cause=derived-from-carrier-fetch-failed(connection-refused) -- curl: (7) Failed to connect …`。两个成因**不同形**（一个是「没有 serve」，一个是「有 serve、派生了地址、连不上」）。

**AC3（正控制）**：`node packages/quay/bin/quay.js goal gate AC-294`（主检出，`ac3-live-gate.txt`）⇒ `{"verdict":"pass","reason":"acceptance passed (exit 0)"}`，`GATE_EXIT=0`，事件 `2026-09-23T14:45:33.613Z actor=goal-cli verdict=pass`。同一时刻判据自身在活实例上的逐字输出（`ac3-live-criterion-run.txt`）＝ `AC-294 serve address derived from carrier as 127.0.0.1:16377 (… cause=derived-from-carrier-fetch-answered …)` + OK 行，`CRITERION_EXIT=0`。四条断言各自独立直读（`ac3-four-assertions.txt`，地址由上一步派生）：① en nav 区块 2647 B 内 `Manager` 计数 = **2**；② zh 响应含 `<html lang="zh"` = **1**；③ zh nav 区块 2446 B 内 `Manager` 计数 = **0**；④ `en <title>` = `quay — Manager / Outer / Inner` ≠ `zh <title>` = `quay — 管理器 / 外层 / 内层`。

**AC4（两种部署形态，对本 worktree 的真 `quay serve`，⛔ 非夹具；`ac4-shapes.txt`）**：形态 2 启动器默认 `--port 0`（cmdline 逐字 `… serve --host 127.0.0.1 --port 0`，载体 `web = 127.0.0.1:18517`）⇒ `CRITERION_EXIT=0`，派生逐字 `derived from carrier as 127.0.0.1:18517`；形态 1a 显式 `--port 8391` ⇒ `derived from argv as 127.0.0.1:8391`，`CRITERION_EXIT=0`；形态 1b 同一实例**删掉载体**（地址只可能来自 argv）⇒ 仍 `derived from argv as 127.0.0.1:8391`，`CRITERION_EXIT=0`。⛔ 没有任何文件写死本机端口（三处的 18517/8391 只出现在 `.quay/ac294-evidence/` 的读数 scratch 里，判据与夹具本身零端口字面量）。

**AC5**：① scoped 门 `bash scripts/test.sh --for-task gap-ac294-criterion-cmdline-port-literal-stale --allow-thin` ⇒ `SCOPED_GATE_EXIT=0`，13/13 例全绿（`ac5-scoped-gate.txt`，含新夹具）；同形的**裸** `--for-task`（无 `--allow-thin`）⇒ `exit 1`，成因**不是**用例失败（`fail 0`）而是选择面宽度 `test-selection-thin: resolved tests for 1/3 Touches entries (0.33) < 0.5`（`ac5-scoped-gate-bare.txt`，两个读数都留）。② 作用域逐文件（`ac5-scope.txt`，主检出与 worktree 各跑一次、读数相同）：旧派生谓词 `grep -rlF "grep -oE -- '--host [^ ]+ --port [0-9]+'" goals/` 命中 **10** 个文件 —— `AC-179, AC-289, AC-295, AC-296, AC-298, AC-299, AC-300, AC-301, AC-302, AC-303`，**AC-294 那一条 1→0**（`grep … | grep -c AC-294` = 0）；新块谓词 `grep -rlF ">>> addr-derivation" goals/` = **6**（`AC-288, AC-290, AC-292, AC-293, AC-294, AC-297`）。立案基线 17 已因同族各自落地降到 10（逐文件差量：本条只动 AC-294 一格；其余 9 个旧文件与另外 5 个新文件均非本任务所改）。

**AC6**：台账 `.quay/gate-events.jsonl` 的 `item_id=AC-294` 尾四行（`ac1-ac6-final.txt`）：`14:45:04.340Z goal-cli fail (no hash)` → `14:45:33.613Z goal-cli pass (no hash)` → `14:45:33.726Z goal-cli pass (no hash)` → **`14:45:49.089Z goal-amend pass criterionHash=58dbbb5d78a5d5fa`**。新指纹 `58dbbb5d78a5d5fa` ≠ 修订前 `597695d4730a8e33`（后者即立案记录里「同一个哈希两侧翻转」的那个指纹）。该 hash 行由机制自身的 bounded 轮转真跑产出：`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE … goal check --stale-pass --sweep --budget 1`（`ac6-sweep.txt`）⇒ `sweep.ran[0] = {id: AC-294, verdict: pass, ms: 594}`、`stoppedBy: "budget"`，且 AC-294 **不在** `failing`、在 `verifiedFresh` 内。

**夹具** `packages/quay/test/ac294-criterion-address-derivation.test.mjs`（`// @test-group product`，13 例全绿）：它**不是**派生逻辑的副本 —— 它从 goal 文件里按 marker **逐字抽取** criterion 的 `addr-derivation` 块（与 `goals/AC-294-*.md` 保持单一正本关系），在 `git init` 过的临时 root 里对**真实进程**（argv 按位置含 `quay.ts serve --host H --port N`）与真实载体跑正/负两向：显式端口 / `--port 0` + 载体（含只取 `web` 不取 `control`）/ 通配 host 归一化 / 无载体 / 载体 pid 不符 / 无 `web` 条目 / `web.up:false` / 非 v1 载体 / 派生到死端口 / 无 serve 实例 / runner 自身 `sh` 候选的归因 / 11 条 `CAUSE=` 分支未丢。该夹具是 AC-288 同族夹具的姊妹件（同一行的派生，`ROUTE`/`LABEL_EN` 各自指向本页），⛔ 未改动任何别的 AC 的 criterion。

**跨根写入声明**：本 AC 的判据探的是**主检出**的活实例，而 worktree root 没有活实例 ⇒ 判据只能在那里落账。按同族既定的两处写面形状，**同一文本**在 task worktree 与主检出各写一次（`goals/AC-294-…md` 两侧 md5 相同 `878fd3a7676f53d51e5c85634e843716`），主检出那次是 `goal gate` / `sweep` 能在真实实例上产出 pass 与 criterionHash 的必要条件。这是对共享检出分支的一次写入，此处如实声明。