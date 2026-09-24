---
id: gap-serve-sessions-body-i18n-red-only-under-full-ci-concurrency
title: serve-sessions-body-i18n.test.mjs 只在 CI 全量并发下红、单跑 12/12 绿——先取证再归因
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

`packages/quay/test/serve-sessions-body-i18n.test.mjs` 只在 CI 全量并发下红、单跑绿：

- **CI 侧（上一轮观察，⚠️ 本轮未能复核）**：develop CI 的 `test` job 中，该文件跑到第 7 个用例中止（约 460ms，位置在起 live server 处）。本轮试图取原始日志复核：`gh api --allow-escape-sequences /repos/yaleh/quay/actions/jobs/107535642743/logs` 返回 `404 BlobNotFound` ⇒ 该日志已不可得。**所以「第 7 个用例 / 起 server 处」目前只是假说，不是结论**（硬规则 4 推论四）。
- **本地单跑（本轮实测）**：`node --test --test-reporter=tap --experimental-strip-types packages/quay/test/serve-sessions-body-i18n.test.mjs` ⇒ `tests 12 / pass 12 / fail 0`，2.0s。
- **载体侧**：`.quay/ci-runs.jsonl` 里 develop 最近 6 条 CI 记录全部是 `attribution=real-defect`（`defect:tests-ran-and-failed`），但载体没有按文件的失败读数，无法从载体确认红的就是这个文件。

与本仓库已知形态的相似性（**只作为待检验的假说**）：起 live server 的 fixture 在高并发下端口/启动超时饿死（`fixture-spawnsync-timeout-starves-under-loaded-suite`）、或泄漏 serve 形子进程改变拒绝模式（`leaked-serve-shaped-fixture-child-flips-the-refusal-mode`）。

## AC

- [ ] 取证：一次 develop CI（或本地 `scripts/test.sh` 全量）运行的**原始日志**被保存进本任务 Evidence，逐字含该文件失败用例名 + 首条决定性错误行；取不到 ⇒ 本任务停在取证，不进入修复
- [ ] 复现：本地用 `scripts/test.sh` 全量（同 CI 泳道与并发推导）至少复现一次该文件的失败，并记录复现率 k/N（N ≥ 5）
- [ ] 归因对照：给出成因 Y，并附一个「若 Y 为假则结果不同」的对照（例：给 fixture 的启动超时加余量后复现率降为 0/N；或去掉并发后 0/N 而恢复后 ≥1/N）
- [ ] 修复后：同一全量命令 N ≥ 5 次中该文件 0 失败；单跑仍 12/12

## DoD

落地后 develop 上至少一次 decisive CI run 的 `test` job 里，该文件的 `__PERFILE__` 行 `passed=true`（从该 run 的 job 日志逐字取，日志须在 blob 过期前落进 Evidence）。若 `test` job 仍红，但红来自别的文件，如实列出，不把「本文件已绿」写成「CI 已绿」（CI 首绿另受 hosted-runner job 迁移影响，见 AC-319）。

## Touches

- tasks/gap-serve-sessions-body-i18n-red-only-under-full-ci-concurrency.md
- packages/quay/test/serve-sessions-body-i18n.test.mjs
