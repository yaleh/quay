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

- [ ] AC1（能取假，明显运行时产物清出跟踪）：`test.sh.lock` / `full-suite-state.json.suitefix-bak` / `no-code-caller-triage.jsonl` / `no-code-caller-triage-rescan.jsonl` / `suite-bucket-reattribution.jsonl` 5 个 `git rm --cached` 去跟踪 + `.gitignore` 追加；（⛔ 仍 `git ls-files` tracked ⇒ 假）。
- [ ] AC2（能取假，可能故意的逐个判）：`profiles.yml` / `outer-inflight-coordination-20260812.md` / `red-on-omission-manifest.md` 3 个逐个判定「该跟踪」或「该清理」，判定理由写进任务 Evidence；（⛔ 盲清或不清且无理由 ⇒ 假）。
- [ ] AC3（能取假，清后不脏）：清理后 `git status --porcelain` 对这些文件不再显示（去跟踪的文件也不作为 untracked 出现，因已 gitignore）；（⛔ 仍脏 ⇒ 假）。

## Definition of Done

5 个明显运行时产物去跟踪 + gitignore；3 个可能故意的逐个判定并留理由；清理后 git status 干净。

## Touches

- .gitignore（追加 5-8 条 `**/.quay/<name>`）
- tasks/gap-quay-runtime-files-tracked-but-shouldnt.md（自身）
