import { describe, expect, it } from "vitest";
import { lttb, type DataPoint } from "./lttb";

function linearSeries(n: number): DataPoint[] {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: i * 2 }));
}

describe("lttb", () => {
  it("returns input unchanged when threshold >= length", () => {
    const data = linearSeries(10);
    expect(lttb(data, 10)).toEqual(data);
    expect(lttb(data, 20)).toEqual(data);
  });

  it("returns input unchanged when threshold <= 2", () => {
    const data = linearSeries(10);
    expect(lttb(data, 2)).toEqual(data);
    expect(lttb(data, 0)).toEqual(data);
  });

  it("always keeps first and last points", () => {
    const data = linearSeries(100);
    const out = lttb(data, 10);
    expect(out[0]).toEqual(data[0]);
    expect(out[out.length - 1]).toEqual(data[data.length - 1]);
  });

  it("outputs exactly threshold points (or near it) for dense data", () => {
    const data = linearSeries(1000);
    const out = lttb(data, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.length).toBeGreaterThanOrEqual(48);
  });

  it("preserves outlier peaks even when downsampling aggressively", () => {
    // 100 个 y=10 的常数点, 中间 1 个 y=999 离群高峰
    const data: DataPoint[] = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 10 }));
    data[50] = { x: 50, y: 999 };
    const out = lttb(data, 10);
    // 离群点应被保留
    const hasOutlier = out.some((p) => p.y === 999);
    expect(hasOutlier).toBe(true);
  });

  it("preserves trough (low outlier) too", () => {
    const data: DataPoint[] = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 50 }));
    data[30] = { x: 30, y: -999 };
    const out = lttb(data, 10);
    expect(out.some((p) => p.y === -999)).toBe(true);
  });

  it("handles null y values without crashing", () => {
    const data: DataPoint[] = Array.from({ length: 100 }, (_, i) => ({
      x: i,
      y: i % 5 === 0 ? null : i,
    }));
    const out = lttb(data, 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out[0]).toEqual(data[0]);
    expect(out[out.length - 1]).toEqual(data[data.length - 1]);
  });

  it("output preserves x order (monotonic)", () => {
    const data = linearSeries(500);
    const out = lttb(data, 30);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].x).toBeGreaterThan(out[i - 1].x);
    }
  });
});
