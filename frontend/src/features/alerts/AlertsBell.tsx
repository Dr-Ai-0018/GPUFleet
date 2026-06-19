import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { formatRelative } from "../../lib/format";
import { labelForError } from "../../lib/labels";
import { useConsoleStore } from "../../state/ConsoleStore";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { StatusPill } from "../../ui/StatusPill";
import type { StatusTone } from "../../lib/labels";
import { useToast } from "../../ui/Toast";
import type { AlertMessageView } from "../../types";

const POLL_INTERVAL_MS = 10_000;

const SEVERITY_TONE: Record<string, StatusTone> = {
  info: "muted",
  warning: "waiting",
  critical: "danger",
  error: "danger",
};

/**
 * 顶栏铃铛 + alerts 抽屉. 接 §1.5 Phase B 告警工作流后端 (/admin/alerts).
 * - 10s 轮询 unread-count, 抽屉打开时刷新
 * - 抽屉打开时拉完整 list (unread + read 各 50 条)
 * - 列表项 click → POST /alerts/{id}/read
 */
export function AlertsBell(): JSX.Element {
  const store = useConsoleStore();
  const { callApi } = store;
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [alerts, setAlerts] = useState<AlertMessageView[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshUnread = useCallback(async () => {
    if (!store.token) return;
    try {
      const { unread_count } = await callApi((t) => api.getAlertsUnreadCount(t));
      setUnreadCount(unread_count);
    } catch {
      // 静默 — 顶栏轮询不打扰用户
    }
  }, [callApi, store.token]);

  const refreshList = useCallback(async () => {
    if (!store.token) return;
    setLoading(true);
    try {
      const list = await callApi((t) => api.listAlerts(t));
      setAlerts(list);
    } catch (err) {
      toast.push({ tone: "error", title: "告警加载失败", description: labelForError(err, "") });
    } finally {
      setLoading(false);
    }
  }, [callApi, store.token, toast]);

  useEffect(() => {
    void refreshUnread();
    const id = window.setInterval(() => void refreshUnread(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refreshUnread]);

  useEffect(() => {
    if (open) void refreshList();
  }, [open, refreshList]);

  async function handleMarkRead(alertId: number) {
    try {
      const updated = await callApi((t) => api.markAlertRead(t, alertId));
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? updated : a)));
      void refreshUnread();
    } catch (err) {
      toast.push({ tone: "error", title: "标记失败", description: labelForError(err, "") });
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="告警中心"
        className="relative rounded-md p-1.5 text-gray-500 transition-colors hover:bg-white/5 hover:text-white"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 003.4 0" />
        </svg>
        {unreadCount > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 font-mono text-[9px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="关闭告警"
            className="fixed inset-0 z-30 bg-black/55"
            onClick={() => setOpen(false)}
          />
          <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-white/10 bg-[#0a0d12] shadow-2xl">
            <header className="flex items-center justify-between border-b border-white/5 px-5 py-4">
              <div>
                <div className="font-mono text-[12px] font-bold text-gray-500 uppercase">告警中心</div>
                <div className="mt-0.5 text-sm font-medium text-white">
                  {unreadCount > 0 ? `${unreadCount} 条未读` : "全部已读"}
                </div>
              </div>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                关闭
              </Button>
            </header>

            <div className="flex-1 overflow-y-auto">
              {loading && alerts.length === 0 ? (
                <div className="py-20 text-center font-mono text-xs text-gray-500">加载中…</div>
              ) : alerts.length === 0 ? (
                <div className="py-12">
                  <EmptyState title="无告警" description="近期没有触发的告警事件" />
                </div>
              ) : (
                <ul className="divide-y divide-white/5">
                  {alerts.map((a) => (
                    <li key={a.id} className={`px-5 py-3 ${a.status === "unread" ? "bg-white/[0.02]" : ""}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <StatusPill
                              tone={SEVERITY_TONE[a.severity] ?? "muted"}
                              label={a.severity}
                              subtle
                            />
                            <span className="truncate font-mono text-[11px] text-gray-500">
                              {a.alert_type}
                            </span>
                          </div>
                          <div className="mt-1.5 text-sm font-medium text-white">{a.title}</div>
                          {a.summary ? (
                            <div className="mt-0.5 text-xs text-gray-400">{a.summary}</div>
                          ) : null}
                          <div className="mt-1.5 font-mono text-[10px] text-gray-600">
                            {formatRelative(a.created_at)}
                          </div>
                        </div>
                        {a.status === "unread" ? (
                          <button
                            type="button"
                            onClick={() => void handleMarkRead(a.id)}
                            className="shrink-0 rounded-md border border-white/10 px-2 py-1 font-mono text-[10px] text-gray-400 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                          >
                            标已读
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </>
      ) : null}
    </>
  );
}
