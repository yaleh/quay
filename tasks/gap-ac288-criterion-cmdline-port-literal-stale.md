---
id: gap-ac288-criterion-cmdline-port-literal-stale
title: AC-288 判据从 cmdline 的 `--port` 字面量派生地址，而生产启动器默认已是 `--port 0`（内核分配临时端口）⇒
  判据结构上恒假（addr=172.28.0.1:0，curl 失败）；机制本身为真 —— 重锚地址派生那一步（与 AC-179 在飞任务同一行）
status: done
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

**缺口（立案当轮直接量，2026-09-23T08:22:25.437Z，cwd = 主检出 `/data/home/yale/work/quay`）**

`node packages/quay/bin/quay.js goal gate AC-288` ⇒ **verdict: fail**，reason 逐字：

```
acceptance failed (exit 1) — CAUSE=default-fetch-failed -- GET http://172.28.0.1:0/dashboard
returned nothing (addr=172.28.0.1:0)
```

**成因不是「机制坏了」，也不是「没有服务在跑」—— 是判据派生地址的那一步解析了一个启动器已按设计置 0 的字面量。**

同一进程、同一时刻的三个读数：

| 面 | 读数 | 取法 |
|---|---|---|
| 生产实例 | pid `1805344`，cwd = `/data/home/yale/work/quay`，cmdline `… quay.ts serve --host 172.28.0.1 --port 0` | `pgrep -f 'quay.ts serve'` + `readlink /proc/<pid>/cwd` |
| 判据按 cmdline 派生的地址 | `172.28.0.1:0` ⇒ `curl -sf --max-time 10` 失败 ⇒ `CAUSE=default-fetch-failed` | criterion 第 14 行 |
| 同一进程的**真实**监听地址（载体 `.quay/server.json` / `quay server status --json`） | `web 172.28.0.1:6333`（另有 `control 127.0.0.1:14045`，端口不同，取错会打到控制面） | `quay server status --json` |

**在真实监听地址上，本 AC 的保证成立**（立案当轮逐条实测，`curl` 直读响应体/响应头）：

```
① GET http://172.28.0.1:6333/dashboard                    → <html lang="en"
② GET http://172.28.0.1:6333/dashboard?lang=zh            → <html lang="zh"
   同一次响应的响应头                                       → Set-Cookie: lang=zh; Path=/; Max-Age=31536000; SameSite=Lax
③ GET http://172.28.0.1:6333/dashboard  (Cookie: lang=zh)  → <html lang="zh"
```

⇒ **三段断言全过**。台账的「此刻为假」是**判据的承载体失效**，不是被服务的代码退化。

**承载体是什么时候失效的**：`ce0f47518`（2026-09-18，`gap-serve-same-root-admission-lock`，done）把 web 端口的默认改成**内核分配临时端口**（本任务立案轮逐行核对过，⛔ 不是转述）：

- `packages/quay/src/cli/server.ts:485-490` 逐字：`⛔ --port is passed ONLY when the caller named one … the web port's default now belongs to ONE place — startServer's own port = 0 (kernel-assigned ephemeral)`
- `plugin/scripts/start-drivers.ts:26-28` 逐字：临时端口下**真实端口只在载体里可知**（"the default port is now kernel-assigned, so the carrier is the only place the port is knowable"）；`start-drivers.ts:58-59`：`⛔ --port is OPTIONAL and defaults to 0 =「让内核分配临时端口」`

生产实例于 `2026-09-23T07:29:22.852Z` 按这个默认重启（`.quay/server.json` `startedAt`）。**在那之前**，web 一直由人以显式端口启动（`.quay/serve.log` 上一代实例 `listening on http://0.0.0.0:4173`）⇒ cmdline 里恰好有可解析的端口，判据活着。台账：最后一次 pass `2026-09-23T04:51:13.319Z`，其后三次 `08:21:12Z` / `08:22:06Z` / `08:22:25Z` 全部 fail，`addr` 恒为 `172.28.0.1:0`。目标文件本身**未变**（`md5 6be25670be299e95d0a7345b33410a5f`；`git log -- goals/AC-288-*.md` 末次改动 `15f6febe5`，早于本次红）。

