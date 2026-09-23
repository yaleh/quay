---
id: gap-ac289-criterion-cmdline-port-literal-stale
title: AC-289 判据从 cmdline 的 `--port` 字面量派生地址，而生产启动器默认已是 `--port 0`（内核分配临时端口）⇒
  判据结构上恒假（addr=172.28.0.1:0，curl 失败）；页面侧保证本身实测为真 —— 重锚地址派生那一步（与 AC-179 / AC-288
  在飞任务同一行、不同承载体）
status: ready
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-289
---
**type:** execution

## Proposal

**缺口（立案当轮直接量，2026-09-23T08:26:39.953Z，cwd = 主检出 `/data/home/yale/work/quay`；`--dry-run` ⛔ 不写台账）**

```
node packages/quay/bin/quay.js goal gate AC-289 --dry-run --json
⇒ {"id":"AC-289","verdict":"fail",
   "reason":"acceptance failed (exit 1) — CAUSE=en-fetch-failed -- GET http://172.28.0.1:0/dashboard returned nothing (addr=172.28.0.1:0)"}
```

**成因不是页面没翻译，也不是没有服务在跑 —— 是判据派生地址的那一步解析了一个启动器已按设计置 0 的字面量。**

### 三个读数（同一时刻、同一宿主）

| 面 | 读数 | 取法 |
|---|---|---|
| 生产实例 | pid `1805344`，cwd = `/data/home/yale/work/quay`，cmdline `… quay.ts serve --host 172.28.0.1 --port 0`，`startedAt 2026-09-23T07:29:22.852Z` | `pgrep -f 'quay.ts serve'` + `readlink /proc/<pid>/cwd` + `/proc/<pid>/cmdline` |
| 判据按 cmdline 派生的地址 | `172.28.0.1:0` ⇒ `curl -sf --max-time 10` 失败 ⇒ `CAUSE=en-fetch-failed` | criterion 的地址派生段 |
| 同一进程的**真实**监听地址 | `web 172.28.0.1:6333`（另有 `control 127.0.0.1:14045`，端口不同，取错会打到控制面） | `.quay/server.json` `services[name=="web"]`；`quay server status --json` 同值，且 liveness `http:GET /health → HTTP 200 ok:true` |

### 本 AC 的保证在真实监听地址上**成立**（立案当轮逐条实测）

把 criterion 原文**逐字**复制，只把 `addr` 一处换成真实值 `172.28.0.1:6333`，其余（含 nav 区块抽取、`<title>` 抽取、三段断言、OK 文本）一字不改：

```
nav_en_len=2643 nav_zh_len=2442
OK -- /dashboard: default nav region carries "Dashboard" and <title>="quay — Dashboard";
under Cookie: lang=zh the response is <html lang=zh>, that English nav label is gone from
the nav region, and this page's own <title> became "quay — 仪表盘"
EXIT=0
```

⇒ **判据的每一条断言都过**。台账的「此刻为假」是**判据的承载体失效**，不是被服务的代码退化。

### 台账：判据文本没变，是环境移动了（同一 criterionHash 跨越红绿分界）

```
2026-09-23T04:51:13.555Z goal pass   criterionHash d5569285de4b0f26   ← gen-1 实例（显式端口）
2026-09-23T08:21:12.959Z goal fail   criterionHash d5569285de4b0f26   ← gen-2 实例（--port 0）
2026-09-23T08:22:07.005Z goal fail   （同上）
```

红绿两侧的 `criterionHash` **相同** ⇒ 判据文本没有改过，改的是它读取的宿主。同族的 AC-288 在**同一对时间戳**上同向翻转（`04:51:13.319Z pass → 08:21:12.861Z fail`）⇒ 一次承载体搬迁同时打中整族。

### 承载体是什么时候搬的

`.quay/serve.log` 两代实例：

