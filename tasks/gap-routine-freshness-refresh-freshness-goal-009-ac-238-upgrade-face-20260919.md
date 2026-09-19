---
id: gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face-20260919
title: "freshness-refresh: GOAL-009-AC-238 evidence (build_sha
  b29affe9d0b955647c4a215ad6b9fbf0d662ec9f, carrier ts 2026-09-17T06:40:51Z) is
  already 146 delivery-face commits behind develo"
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
GOAL-009-AC-238 evidence (build_sha b29affe9d0b955647c4a215ad6b9fbf0d662ec9f, carrier ts 2026-09-17T06:40:51Z) is already 146 delivery-face commits behind develop tip 395e33341b24ed6cb12c24119542a34932a8d417, leaving margin 54 of K=200; that is 0.27 of the window, BELOW the upgrade-face threshold 0.2975 (=59.5 commits), so a producer started now (W=0.38h) plus one 2h observation interval would finish after the evidence has aged past K. This is the SECOND crossing of this subject: it was filed 2026-09-17 as gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face and has aged out again.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1789797712476` · ts `2026-09-19T06:01:52.476Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`upgrade-face`、`GOAL-009-AC-238`、`develop-deliver-tgz.sh`
- 涉及文件：
- `plugin/freshness-producers.json:65`
- `.quay/productization-verification.jsonl`
- `.quay/goal-freshness-margin.json:1`
- `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face.md`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run producer upgrade-face on host B (reusing the aged source work/meta-cc-aged-ac238-copy; plain work/meta-cc yields NOT-EVALUATED, no .quay/runtime/bin)

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-goal-009-ac-238-upgrade-face-20260919`（routine `freshness-refresh`，runId `freshness-refresh-1789797712476`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置 = 【复核为真（①）+ 真跑了产出者（③）+ 定位并当场复现了失败的那一步（④）+ 把该前置按 mapping 自己的机制登记（⑤）】。**
⛔ **不是「已注意到」；也⛔ 不是「证据已刷新」—— 本次产出者运行【失败】，载体零追加，AC-238/239 的证据在本任务结束时仍是 `b29affe9`。**

### ① finding 复核为真（判据本体独立重跑，⛔ 不采信 finding 自报值）

判据 = `goals/AC-214-交付证据必须新鲜-*.md` 的 `criterion`（它就是写 `.quay/goal-freshness-margin.json` 的那一条，探针读的正是它）。交付面路径集按判据**同一规则机械推导**（`packages/quay/package.json` 的 `files` + `plugin` + `packages/quay-native/src`，⛔ 不手写清单）：

| 量 | finding 自报 | 本任务独立重算 | 一致 |
|---|---|---|---|
| 最新证据 build_sha / ts | `b29affe9` @ `2026-09-17T06:40:51Z` | 载体末条 AC-238 记录同值 | ✓ |
| `d`（该 sha → develop tip，交付面） | 146 | `git rev-list --count b29affe9..develop -- <paths>` = **146** | ✓ |
| margin / K / fraction | 54 / 200 / 0.27 | `200 − 146` = **54** ⇒ 0.27 | ✓ |
| 阈值 `(W+I)·R/K` | 0.2975 | W=0.38（mapping 实测值）+ I=2（探针 `interval:120m`）+ K=200 ⇒ 反解 R=**25.0** | — |
| R（探针取「最坏单小时桶」，⛔ 不取均值） | （未在 finding 里给出） | 7 天窗内交付面 **clock-hour 最坏桶 = 25**（`2026-09-13T10Z`；滚动 60min 最坏 26）。**对照**：同期均值 745/168h = **4.43/h**、近 2 天 138/48h = **2.88/h** | ✓ |

⇒ `0.27 ≤ 0.2975` ⇒ **探针按自己的规格必然立案**，算式逐项可复现（`0.2975×200/25 = 2.38h = W+I`，自洽）。

### ② 机械核对：这次**不是**「产出者在飞、重跑零边际收益」（⛔ 与 AC-203/205/207/238 那句复用模板的区别）

`gap-routine-freshness-refresh-freshness-goal-009-ac-239-upgrade-face` 的 Evidence §⑥ 把「⛔ 未重跑产出者 … 派发链已经跑过」列为**发生率 1 的观察项**，并指出那句断言与产出者运行日志之间**没有任何机械核对**。本任务这次把那项核对做了，两个量都是**取假方向**：

```
in-flight 产出者进程    pgrep -af 'develop-deliver'  → 0 条（本 shell 自身除外）
载体最新 AC-238 记录    ts = 2026-09-17T06:40:51Z    → 距本次运行 47h18m，期间零新记录
.halt / control-state   未停泊（run 正常派发到本任务）
```

⇒ 这次**没有**任何在飞运行可以搭便车，重跑有**真实边际收益** ⇒ 跑了（③）。

### ③ 产出者**真跑**（本任务自己跑，⛔ 不是转述别人跑过）

命令行 = mapping `upgrade-face.command` **逐字**（⛔ 一个参数都没改；`<aged-third-party-project>` 按同条目 `_aged_source` 取 `work/meta-cc-aged-ac238-copy`）：

```
start  2026-09-19T06:08:40Z        (nohup setsid, pid 877067)
bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade \
  --upgrade-source work/meta-cc-aged-ac238-copy --ac239-e2e --hosts B --force --root /home/yale/work/quay