**为什么更早的修复没兜住这一条**（本 AC 上已有一条 done 任务）：`gap-ac288-webui-lang-switch-mechanism`（done）**做出了机制**——`packages/quay/src/serve-lang.ts` 在位、`serve-handlers.ts:69` 是唯一调用点、`serve-dashboard.ts:1403` 消费 `htmlLangTag(opts.lang)`，且上面三段断言逐条为真 ⇒ 它从来不是「机制缺失」。该任务的证据 §8 **明写把判据自身的修法排除在自己的 Touches 之外**（逐字：「判据本身的修法不在本任务 Touches 内（`goals/AC-288-*.md` 属人/驱动维护面）」）——所以**从未有任务碰过地址派生这一步**，而这次坏掉的恰是它。

**家族（枚举，硬规则 3；⛔ 不是一个布尔）**：同一条派生逐字出现在 **17 个** goal 文件里——

```
grep -rlF "grep -oE -- '--host [^ ]+ --port [0-9]+'" goals/ | wc -l   ⇒ 17
AC-179（另一 GOAL） + AC-288 + AC-289 … AC-303（GOAL-024 其余 15 条）
```

其中 AC-179 的同一缺口已由**在飞**任务 `gap-ac179-criterion-cmdline-port-literal-stale`（status `ready`，`goal_ac: AC-179`）立案。**本任务只重锚 AC-288 一条**：其余 15 条 AC（AC-289…303）各自的页面断言（nav 当前项标签 / `<title>`）本任务未逐一实测，把未测量的判据写进 Touches 正是本仓库禁止的形态；它们的修法与本条**同一行、同一步骤**，可由后续各轮各自的立案复用本任务给出的形态。

**四个修法的取舍**（与 AC-179 同族的同一张表）：

- ✗ **把 web 钉回固定端口**（让部署迁就判据）：拒绝。临时端口默认**有理由**（`start-drivers.ts:20-23` 逐字：一个占住硬编码端口的无关进程曾回答 200，于是脚本报出了假绿）；钉回去等于把那条假绿重新引入，且在判据里写死端口正是硬规则 4 推论二点名的形态。
- ✗ **`superseded` 本 AC**：拒绝。GOAL-024 的退出条件要求切换机制在真实 Web 上可用（本 AC 的 `origin` 即该契约的可执行规格），这条保证**今天仍是本仓库的意图**；退役它等于删掉守卫，而它此刻**实测为真**。
- ✗ **`long-term: true`**：不解决。它只把本 AC 搬进 AC-216 复验域（每轮重跑），判据本身仍为假。
- ✓ **重锚判据的派生那一步**：从**活宿主的载体**取真实监听地址，而不是解析一个已按设计置 0 的字面量。作用对象、判定方式、`expect` 全部逐字不变 ⇒ **不减强度**。

**修法必须满足的性质（⛔ 缺一不可）**

