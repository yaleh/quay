---
id: gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238-de77440b
title: "freshness-refresh: Freshness window crossed (d=222, margin -22); newest
  AC-238 evidence is 209.4h old (2026-10-13T18:18:10Z, build d7381ed6) and the
  upgrade face has not run since,"
status: ready
labels:
  - gap
  - routine-filed
  - freshness-refresh
parent: null
children: []
extra: {}
---
## Finding
Freshness window crossed (d=222, margin -22); newest AC-238 evidence is 209.4h old (2026-10-13T18:18:10Z, build d7381ed6) and the upgrade face has not run since, so the margin decays at ~9 commits/h into a 200-commit window.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1792669460476` · ts `2026-10-22T11:44:20.476Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`upgrade-face`、`verify_upgrade_mode`、`transport_evidence_append`、`check_upgrade_pairing`
- 涉及文件：
- `plugin/freshness-producers.json:176`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `.quay/productization-verification.jsonl:373`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
Re-run upgrade-face on host B (ssh authorized rc=0 this round; 17G free on /; aged source /home/yale/work/meta-cc-aged-ac238-copy present) with a --driving-profiles whose worker-default.model the B gateway recognizes.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `GOAL-009-AC-238` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-22T11:44:20.476Z

## Disposition

**结论（一句话）**：remedy **真跑了**并**成功刷新了该主体** —— AC-238 的新鲜度读数从 `d=222 / margin -22` 变为 `d=0 / margin 200`；同一次运行按设计一并刷新 AC-239 与 AC-201。⛔ 不是「已注意到」，也不是「re-run 就完事了」：四条前置当场逐条实测、实跑输出逐字记录、改前/改后判据各干跑一次（①②③④），并把 `plugin/freshness-producers.json` 里那条**已被推翻的 2026-09-24 前置结论**以日期化注记更正（⑤.3）。

## Evidence

### ① 改前读数（干跑判据本体，⛔ 不是引述）

判据来源 = `goals/AC-214-交付证据必须新鲜-四条载体型判据不得-一旦转绿即永久绿.md` 的 `criterion` 字段（`node -e` 用 `yaml` 解析 frontmatter 取出存 `/tmp/ac214-crit-current.sh`），在主检出 cwd 下跑：

```
$ bash /tmp/ac214-crit-current.sh
stale evidence: GOAL-009-AC-205:260/200 (margin -60), GOAL-009-AC-238:222/200 (margin -22), GOAL-009-AC-239:222/200 (margin -22)
freshness GOAL-009-AC-238: 222/200 (margin -22)
freshness GOAL-009-AC-239: 222/200 (margin -22)
EXIT=1
```

`.quay/goal-freshness-margin.json`（2026-10-22T11:56:59Z）：`GOAL-009-AC-238 {"d":222,"margin":-22,"evidence_ts":"2026-10-13T18:18:10Z","evidence_age_hours":209.64}` ⇒ finding 的 `d` / `margin` / `evidence_ts` / age **逐字复现**（硬规则 2 的零计数配套动作：谓词对真样本命中）。

⚠️ 同时把两件事分开（硬规则 3b）：**AC-238 自身的判据此刻是绿的**（`bash /tmp/ac238-crit.sh` ⇒ `AC238_EXIT=0`，载体那条记录各项齐全）；红的是 **AC-214 的新鲜度窗口**。⇒ 本 finding 的问题是「陈旧」，⛔ 不是「记录不合格」。

### ② remedy 的四条前置：当场逐条实测（⛔ 不引述 preconditions 散文）

| # | 前置 | 实测读数（2026-10-22T11:5x–12:0xZ） | 判定 |
|---|---|---|---|
| 0 | 本机 → B 的 ssh 授权（BatchMode，无口令回退） | `ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men 'echo PROBE-OK; hostname; df -h /'` ⇒ rc=0 / `PROBE-OK` / `orangevps` | ✅ |
| 1 | aged 源（旧 vendored 布局） | `~/work/meta-cc-aged-ac238-copy/.quay/runtime/bin/` 下 `quay` `quay-native` `quay-native.js` `quay.js` 俱在；`du -sh` = 749M | ✅ |
| 2 | 目标机磁盘 | `df -h /` ⇒ `96G 80G 17G 84% /`（749M 隔离副本 ✓） | ✅ |
| 3 | 目标机网关认得的 `--driving-profiles` | `PATH=… claude-fjdac -p "reply with exactly: MODEL-OK" --model deepseek-v4-pro-anthropic` ⇒ stdout `MODEL-OK` / rc=0（另有非致命 `unrecognized_model` 装饰警告，见 `plugin/freshness-producers.json` 2026-09-07 注记） | ✅ |

