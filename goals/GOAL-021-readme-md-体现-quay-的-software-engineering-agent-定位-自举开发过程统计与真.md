---
id: GOAL-021
title: README.md 体现 quay 的 software engineering agent 定位、自举开发过程统计与真实截图
status: active
kind: goal
origin: manager 2026-09-16 激活：3 条 AC 已就位
activatedAt: 2026-09-16T23:33:26.425Z
statusLog:
  - at: 2026-09-16T23:33:26.425Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
---
## 背景（2026-09-16，人裁定 + manager 会话实测数据）

**人的裁定（origin，逐字）**：
1. 项目定位：Software Engineering Agent——与 Claude Code / Codex 这样的 coding agent 对应。
2. **关键澄清（内蕴关系，容易被表述反）**："Claude Code 是 quay 的基础设施，就像 OS 是 Claude Code 的
   基础设施，这是内蕴的。" ⇒ quay 本身就是那个 software engineering agent；Claude Code 是它运行所依赖
   的底层平台（提供 LLM 推理、工具调用、subagent 派发能力），**不是**反过来（⛔ 不得写成"quay 是让
   Claude Code 变成 agent 的协议层/基础设施"这类反向表述——那会把主体搞反）。
3. 应体现本项目的自举开发过程，提供直观的可反映本项目能力的开发过程统计。
4. 提供本项目截图，用 Playwright/chrome-devtools 截图。
5. 设立本 GOAL 系统地执行此项工作。

**实测数据（本次调研时的真实读数，作为 AC-277 统计脚本的验证基线，⛔ 不得直接抄进 README 当写死字面量）**：

```
仓库跨度:    2026-07-15 → 2026-09-16（63 天）
总提交数:    22,696（git rev-list --count HEAD）
任务总数:    2,220（2,149 done / 71 superseded / 0 待办 —— 当前干净稳态）
GOAL:        18 achieved / 2 superseded
AC(判据):    120 achieved / 133 有记录状态
真实发布:    15 个版本（v0.3.9 → v0.9.0，git tag -l "v*"）
checker:     339 个脚本（capability-catalog.sh --summary：339 declared / 0 unclassified）
测试文件:    640 个（packages 265 + plugin/test 375）
driver 轮转: worker 591 轮 / promotion 986 轮（.quay/worker-round.jsonl / promotion-round.jsonl 末条 round）
develop CI:  最近 100 次 run 中 63 failure / 33 cancelled / 4 success（真实、未粉饰——
             这条数据本身就是叙事素材：一个自主系统如何在从未绿过的 CI 上诊断根因并修复，
             比"100% 通过率"更有说服力，因为它体现的是诊断能力而非运气）
```

**截图可行性已验证**：用 chrome-devtools MCP 连接正在运行的 `quay serve`（本机 `100.78.206.100:4173`）
截取了 Dashboard 页面，效果良好（心跳/驱动状态/测试绿率/fan-in 历史/git 历史一屏俱全）——但发现一处
渲染缺陷（页面中段一块灰色空白区域，疑似某组件懒加载未完成），正式产出截图前必须先排查修复，⛔ 不得
带着渲染缺陷的截图直接用。

## 范围（在域 AC，共 3 条）

- **AC-276** README.md 定位段落机械判定：体现"quay 是 software engineering agent，Claude Code 是其
  基础设施（内蕴，类比 OS 之于 Claude Code）"这一关系，且不含反向措辞。
- **AC-277** 开发过程统计从真实生产载体机械产出并嵌入 README，不是手填字面量；判据要求重新跑一次
  统计脚本，输出与 README 中嵌入的数字逐字一致（防止统计漂移——这是本条的核心，不是"有没有统计"）。
- **AC-278** 至少 4 张真实截图（Dashboard / Goals / Task 详情 / Git History）产出并被 README 引用，
  用 chrome-devtools 对真实运行的 quay serve 生成，且已排查修复调研中发现的渲染缺陷。

## 非目标

⛔ 本 GOAL 不改动 quay 的产品功能/代码逻辑（除非 AC-278 排查发现的渲染缺陷本身是一个真实产品 bug，
那种情况下修复它是 AC-278 的应有之义，但不得借机扩大范围去改其他无关的 UI）。
⛔ 不要求 100% 好看的统计数字——develop CI 的真实成功率、任务积压历史等"不完美但真实"的数据本身就是
叙事素材，不得为了好看而选择性隐藏或篡改。

## 退出条件

三条在域 AC 全部 achieved：README.md 的定位陈述准确、开发过程统计可机械重跑验证、截图真实存在且引用
正确。