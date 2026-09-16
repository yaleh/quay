---
id: gap-release-yml-missing-github-release-object
title: release.yml 重设计后无任何步骤创建 GitHub Release 对象——v0.8.0 real cut 后 Releases
  页面仍显示 v0.7.1
status: todo
labels:
  - gap
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-274
---
## Proposal

**实证（2026-09-16，manager 执行一次真实 v0.8.0 release cut）**：release run `35100741238` 的
`verify-plugin-channel`/`advance-master` 两个 job 均 `conclusion=success`，`master` 也真的被
fast-forward 到了合并点（`advance-master` job 的逐字设计意图）。但用户随后指出
`https://github.com/yaleh/quay/releases` 显示最新版本仍是 `v0.7.1`。实测复现：

```
$ gh release view v0.8.0 --json tagName,createdAt,assets
release not found
$ grep -nE "action-gh-release|upload-release-asset|gh release (create|upload|edit)" .github/workflows/release.yml
（空，无匹配）
$ gh release list --limit 5
v0.7.1  Latest  v0.7.1  2026-09-16T08:51:24Z
v0.6.3          v0.6.3  2026-09-14T12:48:30Z
...
```

**读当前文件核实（2026-09-16，本任务撰写时逐行读过）**：`.github/workflows/release.yml` 现在
恰好两个 job——`verify-plugin-channel`（:65）与 `advance-master`（:265）。全文档不含
`softprops/action-gh-release`、`gh release create`、`upload-release-asset` 或任何等价字符串——
与上面 `grep` 的空结果一致。`verify-plugin-channel` 的全部七个步骤（checkout / setup-node /
install / build / extract / install claude CLI / marketplace+install+quay-init+driver+serve 探测 /
stop）都只验证"能不能装、能不能起来"，没有一步在 GitHub 上创建任何对象。`advance-master`
（:265-314）只做 `git push origin "${TARGET}:master"`，同样不碰 Releases 面。

**根因**：SPEC §11 的重设计（`gap-release-yml-drop-sea-npm-gate-on-plugin-channel-instead`，已
done）把旧 `release` job 整个删除了——那个 job 同时承担两件事：①npm pack 产物构建、②把产物挂到
GitHub Release（`softprops/action-gh-release@v2` 步骤，正是本次 release cut 之前被
`gap-release-softprops-missing-explicit-tag-name`（现已 superseded，因其唯一的两个调用点随同一次
重设计被删除）修过 `tag_name` 的那两处调用点之一）。人的裁定原文是「取消 sea 和 npm **release**」
（取消**产物渠道**），但实现时把「创建 GitHub Release 对象」这个标记性动作也一并删掉了——这很可能
超出了裁定本意：`master` 已经 ff、`.quay/ci-runs.jsonl` 里也有一条 `conclusion=success` 的记录，
但 GitHub Releases 页面上完全看不到这次发布，任何人去那个页面看，都会误以为最新版本还是
`v0.7.1`。这正是 SPEC 一直在防的「版本号说谎」问题，只是换了个位置复发——只是这次是「发布真的
发生了但用户可见渠道看不到」，而不是「用户可见渠道声称发布了但其实没有」。

**AC-274 的判据没有覆盖这一维**：AC-274 的 criterion 只检查 `.quay/ci-runs.jsonl` 里
`workflow=Release conclusion=success` + `master` 的 commit 是其中某个 tag 的提交，完全没有检查
「GitHub Release 对象本身是否存在/可见」。AC-274 已 `verdict: pass`，本任务不改它的判据，但它的
通过不能被误读为「GitHub Releases 页面已经正确反映发布」——本任务挂靠同一个 goal_ac，因为它是
同一条不变式（"master 只在一次真正完整、用户可感知的发布之后前进"）尚未覆盖的一个维度，不是
它的重复实现。

<!-- dedup-ref -->
**查重**：`gap-release-softprops-missing-explicit-tag-name`（superseded）与
`gap-release-yml-drop-sea-npm-gate-on-plugin-channel-instead`（done）都提到 softprops 调用点被
删除这一事实，但前者的落点是"被删除的 job 该怎么修 tag_name"（已因对象消失而 superseded），
后者是删除本身的实现记录——两者均未把"删除后 Releases 页面不再反映发布"记为一个待修的缺口。
`gap-release-run-tests-hangs-on-shared-mcp-client-leak` 处理的是旧 `release` job 测试步的 client
泄漏，与本任务无关（该 job 已不存在）。本任务是新的、独立的缺口。

## Plan

