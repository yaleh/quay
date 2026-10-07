---
id: AC-335
title: 发布产物里的 .sh 只剩运行时可达的集合；交付/验证工具与突变夹具出局
status: draft
kind: criterion
goal: GOAL-029
criterion: >-
  set -u

  T=plugin/test/shipped-shell-reachability.test.mjs

  [ -f "$T" ] || { echo "CAUSE=shell-reachability-test-absent — $T does not
  exist" >&2; exit 1; }

  timeout 55 node --experimental-strip-types --test "$T" > /tmp/ac335.out 2>&1;
  rc=$?

  [ "$rc" != 124 ] || { echo "CAUSE=shell-reachability-test-too-slow — exceeded
  55s" >&2; exit 1; }

  [ "$rc" = 0 ] || { echo "CAUSE=shell-reachability-test-red-rc$rc — $(tail -c
  300 /tmp/ac335.out | tr '\n' ' ')" >&2; exit 1; }

  exit 0
expect: plugin/test/shipped-shell-reachability.test.mjs 存在、在 55 秒内通过：产物里每个 .sh
  都能从 bin/quay、.mcp.json、skills/workflows 命令、scripts/dist 入口与 capability-catalog
  声明的 instrument 出发到达，verify-deliver-coldstart.sh 与 develop-deliver-tgz.sh 不在产物中
origin: 人 2026-10-07 裁定（与 manager 会话讨论）：init 终局是无 .sh——升级与全新安装统一为单一 TS 引擎，过渡期
  quay-init.sh 缩为调用 bin/quay init 的垫片；不再有 --reconcile；serve
  默认值（等于回退值）不写进配置；升级失败非零退出并保留原配置；未知键保留并警告；并单独收窄发布集合（测试/夹具/突变用例/交付验证工具不应随产物发出）。起因：2026-10-07
  发布前演练发现已有项目升级后 config validate 仍红（init 脚本升级不补 loop.board/gates），且产物里 shell
  36910 行、641 个测试文件被当作产品发出。
---
