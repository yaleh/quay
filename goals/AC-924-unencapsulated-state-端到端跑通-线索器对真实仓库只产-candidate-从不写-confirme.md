---
id: AC-924
title: unencapsulated-state 端到端跑通：线索器对真实仓库只产 candidate（从不写 confirmed），判断器经
  recorded-verdict replay 拒绝 memoized/计数器/注册表误报并确认真状态簇
status: active
kind: criterion
goal: GOAL-911
criterion: node --test plugin/test/unencapsulated-state-admission.test.mjs
expect: 正向：`plugin/test/unencapsulated-state-admission.test.mjs` 全绿（criterion
  exit 0），断言四件事：(1) 线索器（`plugin/scripts/unencapsulated-state-clue.ts`，生产入口而非
  fixture-only）对**本仓库**跑一遍，输出的每条记录 `state` ∈
  线索层词表（`docs/analysis/semantic-admission-contract.mjs` 的
  `CLUE_STATES`），`confirmed` 计数为 0，且 `candidate` 计数 ≥ 1 并在输出里被报告；(2) 线索器对
  memoized 探针 / 诊断计数器 / 已封装注册表三类误报样本都输出 `state:"candidate"`，从不输出 `confirmed`；(3)
  判断器经 recorded-verdict replay（不调用真实 LLM）对上述三类误报输出 `refuted`、对真状态簇样本输出
  `confirmed`，且每条 `confirmed` 带「若不为真则结果不同」的 `counterfactual`；(4) `confirmed`
  的候选进入 Planner 的 `semantic-judged` 记录路径，不经过 mechanical 的 delta 判定。反向（能取假）：把判断器对
  memoized 样本的 verdict 从 `refuted` 改成 `confirmed`，测试红；让线索器输出
  `confirmed`，测试红（线索层词表里根本没有这个取值）；删掉测试文件，criterion exit 1（`node --test` 对不存在的文件
  exit 1）。
origin: GOAL-911 退出条件③；AC-920 的实质断言 + AC-922 的可取假判据合并为一条自足 AC（AC-920 criterion 经
  tail 吞掉退出码，AC-922 expect 不含实质断言）。
activatedAt: 2026-10-23T07:24:36.232Z
---
