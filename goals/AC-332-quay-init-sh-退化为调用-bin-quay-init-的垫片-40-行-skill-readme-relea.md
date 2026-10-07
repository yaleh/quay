---
id: AC-332
title: quay-init.sh 退化为调用 bin/quay init 的垫片（≤40 行），skill、README、release.yml 不再直接调用脚本
status: active
kind: criterion
goal: GOAL-029
criterion: >-
  set -u

  S=plugin/scripts/quay-init.sh

  [ -f "$S" ] || { echo "CAUSE=shim-absent — $S must remain as a thin shim for
  one release, not vanish" >&2; exit 1; }

  n=$(wc -l < "$S"); [ "$n" -le 40 ] || { echo "CAUSE=quay-init-sh-not-a-shim —
  $S has $n lines, a shim must be <= 40" >&2; exit 1; }

  grep -q 'bin/quay' "$S" || { echo "CAUSE=shim-does-not-call-the-cli — $S must
  exec the plugin's bin/quay init" >&2; exit 1; }

  for f in plugin/skills/init/SKILL.md README.md .github/workflows/release.yml;
  do c=$(grep -c 'quay-init\.sh' "$f"); [ "$c" = 0 ] || { echo
  "CAUSE=caller-still-uses-the-script-$f — $f still names quay-init.sh $c
  time(s); callers must use bin/quay init" >&2; exit 1; }; done

  exit 0
expect: plugin/scripts/quay-init.sh 存在且 ≤40 行并调用
  bin/quay；plugin/skills/init/SKILL.md、README.md、.github/workflows/release.yml 中
  quay-init.sh 出现 0 次
origin: 人 2026-10-07 裁定（与 manager 会话讨论）：init 终局是无 .sh——升级与全新安装统一为单一 TS 引擎，过渡期
  quay-init.sh 缩为调用 bin/quay init 的垫片；不再有 --reconcile；serve
  默认值（等于回退值）不写进配置；升级失败非零退出并保留原配置；未知键保留并警告；并单独收窄发布集合（测试/夹具/突变用例/交付验证工具不应随产物发出）。起因：2026-10-07
  发布前演练发现已有项目升级后 config validate 仍红（init 脚本升级不补 loop.board/gates），且产物里 shell
  36910 行、641 个测试文件被当作产品发出。
activatedAt: 2026-10-07T02:00:33.556Z
statusLog:
  - at: 2026-10-07T02:00:33.556Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-07T02:00:33.556Z
---
