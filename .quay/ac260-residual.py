import re, subprocess, collections
BR="dist-plugin"
files = subprocess.run(["git","ls-tree","-r","--name-only",BR],capture_output=True,text=True,check=True).stdout.split()
fileset=set(files)
CAT = re.compile(r'(?:(\$\{CLAUDE_PLUGIN_ROOT\})|([A-Za-z0-9_${}<>./-]*?plugin))/(scripts|gate-scripts)/(dist/)?([A-Za-z0-9_.-]+)\.(ts|js)')
agg=collections.Counter(); rows=[]
for f in [x for x in files if x.rsplit(".",1)[-1] in ("md","sh","js")]:
    txt = subprocess.run(["git","show","%s:%s"%(BR,f)],capture_output=True,text=True,check=True).stdout
    for m in CAT.finditer(txt):
        anchor = "ROOT_ANCHOR" if m.group(1) else "prefixed"
        tgt = "%s/%s%s.%s"%(m.group(3), m.group(4) or "", m.group(5), m.group(6))
        exists = tgt in fileset
        key=(anchor, m.group(4) or "", m.group(6), exists)
        agg[key]+=1
        if not exists: rows.append((f, m.group(0), tgt))
print("== (anchor, dist/, ext, target-exists) => count ==")
for k,v in sorted(agg.items()): print("  %-60s %d"%(str(k),v))
print("== DANGLING (target not on branch): %d =="%len(rows))
for r in rows[:25]: print("   ", r[0], "|", r[1], "-> MISSING", r[2])
