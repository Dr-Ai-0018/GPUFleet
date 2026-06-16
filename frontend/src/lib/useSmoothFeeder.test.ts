import { renderHook, waitFor } from "@testing-library/react";
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

  it("after fetch + tick, records start filling", async () => {
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
        expect(result.current.records.length).toBeGreaterThanOrEqual(3);
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
});
