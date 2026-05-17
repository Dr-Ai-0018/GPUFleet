import { useMemo, useState } from "react";
import { navigate } from "../../lib/routing";
import { useConsoleStore } from "../../state/ConsoleStore";
import { StatusPill } from "../../ui/StatusPill";
import { taskStatusLabel, taskStatusTone } from "../../lib/labels";
import { formatRelative, formatTime } from "../../lib/format";

const cardCls = "rounded-xl transition-all duration-300 bg-[linear-gradient(180deg,rgba(16,18,23,0.95)_0%,rgba(10,11,14,0.98)_100%)] border border-white/[0.04] shadow-[0_4px_20px_-2px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.03)]";
const inputCls = "bg-[rgba(5,5,7,0.8)] border border-white/5 rounded-md px-3 py-1.5 text-xs text-gray-300 outline-none focus:border-cyan-500/30 transition-all";

const STATUS_GROUPS = [
  { value: "all", label: "全部" },
  { value: "active", label: "进行中" },
  { value: "succeeded", label: "成功" },
  { value: "failed", label: "失败" },
] as const;

type StatusFilter = (typeof STATUS_GROUPS)[number]["value"];
const ACTIVE_SET = new Set(["pending", "claimed", "running", "cancel_requested"]);
const FAIL_SET = new Set(["failed", "timeout", "lost"]);

export function TasksView(): JSX.Element {
  const store = useConsoleStore();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [nodeFilter, setNodeFilter] = useState("all");
  const [query, setQuery] = useState("");

  const connectedNodes = store.nodes.filter((n) => n.is_enabled && n.connection_status === "online" && n.onboarding_status === "connected");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.tasks.filter((task) => {
      if (nodeFilter !== "all" && task.node_id !== nodeFilter) return false;
      if (filter === "active" && !ACTIVE_SET.has(task.status)) return false;
      if (filter === "succeeded" && task.status !== "succeeded") return false;
      if (filter === "failed" && !FAIL_SET.has(task.status)) return false;
      if (!q) return true;
      return [task.task_id, task.node_id, task.type].join(" ").toLowerCase().includes(q);
    });
  }, [store.tasks, nodeFilter, filter, query]);

  return (
    <div className="max-w-[1300px] mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-bold tracking-tight text-white font-mono">任务管理</h1>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-emerald-400 flex items-center gap-1.5 font-mono"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />{connectedNodes.length} 可下发</span>
        </div>
      </div>

      {/* Dispatch nodes strip */}
      {connectedNodes.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {connectedNodes.map((node) => (
            <button key={node.node_id} type="button" onClick={() => navigate({ name: "node-detail", nodeId: node.node_id })} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/[0.04] transition-all text-xs shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="font-medium text-white">{node.display_name}</span>
              <span className="text-gray-500 font-mono">{node.node_type}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-[#090A0D] border border-white/5 p-1 rounded-lg">
          {STATUS_GROUPS.map((g) => (
            <button key={g.value} type="button" onClick={() => setFilter(g.value)} className={`px-3 py-1.5 text-xs font-bold font-mono rounded-md transition-all ${filter === g.value ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"}`}>{g.label}</button>
          ))}
        </div>
        <select value={nodeFilter} onChange={(e) => setNodeFilter(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="all">全部节点</option>
          {store.nodes.map((n) => <option key={n.node_id} value={n.node_id}>{n.display_name}</option>)}
        </select>
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-2 text-gray-600" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input type="text" placeholder="搜索 task_id / type / node…" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputCls} w-full pl-9`} />
        </div>
        <span className="text-[11px] text-gray-500 font-mono ml-auto">{filtered.length} / {store.tasks.length}</span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className={`${cardCls} p-12 text-center text-xs text-gray-600 font-mono`}>无匹配任务</div>
      ) : (
        <div className={`${cardCls} p-0 overflow-hidden`}>
          <table className="w-full text-left text-xs">
            <thead className="text-gray-500 font-mono uppercase tracking-wider border-b border-white/5 bg-[#090A0D]/20">
              <tr>
                <th className="px-5 py-3 font-medium">任务 ID</th>
                <th className="px-5 py-3 font-medium">节点</th>
                <th className="px-5 py-3 font-medium">类型</th>
                <th className="px-5 py-3 font-medium">状态</th>
                <th className="px-5 py-3 font-medium">创建时间</th>
                <th className="px-5 py-3 font-medium text-right">完成时间</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => (
                <tr key={task.task_id} className="hover:bg-white/[0.02] transition-colors cursor-pointer border-b border-white/[0.03] last:border-0" onClick={() => navigate({ name: "task-detail", taskId: task.task_id })}>
                  <td className="px-5 py-3.5 font-mono text-cyan-500">{task.task_id}</td>
                  <td className="px-5 py-3.5 font-mono text-gray-400">{task.node_id}</td>
                  <td className="px-5 py-3.5 font-mono text-gray-300">{task.type}</td>
                  <td className="px-5 py-3.5"><StatusPill tone={taskStatusTone[task.status] ?? "muted"} label={taskStatusLabel[task.status] ?? task.status} pulse={task.status === "running"} /></td>
                  <td className="px-5 py-3.5 text-gray-500" title={formatTime(task.created_at)}>{formatRelative(task.created_at)}</td>
                  <td className="px-5 py-3.5 text-right text-gray-500">{task.finished_at ? formatRelative(task.finished_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
