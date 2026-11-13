/**
 * 棋盘数据 —— 中国金融城
 *
 * 规模：46 格（同心双环 · 疏朗）
 *   = 35 个普通机构格 + 4 个监管机构格 + 7 个特色特殊格（起点 / 4 转盘 / 2 赌场）
 *
 * 顺时针布局，index 0 = 起点·陆家嘴金融中心。
 *
 * ================= 布局设计：同心双环（10×7 网格）=================
 * 棋盘是 **10 列 × 7 行**的横向网格，两圈同心环被 2 座城门架桥连成
 * **一条闭合回路**（棋子全程平移不瞬移，规则层零改动）：
 *
 *    · **外环（城墙）** 30 格 —— 起点 ×1 + 转盘 ×4 + 外围分行带（25 家机构）；
 *    · **护城河** —— 1 格宽空白带（视觉分隔，不占格）；
 *    · **城门** 2 格 —— 架在顶部护城河上，是 2 块「私人赌场 · 德州扑克」；
 *    · **内环（城中之城）** 14 格 —— 四大监管 ×4 + 总部级 / 地标级资产 ×10。
 *
 * 外环的普通机构按集团切成连续段，顺序为 **银行 → 券商 → 保险 → 资管**，
 * 段与段之间插入一个转盘格，形成
 * \银行段 | 枢纽转盘 | 券商段 | 风险转盘 | 保险段 | 机会转盘 | 资管段 | 命运转盘 * 的节奏 —— 同一集团的土地连成一片，同时每段之间插入转盘制造起伏。
 *
 * 内环 = 越靠中心越贵的核心带：四大监管（可持有、不可升级）+ 10 个最高等级资产。
 *
 * ================= 特殊格合并：16 → 7 =================
 * 原来 16 个特殊格（起点 + 13 个功能格 + 2 个赌场）压缩成 7 个：
 *   · **起点 ×1** —— 陆家嘴金融中心（外环 (4,0)）；
 *   · **转盘 ×4** —— 枢纽 / 风险 / 机会 / 命运，踩到后从候选效果里随机抽一个；
 *   · **赌场 ×2** —— 私人赌场 · 德州扑克（架在城门上）。
 *
 * ⚠ 13 个功能特殊格的**定义必须保留**（转盘内部要用），
 *   只是不再各自独占一个格子。
 *
 * ================= 地块裁剪 =================
 * 原始机构表共 47 个普通机构，本方案只需要 35 个 —— **裁掉 12 个**。
 * 裁剪顺序：等级低 → 买入价低 → 原 index 小；
 * 但**跳过会让某集团某等级断档的地块**（保证每个集团的每一级至少保留 1 个）。
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
      { name: '上海浦东发展银行', code: 'SPDB', price: [640, 1100, 1720, 2600, 3880],rent: [64, 116, 182, 276, 420], kind: 'branch', tier: 3 },
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
      { name: '中证指数公司', code: 'CSI',  price: [880, 1520, 2360, 3540, 5280],rent: [88, 158, 246, 372, 566],kind: 'modern', tier: 4 },
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
    desc: '按机构持有规模计征印花税（每份 ￥40，最低 ￥120、封顶 ￥360）',
  },
  charity: {
    id: 'charity', name: '慈善公益捐赠', short: '公益捐赠', icon: 'charity',
    amount: 120, desc: '向金融公益基金捐赠 ￥120，换取「公益声誉」3 回合：机构管理费 +12%',
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
  /** 风险警示 */
  risk: {
    id: 'risk', name: '风险警示 · 集中度整改', short: '风险警示', icon: 'risk',
    desc: '单一集团持仓超过 3 家时被要求整改：缴纳整改费并进入 2 回合「去杠杆」状态（管理费 -15%）',
    trap: true,
  },
  /** 再融资窗口 —— 可向其他玩家发行债券 */
  refinance: {
    id: 'refinance', name: '再融资窗口 · 债券发行', short: '债券发行', icon: 'bond',
    desc: '可向其他玩家发行债券：票息随你的负债率浮动，认购结果由市场随机决定，需 ≥2 人认购',
  },
  /** 信用评级 —— 提升/下调持有机构的租金 */
  rating: {
    id: 'rating', name: '信用评级 · 展望调整', short: '评级调整', icon: 'rating',
    desc: '获得 3 回合评级展望：上调管理费 +15%，下调管理费 -10%',
  },
  /** 要素市场 · 大宗交易 */
  commodity: {
    id: 'commodity', name: '要素市场 · 大宗交易', short: '大宗交易', icon: 'commodity',
    desc: '按行情方向折溢价结算，并建立 2 回合「套期保值」状态（管理费 +5%）',
  },
  /** 投资者路演 */
  roadshow: {
    id: 'roadshow', name: '投资者路演', short: '路演', icon: 'roadshow',
    desc: '获得 ￥80 意向金与 3 回合「路演热度」：收购与升级成本 -15%',
  },
  /**
   * 赌场 · 德州扑克 —— 踩入即开启一局德州扑克（所有玩家参与）。
   * 可用现金下注，也可抵押资产换取下注额度。
   */
  casino: {
    id: 'casino', name: '私人赌场 · 德州扑克', short: '赌场', icon: 'casino',
    desc: '所有玩家参与一局德州扑克：可用现金或资产抵押下注，牌库严格一副 52 张',
  },
};

