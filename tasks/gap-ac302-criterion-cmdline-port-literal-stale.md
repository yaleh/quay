---
id: gap-ac302-criterion-cmdline-port-literal-stale
title: AC-302 判据从 cmdline 的 `--port` 字面量派生地址，而生产启动器默认已是 `--port 0`（内核分配临时端口）⇒
  /doc 页判据在真实部署上结构性失效（addr=127.0.0.1:0，curl 失败）；/doc 页面机制本身为真（本轮实测四条断言全过）——
  重锚地址派生那一步（照搬 AC-288 已落地的同族形态，同一行）
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

**缺口（立案当轮直接量；`--dry-run` ⛔ 不写台账）**

台账尾事件（`2026-09-23T13:47:35.371Z`，`actor=goal-cli`，`.quay/gate-events.jsonl` 中 `item_id=AC-302` 的最后一条）：

```
{"id":"…","item_id":"AC-302","gate":"goal","actor":"goal-cli","verdict":"fail",
 "timestamp":"2026-09-23T13:47:35.371Z",
 "payload":{"reason":"acceptance failed (exit 1) — CAUSE=en-fetch-failed -- GET
 http://127.0.0.1:0/doc returned nothing (addr=127.0.0.1:0)"}}
```

**本轮把判据原文逐字复跑**（取法 = `node packages/quay/bin/quay.js goal show AC-302 --json` 的 `.criterion` 字段逐字落盘 ⇒ `/tmp/ac302-verbatim.sh`，**3058 bytes / 32 行**，`md5sum` = `4ef435264e85f40b4895fae35edb0685`；⛔ 不是从 goal 文件的 YAML 折叠文本重拼 —— 折叠会把 `head -c 60000` 断成两行，产生与判据真实文本不同的脚本）：

```
$ bash /tmp/ac302-verbatim.sh
CAUSE=en-fetch-failed -- GET http://127.0.0.1:0/doc returned nothing (addr=127.0.0.1:0)
RED_EXIT=1
```

⇒ 与本轮台账尾**同形同值**，证明确为当前红，⛔ 不是陈旧台账尾巴。

**成因不是「机制坏了」—— 是判据派生地址的那一步解析了一个启动器已按设计置 0 的字面量。**

同一进程、同一时刻的三个读数（立案轮实测，⛔ 非转述）：

| 面 | 读数 | 取法 |
|---|---|---|
| 生产实例 | pid `1384111`，cwd = `/data/home/yale/work/quay`，cmdline `node --experimental-strip-types …/quay.ts serve --host 0.0.0.0 --port 0`，`startedAt 2026-09-23T13:45:20.163Z` | `readlink /proc/1384111/cwd` + `tr '\0' ' ' < /proc/1384111/cmdline` |
| 判据按 cmdline 派生的地址 | `127.0.0.1:0` ⇒ `curl -sf --max-time 10` 失败 ⇒ `CAUSE=en-fetch-failed` | criterion 里 `grep -oE -- '--host [^ ]+ --port [0-9]+'` 那一步 |
| 同一进程的**真实**监听地址（活宿主载体） | `name=="web"` ⇒ `0.0.0.0:19071`（另有 `control 127.0.0.1:9081`，**同 pid 不同端口**，取错会打到控制面） | `cat .quay/server.json` |

**为什么不能改成写死 `19071`（硬规则 4 推论二）**：它是内核分配的临时端口，重启即变、换台机器即变，且失效时静默。启动器自己的注释已经钉死了这件事（`plugin/scripts/start-drivers.ts:27` 逐字）：

> `from .quay/server.json (its pid + its web port — the default port is now kernel-assigned, so`

⇒ **载体是端口唯一可知的地方**（`.quay/server.json` 的 `name=="web"` 条目），重锚必须去那里读。⛔ 本任务不逐字转述其源码 —— 正本是 `plugin/scripts/start-drivers.ts` 与 `packages/quay/src/cli/serve.ts`，执行者按盘上**当前**内容读（硬规则 5b）。

**机制本身为真（同一轮，criterion 原文逐字，只把 `addr` 一处换成真实值）**

