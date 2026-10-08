---
id: AC-338
title: 测试与 smoke：scripts/test.sh 跑 kernel 转移、ready-pool-check 接线、边表、载体注册表、store
  写入金样、web 路由快照共 6 个文件全绿
status: draft
kind: criterion
goal: GOAL-030
criterion: >
  set -u

  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED:
  not inside a git repository" >&2; exit 3; }

  cd "$root"

  files="packages/quay/test/task-transition.test.mjs
  plugin/test/ready-pool-check-transition-writes.test.mjs
  packages/quay/test/lifecycle-edge-table.test.mjs
  plugin/test/carrier-registry-completeness.test.mjs
  packages/quay-native/test/characterization-store-write.test.mjs
  packages/quay/test/characterization-serve-routes.test.mjs"

  for f in $files; do [ -f "$f" ] || { echo "CAUSE=test-file-absent — $f (the
  slice's own tests must exist before this AC can pass)" >&2; exit 1; }; done

  log=$(mktemp /tmp/goal030-tests.XXXXXX); trap 'rm -f "$log"' EXIT

  scripts/test.sh $files >"$log" 2>&1; rc=$?

  fail=$(grep -oE '^ℹ fail [0-9]+' "$log" | tail -1 | awk '{print $3}');
  tests=$(grep -oE '^ℹ tests [0-9]+' "$log" | tail -1 | awk '{print $3}')

  [ -n "$tests" ] || { echo "NOT-EVALUATED: scripts/test.sh printed no test
  summary (exit $rc): $(tail -2 "$log" | tr '\n' ' ')" >&2; exit 3; }

  [ "$rc" -eq 0 ] && [ "${fail:-1}" -eq 0 ] && [ "$tests" -ge 6 ] || { echo
  "CAUSE=tests-red — scripts/test.sh exit $rc, tests $tests, fail ${fail:-?}:
  $(grep -E '^not ok|✖' "$log" | head -3 | tr '\n' ' ')" >&2; exit 1; }

  echo "PASS: scripts/test.sh on 6 files (kernel transition, ready-pool-check
  wiring, edge table, carrier registry, store-write golden, serve-route snapshot
  smoke): $tests tests, 0 fail"
expect: exit 0 = 6 个文件全部存在且全绿（至少 6 个测试）；exit 1 = 文件缺失或有失败；exit 3 = test.sh 没有输出测试汇总。
origin: 人 2026-10-08「现在开始执行…正式创建一个真实的重构 goal，并启用 goal branch」：goal
  分支机制首个真实试点，范围严格限于晋升路径的 todo→ready / ready→todo 两条写入；先验证“在分支上运行 Quay 并验证
  Quay”的自举路径，健康度达标后才进入更大重构。
phase: pre-merge
---
