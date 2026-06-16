/**
 * useSmoothFeeder — 时序图表的"分桶/buffer + 自适应 tick"前端 hook.
 *
 * 解决"5s 拉一次, 视觉上 5 个点同时出现, 撕裂感强"的体验问题:
 * - 后端按 fetchIntervalMs 周期拉数据, 全部填入内部 buffer
 * - 前端按 tickMs 周期推进"已显示窗口", 每 tick 把缓存内最新一个点显露出来
 * - buffer 接近空 → 自动放慢 tick 等服务端补
 * - buffer 堆积 → 自动加快 tick 追赶
 * 视觉效果: 数据点平滑滚动, 网络抖动被吸收
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { DataPoint } from "./lttb";
import { lttb } from "./lttb";

export interface SmoothFeederOptions<T> {
  /** 拉一批原始数据 (按时间升序) 的函数. */
  fetcher: () => Promise<T[]>;
  /** 从原始记录抽 DataPoint (x ms, y number|null). */
  selector: (record: T) => DataPoint;
  /** 后端拉取间隔. */
  fetchIntervalMs: number;
  /** 期望 tick 间隔. 动态调速以这个为中心点. */
  tickMs: number;
  /** 渲染上限点数. 超出走 LTTB 降密. */
  maxPoints: number;
  /** 是否启用 (false 时停止 fetch/tick, 保留当前数据). */
  enabled?: boolean;
}

export interface SmoothFeederState {
  /** 当前已显示数据点 (LTTB 降密后, 直接给图表). */
  points: DataPoint[];
  /** buffer 里还没显示的点数 (诊断用). */
  bufferPending: number;
  /** 当前实际 tick 间隔 (诊断用). */
  currentTickMs: number;
  /** fetch 报错时的最后一次错误. */
  lastError: Error | null;
}

const TICK_SPEED_MIN = 0.5; // 最快为 0.5×
const TICK_SPEED_MAX = 1.5; // 最慢为 1.5×
const BUFFER_LOW_THRESHOLD = 2; // 低于这个 → 减速
const BUFFER_HIGH_THRESHOLD = 10; // 高于这个 → 加速

export function useSmoothFeeder<T>({
  fetcher,
  selector,
  fetchIntervalMs,
  tickMs,
  maxPoints,
  enabled = true,
}: SmoothFeederOptions<T>): SmoothFeederState {
  // 已显示队列 — 这个是 React 状态, 触发图表 rerender
  const [visiblePoints, setVisiblePoints] = useState<DataPoint[]>([]);
  // buffer (待显示的点) — 在 ref 里, 不触发 rerender
  const bufferRef = useRef<DataPoint[]>([]);
  // 调度状态
  const tickTimerRef = useRef<number | null>(null);
  const fetchTimerRef = useRef<number | null>(null);
  const currentTickRef = useRef(tickMs);
  // 上次见过的最新点 x, 用来去重 (避免重复 fetch 加同样的点)
  const lastSeenXRef = useRef<number>(-Infinity);
  const [lastError, setLastError] = useState<Error | null>(null);
  // 把 props 装 ref 避免 effect 重启 (减速逻辑要随时读最新值)
  const fetcherRef = useRef(fetcher);
  const selectorRef = useRef(selector);
  fetcherRef.current = fetcher;
  selectorRef.current = selector;

  // --- fetch loop ---
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function runFetch() {
      try {
        const records = await fetcherRef.current();
        if (cancelled) return;
        const points = records.map((r) => selectorRef.current(r));
        // 只追加新点 (x 严格大于上次见过的最大 x)
        const fresh = points.filter((p) => p.x > lastSeenXRef.current);
        if (fresh.length > 0) {
          bufferRef.current.push(...fresh);
          lastSeenXRef.current = fresh[fresh.length - 1].x;
        }
        setLastError(null);
      } catch (e) {
        setLastError(e instanceof Error ? e : new Error(String(e)));
      }
    }
    runFetch();
    fetchTimerRef.current = window.setInterval(runFetch, fetchIntervalMs);
    return () => {
      cancelled = true;
      if (fetchTimerRef.current !== null) {
        window.clearInterval(fetchTimerRef.current);
        fetchTimerRef.current = null;
      }
    };
  }, [enabled, fetchIntervalMs]);

  // --- tick loop ---
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;

    function scheduleNext(delayMs: number) {
      if (stopped) return;
      tickTimerRef.current = window.setTimeout(() => {
        if (stopped) return;
        // 推进一个点 (如果 buffer 非空)
        const buf = bufferRef.current;
        if (buf.length > 0) {
          const next = buf.shift()!;
          setVisiblePoints((prev) => {
            const appended = [...prev, next];
            // 如果超过 maxPoints * 2, 先粗砍前面, 再 LTTB 降密
            const cap = maxPoints * 2;
            const trimmed = appended.length > cap ? appended.slice(-cap) : appended;
            return trimmed.length > maxPoints ? lttb(trimmed, maxPoints) : trimmed;
          });
        }
        // 根据 buffer 状态调速度
        const pending = bufferRef.current.length;
        let speed = 1.0;
        if (pending < BUFFER_LOW_THRESHOLD) speed = TICK_SPEED_MAX; // 慢
        else if (pending > BUFFER_HIGH_THRESHOLD) speed = TICK_SPEED_MIN; // 快
        else {
          // 线性插值
          const t = (pending - BUFFER_LOW_THRESHOLD) / (BUFFER_HIGH_THRESHOLD - BUFFER_LOW_THRESHOLD);
          speed = TICK_SPEED_MAX - (TICK_SPEED_MAX - TICK_SPEED_MIN) * t;
        }
        const nextDelay = Math.round(tickMs * speed);
        currentTickRef.current = nextDelay;
        scheduleNext(nextDelay);
      }, delayMs);
    }
    scheduleNext(tickMs);
    return () => {
      stopped = true;
      if (tickTimerRef.current !== null) {
        window.clearTimeout(tickTimerRef.current);
        tickTimerRef.current = null;
      }
    };
  }, [enabled, tickMs, maxPoints]);

  // --- 重置: 当 selector / fetcher 变化或 enabled 关掉时, 清状态 ---
  useEffect(() => {
    if (!enabled) {
      bufferRef.current = [];
      lastSeenXRef.current = -Infinity;
      setVisiblePoints([]);
    }
  }, [enabled]);

  return useMemo(
    () => ({
      points: visiblePoints,
      bufferPending: bufferRef.current.length,
      currentTickMs: currentTickRef.current,
      lastError,
    }),
    [visiblePoints, lastError],
  );
}
