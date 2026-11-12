/**
 * 棋盘数据 —— 中国金融城
 *
 * 规模：63 格（9 列 × 7 行的非正方形环形棋盘）
 *   = 45 个普通机构格 + 4 个监管机构格 + 14 个特色特殊格
 *
 * 顺时针布局，index 0 = 起点·陆家嘴金融中心：
 *
 *    0        起点·陆家嘴金融中心        (+￥200 货币发行补贴 / 可申请央行贷款)
 *    1-11     银行集团 ×11               含「中国工商银行」地标格
 *   12        中国人民银行（监管格）      不可升级
 *   13        清算所 · 互联互通           （跳转指定格）
 *   14-24    券商集团 ×11               含「华泰证券」地标格
 *   25        中国证监会（监管格）        不可升级
 *   26        地铁 · 通勤枢纽             （可选前进 1/2/3 格）
 *   27-37    保险集团 ×11               含「中国人保」地标格
 *   38        金融监管总局（监管格）      不可升级
 *   39        财经快讯 · 事件卡
 *   40        合规成本                    （印花税 / 交易手续费 / 监管罚款）
 *   41        监管抽查 · 陷阱格           （触发监管处罚 / 强制披露）
 *   42        慈善公益捐赠
 *   43-54    资管集团 ×12               含三大交易所
 *   55        金融稳定委员会（监管格）    不可升级
 *   56        信用评级 · 展望调整
 *   57        要素市场 · 大宗交易
 *   58        投资者路演
 *   59        跨境互联 · 港股通          （随机飞往另一处机构）
 *   60        风险警示 · 陷阱格           （风险暴露 / 集中度整改）
 *   61        市场周期 · 牛熊切换
 *   62        再融资窗口                 （可向其他玩家发行债券）
 *
 * 监管机构（人民银行 / 证监会 / 银保监 / 金稳会）：
 *   · 可以被玩家「收购经营权」（一次性买断，占用大量现金）
 *   · 不可升级（level 永远为 0）
 *   · 持有后对全局产生特殊效果（见 economy.js / rules.js 的 REGULATOR_EFFECTS）
 *
 * 定价模型（现代金融城曲线：低起步价、高成长、靠升级赚钱）：
 *   level 0 网点级 / 1 支行级 / 2 分行级 / 3 总部级 / 4 地标级
 *   price[] = 买入该等级所需资金，rent[] = 该等级基础管理费
 *   升级费用 = 下一级 price × 升级系数
 */

/** 升级等级定义 —— 体积与收益随等级递增 */
export const LEVELS = [
  { lv: 0, label: '网点级', mult: 1.0,  bonus: 0 },
  { lv: 1, label: '支行级', mult: 1.5,  bonus: 0 },
  { lv: 2, label: '分行级', mult: 2.2,  bonus: 0 },
  { lv: 3, label: '总部级', mult: 3.2,  bonus: 0 },
  { lv: 4, label: '地标级', mult: 4.6,  bonus: 0 },
];

/** 机构造型类型 —— 不同类型形态必须明显不同 */
export const BUILDING_KINDS = {
  branch:   'branch',    // 银行：矮而宽，低层网点 + 圆弧顶
  tower:    'tower',     // 券商：高而尖，玻璃幕墙 + 天线
  midrise:  'midrise',   // 保险：方正中层 + 穹顶顶冠
  landmark: 'landmark',   // 地标：摩天金融中心 + 顶部标志物
  modern:   'modern',    // 资管：现代几何体量
  regulator: 'regulator', // 监管机构：对称穹顶 + 天平/徽章（不可升级）
};

export const GROUP_META = {
  bank: {
    id: 'bank', name: '银行集团', short: '银行',
    desc: '存款、信贷与货币创造 —— 牌照最硬的赛道',
    kind: BUILDING_KINDS.branch,
  },
  broker: {
    id: 'broker', name: '券商集团', short: '券商',
    desc: '承销、经纪与自营 —— 弹性最大的赛道',
    kind: BUILDING_KINDS.tower,
  },
  insurer: {
    id: 'insurer', name: '保险集团', short: '险资',
    desc: '长期资金压舱石 —— 现金流最稳的赛道',
    kind: BUILDING_KINDS.midrise,
  },
  asset: {
    id: 'asset', name: '资管集团', short: '资管',
    desc: '基金、信托与交易所 —— 生态链最长的赛道',
    kind: BUILDING_KINDS.modern,
  },
};