/**
 * ==================== 四大转盘 ====================
 *
 * 原来 13 个功能特殊格把轨道切得太碎 —— 现在把它们按语义打包成
 * **4 个转盘格**：踩到格子 → 弹大转盘 → 指针旋转 → 停在某个扇区 →
 * 走该效果**原有的结算逻辑**。
 *
 * 每个候选效果带自己的：显示名 / SVG 图标 id / 关键数值读数（big）/
 * 说明文字（lbl）/ 是否陷阱（trap）——
 * 这样转盘扇区和棋盘上的转盘格都能用真实图标与数值表达，而不是抽象文字。
 */
export const WHEELS = [
  {
    id: 'hub', label: '枢纽转盘', cat: 'hub', color: '#2f9fc4', lt: '#63c6e6',
    dk: '#1c6b88', sign: '流转', icon: 'hub',
    desc: '三种「移动类」效果随机抽取一个：改写你落脚的地点',
    outcomes: [
      { id: 'clearing', name: '清算所', icon: 'clearing', big: '直达', lbl: '结算机构' },
      { id: 'metro', name: '地铁枢纽', icon: 'metro', big: '1/2/3', lbl: '前进格数' },
      { id: 'crossborder', name: '跨境互联', icon: 'crossborder', big: '随机', lbl: '飞往机构' },
    ],
  },
  {
    id: 'risk', label: '风险转盘', cat: 'cost', color: '#c8392b', lt: '#e4604d',
    dk: '#8d2419', sign: '付出', icon: 'risk',
    desc: '三种「代价类」效果随机抽取一个，其中两格是陷阱',
    outcomes: [
      { id: 'tax', name: '印花税', icon: 'tax', big: '￥40', lbl: '每份 · 封顶360' },
      { id: 'audit', name: '监管抽查', icon: 'audit', big: '处罚', lbl: '罚款/没收', trap: true },
      { id: 'risk', name: '风险警示', icon: 'risk', big: '整改', lbl: '去杠杆 2 回合', trap: true },
    ],
  },
  {
    id: 'chance', label: '机会转盘', cat: 'gain', color: '#4f9d55', lt: '#7ac77f',
    dk: '#336b38', sign: '收益', icon: 'chance',
    desc: '五种「增益类」效果随机抽取一个：都与长期收益挂钩',
    outcomes: [
      { id: 'charity', name: '公益捐赠', icon: 'charity', big: '-￥120', lbl: '管理费 +12%' },
      { id: 'roadshow', name: '投资者路演', icon: 'roadshow', big: '+￥80', lbl: '成本 -15%' },
      { id: 'rating', name: '评级调整', icon: 'rating', big: '±15%', lbl: '管理费 3 回合' },
      { id: 'commodity', name: '大宗交易', icon: 'commodity', big: '折溢价', lbl: '套保 2 回合' },
      { id: 'refinance', name: '债券发行', icon: 'refinance', big: '债券', lbl: '票息浮动' },
    ],
  },
  {
    id: 'fate', label: '命运转盘', cat: 'random', color: '#8b5cc7', lt: '#b189e0',
    dk: '#5c3a86', sign: '抽取', icon: 'fate',
    desc: '两种「全局类」效果随机抽取一个：影响的不只是你',
    outcomes: [
      { id: 'event', name: '财经快讯', icon: 'event', big: '抽 1', lbl: '财经事件卡' },
      { id: 'market', name: '牛熊切换', icon: 'market', big: '牛↔熊', lbl: '全局租金' },
    ],
  },
];

