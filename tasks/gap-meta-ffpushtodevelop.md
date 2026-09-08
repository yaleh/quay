---
id: gap-meta-ffpushtodevelop
title: semantic 兜底 ff-push 丢弃 git stderr —— 8 次 semantic-ff-failed 不可归因
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
semanticSyncDocToDevelop 的最终 ff-push（ffPushToDevelop, driver-filters.ts:252 用 stdio:ignore）失败 8/15 次却丢弃 git 原因，semantic-ff-failed 事件不带 detail

本轮读数（syncHealth.semanticFfFailed）= `8`，采于 2026-09-07T09:57:37Z，由 meta-driver 机械采集。
涉及机制关键词：`ffPushToDevelop`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [x] `node --experimental-strip-types --input-type=module - <<'JS'
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { semanticSyncDocToDevelop } from './plugin/scripts/driver-filters.ts';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semff-'));
fs.mkdirSync(path.join(root, 'tasks'), { recursive: true });
const g = (a) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' });
g(['init', '-q']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
fs.writeFileSync(path.join(root, 'f.txt'), 'a');
g(['add', '-A']); g(['commit', '-qm', 'base']); g(['branch', 'develop']); g(['checkout', '-qb', 'author']);
fs.writeFileSync(path.join(root, 'f.txt'), 'b'); g(['commit', '-qam', 'ahead']);
const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'semff-wt-'));
g(['worktree', 'add', '-q', wt, 'develop']);
semanticSyncDocToDevelop(root, 'author');
const ev = fs.readFileSync(path.join(root, '.quay', 'doc-develop-sync.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.event === 'doc-develop-sync-semantic-ff-failed');
if (!ev.length) { console.error('no semantic-ff-failed event'); process.exit(1); }
const d = ev[ev.length - 1].detail;
if (typeof d !== 'string' || !d.trim() || d.trim() === '<no-stderr-captured>') { console.error('detail missing or placeholder'); process.exit(1); }
JS` ⇒ 强制非-ff 的 push 走语义路径后，doc-develop-sync-semantic-ff-failed 事件携带非空 detail（真实 git stderr，非占位符）

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/driver-filters.ts`
- `plugin/test/driver-filters.test.mjs`
- `tasks/gap-meta-ffpushtodevelop.md`