```
gen-1  pid 3357036  listening on http://0.0.0.0:4173      ← cmdline 有可解析的 --port ⇒ 判据当时活着
gen-2  pid 1805344  listening on http://172.28.0.1:6333    ← cmdline 是 --port 0     ⇒ 判据结构性恒假
```

`ce0f47518`（2026-09-18，`gap-serve-same-root-admission-lock`，done）把 web 端口的默认改成**内核分配临时端口**。本任务立案轮逐字核对源码（⛔ 不是转述）：

- `plugin/scripts/start-drivers.ts` 头注释逐字：`⛔ --port is OPTIONAL and defaults to 0 =「让内核分配临时端口」`，及 `the default port is now kernel-assigned, so the carrier is the only place the port is knowable`。

**为什么它 09-18 落码、09-23 才红**：gen-1 实例在码变**之前**就以显式端口 4173 起好并一直活着，判据照旧可派生；07:29:22Z 重启出 gen-2（走新默认 `--port 0`）后，下一次判据轮（08:21Z）才第一次拿到 `addr=…:0`。

### 为什么更早的修复没兜住这一条（本 AC 上已有一条 done 任务）

`gap-ac289-dashboard-zh-nav-label-and-own-title`（done）**做出了页面侧的真实接线**（`serve-i18n.ts` 字典 + nav/title 接线），**且它今天仍然成立**（上面 `EXIT=0` 的读数就是它成立的直接量）。它**从未碰过判据** —— 该任务正文逐字写着「判据本身的修法不在本任务 Touches 内（`goals/AC-289-*.md` 属人/驱动维护面）」。⇒ 该任务从来不是「页面缺失」，本次红也**不是它回退**；**没有任何任务碰过地址派生这一步**，而这次坏掉的恰是它。

### 家族（枚举，硬规则 3；⛔ 不是一个布尔）

同一条派生逐字出现在 **17 个** goal 文件里：

```
grep -rlF "grep -oE -- '--host [^ ]+ --port [0-9]+'" goals/ | wc -l   ⇒ 17
= AC-179（另一 GOAL） + AC-288 + AC-289 … AC-303（GOAL-024 其余 16 条）
```

**本任务只重锚 AC-289 一条**：其余 15 条 AC（AC-290…303）各自的页面断言本任务未逐一实测，把未测量的判据写进 Touches 正是本仓库禁止的形态；它们的修法与本条**同一行、同一步骤**，可由后续各轮各自的立案复用本任务给出的形态。

### 四个修法的取舍（与 AC-179 / AC-288 同族的同一张表）

- ✗ **把 web 钉回固定端口**（让部署迁就判据）：拒绝。临时端口默认**有理由**（`start-drivers.ts` 头注释逐字：一个占住硬编码端口的无关进程曾回答 200，于是脚本报出了假绿）；钉回去等于把那条假绿重新引入，且在判据里写死端口正是硬规则 4 推论二点名的形态。
- ✗ **`superseded` 本 AC**：拒绝。GOAL-024 的退出条件要求切换机制在真实 Web 上可用（本 AC 的 `origin` 即该契约的可执行规格），这条保证**今天仍是本仓库的意图**，且它此刻**实测为真**；退役它等于删掉一个正在生效的守卫。
- ✗ **`long-term: true`**：不解决。它只把本 AC 搬进 AC-216 复验域（每轮重跑），判据本身仍为假。
- ✓ **重锚判据的派生那一步**：从**活宿主的载体**取真实监听地址，而不是解析一个已按设计置 0 的字面量。作用对象、判定方式、`expect` 全部逐字不变 ⇒ **不减强度**。

### 修法必须满足的性质（⛔ 缺一不可）

