---
id: gap-ac179-criterion-cmdline-port-literal-stale
title: AC-179 判据从 cmdline 的 `--port` 字面量派生地址，而生产启动器的默认已是 `--port 0`（内核分配临时端口）⇒
  判据结构上恒假、卡片其实一直在渲染；且失败成因被判据自身进程抹成 `addr=none`（AC-241 家族）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-179
---
## Proposal

**缺口（立案当轮直接量，2026-09-23T08:1xZ，cwd = 主检出 `/data/home/yale/work/quay`）**

`goals/AC-179-web-card-and-cli.md`（`status: achieved`，其 GOAL-001 已 `achieved` ⇒ 本 AC 已离开复验域且**未**声明 `long-term: true`）的 criterion **逐字重跑 exit 1**，stderr 逐字：

```
AC-179 fail: no running quay.ts serve instance with cwd=/data/home/yale/work/quay served
GET /dashboard containing id=goal-card (curl --max-time 10; last candidate
addr=none)
```

**成因既不是「卡片没了」也不是「没有服务在跑」—— 是判据派生地址的那一步读了一个启动器已按设计置 0 的字面量。**

| 面 | 读数（同一进程、同一时刻） |
|---|---|
| 生产实例 | pid `1805344`，cwd = `/data/home/yale/work/quay`，cmdline `… quay.ts serve --host 172.28.0.1 --port 0` |
| 判据按 cmdline 派生的地址 | `172.28.0.1:0` ⇒ `curl -sf --max-time 10` **rc=7（连接被拒）**，http=000 |
| 同一进程的**真实**监听地址（`.quay/server.json` / `quay server status --json`） | `web 172.28.0.1:6333` ⇒ 同一条 curl+grep：**`id="goal-card"` 命中 1** |
| 卡片内容（真数据，⛔ 不是空骨架） | `Stage goals / active 1 / cap 5`，`GOAL-022` + `fresh` 标记 + `AC achieved 3/4` + 进度条 |

⇒ **保证本身成立**（dashboard 卡片在运行中的生产 Web 上真实渲染）；台账的「此刻为假」是**判据的承载体失效**。

**承载体是什么时候失效的**：`ce0f47518`（2026-09-18，`gap-serve-same-root-admission-lock`，done）把 web 端口的默认改成**内核分配临时端口**：

- `packages/quay/src/cli/server.ts:485-490` 逐字：`⛔ --port is passed ONLY when the caller named one … the web port's default now belongs to ONE place — startServer's own port = 0 (kernel-assigned)`
- `plugin/scripts/start-drivers.ts:58-59`：`--port` OPTIONAL，默认 `0` =「让内核分配临时端口」；同文件 `:26-28` 逐字：临时端口下**真实端口只在载体里可知**（"the default port is now kernel-assigned, so the carrier is the only place the port is knowable"）

该 commit 是 HEAD 的祖先；生产实例于 `2026-09-23T07:29:22Z` 按这个默认重启（`.quay/server.json` `startedAt`）。**在那之前**，web 一直由人以显式端口启动（`orchestration/manager-tick-log.md:35690` `setsid nohup node --watch … --host 100.78.206.100 --port 4173`；`.quay/serve.log` 上一代实例 `listening on http://0.0.0.0:4173`）⇒ cmdline 里恰好有可解析的端口，判据活着。台账：本 AC 生命期 930 条 verdict，**782 条 pass**，最后一次 pass `2026-09-23T04:09:01.963Z`。目标文件本身**未变**（`md5 59c88b885b09753adbb368f51e9065c0`，与 2026-09-14 取证时逐字相同）。

