/**
 * 把"后台轮询拉到的最新首页"按 key 合并进现有分页列表:
 *  - 已存在的 item: 用新版本替换 (反映状态变化, e.g. running → succeeded)
 *  - 不存在的 item: 是新冒出来的, 插到列表最前面
 *  - 用户已经翻到的后续页保留原位置 (除非在新首页里就用新版本覆盖)
 *
 * 用于 TasksView / SecurityView / 其它"无限滚动 + 后台轮询合并"的场景.
 */
export function mergeFirstPage<T, K extends string | number>(
  prev: T[],
  fresh: T[],
  keyOf: (item: T) => K,
): T[] {
  const freshByKey = new Map<K, T>(fresh.map((x) => [keyOf(x), x]));
  const prevKeys = new Set<K>(prev.map(keyOf));
  const newcomers = fresh.filter((x) => !prevKeys.has(keyOf(x)));
  const refreshed = prev.map((x) => freshByKey.get(keyOf(x)) ?? x);
  return [...newcomers, ...refreshed];
}
