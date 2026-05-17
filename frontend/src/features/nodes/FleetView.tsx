import { useMemo, useState } from "react";
import { navigate } from "../../lib/routing";
import { useConsoleStore } from "../../state/ConsoleStore";
import type { NodeResponse, OnboardingStatus, OnlineStatus } from "../../types";
import { StatusPill } from "../../ui/StatusPill";
import { connectionLabel, connectionTone, nodeTypeLabel, onboardingLabel, onboardingTone, osLabel } from "../../lib/labels";
import { formatRelative } from "../../lib/format";

const cardCls = "rounded-xl transition-all duration-300 bg-[linear-gradient(180deg,rgba(16,18,23,0.95)_0%,rgba(10,11,14,0.98)_100%)] border border-white/[0.04] shadow-[0_4px_20px_-2px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.03)] hover:border-white/[0.08]";
const inputCls = "w-full bg-[rgba(5,5,7,0.8)] border border-white/5 rounded-md px-3 py-1.5 text-xs text-gray-300 outline-none focus:border-cyan-500/30 transition-all";

type ConnectionFilter = "all" | OnlineStatus;

export function FleetView(): JSX.Element {
  const store = useConsoleStore();
  const [query, setQuery] = useState("");
  const [connFilter, setConnFilter] = useState<ConnectionFilter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.nodes.filter((node) => {
      if (connFilter !== "all" && node.connection_status !== connFilter) return false;
      if (!q) return true;
      return [node.node_id, node.display_name, node.hostname ?? "", ...node.tags].join(" ").toLowerCase().includes(q);
    });
  }, [store.nodes, connFilter, query]);

  return (
    <div className="max-w-[1300px] mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-bold tracking-tight text-white font-mono">节点舰队</h1>
        <button type="button" onClick={() => navigate({ name: "onboarding" })} className="px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white text-[12px] font-bold rounded-lg transition-all">+ 登记新节点</button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <select value={connFilter} onChange={(e) => setConnFilter(e.target.value as ConnectionFilter)} className={`${inputCls} w-auto`}>
          <option value="all">全部状态</option>
          <option value="online">在线</option>
          <option value="offline">离线</option>
          <option value="never_seen">未上线</option>
          <option value="disabled">停用</option>
        </select>
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-2 text-gray-600" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input type="text" placeholder="搜索名称、ID、标签…" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputCls} pl-9`} />
        </div>
        <span className="text-[11px] text-gray-500 font-mono ml-auto">{filtered.length} / {store.nodes.length}</span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className={`${cardCls} p-12 text-center`}>
          <p className="text-sm text-gray-500 mb-4">{store.nodes.length === 0 ? "舰队为空" : "无匹配结果"}</p>
          {store.nodes.length === 0 ? <button type="button" onClick={() => navigate({ name: "onboarding" })} className="px-4 py-2 bg-white text-[#07080A] rounded-lg text-xs font-bold">去登记节点</button> : null}
        </div>
      ) : (
        <div className={`${cardCls} p-0 overflow-hidden`}>
          <table className="w-full text-left text-xs">
            <thead className="text-gray-500 font-mono uppercase tracking-wider border-b border-white/5 bg-[#090A0D]/20">
              <tr>
                <th className="px-5 py-3 font-medium">节点</th>
                <th className="px-5 py-3 font-medium">状态</th>
                <th className="px-5 py-3 font-medium">类型</th>
                <th className="px-5 py-3 font-medium">主机名</th>
                <th className="px-5 py-3 font-medium">心跳</th>
                <th className="px-5 py-3 font-medium">最近活动</th>
                <th className="px-5 py-3 font-medium">标签</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((node) => (
                <tr key={node.node_id} className="hover:bg-white/[0.02] transition-colors cursor-pointer border-b border-white/[0.03] last:border-0" onClick={() => navigate({ name: "node-detail", nodeId: node.node_id })}>
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-white text-[13px]">{node.display_name}</div>
                    <div className="text-[11px] text-gray-500 font-mono">{node.node_id}</div>
                  </td>
                  <td className="px-5 py-3.5"><StatusPill tone={connectionTone[node.connection_status]} label={connectionLabel[node.connection_status]} pulse={node.connection_status === "online"} /></td>
                  <td className="px-5 py-3.5 text-gray-400">{nodeTypeLabel[node.node_type] ?? node.node_type}{node.os_type ? <span className="block text-[11px] text-gray-600">{osLabel[node.os_type] ?? node.os_type}</span> : null}</td>
                  <td className="px-5 py-3.5 font-mono text-gray-400">{node.hostname ?? "—"}</td>
                  <td className="px-5 py-3.5 font-mono text-gray-400">{node.heartbeat_interval_sec}s</td>
                  <td className="px-5 py-3.5 text-gray-500">{node.last_seen_at ? formatRelative(node.last_seen_at) : "尚未"}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1">{node.tags.slice(0, 3).map((t) => <span key={t} className="px-2 py-0.5 text-[10px] font-mono bg-white/5 border border-white/5 rounded text-gray-400">{t}</span>)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
