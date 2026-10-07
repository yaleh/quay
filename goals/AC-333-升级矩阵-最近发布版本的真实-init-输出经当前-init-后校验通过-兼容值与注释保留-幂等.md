---
id: AC-333
title: 升级矩阵：最近发布版本的真实 init 输出经当前 init 后校验通过、兼容值与注释保留、幂等
status: achieved
kind: criterion
goal: GOAL-029
criterion: >-
  set -u

  T=plugin/test/init-upgrade-matrix.test.mjs

  [ -f "$T" ] || { echo "CAUSE=matrix-test-absent — $T does not exist" >&2; exit
  1; }

  D=plugin/test/fixtures/init-matrix

  n=$(ls -d "$D"/v*/ 2>/dev/null | wc -l); [ "$n" -ge 3 ] || { echo
  "CAUSE=too-few-historical-fixtures — $D has $n version dirs, need >= 3" >&2;
  exit 1; }

  for d in "$D"/v*/; do [ -f "$d/config.yml" ] && [ -f "$d/PROVENANCE" ] || {
  echo "CAUSE=fixture-incomplete-$d — each version dir needs config.yml (the
  REAL init output of that tag) and PROVENANCE (tag + command)" >&2; exit 1; };
  done

  u=$(sha256sum "$D"/v*/config.yml | awk '{print $1}' | sort -u | wc -l); [ "$u"
  -ge 2 ] || { echo "CAUSE=fixtures-are-copies — all historical config.yml
  fixtures are byte-identical" >&2; exit 1; }

  node --experimental-strip-types --test "$T" > /tmp/ac333.out 2>&1 || { echo
  "CAUSE=matrix-test-red — $(tail -c 300 /tmp/ac333.out | tr '\n' ' ')" >&2;
  exit 1; }

  exit 0
expect: plugin/test/init-upgrade-matrix.test.mjs
  存在且通过；plugin/test/fixtures/init-matrix/ 下 ≥3 个版本目录，每个含该 tag 真实 init 输出的
  config.yml 与记录 tag+命令的 PROVENANCE，且夹具内容互不相同
origin: 人 2026-10-07 裁定（与 manager 会话讨论）：init 终局是无 .sh——升级与全新安装统一为单一 TS 引擎，过渡期
  quay-init.sh 缩为调用 bin/quay init 的垫片；不再有 --reconcile；serve
  默认值（等于回退值）不写进配置；升级失败非零退出并保留原配置；未知键保留并警告；并单独收窄发布集合（测试/夹具/突变用例/交付验证工具不应随产物发出）。起因：2026-10-07
  发布前演练发现已有项目升级后 config validate 仍红（init 脚本升级不补 loop.board/gates），且产物里 shell
  36910 行、641 个测试文件被当作产品发出。
activatedAt: 2026-10-07T02:00:34.868Z
statusLog:
  - at: 2026-10-07T02:00:34.868Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-10-07T03:22:18.124Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-07T02:00:34.868Z
---
