---
id: gap-codex-mcp-sync-omits-provider-yml-stable-install
title: codex-mcp-sync 稳定安装漏装 vendor/quay-native/provider.yml（bundle 与其 manifest 未同进同出）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`plugin/scripts/codex-mcp-sync.sh` 把 Core/Native 两份 bundle 与 kernel anchor 装到稳定位置
`~/.local/share/quay/`，但**从不拷贝 `vendor/quay-native/provider.yml`**，也不在 fail-closed 预检里检查它。
而 native 的 manifest 解析路径是相对 bundle 自身位置：

- `packages/quay-native/src/manifest.ts:13` `DEFAULT_MANIFEST_PATH = path.join(__dirname, "..", "provider.yml")`
- 稳定安装把 bundle 放在 `${DEST}/vendor/quay-native/dist/quay-native.js` ⇒ 期望的 manifest 是
  `${DEST}/vendor/quay-native/provider.yml`，而该文件不存在。

反证这是漏项而非设计：`plugin/scripts/sync-vendor.sh:229` 在 `--check` 里用 `cmp_or_report` 校验
`vendor/quay-native/provider.yml`，`:210` 的注释写明「provider.yml travels with it」——in-package 镜像强制
同进同出，稳定位置安装却没有。

影响面：
- 只有「稳定路径安装」这一面受影响（Codex 侧，以及任何把 `provider.path` 指向 `~/.local/share/quay` 的配置）：
  `provider://manifest` 资源读取 ENOENT；
- task/goal 的 MCP 读写不受影响（不依赖 manifest）；
- Claude 插件侧不受影响（其 `.mcp.json` 走 `${CLAUDE_PLUGIN_ROOT}/vendor/quay/dist/quay.js`）。

活证据（2026-11-04 复核，命令与读数）：

```
grep -rc "ENOENT: no such file or directory, open '/data/home/yale/.local/share/quay/vendor/quay-native/provider.yml'" ~/.codex/sessions | grep -v ':0$'
```

⇒ 10 个 rollout 文件、38 行匹配；其中 2026-10-31 / 11-01 的 **9 个独立会话共 19 行**，2026-11-04 那一个含
用户复述粘贴（19 行，且在两次测量之间 +1 ⇒ 该 rollout 仍在增长）。⛔ 引用数量时按「9 个独立会话 / 19 行」，
不要把复述行算成失败次数。

本机当前状态（同次复核）：
- `~/.local/share/quay/vendor/quay-native/` 下只有 `dist/`，无 `provider.yml`；
- `~/.local/share/quay/quay.js` 的 sha256 前缀 `1ba3f58e` = 插件缓存 **0.30.1** 的 core bundle（0.31.1 是
  `1c919815`）⇒ 稳定安装停在旧版是**按需运行**的结果（capability catalog：用户装好插件后手动跑一次，
  `publish-dist-branch.sh --push` 以 `--install-only` 调用），不是本任务要改的机制。

修法（A）：
1. 安装块补拷 `${DIST_ROOT}/vendor/quay-native/provider.yml` → `${DEST}/vendor/quay-native/provider.yml`；
2. 把它加入现有 fail-closed 预检（与两份 bundle 同待遇：缺/空 ⇒ exit≠0 并指名字面路径）；
3. 安装末尾加一条**能取假**的断言：安装完成后验证 manifest 真的可读（读该文件或调 readManifest），
   失败 ⇒ exit≠0。目标：让「没装」不可能与「装好」同形（硬规则 3b）；
4. 补回归测试覆盖三臂：正常安装 / 源文件缺失 fail-closed / 安装后不可读 fail-closed。

⛔ 不做（明确划界）：
- B（provider 侧内置默认 manifest 或降级读取）：manifest 是随包发布的静态自声明，缺失应报错而非兜底；
  若要做，只加可操作的错误提示，不做默认 manifest。
- C（升级后自动重跑 sync）：维持「按需运行」语义，只在脚本头注释里写明「升级插件后需重跑一次，否则稳定
  安装停在旧版」——这条落在下面 AC 的最后一条。

形状说明：这是「安装器漏装产物」类缺口，与 `gap-codex-mcp-sync-installs-stale-dist-from-detached-worktree` /
`gap-codex-mcp-sync-installs-stale-main-checkout-dist`（均已 done）属同一脚本的**不同机制**——那两个修的是
「装了旧 dist」，本条修的是「少装一份产物」。

<!-- dedup-ref -->
相关但不同机制（勿合并）：上述两个 stale-dist 任务的对象是「内容旧」，本条的对象是「缺项」。

## AC

- [x] 安装完整性：临时 HOME 下跑 `codex-mcp-sync.sh --install-only`，`$HOME/.local/share/quay/vendor/quay-native/provider.yml` 存在，且与 `$DIST_ROOT/vendor/quay-native/provider.yml` `cmp` exit 0。
- [x] fail-closed 预检（负控制）：删掉源 `provider.yml` 后运行脚本必须 exit≠0，且 stderr 指名该路径——证明「没装」不与「装好」同形。
- [x] 安装后断言可取假：把已装好的 `provider.yml` 删除或置空后重跑，脚本 exit≠0（断言本身不是摆设）。
- [x] 回归用例三臂全绿：`node --test plugin/test/codex-mcp-sync-provider-manifest.test.mjs` exit 0。
- [x] 脚本头注释写明按需语义与升级后重跑要求：`grep -c '升级插件后需重跑' plugin/scripts/codex-mcp-sync.sh` ≥ 1。
- [x] 范围门绿：`bash scripts/test.sh --for-task gap-codex-mcp-sync-omits-provider-yml-stable-install --allow-thin`。

## DoD

在临时 HOME 上真跑一次 `codex-mcp-sync.sh --install-only`（非单测替身），贴：`ls -la $HOME/.local/share/quay/vendor/quay-native/`
显示 `provider.yml`、`cmp` 与 `sha256sum` 结果、以及一次「删掉源文件 ⇒ exit≠0」的负控制原始输出；随后用该稳定
安装的入口真读一次 manifest（以 node 调用 readManifest，或触发一次 `provider://manifest` 读），证明 ENOENT 不再
出现。仅 fixture 绿不算落地。

## Touches

- plugin/scripts/codex-mcp-sync.sh
- plugin/test/codex-mcp-sync-provider-manifest.test.mjs (new)
- plugin/test/publish-dist-branch-closure-gate.test.mjs
- tasks/gap-codex-mcp-sync-omits-provider-yml-stable-install.md

## ADR-007

该轴仍暗,理由:本次改动是 shell 安装器缺项修复，不改包依赖/模块结构，L_D/L_G 无增量读数可测。