/** 转盘 id → 转盘定义 */
export const WHEEL_BY_ID = WHEELS.reduce((m, w) => { m[w.id] = w; return m; }, {});

/**
 * 转盘格 —— 特殊格的一种新类型（kind = 'wheel'）。
 *
 * 与普通特殊格的区别：
 *   · wheelId —— 指向 WHEELS 里的哪一个转盘；
 *   · outcomes —— 候选效果 id 列表（决定扇区数）；
 *   · outcomeData —— 候选效果的完整元数据（名称 / 图标 / 数值读数 / 陷阱标记）。
 *
 * 结算时随机选一个候选，再走该效果在 rules.js 里**原有的** case 分支。
 */
function makeWheelSpecial(w) {
  return {
    id: w.id,
    name: w.label,
    short: w.label,
    icon: w.icon,
    kind: 'wheel',
    cat: w.cat,
    sign: w.sign,
    wheelId: w.id,
    color: w.color, lt: w.lt, dk: w.dk,
    outcomes: w.outcomes.map((o) => o.id),
    outcomeData: w.outcomes.map((o) => ({ ...o })),
    desc: w.desc,
    trap: false,
  };
}

/** 特殊格 ID 列表（供自检） */
export const SPECIAL_IDS = Object.keys(SPECIAL);

/**
 * 棋盘形状 —— **同心双环（疏朗）**，共 46 格。
 *
 * 10 列 × 7 行网格：外环 30 格（城墙）+ 护城河 + 城门 2 格 + 内环 14 格，
 * 两环由城门架桥并成一条闭合回路，环道首尾相连、绝不断裂。
 *
 * 形状数据集中在 core/board-shape.js，渲染层依此计算每格矩形，
 * 逻辑层仍按 index 顺时针推进。
 */
export {
  BOARD_SHAPE, BOARD_GRID, TRACK, TRACK_POINTS, SIDE_COUNTS,
  cellTrackPos, trackSpacing, trackGap, PLAZA_CENTER, cellSideInfo,
  INNER_INDICES, GATE_INDICES, ZONES, TRACK_CELLS,
  cellZone, isInner, isGate,
  INNER_COUNT, OUTER_COUNT, GATE_COUNT,
} from './board-shape.js';

// 内部使用（棋盘组装时判断赌场是否落在城门槽位上）
import { GATE_INDICES } from './board-shape.js';

export const BOARD_SIZE = 46;

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

/**
 * 棋盘组装 —— 显式声明式布局。
 *
 * 为什么要显式声明：功能格（特殊格 + 监管格）必须均匀穿插在普通机构格
 * 之间，用「按顺序 push」的旧写法很容易把它们挤到相邻位置。
 * 这里改成「槽位表」：先按 index 逐槽填写内容，再由 assertNoAdjacent
 * 在构建期校验不变量 —— 一旦有人把两个功能格排到了一起，导入即报错。
 */

/** 特殊格槽位简写 */
const S = {
  start: 'start',
  casino: 'casino',
  // 四大转盘（候选效果定义在 WHEELS / SPECIAL 中）
  hub: 'hub', risk: 'risk', chance: 'chance', fate: 'fate',
};