**次级缺陷（同轮直接量）：失败成因被判据自身的进程抹掉，指向错的方向。** 判据用 `pgrep -f 'quay.ts serve'` 找候选，**而判据自身的文本就含这个字符串** —— 消费它的 gate 以 `sh -c ". <env> && <criterion>"` 运行（`packages/quay/src/gate/acceptance-runner.ts:151`），于是 runner 自己的 `sh` 进程也命中 pgrep，且其 `cwd` 恰等于 `$root`。它对 `--host … --port …` 零命中 ⇒ 循环内的 `a=` 被**覆盖成空串**；runner 的 pid 最大（pgrep 按 pid 序）⇒ `$a` 最终为空 ⇒ 报「no running … instance / addr=none」，**而候选一直在**。逐字复现（本轮）：

```
$ sh -c ". /dev/null && <criterion 逐字>"   → exit 1；stderr 与台账 2026-09-23T08:09:06Z / 08:10:01Z 两条 fail 逐字一致
$ pgrep -af 'quay.ts serve'                  → 1805344（真实例，cwd=root）在列
```

⇒ 这是一条**结构上不可能报出真成因**的失败路径（AC-241 家族：fail 必须携带判据自己写出的成因）。

**为什么前两次修复没保住这一条**（本 AC 上已有三条 done 任务）：

- `gap-dashboard-goal-card-provider-backed`（done）**做出了卡片** —— 卡片一直在，本条从来不是「卡片缺失」。
- `gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks` + `gap-ac179-criterion-cold-miss-30s-ttl-always-expired`（均 done）**修的是渲染耗时**（`--max-time 10` 打在恒冷的构建路径上）；且后者把自己的 DoD 逐字钉成 **「AC-179 criterion 逐字不改」** ⇒ 它被结构性地禁止去碰派生那一步（`plugin/test/frozen-population-bare-failure-exits-zero.test.mjs:44-49` 记录了这次分工）。
- 三次都在修**别的面**（卡片存在性 / 渲染延迟 / 归因），**没有一次碰过地址派生**；而这次坏掉的恰是它。同型先例：`tasks/gap-ac286-fanin-merge-target-criterion-carrier-stale.md`、`tasks/gap-ac157-catalog-carrier-moved-criterion-stale.md`（承载者搬迁 ⇒ 判据 stale ⇒ 把判据移到真正承载该角色的地方）。

**四个修法的取舍**：

- ✗ **把 web 钉回固定端口**（让部署迁就判据）：拒绝。临时端口默认**有理由**（`start-drivers.ts:22` 逐字：一个占住硬编码端口的无关进程曾回答 200，于是脚本报了假绿）；钉回去等于把那条假绿重新引入，且判据里写死端口正是硬规则 4 推论二点名的形态。
- ✗ **`superseded` 本 AC**：拒绝。GOAL-001 §退出条件逐字要求「Web dashboard 上一眼能看到每条 active goal 的 AC 达成率」—— 这条保证**今天仍是本仓库的意图**，退役它等于删掉守卫。
- ✗ **`long-term: true`**：不解决。它只把本 AC 搬进 AC-216 复验域（每轮重跑），判据本身仍为假。
- ✓ **重锚判据的派生那一步**：从**活宿主的载体**取真实监听地址，而不是解析一个已按设计置 0 的字面量。作用对象、判定方式、`expect` 全部逐字不变 ⇒ **不减强度**。

**修法必须满足的性质（⛔ 缺一不可）**