end    2026-09-19T06:12:34Z        (失败退出)
日志   .quay/ac238-20260919/producer-run.log  +  .quay/verify-upgrade-remote-B-097fe2d7.log
```

逐步读数（末列取自远端 log，⛔ 非本地自报）：

| 步 | 结果 |
|---|---|
| 本地 build 两个 .tgz @ develop tip `097fe2d7b` | ✓ `quay-0.10.0-dev.tgz` + `quay-native-0.10.0-dev.tgz` |
| scp 闭包 + 两个 .tgz → host B | ✓ |
| 远端 ① fresh install 进隔离 prefix | ✓ `quay dist --version` 回读 `0.10.0-dev`；`STEP1_HOME_ISOLATED=1` |
| 远端 ⑦ `rm -rf $root`（:1397）→ `cp -a <aged source> $root`（:1399） | ✗ **ENOSPC**（见 ④） |
| 记录写出 / 传输 / 配对 | ✗ `EVIDENCE-ABSENT`、`VERIFY-RC 1`、载体**零追加**（md5 跑前跑后同为 `c5a0939f9e717a13e3f66125d24c36ff`，268 行不变） |

⇒ **fail-closed 是对的**：零记录，⛔ 没有写一条假记录把「未评估」伪装成「合格」（硬规则 3b 在这里守住了）。

### ④ 「失败在哪一步」—— 这就是本 AC 第二个分支的答案

**失败在 ⑦ 的第一件事：把 aged source `cp -a` 成隔离副本。** 直接量（⛔ 不是推断）：

```
host B:  /dev/sda1   96G   96G   4.1M  100%  /          ← 根文件系统满
         inode 12976128 中用 2264346 = 18%              ← 是【字节】不是 inode
远端 log: 12 条 "No space left on device"，全部落在 cp 的某一项上
         末条逐字: NOT-EVALUATED: cp -a '/home/yale/work/meta-cc-aged-ac238-copy'
                              -> '/home/yale/quay-verify-upgrade-097fe2d7-root' failed