/**
 * 槽位表 —— 长度必须等于 BOARD_SIZE（46）。
 *
 * 记号：
 *   'b0'~'b11'  银行集团（12 家，价格/租金由低到高）
 *   'r0'~'r10'  券商集团（11 家）
 *   'i0'~'i10'  保险集团（11 家）
 *   'a0'~'a12'  资管集团（13 家）
 *   'P'/'C'/'N'/'F'  四家监管机构（央行 / 证监会 / 银保监 / 金稳会）
 *   'hub'/'risk'/'chance'/'fate'  四大转盘格
 *   'start'/'casino'  起点 / 赌场
 *
 * ================= 分区结构 =================
 *   index  0..29  外环（城墙）30 格
 *       · 0        起点 · 陆家嘴金融中心
 *       · 1..7     银行段（7 家，网点级 → 分行级）
 *       · 8        枢纽转盘（流转：清算所 / 地铁 / 跨境互联）
 *       · 9..13    券商段（5 家）
 *       · 14       风险转盘（付出：印花税 / 监管抽查 / 风险警示）
 *       · 15..20   保险段（6 家）
 *       · 21       机会转盘（收益：公益 / 路演 / 评级 / 大宗 / 债券）
 *       · 22..28   资管段（7 家）
 *       · 29       命运转盘（抽取：财经快讯 / 牛熊切换）
 *   index  30      城门 A · 私人赌场（架在顶部护城河）
 *   index  31..44  内环（城中之城）14 格
 *       · 31..34   四大监管（央行 / 证监会 / 银保监 / 金稳会）
 *       · 35..44   10 个总部级 / 地标级资产（越靠中心越贵）
 *   index  45      城门 B · 私人赌场
 *
 * 布局要点（由 assertNoAdjacentFunctionalCells 在导入期强制校验）：
 *   · index 0 固定为「陆家嘴金融中心」起点；
 *   · 每个集团普通机构在外环连续排布，段与段之间插入一个转盘格；
 *   · 内环 14 格 = 4 监管 + 10 最高等级资产，前 4 格是监管、
 *     之后 10 格全是 tier 4 —— 越靠中心越贵；
 *   · 2 块赌场架在城门上（30 / 45），功能格互不相邻。
 */
const LAYOUT = [
  // ===== 外环 · 起点 =====
  S.start,
  // ===== 外环 · 银行段（7 家）=====
  'b10', 'b6', 'b11', 'b7', 'b5', 'b3', 'b1',
  // ===== 外环 · 枢纽转盘 =====
  'hub',
  // ===== 外环 · 券商段（5 家）=====
  'r10', 'r6', 'r4', 'r2', 'r0',
  // ===== 外环 · 风险转盘 =====
  'risk',
  // ===== 外环 · 保险段（6 家）=====
  'i10', 'i6', 'i7', 'i5', 'i3', 'i1',
  // ===== 外环 · 机会转盘 =====
  'chance',
  // ===== 外环 · 资管段（7 家）=====
  'a10', 'a11', 'a6', 'a7', 'a5', 'a3', 'a1',
  // ===== 外环 · 命运转盘 =====
  'fate',
  // ===== 城门 A · 赌场（架在顶部护城河，连接内外环）=====
  S.casino,
  // ===== 内环 · 四大监管（城中之城最核心）=====
  'P', 'C', 'N', 'F',
  // ===== 内环 · 总部级 / 地标级资产 ×10 =====
  'r7', 'a8', 'i8', 'r8', 'b8', 'a12', 'r9', 'i9', 'b9', 'a9',
  // ===== 城门 B · 赌场（回到外环起点）=====
  S.casino,
];

/** 槽位 → 集团与下标 */
function parseSlot(slot) {
  switch (slot) {
    case 'P': return { kind: 'regulator', group: 'bank', regKey: 'pbc' };
    case 'C': return { kind: 'regulator', group: 'broker', regKey: 'csrc' };
    case 'N': return { kind: 'regulator', group: 'insurer', regKey: 'nfra' };
    case 'F': return { kind: 'regulator', group: 'asset', regKey: 'fsc' };
    default: break;
  }
  // 四大转盘 —— 候选效果清单来自 WHEELS
  if (WHEEL_BY_ID[slot]) {
    return { kind: 'wheel', wheelId: slot };
  }

  // 只有「集团前缀 + 合法整数下标」才是机构槽位。
  // 特殊格 id（audit / asset 等）也以字母开头，必须校验下标部分，
  // 否则 'audit' 会被误判成 asset 集团且下标为 NaN。
  const groupKey = { b: 'bank', r: 'broker', i: 'insurer', a: 'asset' }[slot[0]];
  if (groupKey) {
    const entryIndex = parseInt(slot.slice(1), 10);
    if (Number.isInteger(entryIndex) && String(entryIndex) === slot.slice(1)) {
      return { kind: 'institution', group: groupKey, entryIndex };
    }
  }
  return { kind: 'special', specialKey: slot };
}