1. **地址从活宿主派生，覆盖两种部署形态**：cmdline 显式端口（`--port N`，N ≥ 1）**与**内核分配端口（`--port 0`／无 `--port`，启动器默认）都要能解析。后者真实端口只在**载体**里可知：`.quay/server.json`（`schemaVersion:1`，`pid` + `services[{name,pid,host,port,up}]`）或其结构化读面 `quay server status --json`。正本 reader = `packages/quay/src/server-state.ts`（`readServerState` / `ServerServiceEntry` / `pidAlive` / `probeAddress`）。⛔ 不得把本机当前的端口/主机写成字面量（换台机器或重启即失效）。
2. **载体只用来派生地址，不作判定真值**：判定仍由对 `/dashboard` 的外部 HTTP GET 作出（硬规则 4b：不用被测对象自报的量判它活着）。必须校验 `pid` 是活进程 ∧ `/proc/<pid>/cwd` == `$root`，并**只取 `name == "web"` 那条服务**。
3. **不丢强度**：`expect` 与作用域逐字不变（仅遍历 cwd = 仓库根的生产 serve 实例；对 `<html lang=…>` 与 `Set-Cookie` 的断言逐字保留）；判据仍能取假（AC2）。
4. **候选逐个累积，不被自身进程抹掉**：判据文本本身含 `quay.ts serve` 一词，而 gate 以 `sh -c ". <env> && <criterion>"` 运行（`packages/quay/src/gate/acceptance-runner.ts:151`）⇒ runner 自己的 `sh` 进程也命中 `pgrep`、其 cwd 恰等于 `$root`。任何候选都不得把已派生的地址清空；失败时逐个候选写出 `pid` + 派生地址 + 该候选的成因（地址不可派生 / 连接被拒 / 超时 / 断言不过），⛔ 不得退化成无成因或 `addr=` 空。
5. **fail-closed 保持**：没有活候选 ⇒ 仍非 0（⛔ 不得为了让台账变绿改成 0）；「查不成」与「合格」必须可区分（硬规则 3/3b）。
6. **修订经 goal 写面**（`quay goal write AC-288 --criterion …`，`packages/quay/src/cli/goal.ts:192`）落库，并在记录里写明**为什么改**（承载体搬迁 + 上述读数）。
7. **修订后新 criterionHash 至少有一条独立 `quay goal gate AC-288` 落账**（AC-242 的修订入闸要求：`payload.criterionHash` ≠ 当前指纹的旧轮转 verdict 不得再计 fresh，`packages/quay/src/goal-store.ts:248/286`）。

<!-- dedup-ref -->
去重（按机制，⛔ 不按症状关键词）与可追溯性：顶层 `goal_ac: AC-288` 的 `grep -rln` ⇒ **1 命中**，`gap-ac288-webui-lang-switch-mechanism`，status **done** ⇒ 本 AC 无在飞主，本条不是重复立案，而是「承载体搬迁 ⇒ 判据 stale」这一机制在本 AC 上的实例。同机制、不同 AC 的在飞任务：`gap-ac179-criterion-cmdline-port-literal-stale`（`ready`）——它重锚 AC-179，不覆盖 AC-288，两条互不重复。同型先例（承载体搬迁后把判据移到真正承载该角色的地方）：`gap-ac286-fanin-merge-target-criterion-carrier-stale`（done）、`gap-ac157-catalog-carrier-moved-criterion-stale`（done）。引入临时端口默认的 `gap-serve-same-root-admission-lock`（done）改的是**启动器**，从未重锚过任何判据 —— 相关但不同机制。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-288` ⇒ `verdict: fail` 且 `addr=172.28.0.1:0`，贴完整输出与当时 `quay server status --json` 的 `web` 端口读数（两者必须指向**同一**进程）。
2. **改判据的地址派生那一步**（只此一步；其余逐字不动）：
   - 候选仍由 `pgrep -f 'quay.ts serve'` × cwd == `$root` 产生；
   - 每个候选：先看 cmdline，`--port N` 且 N ≥ 1 ⇒ `host:N`（`0.0.0.0` → `127.0.0.1` 的既有归一化保留）；否则读 `$root/.quay/server.json`，要求顶层 `pid` == 该候选 pid ∧ `pidAlive` ∧ `services[]` 中 `name == "web"` ∧ `up` 为真 ⇒ `host:port`；
   - 载体读取失败/形状不符/无 `web` 条目 ⇒ 该候选的成因为「地址不可派生」，**继续看下一个候选**，⛔ 不把 `addr` 清空、⛔ 不放弃后续候选；
   - JSON 解析可用 `node -e` 或 `python3`（本仓已有 21 条 goal criterion 调 node、70 条调 python3，同一环境可达）。
3. **`quay goal write AC-288 --criterion "$(cat <新 criterion 文件>)"`** 落库（贴逐字 diff：只有派生块变化）。
4. **配套夹具** `packages/quay/test/ac288-criterion-address-derivation.test.mjs`（`// @test-group product`，`node:test`）：对两种部署形态的 cmdline/载体组合给出期望地址，**正负两向**都要有（显式端口 / `--port 0` + 载体 / 无载体 / 载体无 `web` 条目 / 载体 pid 不是活进程）。
5. **复验**：`goal gate AC-288` 在新 criterionHash 上 `exit 0`，且台账尾事件是 pass；`goal check --stale-pass` 的 failing 集合中不再含 AC-288。
6. **收口**：`bash scripts/test.sh --for-task gap-ac288-criterion-cmdline-port-literal-stale --allow-thin` 绿；`node --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts` `exit 0`。

