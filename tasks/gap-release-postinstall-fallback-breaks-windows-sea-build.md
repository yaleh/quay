---
id: gap-release-postinstall-fallback-breaks-windows-sea-build
title: "release postinstall bash-only (echo ...; exit 0) subshell breaks windows-latest sea-release — cmd.exe parses `(echo` as invalid (`re-run: was unexpected at this time`), npm install fails, so v0.4.0 published WITHOUT the windows-x64 SEA binary (release marked failure, 2/3 SEA binaries present); fix: cross-platform fallback (move WARN into sync-vendor.sh or use sh-compatible syntax)"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**release.yml 的 windows-latest sea-release 在 npm install 就失败——root package.json 的 postinstall 用了 bash 专属的 `( )` 子壳回退，cmd.exe 解析不了。**

**证据（2026-08-06 v0.4.0 release 实测）**：
- `package.json` postinstall：`bash plugin/scripts/sync-vendor.sh || (echo '...WARNING...' >&2; exit 0)`
- windows-latest 上 npm 用 **cmd.exe** 跑 scripts，遇到 `(echo '...'` → `re-run: was unexpected at this time.` → npm install 失败（exit 1）。
- 结果：sea-release windows-x64 job **failure**；v0.4.0 release 只含 **linux-x64 + macos-arm64** 两个 SEA 二进制（`gh release view` 实测），**缺 windows-x64**。
- release.yml 整体 conclusion=failure（release job 的 live-GitHub 测试也失败，见下）。

**第二层失败**：release job 的 "Run tests"（`node --test packages/quay/test/*.mjs ...`）跑了 live-GitHub 测试，
repo 状态漂移导致 E3（adr-001）、M52（delivery-standalone-smoke）、AC5（real-store scan）等失败——
这与 CLAUDE.md 记载的「repo 状态漂移 ⇒ live 测试失败」同类，但**现在阻塞 release**。

**为什么重要**：archguard 在等能装的 release。v0.4.0 已发布（linux/macos 可装）但 windows 缺二进制、
workflow 标 failure——不修，每次 release 都缺 windows。

**选定机制方向**：
1. **postinstall 跨平台化**：把 fallback 的 WARN + exit 0 移进 `sync-vendor.sh` 自己（bash 内处理），
   postinstall 变 `bash plugin/scripts/sync-vendor.sh || true`（cmd.exe 能解析 `|| true`）。
2. **或**：postinstall 用 sh 兼容语法（`if ! bash ...; then echo ...; fi`）。
3. live-GitHub 测试对 release 的阻塞：单独评估（可能 release 不该跑 live 测试，或测试需适配漂移）。

## Acceptance Criteria

- [ ] AC1: postinstall 跨平台——windows-latest npm install 不再因 `(echo` 失败（实跑 CI 证据）
- [ ] AC2: v0.4.1（或下一版本）release 含 windows-x64 SEA 二进制（`gh release view` 三平台齐全）
- [ ] AC3: 负控制——linux npm install 行为不变（sync-vendor 正常路径不回归）
- [ ] AC4: release job 的 live-GitHub 测试阻塞问题记录解决方案（跳过/适配/拆分，选一并写明理由）
- [ ] AC5: 测试 `node:test` + `// @test-group governance`

## Touches
- package.json（postinstall 跨平台化）
- plugin/scripts/sync-vendor.sh（WARN fallback 移入）
- .github/workflows/release.yml（若调整 live 测试阻塞）
- plugin/test/sync-vendor.test.mjs（若有）

## Contract

measure   windows_postinstall_ok = `gh run list --workflow=release.yml` 最近 release 的 windows sea-release job conclusion 布尔字段
band      windows_postinstall_ok = 1（windows SEA job 成功）
invoke    `bash plugin/scripts/sync-vendor.sh`（linux 正常路径 exit 0）
control   移除 postinstall 的 bash 专属语法后 windows npm install 通过；linux 正常路径不回归
resume    先修 postinstall 跨平台，再验证 windows job；live 测试阻塞单独评估
