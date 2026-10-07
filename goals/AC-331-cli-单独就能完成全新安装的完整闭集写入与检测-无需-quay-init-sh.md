---
id: AC-331
title: CLI 单独就能完成全新安装的完整闭集写入与检测（无需 quay-init.sh）
status: active
kind: criterion
goal: GOAL-029
criterion: >-
  set -u

  Q="node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts"

  T=$(mktemp -d /tmp/ac331.XXXXXX); trap 'rm -rf "$T" "$T-wt"' EXIT

  git init -q -b develop "$T" && git -C "$T" -c user.name=t -c user.email=t@t
  commit -q --allow-empty -m init || { echo "CAUSE=fixture-git-init-failed —
  scratch repo could not be built" >&2; exit 1; }

  printf '{"name":"p","version":"1.0.0","scripts":{"test":"node --test"}}\n' >
  "$T/package.json"

  $Q init --root "$T" --project p > "$T/out" 2> "$T/err" || { echo
  "CAUSE=cli-fresh-init-failed — $(head -c 250 "$T/err" | tr '\n' ' ')" >&2;
  exit 1; }

  for f in .quay/config.yml .quay/profiles.yml .claude/launch.settings.json
  .claude/settings.json .gitignore; do [ -f "$T/$f" ] || { echo
  "CAUSE=closed-set-file-missing-$f — the CLI alone must lay the whole closed
  set (no shell script needed)" >&2; exit 1; }; done

  for d in tasks goals; do [ -d "$T/$d" ] || { echo
  "CAUSE=closed-set-dir-missing-$d — the CLI alone must create $d/" >&2; exit 1;
  }; done

  grep -q '\.quay' "$T/.gitignore" || { echo "CAUSE=gitignore-lacks-quay-state —
  .gitignore must ignore the quay runtime state" >&2; exit 1; }

  grep -q 'enabledPlugins' "$T/.claude/settings.json" || { echo
  "CAUSE=claude-settings-lack-enabledPlugins — .claude/settings.json must enable
  the plugin" >&2; exit 1; }

  grep -qE 'test_command: .*test' "$T/.quay/config.yml" || { echo
  "CAUSE=test-command-not-detected — loop.test_command must be detected from
  package.json scripts.test" >&2; exit 1; }

  grep -qE '^ +repo_root: ' "$T/.quay/config.yml" || { echo
  "CAUSE=repo-root-not-written — loop.repo_root must be written by the CLI" >&2;
  exit 1; }

  $Q config validate --root "$T" > "$T/v" 2>&1 || { echo
  "CAUSE=fresh-cli-output-fails-validate — $(head -c 250 "$T/v" | tr '\n' ' ')"
  >&2; exit 1; }

  test -L "$T/.quay/plugin" || { echo "CAUSE=plugin-link-missing — init must
  refresh the project .quay/plugin link" >&2; exit 1; }

  exit 0
expect: 在一个只有 package.json 的空 git 仓库里，`quay init --root <dir> --project p` 退出
  0，写出
  .quay/config.yml、profiles.yml、.claude/launch.settings.json、.claude/settings.json（含
  enabledPlugins）、.gitignore（忽略 .quay 状态）、tasks/ 与 goals/，检测出 test_command 并写入
  repo_root，刷新 .quay/plugin 链接，且 `quay config validate` 通过
origin: 人 2026-10-07 裁定（与 manager 会话讨论）：init 终局是无 .sh——升级与全新安装统一为单一 TS 引擎，过渡期
  quay-init.sh 缩为调用 bin/quay init 的垫片；不再有 --reconcile；serve
  默认值（等于回退值）不写进配置；升级失败非零退出并保留原配置；未知键保留并警告；并单独收窄发布集合（测试/夹具/突变用例/交付验证工具不应随产物发出）。起因：2026-10-07
  发布前演练发现已有项目升级后 config validate 仍红（init 脚本升级不补 loop.board/gates），且产物里 shell
  36910 行、641 个测试文件被当作产品发出。
activatedAt: 2026-10-07T02:00:32.145Z
statusLog:
  - at: 2026-10-07T02:00:32.145Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-07T02:00:32.145Z
---