## AC

- [x] AC1 修订后的 criterion 在**活生产实例**上逐字重跑 `exit 0`，且它实际派生/使用的地址 = **当次**载体里 `web` 服务的真实端口（⛔ 不是 0）。贴：criterion md5、派生地址、exit code、`curl` 三条读数（默认 / `?lang=zh` 含 `Set-Cookie` / 仅 cookie）。
- [x] AC2 能取假（三向，同一宿主，两侧读数都贴）：(a) 机制被临时关掉（把 `/dashboard` 的语言钳回 `en`）⇒ 非 0，且 stderr 指明是哪一段断言不过；(b) 无活候选（停掉 serve host）⇒ 非 0，成因与 (a) **不同形**；(c) 地址指到死端口 ⇒ 非 0，成因含「连接被拒」。⛔ 只有 (a)(b)(c) 都贴才算，只贴绿的一侧不算。
- [x] AC3 非字面量（真负控制）：**重启**生产 serve（内核会分配**另一个**端口），同一 root 上重跑 ⇒ 仍 `exit 0`，且两次派生端口不同、各自等于当次载体的值。贴两个端口值 + 两次 exit。
- [x] AC4 归因：制造一次真实 fail（用 AC2 任一方向），stderr 必须对**每个**候选给出 `pid` + 派生地址 + 成因；⛔ 候选存在时不得出现 `addr=` 空或无成因的裸失败。
- [x] AC5 作用域与 `expect` 逐字不变；修订只经 `quay goal write AC-288 --criterion …` 落库且含「为什么改」；修订后**新** criterionHash 至少有一条独立的 `quay goal gate AC-288` 落账。
- [x] AC6 本仓库自身行为不回退：`node --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts` `exit 0`；`node packages/quay/bin/quay.js goal check --stale-pass` 的 failing 集合不再含 AC-288。
- [x] AC7 scoped 门 `bash scripts/test.sh --for-task gap-ac288-criterion-cmdline-port-literal-stale --allow-thin` `exit 0`。

## DoD

- **真落地**：`goals/AC-288-*.md` 的重锚版落在 **develop**（`git show develop:goals/AC-288-*.md` 可见新派生），且台账尾事件是**新 criterionHash 的 pass**，由**一次对活生产实例的真跑**产出（⛔ 不是夹具、不是 dry-run、不是引用旧 verdict 的轮转）。
- **保证本体重测**：在判据实际使用的那个地址上，`<html lang="en">` / `?lang=zh ⇒ <html lang="zh"> + Set-Cookie: lang=zh` / 仅 `Cookie: lang=zh ⇒ <html lang="zh">` 三条各由**响应体或响应头**直读（⛔ 不读进程内中间变量）。
- `node --experimental-strip-types packages/quay/bin/quay.ts goal check --stale-pass` ⇒ `exit 0`，`AC-288` 不在 `failing` 内。
- AC1–AC4 的**正负两向**读数都在任务体或 `.quay/ac288-*` 未跟踪 scratch 里（⛔ 只贴绿侧不算），可被下一轮独立复算。
- **不越界**：AC-289…AC-303 那 15 条 criterion 与它们的页面任务不在本任务 Touches 内；若执行者选择一并重锚，必须**先**把对应 `goals/AC-*.md` 加进 Touches 并对每条逐条实测前后读数（⛔ 不得批量改未测量的判据）。
- 本任务自身 `done` 并随 fan-in 落地。