把 `/tmp/ac302-verbatim.sh` **逐字复制，只把 `addr=""` … `done` 那 358 字节的派生循环删掉、替换为 `addr="127.0.0.1:19071"`**（其余 nav 区块抽取、`<title>` 抽取、四段断言、OK 文本一字不改）⇒ `/tmp/ac302-addrfix.sh`：

```
OK -- /doc: default nav region carries "Docs" and <title>="quay — Docs"; under Cookie:
lang=zh the response is <html lang=zh>, that English nav label is gone from the nav region,
and this page's own <title> became "quay — 文档"
GREEN_EXIT=0
```

| 断言（criterion 自己的 chrome 作用域取法：`tr '\n' ' '` 后 `grep -o '<nav.*</nav>'` / `grep -oE '<title>[^<]*</title>'`） | en | zh |
|---|---|---|
| `<html lang=…>` | `<html lang="en"` | `<html lang="zh"` |
| nav 区块字面量 `Docs`（**条数**，硬规则 3：给条数不给布尔） | **2** | **0** |
| nav 区块字节数 | 2659 | 2654 |
| 本页自己的 `<title>` | `quay — Docs` | `quay — 文档` |
| （判别性对照）整段响应里 `Docs` 残留条数 | **3** | **0** |

⇒ criterion 的四条独立断言臂（en 基线在场、zh 响应 `<html lang="zh">`、zh nav 无 `Docs`、本页 `<title>` 相对 en 变化）**都在活服务上为真**；**fail 只发生在派生地址那一步**，且它以具名 `CAUSE=en-fetch-failed` 报出（硬规则 3b：判据没有伪装成通过）。

**台账指纹：判据文本没变，是它读取的宿主移动了**（硬规则 4b：不用被测对象自报的量判它；`criterionHash` 是判据的指纹）

```
2026-09-23T00:29:16.699Z  goal-sweep  pass  criterionHash f3194bd3d45b7592
2026-09-23T05:31:47.127Z  goal-sweep  pass  criterionHash f3194bd3d45b7592   ← 末次 pass
2026-09-23T08:55:42.369Z  goal-sweep  fail  criterionHash f3194bd3d45b7592   ← 首次红，指纹【未变】
（其后 08:57:38Z / 09:18:34Z / 09:36:23Z 三次 fail，addr 恒为 172.28.0.1:0；
 13:47:35Z 第四次 fail，addr 127.0.0.1:0 —— 该时刻生产实例已是新起的 gen-2）
```

红绿两侧的 `criterionHash` **相同** ⇒ 判据文本没有被改过，改的是它读取的宿主（承载体搬迁）。这是「判据 stale」与「代码回退」最省事的分辨器：**先看这个指纹，不要先去找代码回归。**

⚠️ **同一 AC 的两种红不要混淆**（`CAUSE=` 是分辨器）：`CAUSE=en-fetch-failed … (addr=<host>:0)` 是**本任务**处理的承载体缺陷；`CAUSE=no-running-serve-instance` 意味着**那一刻**没有 cwd = 仓库根的 serve 进程在跑 —— 那是探针设计上的 fail-closed 前提，**不是**本任务的机制，重锚派生那一步不会（也不应）修它。

**为什么更早的修复没兜住这一条（本 AC 上已有一条 done 任务）**

`gap-ac302-doc-page-zh-chrome-nav-current-and-own-title`（**done**，fan-in 翻转提交 `118a92ee7`）**做出了 /doc 页面侧的真实接线**（`packages/quay/src/serve-doc.ts` 的 `handleDocList` 接 `cfg.lang` + `serve-i18n.ts` 的本页 `PAGE_LABELS` 词条），**且它今天仍然成立** —— 上面 `GREEN_EXIT=0` 的读数就是它成立的直接量。它**从未碰过判据**：该任务 Touches 说明逐字写着「`goals/AC-302-*.md` 属人与驱动维护面，⛔ 不在本 Touches」。⇒ 该任务从来不是「页面缺失」，本次红也**不是它回退**；**没有任何任务碰过地址派生这一步**，而这次坏掉的恰是它。

