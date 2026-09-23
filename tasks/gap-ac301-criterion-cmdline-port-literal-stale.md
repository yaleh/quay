---
id: gap-ac301-criterion-cmdline-port-literal-stale
title: AC-301 判据从 cmdline 的 `--port` 字面量派生地址，而生产启动器默认已是 `--port 0`（内核分配临时端口）⇒
  /goal 页判据在真实部署上结构性失效（addr=127.0.0.1:0，curl 失败）；/goal 页面机制本身为真（本轮实测四条断言全过）——
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
goal_ac: AC-301
---
**type:** execution

## Proposal

**缺口（立案当轮直接量；`--dry-run` ⛔ 不写台账）**

台账尾事件（`2026-09-23T13:47:34.837Z`，`actor=goal-cli`，`.quay/gate-events.jsonl` 中 `item_id=AC-301` 的最后一条）：

```
{"id":"95e7b7b8-…","item_id":"AC-301","gate":"goal","actor":"goal-cli","verdict":"fail",
 "timestamp":"2026-09-23T13:47:34.837Z",
 "payload":{"reason":"acceptance failed (exit 1) — CAUSE=en-fetch-failed -- GET
 http://127.0.0.1:0/goal returned nothing (addr=127.0.0.1:0)"}}
```

**本轮把判据原文逐字复跑**（取法 = `node packages/quay/bin/quay.js goal show AC-301 --json` 的 `.criterion` 字段逐字落盘 ⇒ `/tmp/ac301-verbatim.sh`，**3060 bytes / 31 行**，`md5sum` = `7054e32807e72293c44c6c306e90ce5b`；⛔ 不是从 goal 文件的 YAML 折叠文本重拼 —— 折叠会把 `head -c 60000` 断成两行，产生与判据真实文本不同的脚本）：

```
$ bash /tmp/ac301-verbatim.sh
CAUSE=en-fetch-failed -- GET http://127.0.0.1:0/goal returned nothing (addr=127.0.0.1:0)
RED_EXIT=1
```

⇒ 与本轮台账尾**同形同值**，证明确为当前红，⛔ 不是陈旧台账尾巴。

**成因不是「机制坏了」—— 是判据派生地址的那一步解析了一个启动器已按设计置 0 的字面量。**

同一进程、同一时刻的三个读数（立案轮实测，⛔ 非转述）：

| 面 | 读数 | 取法 |
|---|---|---|
| 生产实例 | pid `1384111`，cwd = `/data/home/yale/work/quay`，cmdline `node --experimental-strip-types packages/quay/bin/quay.ts serve --host 0.0.0.0 --port 0`，`startedAt 2026-09-23T13:45:20.163Z` | `readlink /proc/1384111/cwd` + `tr '\0' ' ' < /proc/1384111/cmdline` |
| 判据按 cmdline 派生的地址 | `127.0.0.1:0` ⇒ `curl -sf --max-time 10` 失败 ⇒ `CAUSE=en-fetch-failed` | criterion 里 `grep -oE -- '--host [^ ]+ --port [0-9]+'` 那一步 |
| 同一进程的**真实**监听地址（活宿主载体） | `name=="web"` ⇒ `0.0.0.0:19071`（另有 `control 127.0.0.1:9081`，**同 pid 不同端口**，取错会打到控制面） | `cat .quay/server.json` |

**为什么不能改成写死 `19071`（硬规则 4 推论二）**：它是内核分配的临时端口，重启即变、换台机器即变，且失效时静默。启动器自己的注释已经钉死了这件事（`plugin/scripts/start-drivers.ts:27` 逐字）：

> `from .quay/server.json (its pid + its web port — the default port is now kernel-assigned, so …`

⇒ **载体是端口唯一可知的地方**（`.quay/server.json` 的 `name=="web"` 条目），重锚必须去那里读。⛔ 本任务不逐字转述其源码 —— 正本是 `plugin/scripts/start-drivers.ts` 与 `packages/quay/src/cli/server.ts`，执行者按盘上**当前**内容读（硬规则 5b）。

**机制本身为真（同一轮，criterion 原文逐字，只把 `addr` 一处换成真实值）**