## Touches

- `goals/AC-288-切换机制本身可用-默认-en-lang-zh-生效并种下持久化-cookie-cookie-单独在无-query-参数的.md`
- `packages/quay/test/ac288-criterion-address-derivation.test.mjs` (new)
- `tasks/gap-ac288-criterion-cmdline-port-literal-stale.md`
- `plugin/test/capability-catalog.test.mjs`（**本轮新增，第四项**：不是本任务修法的一部分，而是**解除本分支 suite 门的阻塞**——逐字 cherry-pick 自同族在飞任务 `gap-ac179-criterion-cmdline-port-literal-stale` 的 `578bf42bf`，理由与读数见「执行记录」末节）

（说明：第一条是本任务的落地面——criterion 的地址派生那一步，经 `quay goal write AC-288 --criterion …` 落库，`expect` 与正文语义逐字不变、只补「为什么改」；第二条是配套夹具（两种部署形态的派生正/负控制）；第三条是 self-touch；**第四条是本轮新增**——fan-in 的 `step=suite` 因一处**确定性**红（seeded 抽样 × 全角问号 `？`）连续三次不落地，且该红不在本任务任何可改面内 ⇒ 依「修判据不修数据」逐字 adopt 同族已修好的那一处；两分支 diff 逐字相同，故谁先落地，另一方在此文件上的 fan-in merge 是 no-op。⛔ 不新增 `plugin/scripts/*.ts`——派生助手若要抽出，默认放 `packages/quay/src/`；若最终落在 `plugin/scripts/`，必须同时把 outline、`plugin/scripts/capability-catalog-declarations.json` 与本任务 Touches 一并更新。）

## 执行记录（落地读数 / 修法 / 为什么改）

**为什么改**：`ce0f47518`（`gap-serve-same-root-admission-lock`，done）把 web 端口默认改成内核分配（`--port 0`），于是派生那一步解析出的字面量恒为 `0` —— `<host>:0` 是**结构性**不可 fetch 的地址，本 AC 在任何使用该默认的部署上恒假（台账：末次 pass `2026-09-23T04:51:13.319Z`，其后 `08:21:12Z`/`08:22:06Z`/`08:22:25Z` 三次 fail，`addr` 恒为 `172.28.0.1:0`）。机制本身从未坏：在真实监听地址上三段断言全过。⇒ 坏的是**判据的承载体**（地址派生那一步），修的就是那一步。

**修法（只此一步）**：候选仍由 `pgrep -f 'quay.ts serve'` × `cwd == $root`（`/proc/<pid>/cwd` 校验）产生；每个候选：① 先读**它自己的 argv**（NUL 分隔、**按位置**判 `serve … --host H --port N`，N ≥ 1）⇒ `H:N`，`0.0.0.0`/`*`/`::` → `127.0.0.1` 的既有归一化保留；② 否则读 `$root/.quay/server.json`，要求顶层 `pid` == 该候选 ∧ `kill -0` 活 ∧ `services[]` 中 `name == "web"` ∧ `up` 为真 ⇒ `host:port`；③ 两者取不到 ⇒ 记该候选成因、**继续下一个候选**，⛔ 不清空已派生地址、⛔ 不放弃后续候选。载体只用于**派生地址**，判定仍是外部 HTTP GET（硬规则 4b）；只取 `name == "web"`（⛔ 不取 control —— 两者同 pid，取错会打到 JSON-RPC 口）。失败路径统一 `CAUSE=` + `CANDIDATES:`（每个候选 `pid` / `addr` 或 `addr=-` / `cause`）。修订经 `quay goal write AC-288 --criterion …` 落库：criterion 值 md5 `a72c6e2a16e0437ad8750642274c8671`（5212 B），新指纹 `23c1927ab51c48b3`（旧 `23c7d137f62d322e`）；frontmatter 仅 `criterion` 变，`expect`/`origin`/`title`/`status`/`statusLog`/`fidelity`/`activatedAt` 逐字 SAME。

