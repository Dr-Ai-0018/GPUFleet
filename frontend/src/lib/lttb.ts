/**
 * LTTB (Largest Triangle Three Buckets) 时序降密算法.
 *
 * 参考: Sveinn Steinarsson, "Downsampling Time Series for Visual Representation" (2013).
 * 业界标准时序降密算法 (Grafana / D3 / Plotly 都用). 保留视觉特征点 (峰谷),
 * 不像简单均匀采样那样把异常离群点抹平.
 *
 * 给定 N 个点和目标点数 threshold (T), 输出 T 个点的子集:
 * - 首尾两点必保留
 * - 中间分 T-2 个桶, 每个桶选一个"对视觉影响最大的"点
 * - "影响最大" = 与上一保留点和下一桶平均点构成的三角形面积最大
 */

export interface DataPoint {
  /** 时间戳 (ms since epoch). LTTB 拿 x 轴算面积. */
  x: number;
  /** 数值. null 视为缺失数据, 在 LTTB 内被跳过但不影响相邻点选择. */
  y: number | null;
}

/**
 * LTTB 降密. 输入 N 个点, 输出 ≤ threshold 个点.
 *
 * @param data  原始数据, 按 x 递增排序
 * @param threshold  目标点数. 若 ≥ data.length 或 ≤ 2, 直接返回 data
 * @returns 降密后的点 (首尾必含)
 */
export function lttb(data: DataPoint[], threshold: number): DataPoint[] {
  const n = data.length;
  if (threshold >= n || threshold <= 2) return data;

  // 内部桶数 = threshold - 2 (首尾点单独保留, 不进桶)
  // 桶大小 = (n - 2) / (threshold - 2) — 留出 data[0] 和 data[n-1] 给首尾
  const bucketSize = (n - 2) / (threshold - 2);
  const sampled: DataPoint[] = [data[0]]; // 首点
  let a = 0; // 上一保留点的索引

  for (let i = 0; i < threshold - 2; i++) {
    // 当前桶范围 [start, end) — 桶 i 从 [i*bucketSize+1, (i+1)*bucketSize+1)
    const start = Math.floor(i * bucketSize) + 1;
    let end = Math.floor((i + 1) * bucketSize) + 1;
    if (end > n - 1) end = n - 1; // 末点留给最外层 push
    if (start >= end) continue;

    // 下一桶范围 [nextStart, nextEnd) 算锚平均点
    const nextStart = end;
    let nextEnd = Math.floor((i + 2) * bucketSize) + 1;
    if (nextEnd > n) nextEnd = n; // 包含末点 (i = threshold-3 时)
    let avgX = 0;
    let avgY = 0;
    let avgCount = 0;
    for (let k = nextStart; k < nextEnd; k++) {
      const yk = data[k].y;
      if (yk === null) continue;
      avgX += data[k].x;
      avgY += yk;
      avgCount++;
    }
    if (avgCount === 0) {
      // 下一桶全空, 退化用末点为锚
      avgX = data[n - 1].x;
      avgY = data[n - 1].y ?? 0;
    } else {
      avgX /= avgCount;
      avgY /= avgCount;
    }

    // 当前桶中找与 (a, avgPoint) 构成最大三角形面积的点
    const ax = data[a].x;
    const ay = data[a].y ?? 0;
    let maxArea = -1;
    let chosen = start;
    for (let j = start; j < end; j++) {
      const yj = data[j].y;
      const xj = data[j].x;
      const yEff = yj ?? ay;
      const area = Math.abs((ax - avgX) * (yEff - ay) - (ax - xj) * (avgY - ay));
      if (area > maxArea) {
        maxArea = area;
        chosen = j;
      }
    }
    sampled.push(data[chosen]);
    a = chosen;
  }

  sampled.push(data[n - 1]); // 末点
  return sampled;
}