**①（代码修复，worker 可完成）** 给 `.github/workflows/release.yml` 加回一个轻量步骤——**不需要**
恢复 npm/SEA 产物上传，只需要创建一个标记性的 GitHub Release 对象（可以只带 changelog/说明文字，
不挂任何二进制资产）。建议放在 `verify-plugin-channel` 成功之后（避免"验证还没过、Release 对象
已经创建"的半成品状态），可以是 `verify-plugin-channel` job 自己的最后一步，也可以是一个新的独立
job（`needs: [verify-plugin-channel]`）——由实现者判断，写清楚理由。**幂等性是硬约束**：如果同一
个 tag 被二次 dispatch（比如上次网络失败重试），`gh release create` 对已存在的 tag 会报错失败——
用 `gh release view <tag> || gh release create <tag> ...` 模式，或读 `gh release create --help`
确认是否有等价的"存在则跳过/更新"选项，不能让二次 dispatch 同一个 tag 时这一步失败。

同步核对 `advance-master.needs` 是否要覆盖这个新 job：**已读代码确认**
（`plugin/scripts/release-master-advance-needs-check.ts:25`）——它的判据是纯结构派生
（`needs(advance-master) ⊇ (release.yml 全部 job 键) − {advance-master}`），job 集合每次运行从
文件自身重新解析，不硬编码列表。若把新步骤加进 `verify-plugin-channel` 自己的步骤序列（不新增
job），该检查器**不需要任何改动**，`advance-master.needs` 也不需要改，重跑一次即可确认（job 数
不变）。若选择新增一个独立 job，则**必须**把它加进 `advance-master.needs`，否则该检查器会报
`FAIL — N job(s) missing`——检查器脚本本身不必改，只需 `release.yml` 的 `needs:` 列表同步。

**②（真实验证，manager/outer 后续执行，标「外层验证（待外部）」）** 走一次完整的 SPEC §4.1 分支
纪律（cut 新的 `release/vX.Y.Z` 分支、版本 bump、合回 develop、在合并点打 tag、
`release-branch-finish.sh` 删分支、develop bump 到下一个 `-dev`），真实 dispatch 一次，确认这次
GitHub Releases 页面真的出现了新版本（`gh release view <tag>` 存在，`gh release list` 里它是
`Latest`）。

**③（跨主机验证，manager/outer 后续执行，标「外层验证（待外部）」）** 在 `orangevps` 主机的
`archguard` 项目上，以 **project scope** 安装这次真实发布的 plugin（`claude plugin marketplace add`
+ `claude plugin install quay@quay --scope project -y`），验证：装到的版本号与这次新 tag 一致、
`quay-init` 能跑通、driver/serve 能正常起来（复用 SPEC §11 第 2 点里"2026-09-16 在 ad-arm1
archguard 项目上手工做过的那套验证"同一套流程，这次换成 `orangevps` 主机）。

## AC

- [ ] `.github/workflows/release.yml` 新增的创建 GitHub Release 步骤，结构级验证（YAML 解析成功、
      step 挂在正确的 job 下、依赖顺序正确——即在 `verify-plugin-channel` 之后）。
- [ ] 负控制：新增步骤不引用任何已被 ① 删除的 sea/npm 相关变量/路径（`grep` 该步骤的具体内容，
      确认不含 `SEA_`/`quay-sea-`/`npm pack` 等已退役的字面量）。
- [ ] 幂等性验证：构造一个"tag 已存在 Release 对象"的场景（或读 `gh release create --help` 找到
      等价机制），验证重复 dispatch 不会在这一步失败。
- [ ] 若新增独立 job：`node --experimental-strip-types plugin/scripts/release-master-advance-needs-check.ts
      --root . --json` 重跑，确认它的结构性派生逻辑是否已经/需要覆盖这个新 job（读代码判断，不要
      凭空假设结论——本任务撰写时已确认该检查器结构派生 job 集合，若不新增 job 则无需改动它）。
- [ ]（外层验证，待外部）真实 dispatch 一次完整 SPEC §4.1 分支纪律切出的新版本，`gh release view
      <新tag>` 存在，`gh release list` 显示它是 `Latest`。
- [ ]（外层验证，待外部）`orangevps` 主机 `archguard` 项目 project scope 下真实安装这次新版本的
      plugin，版本号核对一致，`quay-init`/driver/serve 验证通过。

## DoD

验收对象是「GitHub Releases 页面（`https://github.com/yaleh/quay/releases`）真实显示这次新版本为
Latest」+「orangevps 的 archguard 项目真的装到了这个版本并验证可用」——不是「release.yml 加了一段
创建 Release 的 YAML」就算完成（同硬规则 4 推论三：实现了但没真正跑过一次，证明的是"能产出"不是
"已产出"）。

## Touches

- .github/workflows/release.yml
- plugin/scripts/release-master-advance-needs-check.ts（若判断需要，只读或按需修改）
- tasks/gap-release-yml-missing-github-release-object.md
