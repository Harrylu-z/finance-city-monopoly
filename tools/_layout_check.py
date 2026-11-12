# 临时校验脚本：解析 board.js 的 LAYOUT，输出实际索引映射与不变量检查
import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

src = open('src/core/board.js', encoding='utf-8').read()
m = re.search(r'const LAYOUT = \[(.*?)\];', src, re.S)
raw = m.group(1)

tokens = []
for tok in re.finditer(r"S\.(\w+)|'([^']+)'", raw):
    if tok.group(1):
        tokens.append('SP:' + tok.group(1))
    else:
        tokens.append(tok.group(2))

print('槽位数:', len(tokens))

REG = {'P', 'C', 'N', 'F'}
def describe(t):
    if t.startswith('SP:'):
        return 'SPECIAL:' + t[3:]
    if t in REG:
        return 'REG:' + t
    g = {'b': 'bank', 'r': 'broker', 'i': 'insurer', 'a': 'asset'}[t[0]]
    return '%s[%s]' % (g, t[1:])

for i, t in enumerate(tokens):
    print('%2d  %-12s %s' % (i, t, describe(t)))

def functional(t):
    return t.startswith('SP:') or t in REG

bad = []
for i in range(len(tokens)):
    a, b = tokens[i], tokens[(i+1) % len(tokens)]
    if functional(a) and functional(b):
        bad.append('%d-%d (%s / %s)' % (i, (i+1) % len(tokens), describe(a), describe(b)))
print('\n相邻功能格对:', bad if bad else '（空）OK')

specials = [i for i, t in enumerate(tokens) if t.startswith('SP:')]
print('特殊格数:', len(specials), '| 索引:', ','.join(map(str, specials)))
print('监管格:', ' '.join('%d:%s' % (i, t) for i, t in enumerate(tokens) if t in REG))
for k, g in (('b','bank'), ('r','broker'), ('i','insurer'), ('a','asset')):
    idxs = [i for i, t in enumerate(tokens) if t[0] == k and len(t) > 1]
    print('%-7s (%2d):' % (g, len(idxs)), ','.join(map(str, idxs)))