**承载体何时搬的**：`ce0f47518`（2026-09-18，`gap-serve-same-root-admission-lock`，done，提交正文逐字含 `Default port 4173 → 0.`）把 web 端口默认改成**内核分配临时端口**（`--port 0`）。**为什么它 09-18 落码、09-23 才红**：gen-1 实例在码变**之前**就以显式端口起好并一直活着，判据照旧可派生；实例于 `2026-09-23T13:45:20.163Z` 重启出 gen-2（走新默认 `--port 0`）后，下一次判据轮才第一次拿到 `addr=…:0`。⇒ 一次承载体搬迁同时打中**整族**同型判据（本仓库实测：`goal check --stale-pass` 的 failing 含 AC-179、AC-289、AC-291…AC-303）。

**正本块（⛔ 取用，不另造）**：`goals/AC-288-*.md` 的 criterion 已含 `# >>> addr-derivation` … `# <<< addr-derivation` 块（本轮实测该文件该标记 **2 处**；AC-302 的 goal 文件实测 **0 处**），且 AC-288 现判据在活实例上**本轮实测 `exit 0`**（`node packages/quay/bin/quay.js goal gate AC-288 --dry-run --json` ⇒ `verdict:"pass"`，`reason:"acceptance passed (exit 0)"`）。本 AC 的重锚**逐字采用该块**，route/label 声明留在块外（`ROUTE="/doc"` / `LABEL_EN="Docs"` 两行，逐字不变）。

<!-- dedup-ref -->
**去重（按机制，⛔ 不按症状关键词）与可追溯性**：顶层 `goal_ac: AC-302` 的 `grep -rl '^goal_ac: AC-302' tasks/*.md` ⇒ **1 命中**，`gap-ac302-doc-page-zh-chrome-nav-current-and-own-title`，status **done** ⇒ 本 AC 无在飞主，本条不是重复立案，而是「承载体搬迁 ⇒ 判据 stale」这一机制在本 AC 上的实例。同机制、**不同 AC** 的在飞任务共 **15** 条（`ls tasks/gap-ac*-criterion-cmdline-port-literal-stale.md` 实测 = AC-179、AC-288…AC-301；status 除 AC-301 为 `todo` 外全部 `ready`）—— 每条各自重锚**自己那一条** AC 的判据，**互不覆盖**（此族在本仓库是**一 AC 一任务**地排空的）。AC-303 尚无同族任务（`ls tasks/gap-ac303-criterion-cmdline-port-literal-stale.md` ⇒ No such file）。同型先例（承载体搬迁后把判据移到真正承载该角色的地方）：`gap-ac286-fanin-merge-target-criterion-carrier-stale`（done）、`gap-ac157-catalog-carrier-moved-criterion-stale`（done）。引入临时端口默认的 `gap-serve-same-root-admission-lock`（done）改的是**启动器**，从未重锚过任何判据 —— 相关但不同机制。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-302 --dry-run --json` ⇒ `verdict: fail` 且 `addr=<host>:0`；同一时刻 `cat .quay/server.json` 取 `name=="web"` 的端口读数，**两者必须指向同一 pid**。若届时 `CAUSE` 是 `no-running-serve-instance`，**停下核对**：那说明此刻没有 cwd = 仓库根的实例在跑，⛔ 不得当成同一现象处理（见 Proposal 的两种红）。
2. **取正本块，⛔ 不另造**：从 `goals/AC-288-*.md` 抽出 `# >>> addr-derivation` … `# <<< addr-derivation` 块逐字用于 AC-302（正本 reader = `packages/quay/src/server-state.ts` 的 `readServerState` / `ServerServiceEntry` / `pidAlive` / `probeAddress`）；⛔ 不把本机当前端口/主机写成字面量（换台机器或重启即失效；硬规则 4 推论二）。
3. **重锚**：`quay goal write AC-302 --criterion "$(cat <新 criterion 文件>)"` 落库（贴逐字 diff：只有派生块与「为什么改」变化），`expect`、`ROUTE`/`LABEL_EN` 与 chrome 作用域语义逐字不变；⛔ 不得直接 `Edit` goal 文件。
4. **配套夹具** `packages/quay/test/ac302-criterion-address-derivation.test.mjs`（`// @test-group product`，`node:test`）：按 marker 从 `goals/AC-302-*.md` **逐字抽取**派生块（单一正本关系，⛔ 不是逻辑副本），在 `git init` 过的临时 root 里对真实进程与真实载体跑正/负两向（显式端口 / `--port 0` + 载体 / 通配 host 归一化 / 无载体 / 载体 pid 不符 / 无 `web` 条目 / `web.up:false` / 死端口）。**同族夹具 `packages/quay/test/ac288-criterion-address-derivation.test.mjs` 立案当轮实测 ⛔ 仍未落在 develop/author（`ls` ⇒ No such file）** ⇒ 执行前先核对它是否已落地：已落地则**照其形态**写本 AC 的同族文件；未落地则**不得假定其内容**，按本 Plan 的枚举自行写全。
5. **两个负控制**（硬规则 4 推论三：判据必须能取假）：① 无实例 ⇒ 非 0 且以具名成因可区分；② 候选地址指向必然连不上的端口 ⇒ 非 0 且成因与 ① **不同形**。⛔ 不得靠改 `expect` 或放宽断言来「凑绿」。
6. **落账**：`node packages/quay/bin/quay.js goal gate AC-302` ⇒ exit 0，且台账新增一条 `verdict:"pass"`，其 `payload.criterionHash` **≠ 修订前指纹 `f3194bd3d45b7592`**。