1. **地址从活宿主派生，覆盖两种部署形态**：cmdline 显式端口（`--port N`，N ≥ 1）**与**内核分配端口（`--port 0`／无 `--port`，启动器默认）都要能解析。后者真实端口只在**载体**里可知：`.quay/server.json`（`schemaVersion:1`，`pid` + `services[{name,pid,host,port,up}]`）或其结构化读面 `quay server status --json`。正本 reader = `packages/quay/src/server-state.ts`。⛔ 不得把本机当前的端口/主机写成字面量（换台机器或重启即失效）。
2. **载体只用来派生地址，不作判定真值**：判定仍由对 `/dashboard` 的外部 HTTP GET 作出（硬规则 4b：不用被测对象自报的量判它活着）。必须校验 `pid` 是活进程 ∧ `/proc/<pid>/cwd` == `$root`，并**只取 `name == "web"` 那条服务**。
3. **不丢强度**：`expect` 与作用域逐字不变（仍只遍历 cwd = 仓库根的生产 serve 实例；对 `<html lang="…">`、`<nav>` 区块、本页自身 `<title>` 的断言逐字保留）；判据仍能取假。
4. **候选逐个累积，不被自身进程抹掉**：判据文本本身含 `quay.ts serve` 一词，而 gate 以 `sh -c ". <env> && <criterion>"` 运行（`packages/quay/src/gate/acceptance-runner.ts:151`）⇒ runner 自己的 `sh` 进程也命中 `pgrep`、其 cwd 恰等于 `$root`。任何候选都不得把已派生的地址清空；失败时逐个候选写出 `pid` + 派生地址 + 该候选的成因（地址不可派生 / 连接被拒 / 超时 / 断言不过），⛔ 不得退化成无成因或 `addr=` 空。
5. **fail-closed 保持**：没有活候选 ⇒ 仍非 0（⛔ 不得为了让台账变绿改成 0）；「查不成」与「合格」必须可区分（硬规则 3/3b）。
6. **修订经 goal 写面**（`quay goal write AC-289 --criterion …`）落库，并在记录里写明**为什么改**（承载体搬迁 + 上述读数）。
7. **修订后新 criterionHash 至少有一条独立 `quay goal gate AC-289` 落账**（AC-242 的修订入闸要求：旧 criterionHash 的轮转 verdict 不得再计 fresh）。

<!-- dedup-ref -->
去重（按机制，⛔ 不按症状关键词）与可追溯性：顶层 `goal_ac: AC-289` 的 `grep -rn` ⇒ **1 命中**，`gap-ac289-dashboard-zh-nav-label-and-own-title`，status **done** ⇒ 本 AC 无在飞主，本条不是重复立案，而是「承载体搬迁 ⇒ 判据 stale」这一机制在本 AC 上的实例。同机制、**不同 AC / 不同承载体文件**的在飞任务：`gap-ac179-criterion-cmdline-port-literal-stale`（ready）、`gap-ac288-criterion-cmdline-port-literal-stale`（todo）—— 它们各自重锚自己的 `goals/AC-*.md`，均不覆盖 `goals/AC-289-*.md`；AC-288 任务自己的 DoD 逐字写明「AC-289…AC-303 那 15 条 criterion 与它们的页面任务不在本任务 Touches 内 … 可由后续各轮各自的立案复用本任务给出的形态」。同型先例（承载体搬迁后把判据移到真正承载该角色的地方）：`gap-ac286-fanin-merge-target-criterion-carrier-stale`（done）、`gap-ac157-catalog-carrier-moved-criterion-stale`（done）。引入临时端口默认的 `gap-serve-same-root-admission-lock`（done）改的是**启动器**，从未重锚过任何判据 —— 相关但不同机制。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-289` ⇒ `verdict: fail` 且 `addr=…:0`，贴完整输出与当时 `quay server status --json` 的 `web` 端口读数（两者必须指向**同一**进程）。
2. **改判据的地址派生那一步**（只此一步；其余逐字不动）：
   - 候选仍由 `pgrep -f 'quay.ts serve'` × cwd == `$root` 产生；
   - 每个候选：先看 cmdline，`--port N` 且 N ≥ 1 ⇒ `host:N`（`0.0.0.0` → `127.0.0.1` 的既有归一化保留）；否则读 `$root/.quay/server.json`，要求顶层 `pid` == 该候选 pid ∧ 活进程 ∧ `services[]` 中 `name == "web"` ∧ `up` 为真 ⇒ `host:port`；
   - 载体读取失败/形状不符/无 `web` 条目 ⇒ 该候选的成因为「地址不可派生」，**继续看下一个候选**，⛔ 不把 `addr` 清空、⛔ 不放弃后续候选；
   - JSON 解析可用 `node -e` 或 `python3`（本仓已有数十条 goal criterion 调 node/python3，同一环境可达）。
3. **`quay goal write AC-289 --criterion "$(cat <新 criterion 文件>)"`** 落库（贴逐字 diff：只有派生块变化）。
4. **配套夹具** `packages/quay/test/ac289-criterion-address-derivation.test.mjs`（`// @test-group product`，`node:test`）：对两种部署形态的 cmdline/载体组合给出期望地址，**正负两向**都要有（显式端口 / `--port 0` + 载体 / 无载体 / 载体无 `web` 条目 / 载体 pid 不是活进程）。
5. **复验**：`goal gate AC-289` 在新 criterionHash 上 `exit 0`，且台账尾事件是 pass；`goal check --stale-pass` 的 failing 集合中不再含 AC-289。
6. **收口**：`bash scripts/test.sh --for-task gap-ac289-criterion-cmdline-port-literal-stale --allow-thin` 绿；`node --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts` `exit 0`。

