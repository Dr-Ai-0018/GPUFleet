/**
 * useSmoothFeeder — 时序图表的"分桶/buffer + 自适应 tick"前端 hook.
 *
 * 设计来源: fb524f9 原版, 解决"节点 5s/批 心跳上报 → 视觉上 5 点同时跳出, 撕裂感强"的体验问题:
 * - 后端按 fetchIntervalMs 周期拉一批数据 (5 个点), 全部填入内部 buffer
 * - 前端按 tickMs 周期推进 visible (每 tick 把 buffer 队头一个点 shift 出来上屏)
 * - buffer 接近空 → 减速 (1.5×tickMs) 等服务端补; buffer 堆积 → 加速 (0.5×tickMs) 追赶
 * - 视觉效果: 1Hz 平滑滚动, X 轴 (在调用方 type:'time' 自适应) 跟着 visible 末尾走两端零空白
 *
 * 稳态: fetchIntervalMs=5s + tickMs=1s → buffer 平均 ≈ 5, visible 末尾滞后 wall-clock ~5s,
 * 但用户看不到 (X 轴标签相对时间无参考), 只看到流畅滚动. 这就是设计精髓.
 *
 * 修过的 bug:
 * - resetKey: 切窗口 / 重 mount 时清 buffer/lastSeenX/visible, 否则老点会被自适应 X 轴撑出几十分钟跨度
 * - firstFillRef: resetKey 切换后第一次 fetch 整批 flush 上屏 (跳过 tick 节流), 否则切到新窗口要等 N 秒补满
 * - visibilitychange: 后台 tab 浏览器 clamp setInterval/setTimeout, 回前台立即重 fetch + 整批 flush 对齐 wall-clock
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { lttbRecords } from "./lttb";

export interface SmoothFeederOptions<T> {
  /** 拉一批原始数据 (按 x 升序) 的函数. */
  fetcher: () => Promise<T[]>;
  /** 从记录中抽 x 时间戳 (ms). */
  getX: (record: T) => number;
  /** 从记录中抽"代表性 y"字段, 用于 LTTB 降密计算面积 (null 视为缺失). */
  getY: (record: T) => number | null;
  /** 后端拉取间隔. 推荐对齐节点心跳节奏 (默认 5s). */
  fetchIntervalMs: number;
  /** 期望 tick 间隔. 动态调速以这个为中心点. */
  tickMs: number;
  /** 渲染上限点数. 超出走 LTTB 降密. */
  maxPoints: number;
  /**
   * 滑动窗口宽度 (ms). 传了之后, visible 始终被 trim 到 ts >= (now - windowMs);
   * 不传则 visible 一直累积直到 LTTB 兜底 (用户选"30 秒"但看 10 分钟会得到 10 分钟数据).
   */
  windowMs?: number;
  /** 是否启用 (false 时停止 fetch/tick, 保留当前数据). */
  enabled?: boolean;
  /** 数据源切换标识. 变化时同步清空 buffer/visible/lastSeenX 并重 fetch + 整批 flush. */
  resetKey?: string | number;
}

export interface SmoothFeederState<T> {
  records: T[];
  bufferPending: number;
  currentTickMs: number;
  lastError: Error | null;
}

const TICK_SPEED_MIN = 0.5;
const TICK_SPEED_MAX = 1.5;
const BUFFER_LOW_THRESHOLD = 2;
const BUFFER_HIGH_THRESHOLD = 10;

