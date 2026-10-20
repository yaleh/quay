---
id: gap-release-cut-preflight-misses-shipped-set-size-ceiling-until-the-tag-is-pushed
title: release-cut 的 preflight 不预检产物体积上限：注定失败的发布要等 tag 推出去之后才被 release.yml 第 13
  步发现（v0.20.0、v0.21.0 连续两次）
status: todo
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

**来源**：v0.21.0 发布事故（2026-10-20）。

**机制（按位置）**：`shipped-set-clean` 的体积上限只在发布时执行（`plugin/scripts/verify-plugin-channel-assertions.ts`，release.yml 的 `verify-plugin-channel` 第 13 步）。`plugin/scripts/release-cut.mjs` 的 preflight 没有对应预检，所以 tag 已经推送、release.yml 已经派发之后才发现产物超限。基线是从 tag 自己的树里读的（release.yml 检出 `inputs.tag`），所以失败之后无法靠在 develop 上补一个提交来救同一个 tag，只能再切新版本；而 tag 一旦推送就是对外可见的。

**后果（实测）**：v0.20.0（2026-10-16）与 v0.21.0（2026-10-20）连续两次因同一条断言失败（`files 287 > ceiling 286`）。v0.20.0 失败之后没有任何后续：之后有人单独发布了 dist-plugin（`publish-plugin-dist` 是独立 workflow，不跑这道门），结果 tag 与 dist-plugin 是 0.20.0，却没有 GitHub Release，`master` 停在 v0.19.0，这样放了 4 天。

**可行性已验证**：本机在一个 detached worktree 里用 release.yml step 5 的同一条命令（`bash plugin/scripts/publish-dist-branch.sh --branch <scratch>`，不带 `--push`）构建，`git archive` 该分支再跑 `node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --check <dir> --size-ceiling`，得到 287 个文件、exit 1，与 CI 完全一致。所以预检不依赖 CI。

**做法**：在 `release-cut.mjs` 的 preflight（创建 release 分支与推送任何 ref 之前）对 `--base` 的树做上述本机构建与检查：
- 超限：拒绝，独立原因 `CAUSE=release-cut-shipped-set-ceiling-exceeded`，输出测得文件数、基线上限，并给出重新锚定命令；
- 构建或检查无法执行：独立原因 `CAUSE=release-cut-shipped-set-precheck-unavailable`，⛔ 不得与通过共用输出（硬规则 3b）；
- 通过：打印一行读数（测得文件数 / 上限）；
- 提供显式放行开关，写法对照既有的 `--allow-workflow-drift`，放行时仍打印读数；
- `--dry-run` 同样执行预检，但执行后不得留下任何 ref、worktree 或分支（构建用的临时 worktree 与临时分支在成功和失败路径上都要清理）。

**不在本任务范围**：重新锚定基线本身（另有任务）；把体积门接进 CI 的定期执行（该门要求非 -dev 产物，而 develop 产物必带 -dev，不可直接搬）；红灯率调查。

## AC

- [ ] AC0（真实路径，超限）：在 `plugin/test/release-cut.test.mjs` 现有的夹具框架里新增用例，让预检在**真实调用路径**上遇到超限产物，断言 `release-cut.sh` 以非零退出、输出含 `release-cut-shipped-set-ceiling-exceeded`、没有创建 tag、没有留下 worktree 或分支；⛔ 不得只单独调用拼文案的函数
- [ ] AC1（真实路径，不可用）：新增用例让构建或检查无法执行，断言输出含 `release-cut-shipped-set-precheck-unavailable`，且该输出与通过时的输出不同
- [ ] AC2（真实路径，通过）：新增用例在上限充足时预检通过并打印读数，后续步骤照常进行
- [ ] AC3（变异对照）：把预检改成永远通过，AC0 的用例必须变红；把变红输出贴进 `## Evidence`
- [ ] AC4（真实仓库读数）：在一份临时拷贝的夹具根上（⛔ 不得改动并提交真实的 `plugin/shipped-set-baseline.json`）把 `shipped.files` 调低 1，运行 `bash plugin/scripts/release-cut.sh <X.Y.Z> --dry-run`，必须以新原因拒绝；对未改动的树运行同一命令必须通过；两次输出都贴进 `## Evidence`
- [ ] AC5（不留残渣）：AC4 的两次运行前后对比 `git for-each-ref`、`git worktree list`、`git branch`，无新增；贴对比输出
- [ ] AC6（不回归）：`plugin/test/release-cut.test.mjs` 全部通过，贴 exit 码
- [ ] AC7（读生产载体）：下一次真实切版时，preflight 在推送 tag 之前打印了体积预检的读数，贴该次切版日志中的对应行（待外部）

## DoD

真实落地：下一次真实切版时，如果产物超限，`release-cut.sh` 在创建分支、推送 tag 之前就以 `release-cut-shipped-set-ceiling-exceeded` 拒绝，不再出现“tag 已推出去、release.yml 才在第 13 步失败”的情形；若预检本身无法执行，会以独立原因说明，而不是静默通过。仅“测试存在”不算达标。

## Touches

- plugin/scripts/release-cut.mjs
- plugin/test/release-cut.test.mjs
- tasks/gap-release-cut-preflight-misses-shipped-set-size-ceiling-until-the-tag-is-pushed.md