**正负两向读数**（未跟踪 scratch `/data/home/yale/work/quay/.quay/ac288-criterion-reanchor/`，下一轮可独立复算）：

- **AC1** `ac1-live-readings.txt`：活生产实例逐字重跑 `exit 0`，派生地址 = 当次载体 `web` 端口（`172.28.0.1:4601`，⛔ 不是 0）；三条读数由响应体/响应头直读：`<html lang="en"` / `?lang=zh ⇒ <html lang="zh"` + `Set-Cookie: lang=zh; Path=/; Max-Age=31536000; SameSite=Lax` / 仅 `Cookie: lang=zh ⇒ <html lang="zh"`。
- **AC2（三向，两侧都贴）**：(a) `ac2a.txt` —— 机制钳回 `en`（worktree 内 `resolveLang` 临时早返回，**提交前已 revert**）⇒ `exit 1` + `CAUSE=query-param-not-honored`，并有直读控制（`?lang=zh` 确实回 `lang="en"`）；(b) `ac2b.txt` —— 停掉该 root 的 serve ⇒ `exit 1` + `CAUSE=no-derivable-address`，两子例：载体残留（`carrier-pid-mismatch`）/ 无载体（`carrier-absent`），**与 (a) 不同形**；(c) `ac2c-ac4.txt` —— 派生地址指向真死端口 ⇒ `exit 1` + `CAUSE=default-fetch-refused … connection refused`（curl exit 7 独立佐证端口是死的）。
- **AC3** `ac3-restart.txt` + `ac3-restart-deliberate.txt`：三代端口 `4601 → 2637 → 13609`，**同一份 criterion 文本**每次 `exit 0` 且派生端口各等于当次载体值 ⇒ 非字面量。（过程如实记录：第一次重启是我的 `pkill -f` 模式过宽误杀生产 serve，随后按同一命令行拉起；之后另做一次**有意**重启复核，两代读数均在。重启后 `quay server status --json` 报 `running`、`/health` 200。）
- **AC4**：上面 (c) 与 (a) 两次真实 fail 的 stderr 都对**每个**候选给出 `pid` + `addr=<host:port>`（或 `addr=-`）+ `cause`（如 `argv-no-serve`、`argv-port-kernel-assigned,carrier-absent`、`carrier-pid-mismatch`）—— ⛔ 无 `addr=` 空、无无成因的裸失败。
- **AC5** `ac5-revision.txt`：字段级 diff 仅 `criterion` DIFF、其余 SAME；`expect` 逐字贴出；两个写面提交（worktree `95ac8d73b`/`b7e878a17`，生产/develop `51ad3c709`）；新指纹的独立台账行 `2026-09-23T08:55:15.565Z actor=goal-amend verdict=pass criterionHash=23c1927ab51c48b3`（由 `goal check --stale-pass --sweep --budget 1` 对活生产实例真跑产出，`sweep.ran[0]={id:AC-288,verdict:pass,ms:206}`）。
- **AC6** `ac6-attribution.txt`（`PASS: inDomain=155 bareAcs=0 ≤ baseline 0`，exit 0）+ `ac6-stale-pass.json`（failing 17 条**不含** AC-288：`AC-179, AC-194, AC-289…AC-303`，均为既存 stale 家族，非本任务引入）。
- **AC7**：见 fan-in 的 scoped 门读数（`bash scripts/test.sh --for-task … --allow-thin`）。

