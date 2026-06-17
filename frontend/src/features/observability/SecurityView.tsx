import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../api";
import { useConsoleStore } from "../../state/ConsoleStore";
import { CodeBlock } from "../../ui/CodeBlock";
import { formatRelative, formatTime, prettyJson } from "../../lib/format";
import type { AuditEventView, SecurityWarningView } from "../../types";

type TabKey = "warnings" | "audits";

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
const POLL_INTERVAL_MS = 10_000;

/** 按 id 合并:新出现的插到最前,已存在的替换,后续页保留 */
function mergeFirstPage<T extends { id: number }>(prev: T[], fresh: T[]): T[] {
  const freshById = new Map(fresh.map((x) => [x.id, x]));
  const prevIds = new Set(prev.map((x) => x.id));
  const newcomers = fresh.filter((x) => !prevIds.has(x.id));
  const refreshed = prev.map((x) => freshById.get(x.id) ?? x);
  return [...newcomers, ...refreshed];
}

export function SecurityView(): JSX.Element {
  const store = useConsoleStore();
  // 初始 tab 用 store buffer 当个轻量提示,但实际数据走 cursor API
  const [tab, setTab] = useState<TabKey>(store.warnings.length > 0 ? "warnings" : "audits");
  // 顶部计数:从 buffer 拿一个粗略值,真值由两个 list 内部 totalEstimate 接管
  const warningHint = store.warnings.length;
  const auditHint = store.audits.length;

  return (
    <div className="py-2">
      {/* ───── Page header ───── */}
      <header className="mb-8 flex items-baseline justify-between gap-6 border-b border-white/[0.045] pb-6">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-white">安全审计</h2>
          <p className="mt-1.5 text-[13px] leading-6 text-gray-500">
            全局安全告警与操作流水 — 服务端游标分页 + 时间窗筛选,异常行为可追溯。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {warningHint > 0 ? (
            <span className="rounded-md border border-red-400/30 bg-red-400/[0.08] px-2.5 py-1 text-[11.5px] text-red-300">
              {warningHint}+ 待审告警
            </span>
          ) : (
            <span className="rounded-md border border-emerald-400/20 bg-emerald-400/[0.06] px-2.5 py-1 text-[11.5px] text-emerald-300">
              暂无告警
            </span>
          )}
        </div>
      </header>

      {/* ───── Tabs (underline 风格, 与节点详情 hero tabs 同款) ───── */}
      <div className="mb-6 flex items-center gap-1 border-b border-white/[0.045]">
        <TabButton
          active={tab === "warnings"}
          onClick={() => setTab("warnings")}
          label="安全告警"
          badge={warningHint}
          tone="red"
        />
        <TabButton
          active={tab === "audits"}
          onClick={() => setTab("audits")}
          label="审计事件"
          badge={auditHint}
          tone="cyan"
        />
      </div>

      {/* ───── 两个独立子组件, 各管各的 cursor 状态和轮询 ───── */}
      {tab === "warnings" ? <WarningsList /> : <AuditsList />}
    </div>
  );
}

// ─────────────────────── Tab button ───────────────────────

function TabButton({
  active,
  onClick,
  label,
  badge,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge: number;
  tone: "red" | "cyan";
}): JSX.Element {
  const badgeCls = tone === "red"
    ? "border-red-400/30 bg-red-400/[0.08] text-red-300"
    : "border-cyan-400/30 bg-cyan-400/[0.08] text-cyan-300";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-4 py-2.5 text-[13px] font-medium transition-colors ${
        active ? "text-white" : "text-gray-500 hover:text-gray-300"
      }`}
    >
      <span className="inline-flex items-center gap-2">
        {label}
        {badge > 0 ? (
          <span className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${badgeCls}`}>
            {badge}
          </span>
        ) : null}
      </span>
      {active ? (
        <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400" />
      ) : null}
    </button>
  );
}

// ─────────────────────── Warnings list ───────────────────────