把 `/tmp/ac301-verbatim.sh` **逐字复制，只把 `addr=""` … `done` 那 357 字节的派生循环删掉、替换为 `addr="127.0.0.1:19071"`**（其余 nav 区块抽取、`<title>` 抽取、四段断言、OK 文本一字不改）⇒ `/tmp/ac301-addrfix.sh`：

```
OK -- /goal: default nav region carries "Goals" and <title>="quay — Goals"; under Cookie:
lang=zh the response is <html lang=zh>, that English nav label is gone from the nav region,
and this page's own <title> became "quay — 目标"
GREEN_EXIT=0
```

| 断言（criterion 自己的 chrome 作用域取法：`tr '\n' ' '` 后 `grep -o '<nav.*</nav>'` / `grep -oE '<title>[^<]*</title>'`） | en | zh |
|---|---|---|
| `<html lang=…>` | `<html lang="en"` | `<html lang="zh"` |
| nav 区块字面量 `Goals`（**条数**，硬规则 3：给条数不给布尔） | **2** | **0** |
| nav 区块字节数 | 2657 | 2652 |
| 本页自己的 `<title>` | `quay — Goals` | `quay — 目标` |
| （判别性对照）整段响应里 `Goals` 残留 | **5** | **0** |

⇒ criterion 的四条独立断言臂（en 基线在场、zh 响应 `<html lang="zh">`、zh nav 无 `Goals`、本页 `<title>` 相对 en 变化）**都在活服务上为真**；**fail 只发生在派生地址那一步**，且它以具名 `CAUSE=en-fetch-failed` 报出（硬规则 3b：判据没有伪装成通过）。

**台账指纹：判据文本没变，是它读取的宿主移动了**（硬规则 4b：不用被测对象自报的量判它；`criterionHash` 是判据的指纹）

```
2026-09-22T13:25:44.143Z  goal-sweep  pass  criterionHash 880b8f579220abfb   ← gen-1 实例（cmdline 有可解析的 --port）
2026-09-22T17:25:37.596Z  goal-sweep  pass  criterionHash 880b8f579220abfb
2026-09-22T20:38:13.117Z  goal-sweep  pass  criterionHash 880b8f579220abfb
2026-09-23T00:29:16.532Z  goal-sweep  pass  criterionHash 880b8f579220abfb
2026-09-23T05:31:46.990Z  goal-sweep  pass  criterionHash 880b8f579220abfb
2026-09-23T08:42:34.660Z  goal-sweep  fail  criterionHash 880b8f579220abfb   ← 首次红，指纹【未变】
（其后 09:18:33Z / 09:36:23Z / 13:47:34Z 三次 fail，addr 恒为 host:0）
```

红绿两侧的 `criterionHash` **相同** ⇒ 判据文本没有被改过，改的是它读取的宿主（承载体搬迁）。这是「判据 stale」与「代码回退」最省事的分辨器：**先看这个指纹，不要先去找代码回归。**

⚠️ **同一 AC 的两种红不要混淆**（`CAUSE=` 是分辨器）：`CAUSE=en-fetch-failed … (addr=<host>:0)` 是**本任务**处理的承载体缺陷；`CAUSE=no-running-serve-instance` 意味着**那一刻**没有 cwd = 仓库根的 serve 进程在跑 —— 那是探针设计上的 fail-closed 前提，**不是**本任务的机制，重锚派生那一步不会（也不应）修它。

**为什么更早的修复没兜住这一条（本 AC 上已有一条 done 任务）**

`gap-ac301-goal-page-zh-chrome-nav-current-and-own-title`（**done**，实现提交 `f58ad13d1`，develop 侧 `f2f7968d7`）**做出了 /goal 页面侧的真实接线**（`serve-goal.ts` 的 `handleGoalList` 接 `cfg.lang` + `serve-i18n.ts` 的 `PAGE_LABELS` 两条本页词条 `Goals` / `goals`），**且它今天仍然成立** —— 上面 `GREEN_EXIT=0` 的读数就是它成立的直接量。它**从未碰过判据**：该任务正文逐字写着两处排除（AC4：⛔「明令禁止」的三种「凑绿」之一即「改判据（`goals/AC-301-*.md` ⛔ 不在本 Touches 内）」；Touches 说明：「`goals/AC-301-*.md` 属人与驱动维护面，⛔ 不在本 Touches」）。⇒ 该任务从来不是「页面缺失」，本次红也**不是它回退**；**没有任何任务碰过地址派生这一步**，而这次坏掉的恰是它。