/**
 * 四大监管机构 —— 可被持有，持有后提供全局特殊效果。
 * regulatorId 决定效果；监管格不可升级。
 */
export const REGULATORS = {
  pbc: {
    id: 'pbc', name: '中国人民银行', code: 'PBOC', short: '央行',
    group: 'bank', kind: BUILDING_KINDS.regulator,
    price: 3200, rent: 0, tier: 0, maxLevel: 0, regulator: true,
    regulatorId: 'pbc',
    effect: '货币政策 —— 每圈开始获得额外 ￥80 流动性投放',
    effectName: '流动性投放',
  },
  csrc: {
    id: 'csrc', name: '中国证监会', code: 'CSRC', short: '证监会',
    group: 'broker', kind: BUILDING_KINDS.regulator,
    price: 3400, rent: 0, tier: 0, maxLevel: 0, regulator: true,
    regulatorId: 'csrc',
    effect: '发行审核 —— 全体玩家升级费用降低 12%',
    effectName: '注册制便利',
  },
  nfra: {
    id: 'nfra', name: '金融监管总局', code: 'NFRA', short: '银保监',
    group: 'insurer', kind: BUILDING_KINDS.regulator,
    price: 3000, rent: 0, tier: 0, maxLevel: 0, regulator: true,
    regulatorId: 'nfra',
    effect: '审慎监管 —— 全体玩家租金收入降低 8%（稳健但保守）',
    effectName: '审慎约束',
  },
  fsc: {
    id: 'fsc', name: '金融稳定委员会', code: 'FSC', short: '金稳会',
    group: 'asset', kind: BUILDING_KINDS.regulator,
    price: 3600, rent: 0, tier: 0, maxLevel: 0, regulator: true,
    regulatorId: 'fsc',
    effect: '风险处置 —— 每次触发陷阱格时，罚金减免 50%',
    effectName: '风险缓冲',
  },
};

/**
 * 每个集团 11~12 格，级别递进：
 *   0~3  低价小型机构（网点级 / 区域级）
 *   4~7  中型机构（区域总部）
 *   8~9  大型机构（全国性总部）
 *   10   行业标杆（地标级）
 *   监管格插在末尾，不可升级
 *
 * price[5] / rent[5] 对应 level 0..4。
 * tier 字段表示初始可经营等级上限；landmark 的格子初始即为地标级。
 */