生成并推送的 profile（`/tmp/quay-ac238-producer-de77440b/profiles.yml`）：`worker-default: launcher=claude-fjdac model=deepseek-v4-pro-anthropic bare=false auth=token`。

### ③ 实跑（跨机，host B）—— 逐字命令与读数

```
$ bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade \
    --upgrade-source work/meta-cc-aged-ac238-copy --ac239-e2e --hosts B --force \
    --root /data/home/yale/work/quay \
    --driving-profiles /tmp/quay-ac238-producer-de77440b/profiles.yml

develop-deliver: develop tip = 6b91fa84b37e (6b91fa84b37e9780637f6ac23c81b910f009bd12)
  → .quay/deliver-worktree-6b91fa84b37e/packages/quay/quay-0.23.0-dev.tgz
  → .quay/deliver-worktree-6b91fa84b37e/packages/quay-native/quay-native-0.23.0-dev.tgz
develop-deliver: B (orangevps.wan.hwang.men) remote stdout persisted → .quay/verify-upgrade-remote-B-6b91fa84.log (rc=0)
EVIDENCE-TRANSPORT appended=4 carrier=…/productization-verification.jsonl
develop-deliver: evidence-completeness COMPLETE present=2
develop-deliver: upgrade-pairing UPGRADE-PAIR OK host=orangevps roots=/home/yale/quay-verify-upgrade-6b91fa84-root
develop-deliver: --verify-upgrade OK
```

远端 ⑦（升级动作）逐字：

```
== ⑦ upgrade-existing: /home/yale/quay-verify-upgrade-6b91fa84-root ==
  isolated copy: /home/yale/work/meta-cc-aged-ac238-copy -> …-root (source opened read-only, never written)
  pre: tasks=103 runtime_age_days=62.541 taskset=765b6b387e3a
  upgrade action: shipped quay-init (config-preserving branch) rc=0
  post-binding: retired_matches_pre=1 live_rt_gone=1 bound_sha=9d2c14afa7c2 delivered_qn_sha=9d2c14afa7c2
  post: tasks=103 taskset_stable=1 runtime_replaced=1
  cli read-back: list_count=103 sample=AC118-001 sample_ok=1 task_list_ok=1
  ac238 record written → …/quay-verify-upgrade-evidence-6b91fa84.jsonl
```

远端 ⑦b（AC-239 腿）逐字：

```
  [⑦b] target-profiles: configured (launcher=claude-fjdac model=deepseek-v4-pro-anthropic)
  [⑦b] go toolchain: /home/yale/go-sdk/bin (go version go1.24.4 linux/amd64)
  [⑦b] real defect-fix task created in the upgraded project: ac239-subagent-session-id-scan
  [⑦b] driver start: promotion rc=0 worker rc=0 started=1
  [⑦b] poll finished: task_status=done (poll window 3600s)
AC239_TASK_STATUS=done AC239_COMMIT_SHA=7a411a57d5f8 AC239_GATE_EVENTS=157 AC239_PRODUCED_BY_DRIVER=1
AC239_WRITTEN_THIS_RUN=1
VERIFY-RC 0
```

载体新增 4 条（`ts 2026-10-22T12:00:12Z`）。AC-238 / AC-239 两条的关键字段：`build_sha=6b91fa84b37e9780637f6ac23c81b910f009bd12`、`host=orangevps`、`project_root=/home/yale/quay-verify-upgrade-6b91fa84-root`；AC-238 另带 `pre_upgrade_task_count=103 post_upgrade_task_count=103 pre_upgrade_runtime_age_days=62.541 runtime_replaced=true task_list_ok=true`。

### ④ 改后读数（同一判据、同一 cwd）

```
$ bash /tmp/ac214-crit-current.sh
stale evidence: GOAL-009-AC-205:260/200 (margin -60)
freshness GOAL-009-AC-201: 0/200 (margin 200)
freshness GOAL-009-AC-238: 0/200 (margin 200)
freshness GOAL-009-AC-239: 0/200 (margin 200)
freshness GOAL-009-AC-203 / -207 / -232: 87/200 (margin 113)
EXIT=1
```

- `GOAL-009-AC-238`：**222/200 (−22) → 0/200 (+200)**；`GOAL-009-AC-239` 同；`GOAL-009-AC-201` 87 → 0（本次运行按设计一并写出了它的记录）。
- `.quay/goal-freshness-margin.json`（2026-10-22T12:14:19Z）：AC-238 `{"d":0,"margin":200,"evidence_ts":"2026-10-22T12:00:12Z","evidence_age_hours":0.23}`。
- 判据整体仍 `EXIT=1`，**唯一原因是 `GOAL-009-AC-205`（260/200, −60）** —— 另一主体、另一前置（需要 B/C 上存在一个活且允许入站的会话），不在本任务范围（同族已在 `tasks/gap-routine-freshness-refresh-freshness-ac205-session-delivery.md` 等任务登记）。
- 目标判据本体复跑：`AC238_EXIT=0`、`AC239_EXIT=0`。