**承载体何时搬的**：`ce0f47518`（2026-09-18，`gap-serve-same-root-admission-lock`，done，标题逐字 `same-root admission lock + ephemeral default port + host-owned serve verdict`）把 web 端口默认改成**内核分配临时端口**（`--port 0`）。**为什么它 09-18 落码、09-23 才红**：gen-1 实例在码变**之前**就以显式端口起好并一直活着，判据照旧可派生；实例重启出 gen-2（走新默认 `--port 0`）后，下一次判据轮才第一次拿到 `addr=…:0`。⇒ 一次承载体搬迁同时打中**整族**同型判据（本仓库实测：AC-179 + AC-288 + AC-289…AC-301）。

**正本块（⛔ 取用，不另造）**：`goals/AC-288-*.md` 的 criterion 已含 `# >>> addr-derivation` … `# <<< addr-derivation` 块（本轮实测该文件该标记 **2 处**；AC-301 的 goal 文件实测 **0 处**），且 AC-288 现判据在活实例上**本轮实测 `exit 0`**（`node packages/quay/bin/quay.js goal gate AC-288 --dry-run --json` ⇒ `verdict:"pass"`，`GATE_EXIT=0`）。本 AC 的重锚**逐字采用该块**，route/label 声明留在块外（`ROUTE="/goal"` / `LABEL_EN="Goals"` 两行，逐字不变）。

<!-- dedup-ref -->
**去重（按机制，⛔ 不按症状关键词）与可追溯性**：顶层 `goal_ac: AC-301` 的 `grep -rl '^goal_ac: AC-301' tasks/*.md` ⇒ **1 命中**，`gap-ac301-goal-page-zh-chrome-nav-current-and-own-title`，status **done** ⇒ 本 AC 无在飞主，本条不是重复立案，而是「承载体搬迁 ⇒ 判据 stale」这一机制在本 AC 上的实例。同机制、**不同 AC** 的在飞任务共 **14** 条（`grep` 实测 `tasks/gap-ac*-criterion-cmdline-port-literal-stale.md` = AC-179、AC-288…AC-300，**全部 status `ready`**）—— 每条各自重锚**自己那一条** AC 的判据，**互不覆盖**（此族在本仓库是**一 AC 一任务**地排空的；`gap-ac300-criterion-cmdline-port-literal-stale` 的任务体逐字写着「AC-179、AC-288…AC-299 与 **AC-301…AC-303** 的 criterion 及它们的页面任务不在本任务 Touches 内；若执行者选择一并重锚，必须先把对应 `goals/AC-*.md` 加进 Touches 并对每条逐条实测前后读数（⛔ 不得批量改未测量的判据）」）。同型先例（承载体搬迁后把判据移到真正承载该角色的地方）：`gap-ac286-fanin-merge-target-criterion-carrier-stale`（done）、`gap-ac157-catalog-carrier-moved-criterion-stale`（done）。引入临时端口默认的 `gap-serve-same-root-admission-lock`（done）改的是**启动器**，从未重锚过任何判据 —— 相关但不同机制。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-301 --dry-run --json` ⇒ `verdict: fail` 且 `addr=<host>:0`；同一时刻 `cat .quay/server.json` 取 `name=="web"` 的端口读数，**两者必须指向同一 pid**。若届时 `CAUSE` 是 `no-running-serve-instance`，**停下核对**：那说明此刻没有 cwd = 仓库根的实例在跑，⛔ 不得当成同一现象处理（见 Proposal 的两种红）。
2. **取正本块，⛔ 不另造**：从 `goals/AC-288-*.md` 抽出 `# >>> addr-derivation` … `# <<< addr-derivation` 块逐字用于 AC-301（正本 reader = `packages/quay/src/server-state.ts` 的 `readServerState` / `ServerServiceEntry` / `pidAlive` / `probeAddress`）；⛔ 不把本机当前端口/主机写成字面量（换台机器或重启即失效；硬规则 4 推论二）。
3. **重锚**：`quay goal write AC-301 --criterion "$(cat <新 criterion 文件>)"` 落库（贴逐字 diff：只有派生块与「为什么改」变化），`expect`、`ROUTE`/`LABEL_EN` 与 chrome 作用域语义逐字不变；⛔ 不得直接 `Edit` goal 文件。
4. **配套夹具** `packages/quay/test/ac301-criterion-address-derivation.test.mjs`（`// @test-group product`，`node:test`）：按 marker 从 `goals/AC-301-*.md` **逐字抽取**派生块（单一正本关系，⛔ 不是逻辑副本），在 `git init` 过的临时 root 里对真实进程与真实载体跑正/负两向（显式端口 / `--port 0` + 载体 / 通配 host 归一化 / 无载体 / 载体 pid 不符 / 无 `web` 条目 / `web.up:false` / 死端口）。**同族夹具 `packages/quay/test/ac288-criterion-address-derivation.test.mjs` 立案当轮实测 ⛔ 仍未落在 develop/author（`ls` ⇒ No such file）** ⇒ 执行前先核对它是否已落地：已落地则**照其形态**写本 AC 的同族文件；未落地则**不得假定其内容**，按本 Plan 的枚举自行写全。
5. **两个负控制**（硬规则 4 推论三：判据必须能取假）：① 无实例 ⇒ 非 0 且以具名成因可区分；② 候选地址指向必然连不上的端口 ⇒ 非 0 且成因与 ① **不同形**。⛔ 不得靠改 `expect` 或放宽断言来「凑绿」。
6. **落账**：`node packages/quay/bin/quay.js goal gate AC-301` ⇒ exit 0，且台账新增一条 `verdict:"pass"`，其 `payload.criterionHash` **≠ 修订前指纹 `880b8f579220abfb`**。