const GROUPS = {
  bank: {
    entries: [
      { name: '城东银行',     code: 'CDBK', price: [180, 320, 520, 820, 1240],   rent: [18, 32, 54, 86, 132],   kind: 'branch',   tier: 0 },
      { name: '浦江银行',     code: 'PJBK', price: [200, 360, 580, 900, 1360],   rent: [20, 36, 60, 96, 148],   kind: 'branch',   tier: 0 },
      { name: '江城银行',     code: 'JCBK', price: [220, 400, 640, 990, 1500],   rent: [22, 40, 66, 105, 162],  kind: 'branch',   tier: 1 },
      { name: '华夏银行',     code: 'HXBK', price: [320, 560, 880, 1340, 2000],  rent: [32, 58, 92, 142, 218],  kind: 'branch',   tier: 1 },
      { name: '华信银行',     code: 'HXBQ', price: [380, 660, 1040, 1580, 2360], rent: [38, 68, 108, 166, 254], kind: 'branch',   tier: 2 },
      { name: '中国工商行',   code: 'ICBC', price: [520, 900, 1400, 2120, 3160], rent: [52, 94, 148, 226, 346], kind: 'branch',   tier: 2 },
      { name: '中国建设银行', code: 'CCB',  price: [620, 1060, 1660, 2520, 3760],rent: [62, 112, 176, 268, 410], kind: 'branch',   tier: 3 },
      { name: '中国银行',     code: 'BOC',  price: [720, 1240, 1940, 2940, 4380],rent: [72, 130, 206, 312, 478], kind: 'branch',   tier: 3 },
      { name: '中国农业银行', code: 'ABC',  price: [860, 1480, 2300, 3480, 5180],rent: [86, 156, 244, 370, 566], kind: 'branch',   tier: 4 },
      { name: '招商银行',     code: 'CMB',  price: [980, 1680, 2600, 3900, 5780],rent: [98, 178, 274, 416, 634], kind: 'branch',   tier: 4 },
      { name: '中国工商银行', code: 'ICBC2',price: [1400, 2260, 3380, 4880, 6980],rent: [140, 226, 338, 488, 698], kind: 'landmark', tier: 4, landmark: true, landmarkName: '金融街塔' },
    ],
  },
  broker: {
    entries: [
      { name: '华瑞证券',   code: 'HRZQ', price: [200, 360, 580, 900, 1360],   rent: [21, 38, 62, 98, 150],   kind: 'tower', tier: 0 },
      { name: '中信证券',   code: 'ZXZQ', price: [260, 460, 730, 1120, 1680],  rent: [27, 48, 78, 122, 186],  kind: 'tower', tier: 1 },
      { name: '国泰海通',   code: 'GTHT', price: [300, 520, 820, 1260, 1880],  rent: [30, 54, 86, 134, 204],  kind: 'tower', tier: 1 },
      { name: '中金公司',   code: 'CICC', price: [380, 660, 1040, 1580, 2360], rent: [38, 68, 108, 166, 254], kind: 'tower', tier: 2 },
      { name: '招商证券',   code: 'ZSYQ', price: [420, 720, 1120, 1700, 2540], rent: [42, 74, 116, 178, 272], kind: 'tower', tier: 2 },
      { name: '广发证券',   code: 'GFZQ', price: [520, 900, 1400, 2120, 3160], rent: [52, 94, 148, 226, 346], kind: 'tower', tier: 3 },
      { name: '中信建投',   code: 'ZXJT', price: [580, 1000, 1560, 2360, 3520],rent: [58, 104, 164, 250, 382], kind: 'tower', tier: 3 },
      { name: '东方证券',   code: 'DFZQ', price: [680, 1180, 1840, 2780, 4140],rent: [68, 122, 192, 292, 446], kind: 'tower', tier: 4 },
      { name: '申万宏源',   code: 'SWHY', price: [820, 1420, 2200, 3320, 4940],rent: [82, 148, 232, 352, 538], kind: 'tower', tier: 4 },
      { name: '中金财富',   code: 'CICCW',price: [900, 1560, 2400, 3620, 5380],rent: [90, 162, 252, 384, 584], kind: 'tower', tier: 4 },
      { name: '华泰证券',   code: 'HTZQ', price: [1500, 2420, 3600, 5180, 7380],rent: [150, 242, 360, 518, 738],kind: 'landmark', tier: 4, landmark: true, landmarkName: '交易塔' },
    ],
  },
  insurer: {
    entries: [
      { name: '太保产险',   code: 'CPICP', price: [190, 340, 540, 860, 1300],   rent: [19, 34, 56, 90, 138],   kind: 'midrise', tier: 0 },
      { name: '平安财险',   code: 'PAP',   price: [210, 380, 600, 960, 1440],   rent: [21, 38, 62, 98, 150],   kind: 'midrise', tier: 0 },
      { name: '人保财险',   code: 'PICCP', price: [230, 410, 650, 1040, 1560], rent: [23, 42, 68, 108, 166],  kind: 'midrise', tier: 1 },
      { name: '中国人寿',   code: 'CHL',   price: [340, 600, 940, 1420, 2120],  rent: [34, 62, 98, 150, 228],  kind: 'midrise', tier: 1 },
      { name: '中国平安',   code: 'PA',    price: [400, 700, 1100, 1660, 2480], rent: [40, 76, 120, 182, 278],  kind: 'midrise', tier: 2 },
      { name: '阳光保险',   code: 'SUN',   price: [440, 760, 1200, 1820, 2720], rent: [44, 82, 128, 196, 300],  kind: 'midrise', tier: 2 },
      { name: '大家保险',   code: 'DAJIA', price: [560, 960, 1500, 2280, 3400],  rent: [56, 100, 158, 240, 368], kind: 'midrise', tier: 3 },
      { name: '太平洋保险', code: 'CPIC',  price: [660, 1140, 1780, 2680, 4000], rent: [66, 118, 186, 282, 432], kind: 'midrise', tier: 3 },
      { name: '新华保险',   code: 'NCI',   price: [800, 1380, 2140, 3240, 4820], rent: [80, 144, 226, 344, 526], kind: 'midrise', tier: 4 },
      { name: '中国太平',   code: 'CTP',   price: [900, 1540, 2380, 3600, 5340], rent: [90, 160, 250, 380, 580], kind: 'midrise', tier: 4 },
      { name: '中国人保',   code: 'PICC',  price: [1500, 2400, 3580, 5180, 7380],rent: [150, 240, 358, 518, 738],kind: 'landmark', tier: 4, landmark: true, landmarkName: '保障巨擘' },
    ],
  },
  asset: {
    entries: [
      { name: 'XX 私募基金',  code: 'PEFX',  price: [170, 300, 490, 780, 1180],   rent: [17, 30, 50, 82, 126],   kind: 'modern', tier: 0 },
      { name: '华夏基金',     code: 'CHINA',price: [230, 400, 640, 1000, 1500],  rent: [23, 40, 66, 106, 162],  kind: 'modern', tier: 0 },
      { name: '易方达基金',   code: 'EFD',  price: [270, 460, 730, 1140, 1700],  rent: [27, 48, 78, 122, 186],  kind: 'modern', tier: 1 },
      { name: '南方基金',     code: 'NF',   price: [360, 620, 980, 1500, 2240],  rent: [36, 66, 104, 160, 244],  kind: 'modern', tier: 1 },
      { name: '博时基金',     code: 'BOS',  price: [440, 760, 1200, 1820, 2720], rent: [44, 82, 128, 196, 300],  kind: 'modern', tier: 2 },
      { name: '中信信托',     code: 'CIT',  price: [540, 920, 1440, 2180, 3260], rent: [54, 98, 154, 234, 358],  kind: 'modern', tier: 2 },
      { name: '平安信托',     code: 'PAT',  price: [600, 1040, 1620, 2460, 3680],rent: [60, 110, 172, 262, 400],  kind: 'modern', tier: 3 },
      { name: '五矿信托',     code: 'MKT',  price: [700, 1200, 1880, 2840, 4240],rent: [70, 124, 194, 296, 452],  kind: 'modern', tier: 3 },
      { name: '工银瑞信',     code: 'ICBC', price: [780, 1340, 2100, 3160, 4700],rent: [78, 142, 222, 338, 516],  kind: 'modern', tier: 4 },
      { name: '上海证券交易所',code: 'SSE',  price: [1000, 1700, 2640, 3980, 5920],rent: [100, 170, 264, 398, 592],kind: 'modern', tier: 4 },
      { name: '深圳证券交易所',code: 'SZSE', price: [1080, 1840, 2860, 4320, 6440],rent: [108, 184, 286, 432, 660],kind: 'modern', tier: 4 },
      { name: '中金所',       code: 'CFFEX',price: [1150, 1960, 3040, 4580, 6820],rent: [115, 196, 304, 458, 682],kind: 'modern', tier: 4 },
    ],
  },
};

