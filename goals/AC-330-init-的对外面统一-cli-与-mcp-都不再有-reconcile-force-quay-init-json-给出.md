---
id: AC-330
title: init 的对外面统一：CLI 与 MCP 都不再有 --reconcile/--force，`quay init --json`
  给出可解析的结构化报告，serve 默认值（等于回退值）不写入全新安装的配置
status: active
kind: criterion
goal: GOAL-029
criterion: |-
  set -u
  Q="node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts"
  T=$(mktemp -d /tmp/ac330.XXXXXX); trap 'rm -rf "$T" "$T-wt"' EXIT
  $Q init --help > "$T/help" 2>&1
  grep -q -- '--reconcile' "$T/help" packages/quay/src/cli/init.ts packages/quay/src/cli/help.ts && { echo "CAUSE=reconcile-flag-still-present — neither the init help nor the CLI source may carry a --reconcile mode (the state-based default replaces it)" >&2; exit 1; }
  grep -q -- '--force' "$T/help" && { echo "CAUSE=force-flag-still-advertised — quay init --help must not offer --force (overwrite has no place in the unified semantics)" >&2; exit 1; }
  node --input-type=module -e '(async()=>{const {Client}=await import("@modelcontextprotocol/sdk/client/index.js");const {StdioClientTransport}=await import("@modelcontextprotocol/sdk/client/stdio.js");const t=new StdioClientTransport({command:"node",args:["--no-warnings","--experimental-strip-types",process.argv[1],"mcp"],cwd:process.argv[2],env:{...process.env}});const c=new Client({name:"ac330",version:"0"});await c.connect(t);const tools=(await c.listTools()).tools;const init=tools.find(x=>x.name==="init");await c.close();if(!init){console.error("no-init-tool");process.exit(3)}const props=Object.keys((init.inputSchema&&init.inputSchema.properties)||{});console.log(props.join(","));process.exit(props.includes("reconcile")?4:0)})().catch(e=>{console.error("probe-error "+e);process.exit(5)})' "$PWD/packages/quay/bin/quay.ts" "$T" > "$T/mcp.out" 2> "$T/mcp.err"; mrc=$?
  [ "$mrc" != 4 ] || { echo "CAUSE=mcp-init-still-has-reconcile-param — the MCP init tool schema must not carry a reconcile property" >&2; exit 1; }
  [ "$mrc" = 0 ] || { echo "CAUSE=mcp-probe-not-evaluated-rc$mrc — could not read the MCP init tool schema: $(head -c 200 "$T/mcp.err" | tr '\n' ' ')" >&2; exit 1; }
  mkdir -p "$T/fresh" && git init -q -b develop "$T/fresh" && git -C "$T/fresh" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
  printf '{"name":"p","version":"1.0.0","scripts":{"test":"node --test"}}\n' > "$T/fresh/package.json"
  $Q init --root "$T/fresh" --project p --json > "$T/fresh.json" 2> "$T/fresh.err" || { echo "CAUSE=fresh-init-failed — $(head -c 200 "$T/fresh.err" | tr '\n' ' ')" >&2; exit 1; }
  python3 -c "import json,sys;json.load(open(sys.argv[1]))" "$T/fresh.json" 2>/dev/null || { echo "CAUSE=init-json-not-parseable — quay init --json must print one JSON report on stdout" >&2; exit 1; }
  grep -q '^serve:' "$T/fresh/.quay/config.yml" && { echo "CAUSE=serve-default-written-on-fresh-install — a fresh install must not write serve defaults that equal the fallback" >&2; exit 1; }
  exit 0
expect: "`quay init --help` 与 CLI 源码不含 --reconcile/--force，MCP init 工具 schema 无
  reconcile 属性，全新安装的 `quay init --json` 在 stdout 给出一份可解析 JSON，全新配置不含 serve: 段"
origin: 人 2026-10-07 裁定（与 manager 会话讨论）：init 终局是无 .sh——升级与全新安装统一为单一 TS 引擎，过渡期
  quay-init.sh 缩为调用 bin/quay init 的垫片；不再有 --reconcile；serve
  默认值（等于回退值）不写进配置；升级失败非零退出并保留原配置；未知键保留并警告；并单独收窄发布集合（测试/夹具/突变用例/交付验证工具不应随产物发出）。起因：2026-10-07
  发布前演练发现已有项目升级后 config validate 仍红（init 脚本升级不补 loop.board/gates），且产物里 shell
  36910 行、641 个测试文件被当作产品发出。
activatedAt: 2026-10-07T02:00:30.168Z
statusLog:
  - at: 2026-10-07T02:00:30.168Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-07T02:00:30.168Z
---
