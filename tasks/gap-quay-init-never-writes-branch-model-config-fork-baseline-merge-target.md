---
id: gap-quay-init-never-writes-branch-model-config-fork-baseline-merge-target
title: "quay-init.sh's config-generation heredoc (write_provider_config, line
  558-583) NEVER writes fork_baseline/merge_target — grep 'fork_baseline' and
  'merge_target' plugin/scripts/quay-init.sh = 0 hits; a brand-new host running
  quay-init --loop today gets loop:{repo_root,test_command,
  tmux_session,worktree_root} ONLY, so dispatch falls back to the pre-cutover
  master-only model (gap-dispatch-fork-does-not-read-config-fork-baseline AC4
  even names this 'shared default unchanged' as the ACCEPTED negative-control
  state, not a laydown gap); every host with the key today (A, B,
  ad-arm1/machine-C) got it via manual/ad-hoc edit, never via the mechanism —
  manager reproduction-lens probe 2026-08-06 (ad-arm1 real check: config HAS the
  keys, but git-blame- equivalent traces to manual setup, not quay-init;
  quay-init.sh source has zero mentions)"
status: ready
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**分支切换模型不会传给下一个主机——quay-init.sh 从不写 `fork_baseline`/`merge_target`。**

**【实测（管理者繁殖视角提问，2026-08-06）】**：

- `grep -n "fork_baseline\|merge_target" plugin/scripts/quay-init.sh` → **0 命中**。
- `write_provider_config()`（`plugin/scripts/quay-init.sh:558-583`）生成的 `.quay/config.yml` 只有
  `providers:` 和 `loop: {repo_root, test_command, tmux_session, worktree_root}` 四个字段——
  没有 `fork_baseline`、`merge_target`，也没有 `gates:`/`board:`。
- 今天在 ad-arm1（machine C）上实测：其 `.quay/config.yml` **确实有** `fork_baseline: develop` /
  `merge_target: integration`——但这是管理者搭建时手工从 A 复制/补写的，不是 `quay-init --loop`
  自己生成的（源码零命中即是证据）。A、B 两台机器同理，都是分支切换当晚人工/管理者手改。
- `.quay/config.yml` 是 gitignored（`017e41d3` 已确认，root-anchored），**不会**通过 `git clone`/
  `git pull` 自动带到新主机——它只能来自 quay-init 生成，或人工/管理者手改。**当前两条路都不写
  这两个键**。

**【性质】**：这正是繁殖视角要问的——"这条改动能不能完整传给下一个主机？不能的话缺哪一段遗传物质？"
答案：**缺**。今晚的分支切换模型（develop/integration 取代 master）目前只存在于**三台已被人工/
管理者手动配置过的主机**上；任何第四台跑标准 `quay-init --loop` 安装流程的新主机，会得到一个
**没有这两个键的 config**，dispatch 因此静默回落到旧的 master-only 模型（`gap-dispatch-fork-does-
not-read-config-fork-baseline` AC4 甚至把这个状态命名为"共享默认不变"的**负控制预期结果**，
而不是当作铺设缺口）。

**与 `gap-dispatch-fork-does-not-read-config-fork-baseline` 的区别**：那条任务问"config 有这两个键
时，fork 动作会不会读"（该任务结论：读，不复现）；本任务问"新主机第一次铺设时，这两个键会不会
被写进去"（答案：不会，从未被 quay-init 写过）——**两条任务在铺设链路上前后相邻，缺一段就都白搭**。

### 选定机制（留执行时定）

1. `write_provider_config()` 的 heredoc 里加 `fork_baseline: develop` / `merge_target: integration`
   （随 quay-init 版本升级默认值，而不是硬编码 `master`——与 SPEC-branching-model 的当前裁定一致）；
2. 或：`loop:` 块下新增一段注释，明确"这两个键是可选覆盖，缺省即 master-only 旧行为"——但那与人
   2026-08-05/06 的裁定（develop/integration 是当前唯一工作分支）矛盾，**不建议**这条。

## Acceptance Criteria

- [x] AC1: 全新工作区跑 `quay-init.sh --loop`（`--dry-run` 或真实沙盒均可），生成的
      `.quay/config.yml` 含 `fork_baseline`/`merge_target`，贴出实跑输出
- [x] AC2: 负控制——改前（当前源码）跑同一条命令，确认两键**不存在**（证明 AC1 是修复生效，不是
      巧合）
- [x] AC3: 已手工配置过的三台主机（A/B/ad-arm1）不受影响——升级路径（`ensure_loop_config`/
      `migrate_stale_mcp_entry` 分支）不覆盖已存在的正确值