/** 特殊格定义 */
export const SPECIAL = {
  start: {
    id: 'start', name: '陆家嘴金融中心', short: '起点', icon: 'start',
    desc: '每圈经过 +￥200 货币发行补贴，并可申请央行贷款',
  },
  clearing: {
    id: 'clearing', name: '清算所 · 互联互通', short: '清算所', icon: 'clearing',
    desc: '结算资金直达指定机构',
  },
  crossborder: {
    id: 'crossborder', name: '跨境互联 · 港股通', short: '跨境互联', icon: 'cross',
    desc: '随机飞往地图另一处机构',
  },
  metro: {
    id: 'metro', name: '地铁 · 通勤枢纽', short: '地铁枢纽', icon: 'metro',
    desc: '可选择前进 1/2/3 格',
  },
  tax: {
    id: 'tax', name: '合规成本 · 印花税/监管罚款', short: '合规成本', icon: 'tax',
    desc: '缴纳印花税与交易手续费，或因合规瑕疵被监管处罚',
    amountRange: [140, 180, 240],
  },
  charity: {
    id: 'charity', name: '慈善公益捐赠', short: '公益捐赠', icon: 'charity',
    amount: 120, desc: '向金融公益基金捐赠',
  },
  event: {
    id: 'event', name: '财经快讯 · 事件卡', short: '财经快讯', icon: 'event',
    desc: '抽取一张中国金融风事件卡',
  },
  market: {
    id: 'market', name: '市场周期 · 牛熊切换', short: '牛熊切换', icon: 'market',
    desc: '行情转折点，影响全局租金',
  },
  /** 陷阱格 —— 监管抽查 */
  audit: {
    id: 'audit', name: '监管抽查 · 穿透检查', short: '监管抽查', icon: 'audit',
    desc: '触发监管处罚：罚款、没收收益或强制披露',
    trap: true,
  },
  /** 陷阱格 —— 风险警示 */
  risk: {
    id: 'risk', name: '风险警示 · 集中度整改', short: '风险警示', icon: 'risk',
    desc: '触发风险事件：集中度超限、评级下调或流动性抽紧',
    trap: true,
  },
  /** 再融资窗口 —— 可向其他玩家发行债券 */
  refinance: {
    id: 'refinance', name: '再融资窗口 · 债券发行', short: '债券发行', icon: 'bond',
    desc: '可向其他玩家发行债券，需 ≥2 人认购方能成功',
  },
  /** 信用评级 —— 提升/下调持有机构的租金 */
  rating: {
    id: 'rating', name: '信用评级 · 展望调整', short: '评级调整', icon: 'rating',
    desc: '获得评级展望调整，租金收益随之变动',
  },
  /** 要素市场 · 大宗交易 */
  commodity: {
    id: 'commodity', name: '要素市场 · 大宗交易', short: '大宗交易', icon: 'commodity',
    desc: '大宗交易折溢价结算，现金双向流动',
  },
  /** 投资者路演 */
  roadshow: {
    id: 'roadshow', name: '投资者路演', short: '路演', icon: 'roadshow',
    desc: '路演推介成功，资产估值提升',
  },
};

