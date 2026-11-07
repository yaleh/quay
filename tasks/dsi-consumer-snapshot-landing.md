---
id: dsi-consumer-snapshot-landing
title: "DSI: land pinned consumer snapshot"
status: ready
labels:
  - dsi
  - integration
parent: null
children: []
extra: {}
---
## Proposal

quay 需要消费 DSI 的 pinned snapshot：`docs/analysis/dsi/` 下恰好四个契约文件（`SNAPSHOT.json` / `atoms.json` / `coverage.json` / `status.json`），quay 侧只读静态 JSON、零运行时依赖。该目录在 quay 仓从未落地，因此消费者校验一直红。本任务用仓外生产者 `/data/home/yale/work/quay-dsi/integrations/quay/snapshot-build.mjs` 把用户级 DSI store 投影进本仓并提交；源 store 全程只读，本仓只写 `docs/analysis/dsi/`。

## Plan

1. 在本任务 worktree 根执行生成命令（源 store 只读，指针固定；`--consumer-commit` 取生成时的 HEAD，即本次提交的父提交）：

```bash
node /data/home/yale/work/quay-dsi/integrations/quay/snapshot-build.mjs \
  --dsi-root /data/home/yale/.claude/domain-semantic-induction \
  --domains quay-dev,gate-result-validity \
  --out docs/analysis/dsi \
  --migrate-v0 \
  --now 2026-11-07T00:00:00.000Z \
  --consumer-commit "$(git rev-parse HEAD)"
```

2. 用消费者校验器验收本 worktree：

```bash
node /data/home/yale/work/quay-dsi/integrations/quay/verify-consumer.mjs --quay "$(pwd)"
```

必须 exit 0 且输出 `PASS: 19/19 checks`。

3. 确定性复现：用同一 `--now` 与 `--consumer-commit` 再把输出生成到临时目录，`diff -r docs/analysis/dsi <tmp>` 必须为空（byte-identical）。

4. 提交 `docs/analysis/dsi/` 四个文件；⛔ 不修改 `/data/home/yale/work/quay-dsi` 仓、不手拷其它文件、不在快照目录放第五个文件。

## Acceptance Criteria

- [ ] AC1 `docs/analysis/dsi/{SNAPSHOT,atoms,coverage,status}.json` 四个文件存在，且都在本任务的提交里。
- [ ] AC2 `node /data/home/yale/work/quay-dsi/integrations/quay/verify-consumer.mjs --quay "$(pwd)"` exit 0，输出含 `PASS: 19/19 checks`。
- [ ] AC3 `SNAPSHOT.json.storeFormatVersion` 等于 1（当前 `STORE_FORMAT_VERSION`）；快照目录 0 处出现用户级 store 路径字面量，`SNAPSHOT.json` 无 `dsiRoot` 键。
- [ ] AC4 确定性：相同 `--now` 与 `--consumer-commit` 二次生成到临时目录，`diff -r` 为空。

## Definition of Done

真实对象：`docs/analysis/dsi/` 下恰好四个契约文件，由 `/data/home/yale/work/quay-dsi/integrations/quay/snapshot-build.mjs` 生成并提交；`verify-consumer.mjs --quay <本 worktree>` 在该检出上 19/19 PASS、exit 0；`SNAPSHOT.json.source.consumerCommit` 是本 worktree HEAD 的祖先。⛔ 不以「生成器/测试存在」充当完成，⛔ 不手改 `/data/home/yale/work/quay-dsi`，⛔ 不伪造快照。

## ADR-007 暗轴

该轴仍暗,理由:本任务只落地已冻结格式的投影，不改变 D 的语义质量轴，没有可支付的 L_D/L_G 读数

## Touches

- docs/analysis/dsi/SNAPSHOT.json (new)
- docs/analysis/dsi/atoms.json (new)
- docs/analysis/dsi/coverage.json (new)
- docs/analysis/dsi/status.json (new)
- tasks/dsi-consumer-snapshot-landing.md
