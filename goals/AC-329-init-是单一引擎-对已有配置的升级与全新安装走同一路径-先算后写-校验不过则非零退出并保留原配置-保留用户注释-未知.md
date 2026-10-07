---
id: AC-329
title: init 是单一引擎：对已有配置的升级与全新安装走同一路径，先算后写、校验不过则非零退出并保留原配置；保留用户注释/未知键/用户固定值，去掉退役键，且幂等
status: draft
kind: criterion
goal: GOAL-029
criterion: >-
  set -u

  Q="node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts"

  T=$(mktemp -d /tmp/ac329.XXXXXX); trap 'rm -rf "$T" "$T-wt"' EXIT

  git init -q -b develop "$T" && git -C "$T" -c user.name=t -c user.email=t@t
  commit -q --allow-empty -m init || { echo "CAUSE=fixture-git-init-failed —
  scratch repo could not be built" >&2; exit 1; }

  printf '{"name":"p","version":"1.0.0","scripts":{"test":"node --test"}}\n' >
  "$T/package.json"

  mkdir -p "$T/.quay" "$T/tasks"

  cat > "$T/.quay/config.yml" <<'EOF'

  # keep-me: a user comment that must survive the upgrade

  x_user_extra: 1

  providers:
    native:
      enabled: true
      path: /nonexistent/cache/quay/quay/0.10.0/vendor/quay-native
      tasks_dir: ./tasks
      mcp_entry: ["node", "/nonexistent/cache/quay/quay/0.10.0/vendor/quay-native/dist/quay-native.js", "mcp"]
  loop:
    repo_root: REPOROOT
    test_command: node --test
    worktree_root: WTROOT
  serve:
    port: 4000
  EOF

  sed -i "s#REPOROOT#$T#; s#WTROOT#$T-wt#" "$T/.quay/config.yml"

  $Q init --root "$T" > "$T/out1" 2> "$T/err1"; rc=$?

  [ "$rc" = 0 ] || { echo "CAUSE=init-rejected-existing-config-rc$rc — plain
  'quay init' on an existing config must upgrade it, got: $(head -c 200
  "$T/err1" | tr '\n' ' ')" >&2; exit 1; }

  $Q config validate --root "$T" > "$T/v1" 2>&1 || { echo
  "CAUSE=init-output-fails-validate — $(head -c 300 "$T/v1" | tr '\n' ' ')" >&2;
  exit 1; }

  grep -q 'keep-me' "$T/.quay/config.yml" || { echo
  "CAUSE=user-comment-lost-by-upgrade — the comment line is gone" >&2; exit 1; }

  grep -q '^x_user_extra' "$T/.quay/config.yml" || { echo
  "CAUSE=unknown-key-dropped — an unrecognized user key must be kept (warned,
  not deleted)" >&2; exit 1; }

  grep -qE '^ +path:|^ +mcp_entry:' "$T/.quay/config.yml" && { echo
  "CAUSE=native-path-or-mcp-entry-kept — the retired native path/mcp_entry lines
  must be removed" >&2; exit 1; }

  grep -qE '^ +host:' "$T/.quay/config.yml" && { echo
  "CAUSE=serve-default-written — serve.host equals the fallback and must not be
  written into the config" >&2; exit 1; }

  grep -q 'port: 4000' "$T/.quay/config.yml" || { echo
  "CAUSE=user-serve-port-lost — a user-pinned serve.port must be preserved" >&2;
  exit 1; }

  cp "$T/.quay/config.yml" "$T/after1.yml"

  $Q init --root "$T" > "$T/out2" 2> "$T/err2" || { echo
  "CAUSE=second-run-failed — re-running init must succeed: $(head -c 200
  "$T/err2" | tr '\n' ' ')" >&2; exit 1; }

  cmp -s "$T/after1.yml" "$T/.quay/config.yml" || { echo "CAUSE=not-idempotent —
  a second init run changed the config" >&2; exit 1; }

  sed -i 's#^  worktree_root: .*#&\n  gates: no-such-gate-zz#'
  "$T/.quay/config.yml"

  cp "$T/.quay/config.yml" "$T/bad.yml"

  $Q init --root "$T" > "$T/out3" 2> "$T/err3"; rc3=$?

  [ "$rc3" != 0 ] || { echo "CAUSE=incompatible-user-value-accepted — an
  unresolvable loop.gates value must make init exit non-zero" >&2; exit 1; }

  cmp -s "$T/bad.yml" "$T/.quay/config.yml" || { echo
  "CAUSE=config-modified-despite-failure — a failed upgrade must leave the
  original config byte-identical" >&2; exit 1; }

  exit 0
expect: 对一份含注释、未知键、用户固定 serve.port、旧版 native path/mcp_entry、缺 loop.board/gates
  的已有配置，plain `quay init --root <dir>`（无任何 --reconcile/--force）退出 0，配置随后通过 `quay
  config validate`，注释/未知键/用户 serve.port 保留，native path/mcp_entry 与等于回退值的
  serve.host 不出现，二次运行字节不变；对含无法解析的 loop.gates 值的配置，init 非零退出且配置字节不变
origin: 人 2026-10-07 裁定（与 manager 会话讨论）：init 终局是无 .sh——升级与全新安装统一为单一 TS 引擎，过渡期
  quay-init.sh 缩为调用 bin/quay init 的垫片；不再有 --reconcile；serve
  默认值（等于回退值）不写进配置；升级失败非零退出并保留原配置；未知键保留并警告；并单独收窄发布集合（测试/夹具/突变用例/交付验证工具不应随产物发出）。起因：2026-10-07
  发布前演练发现已有项目升级后 config validate 仍红（init 脚本升级不补 loop.board/gates），且产物里 shell
  36910 行、641 个测试文件被当作产品发出。
---