1. **地址从活宿主派生，覆盖两种部署形态**：cmdline 显式端口（人工钉端口时 ≥1）**与**内核分配端口（`--port 0`，启动器默认）都要能解析。后者真实端口只在**载体**里可知：`.quay/server.json`（`schemaVersion:1`，`pid` + `services[{name,pid,host,port,up}]`）或其结构化读面 `quay server status --json`。⛔ 不得把本机当前的端口/主机写成字面量。
2. **载体只用来派生地址，不作判定真值**：判定仍由对 `/dashboard` 的外部 HTTP GET 作出（硬规则 4b：不用被测对象自报的量判它活着）。必须校验 `pid` 是活进程 ∧ `/proc/<pid>/cwd` == `$root`，并**只取 `name == "web"` 那条服务**（载体里还有 `control`，端口不同，取错会打到控制面）。
3. **不丢强度**：`expect` 与作用域逐字不变（仅遍历 cwd = 仓库根的生产 serve 实例；按位置认 `id="goal-card"`，不认字符串提及）；判据仍能取假（AC2）。
4. **不再被自身进程抹掉候选**：每个候选的派生地址必须**累积**，任何候选都不许把已派生的地址清空；失败时逐个候选写出 `pid` + 派生地址 + 该候选的失败成因（连接被拒 / 超时 / 卡片缺失），不得退化成 `addr=none`。
5. **fail-closed 保持**：没有活候选 ⇒ 仍非 0（⛔ 不得为了让台账变绿改成 0）；「查不成」与「合格」必须可区分（硬规则 3/3b）。
6. **修订经 goal 写面**（`quay goal write AC-179 --criterion …`）落库，并在记录里写明**为什么改**（承载体搬迁 + 上述读数）。

<!-- dedup-ref -->
去重（按机制，⛔ 不按症状关键词）与可追溯性：`grep -rln '^goal_ac: *AC-179' tasks/` ⇒ 3 条、**全部 done**（`gap-ac179-criterion-cold-miss-30s-ttl-always-expired` / `gap-dashboard-goal-card-provider-backed` / `gap-serve-stale-signal-has-no-consumer`）⇒ 本 AC 无在飞主，本条不是重复立案，而是「前序修复没兜住」的第四个实例（前三条各自修了别的面）。同机制不同 AC 的先例：`gap-ac286-fanin-merge-target-criterion-carrier-stale`（done）、`gap-ac157-catalog-carrier-moved-criterion-stale`（done）。`gap-serve-same-root-admission-lock`（done）引入了临时端口默认，但它改的是启动器，从未重锚过任何判据 —— 相关但不同机制。

## Touches

- `goals/AC-179-web-card-and-cli.md`
- `packages/quay/test/ac179-criterion-address-derivation.test.mjs` (new)
- `tasks/gap-ac179-criterion-cmdline-port-literal-stale.md`

（说明：第一条是本任务的落地面 —— criterion 的地址派生那一步，经 `quay goal write AC-179 --criterion …` 落库，`expect`
与正文语义按性质 3 保持不变、只补「为什么改」；第二条是配套的两方向夹具（内核分配端口的生产形态 ⇒ 0；卡片缺失 /
服务停止 ⇒ 非 0 且成因具名，即 AC2/AC3 的正负控制）；第三条是 self-touch。若执行者另行抽出可测的派生助手并新增
`plugin/scripts/*.ts`，必须同时把 outline 与 `plugin/scripts/capability-catalog-declarations.json` 加进本节，并把
任何被牵动的 `*.baseline.json` 一并声明；⛔ 不新增脚本是本任务的默认取向。）

## AC

- [x] AC1 修订后的 criterion 在**活生产实例**上逐字重跑 `exit 0`，且它实际派生/使用的地址 = 当次载体里 `web` 服务的真实端口（⛔ 不是 0）。贴：criterion md5、派生地址、exit code、`curl` 读数。
  - **criterion md5 = `6374f5ad14972bade1c3220707182376`**（9061 字符 / 9127 字节；`goal show AC-179 --json` 取回后 `md5(criterion.encode())`；旧 = `1d7dfd396c4e8acf89a7dbffc4e720fb`，562 字节）
  - 活实例：pid `1805344`，cmdline `… quay.ts serve --host 172.28.0.1 --port 0`，cwd = `/data/home/yale/work/quay`
  - 当次载体 `.quay/server.json` → `web = {"pid":1805344,"host":"172.28.0.1","port":6333}`
  - 逐字重跑（`sh -c "<criterion>"`，cwd = 主检出）：`AC-179 ok: GET http://172.28.0.1:6333/dashboard carries id="goal-card" (address derived from the live host, not from a launcher literal)` ⇒ **exit 0**
  - 派生地址 `172.28.0.1:6333` **逐字等于**载体的 `web.port`（6333，⛔ 不是 cmdline 里的 0）
  - `curl` 读数：`curl -sf --max-time 10 http://172.28.0.1:6333/dashboard | grep -c 'id="goal-card"'` ⇒ **1**（同一时刻）
  - **对照（旧文本，同宿主同时刻）**：`exit 1`，stderr `… served GET /dashboard containing id=goal-card (curl --max-time 10; last candidate addr=172.28.0.1:0)`

