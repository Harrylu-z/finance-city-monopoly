# 临时：构造「均匀穿插」的槽位表
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

GROUPS_N = [('bank', 11, 'b', 'P'), ('broker', 11, 'r', 'C'),
            ('insurer', 11, 'i', 'N'), ('asset', 12, 'a', 'F')]
TOTAL_PLAIN = sum(n for _, n, _, _ in GROUPS_N)
N = TOTAL_PLAIN + 18

# 手工槽位表（63 项）
LAYOUT = [
    'start',            # 0
    'b0', 'b1',         # 1-2
    'event',            # 3
    'b2', 'b3', 'b4',   # 4-6
    'tax',              # 7
    'b5', 'b6',         # 8-9
    'audit',            # 10
    'b7', 'b8',         # 11-12
    'b9', 'b10',        # 13-14
    'P',                # 15
    'r0', 'r1',         # 16-17
    'clearing',         # 18
    'r2', 'r3', 'r4',   # 19-21
    'metro',            # 22
    'r5', 'r6',         # 23-24
    'r7', 'r8', 'r9',   # 25-27
    'rating',           # 28
    'r10',              # 29
    'C',                # 30
    'i0', 'i1',         # 31-32
    'risk',             # 33
    'i2', 'i3',         # 34-35
    'commodity',        # 36
    'i4', 'i5',         # 37-38
    'i6',               # 39
    'roadshow',         # 40
    'i7', 'i8',         # 41-42
    'i9', 'i10',        # 43-44 中国人保（保险集团末位）
    'N',                # 45 金融监管总局
    'a0', 'a1',         # 46-47
    'charity',          # 48
    'a2', 'a3',         # 49-50
    'crossborder',      # 51
    'a4', 'a5',         # 52-53
    'refinance',        # 54
    'a6', 'a7',         # 55-56
    'F',                # 57 金融稳定委员会（资管集团末位）
    'a8', 'a9',         # 58-59
    'market',           # 60
    'a10', 'a11',       # 61-62
]
print('槽位数:', len(LAYOUT))

SPECIAL_IDS = {'start','event','tax','audit','clearing','metro','rating','commodity',
               'risk','roadshow','crossborder','charity','market','refinance'}
def functional(t):
    return t in SPECIAL_IDS or t in ('P','C','N','F')

bad = [(i, LAYOUT[i], LAYOUT[(i+1) % 63]) for i in range(63)
       if functional(LAYOUT[i]) and functional(LAYOUT[(i+1) % 63])]
print('相邻功能格:', bad if bad else '(空) OK')

pos = [i for i, t in enumerate(LAYOUT) if functional(t)]
gaps = [(pos[(k+1) % len(pos)] - pos[k]) % 63 or 63 for k in range(len(pos))]
print('功能格索引:', pos)
print('间隔(格数):', gaps)
print('最短间隔:', min(gaps), '| 最长间隔:', max(gaps))

for g, pfx in (('bank','b'), ('broker','r'), ('insurer','i'), ('asset','a')):
    idxs = [i for i, t in enumerate(LAYOUT) if t[0] == pfx]
    print('%-8s %2d:' % (g, len(idxs)), idxs)

print()
for i, t in enumerate(LAYOUT):
    print('%2d  %s' % (i, t))