/** 特殊格 ID 列表（供自检） */
export const SPECIAL_IDS = Object.keys(SPECIAL);

/**
 * 棋盘形状 —— 非正方形：9 列 × 7 行 = 63 格
 * 渲染层依此计算每格矩形，逻辑层仍按 index 顺时针推进。
 * 63 可被 9 整除，每条边恰好 7 格，环形拓扑闭合无误差。
 * 横向略宽的版式更适合宽屏 —— 单元格接近正方形，立绘与文字都不挤。
 */
export const BOARD_SHAPE = { cols: 9, rows: 7 };

export const BOARD_SIZE = BOARD_SHAPE.cols * BOARD_SHAPE.rows; // 63

function makeInstitution(groupId, e) {
  const isReg = !!e.regulator;
  return {
    type: 'institution',
    group: groupId,
    name: e.name,
    code: e.code,
    price: e.price,
    rent: e.rent,
    kind: e.kind,
    tier: e.tier,
    landmark: !!e.landmark,
    landmarkName: e.landmarkName || null,
    regulator: isReg,
    regulatorId: e.regulatorId || null,
    // 监管机构不可升级：maxLevel 固定为 0
    maxLevel: isReg ? 0 : 4,
  };
}

/** 监管机构格 —— 走监管集团自己的造型 */
function makeRegulator(groupId, regKey) {
  const r = REGULATORS[regKey];
  return makeInstitution(groupId, {
    name: r.name, code: r.code, price: [r.price], rent: [r.rent],
    kind: r.kind, tier: r.tier, regulator: true, regulatorId: r.regulatorId,
  });
}