- [x] AC2 能取假（三向，同一宿主，两侧读数都贴）
  - **(a) 卡片缺失**（真实 `quay.ts serve` 形态进程 + 真实载体 + 真实 HTTP；`/dashboard` 由 200 但不含卡片）⇒ **`exit 1`**，stderr 逐字：`AC-179 fail: no candidate served GET /dashboard containing id="goal-card" (curl -sf --max-time 10)` / `pid=<serve> addr=127.0.0.1:<port> cause=card missing: http://127.0.0.1:<port>/dashboard answered without id="goal-card"` ⇒ 含 `/dashboard` ∧ 含 `id="goal-card"` ✓
  - **(b) 无活候选**（**活生产实例上真做**：`kill -TERM 1805344`，端口 6333 确认不再监听；`start-drivers` 之后已恢复）⇒ **`exit 3`**（NOT-EVALUATED），stderr 逐字：`AC-179 NOT-EVALUATED: no live candidate exposed a derivable address, so GET /dashboard containing id="goal-card" cannot be reached at all — this is NOT a pass` / `pid=1187310 addr=underivable cause=its address is not derivable from the carrier: carrier …/.quay/server.json names pid 1805344, which is NOT a live process …; its cmdline names no --port at all` ⇒ **与 (a) 不同形**（不同 exit、不同 cause 词表、不同首行）✓
  - **(c) 地址指到死端口**（载体 `web.port` 指向一个刚被内核回收的空闲端口）⇒ **`exit 1`**，stderr 逐字含 `cause=connection refused (curl exit 7) at http://127.0.0.1:<dead>/dashboard` ✓
  - 读数出处：(a)/(c) 在**同一宿主**的临时 workspace 上跑**同一份落库判据文本**（真实 serve 进程/真实载体/真实 HTTP，见 AC7 的测试文件 AC2′/AC5′）；(b) 在**活生产 root** 上真做。

- [x] AC3 非字面量（真负控制）：**重启**生产 serve（内核会分配**另一个**端口），同一 root 上重跑 ⇒ 仍 `exit 0`，且两次派生端口不同、各自等于当次载体的值。贴两个端口值 + 两次 exit。
  - 重启经**机制**（`plugin/scripts/start-drivers.ts`，非手搓）：`{"state":"started", …}`；为不留下比自己接手时更宽的绑定面，第二次重启显式带上原 `--host 172.28.0.1`。
  - 三个内核分配端口，同一 root，同一份判据文本：

    | 载体 `web` | 判据派生/使用的地址 | exit |
    |---|---|---|
    | `172.28.0.1:6333`（07:29:22Z 那一代，重启前） | `172.28.0.1:6333` | **0** |
    | `0.0.0.0:4781`（重启 #1） | `127.0.0.1:4781`（通配绑定折回环 —— 顺带在生产上走到那条分支） | **0** |
    | `172.28.0.1:26245`（重启 #2，恢复原 host） | `172.28.0.1:26245` | **0** |

  - 三个端口**互不相同**，每次派生值都等于**当次**载体的 `web.port` ⇒ 判据不是任何字面量。
  - 重启后生产面自证：`GET /health` ⇒ `{"ok":true,"stale":false,…}`；`GET /dashboard` 含 `id="goal-card"`；四个 driver 的 anchor pid `1776653` 未变（`driver_alive:1`）。