## AC

- [x] AC1 修订后的 criterion 在**活生产实例**上逐字重跑 `exit 0`，且它实际派生/使用的地址 = **当次**载体里 `web` 服务的真实端口（⛔ 不是 0）。贴：criterion md5、派生地址、exit code、en/zh 两条响应里 nav 区块与 `<title>` 的原始片段。
- [x] AC2 能取假（三向，同一宿主，两侧读数都贴）：(a) 机制被临时关掉（把 `/dashboard` 的 zh 词条钳回 en）⇒ 非 0，且 stderr 指明是哪一段断言不过；(b) 无活候选（停掉 serve host）⇒ 非 0，成因与 (a) **不同形**；(c) 地址指到死端口 ⇒ 非 0，成因含「连接被拒」。⛔ 只有 (a)(b)(c) 都贴才算，只贴绿的一侧不算。
- [x] AC3 非字面量（真负控制）：**重启**生产 serve（内核会分配**另一个**端口），同一 root 上重跑 ⇒ 仍 `exit 0`，且两次派生端口不同、各自等于当次载体的值。贴两个端口值 + 两次 exit。
- [x] AC4 归因：制造一次真实 fail（用 AC2 任一方向），stderr 必须对**每个**候选给出 `pid` + 派生地址 + 成因；⛔ 候选存在时不得出现 `addr=` 空或无成因的裸失败。
- [x] AC5 作用域与 `expect` 逐字不变；修订只经 `quay goal write AC-289 --criterion …` 落库且含「为什么改」；修订后**新** criterionHash 至少有一条独立的 `quay goal gate AC-289` 落账。
- [x] AC6 本仓库自身行为不回退：`node --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts` `exit 0`；`node packages/quay/bin/quay.js goal check --stale-pass` 的 failing 集合不再含 AC-289。
- [x] AC7 scoped 门 `bash scripts/test.sh --for-task gap-ac289-criterion-cmdline-port-literal-stale --allow-thin` `exit 0`。

## DoD