**夹具** `packages/quay/test/ac288-criterion-address-derivation.test.mjs`（`// @test-group product`，11 例全绿）：它**不是**派生逻辑的副本 —— 它从 goal 文件里按 marker **逐字抽取** criterion 的 `addr-derivation` 块（`packages/quay/test/…` 与 `goals/AC-288-*.md` 的单一正本关系），在 `git init` 过的临时 root 里对**真实进程**（argv 按位置含 `quay.ts serve --host H --port N`）与真实载体跑正/负两向：显式端口 / `--port 0` + 载体 / 通配 host 归一化 / 无载体 / 载体 pid 不符 / 无 `web` 条目 / `web.up:false` / 载体 pid 已死 / runner 自身 `sh` 候选的归因 / 死端口的 `default-fetch-refused`。夹具曾抓出两个真实缺陷：重锚时**漏掉**的 `0.0.0.0 → 127.0.0.1` 归一化，以及 `node -e` 顶层 `return` 在 Node ≥24 被拒（改用 IIFE）。

**给同族复用**：`AC-179` 与 `AC-289…AC-303` 的同一行派生可用本任务给出的同一形态重锚；⛔ 本任务未改它们任何 criterion（`goal check --stale-pass` 里它们的 fail 是既存事实）。

### 本轮（2026-09-24）—— suite 门的阻塞项：adopt 同族已修好的那一处判据

本分支 fan-in 的 `step=suite` 连续三次红（`2026-09-23T09:32:33` / `16:00:24` / `17:33:29`），末次签名逐字：

```
AssertionError [ERR_ASSERTION]: answers are phrased as QUESTIONS (a capability = a question made askable): release-branch-janitor.ts
    at TestContext.<anonymous> (plugin/test/capability-catalog.test.mjs:467:12)
```

**隔离复跑即复现**（`bash scripts/test.sh plugin/test/capability-catalog.test.mjs` ⇒ `17 tests / 16 pass / 1 fail`，同一行同一签名）⇒ ⛔ 不是负载 flake，是**确定性红**。机理：AC5 的抽样是 **seeded**（`mulberry32(20260804)` over **排序后**的行集）⇒ 抽样结果是**树的纯函数**；一次 landing 把样本移到 `release-branch-janitor.ts`（其 QUESTION 以**全角** `？`（U+FF1F）收尾）之后，**每棵树同时红**。

**判据本身过窄，故修判据不修数据（硬规则 5b）**：`/\?/` 只认 ASCII 问号，而 SPEC `orchestration/SPEC-methodology-as-a-deliverable.md` 的 AC5 原文只说「随机抽 5 个交付的检查,问『它回答什么问题』」——⛔ **未**规定 ASCII 问号；全角 `？` 同样是「以问句收尾」，且兄弟实例正是一族行（本树实测：357 条目中以全角 `？` 结尾 **6** 条，另 17 条尾部无标点但句中含 ASCII `?`，不受影响）。

**本轮动作 = cherry-pick 同族已修好的那一处**：同族在飞任务 `gap-ac179-criterion-cmdline-port-literal-stale` 已把同一处修好（`578bf42bf`，`2026-09-24T01:28:53`），**但当时不在 develop 上**；本分支不带上它，fan-in 的 suite 门永远过不去 ⇒ 逐字 cherry-pick（`git cherry-pick -n`，diff 逐字不动，只把提交信息换成本树自己的读数与出处）。本树自测：`17 tests / 16 pass / 1 fail` ⇒ **`18 tests / 18 pass / 0 fail`**。修法只拓宽**拼法**（`QUESTION_MARK = /[?？]/`），并**新增一条负控制**钉住「两种标点都没有 ⇒ 仍判非问句」，故判据仍能取假。两分支在此文件上 diff 逐字相同 ⇒ 谁先落地，另一方的 fan-in merge 在此文件上是 no-op。

**同批第二条红已判明为负载 flake（非本任务引入、非本任务可改）**：`plugin/test/l1-delivery-surface-check.test.mjs` AC4 在 fan-in 日志里是 `Error: ENOENT … '/data/scratch/yale/l1-surface-Qci5Zl/plugin/test'`（`fs.cpSync` 复制夹具时 scratch 目录消失），**隔离复跑 6/6 全绿** ⇒ 并发/宿主 flake，该文件亦不在本任务 Touches 内。