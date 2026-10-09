---
id: gap-routine-freshness-refresh-stale-goal-009-ac-238-79f43e79
title: "freshness-refresh: evidence_ts 2026-09-25T16:27:01Z is 322.71h old and
  d=217 > K=200 (margin -17) — out of window"
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
evidence_ts 2026-09-25T16:27:01Z is 322.71h old and d=217 > K=200 (margin -17) — out of window

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1791515642323` · ts `2026-10-09T03:14:02.323Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`upgrade-face`、`GOAL-009-AC-238`
- 涉及文件：
- `plugin/freshness-producers.json`
- `.quay/productization-verification.jsonl`
- `.quay/goal-freshness-margin.json`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run upgrade-face on host B (requires the aged third-party source copy and a target-known profile)

## Disposition

**结论（一句话）**：remedy 已**真跑**（不是引述、不是分析），它在**升级动作这一步**失败；根因已定位到
一个**机械的调用点回归**（commit `e0279c77a`，2026-10-07 落地），并有**双侧对照**。⇒ 该 finding 的
remedy 从 2026-10-07 起**结构上不可执行**，⛔ 不是「跑得太慢」也不是「探针没触发」。

### ① 改前读数（判据本体干跑，⛔ 不是引述）

```
$ bash /tmp/ac214-crit.sh                      # AC-214 criterion 逐字，repo root = 主检出
stale evidence: GOAL-009-AC-201:217/200 (margin -17), ... GOAL-009-AC-238:217/200 (margin -17), GOAL-009-AC-239:217/200 (margin -17)
freshness GOAL-009-AC-201: 217/200 (margin -17)
...
EXIT=1
```

载体逐字（主检出 `.quay/productization-verification.jsonl`，跑前 `md5 4f16a93149f4ee2c2efc6928504442bc` / 334 行）：
`GOAL-009-AC-238` 与 `GOAL-009-AC-239` 的最新记录均为 `ts 2026-09-25T16:27:01Z` / `build_sha 09f5c3a80893139705d3245f2c721e984abad09c`。
⇒ finding 的 `evidence_ts` 与 `d=217` **逐字复现**（硬规则 2 的零计数配套动作：谓词对真样本命中）。

### ② remedy 的每一个前置：逐条实测（⛔ 不引述 `preconditions` 散文）

`plugin/freshness-producers.json` 的 `upgrade-face.preconditions` 列了 4 条环境前置。本次逐条**当场复核**：

| # | 前置 | 实测读数 | 判定 |
|---|---|---|---|
| 0 | 本机 → B 的 ssh 授权（BatchMode，无口令回退） | `ssh -o BatchMode=yes ... yale@orangevps.wan.hwang.men 'echo PROBE-OK; hostname; df -h /'` ⇒ rc=0 / `PROBE-OK` / `orangevps` / `/dev/sda1 96G 88G 8.4G 92% /` | ✅ 通过（2026-09-24 那条 `Permission denied (publickey,password)` rc=255 **不再复现**） |
| 1 | 目标机上有 aged 源（旧 vendored 布局） | `~/work/meta-cc-aged-ac238-copy/.quay/runtime/bin/` 下 `quay`/`quay-native`/`quay-native.js` 三件俱在；副本 `.git` 在 | ✅ 通过 |
| 2 | 目标机磁盘余量 | `df -h /` ⇒ 8.4G free | ✅ 通过（非 2026-09-19 那次「100% 满」） |
| 3 | 一个**目标机网关认得**的 `--driving-profiles` | host B 的 `~/.local/bin/claude-fjdac` 导出 `ANTHROPIC_DEFAULT_{SONNET,OPUS}_MODEL=deepseek-v4-pro-anthropic`（base `https://fjbigmodel.fjdac.cn/`）。当场生成 profile（`model: deepseek-v4-pro-anthropic`）并**实测该模型在 B 上可用**：`claude-fjdac -p "reply with exactly: MODEL-OK" --model deepseek-v4-pro-anthropic` ⇒ stdout `MODEL-OK` rc=0（另有非致命的 `unrecognized_model` 装饰警告） | ✅ 通过 |

⇒ 四条前置**全部成立**（含 2026-09-25 那次挡住 remedy 的 0 号前置与 3 号前置）⇒ 按探针的
`remedyAvailability=executable` 真跑一次是**应当**的动作，⛔ 不是「明知不可行仍试」。