- **真落地**：`goals/AC-289-*.md` 的重锚版落在 **develop**（`git show develop:goals/AC-289-*.md` 可见新派生），且台账尾事件是**新 criterionHash 的 pass**，由**一次对活生产实例的真跑**产出（⛔ 不是夹具、不是 dry-run、不是引用旧 verdict 的轮转）。
- **保证本体重测**：在判据实际使用的那个地址上，`<html lang="en">` / `Cookie: lang=zh ⇒ <html lang="zh">` / zh 下 nav 区块内该英文标签消失 / 本页自身 `<title>` 相对 en 基线变化 —— 四条都由**响应体**直读（⛔ 不读 render 函数返回值当「响应」，那测的是函数不是线上行为）。
- `node --experimental-strip-types packages/quay/bin/quay.ts goal check --stale-pass` ⇒ `exit 0`，`AC-289` 不在 `failing` 内。
- AC1–AC4 的**正负两向**读数都在任务体或 `.quay/ac289-*` 未跟踪 scratch 里（⛔ 只贴绿侧不算），可被下一轮独立复算。
- **不越界**：AC-290…AC-303 那 15 条 criterion 与它们的页面任务不在本任务 Touches 内；若执行者选择一并重锚，必须**先**把对应 `goals/AC-*.md` 加进 Touches 并对每条逐条实测前后读数（⛔ 不得批量改未测量的判据）。
- **title 保持不含大写 `Dashboard`**：本任务进入 ready 池后 title 会被渲染到 `/dashboard` 的 ready 卡上（前一条任务记录过这一形态）；那条约束当时是为旧的全响应体匹配而设，现行判据已收窄到 `<nav>` 区块与 `<title>`，保持该约束零代价 —— 本条不为判据服务，只是消除残余疑问的保险。
- 本任务自身 `done` 并随 fan-in 落地。

## Touches

- `goals/AC-289-dashboard-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md`
- `packages/quay/test/ac289-criterion-address-derivation.test.mjs` (new)
- `tasks/gap-ac289-criterion-cmdline-port-literal-stale.md`

（说明：第一条是本任务的落地面 —— criterion 的地址派生那一步，经 `quay goal write AC-289 --criterion …` 落库，`expect` 与正文语义逐字不变、只补「为什么改」；第二条是配套夹具（两种部署形态的派生正/负控制）；第三条是 self-touch。⛔ 不新增 `plugin/scripts/*.ts` —— 派生助手若要抽出，默认放 `packages/quay/src/`；若最终落在 `plugin/scripts/`，必须同时把 outline、`plugin/scripts/capability-catalog-declarations.json` 与本任务 Touches 一并更新。）

## Evidence（执行轮，2026-09-23T09:00–09:20Z，worker worktree `…/quay-worktrees/gap-ac289-criterion-cmdline-port-literal-stale`）

### 落库了什么（两个 commit）

```
87be05a8f goals: AC-289 field:criterion by cli:3527019          ← criterion 终版
f614550af goals: AC-289 field:criterion,origin by cli:2745808   ← criterion 首版 + origin「为什么改」
a7c2623be test(ac289): end-to-end fixture for the re-anchored address derivation
```

- **criterion 文本 md5**：`696b3693a6ffab913a1ec3e5bad433ac`（旧文本 md5 见下）
- **旧 criterionHash**（台账 04:51 绿 / 08:21 红同一值）：`d5569285de4b0f26`
- **新 criterionHash**：`4eb0f39c780536d6`
- **goal 文件 md5**：`72940920aace7ca43e076d672b40f26b`
- **逐字 diff（旧 32 行 → 新 93 行）**：`diff -u .quay/ac289-criterion-old.txt .quay/ac289-criterion-current.txt` —— 断言块（`<nav>` 区块抽取、`title_of()`、`<html lang="zh">`、`nav-label-untranslated`、`title-unchanged`）与 `echo OK` 全部**逐字保留**，新增的只有空行分隔与派生块；`expect` 字段 `git diff` 无变化。

### AC1 —— 活生产实例上逐字重跑

