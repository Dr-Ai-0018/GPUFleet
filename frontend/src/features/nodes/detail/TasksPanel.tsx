import { navigate } from "../../../lib/routing";
import { formatRelative } from "../../../lib/format";
import type { AdminTaskListItem, NodeResponse } from "../../../types";
import { TaskComposer } from "../../tasks/TaskComposer";

type Props = {
  node: NodeResponse;
  canDispatch: boolean;
  recentTasks: AdminTaskListItem[];
};

// 与 MonitorPanel / ConfigPanel 风格统一: 平铺布局 + 分区标题 + 留白
// 主列 = TaskComposer (自带表单样式) 右栏 = 最近任务流

const STATUS_TONE: Record<
  string,
  { dot: string; text: string }
> = {
  succeeded: { dot: "bg-emerald-400", text: "text-emerald-300" },
  running: { dot: "bg-cyan-400", text: "text-cyan-300" },
  pending: { dot: "bg-gray-400", text: "text-gray-300" },
  queued: { dot: "bg-gray-400", text: "text-gray-300" },
  failed: { dot: "bg-red-400", text: "text-red-300" },
  cancelled: { dot: "bg-amber-400", text: "text-amber-300" },
};

function statusTone(status: string): { dot: string; text: string } {
  return STATUS_TONE[status] ?? { dot: "bg-gray-500", text: "text-gray-400" };
}

export function TasksPanel({ node, canDispatch, recentTasks }: Props): JSX.Element {
  const blockReason = !node.is_enabled
    ? "节点已停用"
    : node.connection_status === "offline"
      ? "节点离线"
      : "暂不可下发";

  return (
    <div className="py-2">
      {/* Page heading */}
      <header className="mb-8 border-b border-white/[0.045] pb-6">
        <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-white">任务调度</h2>
        <p className="mt-1.5 text-[13px] leading-6 text-gray-500">
          向当前节点下发一次性任务 — Shell、Python 脚本、pip 安装等。提交后可在下方任务流跟踪进度。
        </p>
      </header>

      <div className="grid grid-cols-1 gap-x-14 gap-y-12 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ───── Main column: composer ───── */}
        <section>
          <div className="mb-5 flex items-baseline justify-between gap-4">
            <div>
              <h3 className="text-[14px] font-semibold text-white">下发新任务</h3>
              <p className="mt-1 text-[12px] leading-5 text-gray-500">
                填写任务类型与参数后下发。idempotency_key 可避免重复提交。
              </p>
            </div>
          </div>

          {canDispatch ? (
            <TaskComposer node={node} />
          ) : (
            <div className="rounded-md border border-dashed border-white/[0.07] bg-[#0a0d12] px-6 py-16 text-center">
              <div className="text-[13px] font-medium text-gray-300">{blockReason}</div>
              <div className="mt-1.5 text-[12px] text-gray-500">
                等待节点恢复在线后即可继续下发任务。
              </div>
            </div>
          )}
        </section>

        {/* ───── Right sidebar: recent executions ───── */}
        <aside className="xl:sticky xl:top-2 xl:self-start">
          <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-white/[0.045] pb-3">
            <h3 className="text-[13px] font-semibold text-white">最近任务流</h3>
            <button
              type="button"
              onClick={() => navigate({ name: "tasks" })}
              className="text-[11.5px] text-cyan-300 transition-colors hover:text-cyan-200"
            >
              查看全部 →
            </button>
          </div>

          {recentTasks.length === 0 ? (
            <div className="rounded-md border border-dashed border-white/[0.06] bg-[#0a0d12] px-4 py-10 text-center text-[12px] text-gray-500">
              暂无历史任务
            </div>
          ) : (
            <ul className="space-y-1.5">
              {recentTasks.slice(0, 8).map((task) => {
                const tone = statusTone(task.status);
                return (
                  <li key={task.task_id}>
                    <button
                      type="button"
                      onClick={() => navigate({ name: "task-detail", taskId: task.task_id })}
                      className="group block w-full rounded-md border border-white/[0.05] bg-[#0b0e13] px-3 py-2.5 text-left transition-colors hover:border-white/[0.1] hover:bg-[#0d1119]"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-mono text-[11.5px] text-gray-200 transition-colors group-hover:text-white">
                          {task.task_id}
                        </span>
                        <span className={`flex shrink-0 items-center gap-1.5 text-[11px] ${tone.text}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                          {task.status}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-gray-500">
                        <span className="truncate">{task.type}</span>
                        <span className="shrink-0 font-mono text-[10.5px] text-gray-600">
                          {formatRelative(task.created_at)}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
