---
id: gap-real-install-family-build-dedup-once-per-suite
title: real-install 族构建去重：build-dist+npm pack 每测试各跑一遍 → once-per-suite 共享产物
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

全量轮实测：release-cut.test.mjs 仍 654.7s（`floor_ms=654704`，suite 最长文件），先前的 clone 去重无效——根因是每个测试的 shipped-set 构建（`publish-dist-branch.sh` → build-dist + npm pack，每个 ~35–40s）主导成本，clone 只是零头。证据：release-cut 的 "AC4 CI three-valued" 单测 169.4s = 5 次 `--dry-run` 各真构建一次。同族测试（npm-pack-e2e、shipped-set、shipped-shell-reachability、verify-deliver-coldstart、build-plugin-dist、release-cut）各自独立 build-dist + npm pack，重复构建同一产物。把构建改成 once-per-suite 共享：before() 构建一次，各测试消费同一 tarball/dist。

<!-- dedup-ref --> 相关但不同机制，不合并：gap-suite-memory-host-fraction-0-25-to-0-5（内存护栏，已 done）、gap-release-cut-test-613s-fixture-clone-dedup（clone 去重，已证明无效）。

## Plan

1. 枚举所有独立调用 `package.sh` / `build-dist` / `npm pack` 的测试文件（grep + 列清单）。
2. 新增一个共享构建 helper（`before()` 一次性 build+pack 到 fixture 目录；各测试消费产物，不再各自构建）。
3. 逐个改造上述测试文件，改用共享产物；保留各自需要独立构建的负向臂（如「构建失败」类测试）除外。
4. 验证：全量轮 release-cut 时长显著低于 654.7s，real-install 族各文件时长下降。

## Acceptance Criteria

- [ ] `grep -rlE "package\.sh|build-dist|npm pack" plugin/test packages/quay/test` 列出的构建调用点清单贴进本任务 evidence（非空、且覆盖 release-cut/npm-pack-e2e/shipped-set/shipped-shell-reachability/verify-deliver-coldstart/build-plugin-dist 中至少 4 个）
- [ ] 共享构建 helper 落地：`before()` 构建一次，被改造的测试消费同一产物（grep 显示 `before(` 里 build 调用、测试体里改为引用共享路径）
- [ ] 负向臂保留：需要「构建失败 / 产物不可用」的测试（如 AC1 precheck-unavailable）仍独立构建，不在共享之列（grep 证明）
- [ ] 全量轮 `__PERFILE__` 里 release-cut duration_ms 显著低于 654704（记录新值）

## Definition of Done

once-per-suite 共享构建落地，real-install 族不再每测试重复 build+pack；全量轮 release-cut 时长显著下降；负向臂（构建失败类）未被共享化吞掉。

## Touches

- plugin/test/release-cut.test.mjs
- packages/quay/test/npm-pack-e2e.test.mjs
- plugin/test/shipped-set.test.mjs
- plugin/test/shipped-shell-reachability.test.mjs
- plugin/test/verify-deliver-coldstart.test.mjs
- packages/quay/test/build-plugin-dist.test.mjs
- tasks/gap-real-install-family-build-dedup-once-per-suite.md