⚠️ **运行前提（运维须知，不是可选项）**：本 AC 的判据读**运行中的服务**（`pgrep -f 'quay.ts serve'` × cwd = 仓库根），⛔ 不自己启服务。本任务改的是**地址派生**那一步，页面代码未动 ⇒ **不需要重启 serve 实例**（与页面侧任务的要求相反）；但若实例在此期间被重启，判据必须仍 `exit 0`（AC3 的非字面量性质即测这一点）。立案当轮现场：`pgrep -f 'quay.ts serve'` 命中里只有 **1 个** cwd = 仓库根（pid `1384111`；另 2 个：本次 Bash 包装自身、以及别的用户/仓库 `/data/home/tom/…`）⇒ 重锚后的候选枚举必须仍只认 cwd = 仓库根那一个。

## AC

- [x] **AC1（重锚后判据在活实例上为真）**：`node packages/quay/bin/quay.js goal gate AC-302 --dry-run --json` 在**修订后** `exit 0`，且它实际派生/使用的地址 = **当次**载体里 `web` 服务的真实端口（⛔ 不是 0）。贴：修订前后 criterion 的 md5（**修订前 = `4ef435264e85f40b4895fae35edb0685`**，取法 = `quay goal show AC-302 --json` 的 `.criterion` 字段逐字落盘后 `md5sum`）、派生地址、`GATE_EXIT=`、以及 `curl` 在 `http://<web addr>/doc` 上的 en/zh 两条读数（`<html lang=…>`、nav 区块 `Docs` 条数、本页 `<title>`）。
- [x] **AC2（能取假，两向都贴；⛔ 只贴绿侧不算）**：(a) **无活候选** ⇒ 非 0，且 stderr 的具名 `CAUSE` 与 (b) **不同形**；(b) 候选地址指向必然连不上的端口（例如把载体的 web 端口临时改指一个已关闭端口，或用 cwd = 仓库根但 `--port` 指向死端口的候选）⇒ 非 0，成因含「连接被拒／取不到」。两侧读数都贴。
- [x] **AC3（非字面量；硬规则 4 推论二 + AC3 的检测半边）**：`grep -c "19071\|172\.28\.0\.1" goals/AC-302-*.md` ⇒ **0**（⛔ 不得把本机当前端口/主机写成字面量），并贴出完整输出；**配套动作**：把同一谓词对着一个**已知为真**的样本（如本任务体里的 `127.0.0.1:19071` 串）干跑一次 ⇒ 必须非 0，证明谓词不是恒零（硬规则 2 下半）。
- [x] **AC4（归因；硬规则 3b）**：制造一次真实 fail（用 AC2 任一方向），stderr 必须对**每个**候选给出 `pid` + 派生地址 + 成因；⛔ 候选存在时不得出现 `addr=` 空或无成因的裸失败 —— 「查不成」与「不合格」必须可区分。
- [x] **AC5（作用域与语义不变）**：`expect` 逐字不变、`ROUTE="/doc"` 与 `LABEL_EN="Docs"` 逐字不变、chrome 作用域（只对 `<nav>…</nav>` 与 `<title>` 匹配）逐字不变；修订只经 `quay goal write AC-302 --criterion …` 落库且记录含「为什么改」；修订后**新** criterionHash 至少有一条独立的 `quay goal gate AC-302` 落账。
- [x] **AC6（本仓库自身行为不回退）**：`node --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts` `exit 0`；`node --experimental-strip-types packages/quay/bin/quay.ts goal check --stale-pass` 的 failing 集合不再含 AC-302（贴该集合条数与 AC-302 是否在内；立案当轮基线实测 = **15 条** `[AC-179, AC-289, AC-291…AC-303]`，AC-302 **在内**）。
- [x] **AC7（scoped 门）**：`bash scripts/test.sh --for-task gap-ac302-criterion-cmdline-port-literal-stale --allow-thin` `exit 0`。

