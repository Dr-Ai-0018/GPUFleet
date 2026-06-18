import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSmoothFeeder } from "./useSmoothFeeder";

interface Record {
  ts: number;
  value: number;
}
const getX = (r: Record) => r.ts;
const getY = (r: Record) => r.value;

describe("useSmoothFeeder", () => {
  it("returns empty records initially", () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() =>
      useSmoothFeeder<Record>({
        fetcher,
        getX,
        getY,
        fetchIntervalMs: 5000,
        tickMs: 1000,
        maxPoints: 100,
      }),
    );
    expect(result.current.records).toEqual([]);
  });

  it("first fetch整批 flush 上屏 (跳过 tick 节流, 切窗口立刻看到完整数据)", async () => {
    const records: Record[] = Array.from({ length: 5 }, (_, i) => ({ ts: i * 1000, value: i }));
    const fetcher = vi.fn().mockResolvedValue(records);
    const { result } = renderHook(() =>
      useSmoothFeeder<Record>({
        fetcher,
        getX,
        getY,
        fetchIntervalMs: 5000,
        tickMs: 30,
        maxPoints: 100,
      }),
    );

    await waitFor(
      () => {
        expect(fetcher).toHaveBeenCalled();
        expect(result.current.records.length).toBe(5);
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
        getX,
        getY,
        fetchIntervalMs: 100,
        tickMs: 30,
        maxPoints: 100,
      }),
    );

    await waitFor(
      () => {
        expect(result.current.records.length).toBeGreaterThanOrEqual(5);
        const xs = result.current.records.map((r) => r.ts);
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
        getX,
        getY,
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
        getX,
        getY,
        fetchIntervalMs: 100,
        tickMs: 30,
        maxPoints: 100,
        enabled: false,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.records).toEqual([]);
  });

  it("resetKey change clears visibleRecords + lastSeenX + 整批 flush 新窗口", async () => {
    // 模拟切窗口: 老窗口 ts 在 10_000+, 新窗口 ts 在 1000+ (远小于老的, 验证 lastSeenX 被重置)
    const oldRecords: Record[] = Array.from({ length: 4 }, (_, i) => ({ ts: 10_000 + i * 1000, value: 10 + i }));
    const newRecords: Record[] = Array.from({ length: 3 }, (_, i) => ({ ts: 1000 + i * 1000, value: i + 1 }));
    let phase: "old" | "new" = "old";
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(phase === "old" ? oldRecords : newRecords));

    const { result, rerender } = renderHook(
      ({ resetKey }: { resetKey: string }) =>
        useSmoothFeeder<Record>({
          fetcher,
          getX,
          getY,
          fetchIntervalMs: 5000,
          tickMs: 30,
          maxPoints: 100,
          resetKey,
        }),
      { initialProps: { resetKey: "old-window" } },
    );

    await waitFor(
      () => {
        expect(result.current.records.length).toBe(4);
        expect(result.current.records[0].ts).toBeGreaterThanOrEqual(10_000);
      },
      { timeout: 2000 },
    );

    phase = "new";
    rerender({ resetKey: "new-window" });

    await waitFor(
      () => {
        const tss = result.current.records.map((r) => r.ts);
        expect(tss.every((t) => t < 10_000)).toBe(true);
        expect(result.current.records.length).toBe(3);
      },
      { timeout: 3000 },
    );
  });

  it("windowMs trims visible records older than now - windowMs (slide-window 语义)", async () => {
    const now = Date.now();
    const recs: Record[] = [
      { ts: now - 100_000, value: 1 }, // 远早于窗口, 必被 trim
      { ts: now - 60_000, value: 2 }, // 仍早于 5s 窗口
      { ts: now - 1000, value: 3 }, // 窗口内
      { ts: now - 500, value: 4 }, // 窗口内
    ];
    const fetcher = vi.fn().mockResolvedValue(recs);
    const { result } = renderHook(() =>
      useSmoothFeeder<Record>({
        fetcher,
        getX,
        getY,
        fetchIntervalMs: 5000,
        tickMs: 30,
        maxPoints: 100,
        windowMs: 5_000,
      }),
    );

    await waitFor(
      () => {
        expect(result.current.records.length).toBe(2);
        expect(result.current.records.every((r) => r.ts > now - 5_000)).toBe(true);
      },
      { timeout: 2000 },
    );
  });

  it("visibilitychange to visible 触发 reset + refetch (后台 tab 回前台对齐 wall-clock)", async () => {
    let fetchCount = 0;
    const fetcher = vi.fn().mockImplementation(() => {
      fetchCount += 1;
      return Promise.resolve([{ ts: fetchCount * 1000, value: fetchCount }]);
    });
    renderHook(() =>
      useSmoothFeeder<Record>({
        fetcher,
        getX,
        getY,
        fetchIntervalMs: 60_000, // 故意大间隔, 确保 setInterval 不会自然触发
        tickMs: 30,
        maxPoints: 100,
      }),
    );

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });
});