function WarningsList(): JSX.Element {
  const store = useConsoleStore();
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SecurityWarningView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const seqRef = useRef(0);
  const loadingRef = useRef(false);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  type Mode = "reset" | "append" | "refresh";
  const fetchPage = useCallback(
    async (cursorArg: string | null, mode: Mode) => {
      if (!store.token) return;
      const seq = ++seqRef.current;
      if (mode !== "refresh") setLoading(true);
      setError(null);
      try {
        const page = await api.listWarnings(store.token, {
          limit: PAGE_SIZE,
          cursor: cursorArg ?? undefined,
          since: windowSince(timeWindow),
        });
        if (seq !== seqRef.current) return;
        setItems((prev) => {
          if (mode === "reset") return page.items;
          if (mode === "append") return [...prev, ...page.items];
          return mergeFirstPage(prev, page.items);
        });
        if (mode !== "refresh") setCursor(page.next_cursor ?? null);
        setTotal(page.total_estimate ?? null);
      } catch (err) {
        if (seq !== seqRef.current) return;
        if (mode !== "refresh") setError(err instanceof ApiError ? err.message : "加载失败");
      } finally {
        if (seq === seqRef.current && mode !== "refresh") setLoading(false);
      }
    },
    [store.token, timeWindow],
  );

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setTotal(null);
    void fetchPage(null, "reset");
  }, [fetchPage]);

  // 10s 后台轮询 (visibility-aware)
  useEffect(() => {
    if (!store.token) return;
    const tick = () => {
      if (document.hidden) return;
      if (loadingRef.current) return;
      void fetchPage(null, "refresh");
    };
    const timer = window.setInterval(tick, POLL_INTERVAL_MS);
    function onVis() { if (!document.hidden) tick(); }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [store.token, fetchPage]);

  // 滚到底自动加载
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!cursor || loading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) void fetchPage(cursor, "append"); },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loading, fetchPage]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((w) =>
      [w.warning_type, w.source_type, w.source_id ?? "", w.command_excerpt ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <div>
      <FilterBar
        timeWindow={timeWindow}
        onTimeWindow={setTimeWindow}
        query={query}
        onQuery={setQuery}
        placeholder="搜索类型 / 源 / 命令片段…"
        canClear={!!timeWindow || !!query.trim()}
        onClear={() => { setTimeWindow(""); setQuery(""); }}
      />

      <ResultCounter
        loaded={items.length}
        total={total}
        filtered={query.trim() ? visible.length : null}
        loading={loading}
        error={error}
        cursor={cursor}
        onLoadMore={() => cursor && void fetchPage(cursor, "append")}
      />

      {items.length === 0 && !loading ? (
        <EmptyPanel
          title={!timeWindow && !query ? "暂无安全告警" : "无匹配告警"}
          sub={!timeWindow && !query ? "系统稳定运行,未捕获到危险操作" : "尝试清空筛选或扩大时间窗"}
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-white/[0.05]">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-white/[0.05] bg-white/[0.015] text-[11px] text-gray-500">
                <th className="px-4 py-2.5 font-normal">时间</th>
                <th className="px-4 py-2.5 font-normal">告警类型</th>
                <th className="px-4 py-2.5 font-normal">来源</th>
                <th className="px-4 py-2.5 font-normal">命令片段</th>
                <th className="w-8 px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((w) => {
                const isOpen = expanded === w.id;
                return (
                  <FragmentRow key={w.id}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : w.id)}
                      className="group cursor-pointer border-b border-white/[0.03] transition-colors last:border-0 hover:bg-white/[0.02]"
                    >
                      <td className="px-4 py-3 font-mono text-[11.5px] text-gray-500" title={formatTime(w.created_at)}>
                        {formatRelative(w.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2 rounded-md border border-red-400/25 bg-red-400/[0.06] px-2 py-0.5 text-[11.5px] text-red-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                          {w.warning_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-gray-300">
                        <span className="font-mono text-gray-400">{w.source_type}</span>
                        {w.source_id ? (
                          <span className="ml-1.5 font-mono text-[11px] text-gray-600">{w.source_id}</span>
                        ) : null}
                      </td>
                      <td className="max-w-[420px] truncate px-4 py-3 font-mono text-[11.5px] text-gray-500">
                        {w.command_excerpt ?? <span className="text-gray-700">—</span>}
                      </td>
                      <td className="w-8 px-2 py-3 text-right text-gray-700 transition-colors group-hover:text-gray-400">
                        <Chevron open={isOpen} />
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="border-b border-white/[0.03] bg-white/[0.01]">
                        <td colSpan={5} className="px-4 py-3">
                          <CodeBlock label="detail" value={prettyJson(w.detail)} maxHeight={240} />
                        </td>
                      </tr>
                    ) : null}
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
          <div ref={sentinelRef} />
          {cursor && loading ? <LoadingFooter /> : null}
          {!cursor && items.length > 0 && !loading ? <EndOfListFooter count={items.length} /> : null}
        </div>
      )}
    </div>
  );
}

// ─────────────────────── Audits list ───────────────────────

