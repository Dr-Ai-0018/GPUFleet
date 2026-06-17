import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../api";
import { navigate } from "../../lib/routing";
import { useConsoleStore } from "../../state/ConsoleStore";
import { taskStatusLabel } from "../../lib/labels";
import { formatRelative, formatTime } from "../../lib/format";
import { MiniSparkline } from "../../ui/MiniSparkline";
import type { AdminTaskListItem } from "../../types";

// ─── 单状态查询(后端 status 是单值字符串) ───
type StatusFilter = "" | "pending" | "claimed" | "running" | "succeeded" | "failed" | "timeout" | "cancelled" | "lost";

const STATUS_TONE: Record<string, { dot: string; text: string }> = {
  pending: { dot: "bg-gray-500", text: "text-gray-300" },
  claimed: { dot: "bg-cyan-400", text: "text-cyan-300" },
  running: { dot: "bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.55)]", text: "text-cyan-300" },
  succeeded: { dot: "bg-emerald-400", text: "text-emerald-300" },
  failed: { dot: "bg-red-400", text: "text-red-300" },
  timeout: { dot: "bg-red-400", text: "text-red-300" },
  cancel_requested: { dot: "bg-amber-400", text: "text-amber-300" },
  cancelled: { dot: "bg-gray-500", text: "text-gray-400" },
  lost: { dot: "bg-red-400", text: "text-red-300" },
};

// ─── 时间窗(任务过滤用,比时序图粗一些) ───
type TimeWindow = "" | "1h" | "24h" | "7d" | "30d";
const TIME_WINDOWS: Array<{ value: TimeWindow; label: string }> = [
  { value: "", label: "全部时间" },
  { value: "1h", label: "最近 1 小时" },
  { value: "24h", label: "最近 24 小时" },
  { value: "7d", label: "最近 7 天" },
  { value: "30d", label: "最近 30 天" },
];

function windowSince(w: TimeWindow): string | undefined {
  if (!w) return undefined;
  const ms = w === "1h" ? 3600000 : w === "24h" ? 86400000 : w === "7d" ? 7 * 86400000 : 30 * 86400000;
  return new Date(Date.now() - ms).toISOString();
}

const PAGE_SIZE = 50;

/** 把后台轮询拉到的"最新首页"按 task_id 合并进现有列表:
 *  - 已存在的任务: 用新版本替换 (反映 status 变化, e.g. running → succeeded)
 *  - 不存在的任务: 是新冒出来的, 插到列表最前面
 *  - 用户已经翻到的后续页保留原位置 (除非在新首页里就用新版本覆盖)
 */
function mergeFirstPage<T extends { task_id: string }>(prev: T[], fresh: T[]): T[] {
  const freshById = new Map(fresh.map((t) => [t.task_id, t]));
  const prevIds = new Set(prev.map((t) => t.task_id));
  const newcomers = fresh.filter((t) => !prevIds.has(t.task_id));
  const refreshed = prev.map((t) => freshById.get(t.task_id) ?? t);
  return [...newcomers, ...refreshed];
}