### ⑤ 处置结论（可核）

1. **修掉了**（就本 finding 的主体而言）：AC-238 新鲜度 `−22 → +200`，d `222 → 0`，载体新增一条 `build_sha=6b91fa84b37e…` 的合格记录；AC-239 在同一 `project_root` 上成对落账（`UPGRADE-PAIR OK`）。
2. **机制侧没有新缺陷**：2026-10-09 之前的阻断点（`verify-deliver-coldstart.sh:1456` 用 shell-入口时代的 flags 调 `bin/quay` 而缺 `init` 子命令）已由 `8d382f8a1` 修复；本轮按位置复核两处调用点均为 `bash "$qinit" init …`（`:1483` / `:4584`），并由此前最远只到 2026-10-13 的记录前进到 10-22；实跑 ⑦ 逐字 `rc=0` 佐证。
3. **单源更正（本轮唯一的配置改动，1 行）**：`plugin/freshness-producers.json` 的 `upgrade-face.preconditions[0]` 结尾仍写着 2026-09-24 的 `Permission denied` ⇒「re-run 在本主机不是可执行补救」。该结论**已被推翻**（2026-10-09 起可跑；本轮再次 rc=0 且真跑成功）。按该文件既有的**日期化 supersede 注记**惯例（同文件已有「上面那条读数已被…推翻，⛔ 不要当现状引用」的写法）追加一行 —— ⛔ 不删历史、不重写。理由：该字段是探针/未来读者判定 remedy 是否可执行的唯一输入，留着一条已失效的结论会把下一次立案引向「blocked」。
4. **兄弟实例**：同族的 `:4584`（冷启动面 ② `step2_init`）本轮一并复核，运行日志中无 rc≠0 痕迹；⛔ 本任务不扩面改它（它已经是对的）。
5. **探针只立案不执行**：本轮 scan-round 逐字 `findings=3` / `remedy_availability.status=executable`（`.quay/routine-findings.jsonl` runId `freshness-refresh-1792669460476`），产出者由**派发链**（本 worker）执行。

- L_G：该轴仍暗,理由:本次只跑跨机产出者并更新一份声明型 JSON 的日期化注记，未改 packages/ 依赖结构，未运行 archguard 仪器

### ⑥ 本任务 ⛔ 未做的事（逐条，不以沉默代替）

- ⛔ 未改 `K`、`goals/`、AC-214/AC-238/AC-239 的 criterion 或 expect、`plugin/probes/freshness-refresh.md` 的阈值。
- ⛔ 未动 `GOAL-009-AC-205` 的 `session-delivery` 前置（需要目标机出现一个活且允许入站的会话，属另一任务族）。
- ⛔ 未删/未改载体 `.quay/productization-verification.jsonl` 的任何既有行（只由产出者的 transport 追加）。
- ⛔ 未再跑第二次 producer（一次成功即已刷新；`--force` 只用于越过 6h 低频保持，⛔ 不用于重试）。
- ⛔ 未在 host B 上删除任何东西（`~/quay-verify-upgrade-6b91fa84*` 是本次运行自己的产物）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-stale-goal-009-ac-238`（routine `freshness-refresh`，runId `freshness-refresh-1792669460476`）所描述的问题被复核并处置 —— 复核 = ① 改前读数逐字复现 finding 的 `d=222` / `margin=-22` / `evidence_ts=2026-10-13T18:18:10Z`；处置 = ② 四条前置逐条实测（全成立）→ ③ 用映射声明的命令**真跑**一次跨机产出者 → ④ 改后判据 `d=0 / margin=200`。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— **已修掉**：AC-238/AC-239 的 margin 由 −22 变为 +200（④），载体新增 `ts 2026-10-22T12:00:12Z` / `build_sha=6b91fa84b37e…` 的两条成对记录（③），目标判据 `AC238_EXIT=0` / `AC239_EXIT=0`；同时以日期化注记更正了声明文件里那条已被推翻的前置结论（⑤.3），杜绝下一次按失效前置判 blocked。

## DoD
- [x] 上面的判据实跑通过 —— AC-214 判据在改前（①）/改后（④）各干跑一次并贴 exit code 与逐行读数；AC-238、AC-239 目标判据各复跑一次（`EXIT=0`）；remedy 用映射声明的命令真跑一次（③，`VERIFY-RC 0`）。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 产出者由**派发链**（本 worker）执行；探针该轮逐字 `remedy_availability.status=executable`、`findings=3`，其职责止于立案（⑤.5）。

## Touches
- `plugin/freshness-producers.json`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238-de77440b.md`