function AuditsList(): JSX.Element {
  const store = useConsoleStore();
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AuditEventView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const seqRef = useRef(0);
  const loadingRef = useRef(false);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  type Mode = "reset" | "append" | "refresh";
  const fetchPage = useCallback(
    async (cursorArg: string | null, mode: Mode) => {
      if (!store.token) return;
      const seq = ++seqRef.current;
      if (mode !== "refresh") setLoading(true);
      setError(null);
      try {
        const page = await api.listAudits(store.token, {
          limit: PAGE_SIZE,
          cursor: cursorArg ?? undefined,
          since: windowSince(timeWindow),
        });
        if (seq !== seqRef.current) return;
        setItems((prev) => {
          if (mode === "reset") return page.items;
          if (mode === "append") return [...prev, ...page.items];
          return mergeFirstPage(prev, page.items);
        });
        if (mode !== "refresh") setCursor(page.next_cursor ?? null);
        setTotal(page.total_estimate ?? null);
      } catch (err) {
        if (seq !== seqRef.current) return;
        if (mode !== "refresh") setError(err instanceof ApiError ? err.message : "加载失败");
      } finally {
        if (seq === seqRef.current && mode !== "refresh") setLoading(false);
      }
    },
    [store.token, timeWindow],
  );

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setTotal(null);
    void fetchPage(null, "reset");
  }, [fetchPage]);

  useEffect(() => {
    if (!store.token) return;
    const tick = () => {
      if (document.hidden) return;
      if (loadingRef.current) return;
      void fetchPage(null, "refresh");
    };
    const timer = window.setInterval(tick, POLL_INTERVAL_MS);
    function onVis() { if (!document.hidden) tick(); }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [store.token, fetchPage]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!cursor || loading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) void fetchPage(cursor, "append"); },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loading, fetchPage]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((e) =>
      [e.action, e.actor_type, e.actor_id ?? "", e.target_type, e.target_id ?? "", e.request_ip ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <div>
      <FilterBar
        timeWindow={timeWindow}
        onTimeWindow={setTimeWindow}
        query={query}
        onQuery={setQuery}
        placeholder="搜索 action / 操作者 / 目标 / IP…"
        canClear={!!timeWindow || !!query.trim()}
        onClear={() => { setTimeWindow(""); setQuery(""); }}
      />

      <ResultCounter
        loaded={items.length}
        total={total}
        filtered={query.trim() ? visible.length : null}
        loading={loading}
        error={error}
        cursor={cursor}
        onLoadMore={() => cursor && void fetchPage(cursor, "append")}
      />

      {items.length === 0 && !loading ? (
        <EmptyPanel
          title={!timeWindow && !query ? "暂无审计事件" : "无匹配事件"}
          sub={!timeWindow && !query ? "系统尚未记录管理操作" : "尝试清空筛选或扩大时间窗"}
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-white/[0.05]">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-white/[0.05] bg-white/[0.015] text-[11px] text-gray-500">
                <th className="px-4 py-2.5 font-normal">时间</th>
                <th className="px-4 py-2.5 font-normal">操作者</th>
                <th className="px-4 py-2.5 font-normal">操作</th>
                <th className="px-4 py-2.5 font-normal">目标</th>
                <th className="px-4 py-2.5 font-normal">IP</th>
                <th className="w-8 px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => {
                const isOpen = expanded === e.id;
                return (
                  <FragmentRow key={e.id}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : e.id)}
                      className="group cursor-pointer border-b border-white/[0.03] transition-colors last:border-0 hover:bg-white/[0.02]"
                    >
                      <td className="px-4 py-3 font-mono text-[11.5px] text-gray-500" title={formatTime(e.created_at)}>
                        {formatRelative(e.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-[11.5px] text-gray-300">{e.actor_type}</span>
                        {e.actor_id ? (
                          <span className="ml-1.5 font-mono text-[10.5px] text-gray-600">{e.actor_id}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-cyan-300">{e.action}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-[11.5px] text-gray-400">{e.target_type}</span>
                        {e.target_id ? (
                          <span className="ml-1.5 font-mono text-[10.5px] text-gray-600">{e.target_id}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-gray-500">
                        {e.request_ip ?? <span className="text-gray-700">—</span>}
                      </td>
                      <td className="w-8 px-2 py-3 text-right text-gray-700 transition-colors group-hover:text-gray-400">
                        <Chevron open={isOpen} />
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="border-b border-white/[0.03] bg-white/[0.01]">
                        <td colSpan={6} className="px-4 py-3">
                          <CodeBlock label="detail" value={prettyJson(e.detail)} maxHeight={240} />
                        </td>
                      </tr>
                    ) : null}
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
          <div ref={sentinelRef} />
          {cursor && loading ? <LoadingFooter /> : null}
          {!cursor && items.length > 0 && !loading ? <EndOfListFooter count={items.length} /> : null}
        </div>
      )}
    </div>
  );
}

// ─────────────────────── 共享子组件 ───────────────────────

function FilterBar({
  timeWindow,
  onTimeWindow,
  query,
  onQuery,
  placeholder,
  canClear,
  onClear,
}: {
  timeWindow: TimeWindow;
  onTimeWindow: (v: TimeWindow) => void;
  query: string;
  onQuery: (v: string) => void;
  placeholder: string;
  canClear: boolean;
  onClear: () => void;
}): JSX.Element {
  const hasTime = !!timeWindow;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-white/[0.045] pb-3">
      <select
        value={timeWindow}
        onChange={(e) => onTimeWindow(e.target.value as TimeWindow)}
        className={`rounded-md border bg-[#0a0d12] py-1.5 pl-2.5 pr-7 text-[12px] outline-none transition-colors appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236b7280%22 stroke-width=%222%22><polyline points=%226 9 12 15 18 9%22/></svg>')] bg-[length:12px] bg-[right_8px_center] bg-no-repeat ${
          hasTime
            ? "border-cyan-400/40 text-cyan-200"
            : "border-white/[0.07] text-gray-300 hover:border-white/[0.12]"
        }`}
      >
        {TIME_WINDOWS.map((w) => (
          <option key={w.value} value={w.value}>{w.label}</option>
        ))}
      </select>
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
          placeholder={placeholder}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          className="w-full rounded-md border border-white/[0.07] bg-[#0a0d12] py-1.5 pl-9 pr-3 text-[12.5px] text-white outline-none transition-colors placeholder:text-gray-600 focus:border-cyan-400/40 focus:bg-[#0c1017]"
        />
      </div>
      {canClear ? (
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-white/[0.07] bg-white/[0.02] px-2.5 py-1.5 text-[11.5px] text-gray-400 transition-colors hover:border-white/[0.12] hover:text-white"
        >
          清空筛选
        </button>
      ) : null}
    </div>
  );
}

function ResultCounter({
  loaded,
  total,
  filtered,
  loading,
  error,
  cursor,
  onLoadMore,
}: {
  loaded: number;
  total: number | null;
  filtered: number | null;
  loading: boolean;
  error: string | null;
  cursor: string | null;
  onLoadMore: () => void;
}): JSX.Element {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3 text-[11.5px]">
      <span className="text-gray-500">
        {error ? (
          <span className="text-red-300">{error}</span>
        ) : loaded === 0 && loading ? (
          "加载中…"
        ) : (
          <>
            已加载 <span className="font-mono text-gray-300">{loaded}</span>
            {total != null && total > loaded ? (
              <> / 共约 <span className="font-mono text-gray-300">{total}</span></>
            ) : null}
            {filtered != null ? (
              <> · 本页过滤 <span className="font-mono text-cyan-300">{filtered}</span></>
            ) : null}
          </>
        )}
      </span>
      {cursor && !loading ? (
        <button
          type="button"
          onClick={onLoadMore}
          className="text-[11.5px] text-cyan-300 transition-colors hover:text-cyan-200"
        >
          加载下一页 →
        </button>
      ) : null}
    </div>
  );
}

function EmptyPanel({ title, sub }: { title: string; sub: string }): JSX.Element {
  return (
    <div className="rounded-md border border-dashed border-white/[0.06] bg-[#0a0d12] px-6 py-16 text-center">
      <div className="text-[13px] font-medium text-gray-300">{title}</div>
      <div className="mt-1.5 text-[12px] text-gray-500">{sub}</div>
    </div>
  );
}

function LoadingFooter(): JSX.Element {
  return <div className="px-4 py-3 text-center text-[11.5px] text-gray-500">加载下一页…</div>;
}

function EndOfListFooter({ count }: { count: number }): JSX.Element {
  return (
    <div className="border-t border-white/[0.04] px-4 py-3 text-center text-[11px] text-gray-600">
      已到底部 · 共 {count} 条
    </div>
  );
}

function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2"
      className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// React 不允许 tbody 内 fragment 不带 key, 包一层
function FragmentRow({ children }: { children: React.ReactNode }): JSX.Element {
  return <>{children}</>;
}