export const BOARD_CELLS = (() => {
  const cells = [];
  const push = (cell) => cells.push({ index: cells.length, ...cell });

  push({ type: 'special', special: SPECIAL.start, group: null, name: SPECIAL.start.name, code: 'START' });
  GROUPS.bank.entries.forEach((e) => push(makeInstitution('bank', e)));
  push(makeRegulator('bank', 'pbc'));
  push({ type: 'special', special: SPECIAL.clearing, group: null, name: SPECIAL.clearing.name, code: 'CLEAR' });
  GROUPS.broker.entries.forEach((e) => push(makeInstitution('broker', e)));
  push(makeRegulator('broker', 'csrc'));
  push({ type: 'special', special: SPECIAL.metro, group: null, name: SPECIAL.metro.name, code: 'METRO' });
  GROUPS.insurer.entries.forEach((e) => push(makeInstitution('insurer', e)));
  push(makeRegulator('insurer', 'nfra'));
  push({ type: 'special', special: SPECIAL.event, group: null, name: SPECIAL.event.name, code: 'NEWS' });
  push({ type: 'special', special: SPECIAL.tax, group: null, name: SPECIAL.tax.name, code: 'TAX' });
  push({ type: 'special', special: SPECIAL.audit, group: null, name: SPECIAL.audit.name, code: 'AUDIT' });
  push({ type: 'special', special: SPECIAL.charity, group: null, name: SPECIAL.charity.name, code: 'GIVE' });
  GROUPS.asset.entries.forEach((e) => push(makeInstitution('asset', e)));
  push(makeRegulator('asset', 'fsc'));
  push({ type: 'special', special: SPECIAL.rating, group: null, name: SPECIAL.rating.name, code: 'RATE' });
  push({ type: 'special', special: SPECIAL.commodity, group: null, name: SPECIAL.commodity.name, code: 'CMDTY' });
  push({ type: 'special', special: SPECIAL.roadshow, group: null, name: SPECIAL.roadshow.name, code: 'ROAD' });
  push({ type: 'special', special: SPECIAL.crossborder, group: null, name: SPECIAL.crossborder.name, code: 'XB' });
  push({ type: 'special', special: SPECIAL.risk, group: null, name: SPECIAL.risk.name, code: 'RISK' });
  push({ type: 'special', special: SPECIAL.market, group: null, name: SPECIAL.market.name, code: 'MKT' });
  push({ type: 'special', special: SPECIAL.refinance, group: null, name: SPECIAL.refinance.name, code: 'BOND' });

  return cells;
})();

/** 机构格索引列表（含监管格） */
export const INSTITUTION_CELLS = BOARD_CELLS
  .map((c, i) => (c.type === 'institution' ? i : -1))
  .filter((i) => i >= 0);

/** 可升级的普通机构格索引（不含监管格） */
export const UPGRADABLE_CELLS = BOARD_CELLS
  .map((c, i) => (c.type === 'institution' && !c.regulator ? i : -1))
  .filter((i) => i >= 0);

/** 监管格索引 */
export const REGULATOR_CELLS = BOARD_CELLS
  .map((c, i) => (c.type === 'institution' && c.regulator ? i : -1))
  .filter((i) => i >= 0);

/** 按集团分组的机构索引（含监管格） */
export const GROUP_CELLS = {
  bank:    BOARD_CELLS.map((c, i) => (c.group === 'bank' ? i : -1)).filter((i) => i >= 0),
  broker:  BOARD_CELLS.map((c, i) => (c.group === 'broker' ? i : -1)).filter((i) => i >= 0),
  insurer: BOARD_CELLS.map((c, i) => (c.group === 'insurer' ? i : -1)).filter((i) => i >= 0),
  asset:   BOARD_CELLS.map((c, i) => (c.group === 'asset' ? i : -1)).filter((i) => i >= 0),
};

/** 清算所跳转目标：地图另一端的代表性机构 */
export const CLEARING_TARGETS = [23, 46, 35, 51];

/** 事件卡池 —— 中国金融风小事件 */
export const EVENT_CARDS = [
  { id: 'e1',  title: '监管发布新规',       text: '资管新规落地，影子定价被约束，全行业管理费小幅下调。',     effect: { cash: -80, rentMult: 0.90, scope: 'all' } },
  { id: 'e2',  title: '公司被举牌',         text: '某产业资本举牌增持，金融街情绪为之一振。',                   effect: { cash: 220, scope: 'self' } },
  { id: 'e3',  title: '获得过桥贷款',       text: '流动性紧张关头，过桥资金到账，账面现金充裕。',               effect: { cash: 260, scope: 'self' } },
  { id: 'e4',  title: '季报超预期',         text: '营收利润双超预期，机构估值上修。',                           effect: { cash: 180, scope: 'self' } },
  { id: 'e5',  title: '遭遇黑天鹅',         text: '境外市场剧烈波动，风险偏好骤降。',                           effect: { cash: -240, scope: 'self' } },
  { id: 'e6',  title: '接到一笔并购要约',   text: '产业整合提速，公司现金大增。',                               effect: { cash: 200, scope: 'self' } },
  { id: 'e7',  title: '债券违约潮',         text: '信用风险暴露，全市场管理费承压。',                           effect: { rentMult: 0.85, scope: 'all' } },
  { id: 'e8',  title: '央行降准释放流动性', text: '资金面转松，全行业手续费收入回暖。',                         effect: { rentMult: 1.15, scope: 'all' } },
  { id: 'e9',  title: '北向资金大幅流入',   text: '外资持续加仓，机构牌照溢价抬升。',                           effect: { rentMult: 1.20, scope: 'all' } },
  { id: 'e10', title: 'IPO 审核提速',        text: '资本市场活跃度提升，投行收益大增。',                         effect: { cash: 200, scope: 'self' } },
  { id: 'e11', title: '影子银行风险暴露',   text: '监管穿透检查，隐性杠杆被压降。',                             effect: { cash: -180, scope: 'self' } },
  { id: 'e12', title: 'REITs 扩容获批',     text: '资产证券化通道打开，资产估值整体抬升。',                     effect: { rentMult: 1.25, scope: 'all' } },
];

