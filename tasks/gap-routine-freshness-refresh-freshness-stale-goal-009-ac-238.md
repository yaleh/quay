---
id: gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238
title: "freshness-refresh: ALREADY past the window: d=228 > K=200, newest
  evidence 2026-09-19T11:06:09Z (build_sha fa1cae202e02); no carrier record
  since 2026-09-20T13:50:36Z, so this face"
status: done
labels:
  - gap
  - routine-filed
  - freshness-refresh
parent: null
children: []
extra: {}
---
## Finding
ALREADY past the window: d=228 > K=200, newest evidence 2026-09-19T11:06:09Z (build_sha fa1cae202e02); no carrier record since 2026-09-20T13:50:36Z, so this face has aged 28 commits beyond the limit.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1790303081218` · ts `2026-09-25T02:24:41.218Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`upgrade-face`
- 涉及文件：
- `plugin/scripts/develop-deliver-tgz.sh`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `.quay/productization-verification.jsonl`
- `.quay/goal-freshness-margin.json`
- `plugin/freshness-producers.json`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run upgrade-face on a host authorized to B (this host is NOT: ssh BatchMode rc=255), only after on-the-spot disk headroom is confirmed on B, and with --upgrade-source pointed at the aged copy work/meta-cc-aged-ac238-copy

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-stale-goal-009-ac-238`（routine `freshness-refresh`，runId `freshness-refresh-1790303081218`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置 = 【复核为真（①）+ 真跑了产出者并按位置定位失败步（②）+ 把「失败在哪一步」从人肉变机械（③）+ 把新测到的回归读数登记进 mapping（④）】。**
⛔ 不是「已注意到」；也⛔ **不是「已修掉」** —— 本主体（AC-238/239 的载体证据）在本任务结束时**仍是 `fa1cae20` / margin −28**：刷新它必须从一台【已被 B 授权】的主机跑，本机不是。

### ① finding 复核为真（判据本体独立重跑，⛔ 不采信 finding 自报值）

抽出器（`createRequire` 加载本仓 `yaml`，取 `goals/AC-214-*.md` frontmatter 的 `criterion` 原样交 `bash -c`，cwd=`/data/home/yale/work/quay`）：

```
node <extractor>.mjs /data/home/yale/work/quay > criterion.txt
bash -c "$(cat criterion.txt)"     ⇒ EXIT=1
```

stdout 七行逐字：

```
freshness GOAL-009-AC-201: 180/200 (margin 20)
freshness GOAL-009-AC-232: 180/200 (margin 20)
freshness GOAL-009-AC-205: 180/200 (margin 20)
freshness GOAL-009-AC-207: 180/200 (margin 20)
freshness GOAL-009-AC-203: 180/200 (margin 20)
freshness GOAL-009-AC-238: 228/200 (margin -28)   ← 本 finding 的主体
freshness GOAL-009-AC-239: 228/200 (margin -28)
```

stderr 逐字：`stale evidence: GOAL-009-AC-238:228/200 (margin -28), GOAL-009-AC-239:228/200 (margin -28)`。

**独立重算**（⛔ 不读快照自报值）：载体里 AC-238 最新记录 = `build_sha fa1cae202e02138a983f4118d108aa9fdd73917a` / `ts 2026-09-19T11:06:09Z`（与 finding 自报逐字相同）；交付面路径集按判据同一规则机械推导（`packages/quay/package.json` 的 `files` ∩ exists + `plugin` + `packages/quay-native/src`，⛔ 不手写清单）⇒ `git rev-list --count fa1cae202e02..develop -- <paths>` = **228**（develop tip `0f2fa40b700e`）⇒ `margin = 200 − 228 = −28`。sha / d / margin 三个量与 finding 自报**逐字一致**。

### ② 失败在哪一步：真跑了产出者（派发链的动作），按位置定位

本任务**真跑了** mapping 登记的那条命令（⛔ 不是引述）：
`bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade --upgrade-source work/meta-cc-aged-ac238-copy --ac239-e2e --hosts B --force --root /data/home/yale/work/quay`

- **2026-09-25T02:32:01Z 跑 1（改前）**：`rc=1`、**9.9s**，死在 `ship_verify_closure` 的第一条 scp（`develop-deliver-tgz.sh:517`），逐字：
  `develop-deliver: orangevps.wan.hwang.men — closure scp FAILED (flat set: verify-deliver-coldstart.sh + $SCRIPT_DIR siblings + SPEC)`
  —— **成因不在日志里**。
- 带外一条命令才给出成因（这也正是 `plugin/freshness-producers.json` 0 号前置 2026-09-24 记的那次动作）：
  `ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men 'df -h /'` ⇒ 逐字 `yale@orangevps.wan.hwang.men: Permission denied (publickey,password).`、`rc=255`。
  **第三种形态的负控制**（⛔ 别读成网络故障）：短别名 `ssh orangevps 'df -h /'` ⇒ `ssh: Could not resolve hostname orangevps: Temporary failure in name resolution`（本机无 `~/.ssh/config`）。
- **载体机械核对（fail-closed 未破）**：跑前跑后 `.quay/productization-verification.jsonl` = `md5 3617e696d0d374bc140d0938c106b9a1` / **291 行**，逐字相同 ⇒ **零追加**（远端 ⑦ 无从谈起 ⇒ 不写任何记录，⛔ 与『合格』不同形）。

⇒ **失败步 = ssh 传输腿（`ship_verify_closure` 的 flat-set scp）**，⛔ 不是工具链 / 交付物 / aged-source / 远端磁盘。0 号（ssh 授权）与 1 号（远端磁盘）两条前置都排在 ⑦ 之前，而本机连第一步都过不去。

### ③ 本任务的可修半边：让「成因」从运行日志本身可读（判据能取假）

⛔ 本主体刷新不了；但**「失败在哪一步」此前只能靠人事后手跑一条带外 ssh 才定名** —— 那是硬的、可修的一处。改：15 条 ssh/scp 腿一律 `transport_detail="$(… 2>&1)"`，失败行尾追加 `⇒ <成因>`（commit `67a1e3cb5`）。

| 读数 | 改前 | 改后 |
|---|---|---|
| 失败行逐字 | `closure scp FAILED (flat set: …)` | `closure scp FAILED (flat set: …) ⇒ yale@orangevps.wan.hwang.men: Permission denied (publickey,password).` |
| 退出码 / 耗时 | rc=1 / 9.9s | rc=1 / 10.0s（同一条 ssh 腿，⛔ 未改变判定面） |
| 载体 md5 | `3617e696…`（291 行） | 同（**零追加**） |

**负控制（该改动的开火面能取假 —— 硬规则 3b：⛔ 不是恒开火）**：`PATH=<fakebin>:$PATH`（假 `ssh`/`scp` 均 exit 0）跑同一条命令 ⇒ 两条传输腿**都不再报 FAILED**，执行**前进**到远端判定并落 `NOT-EVALUATED (remote produced no evidence path)` ⇒ 传输成功路径不误报。

**15 处一并对齐（硬规则 5b：成簇，⛔ 不是只修被观测到的那一条）**：`grep -c '\(ssh\|scp\) .*> */dev/null 2>&1'` = **0**（改前 15）；前 3 条 `:517`(flat scp) / `:525`(mkdir ssh) / `:1656`(evidence scp-back)。
**行数中性**：`git diff --numstat` = `31 31`，文件 3047 行不变 ⇒ `sh-census-check` 棘轮 `embeddedInterpreterLines` **7687 = 基线 7687**（`ok:true, over:[]`）⇒ mapping 里按位置引用的 `:183`/`:1402`/`:1751` **全不漂移**（核过：`ssh_opts=` 仍在 :183、`host_target[B]=` 仍在 :1402、`AC239_POLL_SECS` 仍在 :1751）。
**回归面**：`bash -n` OK；`--selfcheck-transport-closure` / `--selfcheck-worker-preflight` / `--selfcheck-upgrade-pairing` 三枚自检 rc=0；`plugin/test/develop-deliver-tgz{,-evidence-transport,-characterization}.test.mjs` 在 `LC_ALL=C`（= `scripts/test.sh` 钉住的 locale）下 **34 pass / 0 fail**。⚠️ 直接跑不加 `LC_ALL=C` 时 `⑥ shipped-set closure` 会红 —— 那是宿主 locale 的 `sort` 排序差异（`en_US.UTF-8` 把 `node:fs` 排到 `./repo-root.ts` 前），与本 delta 无关（本 delta ⛔ 不碰任何 import 枚举）。

### ④ 已有机制在管（且本轮取到了**正面**读数）

- 机制 = `plugin/freshness-producers.json`（subject→producer + `preconditions`）→ 探针 `plugin/probes/freshness-refresh.md`（声明该文件是它的**唯一**输入）→ finding → `routine-file-gate.ts` 三闸立案。**这条链在生产上是活的**：本轮 `filing-round`（`.quay/routine-findings.jsonl:886`，`2026-09-25T02:24:41.218Z`）`evaluated:true, candidates:7, filed:[…ac-201, …ac-238]`，并把 ac-239 按 `dedup: symbols:upgrade-face` 挡下。
- **正面读数（关闭 2026-09-19 那次任务留下的观察项 ⑦-2）**：那条写「探针的 `suggestedAction` 在前置不满足时仍照写『re-run …』… 探针下一轮是否会读到并改写它**尚未观测**（发生率 1）」。**本轮观测到了**：本 finding（runId `…1790303081218`）的 `suggestedAction` 逐字为
  `re-run upgrade-face on a host authorized to B (this host is NOT: ssh BatchMode rc=255), only after on-the-spot disk headroom is confirmed on B, and with --upgrade-source pointed at the aged copy work/meta-cc-aged-ac238-copy`
  ⇒ 探针**读到了** mapping 的 0 号（ssh 授权）与 1 号（磁盘）前置并改写进了 finding。⚠️ 它仍写 `re-run`，只是把前置写进条件从句 —— 这是**设计如此**（前置存在的理由就是让读的人自己判可行性），⛔ 不记为缺陷。
- 本任务按 mapping **自己的机制**把**新测到的读数**登记回 0 号前置（commit `4c4692e25`，就地追加、⛔ 不新增数组元素 ⇒ 「0 号 / 下面那条」编号引用不破、文件 95 行不变）：**这是回归，⛔ 不是「从未授权」** —— 同一宿主、同一密钥（`id_ed25519` mtime `2026-09-16 10:39`，早于 09-19 那次成功运行 ⇒ 本机侧未轮换）在 09-19 **成功**跑完了全部跨机传输（`.quay/ac238-20260919/producer-run.log` 逐字 `remote stdout persisted → … (rc=0)`，且该记录自带 `isolated_copy:true` —— 只有 scp 成功才可能出现）⇒ 变化落在**目标机 B 的 authorized_keys 侧**，本机侧无任何可修项。`freshness-producer-coverage-check.ts --root .` ⇒ `PASS — consistent — 7 observed subject(s), 7 registered`。

### ⑤ 本任务**未**做的事（⛔ 逐条，不以沉默代替）

- ⛔ **未刷新本主体**：本机到 B 的 ssh 未授权（rc=255，今日复现），`--verify-upgrade` 连第一条 scp 都过不去 ⇒ AC-238/239 的载体证据在本任务结束时**仍是 `fa1cae20` / margin −28**。⛔ 不伪造绿、⛔ 不手写/注入记录。
- ⛔ **未在 B 上做任何动作**（改 `authorized_keys`、清盘）：两者都是**目标侧、对外、需人授权**的动作，超出本任务授权。补救 = 把本机 `~/.ssh/id_ed25519.pub` 加进 B 的 `authorized_keys`，或改在一台**已被 B 授权**的主机上跑该产出者。
- ⛔ 未把任务置 `needs-human`：本 AC 的第二个分支（写明失败在哪一步）**已可满足**，⛔ 不拿「需要人授权」当停全局的理由（硬规则 12）。
- ⛔ 未改 `goals/`、未改 K、未改 `criterion`/`expect`、未动两个载体（md5 跑前跑后相同）、未改探针、未改探针阈值；Touches 里 `verify-deliver-coldstart.sh` **未写** —— 本失败步落在**本地发送侧**，不在远端脚本。

### ⑥ 观察项（⛔ 无发生率读数者不升为前置 —— 硬规则 12）

1. **mapping 里 `:1625 / :1785` 两处行号指向的是 `out="$(ssh …)"`，不是它要说的 scp 腿**（真正的 scp 在 `:1585/:1647` 与 `:1744/:1801`）。发生率：本任务按位置核了 1 次；该引用**在我改之前就已如此**（我的改动行数中性，⛔ 未加剧）⇒ 仅记录，⛔ 不据此编辑（改它是本 delta 之外的编辑面）。
2. **本主体会随 develop 前进持续加深**（每 1 交付面提交 ⇒ margin −1）。本机无任何产出者能刷新它 ⇒ 下一轮 `freshness-refresh` 仍会立案（受 rate 闸 ≤3/窗口 约束；本轮实测 7 候选 → 立案 2 / dedup 挡 4 / rate 挡 1）。
3. **AC-201/203/205/207/232 五条已到 margin 20**（同一次运行产出 ⇒ 同步老化）；探针阈值 `(W+I)×R/K`（W=0.34、I=2、07-17 那次测得 R≈25 ⇒ 0.2925）下 `20/200 = 0.1` ⇒ **已在阈值内**，它们本轮只被 dedup/rate 挡下。⚠️ 其处置在 `gap-routine-freshness-refresh-freshness-stale-goal-009-ac-201`（同轮立案），⛔ 本任务不代裁。

## Touches
- `plugin/scripts/develop-deliver-tgz.sh`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238.md`