## DoD

- **真落地**：`goals/AC-302-*.md` 的重锚版落在 **develop**（`git show develop:goals/AC-302-*.md` 可见 `>>> addr-derivation` 块），且台账尾事件是**新 criterionHash 的 pass**，由**一次对活生产实例的真跑**产出（⛔ 不是夹具、不是 dry-run、不是引用旧 verdict 的轮转）。
- **保证本体重测**：在判据实际使用的那个地址上，`/doc` 的 en 基线（nav 区块 `Docs` 条数 = 2 且本页 `<title>` = `quay — Docs`）与 zh（`<html lang="zh"` ∧ nav 区块 `Docs` = 0 ∧ 本页 `<title>` = `quay — 文档`，不含 ASCII `Docs`）**各由响应体直读**（⛔ 不读 render 函数的返回值当「响应」—— 那测的是函数，不是线上行为）。
- **`node --experimental-strip-types packages/quay/bin/quay.ts goal check --stale-pass` ⇒ `AC-302` 不在 `failing` 内。**
- AC1–AC4 的**正负两向**读数都在任务体或 `.quay/ac302-crit-*` 未跟踪 scratch 里（⛔ 只贴绿侧不算），可被下一轮独立复算。
- **不越界**：AC-179、AC-288…AC-301 与 AC-303 的 criterion 及它们的页面任务不在本任务 Touches 内；若执行者选择一并重锚，必须**先**把对应 `goals/AC-*.md` 加进 Touches 并对每条逐条实测前后读数（⛔ 不得批量改未测量的判据）。
- 本任务自身 `done` 并随 fan-in 落地。

## Evidence

**本轮实测读数（正负两向都在；原始 scratch = `.quay/ac302-crit/`，未跟踪，可被下一轮独立复算）。** 重锚落地提交：worktree `98f1a21d0`（`goals: AC-302 field:criterion`）+ 夹具 `ac0a85046`；主检出 `16d375c85`（同文本，live-probe 判据的两根写入之二 —— 见 AC5）。

### 决策记录：为什么用「探活代」派生块，而不是 Plan 第 2 条字面点名的 AC-288 块

立案时（09-23）`goals/AC-288-*.md` 是该族**唯一**带 `>>> addr-derivation` 标记的文件，故被写作正本。执行时（09-24）该族已分化两代，而 **AC-288 的块仍未落地**（`git ls-tree develop packages/quay/test/` 无 `ac288-*`；`tasks/gap-ac288-…` status 仍 `ready`）：

| 面 | AC-288 的块（gen-1） | 本 AC 采用（gen-2 = `goals/AC-290/292/293/294/295/300/301` 在 **develop** 上的形态，且五个同族夹具已落地） |
|---|---|---|
| 派生后是否**探活**该地址 | ⛔ 否，派生即返回 | ✅ `curl -sf --max-time 10 -o /dev/null "http://$a$ROUTE"`，探通才接受 |
| 「派生不出」vs「派生得出但连不上」 | 只有前者有具名成因 | 两个**不同形**的 `FAIL=`：`no-derivable-serve-address` / `no-reachable-serve-address` |
| 每候选的 `pid`+`addr=`+`cause` | 只在派生失败的 `CANDIDATES:` 一行 | 每条失败路径都发 `AC-302 candidate readings (cwd=… nserve/ncand/nderived …)` |
| 载体 `schemaVersion` 校验 | 无 | `schemaVersion!==1 ⇒ carrier-unreadable` |

