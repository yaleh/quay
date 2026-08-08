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

- [ ] AC1: VERSION（或 git describe）标记 plugin 版本——user-scope 安装 vs 当前可比对
- [ ] AC2: 检查比对该版本——落后则报出「你装的这份落后了」（负控制：当前无机制）
- [ ] AC3: 重装判据按能力边界——能力新增/安全修复/遗传缺陷三类触发立即重装，其余可攒
- [ ] AC4: 与 dist-follow（新鲜度判据）+ 升级通道两种形态交叉标注

## Definition of Done

- [ ] AC1-AC4 全勾（VERSION/git describe 标记 plugin 版本；落后则报出「你装的这份落后了」；重装判据按能力边界三类触发立即重装；与 dist-follow + 升级通道交叉标注）
- [ ] 版本比对实测：落后报出；重装判据三分类落地
- [ ] scoped 门 `scripts/test.sh --for-task gap-user-scope-install-reinstall-criterion-and-version` 绿

## Touches

- plugin/VERSION（新增，或 git describe 派生）
- plugin/sync.sh（plugin→user-scope 安装段）或 quay-init（比对检查）
- plugin/test/（AC1-AC3 测试）
- tasks/gap-upgrade-channel-cant-sync-build-artifacts-dist-stale.md（AC4 交叉标注）

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