⚠️ **运行前提（运维须知，不是可选项）**：本 AC 的判据读**运行中的服务**（`pgrep -f 'quay.ts serve'` × cwd = 仓库根），⛔ 不自己启服务。本任务改的是**地址派生**那一步，页面代码未动 ⇒ **不需要重启 serve 实例**（与页面侧任务的要求相反）；但若实例在此期间被重启，判据必须仍 `exit 0`（AC3 的非字面量性质即测这一点）。立案当轮现场：`pgrep -f 'quay.ts serve'` 命中里只有 **1 个** cwd = 仓库根（pid `1384111`；另 1 个是本次 Bash 包装自身、1 个属别的用户/仓库 `/data/home/tom/…`）⇒ 重锚后的候选枚举必须仍只认 cwd = 仓库根那一个。

## AC

- [ ] **AC1（重锚后判据在活实例上为真）**：`node packages/quay/bin/quay.js goal gate AC-301 --dry-run --json` 在**修订后** `exit 0`，且它实际派生/使用的地址 = **当次**载体里 `web` 服务的真实端口（⛔ 不是 0）。贴：修订前后 criterion 的 md5（**修订前 = `7054e32807e72293c44c6c306e90ce5b`**，取法 = `quay goal show AC-301 --json` 的 `.criterion` 字段逐字落盘后 `md5sum`）、派生地址、`GATE_EXIT=`、以及 `curl` 在 `http://<web addr>/goal` 上的 en/zh 两条读数（`<html lang=…>`、nav 区块 `Goals` 条数、本页 `<title>`）。
- [ ] **AC2（能取假，两向都贴；⛔ 只贴绿侧不算）**：(a) **无活候选** ⇒ 非 0，且 stderr 的具名 `CAUSE` 与 (b) **不同形**；(b) 候选地址指向必然连不上的端口（例如把载体的 web 端口临时改指一个已关闭端口，或用 cwd = 仓库根但 `--port` 指向死端口的候选）⇒ 非 0，成因含「连接被拒／取不到」。两侧读数都贴。
- [ ] **AC3（非字面量；硬规则 4 推论二 + AC3 的检测半边）**：`grep -c "19071\|172\.28\.0\.1" goals/AC-301-*.md` ⇒ **0**（⛔ 不得把本机当前端口/主机写成字面量），并贴出完整输出；**配套动作**：把同一谓词对着一个**已知为真**的样本（如本任务体里的 `127.0.0.1:19071` 串）干跑一次 ⇒ 必须非 0，证明谓词不是恒零（硬规则 2 下半）。
- [ ] **AC4（归因；硬规则 3b）**：制造一次真实 fail（用 AC2 任一方向），stderr 必须对**每个**候选给出 `pid` + 派生地址 + 成因；⛔ 候选存在时不得出现 `addr=` 空或无成因的裸失败 —— 「查不成」与「不合格」必须可区分。
- [ ] **AC5（作用域与语义不变）**：`expect` 逐字不变、`ROUTE="/goal"` 与 `LABEL_EN="Goals"` 逐字不变、chrome 作用域（只对 `<nav>…</nav>` 与 `<title>` 匹配）逐字不变；修订只经 `quay goal write AC-301 --criterion …` 落库且记录含「为什么改」；修订后**新** criterionHash 至少有一条独立的 `quay goal gate AC-301` 落账。
- [ ] **AC6（本仓库自身行为不回退）**：`node --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts` `exit 0`；`node --experimental-strip-types packages/quay/bin/quay.ts goal check --stale-pass` 的 failing 集合不再含 AC-301（贴该集合条数与 AC-301 是否在内）。
- [ ] **AC7（scoped 门）**：`bash scripts/test.sh --for-task gap-ac301-criterion-cmdline-port-literal-stale --allow-thin` `exit 0`。

