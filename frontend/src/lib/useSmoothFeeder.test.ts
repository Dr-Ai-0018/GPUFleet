/**
 * useSmoothFeeder 测试: 用真实 timer + 超短间隔, 比 fake timer + React state 更稳.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DataPoint } from "./lttb";
import { useSmoothFeeder } from "./useSmoothFeeder";

interface Record {
  ts: number;
  value: number;
}
const selector = (r: Record): DataPoint => ({ x: r.ts, y: r.value });

describe("useSmoothFeeder", () => {
  it("returns empty points initially", () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() =>
      useSmoothFeeder<Record>({
        fetcher,
        selector,
        fetchIntervalMs: 5000,
        tickMs: 1000,
        maxPoints: 100,
      }),
    );
    expect(result.current.points).toEqual([]);
  });

  it("after fetch + tick, points start filling", async () => {
    const records: Record[] = Array.from({ length: 5 }, (_, i) => ({ ts: i * 1000, value: i }));
    const fetcher = vi.fn().mockResolvedValue(records);
    const { result } = renderHook(() =>
      useSmoothFeeder<Record>({
        fetcher,
        selector,
        fetchIntervalMs: 5000,
        tickMs: 30, // 30ms 每 tick, 测试一秒内能跑 30+ tick
        maxPoints: 100,
      }),
    );

    await waitFor(
      () => {
        expect(fetcher).toHaveBeenCalled();
        expect(result.current.points.length).toBeGreaterThanOrEqual(3);
      },
      { timeout: 2000 },
    );
  });

  it("dedupes records across consecutive fetches by x", async () => {
    let callIdx = 0;
    const fetcher = vi.fn().mockImplementation(() => {
      callIdx += 1;
      const start = callIdx === 1 ? 1 : 4;
      const end = callIdx === 1 ? 5 : 7;
      const out: Record[] = [];
      for (let i = start; i <= end; i++) out.push({ ts: i * 1000, value: i });
      return Promise.resolve(out);
    });
    const { result } = renderHook(() =>
      useSmoothFeeder<Record>({
        fetcher,
        selector,
        fetchIntervalMs: 100, // 100ms 拉一次 -> 1s 内拉 ~10 次
        tickMs: 30,
        maxPoints: 100,
      }),
    );

    await waitFor(
      () => {
        // 应该至少有 5 个唯一点 (1..5 + 6,7)
        expect(result.current.points.length).toBeGreaterThanOrEqual(5);
        const xs = result.current.points.map((p) => p.x);
        expect(new Set(xs).size).toBe(xs.length);
      },
      { timeout: 3000 },
    );
  });

  it("captures fetch error in lastError", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() =>
      useSmoothFeeder<Record>({
        fetcher,
        selector,
        fetchIntervalMs: 100,
        tickMs: 30,
        maxPoints: 100,
      }),
    );
    await waitFor(
      () => {
        expect(result.current.lastError?.message).toBe("boom");
      },
      { timeout: 2000 },
    );
  });

  it("respects enabled=false (fetcher not called)", async () => {
    const fetcher = vi.fn().mockResolvedValue([{ ts: 0, value: 1 }]);
    const { result } = renderHook(() =>
      useSmoothFeeder<Record>({
        fetcher,
        selector,
        fetchIntervalMs: 100,
        tickMs: 30,
        maxPoints: 100,
        enabled: false,
      }),
    );
    // 等 300ms 让 fetcher 有机会被 (错误地) 调用
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.points).toEqual([]);
  });
});