export function TasksView(): JSX.Element {
  const store = useConsoleStore();
  const taskCounts = (store.overview?.task_counts ?? {}) as Record<string, number>;
  const throughput = store.overview?.task_throughput_24h ?? Array(24).fill(0);

  // ─── 全局聚合数字(来自 overview) ───
  const totalTasks = Object.values(taskCounts).reduce((a, b) => a + b, 0);
  const runningCount = (taskCounts.running ?? 0) + (taskCounts.claimed ?? 0);
  const succeededCount = taskCounts.succeeded ?? 0;
  const failedCount = (taskCounts.failed ?? 0) + (taskCounts.timeout ?? 0);

  // ─── 筛选状态 ───
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [nodeFilter, setNodeFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("");
  const [query, setQuery] = useState<string>("");

  // ─── 服务端分页状态 ───
  const [items, setItems] = useState<AdminTaskListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [totalEstimate, setTotalEstimate] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // 用于 race-condition 防护(快速切筛选条件时丢弃过期响应)
  const requestSeqRef = useRef(0);
  // 跟 loading 镜像的 ref, 给后台轮询用 (避免 polling effect deps 里塞 loading 造成 interval 重建)
  const loadingRef = useRef(false);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  type FetchMode = "reset" | "append" | "refresh";

  const fetchPage = useCallback(
    async (cursorArg: string | null, mode: FetchMode) => {
      if (!store.token) return;
      const seq = ++requestSeqRef.current;
      // refresh 是后台静默, 不显示加载态; reset/append 是用户交互, 显示
      if (mode !== "refresh") setLoading(true);
      setError(null);
      try {
        const page = await api.listTasks(store.token, {
          limit: PAGE_SIZE,
          cursor: cursorArg ?? undefined,
          node_id: nodeFilter || undefined,
          status: statusFilter || undefined,
          type: typeFilter || undefined,
          since: windowSince(timeWindow),
        });
        if (seq !== requestSeqRef.current) return; // 过期响应,丢弃
        setItems((prev) => {
          if (mode === "reset") return page.items;
          if (mode === "append") return [...prev, ...page.items];
          // refresh: 把首页"最新"按 task_id 合并进现有列表, 新出现的插到最前, 已存在的就地更新状态
          return mergeFirstPage(prev, page.items);
        });
        // refresh 不动 cursor (用户已经翻到的页面要保留), 只 reset/append 才更新
        if (mode !== "refresh") setCursor(page.next_cursor ?? null);
        setTotalEstimate(page.total_estimate ?? null);
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        // 后台轮询失败静默处理, 别打扰用户; 用户交互失败才显示
        if (mode !== "refresh") {
          setError(err instanceof ApiError ? err.message : "加载失败");
        }
      } finally {
        if (seq === requestSeqRef.current && mode !== "refresh") setLoading(false);
      }
    },
    [store.token, nodeFilter, statusFilter, typeFilter, timeWindow],
  );

  // 筛选条件变化 → 重置
  useEffect(() => {
    setItems([]);
    setCursor(null);
    setTotalEstimate(null);
    void fetchPage(null, "reset");
  }, [fetchPage]);

  // 5s 后台轮询: 拉首页 merge 进现有列表, 让新任务自动冒上来 + 已有任务状态原地更新
  // visibility-aware: tab 隐藏时暂停, 切回前台立刻拉一次
  useEffect(() => {
    if (!store.token) return;

    const tick = () => {
      if (document.hidden) return;
      if (loadingRef.current) return; // 用户交互 fetch 在飞, 让一让
      void fetchPage(null, "refresh");
    };

    const timer = window.setInterval(tick, 5000);

    function onVisibilityChange() {
      if (!document.hidden) tick();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [store.token, fetchPage]);

  // ─── 客户端二次过滤(只对 query 串做本地包含匹配,不发请求) ───
  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((t) =>
      [t.task_id, t.node_id, t.type].join(" ").toLowerCase().includes(q),
    );
  }, [items, query]);

  // ─── IntersectionObserver: 滚到底自动加载下一页 ───
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!cursor || loading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void fetchPage(cursor, "append");
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loading, fetchPage]);

  // ─── 可下发节点(右栏用) ───
  const connectedNodes = useMemo(
    () => store.nodes.filter(
      (n) => n.is_enabled && n.connection_status === "online" && n.onboarding_status === "connected",
    ),
    [store.nodes],
  );

  const hasAnyFilter =
    !!statusFilter || !!nodeFilter || !!typeFilter || !!timeWindow || !!query.trim();

  return (
    <div className="py-2">
      {/* ───── Page header ───── */}
      <header className="mb-8 flex items-baseline justify-between gap-6 border-b border-white/[0.045] pb-6">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-white">任务管理</h2>
          <p className="mt-1.5 text-[13px] leading-6 text-gray-500">
            Fleet 全局任务流 — 服务端游标分页 + 实时筛选,支持节点 / 状态 / 类型 / 时间窗组合查询。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="flex items-center gap-1.5 rounded-md border border-emerald-400/20 bg-emerald-400/[0.06] px-2.5 py-1 text-[11.5px] text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.55)]" />
            {connectedNodes.length} 可下发
          </span>
        </div>
      </header>

      {/* ───── KPI strip = 状态筛选器 ───── */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiFilterTile
          label="全部"
          count={totalTasks}
          active={statusFilter === ""}
          dotCls="bg-gray-500"
          textCls="text-white"
          onClick={() => setStatusFilter("")}
        />
        <KpiFilterTile
          label="进行中"
          count={runningCount}
          active={statusFilter === "running"}
          dotCls="bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.55)]"
          textCls="text-cyan-300"
          onClick={() => setStatusFilter(statusFilter === "running" ? "" : "running")}
        />
        <KpiFilterTile
          label="成功"
          count={succeededCount}
          active={statusFilter === "succeeded"}
          dotCls="bg-emerald-400"
          textCls="text-emerald-300"
          onClick={() => setStatusFilter(statusFilter === "succeeded" ? "" : "succeeded")}
        />
        <KpiFilterTile
          label="失败"
          count={failedCount}
          active={statusFilter === "failed"}
          dotCls="bg-red-400"
          textCls="text-red-300"
          onClick={() => setStatusFilter(statusFilter === "failed" ? "" : "failed")}
        />
      </div>

      {/* ───── Filter bar ───── */}
      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-white/[0.045] pb-3">
        <FilterSelect
          value={nodeFilter}
          onChange={setNodeFilter}
          placeholder="全部节点"
          options={store.nodes.map((n) => ({ value: n.node_id, label: n.display_name }))}
        />
        <FilterSelect
          value={typeFilter}
          onChange={setTypeFilter}
          placeholder="全部类型"
          options={[
            { value: "shell", label: "shell" },
            { value: "python_script", label: "python_script" },
            { value: "pip_install", label: "pip_install" },
            { value: "uv_install", label: "uv_install" },
            { value: "noop", label: "noop" },
          ]}
        />
        <FilterSelect
          value={timeWindow}
          onChange={(v) => setTimeWindow(v as TimeWindow)}
          placeholder=""
          options={TIME_WINDOWS.map((w) => ({ value: w.value, label: w.label }))}
        />
        <div className="relative ml-2 flex-1 max-w-md">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-600"
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="本页内搜索 task_id / type / node…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-white/[0.07] bg-[#0a0d12] py-1.5 pl-9 pr-3 text-[12.5px] text-white outline-none transition-colors placeholder:text-gray-600 focus:border-cyan-400/40 focus:bg-[#0c1017]"
          />
        </div>
        {hasAnyFilter ? (
          <button
            type="button"
            onClick={() => {
              setStatusFilter("");
              setNodeFilter("");
              setTypeFilter("");
              setTimeWindow("");
              setQuery("");
            }}
            className="rounded-md border border-white/[0.07] bg-white/[0.02] px-2.5 py-1.5 text-[11.5px] text-gray-400 transition-colors hover:border-white/[0.12] hover:text-white"
          >
            清空筛选
          </button>
        ) : null}
      </div>

      {/* ───── Main + Sidebar ───── */}
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* ===== Main: task list ===== */}
        <div className="min-w-0">
          {/* 结果计数 / 错误条 */}
          <div className="mb-2 flex items-baseline justify-between gap-3 text-[11.5px]">
            <span className="text-gray-500">
              {error ? (
                <span className="text-red-300">{error}</span>
              ) : items.length === 0 && loading ? (
                "加载中…"
              ) : (
                <>
                  已加载 <span className="font-mono text-gray-300">{items.length}</span>
                  {totalEstimate != null && totalEstimate > items.length ? (
                    <> / 共约 <span className="font-mono text-gray-300">{totalEstimate}</span></>
                  ) : null}
                  {query.trim() ? (
                    <> · 本页过滤 <span className="font-mono text-cyan-300">{visibleItems.length}</span></>
                  ) : null}
                </>
              )}
            </span>
            {cursor && !loading ? (
              <button
                type="button"
                onClick={() => void fetchPage(cursor, "append")}
                className="text-[11.5px] text-cyan-300 transition-colors hover:text-cyan-200"
              >
                加载下一页 →
              </button>
            ) : null}
          </div>

          {/* 列表 */}
          {items.length === 0 && !loading ? (
            <div className="rounded-md border border-dashed border-white/[0.06] bg-[#0a0d12] px-6 py-16 text-center">
              <div className="text-[13px] font-medium text-gray-300">
                {hasAnyFilter ? "无匹配任务" : "暂无任务记录"}
              </div>
              <div className="mt-1.5 text-[12px] text-gray-500">
                {hasAnyFilter ? "尝试清空筛选或切换条件" : "下发第一个任务后这里会出现记录"}
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-white/[0.05]">
              <table className="w-full text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-white/[0.05] bg-white/[0.015] text-[11px] text-gray-500">
                    <th className="px-4 py-2.5 font-normal">任务</th>
                    <th className="px-4 py-2.5 font-normal">节点</th>
                    <th className="px-4 py-2.5 font-normal">类型</th>
                    <th className="px-4 py-2.5 font-normal">状态</th>
                    <th className="px-4 py-2.5 font-normal">创建</th>
                    <th className="px-4 py-2.5 text-right font-normal">完成</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((task) => {
                    const tone = STATUS_TONE[task.status] ?? { dot: "bg-gray-500", text: "text-gray-400" };
                    return (
                      <tr
                        key={task.task_id}
                        onClick={() => navigate({ name: "task-detail", taskId: task.task_id })}
                        className="group cursor-pointer border-b border-white/[0.03] transition-colors last:border-0 hover:bg-white/[0.02]"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
                            <span className="truncate font-mono text-[12px] text-cyan-300 transition-colors group-hover:text-cyan-200">
                              {task.task_id}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11.5px] text-gray-400">
                          {task.node_id}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-gray-300">
                          {task.type}
                        </td>
                        <td className={`px-4 py-3 text-[12px] ${tone.text}`}>
                          {taskStatusLabel[task.status] ?? task.status}
                        </td>
                        <td
                          className="px-4 py-3 text-[11.5px] text-gray-500"
                          title={formatTime(task.created_at)}
                        >
                          {formatRelative(task.created_at)}
                        </td>
                        <td className="px-4 py-3 text-right text-[11.5px] text-gray-500">
                          {task.finished_at ? formatRelative(task.finished_at) : (
                            <span className="text-gray-700">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {/* 滚到底自动加载哨兵 */}
              <div ref={sentinelRef} />
              {cursor && loading ? (
                <div className="px-4 py-3 text-center text-[11.5px] text-gray-500">加载下一页…</div>
              ) : null}
              {!cursor && items.length > 0 && !loading ? (
                <div className="border-t border-white/[0.04] px-4 py-3 text-center text-[11px] text-gray-600">
                  已到底部 · 共 {items.length} 条
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* ===== Right sidebar ===== */}
        <aside className="space-y-5 xl:sticky xl:top-2 xl:self-start">
          {/* 吞吐节拍 */}
          <div className="rounded-md border border-white/[0.05] bg-[#0b0e13] px-4 py-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11.5px] text-gray-500">吞吐节拍</span>
              <span className="text-[10.5px] text-gray-600">past 24h</span>
            </div>
            <div className="mt-1.5 text-[26px] font-semibold tracking-tight text-cyan-300">
              {throughput.reduce((a: number, b: number) => a + b, 0)}
            </div>
            <div className="mt-1 text-[11px] text-gray-500">24h 完成总数</div>
            <div className="mt-3">
              <MiniSparkline
                data={throughput}
                width={280}
                height={42}
                color="#06b6d4"
                fillOpacity={0.12}
                className="w-full"
              />
            </div>
          </div>

          {/* 可下发节点 */}
          <div>
            <div className="mb-2.5 flex items-baseline justify-between border-b border-white/[0.045] pb-2">
              <h3 className="text-[12.5px] font-semibold text-white">可下发节点</h3>
              <span className="text-[10.5px] text-gray-600">{connectedNodes.length} 在线</span>
            </div>
            {connectedNodes.length === 0 ? (
              <div className="rounded-md border border-dashed border-white/[0.06] bg-[#0a0d12] px-3 py-6 text-center text-[12px] text-gray-600">
                暂无在线节点
              </div>
            ) : (
              <ul className="space-y-1">
                {connectedNodes.map((node) => {
                  const isFiltered = nodeFilter === node.node_id;
                  return (
                    <li key={node.node_id}>
                      <button
                        type="button"
                        onClick={() => setNodeFilter(isFiltered ? "" : node.node_id)}
                        onDoubleClick={() => navigate({ name: "node-detail", nodeId: node.node_id })}
                        className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
                          isFiltered
                            ? "border-cyan-400/40 bg-cyan-500/[0.08]"
                            : "border-white/[0.05] bg-[#0b0e13] hover:border-white/[0.1] hover:bg-[#0d1119]"
                        }`}
                        title="单击筛选 / 双击进入节点详情"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
                        <div className="min-w-0 flex-1">
                          <div className={`truncate text-[12px] ${isFiltered ? "text-white" : "text-gray-300"}`}>
                            {node.display_name}
                          </div>
                          <div className="truncate font-mono text-[10px] text-gray-600">{node.node_type}</div>
                        </div>
                        {isFiltered ? (
                          <span className="font-mono text-[9.5px] uppercase tracking-wider text-cyan-300">on</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* 任务状态分布(简化) */}
          <div>
            <div className="mb-2.5 flex items-baseline justify-between border-b border-white/[0.045] pb-2">
              <h3 className="text-[12.5px] font-semibold text-white">状态分布</h3>
              <span className="text-[10.5px] text-gray-600">total {totalTasks}</span>
            </div>
            {Object.keys(taskCounts).length === 0 ? (
              <div className="py-6 text-center text-[12px] text-gray-600">暂无数据</div>
            ) : (
              <ul className="space-y-1.5">
                {Object.entries(taskCounts)
                  .filter(([, v]) => v > 0)
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, count]) => {
                    const tone = STATUS_TONE[key] ?? { dot: "bg-gray-500", text: "text-gray-400" };
                    const pct = totalTasks > 0 ? (count / totalTasks) * 100 : 0;
                    const isFiltered = statusFilter === key;
                    return (
                      <li key={key} className="px-1 py-1">
                        <button
                          type="button"
                          onClick={() => setStatusFilter(isFiltered ? "" : (key as StatusFilter))}
                          className="block w-full text-left"
                        >
                          <div className="flex items-center justify-between gap-3 text-[12px]">
                            <span className="flex items-center gap-2">
                              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                              <span className={isFiltered ? "text-white" : "text-gray-300"}>
                                {taskStatusLabel[key] ?? key}
                              </span>
                            </span>
                            <span className="font-mono text-gray-200">{count}</span>
                          </div>
                          <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/[0.04]">
                            <div
                              className={`h-full rounded-full ${tone.dot}`}
                              style={{ width: `${pct}%`, opacity: isFiltered ? 0.9 : 0.6 }}
                            />
                          </div>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─────────────────────── 内部子组件 ───────────────────────

function KpiFilterTile({
  label,
  count,
  active,
  dotCls,
  textCls,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  dotCls: string;
  textCls: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden rounded-md border px-3.5 py-3 text-left transition-all ${
        active
          ? "border-cyan-400/40 bg-white/[0.04]"
          : "border-white/[0.05] bg-[#0b0e13] hover:border-white/[0.12] hover:bg-[#0d1119]"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />
          <span className={`text-[11.5px] font-medium ${active ? "text-white" : "text-gray-400"}`}>
            {label}
          </span>
        </div>
        {active ? (
          <span className="font-mono text-[9.5px] uppercase tracking-wider text-gray-600">active</span>
        ) : null}
      </div>
      <div className={`mt-2 text-[24px] font-semibold tracking-tight tabular-nums ${active ? textCls : "text-gray-200"}`}>
        {count}
      </div>
    </button>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
}): JSX.Element {
  const hasValue = !!value;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-md border bg-[#0a0d12] py-1.5 pl-2.5 pr-7 text-[12px] outline-none transition-colors appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236b7280%22 stroke-width=%222%22><polyline points=%226 9 12 15 18 9%22/></svg>')] bg-[length:12px] bg-[right_8px_center] bg-no-repeat ${
        hasValue
          ? "border-cyan-400/40 text-cyan-200"
          : "border-white/[0.07] text-gray-300 hover:border-white/[0.12]"
      }`}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