### ③ 实跑（跨机，host B）—— 逐字命令与读数

```
$ bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade \
    --upgrade-source work/meta-cc-aged-ac238-copy --ac239-e2e --hosts B --force \
    --root /home/yale/work/quay \
    --driving-profiles /tmp/quay-ac238-producer-79f43e79/profiles.yml
```
（`--upgrade-source` 与 `--driving-profiles` 两个占位符按映射的说明填入真值；`--hosts B` 只跑 B，
因为 host C 的授权本次未复核。）

```
develop-deliver: develop tip = cdbe3483c1f0 (cdbe3483c1f09542d1a4930eee3af28b9b3f0ff1)
develop-deliver: package.sh (quay .tgz)...  → quay-0.18.0-dev.tgz ✓   → quay-native-0.18.0-dev.tgz ✓
develop-deliver: B (orangevps.wan.hwang.men) — scp verify-deliver-coldstart.sh + its FULL closure + both .tgz
develop-deliver: B (orangevps.wan.hwang.men) remote stdout persisted → .quay/verify-upgrade-remote-B-cdbe3483.log (rc=0)
EVIDENCE-TRANSPORT appended=2 carrier=…/productization-verification.jsonl
develop-deliver: evidence-completeness ALL-MISSING present=2
develop-deliver: B — NOT-EVALUATED (declared ac set [GOAL-009-AC-238 GOAL-009-AC-239] not fully present in transported evidence)
```

⇒ 传输**成功**、**证据取回**，但**声明的两种记录一条都没产出** ⇒ `NOT-EVALUATED`（fail-closed，⛔ 与合格不同形）。
⇒ **AC-238 未被刷新**（run 后判据逐字 `freshness GOAL-009-AC-238: 218/200 (margin -18)`，`EXIT=1`）。

### ④ 失败在**哪一步**（根因，机械 + 双侧对照）

远端日志 `.quay/verify-upgrade-remote-B-cdbe3483.log` 的 ⑦ 段逐字：

```
== ⑦ upgrade-existing: /home/yale/quay-verify-upgrade-cdbe3483-root ==
  isolated copy: /home/yale/work/meta-cc-aged-ac238-copy -> …-root (source opened read-only, never written)
  upgrade action: shipped quay-init (config-preserving branch) rc=1 → …-root/.quay-upgrade-init.log
  post-binding: retired_to=<none> retired_matches_pre=0 live_rt_gone=0 bound=/home/yale/.local/opt/quay/0.7.0/… bound_sha=3039256afff0 delivered_qn_sha=6a94c8efbcc2
  NOTE: runtime_replaced=0 —— 三个方向未同时成立；⛔ 不退化成写一条 runtime_replaced=true 的记录
  AC-238 record NOT written — 缺值≠合格 (… upgrade_init_rc=1)
```

而 `…-root/.quay-upgrade-init.log` **全文只有两行**：

```
usage: quay <adr|goal|meta|init|task list|view|create|edit|check|gate|…|driver> ...
Run `quay --help` for full usage documentation.
```

**根因（按位置，⛔ 不按关键词）**：

- `plugin/scripts/verify-deliver-coldstart.sh:1455-1459` 的升级动作是

  ```
  CLAUDE_PLUGIN_ROOT="$(dirname "$(dirname "$qinit")")" \
    bash "$qinit" --root "$root" --repo-root "$root" \
      --worktree-root … --adopt-branch-model --auto-commit-skip
  ```

  而 `:1386` 把 `qinit="${npmroot}/quay/plugin/bin/quay"` —— **`bin/quay` 是 CLI 入口，它要求第一个位置参数是子命令**。
  ⇒ `--root` 被当成 verb ⇒ 未知 verb ⇒ usage ⇒ **exit 1**。⛔ 与 flags 本身无关。