export const BOARD_CELLS = (() => {
  if (LAYOUT.length !== BOARD_SIZE) {
    throw new Error(`棋盘槽位数 ${LAYOUT.length} ≠ ${BOARD_SIZE}`);
  }
  const cells = [];
  LAYOUT.forEach((slot, index) => {
    const s = parseSlot(slot);
    if (s.kind === 'institution') {
      const group = GROUPS[s.group];
      const entry = group.entries[s.entryIndex];
      if (!entry) throw new Error(`槽位 ${slot} 越界：${s.group}[${s.entryIndex}]`);
      cells.push({ index, ...makeInstitution(s.group, entry) });
    } else if (s.kind === 'regulator') {
      cells.push({ index, ...makeRegulator(s.group, s.regKey) });
    } else if (s.kind === 'wheel') {
      const w = WHEEL_BY_ID[s.wheelId];
      cells.push({
        index, type: 'special', group: null,
        special: makeWheelSpecial(w),
        name: w.label, code: w.id.toUpperCase(),
      });
    } else {
      const sp = SPECIAL[s.specialKey];
      if (!sp) throw new Error(`未知特殊格 ${s.specialKey}`);
      // 赌场若落在城门槽位上 → 标记 kind = 'gate'（渲染层画城门造型）
      const special = (sp.id === 'casino' && GATE_INDICES.includes(index))
        ? { ...sp, kind: 'gate', casinoNo: GATE_INDICES.indexOf(index) + 1 }
        : sp;
      cells.push({
        index, type: 'special', special, group: null,
        name: special.name, code: special.code || special.id.toUpperCase(),
      });
    }
  });
  return cells;
})();

/**
 * 构建期不变量校验 —— 功能格（特殊格 + 监管格）不得相邻。
 * 违反时直接抛错，让问题在导入阶段就暴露，而不是等到渲染才发现。
 *
 * ⚠ 两处**预期**的例外（同心双环拓扑决定的，无法回避）：
 *   1. **城门格（赌场）**架在护城河上，一侧必然挨着外环末格、
 *      另一侧必然挨着内环首格 —— 因此城门与相邻功能格贴邻是正常的；
 *   2. **四大监管在内环首尾相连**（央行 → 证监会 → 银保监 → 金稳会）——
 *      它们同属「城中之城」的权力中枢，连成一段是刻意的排布。
 *
 *   除此之外的所有功能格相邻都视为错误。
 */
function assertNoAdjacentFunctionalCells(cells) {
  const functional = (c) => c.type === 'special' || c.regulator;
  const isGate = (c) => c.type === 'special' && c.special?.kind === 'gate';
  for (let i = 0; i < cells.length; i++) {
    const a = cells[i];
    const b = cells[(i + 1) % cells.length];
    if (functional(a) && functional(b)) {
      // 城门豁免：城门的一侧贴着外环末格、另一侧贴着内环首格
      if (isGate(a) || isGate(b)) continue;
      // 监管豁免：四大监管在内环连成一段（权力中枢）
      if (a.regulator && b.regulator) continue;
      throw new Error(`功能格相邻：#${i} ${a.name} 与 #${(i + 1) % cells.length} ${b.name}`);
    }
  }
}
assertNoAdjacentFunctionalCells(BOARD_CELLS);

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

/**
 * 清算所跳转目标：地图另一端的代表性机构。
 *
 * 这四个索引必须随棋盘重排同步更新，并满足：
 *   1) 指向普通机构格（不能是特殊格 / 监管格 / 清算所自身）；
 *   2) 分散在地图不同方位，避免每次都跳到同一个角落；
 *   3) 传送步数必须为 1 ~ BOARD_SIZE-1 之间的正数，且落点精确等于目标。
 *
 * 当前对应（46 格同心双环棋盘）：
 *   银行段(2) / 券商段(12) / 保险段(18) / 资管段(25)
 * —— 分别落在四个集团区段，跳往四个完全不同的方位。
 */