复现读数: ssh orangevps 'df -h /'
```

**卡住的只有这一步**：同一次运行的本地 build、scp、远端 ① **全部成功** ⇒ ⛔ 不是工具链 / 网络 / 交付物 / aged-source 缺失。`_aged_source` 那条前置这次是**满足的**（源目录在，`.quay/runtime/bin/{quay,quay-native,quay-native.js,quay.js}` 在，实测）。⇒ 本 finding 的 `suggestedAction`「re-run producer upgrade-face on host B」在**它被写下的那一刻就已经不是一条完整的补救**。

**清盘后即可恢复**：一次运行需要 ~700M 副本 + ~120M npm 前缀 + 余量。本仓在 host B 上自建的可弃产物合计约 **9.5G**（8 个 `quay-verify-upgrade-*-root` 约 5.8G + `quay-ac-bm-copy-root`/`quay-dod-upgrade-*`/`quay-verify-coldstart` 约 1.9G + `.npm` 前缀若干）。⚠️ 但该机 96G 满盘的大头在**本仓之外**（`.cache` 12G、/tmp 13G、`.espressif` 9.6G、`.arduino15` 8.9G、`.vscode-server` 5.8G）⇒ **清盘是目标机运维动作（需人授权）**，⛔ 不由本 producer 或本仓库的例程代删。

### ⑤ 处置动作：把这条前置按 mapping **自己的机制**登记（本任务唯一的代码/配置改动）

`plugin/freshness-producers.json` 的 `upgrade-face` 条目补 `preconditions`（3 条，**落地的 commit = `2fb34ccd9`**）。本字段本就为该形态存在 —— 文件头 `_comment` 逐字：`preconditions` "exists because 're-run the producer' is not always a complete remedy: the session-delivery entry's subject only refreshes on a machine that already HAS a live session … Read it before filing a finding that says 'just re-run <producer id>'"。登记内容：目标机空余磁盘要求（附 `rm -rf`/`cp -a` 的**行号定位** `verify-deliver-coldstart.sh:1397/:1399`）、实测读数 + 一条命令的复现法、以及 ⚠️ **这是环境状态读数、⛔ 不是该 producer 固有属性**的显式标注（09-17 同一台机两次成功 ⇒ 是那之后才被写满的；要求引用时连同观测日期一起引）。

⛔ **未改 `wallclock_hours`**：失败运行测不出端到端 W（本次 2m 就死在 ⑦，把那 2m 写进去是错的），而 W **会移动探针阈值** —— 本文件自己警告过这个方向（under-estimate ⇒ finding 立案太晚 ⇒ 丢窗口）。⇒ 保持 0.38。

`node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts --root .` ⇒ `PASS — consistent — 7 observed subject(s), 7 registered`。

### ⑤b fork 点纠错（本任务自己造成的偏差，⛔ 如实记，不埋在 ⑤ 里）

本任务的 worktree 被我**从 `origin/develop` 创建**，而 `origin/develop` 停在**尚未合入 `develop`** 的 v0.10.0 release-cut 线上（`plugin/VERSION` = `0.11.0-dev`），本仓库的权威基线 `develop` 仍是 `0.10.0-dev`（两者分叉：`develop` 相对 `origin/develop` ahead 55 / behind 3）⇒ 本分支**平白带了 13 个 release-cut 文件**（VERSION / 各 `package.json` / marketplace / README / vendor / delivery-manifest / closure-ratchet baseline / package-lock）。

**判据（能取假）**：若任务分支正常都带这一族，`develop` 早就该是 `0.11.0-dev` —— 它不是 ⇒ 是 fork 点错，不是 develop 的问题。（`plugin/scripts/dispatch-worktree-setup.sh` 的 AC-284 自检要求分支 CUT FROM `develop`；它的 fork-point 检查把 `origin/develop` 也判成了 PASS ⇒ 顺带说明**该自检对「同仓另一条远程线」不敏感**，见 ⑦-4。）

**处置**：把分支重建为 `develop` + **唯一一个**只碰 `plugin/freshness-producers.json` 的提交（`reset --hard develop` → 重新落那一处改动 → `2fb34ccd9`）。其中「把 14 个文件退回 develop 内容」的那一步**只存在于被我丢弃的中间提交里**，因此**不会随 fan-in 进入 develop 的历史**。核验：
```
git diff --name-only develop HEAD   →  plugin/freshness-producers.json   （仅此一个）
git log --oneline develop..HEAD     →  2fb34ccd9                          （仅此一个）
scoped 门（--for-task … --allow-thin）→ 绿；缓存已按【实际验证过的】develop tip 写入
```

### ⑥ 本任务**未**做的事（⛔ 逐条，不以沉默代替）

- ⛔ **未在 host B 上删任何文件。** 删远端**他人共用机**上的文件是**对外、难逆**的动作，超出本任务授权 ⇒ 只报告 + 给读数。（诚实的可逆性说明，供授权者参考：那些 root 是 `cp -a` 的**派生副本**，源目录本仓从不写；且远端脚本每次先 `rm -rf $root` ⇒ 它们在设计上是**一次性靶子**、可由重跑再生。但这不改变「该机不是本任务的主场」这个判断。）
- ⛔ **未改走 host C。** host C（ad-arm1）磁盘健康（45G 用 23G、剩 23G），但**没有** designated aged source（`work/meta-cc-aged-ac238-copy` 不存在），且该机从未产出过 AC-238/239 记录 ⇒ 需要先跨机搬 ~700M 并把一条未验证路径扶正。记为**可选替代**，⛔ 不作为本任务结论。
- ⛔ 未改 `goals/`、未改 K、未改 `criterion`/`expect`、未动两个载体（md5 跑前跑后相同）、未改探针、未改探针阈值、⛔ 未改 develop。
- ⛔ 未把任务置为 `needs-human`：本 AC 的第二个分支（写明失败在哪一步）**已可满足**，⛔ 不拿「需要人授权清盘」当停全局的理由（硬规则 12：给不出发生率的阻塞不成立）。

### ⑦ 观察项（⛔ 无发生率读数、或因果未被检验者，一律不升为前置 —— 硬规则 12）

1. **本仓的产出者每跑一次就在目标机留一个 ~700M 的一次性 root，且换 tip 就不回收**（只对**同一个** tip 先 `rm -rf`）。实测 host B 现存 8 个、合计 ~5.8G ⇒ **发生率 8/8 = 100%**（读数在上）。⚠️ 但「它是把该机写满的**主因**」**未被检验**（该机同期还有别的项目在长）⇒ 按硬规则 4 推论四，**只报读数、⛔ 不报因果**。
2. **探针的 `suggestedAction` 在前置不满足时仍照写「re-run …」**：本 finding 的 `suggestedAction` 逐字如此，而它当场就失败了。⑤ 已把前置登记进 mapping，但**探针下一轮是否会读到并改写它尚未观测** ⇒ 观察项（发生率 1，且是要下一轮才谈得上的事）。
3. **Dedup 闸按文本去重**：同一底层 crossing 的 AC-238/239 是**一对**（同一次运行产出、同一 `project_root`），但本轮 `filing-round` 里 AC-239 被 **rate 闸**挡下（`rate: 3 routine-filed tasks this window ≥ cap 3`），只立了 AC-238 ⇒ 若 AC-238 被处置而 AC-239 没有，两个主体会**分叉**。本轮 AC-239 的处置由它自己的派发链负责，⛔ 本任务不代裁。
4. **`dispatch-worktree-setup.sh` 的 AC-284 fork-point 自检对「同仓的另一条远程线」不敏感**（⑤b）：从 `origin/develop` 创建的分支被判 PASS，而它与基线 `develop` 在 13 个 release-cut 文件上分叉。发生率：本任务 1 次（我按 prompt 字面用了 `origin/develop`）。⚠️ 未测「派发链自己创建 worktree 时用的是哪条 ref」⇒ ⛔ 不报因果、不立前置；仅记录该自检在此形态下**给不出区分**。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face.md`
- `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face-20260919.md`
