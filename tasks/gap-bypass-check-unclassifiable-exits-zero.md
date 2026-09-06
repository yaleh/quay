---
id: gap-bypass-check-unclassifiable-exits-zero
title: direct-to-develop-bypass-check 读不懂 3627 条提交却 exit 0——套件看到「通过」，它要抓的六个提交就在不可分类样本里
status: ready
labels:
  - gap
  - defect
  - meta-driver
parent: null
children: []
extra: {}
---
## Finding

**结论**：`direct-to-develop-bypass-check.ts`——本仓专为「直接提交 develop 绕过 fan-in 机件」而建的守卫——在**生产调用形态下完全惰性**：它读不懂范围内的 3627 条提交，其中**恰好包含它被造出来要抓的那些**，却以 **exit 0** 收场，套件因此看到「通过」。

**实测（生产参数，非我自造）**：`runner-static-gate.ts:706` 的真实调用是 `--root ${main_root} --baseline b11ce7202b46406d5d5bc82ef7b4c030c4aed05b --json`。照此跑：

```
{"evaluated": false, "ok": true, "reason": "unclassifiable-commits-in-range",
 "unclassifiableCommits": 3627,
 "unclassifiableSample": ["c7dbac6d4…","07120072d…","0c7a5015d…","7bb46a7fe…","5659b3f69…","2f0e595c7…","8df7abeae…", …]}
退出码 = 0
```

**样本里那几条正是漏网的对象**：`c7dbac6d4` / `7bb46a7fe` / `2f0e595c7` / `26a03d8c7` 等六个 `meta-driver:` 提交，经由手工 worktree 分支 `worktree-driver-of-driver-spec-amendment` 的双亲合并 `125ba19ff` 直接 ff 进 develop（`git merge-base --is-ancestor 125ba19ff develop` ⇒ 真），全程未跑过一次全量 suite。

**已排除的两个替代解释（都做了对照，非推测）**：
- ⛔ 不是 worktree 的 reflog 假象：从 worktree 根与从主检出根 `--root /home/yale/work/quay` 跑，结果**逐字相同**（同为 3627 / evaluated:false / exit 0）。
- ⛔ 不是「没传基线才扫全历史」：不传基线是 11237 条，传生产基线后降到 3627 条，**但仍然 evaluated:false 且仍含目标提交**。

**它并非不诚实——问题在退出码这一层**。JSON 里已带 `evaluated:false` 与 `reason`，这一半是符合硬规则 3b 的；但 `ok:true` 与 **exit 0** 并列，使**只看退出码的消费者（`run_checker`）读到「合格」**。⇒「读不懂」被伪装成「查过且合格」，正是 3b 要防的那一种，只是发生在输出层而非判定层。

**修法有本仓现成先例，同族脚本，逐字**：`quay-init-closure-ratchet.ts:24-26`——
> NOT-EVALUATED (exit 3, hard rule 3b): ... a checker that could not read its input must never look like 「合格」 (exit 0). **run_checker treats exit 3 as a third state**

⇒ `run_checker` 已经支持第三态，缺的只是本检查器去用它。

**为什么这次代价可见**：该守卫沉默 ⇒ 那批改动没跑过全量 suite ⇒ `quay-init-closure-ratchet` 从未对它们跑过 ⇒ laydown 悄涨 3146 字节（实测 `plugin/probes/meta-driver.md` 12672→15818，与棘轮超出量**逐字节相等**）⇒ 由**无关任务**的 fan-in 替它挨红。

**归属**：`gap-direct-to-develop-bypasses-fan-in-gates` 已 **done**，而缺陷仍在 ⇒ 假完成，应被驱动而非被它挡住（⛔ 不要在它旁边新造并行守卫，要修这一个）。与 `gap-quay-init-closure-ratchet-manual-reanchor-recurs`（ready）**不重叠**：那条修棘轮的手工再锚形态，本条修「守卫读不懂却报通过」。

## AC

- [ ] 读不懂 ⇒ 退出码可区分：在 `evaluated:false` 时退出码为 **3**（NOT-EVALUATED），⛔ 不再是 0。判据：以生产参数（`--root <主检出> --baseline b11ce7202b46406d5d5bc82ef7b4c030c4aed05b`）跑，用 `if/else` 捕获退出码（⛔ 不用 `|| rc=$?`，会触发 instrument FAMILY-3），断言为 3。立条时实测为 **0**（能取假）。
- [ ] 负控制：构造一个**能**分类且无越权提交的范围，该检查器仍须 `evaluated:true` 且退出码 0 ⇒ 证明改动没有把它变成恒红。
- [ ] 3627 条不可分类的**根因被写出来**并附一条可核对的读数（例如：reflog 深度不足 / merge 形态不在枚举内 / 时间窗外），⛔ 不接受只把退出码改成 3 而不查为什么读不懂——那只是把静默失败变成响亮失败。
- [ ] 分类覆盖率成为可读数：输出中给出 `classified / total` 比例，使「这个守卫今天看得见多少」可被后续核对。

## DoD

- [ ] 上述判据本轮实跑并贴出输出，⛔ 不是转述。
- [ ] 用本条修好的检查器重放 `125ba19ff` 那批 `meta-driver:` 提交：要么被判为越权（报红），要么给出它们**为何合规**的具体理由；⛔ 不接受仍然落进 unclassifiable。
- [ ] `plugin/test/direct-to-develop-bypass-check.test.mjs` 增一条钉住「evaluated:false ⇒ 退出码 3」的用例，且该用例在改动前会红。
- [ ] ⛔ 未新增并行守卫；⛔ 未把 exit 3 一律改成 exit 1（那会在读不懂时挡住全仓 fan-in，代价与收益不成比例）。

## Touches

- `plugin/scripts/direct-to-develop-bypass-check.ts`
- `plugin/test/direct-to-develop-bypass-check.test.mjs`
- `tasks/gap-bypass-check-unclassifiable-exits-zero.md`
