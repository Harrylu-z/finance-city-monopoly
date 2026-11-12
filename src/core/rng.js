/**
 * 确定性随机数（Mulberry32）—— 用于种子局复现与 AI 随机扰动。
 * 所有游戏内随机都必须走这里，禁止直接用 Math.random()（除非明确非确定性场景）。
 */

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function makeRng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng = {
    /** [0,1) */
    next,
    /** [min,max] 整数 */
    int(min, max) {
      return Math.floor(next() * (max - min + 1)) + min;
    },
    /** [min,max) 浮点 */
    float(min, max) {
      return next() * (max - min) + min;
    },
    /** 概率命中 */
    chance(p) {
      return next() < p;
    },
    /** 随机取一个元素 */
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    /** 按权重取元素：items = [{w, ...}] */
    weighted(items) {
      let total = 0;
      for (const it of items) total += it.w;
      let r = next() * total;
      for (const it of items) {
        r -= it.w;
        if (r <= 0) return it;
      }
      return items[items.length - 1];
    },
    /** 原地洗牌 */
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    /** 派生子随机源 */
    fork(tag) {
      return makeRng(hashSeed(tag + ':' + a));
    },
  };
  return rng;
}

/** 生成一个短 seed（用于深链接） */
export function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff).toString(36);
}