- [x] AC4 归因：制造一次真实 fail（用 AC2 任一方向），stderr 必须对**每个**候选给出 `pid` + 派生地址 + 成因；⛔ 候选存在时不得再出现 `addr=none`
  - **活生产 root、serve 已停**（同一次真跑，AC2(b)）：新文本 `exit 3`，逐候选 `pid=<runner> addr=underivable cause=…（载体指向已死 pid + cmdline 无端口）`；**同一条件下旧文本 `exit 1`、`addr=none`** ← 逐字对照 ✓
  - 候选**存在且带派生地址**的失败形态（(a) 方向）逐字：`pid=<serve> addr=127.0.0.1:<port> cause=card missing: …` ∧ `pid=<判据自身的 sh> addr=underivable cause=its cmdline names no --port at all` ∧ `candidates (quay.ts serve with cwd=root): 2` ⇒ **每个候选都被枚举**，且判据自身那个候选（曾经正是它把地址抹成空串）现在只能**被报告**，不能再清空任何已派生的地址。
  - **台账侧的旧文本对照（本日真事件，逐字）**：`2026-09-23T08:09:06.779Z fail … last candidate addr=none`；`2026-09-23T08:10:01.404Z fail … addr=none`；`2026-09-23T08:19:17.794Z fail … addr=172.28.0.1:0`；`2026-09-23T08:22:05.887Z fail … addr=172.28.0.1:0` —— 旧文本在**候选一直在**的情况下报空地址或无意义地址，两种形态都被新文本消灭。

- [x] AC5 作用域与 `expect` 逐字不变；修订只经 `quay goal write AC-179 --criterion …` 落库且含「为什么改」；修订后**新** criterionHash 至少有一条独立的 `quay goal gate AC-179` 落账
  - `expect` 落库后逐字比对不变：`exit 0（仅遍历 cwd = 仓库根的生产 serve 实例；按位置认元素 id="goal-card"，不认标题/提交主题里的字符串提及）`
  - 作用域不变：候选谓词仍是 `pgrep -f 'quay.ts serve'` ∧ `/proc/<pid>/cwd == $root`（逐字保留）；判定仍由对外部 `GET /dashboard` 的元素命中作出
  - 落库命令：`quay goal write AC-179 --criterion "<新判据>" --body "<含「为什么改」的正文>" --reason "重锚判据的地址派生那一步：…"` ⇒ commit `5c256084f goals: AC-179 field:criterion,body by cli:872334`（在工作树分支上，随 fan-in 进 develop）
  - 落库后**逐字节**往返校验：`goal show --json` 取回的 criterion 与源文件 `==` True（9127 字节，YAML 块标量往返无损）
  - 独立 gate 落账：`quay goal gate AC-179 --root <本任务工作树>` ⇒ `{"verdict":"pass","reason":"acceptance passed (exit 0)","timestamp":"2026-09-23T08:28:50.740Z"}`，事件 id `bad866ec-dde6-4cb4-8893-32ddfdb0efda`（时间戳晚于修订提交；该次运行跑的是**修订后**文本 —— 它派生的是那份载体里的 `web` 端口并把地址写进了 stdout）

- [x] AC6 本仓库自身行为不回退：`node --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts` `exit 0`
  - 逐字：`PASS: criterion failure attribution intact: inDomain=155 bareAcs=0 ≤ baseline 0 (bareLines=0)` ⇒ **exit 0**（修订没有新长出 bare failure exit；`docs/analysis/criterion-failure-attribution.baseline.json` 的 `count:0` 未被顶破，也不需要改 baseline）

- [x] AC7 scoped 门 `bash scripts/test.sh --for-task gap-ac179-criterion-cmdline-port-literal-stale --allow-thin` `exit 0`
  - 逐字：**SCOPED GATE EXIT=0**；新增测试文件 `packages/quay/test/ac179-criterion-address-derivation.test.mjs` 9 tests / **9 pass / 0 fail**（1.6s）
  - 该文件把**落库的判据文本本身**绑到行为上（从 `goals/AC-179-*.md` 读，⛔ 不抄一份派生逻辑来测），用真实 `quay.ts serve` 形态进程 + 真实载体 + 真实 HTTP 跑 AC1′–AC7′ 的七向读数（含上面 (a)/(c) 两个负向与 `name == "web"` 的对调控制）
  - 静态面：`no checked-in-tree writes: 48 write-verb call(s) across 1 executed input(s), 0 inside the tree — delta against develop`（夹具只写 per-run 临时目录）