export const CLEARING_TARGETS = [2, 12, 18, 25];

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
    // 46 格版：每个集团 8~10 普通机构 + 1 监管机构
    //   银行  9 普通 + 1 监管 = 10
    //   券商  8 普通 + 1 监管 =  9
    //   保险  8 普通 + 1 监管 =  9
    //   资管 10 普通 + 1 监管 = 11
    const expect = { bank: 10, broker: 9, insurer: 9, asset: 11 }[g];
    if (n !== expect) {
      errors.push(`集团 ${g} 有 ${n} 格，应为 ${expect}`);
    }
  }
  const specials = BOARD_CELLS.filter((c) => c.type === 'special').length;
  if (specials !== 7) {
    errors.push(`特殊格 ${specials} 个，应为 7（起点 1 + 转盘 4 + 赌场 2）`);
  }
  // ===== 转盘格：必须恰好 4 个，且候选效果都要有定义 =====
  const wheelCells = BOARD_CELLS.filter((c) => c.type === 'special' && c.special?.kind === 'wheel');
  if (wheelCells.length !== 4) {
    errors.push(`转盘格 ${wheelCells.length} 个，应为 4`);
  }
  for (const c of wheelCells) {
    const sp = c.special;
    if (!sp.outcomes || !sp.outcomes.length) {
      errors.push(`${c.name} 缺少候选效果列表`);
      continue;
    }
    if (!sp.outcomeData || sp.outcomeData.length !== sp.outcomes.length) {
      errors.push(`${c.name} 候选效果元数据与 id 列表不匹配`);
    }
    for (const oid of sp.outcomes) {
      if (!SPECIAL[oid]) {
        errors.push(`${c.name} 的候选效果 ${oid} 没有定义`);
      }
    }
  }
  // ===== 赌场地块：必须恰好 2 块 =====
  const casinos = BOARD_CELLS.filter((c) => c.type === 'special' && c.special?.id === 'casino');
  if (casinos.length !== 2) {
    errors.push(`赌场地块 ${casinos.length} 个，应为 2`);
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

  // ===== 功能格不相邻（城门豁免）=====
  // 「功能格」= 特殊格 + 监管机构格。二者在环形序列中不得彼此紧邻，
  // 否则特殊格会连成一片，玩家落点分布严重偏斜。
  // 例外：城门格（赌场）架在护城河上，一侧必然挨着外环末格、
  // 另一侧必然挨着内环首格 —— 拓扑决定，允许贴邻。
  const isFunctional = (c) => c.type === 'special' || c.regulator;
  const isGateCell = (c) => c.type === 'special' && c.special?.kind === 'gate';
  for (let i = 0; i < BOARD_CELLS.length; i++) {
    const a = BOARD_CELLS[i];
    const b = BOARD_CELLS[(i + 1) % BOARD_CELLS.length];
    if (isFunctional(a) && isFunctional(b)
        && !isGateCell(a) && !isGateCell(b)
        && !(a.regulator && b.regulator)) {
      errors.push(`功能格相邻：#${i} ${a.name} 与 #${(i + 1) % BOARD_CELLS.length} ${b.name}`);
    }
  }

  // ===== 起点固定在 index 0 =====
  if (BOARD_CELLS[0].special?.id !== 'start') {
    errors.push(`index 0 应为起点，实为 ${BOARD_CELLS[0].name}`);
  }

  // ===== 清算所跳转目标有效且分散 =====
  // 46 格版没有独立的「清算所」格（它被合并进枢纽转盘），
  // 因此以「枢纽转盘格」为传送源来校验落点精确性。
  const clearingIdx = BOARD_CELLS.findIndex(
    (c) => c.type === 'special' && c.special?.kind === 'wheel' && c.special?.wheelId === 'hub');
  if (clearingIdx < 0) {
    errors.push('未找到枢纽转盘格（清算所跳转源）');
  }
  for (const t of CLEARING_TARGETS) {
    const c = BOARD_CELLS[t];
    if (!c || c.type !== 'institution' || c.regulator) {
      errors.push(`清算所目标 ${t} 不是普通机构格`);
    }
    if (t === clearingIdx) {
      errors.push(`清算所目标 ${t} 不能是清算所自身`);
    }
    // 传送步数必须落在 1 ~ BOARD_SIZE-1，落点必须精确等于目标
    const delta = (t - clearingIdx + BOARD_SIZE) % BOARD_SIZE;
    const steps = delta > 0 ? delta : BOARD_SIZE;
    if (steps < 1 || steps >= BOARD_SIZE) {
      errors.push(`清算所目标 ${t} 传送步数异常：${steps}`);
    }
    if ((clearingIdx + steps) % BOARD_SIZE !== t) {
      errors.push(`清算所目标 ${t} 传送落点错误`);
    }
  }
  if (new Set(CLEARING_TARGETS).size !== CLEARING_TARGETS.length) {
    errors.push('清算所目标存在重复');
  }
  // 目标必须分散在至少 3 个区段，避免每次都跳向同一侧
  const quarters = new Set(CLEARING_TARGETS.map((t) => Math.floor(t / (BOARD_SIZE / 4))));
  if (quarters.size < 3) {
    errors.push(`清算所目标分布过于集中（仅 ${quarters.size} 个区段）`);
  }

  return errors;
}