- **这是回归，且引入点明确**：`git show e0279c77a -- plugin/scripts/verify-deliver-coldstart.sh` 逐字显示
  该提交把**三处** `qinit=` 从 `plugin/scripts/quay-init.sh` 改成 `plugin/bin/quay`，并给它**改写过的**
  三个调用点补上了 `init`（`:3782`/`:4279`/`:4285` ⇒ `"$plugin_root/bin/quay" init …`）——
  ⛔ **但漏了 `:1456` 与 `:4583` 两处**（硬规则 5b：缺陷成簇，兄弟实例常在同一文件）。
  `e0279c77a` = `gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch`（**done**，2026-10-07
  worker 轮），其任务体第 188 行自己写着这两个脚本「**未实际执行**…调用点已按新参数面改写并静态核对」
  ⇒ 静态核对的正是漏掉的那两处。⛔ 该任务已于 10-07 关闭，故本缺陷是它**交付的**新缺陷，不是它已知的。

- **双侧对照（硬规则 4 推论四：给不出对照就只能降为假说）**，在 host B 上用**本次交付物自带**的同一份 CLI 跑：

  | 对照 | 命令 | 结果 |
  |---|---|---|
  | ① 复现（= 生产所跑的 argv） | `bash <prefix>…/plugin/bin/quay --root X --repo-root X --worktree-root X-wt --adopt-branch-model --auto-commit-skip` | 打印与上面**逐字相同**的 usage，**rc=1** |
  | ② 只加 `init` 一个词 | `bash <prefix>…/plugin/bin/quay init --root X --repo-root X … --adopt-branch-model --auto-commit-skip` | **越过参数解析**（rc=2，原因是 /tmp 不是 git 树且无 test command，与 usage 无关） |

  ⇒ ① 逐字复现生产失败；② 改变**唯一**一个变量后失败消失 ⇒ 「缺 `init` 子命令」是**成因**，不是相关物。

### ⑤ 兄弟实例（硬规则 5b 的产物，⛔ 不只修被报出来的那一个）

按位置扫 `verify-deliver-coldstart.sh` 全部 `$qinit` 调用点，**同形态**（把 `bin/quay` 当脚本调、
传 shell-入口时代的 flags、⛔ 无 `init` 子命令）共 **2** 处：

1. `:1456`（本 finding 的 remedy 所走的那一步，= ③ 的失败点）；
2. `:4583`（`step2_init`，冷启动面的 ② 段：`bash "$qinit" --all --loop --root … --auto-commit-confirm`）。
   本次运行的远端日志逐字给出它的后果：`STEP2_OK=0`。⛔ 它的 flags 里还有 `--all/--loop`（**不是** CLI flag）
   ⇒ 它的修法与 ① 不同形，归它自己的那一刀。

其余 3 处（`:3782`/`:4279`/`:4285`）已是 `"$plugin_root/bin/quay" init …` 的正确形态。

### ⑥ 本次运行**确实改变了什么**（副作用，逐条，⛔ 不以沉默代替）

`EVIDENCE-TRANSPORT appended=2` ⇒ 主检出载体 334 → 336 行，新增两条（均 `ts 2026-10-09T03:47:03Z`）：

1. `ac=AC88, ok:false, host=B, stepInstall=true stepInit=false stepColdstart=false` —— 本次运行的失败留痕；
2. `ac=GOAL-009-AC-201, build_sha=cdbe3483c1f09542d1a4930eee3af28b9b3f0ff1, tgz_sha256=6114560955…` —— 段①
   （fresh .tgz 装进隔离 prefix + `quay dist --version` = `0.18.0-dev`）**真的跑成了**，该记录是产出者按设计写出的。

⇒ **AC-201 这个主体被真实刷新了**（判据逐字 `freshness GOAL-009-AC-201: 0/200 (margin 200)`；
AC-201 本体干跑 `EXIT=0`）。⚠️ 如实记一条**机制观察**（⛔ 不是本任务的结论）：**一次在读 @238 的运行为 7 个主体
里的另一个写出了合格记录，而它自己的两个主体一条都没写出** —— 「载体写入了 = 记录已落账」与
「本次运行合格」在这里不同形却共用一个载体（该形态在 `gap-routine-freshness-refresh-stale-goal-009-ac-239.md`
的观察项 3 已被单独登记过，本任务只留读数，⛔ 不重复立案）。
**AC-238 / AC-239 未刷新**（218/200）；**AC-214 判据仍 `EXIT=1`**（6/7 主体陈旧）。

### ⑦ 本任务⛔未做的事（逐条，不以沉默代替）

