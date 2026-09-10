---
id: AC-193
title: no orphan suite process
status: achieved
kind: criterion
goal: GOAL-007
criterion: |-
  node -e '
  const fs=require("node:fs"), path=require("node:path"), cp=require("node:child_process");
  const root=cp.execFileSync("git",["rev-parse","--show-toplevel"]).toString().trim();
  const wtPaths=cp.execFileSync("git",["worktree","list","--porcelain"],{encoding:"utf8"}).split("\n").filter(l=>l.startsWith("worktree ")).map(l=>l.slice(9));
  const mainCheckout=wtPaths.find(p=>{ try{ return fs.statSync(path.join(p,".git")).isDirectory(); }catch{ return false; } });
  const wtRoots=new Set(wtPaths.filter(p=>p!==mainCheckout).map(p=>path.dirname(p)));
  let orphans=[];
  for(const pid of fs.readdirSync("/proc")){
    if(!/^\d+$/.test(pid)) continue;
    let t; try{ t=fs.readlinkSync("/proc/"+pid+"/cwd"); }catch{ continue; }
    if(!t.endsWith(" (deleted)")) continue;
    const p=t.slice(0,-" (deleted)".length);
    let under=false; for(const r of wtRoots){ if(p===r||p.startsWith(r+"/")){ under=true; break; } }
    if(!under) continue;
    let cmd=""; try{ cmd=fs.readFileSync("/proc/"+pid+"/cmdline","utf8").replace(/\0/g," "); }catch{}
    if(!/full-suite-runner|suite-load-sampler/.test(cmd)) continue;
    orphans.push(pid+" cwd="+p+" "+cmd.trim().slice(0,120));
  }
  console.log("orphan suite processes (cwd=deleted worktree):", orphans.length);
  for(const o of orphans) console.log("  "+o);
  process.exit(orphans.length===0?0:1);
  '
expect: exit 0
origin: >-
  GOAL-007 三例之②（来源 task：gap-suite-load-sampler-orphan-process）：不得存在 cwd 指向已删
  worktree 的孤儿 suite 进程。

  该 task 落地于 08-27 09:12；孤儿进程起于 08-29 21:07（晚 2.5 天）、存活 8.3 天、cwd 为已删除的
  worktree、

  写 /tmp/fsr-abort-*（full-suite-runner 中止路径）——不是修复前的遗留，是修复未覆盖的路径（2026-09-07
  由人手工清掉）。

  判据读生产载体：进程表（/proc/*/cwd × cmdline）× git worktree list——凡 readlink 结果带「
  (deleted)」、

  落在任一任务 worktree 根目录之下、且 cmdline 是 suite
  机件（full-suite-runner|suite-load-sampler）的进程即孤儿（exit 1）。

  限定 suite 机件避免把 tmux 服务器等非 suite 常驻进程的已删 worktree cwd 误报为孤儿。非 fixture 注入。
---
