#!/usr/bin/env python3
"""校验项目中所有相对 import 路径是否可解析（零依赖检查脚本）。"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAT = re.compile(r"""(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]""")

bad = []
total = 0
for dp, _dn, fns in os.walk(os.path.join(ROOT, "src")):
    for fn in fns:
        if not fn.endswith(".js"):
            continue
        p = os.path.join(dp, fn)
        with open(p, encoding="utf-8") as f:
            src = f.read()
        for m in PAT.finditer(src):
            spec = m.group(1)
            total += 1
            target = os.path.normpath(os.path.join(dp, spec))
            if not os.path.isfile(target):
                bad.append((os.path.relpath(p, ROOT), spec))

print("检查相对 import 共 %d 条" % total)
if bad:
    print("发现 %d 条无效路径:" % len(bad))
    for f, s in bad:
        print("   %s -> %s" % (f, s))
    sys.exit(1)
print("全部通过 ✓")