采用 gen-2 的判据是**本任务自己的 AC 文本**：**AC2(b)**（载体 web 端口指向已关闭端口 ⇒ 非 0 且成因含「连接被拒」）与 **AC4**（真实 fail 的 stderr 必须对**每个**候选给出 `pid` + 派生地址 + 成因）。gen-1 不探活 ⇒ 其死端口失败只落到判据级裸 `CAUSE=en-fetch-failed`（无 `pid`），AC4 无法在 AC2(b) 的同一次 fail 上满足；Plan 第 4 条枚举的「死端口」用例也只存在于 gen-2；Plan 第 2 条自指的 reader（`packages/quay/src/server-state.ts` 的 `probeAddress`）即探活语义。⇒ 采用该族**已落地**的现行形态，只改 `ROUTE`/`LABEL_EN`/两处 `AC-<NNN> …` printf 串/头部注释里的夹具名，其余逐字。⛔ 未改动 AC-179/AC-288…AC-301/AC-303 的任何判据。

### AC1（重锚后判据在活实例上为真）

| 量 | 读数 | 取法 |
|---|---|---|
| criterion md5 **修订前** | `4ef435264e85f40b4895fae35edb0685`（3058 B / 32 行，本轮逐字复现 = 立案值） | `goal show AC-302 --json` 的 `.criterion` 逐字落盘 → `md5sum` |
| criterion md5 **修订后** | `c15ce67059ecf0db75f9c787013f4647`（8106 B / 90 行） | 同上 |
| 载体当次 web 服务 | `0.0.0.0:10539`，pid `2035152`（`control 127.0.0.1:28733` **同 pid 不同端口** —— 取 `name=="web"`） | `cat .quay/server.json` |
| 判据**实际派生/使用**的地址 | `127.0.0.1:10539`（= 当次载体 web 端口的真实值，⛔ 不是 0；来源 `DERIVED_SRC=carrier`） | `goal gate AC-302 --dry-run --json` ⇒ `verdict:"pass"` / `acceptance passed (exit 0)`；判据自报 `AC-302 serve address derived from carrier as 127.0.0.1:10539` |
| `GATE_EXIT=` | `0`（探针 dry-run 一次 + 真跑一次，均 0） | `goal gate AC-302 [--dry-run]` ; `echo $?` |
| en（无 cookie） | `<html lang="en"` · nav 区块 `Docs` = **2** 条 · nav 区块 2660 B · 本页 `<title>` = `quay — Docs` | `curl -sf http://127.0.0.1:10539/doc` **响应体直读** |
| zh（`Cookie: lang=zh`） | `<html lang="zh"` · nav 区块 `Docs` = **0** 条 · 本页 `<title>` = `quay — 文档`（无 ASCII `Docs`） | 同上 + cookie |
| 判别性对照：整段响应 `Docs` 残留 | en **3** / zh **0** | 同上 |

⇒ 与前一轮承载体红（`addr=127.0.0.1:0` ⇒ curl 失败）对照，**唯一变化是判据文本**，判据所测保证本身未动。

### AC2（能取假，两向都贴）

判据原文**逐字未改**、以 `sh -c "$(cat <shipped criterion>)"` 在 `git init` 过的临时 root 里跑（`cwd == $root` 过滤把生产实例排除在外）；⛔ 未放宽任何断言、未改 `expect`。

| 方向 | 构造 | `EXIT` | stderr 具名成因 |
|---|---|---|---|
| **(a) 无活候选** | 空 temp root，从**文件**跑（runner argv 不含 `quay.ts serve` ⇒ 零候选） | **1** | `CAUSE=no-running-serve-instance -- no quay.ts serve process with cwd=/tmp/ac302-neg-wo6cg5; /doc cannot be evaluated on a live surface (AC-179 probe pattern)` |
| **(b) 候选地址必然连不上** | temp root 内一个真 serve-形进程（argv 定位读 `serve --host 172.28.0.1 --port 0`，`/proc/<pid>/cwd` = 该 root）；载体 `pid` = 该进程、`web.port` = 一个**已关闭**端口（`32939`，bind→取号→close） | **1** | `FAIL=no-reachable-serve-address -- 1 derivable address(es) among 1 quay.ts serve process(es) … none answered /doc (connection refused / timed out / non-2xx)`；候选行含 `cause=derived-from-carrier-fetch-failed(connection-refused) -- curl: (7) Failed to connect to 127.0.0.1 port 32939 …` |

