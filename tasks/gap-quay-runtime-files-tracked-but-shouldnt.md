---
id: gap-quay-runtime-files-tracked-but-shouldnt
title: .quay/ 8 个运行时文件被误提交（tracked-but-shouldn't）——git rm --cached + gitignore 清理（不脏检出、不挡 ff，纯卫生）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`.quay/` 下 8 个文件是 **TRACKED（已提交进 git）** 的运行时产物，本不该进版本控制（已用 `git ls-files` 逐个确认，manager 抽 4 个复核属实）。与 `message-receipts.jsonl` 那次不同（那是 UNTRACKED、脏检出挡 `fan-in-ff-merge`），这些是 TRACKED——**不脏检出、不挡 ff**，纯「误提交」卫生问题，正常池序即可。

8 个文件分两类：
- **明显运行时产物（应清）**：`test.sh.lock`（锁文件）、`full-suite-state.json.suitefix-bak`（备份）、`no-code-caller-triage.jsonl` + `no-code-caller-triage-rescan.jsonl`（运行时 jsonl）、`suite-bucket-reattribution.jsonl`（运行时 jsonl）——共 5 个。
- **可能故意跟踪（逐个判）**：`profiles.yml`（近期改过 08-25）、`outer-inflight-coordination-20260812.md`（带日期的记录）、`red-on-omission-manifest.md`（manifest）——共 3 个，可能是故意跟踪的配置/记录。

根因（同 `message-receipts` 那次）：`.gitignore` 对 `.quay/` 运行时文件是**逐条列**（约 60 条 `**/.quay/<name>`，无目录级通配），新运行时文件漏列就会要么脏检出（untracked）要么被误提交（tracked）。

## Plan

`git rm --cached <file>`（去跟踪、留盘上文件）+ `.gitignore` 追加对应 `**/.quay/<name>`。范围：5 个明显运行时产物一次性清；3 个可能故意的逐个判「该跟踪/该清理」并写明理由，⛔ 不盲清。

## Acceptance Criteria

- [x] AC1（能取假，明显运行时产物清出跟踪）：`test.sh.lock` / `full-suite-state.json.suitefix-bak` / `no-code-caller-triage.jsonl` / `no-code-caller-triage-rescan.jsonl` / `suite-bucket-reattribution.jsonl` 5 个 `git rm --cached` 去跟踪 + `.gitignore` 追加；（⛔ 仍 `git ls-files` tracked ⇒ 假）。
- [x] AC2（能取假，可能故意的逐个判）：`profiles.yml` / `outer-inflight-coordination-20260812.md` / `red-on-omission-manifest.md` 3 个逐个判定「该跟踪」或「该清理」，判定理由写进任务 Evidence；（⛔ 盲清或不清且无理由 ⇒ 假）。
- [x] AC3（能取假，清后不脏）：清理后 `git status --porcelain` 对这些文件不再显示（去跟踪的文件也不作为 untracked 出现，因已 gitignore）；（⛔ 仍脏 ⇒ 假）。

## Definition of Done

5 个明显运行时产物去跟踪 + gitignore；3 个可能故意的逐个判定并留理由；清理后 git status 干净。

## Touches

- .gitignore（追加 5 条 `**/.quay/<name>`）
- tasks/gap-quay-runtime-files-tracked-but-shouldnt.md（自身）
- .quay/test.sh.lock（git rm --cached 去跟踪）
- .quay/full-suite-state.json.suitefix-bak（git rm --cached 去跟踪）
- .quay/no-code-caller-triage.jsonl（git rm --cached 去跟踪）
- .quay/no-code-caller-triage-rescan.jsonl（git rm --cached 去跟踪）
- .quay/suite-bucket-reattribution.jsonl（git rm --cached 去跟踪）

## Evidence（inner 落盘 2026-08-25，impl 完成）

### AC1 — 5 个明显运行时产物去跟踪 + gitignore

`git rm --cached`（去索引、留盘上文件）5 个文件：

- `.quay/test.sh.lock`（scripts/test.sh 单飞锁）
- `.quay/full-suite-state.json.suitefix-bak`（suite-fix 备份）
- `.quay/no-code-caller-triage.jsonl`（gap-ac111 三选一判定落盘）
- `.quay/no-code-caller-triage-rescan.jsonl`（gap-ac111 复扫）
- `.quay/suite-bucket-reattribution.jsonl`（gap-ac121 测试桶重归属落盘）

`.gitignore` 追加 5 条 `**/.quay/<name>`（:282-286）。验证：`git ls-files` 对这 5 个零命中
（不再 tracked）；`git check-ignore -v` 对 5 个各自命中对应行（已 gitignore）；盘上文件仍在
（`git rm --cached` 不删盘）。

### AC2 — 3 个可能故意的逐个判（全部判「该跟踪」，理由如下）

1. **`.quay/profiles.yml` → 该跟踪**。这是 L2 profile policy 的 **tracked 正本（config，非运行时产物）**：
   `verify-delivery-surface.ts:99` 把它列为 product deliverable（与 `.claude/launch.settings.json`、
   `quay-launch.sh` 并列），`quay-init.sh:716/2020` 把它作为默认模板铺入消费者 `.quay/`，
   `quay-launch.sh` + `profile-policy.ts` 启动时消费它（launcher/model/--bare/-n/unset 全部来自
   profiles.yml）。fresh checkout 需要它。与 gitignored 的 `/.quay/config.yml`（:312，机器本地
   provider map）不同，profiles.yml 是机器无关的 policy 配置，由 gap-ac154 / gap-profile-policy
   任务故意提交。
2. **`.quay/red-on-omission-manifest.md` → 该跟踪**。静态 manifest，文件自述「本清单是它们的
   **tracked 正本**——red-on-omission-audit 检查器机械核对的是『清单 + 执行核里 DECLARED 的读数』，
   不是这些运行时文件本身（fresh checkout 没有它们）」。grep 零运行时写者（无代码写它），
   gap-ac41 任务故意提交。fresh checkout 需要这份 manifest 才能跑审计。
3. **`.quay/outer-inflight-coordination-20260812.md` → 该跟踪**。带日期的**协调记录（record，非
   运行时产物）**：由 outer 手工写 handoff、三次故意提交（`daa95187`/`3aa0f75c`/`dc6fc99a`，
   commit message 均「handoff 刷新」），目的 ADR-009「须跨压缩存活」（把协调状态钉进 git 以免
   session 压缩丢失）。grep 零运行时写者。内容含已完成弧线/关键机制发现等历史价值；虽已过期
   （08-12、引用已完成的 round 59-66），但过期 = 历史记录，不等于误提交——git 历史就是记录的归宿。
   与 gitignored 的心跳类（每 tick 由代码重写）不同，它是手工写、故意提交的协调状态。

**结论**：3 个都不清——profiles.yml（config 正本）/ red-on-omission-manifest.md（manifest 正本）/
outer-inflight-coordination-20260812.md（dated 协调记录）全是故意跟踪，非误提交。只清 AC1 的 5 个
明显运行时产物。

### AC3 — 清后不脏

`git status --porcelain` 对这 5 个文件**无 `??` untracked 条目**（已 gitignore）；唯一相关条目是
`D  .quay/<name>`（`git rm --cached` 的 staged 删除——这是本任务的**改动本身**，非脏）与
` M .gitignore`（本任务的 gitignore 追加）。commit 后（删除落库 + gitignore 生效）porcelain 对这
5 个文件不再显示任何条目。
