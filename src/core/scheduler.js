/**
 * 非节流调度器 —— 用于游戏内的时间控制。
 *
 * 背景：浏览器在标签页切到后台时，会把 setTimeout / setInterval 节流到
 *       最低 1 次/秒（甚至完全暂停 requestAnimationFrame），
 *       导致「掷骰 → 移动 → 结算 → 交棒」的回合流程在后台被卡住。
 *
 * 方案：用 MessageChannel 调度。MessageChannel 的 postMessage 属于
 *       任务队列而非计时器队列，不受后台标签页节流影响，
 *       因此游戏逻辑可以稳定推进（渲染仍然由 RAF 负责，后台时不刷新画面即可）。
 */

function createChannel() {
  if (typeof MessageChannel === 'function') {
    const ch = new MessageChannel();
    const queue = [];
    ch.port1.onmessage = () => {
      const fn = queue.shift();
      if (fn) fn();
    };
    return {
      post(fn) {
        queue.push(fn);
        ch.port2.postMessage(0);
      },
    };
  }
  // 极端降级：回到 setTimeout
  return {
    post(fn) {
      setTimeout(fn, 0);
    },
  };
}

const channel = createChannel();

/**
 * 延时执行（不受后台标签页节流影响）。
 * @param {number} ms 延时毫秒数
 * @param {Function} fn 回调
 * @returns {{cancel: () => void}}
 */
export function delay(ms, fn) {
  let cancelled = false;
  const start = performance.now();
  const step = () => {
    if (cancelled) return;
    const elapsed = performance.now() - start;
    if (elapsed >= ms) {
      fn();
    } else {
      channel.post(step);
    }
  };
  channel.post(step);
  return {
    cancel() { cancelled = true; },
  };
}

/**
 * 周期性执行（不受后台标签页节流影响）。
 * @param {number} ms 周期毫秒数
 * @param {Function} fn 回调
 * @returns {{cancel: () => void}}
 */
export function interval(ms, fn) {
  let cancelled = false;
  const start = performance.now();
  let next = start + ms;
  const step = () => {
    if (cancelled) return;
    const now = performance.now();
    // 一次性补齐所有错过的周期，避免后台回来后瞬间连发
    let missed = 0;
    while (now >= next && missed < 8) {
      next += ms;
      missed++;
      fn();
    }
    channel.post(step);
  };
  channel.post(step);
  return {
    cancel() { cancelled = true; },
  };
}

/** 把 setTimeout 换成非节流版本 */
export function later(ms, fn) {
  return delay(ms, fn);
}
