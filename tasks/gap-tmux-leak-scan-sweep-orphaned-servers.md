---
id: gap-tmux-leak-scan-sweep-orphaned-servers
title: tmux-leak-scan 加 --sweep 启动清扫孤立 server（SIGKILL 残留自动治愈）
status: done
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

SIGKILL（静默看门狗/超时/崩溃）打断 suite 后，`inner-session-check.test.mjs` 等测试起的 hermetic tmux server 停在私有 socket 上（`/tmp/quay-isc-*` 等），`tmux-leak-scan.sh --check` 只能【检出】却无人【清】——每次要人手杀（2026-08-29 实证：pid 1406623 泄漏 1h23m）。给 `tmux-leak-scan.sh` 加第三个 mode `--sweep`：suite 启动时清掉历史孤立，让 `--snapshot`/`--check` 回归纯「本轮新漏」检测。

## Plan

1. **`--sweep` mode**（`plugin/scripts/tmux-leak-scan.sh`）：复用现有 `scan_matches` + `prefixes` 谓词（单一真相源，sweep 与 scan 永不分叉）。枚举匹配的 proc 行 + dir 行：对每个 proc 行（形如 `1406623 tmux -S /tmp/quay-isc-ac1-*/sock/tmux-1000/default new-session -d ...`）提取 `-S <socket>` → `tmux -S <socket> kill-server`；对每个 dir 行（`/tmp/quay-isc-*` 等）`rm -rf`。**best-effort（exit 0）、幂等（无孤儿时 no-op）**。
2. **接线**（`scripts/test.sh`）：`--buckets` 路径（及 `run_selected` 全量路径）在 `--snapshot` 之前加 `bash plugin/scripts/tmux-leak-scan.sh --sweep "$repo_root" || true`——先治愈历史孤立，再快照干净基线，`--check` 仍只报本轮新漏。

## Acceptance Criteria

- [x] AC1（能取假，正）：造一个 `quay-isc-` 前缀孤儿 tmux server + 对应 `/tmp` 目录 → `--sweep` → 断言 server 死（`pgrep` 无命中）且目录删。
- [x] AC2（能取假，负控制）：造一个**不在 scope** 的 server（socket 无 `quay-isc-`/`skv-`/`session-liveness-` 等前缀）→ `--sweep` → 断言它**仍存活**（sweep 不越界）。
- [x] AC3（能取假，幂等）：连续跑两次 `--sweep`，第二次 no-op、exit 0，不报错不误杀。
- [x] AC4（能取假，接线）：`scripts/test.sh` 的 `--buckets` 路径里，`--sweep` 在 `--snapshot` 之前执行（grep 顺序：`--sweep` 行先于 `--snapshot` 行）。
- [x] AC5（能取假，单测）：`plugin/test/tmux-leak-scan.test.mjs` 断言 AC1-AC4，改掉任一 ⇒ 测试红。

## Definition of Done

`tmux-leak-scan.sh --sweep` 落地：suite 启动时自动清掉 SIGKILL 留下的孤立 hermetic tmux server（正/负/幂等三向单测覆盖），接线进 `test.sh` 的 `--buckets` 与全量路径，`--snapshot`/`--check` 回归纯检测职责，不再需要人手杀孤儿。

## Touches

- plugin/scripts/tmux-leak-scan.sh（加 --sweep mode）
- scripts/test.sh（--buckets + run_selected 接线 --sweep）
- plugin/test/tmux-leak-scan.test.mjs（AC1-AC4 单测）
- tasks/gap-tmux-leak-scan-sweep-orphaned-servers.md（自身）
