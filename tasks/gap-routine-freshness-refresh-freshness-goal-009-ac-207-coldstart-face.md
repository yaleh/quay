---
id: gap-routine-freshness-refresh-freshness-goal-009-ac-207-coldstart-face
title: "freshness-refresh [remedy-blocked] Only 19 of 200 commits of window
  remain (0.095) while a coldstart-face run started now needs 2.34h during which
  the delivery face can advance 56 "
status: needs-human
labels:
  - gap
  - routine-filed
  - freshness-refresh
parent: null
children: []
extra:
  acceptance: python3 -c 'import json,sys; ac="GOAL-009-AC-207";
    ts="2026-09-25T03:49:55.712Z"; b="09f5c3a8"; rows=[json.loads(l) for l in
    open(".quay/productization-verification.jsonl")]; n=[r for r in rows if
    r.get("ac")==ac and (r.get("ts") or "")>ts and (r.get("build_sha") or
    "").startswith(b)]; print("fresh",len(n)); sys.exit(0 if n else 1)'
depends_on:
  - gap-routine-freshness-refresh-freshness-goal-009-ac-239-upgrade-face-8c2414da
---
## Finding
- remedy-availability：`blocked` · subject：`GOAL-009-AC-207` · host-execution-probe：`host-b-ssh`

Only 19 of 200 commits of window remain (0.095) while a coldstart-face run started now needs 2.34h during which the delivery face can advance 56 commits at the worst observed bucket (24/h) - the tip crosses the window before the run finishes.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1790308195712` · ts `2026-09-25T03:49:55.712Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的
quality / dedup 两道闸机械立案，并按 `remedy-availability` = `blocked` 改走**人可见通道**
（`status: needs-human`，⛔ 不进派发候选）—— ⛔ 不是由人转抄，也不是由探针自行执行。

- subject：`GOAL-009-AC-207`
- 涉及文件：
- `.quay/productization-verification.jsonl:289`
- `plugin/freshness-producers.json:37`
- `.quay/goal-freshness-margin.json:1`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
⛔ **本立案的补救在【本机】不可执行** —— 例程机械执行 `plugin/freshness-producers.json` 声明的
可达性探针 `host-b-ssh`，读到的是**明确的授权拒绝**（`blocked`），不是网络故障、
也不是「没读出来」（那两种是另一个取值）。⇒ 本任务⛔ **不进派发候选**，只走人可见通道。

- 逐字观测：`yale@orangevps.wan.hwang.men: Permission denied (publickey,password).`
- 目标机：`yale@orangevps.wan.hwang.men`
- 补救（一）：把本机 `~/.ssh/id_ed25519.pub` 逐字追加到 `yale@orangevps.wan.hwang.men` 的 `~/.ssh/authorized_keys`（目标侧动作，需人授权）
- 补救（二）：或改在**一台已被 B 授权的主机**上跑本 finding 自己那条 producer 命令（逐字见本文件 `producers[].command`），⛔ 不在此处复制第二份
- 本 finding 自己的 producer 命令（逐字，来自 `plugin/freshness-producers.json`）：
  `bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --force --root <main-checkout>`
- ⛔ 读数不变（仍是 `blocked`）时**不重复立案同一主体**：`GOAL-009-AC-207` 已在板上 ⇒ 不再升级第二次。

（finding 自己的 suggestedAction，逐字：）
re-run coldstart-face on a host authorized to B and C (blocked on this host: ssh Permission denied, see notes)

## AC
- [x] 上面那台机上那条补救被执行（或本机授权被开通），且 `.quay/routine-findings.jsonl` 里 `GOAL-009-AC-207` 的证据记录 `ts` 晚于本次升级
- [x] 处置结论可核：要么真的重跑了产出者并把新记录落进载体，要么写明是哪一侧的授权/磁盘前置仍不满足，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 本任务**不是**派发任务：补救在**另一台机**上、或需要目标侧 `authorized_keys` 变更（人授权）；⛔ 例程不代跑，⛔ 也没有「可机械再入队」的路径（人 2026-09-20 裁定）

## Evidence

**处置 = 补救已执行 + 产出者真跑 + 新记录落账（⛔ 不是「已注意到」）**

① 补救已执行（人授权）：本机到 host B（`orangevps.wan.hwang.men`）与 host C（`ad-arm1.wan.hwang.men`）的 ssh 授权已开通。2026-09-25 复核：`ssh -o BatchMode=yes -o ConnectTimeout=8 yale@<host> 'df -h /'` 两台均 rc=0（立案时逐字为 `Permission denied (publickey,password).` / rc=255）。

② 产出者真跑（逐字命令，⛔ 不是引述）：

```
bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --driving-profiles /data/home/yale/work/quay-driving-profiles-target.yml --force --root /data/home/yale/work/quay
```

逐字结果：rc=2（PARTIAL）；B 腿 rc=0、C 腿 rc=0；e2e-pairing E2E-PAIR OK（AC-203 与 AC-207 落在同一 project_root）；evidence-completeness PARTIAL present=5 missing=1 list=GOAL-009-AC-205（仅 host C 缺 AC-205——C 上没有允许入站的活会话，该前置未变）

⚠️ 该次运行带 `--driving-profiles /data/home/yale/work/quay-driving-profiles-target.yml`：本仓 `.quay/profiles.yml` 的 `worker-default.model` 是本机网关专属名，被目标主机网关 400 拒绝，导致两条 e2e 腿的 worker 全灭。该缺口（推送侧无覆盖入口）由任务 `gap-e2e-verify-pushes-dev-host-profile-model-to-target-host` 修复并已落地，本处用的是它提供的覆盖入口。

③ 载体新记录（本任务验收命令读的就是这条）：`.quay/productization-verification.jsonl` 中 `ac == "GOAL-009-AC-207"` ∧ `ts` 晚于本次升级（`2026-09-25T03:49:55.712Z`）∧ `build_sha` 前缀 `09f5c3a8` 的记录数 = **2**，最新 `ts` = **2026-09-25T17:17:02Z**。

④ 新鲜度读数：`.quay/goal-freshness-margin.json`（2026-09-26T00:31:06Z）`GOAL-009-AC-207` **d=0 / margin=200**；立案时逐字为「Only 19 of 200 commits of window remain (0.095) while a coldstart-face run started now needs 2.34h during which the delivery face can advance 56 commits」。

⑤ 据实记录一处判据瑕疵：本任务 AC-1 把载体写作 `.quay/routine-findings.jsonl`。该文件确有本主体条目，但**产出者证据的真实载体**是 `.quay/productization-verification.jsonl`——验收命令读的是后者（真实读数），⛔ 未按字面读前者充数。

⛔ 本任务未做：未改 `goals/`、未改判据/K、未动 `.quay/routine-findings.jsonl`、未改任何其它任务。

该轴仍暗，理由：本任务为新鲜度载体刷新的收尾（记录产出者重跑与新载体记录），未产生代码 delta，故未做 L_D/L_G 测量；本次实测读数见本文件 ③（载体记录数）与 ④（margin）。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-207-coldstart-face.md`