```
$ sh -c "$(cat .quay/ac289-criterion-current.txt)"     # cwd=/data/home/yale/work/quay
PROD_EXIT=0
OK -- /dashboard: default nav region carries "Dashboard" and <title>="quay — Dashboard"; under Cookie: lang=zh
the response is <html lang=zh>, that English nav label is gone from the nav region, and this page's own
<title> became "quay — 仪表盘"
stderr: AC-289 candidate readings (cwd=/data/home/yale/work/quay):; pid=2120900 addr=172.28.0.1:13609
        cause=fetch-answered; pid=3022095 addr=<none> cause=carrier-pid-mismatch
```

派生地址 = **当次载体** `.quay/server.json` 里 `web` 的真实端口，⛔ 不是 0（旧判据在同一 root 上派生的是 `172.28.0.1:0`，台账 `2026-09-23T08:56:48.919Z` fail 即该形态）。响应体原始片段（直读，⛔ 不读 render 函数）：

```
en: <html lang="en"   <title>quay — Dashboard</title>   nav(首段) … <div class="mobile-menu-group-label">Core</div>
zh: <html lang="zh"   <title>quay — 仪表盘</title>       nav(首段) … <div class="mobile-menu-group-label">核心</div>
```

### AC2 —— 能取假（三向，同一宿主，两侧都贴）

| 方向 | 做法 | exit | 成因（stderr 尾段） |
|---|---|---|---|
| (a) 机制关掉 | `navLabelsFor` 钳回 `en`（`serve-i18n.ts:97`，改完**已 `git checkout` 复原并 `diff -q` 与备份逐字相同**），重启 serve | **1** | `CAUSE=nav-label-untranslated -- … still renders the literal English nav label "Dashboard"; the nav is not wired to the zh dictionary`（派生地址仍是真实端口 ⇒ 失败在断言不在地址） |
| (b) 无活候选 | 停掉 serve host | **1** | `CAUSE=no-derivable-serve-address -- 2 quay.ts serve candidate(s) … none yielded a derivable address` |
| (c) 地址指到死端口 | 把载体 `web.port` 改成 9（改完已复原） | **1** | `CAUSE=no-reachable-serve-address …; pid=… addr=127.0.0.1:9 cause=fetch-failed(connection-refused) -- curl: (7) Failed to connect to 127.0.0.1 port 9 …` |

三向成因**互不同形**；(a) 与 (b)(c) 分属「断言不过」与「地址查不成」两类，硬规则 3/3b。scratch：`.quay/ac289-ac2{a,b,c}-stderr.txt`。

### AC3 —— 非字面量（真负控制，两处各一次重启）

| root | 重启前派生 | 重启后派生 | 两次 exit |
|---|---|---|---|
| worktree 同一 root | `127.0.0.1:28329` | `127.0.0.1:25195` | 0 / 0 |
| **生产 root** `/data/home/yale/work/quay` | `172.28.0.1:13609` | `172.28.0.1:14037` | 0 / 0 |

两次派生端口**不同**，且各自**等于当次载体**的值（`quay server status --json` 同值、`liveness.alive:true`）。⇒ 判据里没有任何端口字面量。生产 serve 已按原命令（`serve --host 172.28.0.1 --port 0`）重启并核实 `status: running`。

### AC4 —— 归因：每个候选都有 pid + 派生地址 + 成因

三次失败（AC2 的 a/b/c）stderr 里**每个**候选都有三件套，⛔ 无 `addr=` 空、无无成因裸失败；成因是**枚举**而非布尔：`carrier-unreadable` / `carrier-pid-mismatch` / `carrier-no-web-entry` / `carrier-web-marked-down` / `carrier-web-address-unusable` / `fetch-failed(connection-refused|timeout|http-error|host-unresolvable|curl-exit-N)`。其中「runner 自己的 `sh` 进程也命中 pgrep 且 cwd==$root」这一候选（要求 4）实测出现，它拿到自己的成因且**没有清空**已派生的地址。

### AC5 —— 作用域/expect 逐字不变；只经 goal 写面；新 hash 已落账