⇒ 两向**异形**：`a-shape = CAUSE=no-running-serve-instance` / `b-shape = FAIL=no-reachable-serve-address`。

### AC3（非字面量 + 谓词非恒零）

```
$ grep -c "19071\|172\.28\.0\.1" goals/AC-302-*.md      ⇒ 0        (exit 1；无 -c 的完整输出也为空，证明确实读了文件)
$ # 配套动作（硬规则 2 下半）：同一谓词对着【已知为真】的样本（本任务体，含 127.0.0.1:19071 / 172.28.0.1）
$ grep -c "19071\|172\.28\.0\.1" tasks/gap-ac302-criterion-cmdline-port-literal-stale.md ⇒ 5  (exit 0)
  前 3 条命中：`:50`（`0.0.0.0:19071`）、`:52`（`19071`）、`:60`（`addr="127.0.0.1:19071"`）
```

⇒ 谓词**不是恒零**（换了会命中的样本就命中），且非空：本机当前 web 端口 `10539` 与立案值 `19071` 都**不在**判据里 —— 端口每次运行重新派生。

### AC4（归因；硬规则 3b）

用 **AC2(b)** 的**同一次**真实 fail（⛔ 不是夹具，是 shipped 判据的真跑）：

```
AC-302 candidate readings (cwd=/tmp/ac302-neg-T338sJ, nserve=1, ncand=2, nderived=1):;
  pid=984978 addr=127.0.0.1:32939 cause=derived-from-carrier-fetch-failed(connection-refused) -- curl: (7) …
  pid=988963 addr=-               cause=argv-no-serve-subcommand,carrier-pid-mismatch
FAIL=no-reachable-serve-address -- …
```

**每个**候选都有 `pid` + 派生地址（真值，或 `addr=-`）+ 成因 ⇒ 「查不成」与「不合格」不同形；`grep -cE 'addr=( |;|$)'` 于该 stderr = **0**（无 `addr=` 空的裸失败）。第二行是 acceptance runner 自己的 `sh -c`（argv 带判据全文）—— 它必须被归因而**不得**抹掉另一个候选的地址（夹具 ⑤ 也钉了这一点）。

### AC5（作用域与语义不变；修订只经 goal write）

- `expect` / `origin` / `title` / `status` / `kind` / `goal` / `activatedAt` / `statusLog` 逐字**未变**（`goal show --json` 前后字段 `JSON.stringify` 相等，实测 8/8 SAME + statusLog SAME）。
- `ROUTE="/doc"` 与 `LABEL_EN="Docs"` 逐字未变（各 1 处，位于派生块内 —— 该族已落地形态即如此）；chrome 作用域逐字未变：`'<nav.*</nav>'`（2 处 = en/zh）、`'<title>[^<]*</title>'`（1 处）；11 条既有 `CAUSE=` 分支**一条未少**（夹具 ⑤ 钉住）。
- 修订**只**经 `quay goal write AC-302 --criterion "$(cat …)"`（⛔ 未 `Edit` goal 文件）：worktree 提交 `98f1a21d0`、主检出提交 `16d375c85`，**两根文件 md5 均为 `cf5f27d7d034147e7322db0a80750509`**（逐字相同 ⇒ 不会分叉）。「为什么改」经 `--reason` 传入并以本 `## Evidence` 节为持久记录。
- **新 criterionHash 落账**：`.quay/gate-events.jsonl` 中 `item_id=AC-302` 的
  `2026-09-23T16:54:37.352Z  goal-amend  pass  criterionHash=f599ea0b7fd38446`
  ≠ 修订前 `f3194bd3d45b7592`（该事件由 `goal check --stale-pass --sweep --budget 1` 的 amendment-priority 对活实例真跑产出）。
  紧随其前的 `2026-09-23T16:54:21.082Z goal-cli pass` 是 `goal gate AC-302` 的 pass（⛔ `gate` 事件按机制**不带** `criterionHash`，见 `goal-store.ts` 的 `case "gate"`）。最后一次独立 `goal gate AC-302` = `2026-09-23T16:57:31.690Z goal-cli pass`（也是活实例真跑；台账尾事件是 pass）。