export function useSmoothFeeder<T>({
  fetcher,
  getX,
  getY,
  fetchIntervalMs,
  tickMs,
  maxPoints,
  windowMs,
  enabled = true,
  resetKey,
}: SmoothFeederOptions<T>): SmoothFeederState<T> {
  const [visibleRecords, setVisibleRecords] = useState<T[]>([]);
  const bufferRef = useRef<T[]>([]);
  const tickTimerRef = useRef<number | null>(null);
  const fetchTimerRef = useRef<number | null>(null);
  const currentTickRef = useRef(tickMs);
  const lastSeenXRef = useRef<number>(-Infinity);
  const firstFillRef = useRef(true);
  const [lastError, setLastError] = useState<Error | null>(null);

  const fetcherRef = useRef(fetcher);
  const getXRef = useRef(getX);
  const getYRef = useRef(getY);
  const windowMsRef = useRef(windowMs);
  fetcherRef.current = fetcher;
  getXRef.current = getX;
  getYRef.current = getY;
  windowMsRef.current = windowMs;

  // --- fetch loop ---
  useEffect(() => {
    if (!enabled) return;
    // resetKey 变化或 fetchIntervalMs 变化时同步清状态, 防止老 records 被自适应 X 轴撑大
    bufferRef.current = [];
    lastSeenXRef.current = -Infinity;
    firstFillRef.current = true;
    setVisibleRecords([]);
    let cancelled = false;

    async function runFetch() {
      try {
        const records = await fetcherRef.current();
        if (cancelled) return;
        const fresh = records.filter((r) => getXRef.current(r) > lastSeenXRef.current);
        if (fresh.length > 0) {
          lastSeenXRef.current = getXRef.current(fresh[fresh.length - 1]);
          if (firstFillRef.current) {
            // 切窗口 / 首次填充: 整批直接上屏, 跳过 tick 节流, 用户切完立刻看到完整窗口
            firstFillRef.current = false;
            const flushed = fresh;
            setVisibleRecords((prev) => {
              let all: T[] = [...prev, ...flushed];
              if (windowMsRef.current !== undefined && all.length > 0) {
                // 严格 slide-window: cutoff = lastX - windowMs, 配合 dataItem.id 让 echarts 按 id 匹配做 X 平移.
                const lastX = getXRef.current(all[all.length - 1]);
                const cutoff = lastX - windowMsRef.current;
                all = all.filter((r) => getXRef.current(r) >= cutoff);
              }
              return all.length > maxPoints
                ? lttbRecords(all, getXRef.current, getYRef.current, maxPoints)
                : all;
            });
          } else {
            // 稳态: 新点进 buffer, tick loop 每秒 shift 一个上屏 → 1Hz 平滑滚动
            bufferRef.current.push(...fresh);
          }
        }
        setLastError(null);
      } catch (e) {
        setLastError(e instanceof Error ? e : new Error(String(e)));
      }
    }

    runFetch();
    fetchTimerRef.current = window.setInterval(runFetch, fetchIntervalMs);

    // 后台 tab 浏览器 clamp setInterval (≥1s, 长时间 ≥1min), tick 也不出.
    // 回前台立即 reset + refetch 对齐 wall-clock, firstFillRef=true 让回来的整批 flush.
    function onVisibility() {
      if (document.visibilityState !== "visible") return;
      bufferRef.current = [];
      lastSeenXRef.current = -Infinity;
      firstFillRef.current = true;
      setVisibleRecords([]);
      runFetch();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (fetchTimerRef.current !== null) {
        window.clearInterval(fetchTimerRef.current);
        fetchTimerRef.current = null;
      }
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, fetchIntervalMs, resetKey, maxPoints]);

  // --- tick loop: 每 tickMs 从 buffer 队头 shift 一个点上屏, 动态调速 ---
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;

    function scheduleNext(delayMs: number) {
      if (stopped) return;
      tickTimerRef.current = window.setTimeout(() => {
        if (stopped) return;
        const buf = bufferRef.current;
        if (buf.length > 0) {
          const next = buf.shift()!;
          setVisibleRecords((prev) => {
            let appended: T[] = [...prev, next];
            if (windowMsRef.current !== undefined && appended.length > 0) {
              // trim 保留 2x windowMs 缓冲 (见 firstFill 路径注释): 屏外左侧缓冲让旧索引稳定.
              const lastX = getXRef.current(appended[appended.length - 1]);
              const cutoff = lastX - windowMsRef.current * 2;
              appended = appended.filter((r) => getXRef.current(r) >= cutoff);
            }
            const cap = maxPoints * 2;
            const trimmed = appended.length > cap ? appended.slice(-cap) : appended;
            return trimmed.length > maxPoints
              ? lttbRecords(trimmed, getXRef.current, getYRef.current, maxPoints)
              : trimmed;
          });
        }
        const pending = bufferRef.current.length;
        let speed = 1.0;
        if (pending < BUFFER_LOW_THRESHOLD) speed = TICK_SPEED_MAX;
        else if (pending > BUFFER_HIGH_THRESHOLD) speed = TICK_SPEED_MIN;
        else {
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

  useEffect(() => {
    if (!enabled) {
      bufferRef.current = [];
      lastSeenXRef.current = -Infinity;
      firstFillRef.current = true;
      setVisibleRecords([]);
    }
  }, [enabled]);

  return useMemo(
    () => ({
      records: visibleRecords,
      bufferPending: bufferRef.current.length,
      currentTickMs: currentTickRef.current,
      lastError,
    }),
    [visibleRecords, lastError],
  );
}
