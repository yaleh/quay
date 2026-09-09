---
id: AC-202
title: 凡被 spawn 的机件必进交付物——把闭包闸扩到 DRIVER_KINDS 这类数据表字面量引用
status: achieved
kind: criterion
goal: GOAL-009
criterion: >-
  node --experimental-strip-types -e '

  const fs = await import("node:fs");

  const m = await import("./packages/quay/scripts/build-plugin-dist.mjs");

  const e = m.deriveEntries("./plugin");

  const shipped = new Set([...e.scripts, ...e.gateScripts].map((p) =>
  p.split("/").pop()));

  const rt = fs.readFileSync("plugin/scripts/driver-runtime.ts", "utf8");

  const required = new Set();

  for (const x of rt.matchAll(/driver:\s*"([A-Za-z0-9_.-]+\.ts)"/g))
  required.add(x[1]);

  for (const x of
  rt.matchAll(/"plugin",\s*"scripts",\s*"([A-Za-z0-9_.-]+\.ts)"/g))
  required.add(x[1]);

  for (const x of
  rt.matchAll(/resolveKernelSibling\(\s*"([A-Za-z0-9_.-]+\.ts)"\s*\)/g))
  required.add(x[1]);

  if (required.size === 0) { console.error("NOT-EVALUATED: required set empty");
  process.exit(3); }

  const missing = [...required].filter((n) => !shipped.has(n));

  if (missing.length) { console.error("MISSING(" + missing.length + "): " +
  missing.join(" ")); process.exit(1); }

  process.exit(0);

  '
expect: 'exit 0 = driver-runtime.ts 中以 driver: "X.ts" 数据表字段、
  path.join(...,"plugin","scripts","X.ts") spawn 形式、或 resolveKernelSibling("X.ts")
  调用（AC-203 迁移后的自身安装位置解析形式）点名的每一个脚本，都在 build-plugin-dist.mjs
  的 entry 集内。exit 1 = 枚举缺件。exit 3 = required 集为空（仪器故障，⛔ 不与合格同形）。'
origin: 2026-09-09 实测：deriveEntries 跑出
  promotion/worker/outer/quality-gate/meta/goal-driver.ts + send-to-session.ts 共
  7 个 MISS。09-08 的 2afc38d91 已把 Core 直引机械化，但未覆盖数据表字面量这一引用形态。
statusLog:
  - at: 2026-09-09T09:03:53.627Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
**判据（能取假）**：2026-09-09 干跑 exit 1，逐个枚举 MISSING(7)。**负控制（已实测）**：把 required 限定为已知随包的 driver-runtime.ts ⇒ 谓词转绿 ⇒ 证明不是恒红。**required 集机械推导自 driver-runtime.ts 自身**，⛔ 不写手维护清单——手维护列表正是 CORE_REFERENCED 漏掉 driver-runtime.ts 的根因（09-08 已因此改为机械推导）。本判据不需要 build，跑在源树上，故足够便宜、可每轮评估。