## DoD

- **真落地**：`goals/AC-301-*.md` 的重锚版落在 **develop**（`git show develop:goals/AC-301-*.md` 可见 `>>> addr-derivation` 块），且台账尾事件是**新 criterionHash 的 pass**，由**一次对活生产实例的真跑**产出（⛔ 不是夹具、不是 dry-run、不是引用旧 verdict 的轮转）。
- **保证本体重测**：在判据实际使用的那个地址上，`/goal` 的 en 基线（nav 区块 `Goals` 条数 = 2 且本页 `<title>` = `quay — Goals`）与 zh（`<html lang="zh"` ∧ nav 区块 `Goals` = 0 ∧ 本页 `<title>` = `quay — 目标`，不含 ASCII `Goals`）**各由响应体直读**（⛔ 不读 render 函数的返回值当「响应」—— 那测的是函数，不是线上行为）。
- **`node --experimental-strip-types packages/quay/bin/quay.ts goal check --stale-pass` ⇒ `exit 0`，`AC-301` 不在 `failing` 内。**
- AC1–AC4 的**正负两向**读数都在任务体或 `.quay/ac301-crit-*` 未跟踪 scratch 里（⛔ 只贴绿侧不算），可被下一轮独立复算。
- **不越界**：AC-179、AC-288…AC-300 与 AC-302、AC-303 的 criterion 及它们的页面任务不在本任务 Touches 内；若执行者选择一并重锚，必须**先**把对应 `goals/AC-*.md` 加进 Touches 并对每条逐条实测前后读数（⛔ 不得批量改未测量的判据）。
- 本任务自身 `done` 并随 fan-in 落地。

## Touches

- goals/AC-301-goal-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- packages/quay/test/ac301-criterion-address-derivation.test.mjs (new)
- tasks/gap-ac301-criterion-cmdline-port-literal-stale.md

（说明：第一条是本任务的落地面 —— criterion 的地址派生那一步，经 `quay goal write AC-301 --criterion …` 落库，`expect` 与 chrome 作用域语义逐字不变、只补「为什么改」；第二条是配套夹具（按 marker 从 goal 文件逐字抽取派生块，与 `packages/quay/test/ac288-criterion-address-derivation.test.mjs` 同族、页面各一）；第三条是 self-touch。⛔ 不新增 `plugin/scripts/*.ts` —— 派生助手若要抽出，默认放 `packages/quay/src/`；若最终落在 `plugin/scripts/`，必须同时把 outline、`plugin/scripts/capability-catalog-declarations.json` 与本任务 Touches 一并更新。⛔ `packages/quay/src/serve-goal.ts` / `serve-i18n.ts` **不在本 Touches 内** —— 它们已被本 AC 的 done 任务修好且本轮实测为真。）