## DoD

- **真落地**：`goals/AC-179-web-card-and-cli.md` 的重锚版**已在本任务分支上**（`5c256084f`），`goals/AC-179-*.md` 的 `criterion` 在 develop 上可见新派生**由 fan-in 落地**（worker 不自己动 develop）—— 本任务 `done` 随 fan-in ff 进 develop 后该条成立。
- `node --experimental-strip-types packages/quay/bin/quay.ts goal check --stale-pass` ⇒ **本 AC 已不在 `failing` 集合**：修订后它落进 `amendedUnverified`（AC-242 的修订语义：旧轮转 verdict 不得再计 fresh）。⚠️ **该命令当前仍 `exit 1`，`failing:[AC-288, AC-289, AC-290]` —— 与本条 AC 无关**，是同一族缺陷在**别的承载体**上未修（见下节）。本 AC 自己那一条已达成 DoD 的实质要求（「本 AC 不再出现在冻结 population 的当前为假集合里」）。
- 台账尾事件：本任务工作树台账的 AC-179 尾事件 = **`pass`**（`bad866ec-…`，2026-09-23T08:28:50.740Z，对**活实例**的真跑）。⚠️ **主检出（生产）台账**的 AC-179 尾事件仍是修订前的 `fail`（08:22:05.887Z）—— 它读的是主检出上的**旧** criterion；change 落到 develop 并经 `syncDevelopToDoc` 之后，goal-driver 的下一轮 rotation 会用新文本重跑并写下新的 pass。⛔ 不伪造那一条：判据文本先到 develop 是它的前提。
- AC1–AC3 的正负两向读数都在任务体里（见 AC1/AC2/AC3 各条的两侧读数与出处标注）。
- 本任务自身 `done` 并随 fan-in 落地（由 driver 完成）。

## 同族缺陷（硬规则 5b 的产物：修完一个实例后，在同一载体里 grep 该原则的其它适用点）

**这条判据的地址派生写法在 `goals/` 里不是孤例 —— 共 17 条，本条只是唯一被立案的那一条。**

- 判据（按位置，解析 frontmatter 后匹配 criterion 内的 `grep -oE -- '--host [^ ]+ --port [0-9]+'`）：命中 **17** 个 `goals/*.md`。
- 前三条：`AC-179`（本条，已修）、`AC-288`（GOAL-024，`status: achieved`，`long-term: false`）、`AC-289`（同上）。
- 分布：`AC-179`（GOAL-001）＋ `AC-288 … AC-303` 共 16 条（全部 GOAL-024，全部 `achieved` ∧ 非 `long-term` ⇒ **全部在冻结 population 里**，会被 `check --stale-pass` 逐轮读到）。
- **它们此刻正在取假**，正是本任务修的那个机制：`check --stale-pass` 的 `failing` = `[AC-288, AC-289, AC-290]`，台账逐字 `CAUSE=en-fetch-failed -- GET http://172.28.0.1:0/dashboard returned nothing (addr=172.28.0.1:0)`（2026-09-23T08:22Z）—— 与 AC-179 修订前的失败**同形同因**。
- 处置：**不在本任务内修**。它们的 `Touches`/作用域不在本节声明内，改它们属越界写（fan-in anti-drift 会硬失败），且各条 `expect`/语义需逐条独立核对（部分条已自带 `case "$a" in 0.0.0.0:*)` 归一化，形态并不完全相同）。⇒ 建议**另立一条任务**：把 `AC-288…AC-303` 的地址派生统一重锚到活载体（机制与本条同），并以 `check --stale-pass` 的 `failing:[]` 为验收面。
