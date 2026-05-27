import { navigate } from "../../../lib/routing";
import { formatRelative } from "../../../lib/format";
import type { AdminTaskListItem, NodeResponse } from "../../../types";
import { TaskComposer } from "../../tasks/TaskComposer";
import { badgeCls } from "./shared";

type Props = {
  node: NodeResponse;
  canDispatch: boolean;
  recentTasks: AdminTaskListItem[];
};

export function TasksPanel({ node, canDispatch, recentTasks }: Props): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div className="flex items-center gap-2 border-b border-white/5 pb-3">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-cyan-400"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>
          <span className="text-[13px] font-bold font-mono uppercase tracking-wide text-gray-400">调度控制台 Dispatch Command</span>
        </div>
        {!canDispatch ? (
          <div className="rounded-lg border border-dashed border-white/5 py-12 text-center text-xs font-mono text-gray-600">{!node.is_enabled ? "节点已停用" : node.connection_status === "offline" ? "节点离线" : "暂不可下发"}</div>
        ) : (
          <TaskComposer node={node} />
        )}
      </div>

      <div className="space-y-4 lg:col-span-1">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <span className="text-[12px] font-bold font-mono uppercase text-gray-500">Recent Executions</span>
          <span className="cursor-pointer text-[10px] text-cyan-500 transition-colors hover:text-white" onClick={() => navigate({ name: "tasks" })}>View Stream</span>
        </div>
        <div className="space-y-2.5">
          {recentTasks.length === 0 ? <div className="py-12 text-center text-[11px] font-mono text-gray-600">暂无任务</div> : recentTasks.slice(0, 5).map((task) => (
            <div key={task.task_id} onClick={() => navigate({ name: "task-detail", taskId: task.task_id })} className="group cursor-pointer rounded-xl border border-white/5 bg-white/[0.01] p-3.5 transition-all hover:border-white/10 hover:bg-white/[0.03]">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[11px] text-gray-200 transition-colors group-hover:text-cyan-400">{task.task_id}</span>
                <span className={`${badgeCls} ${task.status === "succeeded" ? "border-emerald-800/30 bg-emerald-950/40 text-emerald-400" : "border-white/5 bg-white/5 text-gray-400"}`}>{task.status}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-gray-500"><span>{task.type}</span><span>{formatRelative(task.created_at)}</span></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
