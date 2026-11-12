// 临时校验脚本：解析 board.js 的 LAYOUT，输出实际索引映射与不变量检查
const fs = require('fs');
const src = fs.readFileSync('src/core/board.js', 'utf8');

const layoutMatch = src.match(/const LAYOUT = \[([\s\S]*?)\];/);
const raw = layoutMatch[1];
const tokens = [];
const re = /S\.(\w+)|'([^']+)'/g;
let m;
while ((m = re.exec(raw))) {
  if (m[1]) tokens.push('SP:' + m[1]);
  else tokens.push(m[2]);
}
console.log('槽位数:', tokens.length);

const SPECIALS = ['start','clearing','crossborder','metro','tax','charity','event','market','audit','risk','refinance','rating','commodity','roadshow'];
const out = [];
tokens.forEach((t, i) => {
  let desc;
  if (t.startsWith('SP:')) desc = 'SPECIAL:' + t.slice(3);
  else if ('PCNF'.includes(t) && t.length === 1) desc = 'REG:' + t;
  else {
    const g = { b: 'bank', r: 'broker', i: 'insurer', a: 'asset' }[t[0]];
    desc = g + '[' + t.slice(1) + ']';
  }
  out.push({ i, t, desc });
});
out.forEach(o => console.log(String(o.i).padStart(2), o.t.padEnd(12), o.desc));

// 不变量
const functional = o => o.t.startsWith('SP:') || ('PCNF'.includes(o.t) && o.t.length === 1);
let bad = [];
for (let i = 0; i < out.length; i++) {
  const a = out[i], b = out[(i+1)%out.length];
  if (functional(a) && functional(b)) bad.push(`${a.i}-${b.i} (${a.desc} / ${b.desc})`);
}
console.log('\n相邻功能格对:', bad.length ? bad : '（空）✓');
const specials = out.filter(o => o.t.startsWith('SP:'));
console.log('特殊格数:', specials.length, '| 特殊格索引:', specials.map(o=>o.i).join(','));
console.log('监管格索引:', out.filter(o=>'PCNF'.includes(o.t)&&o.t.length===1).map(o=>`${o.i}:${o.t}`).join(' '));
// 各集团普通机构索引
for (const [k,g] of Object.entries({b:'bank',r:'broker',i:'insurer',a:'asset'})) {
  console.log(g, ':', out.filter(o=>o.t[0]===k && o.t.length>1).map(o=>o.i).join(','));
}
