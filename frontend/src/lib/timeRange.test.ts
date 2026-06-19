import { describe, expect, it } from "vitest";
import {
  RANGE_PRESETS,
  formatTick,
  getRangeSpec,
  maxPointsForWidth,
} from "./timeRange";

describe("RANGE_PRESETS", () => {
  it("contains 30s..30d in order", () => {
    expect(RANGE_PRESETS[0].key).toBe("30s");
    expect(RANGE_PRESETS[RANGE_PRESETS.length - 1].key).toBe("30d");
    // window 严格递增
    for (let i = 1; i < RANGE_PRESETS.length; i++) {
      expect(RANGE_PRESETS[i].windowMs).toBeGreaterThan(RANGE_PRESETS[i - 1].windowMs);
    }
  });

  it("each preset has positive tickMs/fetchIntervalMs/limit", () => {
    for (const r of RANGE_PRESETS) {
      expect(r.tickMs).toBeGreaterThan(0);
      expect(r.fetchIntervalMs).toBeGreaterThan(0);
      expect(r.limit).toBeGreaterThan(0);
      expect(r.limit).toBeLessThanOrEqual(5000); // 后端约束
    }
  });
});

describe("getRangeSpec", () => {
  it("returns spec for known key", () => {
    expect(getRangeSpec("30s").windowMs).toBe(30_000);
    expect(getRangeSpec("1h").windowMs).toBe(3_600_000);
  });
});

describe("maxPointsForWidth", () => {
  it("default 4px per point: 1000px → 250 points", () => {
    expect(maxPointsForWidth(1000)).toBe(250);
  });
  it("respects min 50", () => {
    expect(maxPointsForWidth(100)).toBe(50);
    expect(maxPointsForWidth(10)).toBe(50);
  });
});

describe("formatTick", () => {
  // 2026-06-16 14:30:45 local
  const ts = new Date(2026, 5, 16, 14, 30, 45).getTime();

  it("HH:mm:ss", () => {
    expect(formatTick(ts, "HH:mm:ss")).toBe("14:30:45");
  });
  it("HH:mm", () => {
    expect(formatTick(ts, "HH:mm")).toBe("14:30");
  });
  it("M/D HH:mm", () => {
    expect(formatTick(ts, "M/D HH:mm")).toBe("6/16 14:30");
  });
  it("M/D", () => {
    expect(formatTick(ts, "M/D")).toBe("6/16");
  });
  it("YYYY-M-D", () => {
    expect(formatTick(ts, "YYYY-M-D")).toBe("2026-6-16");
  });
});