- [x] AC4: 与 `gap-dispatch-fork-does-not-read-config-fork-baseline` 交叉标注——本任务补上"新主机
      第一次铺设"这一段，那条任务负责"铺设后 dispatch 是否读"

## Definition of Done

- [x] AC1-AC4 实跑输出贴进任务体（quay-init --loop 生成的 config 含 fork_baseline/merge_target 两键，实跑输出贴出）
- [ ] 完整套件连跑 2 次全绿（inner 执行纪律要求不跑全量套件——由 outer 验证轮承接）
- [x] grep 可证 write_provider_config heredoc 含两键；已配置主机升级路径不覆盖已存在正确值（AC3 负控制）

## Contract

measure   config_keys = `grep -c 'fork_baseline\|merge_target' plugin/scripts/quay-init.sh` 输出的计数
band      config_keys = ≥ 2（write_provider_config heredoc 写两键）
invariant negative_control = 1（改前同一命令两键不存在——AC2 实跑证明）
invariant upgrade_safe = 1（已配置主机升级路径不覆盖已存在正确值——AC3）
invoke    `bash scripts/test.sh --for-task gap-quay-init-never-writes-branch-model-config-fork-baseline-merge-target`
control   scoped 门绿；AC1/AC2 实跑输出贴任务体
resume    heredoc 加键 + 负控制 + 升级路径测试分步提交

## Touches
- plugin/scripts/quay-init.sh
- tasks/gap-dispatch-fork-does-not-read-config-fork-baseline.md（交叉标注）
- tasks/gap-quay-init-never-writes-branch-model-config-fork-baseline-merge-target.md（自身）

## Execution evidence (inner, 2026-08-11)

**AC2 负控制（改前源码）** — 从改前 quay-init.sh 提取真实 `write_provider_config()`，对全新沙盒跑实（heredoc 本体，非重写）：

```
===== generated .quay/config.yml (loop: section) =====
loop:
  repo_root: /tmp/ac2-negctrl-smkMwV
  test_command: node --test
  tmux_session: proj-0:0.0
  worktree_root: /var/tmp/quay-wt-ac2-demo
===== grep for fork_baseline/merge_target in generated config =====
NO MATCH — both keys ABSENT (exit=1)
```

源码级：heredoc 区域（改前 647-672 行）`grep fork_baseline\|merge_target` = 0 命中；全文件仅 :159/:462 两处**注释**提及（描述"升级必须保留这些键"，非写入）。

**AC1 修复生效（改后）** — 同一真实函数改后重跑：

```
===== generated .quay/config.yml (loop: section) =====
loop:
  repo_root: /tmp/ac1-posctrl-E92S41
  test_command: node --test
  tmux_session: proj-0:0.0
  worktree_root: /var/tmp/quay-wt-ac1-demo
  fork_baseline: develop
  merge_target: integration
===== grep =====
29:  fork_baseline: develop
30:  merge_target: integration
```

Contract measure：`grep -c 'fork_baseline\|merge_target' plugin/scripts/quay-init.sh` = **6**（band ≥ 2）。写入位点：quay-init.sh:676-677（`fork_baseline: develop` / `merge_target: integration`，随版本默认，非硬编码 master）。

**AC3 升级安全** — 模拟 ad-arm1 手工配置（fork_baseline: develop / merge_target: integration / board / gates / concurrency_bands），跑真实升级分支 `ensure_loop_config` + `migrate_stale_mcp_entry`：升级后 branch-model 两键 + board/gates/concurrency_bands **原样保留**；仅 provider path/mcp_entry 被迁移（dangling 路径）。`grep -n "fork_baseline\|merge_target"` 升级后 = :18/:19 仍在。

**AC4 交叉标注** — 见 `gap-dispatch-fork-does-not-read-config-fork-baseline.md` 的 Execution note：本任务补"新主机第一次铺设"段，那条任务负责"铺设后 dispatch 是否读"——铺设链路上前后相邻，缺一段都白搭。

**Scoped 门** — `bash scripts/test.sh --for-task gap-quay-init-never-writes-branch-model-config-fork-baseline-merge-target`：scoped 静态检查全 PASS（task-contract-check / adr016-screen-use-check / superseded-capability-check / dead-code-after-return-check / tick-core-static-check / delivery-inventory-drift-gate）；选中测试 `plugin/test/quay-init.test.mjs` 4/4 绿。另直跑 `plugin/test/quay-init-loop-core.test.mjs` 12/12 绿（含新增 `fork_baseline: develop` / `merge_target: integration` 回归断言，pin 住 AC1 非巧合）。

## Dispatch review

reviewer: none
at: 2026-08-09
changed: 无（本任务补 ## Contract 六键晋级 Contract，非新派发，无 review 记录）
