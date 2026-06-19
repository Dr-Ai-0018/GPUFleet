import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../../api";
import { navigate } from "../../lib/routing";
import { labelForError } from "../../lib/labels";
import { useConsoleStore } from "../../state/ConsoleStore";
import { CodeBlock } from "../../ui/CodeBlock";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { EmptyState } from "../../ui/EmptyState";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";
import { ConfigPanel } from "./detail/ConfigPanel";
import { MonitorPanel } from "./detail/MonitorPanel";
import { TasksPanel } from "./detail/TasksPanel";
import { HeroSummary } from "./detail/hero/HeroSummary";
import type {
  CpuSnapshot,
  MemorySnapshot,
  NodeDetailTabKey,
  NodeEditForm,
  PythonEnvSnapshot,
} from "./detail/types";
import { i18n } from "../../lib/i18n";
import type { NodeResetSecretResponse, NodeResponse, NodeStatusPreview, OsType } from "../../types";

type Props = { nodeId: string };

export function NodeDetailView({ nodeId }: Props): JSX.Element {
  const store = useConsoleStore();
  const { callApi } = store;
  const toast = useToast();
  const storeNode = store.nodes.find((item) => item.node_id === nodeId) ?? null;
  const overviewNode = store.overview?.nodes.find((item) => item.node_id === nodeId) ?? null;
  const [node, setNode] = useState<NodeResponse | null>(storeNode);
  const [latestStatus, setLatestStatus] = useState<NodeStatusPreview | null>(
    overviewNode?.latest_status ?? null,
  );
  const [tab, setTab] = useState<NodeDetailTabKey>("monitor");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditDirty, setIsEditDirty] = useState(false);
  const [editHydratedNodeId, setEditHydratedNodeId] = useState<string | null>(null);
  const [confirmToggleOpen, setConfirmToggleOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [resetResult, setResetResult] = useState<NodeResetSecretResponse | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [editForm, setEditForm] = useState<NodeEditForm>({
    display_name: "",
    hostname: "",
    os_type: "windows" as OsType,
    heartbeat_interval_sec: 5,
    allowed_workdirs: "",
    tags: "",
  });

  useEffect(() => {
    setNode(storeNode);
  }, [storeNode]);

  // Mount 拉一次 node 详情 + latest status (instant hydrate)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [nodeResult, statusResult] = await Promise.allSettled([
          callApi((token) => api.getNode(token, nodeId)),
          callApi((token) => api.getLatestNodeStatus(token, nodeId)),
        ]);
        if (cancelled) {
          return;
        }
        if (nodeResult.status === "fulfilled") {
          setNode(nodeResult.value);
        }
        if (statusResult.status === "fulfilled") {
          setLatestStatus(statusResult.value);
        } else if (statusResult.reason instanceof ApiError && statusResult.reason.status === 404) {
          setLatestStatus(null);
        }
      } catch {
        // best-effort hydrate
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [nodeId, callApi]);

  // Monitor tab 专属: 2s 轮询 latest status 让 KPI tile / GPU 仪表 / VRAM bar / 每核占用
  // 都跟时序图同节奏地活起来. 切到 config/tasks tab 自动暂停, 后台 (document.hidden) 也暂停.
  // 注意: 不再用 store.overview.nodes[].latest_status 的 5s 数据兜底, 因为它会覆盖更新鲜的轮询数据.
  useEffect(() => {
    if (!store.token) return;
    if (tab !== "monitor") return;

    let cancelled = false;
    let inFlight = false;

    async function poll() {
      if (cancelled || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const next = await callApi((token) => api.getLatestNodeStatus(token, nodeId));
        if (!cancelled) setLatestStatus(next);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404 && !cancelled) {
          setLatestStatus(null);
        }
        // 其它错误静默, 下次再试
      } finally {
        inFlight = false;
      }
    }

    const timer = window.setInterval(() => void poll(), 2000);

    function onVisibilityChange() {
      if (!document.hidden) void poll();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [store.token, nodeId, tab, callApi]);

  useEffect(() => {
    if (!node) {
      return;
    }
    if (isEditDirty && editHydratedNodeId === node.node_id) {
      return;
    }
    setEditForm({
      display_name: node.display_name,
      hostname: node.hostname ?? "",
      os_type: node.os_type === "linux" ? "linux" : "windows",
      heartbeat_interval_sec: node.heartbeat_interval_sec,
      allowed_workdirs: node.allowed_workdirs.join("\n"),
      tags: node.tags.join(", "),
    });
    setEditError(null);
    setIsEditDirty(false);
    setEditHydratedNodeId(node.node_id);
  }, [node, isEditDirty, editHydratedNodeId]);

  const updateEdit = (updater: (prev: NodeEditForm) => NodeEditForm): void => {
    setIsEditDirty(true);
    setEditForm((prev) => updater(prev));
  };

  const recentTasks = useMemo(
    () => store.tasks.filter((task) => task.node_id === nodeId).slice(0, 10),
    [store.tasks, nodeId],
  );

  if (!node) {
    return (
      <div className="py-20 text-center text-gray-500">
        <EmptyState
          title={i18n.nodeDetail.notFound}
          action={
            <Button variant="accent" onClick={() => navigate({ name: "fleet" })}>
              {i18n.common.back}
            </Button>
          }
        />
      </div>
    );
  }

  const currentNode = node;

  async function handleToggle() {
    setBusy(true);
    try {
      const updated = currentNode.is_enabled
        ? await store.callApi((token) => api.disableNode(token, currentNode.node_id))
        : await store.callApi((token) => api.enableNode(token, currentNode.node_id));
      setNode(updated);
      toast.push({
        tone: currentNode.is_enabled ? "warning" : "success",
        title: currentNode.is_enabled
          ? i18n.nodeDetail.actions.disabled
          : i18n.nodeDetail.actions.enabled,
      });
      await store.refresh({ silent: true });
    } catch (error) {
      toast.push({
        tone: "error",
        title: i18n.common.failed,
        description: labelForError(error, ""),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await store.callApi((token) => api.deleteNode(token, currentNode.node_id));
      toast.push({ tone: "success", title: i18n.common.deleteSuccess });
      await store.refresh({ silent: true });
      navigate({ name: "fleet" });
    } catch {
      toast.push({ tone: "error", title: i18n.common.failed });
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    setBusy(true);
    try {
      const result = await store.callApi((token) =>
        api.resetNodeSecret(token, currentNode.node_id),
      );
      setResetResult(result);
      toast.push({ tone: "success", title: i18n.nodeDetail.actions.resetDone });
    } catch {
      toast.push({ tone: "error", title: i18n.common.failed });
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshFingerprint() {
    setBusy(true);
    try {
      await store.callApi((token) => api.refreshNodeFingerprint(token, currentNode.node_id));
      toast.push({
        tone: "success",
        title: i18n.nodeDetail.actions.refreshFingerprintQueued,
        description: i18n.nodeDetail.actions.refreshFingerprintNote,
      });
    } catch (error) {
      toast.push({
        tone: "error",
        title: i18n.common.failed,
        description: labelForError(error, ""),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setEditError(null);
    try {
      const updated = await store.callApi((token) =>
        api.updateNode(token, currentNode.node_id, {
          display_name: editForm.display_name.trim(),
          hostname: editForm.hostname.trim() || null,
          os_type: editForm.os_type,
          heartbeat_interval_sec: Number(editForm.heartbeat_interval_sec),
          allowed_workdirs: editForm.allowed_workdirs
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean),
          tags: editForm.tags
            .split(/[,，]/)
            .map((item) => item.trim())
            .filter(Boolean),
        }),
      );
      setNode(updated);
      setIsEditDirty(false);
      setEditHydratedNodeId(updated.node_id);
      toast.push({ tone: "success", title: i18n.common.saveSuccess });
      await store.refresh({ silent: true });
    } catch (error) {
      setEditError(labelForError(error, i18n.common.failed));
    } finally {
      setSaving(false);
    }
  }

  const canDispatch =
    currentNode.is_enabled &&
    currentNode.connection_status === "online" &&
    currentNode.onboarding_status === "connected";
  const cpu = latestStatus?.cpu as CpuSnapshot | undefined;
  const memory = latestStatus?.memory as MemorySnapshot | undefined;
  const pythonEnv = latestStatus?.python_env as PythonEnvSnapshot | undefined;
  const gpus = latestStatus?.gpus ?? [];
  const cpuUse = Number(cpu?.usage_percent ?? 0);
  const memUse = Number(
    memory?.usage_percent ??
      (memory?.total_bytes ? ((memory?.used_bytes ?? 0) / memory.total_bytes) * 100 : 0),
  );

  return (
    <div className="space-y-7">
      <ConfirmDialog
        open={confirmToggleOpen}
        title={
          currentNode.is_enabled
            ? i18n.nodeDetail.dialogs.disableTitle
            : i18n.nodeDetail.dialogs.enableTitle
        }
        message={
          currentNode.is_enabled
            ? i18n.nodeDetail.dialogs.disableMessage
            : i18n.nodeDetail.dialogs.enableMessage
        }
        confirmLabel={i18n.common.confirm}
        cancelLabel={i18n.common.cancel}
        variant={currentNode.is_enabled ? "danger" : "accent"}
        onConfirm={() => {
          setConfirmToggleOpen(false);
          void handleToggle();
        }}
        onCancel={() => setConfirmToggleOpen(false)}
      />
      <ConfirmDialog
        open={confirmDeleteOpen}
        title={i18n.nodeDetail.dialogs.deleteTitle}
        message={i18n.nodeDetail.dialogs.deleteMessage}
        confirmLabel={i18n.nodeDetail.actions.deleteNode}
        cancelLabel={i18n.common.cancel}
        variant="danger"
        onConfirm={() => {
          setConfirmDeleteOpen(false);
          void handleDelete();
        }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
      <ConfirmDialog
        open={confirmResetOpen}
        title={i18n.nodeDetail.dialogs.resetTitle}
        message={i18n.nodeDetail.dialogs.resetMessage}
        confirmLabel={i18n.nodeDetail.actions.resetSecret}
        cancelLabel={i18n.common.cancel}
        variant="danger"
        onConfirm={() => {
          setConfirmResetOpen(false);
          void handleReset();
        }}
        onCancel={() => setConfirmResetOpen(false)}
      />

      {resetResult ? (
        <div className="overflow-hidden rounded-xl border border-red-500/20 bg-red-500/5">
          <div className="flex items-center justify-between border-b border-red-500/20 px-5 py-3">
            <span className="text-xs font-bold text-red-400">
              {i18n.nodeDetail.resetSecretTitle} - {i18n.nodeDetail.resetSecretNote}
            </span>
            <button
              type="button"
              onClick={() => setResetResult(null)}
              className="text-red-400 hover:text-white"
            >
              ✕
            </button>
          </div>
          <div className="p-4">
            <CodeBlock label=".env" value={resetResult.onboarding.env_template} maxHeight={200} />
          </div>
        </div>
      ) : null}

      <HeroSummary
        node={currentNode}
        busy={busy}
        tab={tab}
        onTabChange={setTab}
        onResetSecret={() => setConfirmResetOpen(true)}
        onDelete={() => setConfirmDeleteOpen(true)}
        onToggleEnabled={() => setConfirmToggleOpen(true)}
        onRefreshFingerprint={handleRefreshFingerprint}
      />

      {tab === "monitor" ? (
        <MonitorPanel
          nodeId={nodeId}
          cpu={cpu}
          memory={memory}
          pythonEnv={pythonEnv}
          gpus={gpus}
          cpuUse={cpuUse}
          memUse={memUse}
          latestStatus={latestStatus}
          showJson={showJson}
          setShowJson={setShowJson}
        />
      ) : null}
      {tab === "config" ? (
        <ConfigPanel
          node={currentNode}
          editForm={editForm}
          updateEdit={updateEdit}
          editError={editError}
          saving={saving}
          handleSave={handleSave}
        />
      ) : null}
      {tab === "tasks" ? (
        <TasksPanel node={currentNode} canDispatch={canDispatch} recentTasks={recentTasks} />
      ) : null}
    </div>
  );
}
