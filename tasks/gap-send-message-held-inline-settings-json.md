---
id: gap-send-message-held-inline-settings-json
title: 发消息给运行中 worker 恒 held——deliverySettingsFromArgv 把 --settings 内联 JSON 当文件路径读（ENOENT 回退全局无 defaultMode，100% 影响）
status: todo
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

「给运行中的 worker 发消息」恒显示「待批准」（held），**影响面 100%、从上线起对该功能唯一真实场景从未生效**。根因（`packages/quay/src/serve-send.ts:144-166 deliverySettingsFromArgv`，已核实）：
```
const si = argv.indexOf("--settings");
if (si !== -1 && si + 1 < argv.length) {
  const text = readSettingsFile(argv[si + 1]);   // ⚠️ 把 argv[si+1] 当文件路径 fs.readFileSync
  if (text != null) return extractDeliverySettings(text);
}
const global = readSettingsFile(path.join(home, ".claude", "settings.json"));  // 回退
```
worker-driver 启动 worker 时 `--settings` 传的是**内联 JSON 字符串**（`--settings {"$schema":...,"permissions":{"defaultMode":"bypassPermissions"},...}`），不是文件路径——本会话查过的每条 worker 命令行都是这个形态。`readSettingsFile` 对这段 JSON 文本 `fs.readFileSync` 必 ENOENT（本地等价逻辑复现验证），静默返回 null ⇒ 回退读全局 `~/.claude/settings.json`，而全局文件无 `defaultMode`/`crossSessionInbound` 字段 ⇒ 两者 null ⇒ `deliveryStateFor` 条件不满足 ⇒ 恒 held。

⇒ 这段代码把「没读到 --settings 指向的文件」和「--settings 本身就不是文件」混为一谈，永远走不到 worker 真实设置的 `bypassPermissions`。

## Plan

`deliverySettingsFromArgv` 在把 `argv[si+1]` 当路径读之前，先判它是否内联 JSON（trim 后以 `{` 开头）——是则直接 `extractDeliverySettings(argv[si+1])`，不经过 `readSettingsFile`；否则保留现有文件路径分支（向后兼容非内联场景，若存在）。

## Acceptance Criteria

- [ ] AC1（能取假，内联 JSON 直读）：`deliverySettingsFromArgv` 对 `--settings <内联 JSON>`（含 `defaultMode: bypassPermissions`）直接解析出 bypassPermissions，不经文件路径读；（⛔ 仍当路径读 ENOENT ⇒ 假）。
- [ ] AC2（能取假，held 消失）：给一个真实 bypassPermissions worker 发消息，不再恒 held（deliveryStateFor 满足 bypass 条件）；（⛔ 仍 held ⇒ 假）。
- [ ] AC3（能取假，负控制）：`--settings <真实文件路径>` 场景不回归（仍读文件）；`--dangerously-skip-permissions` 分支不回归；（⛔ 回归 ⇒ 假）。

## Definition of Done

`deliverySettingsFromArgv` 内联 JSON 直读落地；AC1/AC2/AC3 全勾；真实 worker（bypassPermissions）发消息不再 held。

## Touches

- packages/quay/src/serve-send.ts（deliverySettingsFromArgv 内联 JSON 判定）
- packages/quay/test/（serve-send 内联 JSON vs 文件路径负控制测试）
- tasks/gap-send-message-held-inline-settings-json.md（自身）
