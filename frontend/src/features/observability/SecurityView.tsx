import React, { useMemo, useState } from "react";
import { useConsoleStore } from "../../state/ConsoleStore";
import { CodeBlock } from "../../ui/CodeBlock";
import { StatusPill } from "../../ui/StatusPill";
import { formatTime, prettyJson } from "../../lib/format";
import { RingGauge } from "../../ui/RingGauge";

const cardCls = "rounded-xl transition-all duration-300 bg-[var(--surface-card)] border border-[var(--card-border)] shadow-[var(--shadow-card-lite)]";
const inputCls = "bg-[rgba(5,5,7,0.8)] border border-white/5 rounded-md px-3 py-1.5 text-xs text-gray-300 outline-none focus:border-cyan-500/30 transition-all";

type TabKey = "warnings" | "audits";

export function SecurityView(): JSX.Element {
  const store = useConsoleStore();
  const [tab, setTab] = useState<TabKey>(store.warnings.length > 0 ? "warnings" : "audits");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const totalSignals = store.warnings.length + store.audits.length;
  const warningRate = totalSignals > 0 ? Math.round((store.warnings.length / totalSignals) * 100) : 0;

  const filteredWarnings = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return store.warnings;
    return store.warnings.filter((w) => [w.warning_type, w.source_type, w.command_excerpt ?? ""].join(" ").toLowerCase().includes(q));
  }, [store.warnings, query]);

  const filteredAudits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return store.audits;
    return store.audits.filter((e) => [e.action, e.actor_type, e.target_type, e.target_id ?? ""].join(" ").toLowerCase().includes(q));
  }, [store.audits, query]);

  return (
    <div className="max-w-[1300px] mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-bold tracking-tight text-white font-mono">安全审计</h1>
        <div className="flex items-center gap-4 text-xs">
          <span className={store.warnings.length > 0 ? "text-red-400 font-bold" : "text-gray-500"}>{store.warnings.length} 告警</span>
          <span className="text-gray-500">{store.audits.length} 事件</span>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr_1fr]">
        <div className={`${cardCls} px-5 py-5`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-gray-500">Security Posture</div>
              <div className="mt-2 text-4xl font-bold font-mono text-white">{totalSignals}</div>
              <div className="mt-1 text-[12px] text-gray-500">warnings and audit signals in buffer</div>
            </div>
            <RingGauge value={warningRate} size={90} label={String(warningRate)} sublabel="WARN" />
          </div>
        </div>
        <div className={`${cardCls} px-5 py-5`}>
          <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-gray-500">Warning Feed</div>
          <div className="mt-2 text-3xl font-bold font-mono text-red-300">{store.warnings.length}</div>
          <div className="mt-1 text-[12px] text-gray-500">danger-level events requiring review</div>
        </div>
        <div className={`${cardCls} px-5 py-5`}>
          <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-gray-500">Audit Trail</div>
          <div className="mt-2 text-3xl font-bold font-mono text-cyan-300">{store.audits.length}</div>
          <div className="mt-1 text-[12px] text-gray-500">operator actions captured for traceability</div>
        </div>
      </div>

      {/* Tab + search */}
      <div className="flex items-center gap-4">
        <div className="flex gap-1 bg-[#090A0D] border border-white/5 p-1 rounded-lg">
          <button type="button" onClick={() => setTab("warnings")} className={`px-3 py-1.5 text-xs font-bold font-mono rounded-md transition-all ${tab === "warnings" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"}`}>
            安全告警{store.warnings.length > 0 ? ` (${store.warnings.length})` : ""}
          </button>
          <button type="button" onClick={() => setTab("audits")} className={`px-3 py-1.5 text-xs font-bold font-mono rounded-md transition-all ${tab === "audits" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"}`}>审计事件</button>
        </div>
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-2 text-gray-600" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input type="text" placeholder="搜索…" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputCls} w-full pl-9`} />
        </div>
      </div>

      {/* Content */}
      {tab === "warnings" ? (
        filteredWarnings.length === 0 ? (
          <div className={`${cardCls} p-12 text-center text-xs text-gray-600 font-mono`}>当前没有安全告警</div>
        ) : (
          <div className={`${cardCls} p-0 overflow-hidden`}>
            <table className="w-full text-left text-xs">
              <thead className="text-gray-500 font-mono uppercase tracking-wider border-b border-white/5 bg-[#090A0D]/20">
                <tr><th className="px-5 py-3">时间</th><th className="px-5 py-3">类型</th><th className="px-5 py-3">来源</th><th className="px-5 py-3">片段</th><th className="px-5 py-3 w-8"></th></tr>
              </thead>
              <tbody>
                {filteredWarnings.map((w) => (
                  <React.Fragment key={w.id}>
                    <tr className="hover:bg-white/[0.02] transition-colors cursor-pointer border-b border-white/[0.03]" onClick={() => setExpanded(expanded === w.id ? null : w.id)}>
                      <td className="px-5 py-3 text-gray-500 font-mono">{formatTime(w.created_at)}</td>
                      <td className="px-5 py-3"><StatusPill tone="danger" label={w.warning_type} /></td>
                      <td className="px-5 py-3 font-mono text-gray-400">{w.source_type}</td>
                      <td className="px-5 py-3 font-mono text-gray-500 max-w-[200px] truncate">{w.command_excerpt ?? "—"}</td>
                      <td className="px-5 py-3 text-gray-600">{expanded === w.id ? "▾" : "▸"}</td>
                    </tr>
                    {expanded === w.id ? <tr><td colSpan={5} className="px-5 py-3 border-b border-white/[0.03]"><CodeBlock value={prettyJson(w.detail)} maxHeight={200} /></td></tr> : null}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        filteredAudits.length === 0 ? (
          <div className={`${cardCls} p-12 text-center text-xs text-gray-600 font-mono`}>暂无审计事件</div>
        ) : (
          <div className={`${cardCls} p-0 overflow-hidden`}>
            <table className="w-full text-left text-xs">
              <thead className="text-gray-500 font-mono uppercase tracking-wider border-b border-white/5 bg-[#090A0D]/20">
                <tr><th className="px-5 py-3">时间</th><th className="px-5 py-3">操作者</th><th className="px-5 py-3">操作</th><th className="px-5 py-3">目标</th><th className="px-5 py-3">IP</th><th className="px-5 py-3 w-8"></th></tr>
              </thead>
              <tbody>
                {filteredAudits.map((e) => (
                  <React.Fragment key={e.id}>
                    <tr className="hover:bg-white/[0.02] transition-colors cursor-pointer border-b border-white/[0.03]" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                      <td className="px-5 py-3 text-gray-500 font-mono">{formatTime(e.created_at)}</td>
                      <td className="px-5 py-3 font-mono text-gray-400">{e.actor_type}</td>
                      <td className="px-5 py-3 font-mono text-white font-medium">{e.action}</td>
                      <td className="px-5 py-3 font-mono text-gray-400">{e.target_type}{e.target_id ? ` · ${e.target_id}` : ""}</td>
                      <td className="px-5 py-3 font-mono text-gray-500">{e.request_ip ?? "—"}</td>
                      <td className="px-5 py-3 text-gray-600">{expanded === e.id ? "▾" : "▸"}</td>
                    </tr>
                    {expanded === e.id ? <tr><td colSpan={6} className="px-5 py-3 border-b border-white/[0.03]"><CodeBlock value={prettyJson(e.detail)} maxHeight={200} /></td></tr> : null}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
