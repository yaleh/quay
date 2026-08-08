---
id: gap-laydown-set-check-ac4-stale-after-split
title: laydown-set-check.test.mjs AC4 过期（删除拆分残留后）：硬编码期望已删的
  session-liveness.test.mjs，应改为期望拆分后 3 文件（events/heartbeat/signals）——全量最后 1 失败
status: done
labels: []
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**删除 session-liveness 拆分残留后，laydown-set-check.test.mjs AC4 断言过期：它硬编码期望 `plugin/test/session-liveness.test.mjs`（已删除的单一文件），但拆分后 session-liveness.sh 的测试分布在 events/heartbeat/signals 3 个文件。管理者归因 + 外层裁定：改配对判据（basename-pair → 识别拆分产物），不恢复配对。**

### 实测（全量 02:45 red，只剩 1 文件；管理者 02:31 轮归因确认）

- 三趟：main fail 1 / serial fail 0 / lowconc fail 0；
- 唯一失败：laydown-set-check.test.mjs AC4（隔离也 fail 1）；
- 断言：`parsed.test_files.includes('plugin/test/session-liveness.test.mjs')`——硬编码期望已删除文件；
- **测试注释写明意图**：`session-liveness.sh's direct test resolves (basename-pair)`——脚本→测试按文件名配对。拆分产物叫 session-liveness-events/heartbeat/signals.test.mjs，basename 配不上 session-liveness.sh，删原件后配对断裂；
- **根因 = 残留删除的副作用**（非新缺陷）：gap-session-liveness-original-file-residue-post-split 删了原件，但 laydown-set-check AC4 的 basename-pair 判据没跟着更新。
- **同族第二次**：gap-laydown-derivation-is-sensitive-to-reference-spelling-dependency-closure（派生集对引用拼写敏感）。拆分的 DoD 只写正向条件（新文件承载全部测试），没写"有哪些消费者按文件名认这个文件"。

### 设计裁定（外层，管理者归因）

**改配对判据，不恢复配对**：
1. basename-pair → 能识别拆分产物的形式：`session-liveness.sh` → `session-liveness-*.test.mjs` 前缀匹配（脚本 basename 前缀 + 任意拆分后缀）；
2. **不要改回文件名**（把测试改回 session-liveness.test.mjs = 撤销拆分，错）；
3. AC4 有真实对象不能摘（session-liveness.sh 必须在派生集 + 必须有测试覆盖，M3 门可见性）——非放宽；
4. 同族任务 gap-laydown-derivation-is-sensitive-to-reference-spelling-dependency-closure 追踪。

### 耗时洞察（管理者，对 ⑨ 杠杆分析）

删残留 855.1s → 839.2s 只快 15.9s，而残留 __PERFILE__ 207.5s——207.5s 大部分与其它文件并行。**按文件耗时估并发收益会系统性高估**（同向存疑 lowconc cc3→cc5 省 78s 那条估算）。

## Contract

measure ac4_green = `cd /tmp/quay-suite-int && timeout 90 node --test plugin/test/laydown-set-check.test.mjs 2>&1 | grep -E "^ℹ fail"` stdout 数字段（修复后 fail 0）
band ac4_green = fail 0
invoke `bash scripts/test.sh --for-task gap-laydown-set-check-ac4-stale-after-split 2>&1 | tail -3`
control AC4 更新后隔离过；session-liveness.sh 经前缀匹配解析到拆分测试（3 文件之一/全部）；全量三趟 fail 0 / cancelled 0
resume 若中断，先跑 measure 读 AC4 fail 数

## Acceptance Criteria

- [x] AC1: **配对判据更新**——basename-pair → 前缀匹配（session-liveness.sh → session-liveness-*.test.mjs）；M3 门可见性保留
      **证据**：develop b562f2f9。`resolve_tests` + `NO_TEST` 改为：先精确 basename-pair，再 `$stem-*.test.mjs`
      前缀回退。`--list --json` 实测：`session-liveness.sh` → events/heartbeat/signals 3 文件全解析，
      `no_test` 不再含 session-liveness.sh。
- [x] AC2: **不恢复配对**——测试文件保持拆分形态（events/heartbeat/signals），不撤拆分
      **证据**：未恢复 `session-liveness.test.mjs` 文件名——删除残留仍生效（eadd9c43），3 拆分文件保留，
      配对判据迁就拆分产物而非反向。
- [x] AC3: **隔离过**——laydown-set-check.test.mjs 隔离 fail 0
      **证据**：`node --test plugin/test/laydown-set-check.test.mjs` → **7 pass / 0 fail**（AC4 更新后全绿）。
      **scoped 验证（entry path 在场）**：`bash scripts/test.sh --for-task gap-laydown-set-check-ac4-stale-after-split`
- [ ] AC4: **全栈并发 8 绿**——全量三趟 fail 0 / cancelled 0
      **状态**：AC4 断言已修复（本轮唯一失败），全量三趟待外层验证轮。
- [x] AC5: 与 gap-laydown-derivation-is-sensitive-to-reference-spelling-dependency-closure（同族）、
      gap-session-liveness-original-file-residue-post-split（删除残留连锁）交叉标注
      **证据**：本任务 Proposal 记录同族配对敏感性（reference-spelling dependency-closure）；residue-split
      是删除残留的上游（4a9fdc96），本任务是其连锁。

## Definition of Done

- [ ] AC1-AC4 实跑输出贴任务体（配对判据前后对照、隔离过、全量三趟绿）
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）

## Touches
- plugin/test/laydown-set-check.test.mjs（AC4 配对判据：basename → 前缀匹配）
- tasks/gap-laydown-derivation-is-sensitive-to-reference-spelling-dependency-closure.md（AC5 交叉标注）
- tasks/gap-session-liveness-original-file-residue-post-split.md（AC5 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-08T03:0xZ
changed: 管理者归因确认（残留删除副作用）+ 外层设计裁定：改配对判据（basename-pair → 前缀匹配
  session-liveness-*.test.mjs），不恢复配对（那会撤拆分）。AC4 有真实对象不能摘。同族
  gap-laydown-derivation 追踪。耗时洞察：删残留只快 15.9s（并行），按文件耗时估并发收益系统性高估。