- 修订只经 `quay goal write AC-289 --criterion …`（+ `--origin … --reason …` 落「为什么改」），落库两次，见上面的 commit 表。
- 台账（本 checkout `.quay/gate-events.jsonl`，AC-289 尾三事件）：

```
08:56:48.919Z  fail  goal-cli     （旧文本）
09:19:01.706Z  pass  goal-cli     （新文本，一次独立真跑）
09:19:13.493Z  pass  goal-amend   payload.criterionHash=4eb0f39c780536d6   ← 尾事件 = 新 hash 的 pass
```

轮转的**修订优先**路径实测生效：`check --stale-pass --sweep` 把 AC-289 排在**第一个**跑（226ms，pass）——因为该 AC 在台账里已有一条**旧 hash** 的轮转事件（`08:21:12.959Z goal-sweep hash=d5569285de4b0f26`），`amendedIds` 据此给它优先权（`goal-store.ts:1930-1966`）。`check --stale-pass` 现读数：`AC-289 ∈ verifiedFresh`，⛔ 不在 `failing`、不在 `staleUnverified`。

> ⚠️ 承载体说明（本轮实测，影响「台账持久性」的读法）：worktree 的 `.quay/gate-events.jsonl` 在 09:16:13Z 被**整份替换成生产台账的前缀快照**（`head -c 30000000 | md5sum` 两文件逐字相同），本轮早先落的两条事件因此消失，已在本节重跑补齐。⇒ **worktree 台账不是持久证据**；持久的是**生产 checkout** 的台账，而它要靠 fan-in + `syncDevelopToDoc` 把重锚版 `goals/AC-289-*.md` 送进生产 checkout 后，由轮转按下表机械补齐（同一条修订优先路径）。

### AC6 —— 本仓库自身行为不回退

```
$ node --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts
PASS: criterion failure attribution intact: inDomain=155 bareAcs=0 ≤ baseline 0 (bareLines=0)   EXIT=0
$ node packages/quay/bin/quay.js goal check --stale-pass        # 本 checkout（重锚版在盘）
{"evaluated":true,"AC-289_in_failing":false,"AC-289_in_verifiedFresh":true,"failing_count":16}   EXIT=1
```
（failing 里的 16 条 = AC-179 / AC-194 / AC-290…AC-303 —— **同族、未重锚**，⛔ 不在本任务 Touches 内。生产 checkout 此刻仍是 17 条（含 AC-289，旧文本），重锚版随 fan-in 落地后收敛。）

### 配套夹具（Plan 步骤 4）

`packages/quay/test/ac289-criterion-address-derivation.test.mjs`（`@test-group product`）——**跑的盘上 criterion 原文**（⛔ 不是拷贝：拷贝会在原文退回字面量后继续绿），11 个用例全绿：

```
✔ shape 1 — cmdline 显式 --port N 且【无载体】          ✔ shape 2 — --port 0 + 载体派生真实端口
✔ 载体 0.0.0.0 → 127.0.0.1 归一化                      ✔ 重启换端口 ⇒ 派生随之变（非字面量）
✔ 无载体 ⇒ carrier-unreadable + 非 0（fail-closed）     ✔ 无 web 条目 ⇒ carrier-no-web-entry
✔ 载体 pid 不符 ⇒ carrier-pid-mismatch                  ✔ web 标 down ⇒ carrier-web-marked-down
✔ 死端口 ⇒ no-reachable-serve-address + connection-refused
✔ 候选逐个累积（runner 自身 sh 也在列，各有成因）        ✔ 断言块仍能取假（nav 未接线 ⇒ nav-label-untranslated）
```

⛔ 夹具里 `runCriterion` **必须异步**：`spawnSync` 会阻塞本进程的事件循环，而每个用例的 HTTP 面就在本进程内 ⇒ curl 连上却 0 字节，直到 10s `--max-time` 超时——实测会把「夹具自身缺陷」显示成「判据缺陷」（`fetch-failed(timeout)`）。