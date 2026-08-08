---
id: gap-user-scope-install-reinstall-criterion-and-version
title: "user-scope install when-to-reinstall — no VERSION + no staleness
  criterion (user-scope dist 06:01 vs plugin 15:59, ~10h + all today's fixes
  behind, but it's a LIVE consumption path via ~/.claude/settings.json);
  reinstall criterion by capability-boundary not time: ①new capability
  ②security/crash fix ③hereditary-defect fix trigger immediate, rest batching;
  add VERSION + compare check"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**user-scope 安装何时重装——缺 VERSION + 按能力边界的判据（管理者实测 + 外层裁定）**：

**实测现状**：user-scope dist 08-05 06:01、scripts 94 个最新 05:32；A机 plugin dist 15:36、scripts 105 个
最新 15:57。⇒ **落后约 10 小时、11 个脚本、今天全部修复**（NBSP/OS watchdog/laneCount/dist 内联/拓扑修复）。
而 ~/.claude/settings.json 正指向它、PATH 里也有——**它是活的消费路径，不是摆设**。无 VERSION、无任何
机制告知陈旧，只能靠 cmp 逐文件比。

**重装判据（管理者建议，按能力边界而非时间，外层采纳）**——三类触发立即重装：
① **能力新增**（新 skill / 新 loop 文档 / 新 quay-init 铺设项）——不装静默缺能力；
② **安全修复**（被记为「崩溃成因」或「资源安全」的）——今晚四次崩溃三次的修复属此类；
③ **遗传缺陷修复**（影响繁殖保真度的：dist/mcp_entry/版本标记）——不装则下一采用者继承坏基因。
其余可攒。

**关键缺口**：无判据回答「我这份落后了吗」。plugin/sync.sh 已存在但它是【仓库内 canonical→plugin/ 的
资产同步】，不是【plugin→user-scope 的安装】——缺后半段。建议至少加 **VERSION**（或 git describe）+
一条能比对的检查。

### 选定机制

1. 加 VERSION（或 git describe 派生）标记 plugin 版本
2. quay-init（或独立检查）比对 user-scope 安装 vs 当前 plugin 版本——落后则提示/按判据重装
3. 重装判据：能力新增/安全修复/遗传缺陷三类触发立即重装，其余可攒
4. 验证：VERSION 落后 ⇒ 检查报出（负控制：当前无任何机制）

## Acceptance Criteria

- [x] AC1: VERSION（或 git describe）标记 plugin 版本——user-scope 安装 vs 当前可比对
- [x] AC2: 检查比对该版本——落后则报出「你装的这份落后了」（负控制：当前无机制）
- [x] AC3: 重装判据按能力边界——能力新增/安全修复/遗传缺陷三类触发立即重装，其余可攒
- [x] AC4: 与 dist-follow（新鲜度判据）+ 升级通道两种形态交叉标注

## Definition of Done

- [ ] AC1-AC4 全勾（VERSION/git describe 标记 plugin 版本；落后则报出「你装的这份落后了」；重装判据按能力边界三类触发立即重装；与 dist-follow + 升级通道交叉标注）
- [ ] 版本比对实测：落后报出；重装判据三分类落地
- [ ] scoped 门 `scripts/test.sh --for-task gap-user-scope-install-reinstall-criterion-and-version` 绿

## Touches
- tasks/gap-user-scope-install-reinstall-criterion-and-version.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- plugin/VERSION（新增，或 git describe 派生）
- plugin/sync.sh（plugin→user-scope 安装段）或 quay-init（比对检查）
- plugin/test/（AC1-AC3 测试）
- tasks/gap-upgrade-channel-cant-sync-build-artifacts-dist-stale.md（AC4 交叉标注）

## Test-Files

- plugin/test/user-scope-reinstall.test.mjs（AC1-AC3 测试——新文件，`// @test-group product`，12 条）

## Contract

measure   version_stale_detected = `bash <version-check> 2>&1 | grep -c '落后\|stale'` stdout 数字段
band      version_stale_detected >= 1（user-scope 落后时检查报出）
invoke    `grep -n 'VERSION\|git describe\|version' plugin/VERSION plugin/sync.sh 2>/dev/null`
control   user-scope 落后 ⇒ 报出（AC2）；一致 ⇒ 不报
resume    VERSION 与比对检查分步提交，任一步完成即写盘
## Dispatch review

reviewer: outer
at: 2026-08-05T18:2xZ
changed: 外层 filing 时已审（ratchet compliance 补齐 section）

## Evidence（2026-08-08 内层实现 + scoped 门实跑）

**实现**（全部落在 ## Touches 范围）：
- `plugin/VERSION`（新增）——版本标记，当前 `0.4.0`（与 `packages/quay/package.json`、
  `plugin/vendor/quay/package.json`、`plugin/.mcp.json` 同源）。user-scope 安装从此可被比对（AC1）。
- `plugin/sync.sh` —— 新增 user-scope 安装段三个模式（默认无参行为不变，CI 的
  `sync.sh && git diff --exit-code plugin/` 不受影响）：
  - `--install-user-scope <dest>`：plugin→user-scope 安装段（tar 排除 test/fixtures，递归守卫），
    装完在 `<dest>/VERSION` 盖章（AC1）。
  - `--check-user-scope <dest>`：比对 `<dest>/VERSION` vs `plugin/VERSION`——落后 / 无 VERSION 标记
    （修复前的 pre-fix 安装）⇒ 报 `STALE` + 「你装的这份落后了」+ exit 1；一致 ⇒ fresh + exit 0（AC2）。
  - `--reinstall-criterion <desc>...`：能力边界判据——capability-add（新 skill / 新 loop 文档 / 铺设项）、
    security-fix（崩溃 / 安全 / 资源安全）、inherited-defect（dist / mcp_entry / 版本标记）三类 ⇒
    `REINSTALL-IMMEDIATE`；其余 ⇒ `BATCHABLE`（可攒）（AC3）。
- `plugin/test/user-scope-reinstall.test.mjs`（新增，`// @test-group product`，node:test，12 条）——
  全部实跑真实 `bash plugin/sync.sh`，非 mock：AC1 版本标记 + vendored package.json 单源不变量、
  AC2 落后/无标记报 stale + 一致不报（负控制）、Contract measure `grep -c '落后\|stale'` ≥ 1、
  AC3 三类立即 + 其余可攒 + 混合批含任一立即类 ⇒ 立即。

**AC2 负控制实测（修复前无任何机制报陈旧；修复后）**：
```
$ bash plugin/sync.sh --check-user-scope <tmp-nover> ; echo exit=$?
  STALE (user-scope plugin install): <tmp-nover> has no VERSION marker (a pre-0.4.0 install). 你装的这份落后了——your installed copy is stale — reinstall the plugin.
exit=1
$ bash plugin/sync.sh --install-user-scope <tmp-inst> ; cat <tmp-inst>/VERSION
  installed user-scope plugin -> <tmp-inst> (VERSION 0.4.0)
0.4.0
$ bash plugin/sync.sh --check-user-scope <tmp-inst> ; echo exit=$?
  fresh (user-scope plugin install): installed VERSION 0.4.0 == current 0.4.0.
exit=0
$ echo 0.0.1 > <tmp-inst>/VERSION && bash plugin/sync.sh --check-user-scope <tmp-inst> ; echo exit=$?
  STALE (user-scope plugin install): installed VERSION 0.0.1 < current plugin VERSION 0.4.0. 你装的这份落后了——your installed copy is stale — reinstall the plugin.
exit=1
```
Contract measure 实测（落后场景）：`bash plugin/sync.sh --check-user-scope <behind> 2>&1 | grep -c '落后\|stale'` ⇒ `1`（band ≥ 1）。

**AC3 三分类实测**：`new skill: quay-routines` / `crash fix in the session-liveness watchdog` /
`dist stale — mcp_entry + version marker fix` ⇒ 各自 `REINSTALL-IMMEDIATE`（并点名 class）；
`docs typo fix` + `rename an internal variable` ⇒ `BATCHABLE`；混合批（docs typo + security-fix + refactor）
⇒ `REINSTALL-IMMEDIATE`。

**AC4 交叉标注**：`tasks/gap-upgrade-channel-cant-sync-build-artifacts-dist-stale.md` 的
`## Cross-annotation（AC5）` 段已加本任务交叉标注——dist-follow（构建产物轴 mtime/版本一致判据）与本任务
（整包安装物轴 VERSION 比对判据）同根：「安装物没有新鲜度判据」。两轴分开：dist 新鲜度管 dist 跟随源码；
本任务管 user-scope 安装跟随插件版本；`plugin/VERSION` 与 vendored package.json 版本一致性由
user-scope-reinstall 测试断言（单源防漂移）。

**测试**：`node --test plugin/test/user-scope-reinstall.test.mjs` ⇒ **12 pass / 0 fail**。

**scoped 门**：`bash scripts/test.sh --for-task gap-user-scope-install-reinstall-criterion-and-version --allow-thin`
⇒ **exit 0**。静态检查全过：test-framework-policy-check（新文件 @test-group product，豁免表零增长）、
test-isolation-check（44 条全 baseline，零新增）、test-impl-census-check、task-contract-check
（两个任务文件零违规）；选中集跑 `plugin/test/user-scope-reinstall.test.mjs` **12 pass / 0 fail / 0 cancelled**。
注：Touches 四项均非 basename 可解析的测试路径（`plugin/sync.sh`/`plugin/VERSION`/`plugin/test/`/
`tasks/gap-upgrade-channel-...md`），selector 报 thin——`## Test-Files` 声明 + `--allow-thin` 使选中集
正确包含新测试文件（规则 4）。