- ⛔ **未改 `plugin/scripts/verify-deliver-coldstart.sh`**（**不在 Touches**）：④ 的修法在两个调用点上
  **不同形**（`:1456` 只差一个 `init`；`:4583` 还带 `--all/--loop` 这类非 CLI flag），且该文件是
  `--selfcheck` + 31 个用例钉住的产品脚本 ⇒ 这是 `e0279c77a` 的所有者该做的一刀，⛔ 不由本例行 gap 任务扩面代裁。
- ⛔ 未再跑第二次 producer（第二次的成本结构未变、且 ④ 已证明它**必然**停在同一处）。
- ⛔ 未在 B 上删任何文件、未改 B 上任何东西（`.quay/verify-upgrade-*` 是 B 上本次运行自己的产物）。
- ⛔ 未改 `plugin/freshness-producers.json`（Touches 里那一行）：逐项复核结论是**「正确、无需变更」** ——
  `command` 与 finding 的 `suggestedAction` 同形；`wallclock_hours: 0.38` 是实测值；`subjects` 含 AC-238/239；
  4 条 preconditions 逐条复跑均成立（② ）。把运行史写进该文件本身就违反它自己的单源原则。
- ⛔ 未改 `goals/`、未改 K、未改 criterion/expect、未改探针；未删载体里那条 AC-201 记录（它是产出者的
  设计输出，删生产载体行是另一类动作）。
- ⛔ 未把任务置 `needs-human`：本 AC 的第二个分支（写明「失败在哪一步」）**已可满足**，且已完成。
- ⛔ **未另立修复任务**（沿本 family 的既有约定：见 ⑧）。

### ⑧ 观察项（⛔ 无发生率读数者不得升为前置 —— 硬规则 12）

1. **`:4583` 与 `:1456` 是同一回归的兄弟**：本次是**首次实测**到 `:1456` 的后果（n=1），`:4583` 的后果
   （`STEP2_OK=0`）同一次运行同时出现 ⇒ 发生率读数已有 2 个位点、1 次运行。修法落在
   `verify-deliver-coldstart.sh`（不在 Touches）⇒ 归 `e0279c77a` 的所有者或一次新的机制任务。
2. **可区分性守住了**：升级动作 rc=1 ⇒ 远端**不写** AC-238 记录（`AC-238 record NOT written — 缺值≠合格`），
   `runtime_replaced=0` 是**枚举**读数而不是布尔 ⇒ 硬规则 3b 在这里是守住的，失败**没有**伪装成合格。
3. **探针的 `executable` 判定是浅的**：它只探 `ssh … true` 的 rc（本次 rc=0），⛔ **不探**「这一次运行真的能产出记录」。
   ⇒ `remedyAvailability=executable` 与「remedy 当下可执行」在 2026-10-07 之后**不再同形**。⚠️ 发生率 n=1
   （本仓首次），只记观察、⛔ 不立前置、⛔ 不在本任务扩面。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `stale-goal-009-ac-238`（routine `freshness-refresh`，runId `freshness-refresh-1791515642323`）所描述的问题被复核并处置 —— 复核 = ① 改前读数逐字复现 finding 的 `evidence_ts`/`d`；处置 = ② 逐条实测 remedy 的四个前置（全成立）→ ③ 用映射声明的命令**真跑**了一次跨机产出者。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— **未修掉，但失败点已按位置定位并有双侧对照**：失败在**升级动作**（`upgrade action: … rc=1`），根因 = `verify-deliver-coldstart.sh:1456` 用 shell-入口时代的 flags 调用 `bin/quay` 而**缺 `init` 子命令**，由 `e0279c77a` 的不完整调用点迁移引入；对照①逐字复现 rc=1、对照②只加 `init` 即越过参数解析。兄弟位点 `:4583` 同形态（`STEP2_OK=0`）。结论可核且可被第三方重跑。

## DoD
- [x] 上面的判据实跑通过 —— 判据本体（AC-214 criterion）在改前/改后各干跑一次（① / ⑥ 各贴 exit code + 逐行读数）；remedy 用映射声明的命令真跑一次（③）。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 产出者由**派发链**（本 worker）执行；探针那一侧本次 scan-round 逐字 `No producer was executed`（`.quay/routine-findings.jsonl` runId `freshness-refresh-1791515642323`，`findings=7` / `remedy_availability.status=executable`），其职责止于立案。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-238-79f43e79.md`
