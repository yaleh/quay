---
id: gap-manager-start-tmux-session-name-not-path-derived
title: manager-start.sh 默认 tmux SESSION 硬编码字面量 "quay-manager"，跨同名 clone 存在碰撞/接管风险
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

`plugin/scripts/manager-start.sh:97` 在 `.quay/profiles.yml`/`plugin/.quay/profiles.yml` 都未配置 `roles.manager.name` 时，把默认 tmux 会话名写成字面常量 `SESSION="quay-manager"`，不按仓库根路径派生（对比 Core 的 `scopeUnitName`/`anchorUnitName`——`plugin/scripts/driver-runtime.ts:1493`——后者按 root 路径+时间戳派生，前者是纯字面量）。

`manager-start.sh` 是 `orchestration/SPEC-tmux-retirement-2026-09-03.md` §8 Layer 3b 裁定保留的"裸机冷启动备选路径"（非默认启用流程，但代码仍在、仍可被人工调用：`quay manager start` → `packages/quay/src/cli/manager.ts` → `manager-start.sh`）。

风险：如果生产检出和一个同名项目（project 概念都叫 "quay"，例如一个 dogfood/调试 clone）都落到这条裸机 fallback，且都没有在各自 `profiles.yml` 显式配置会话名，两者会在共享的 tmux server 上争抢同一个字面量 `quay-manager`——`manager-start.sh:160` 的 `tmux has-session -t "$SESSION"` 命中已存在会话时不会新建（`:159-170`），即后启动的一方可能附着到对方已建立的会话，而不是各自独立。

该风险在 2026-10-08 一次 dogfood-clone 隔离性核验会话（f96878f0-fff1-4415-8dbc-a31140e2a262）中被提出作为"anchor/driver 是否按项目名撞名"的担忧，但那次核验只验证了 anchor/driver（`scopeUnitName`，按路径+时间戳派生，确认安全）和 `.quay/config.yml`（无 `tmux_session` 键），**没有覆盖 `manager-start.sh` 这条独立的、字面量硬编码的裸机路径**——该路径的风险目前仍未被证伪或排除。

修复方向（现场设计，不是最终方案）：把默认 `SESSION` 名改为按仓库根路径派生一个短稳定值（复用 `scopeUnitName` 式手法：路径而非项目名/非固定常量），或者在 `tmux has-session` 命中时额外核验已存在会话所在 pane 的 cwd 是否确实对应本仓库根路径，不匹配则 fail-closed 拒绝接管并提示用户显式传 `--session`。

## AC

- [ ] 两个不同 `REPO_ROOT`（各自独立的 git 仓库，都不设置 `profiles.yml` 的 manager 会话名）各自触发 `manager-start.sh` 的默认会话名派生逻辑，得到的两个默认会话名不相等
- [ ] 若派生的会话名在 `tmux has-session` 上命中一个已存在的会话，脚本能区分"这是我自己之前建的（同一 root）"与"这是另一个 root 建的同名会话"，后一种场景下不静默附着/不静默复用，而是 fail-closed 报错并提示显式传 `--session`
- [ ] `plugin/test/manager-start.test.mjs` 新增/更新用例覆盖上述两条判据，`node --experimental-strip-types --test plugin/test/manager-start.test.mjs` 全绿

## DoD

`manager-start.sh` 落地后，对同一台宿主上两个不同 root 的仓库（即便都叫 "quay"）分别调用默认裸机冷启动路径，不再产生相同的 tmux 会话名；真实跑一次"两个 root 连续调用"的复现（而非只看单测），确认第二次调用不接管第一次建立的会话（报错或建出不同名字的会话），把这次真实复现的命令与输出记录在落地提交说明里。

## Touches

- plugin/scripts/manager-start.sh
- plugin/test/manager-start.test.mjs
- tasks/gap-manager-start-tmux-session-name-not-path-derived.md