### AC6（本仓库自身行为不回退）

- `node --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts` ⇒ `PASS: criterion failure attribution intact: inDomain=155 bareAcs=0 ≤ baseline 0 (bareLines=0)`，`EXIT=0`（worktree 与主检出各跑一次，同读数）。
- `node --experimental-strip-types packages/quay/bin/quay.ts goal check --stale-pass` ⇒ `EXIT=1`（被别的 AC 拉红），`frozenScope=119`，**`failing = ["AC-179"]`（1 条）**，`AC-302 in failing? -> false`，`notEvaluated=[]`，`staleUnverified=[]`。立案基线 = **15 条**（`[AC-179, AC-289, AC-291…AC-303]`，AC-302 **在内**）⇒ 该族已被逐条排空到 1 条，AC-302 **不在**。

### AC7（scoped 门）

`bash <worktree>/scripts/test.sh --for-task gap-ac302-criterion-cmdline-port-literal-stale --allow-thin` ⇒ `SCOPED_GATE_EXIT=0`（夹具 `ac302-criterion-address-derivation.test.mjs` 15/15 pass）。前置：`git merge --no-edit develop` 干净（`HEAD..develop` = 0），run 后 `--write-scoped-gate-cache --develop-sha fb829d11e614d83f447b81ddbf48d98d09b888b0` 已写入 `.quay/scoped-gate-cache.json`。

### 夹具（Plan 第 4 条；`packages/quay/test/ac302-criterion-address-derivation.test.mjs`，`// @test-group product`）

按 marker 从 `goals/AC-302-*.md` **逐字抽取**派生块（单一正本关系，⛔ 不是逻辑副本）后在 `sh` 下驱动：正/负两向共 15 例 —— 显式 `--port≥1` 探活后才接受、`0.0.0.0`→loopback 归一化（argv 与载体两处）、`--port 0` + 载体（且**不得**取同 pid 的 `control` 端口）、runner 自身 shell 被归因 `addr=-` 且不抹掉真地址、无载体 / 载体 pid 不符 / 无 `web` 条目 / `web.up:false` / 非 schemaVersion-1 载体 / 派生得出但连不上 / 完全无 serve 进程，另钉 11 条 `CAUSE=` 分支与「判据里没有 host:port 字面量」+ 其正控制。同族 `ac288-…` 夹具立案当轮实测**未落地**（至今仍未：`git ls-tree develop packages/quay/test/` 无之）⇒ 按 Plan 要求**照已落地的同族形态**（`ac289/290/296/299/300`）自行写全，未假定其内容。

### 未做（明确划界）

- ⛔ 未碰 AC-179 / AC-288…AC-301 / AC-303 的判据或页面任务（Touches 外）。
- ⛔ 未 pkill/重启 serve 实例（本任务只改地址派生，页面代码未动）；实例若在此期间重启，判据仍取新载体端口 ⇒ 仍 `exit 0`（这正是 AC3 的非字面量性质所测）。
- ⛔ `packages/quay/src/serve-doc.ts` / `serve-i18n.ts` 未动（该 AC 的 done 任务已修好，本轮 `GREEN_EXIT=0` 即其成立直接量）。

## Touches

- goals/AC-302-doc-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- packages/quay/test/ac302-criterion-address-derivation.test.mjs (new)
- tasks/gap-ac302-criterion-cmdline-port-literal-stale.md

（说明：第一条是本任务的落地面 —— criterion 的地址派生那一步，经 `quay goal write AC-302 --criterion …` 落库，`expect` 与 chrome 作用域语义逐字不变、只补「为什么改」；第二条是配套夹具（按 marker 从 goal 文件逐字抽取派生块，与 `packages/quay/test/ac288-criterion-address-derivation.test.mjs` 同族、页面各一）；第三条是 self-touch。⛔ 不新增 `plugin/scripts/*.ts` —— 派生助手若要抽出，默认放 `packages/quay/src/`；若最终落在 `plugin/scripts/`，必须同时把 outline、`plugin/scripts/capability-catalog-declarations.json` 与本任务 Touches 一并更新。⛔ `packages/quay/src/serve-doc.ts` / `serve-i18n.ts` **不在本 Touches 内** —— 它们已被本 AC 的 done 任务修好且本轮实测为真。）