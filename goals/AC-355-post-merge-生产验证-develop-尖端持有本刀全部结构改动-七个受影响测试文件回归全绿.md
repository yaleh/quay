---
id: AC-355
title: post-merge 生产验证：develop 尖端持有本刀全部结构改动，七个受影响测试文件回归全绿
status: active
kind: criterion
goal: GOAL-034
criterion: |
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || branch=""
  merge_base=$(git merge-base develop HEAD 2>/dev/null) || merge_base=""
  dev_tip=$(git rev-parse develop 2>/dev/null) || dev_tip=""
  [ -n "$merge_base" ] && [ "$merge_base" = "$dev_tip" ] || { echo "NOT-EVALUATED: GOAL-034 has not merged into develop yet (branch=$branch, merge-base=$merge_base, develop=$dev_tip)" >&2; exit 3; }
  src=packages/quay/src
  [ -f "$src/kernel/gate-run-options.ts" ] || { echo "CAUSE=post-merge-regression -- kernel/gate-run-options.ts missing on develop after a merge-base match, the landing did not actually carry the slice" >&2; exit 1; }
  [ ! -e "$src/gate/factories/loader.ts" ] || { echo "CAUSE=post-merge-regression -- gate/factories/loader.ts reappeared on develop" >&2; exit 1; }
  [ ! -e "$src/gate/config/utils.ts" ] || { echo "CAUSE=post-merge-regression -- gate/config/utils.ts reappeared on develop" >&2; exit 1; }
  node -e '(()=>{const fs=require("fs"),path=require("path");const src=process.argv[1];
  const rd=(f)=>fs.readFileSync(f,"utf8");
  const live=(t)=>t.split("\n").filter(l=>{const s=l.trim();return !(s.startsWith("//")||s.startsWith("*")||s.startsWith("/*"))}).join("\n");
  const need=[["goal-store.ts",/from\s*[\x22\x27]\.\/kernel\/gate-run-options\.ts[\x22\x27]/],["cli/gate.ts",/from\s*[\x22\x27]\.\.\/kernel\/gate-run-options\.ts[\x22\x27]/],["gate/acceptance-runner.ts",/from\s*[\x22\x27]\.\.\/kernel\/gate-run-options\.ts[\x22\x27]/],["gate/registry.ts",/from\s*[\x22\x27]\.\.\/kernel\/gate-run-options\.ts[\x22\x27]/],["gate/config/loader.ts",/from\s*[\x22\x27]\.\.\/\.\.\/kernel\/gate-run-options\.ts[\x22\x27]/],["gate/config/index.ts",/from\s*[\x22\x27]\.\.\/\.\.\/kernel\/gate-run-options\.ts[\x22\x27]/],["gate/factories/utils.ts",/from\s*[\x22\x27]\.\.\/\.\.\/kernel\/gate-run-options\.ts[\x22\x27]/],["gate/factories/goal.ts",/from\s*[\x22\x27]\.\.\/\.\.\/kernel\/gate-run-options\.ts[\x22\x27]/]];
  for(const pair of need){const f=pair[0],re=pair[1];if(!re.test(live(rd(path.join(src,f))))){console.error("CAUSE=post-merge-regression -- "+f+" no longer imports kernel/gate-run-options.ts on develop");process.exit(1)}}
  })()' "$src" || { echo "CAUSE=post-merge-structural-scan-red -- the scan above printed the specific CAUSE" >&2; exit 1; }
  testfiles="packages/quay/test/gate-config-loader.test.mjs packages/quay/test/gate.test.mjs packages/quay/test/goal-store.test.mjs packages/quay/test/acceptance.test.mjs packages/quay/test/acceptance-env.test.mjs packages/quay/test/gate-diagnostics.test.mjs packages/quay/test/gate-ergonomics.test.mjs"
  node --no-warnings --experimental-strip-types --test $testfiles > /tmp/goal034-ac355-test-output.txt 2>&1
  testexit=$?
  [ "$testexit" -eq 0 ] || { echo "CAUSE=post-merge-test-regression -- one of [$testfiles] failed on develop after the merge, exit=$testexit, see /tmp/goal034-ac355-test-output.txt" >&2; exit 1; }
  echo "PASS: develop tip carries the slice (kernel/gate-run-options.ts, dead shim gone, six consumers converged) and the seven affected test files pass"
expect: exit 0 = develop 尖端结构检查 + 七个测试文件全绿；exit 1 = CAUSE= 指明哪一项回归；exit 3 =
  GOAL-034 尚未并入 develop
origin: 继 GOAL-030~033 后第五个 goal branch 试点
activatedAt: 2026-10-10T06:03:59.236Z
statusLog:
  - at: 2026-10-10T06:03:59.236Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-10T06:03:59.236Z
phase: post-merge
---