/** 陷阱格事件池 —— 监管抽查 / 风险警示 */
export const TRAP_CARDS = [
  { id: 't1', title: '现场检查 · 罚没款',   text: '监管现场检查发现内控缺陷，机构被处以罚款。',   effect: { cash: -260, scope: 'self' } },
  { id: 't2', title: '责令整改',           text: '监管责令限期整改，暂停部分业务，机会成本上升。', effect: { cash: -140, rentMult: 0.90, scope: 'self' } },
  { id: 't3', title: '评级下调',           text: '主体评级被下调，融资成本抬升。',                 effect: { cash: -100, scope: 'self' } },
  { id: 't4', title: '集中度超限',         text: '单一客户集中度超限，被要求压降风险敞口。',       effect: { cash: -200, scope: 'self' } },
  { id: 't5', title: '监管约谈',           text: '高管被监管约谈，合规成本隐性增加。',             effect: { cash: -80, scope: 'self' } },
  { id: 't6', title: '信息系统检查',       text: '信息系统灾备不合规，被通报批评并罚没部分费用。',   effect: { cash: -180, scope: 'self' } },
  { id: 't7', title: '窗口指导',           text: '监管窗口指导要求压降高风险资产定价，久期损失。',   effect: { rentMult: 0.88, scope: 'self' } },
  { id: 't8', title: '流动性抽紧',         text: '同业流动性抽紧，资产变现折价明显。',             effect: { cash: -160, scope: 'self' } },
];

/** 校验棋盘结构（供自检使用） */
export function validateBoard() {
  const errors = [];
  if (BOARD_CELLS.length !== BOARD_SIZE) {
    errors.push(`棋盘格数 ${BOARD_CELLS.length} ≠ ${BOARD_SIZE}`);
  }
  for (const g of ['bank', 'broker', 'insurer', 'asset']) {
    const n = GROUP_CELLS[g].length;
    // 每个集团 11 普通机构 + 1 监管机构 = 12（资管 12 普通 + 1 监管 = 13）
    const expect = g === 'asset' ? 13 : 12;
    if (n !== expect) {
      errors.push(`集团 ${g} 有 ${n} 格，应为 ${expect}`);
    }
  }
  const specials = BOARD_CELLS.filter((c) => c.type === 'special').length;
  if (specials !== 14) {
    errors.push(`特殊格 ${specials} 个，应为 14`);
  }
  const regs = REGULATOR_CELLS.length;
  if (regs !== 4) {
    errors.push(`监管格 ${regs} 个，应为 4`);
  }
  // 每个格子索引必须与数组位置一致
  for (let i = 0; i < BOARD_CELLS.length; i++) {
    if (BOARD_CELLS[i].index !== i) {
      errors.push(`第 ${i} 格 index 字段为 ${BOARD_CELLS[i].index}`);
    }
  }
  for (const c of BOARD_CELLS) {
    if (c.type !== 'institution') continue;
    if (c.regulator && c.maxLevel !== 0) {
      errors.push(`${c.name} 为监管机构，maxLevel 应为 0`);
    }
    if (!c.regulator) {
      for (let i = 1; i < c.price.length; i++) {
        if (c.price[i] <= c.price[i - 1]) {
          errors.push(`${c.name} 买入价未递增 @${i}`);
        }
        if (c.rent[i] <= c.rent[i - 1]) {
          errors.push(`${c.name} 租金未递增 @${i}`);
        }
      }
    }
  }
  return errors;
}
