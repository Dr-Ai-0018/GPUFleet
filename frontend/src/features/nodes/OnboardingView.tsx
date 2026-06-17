import { useCallback, useMemo, useState } from "react";
import { api, ApiError } from "../../api";
import { useConsoleStore } from "../../state/ConsoleStore";
import type { NodeCreateResponse, NodeOnboardingLifecycleResponse } from "../../types";
import { NodeCreatePanel } from "./NodeCreatePanel";
import { OnboardingPackagePanel } from "./OnboardingPackagePanel";
import { CodeBlock } from "../../ui/CodeBlock";
import { useToast } from "../../ui/Toast";
import { formatRelative, formatTime } from "../../lib/format";
import { labelForError, nodeTypeLabel, osLabel } from "../../lib/labels";

type StageId = 1 | 2 | 3;

const STAGES: Array<{ id: StageId; label: string; sub: string }> = [
  { id: 1, label: "登记节点", sub: "填表生成 token + 安装包" },
  { id: 2, label: "部署接入包", sub: "在节点机执行启动命令" },
  { id: 3, label: "验证心跳", sub: "首次心跳上线即纳管" },
];

export function OnboardingView(): JSX.Element {
  const store = useConsoleStore();
  const toast = useToast();
  const [pkg, setPkg] = useState<NodeCreateResponse | null>(store.recentOnboarding);
  // 待接入行展开 + lifecycle 缓存
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const [lifecycleByNode, setLifecycleByNode] = useState<Record<string, NodeOnboardingLifecycleResponse>>({});
  const [lifecycleLoadingByNode, setLifecycleLoadingByNode] = useState<Record<string, boolean>>({});
  const [lifecycleErrorByNode, setLifecycleErrorByNode] = useState<Record<string, string>>({});
  const [regeneratingByNode, setRegeneratingByNode] = useState<Record<string, boolean>>({});

  const awaiting = useMemo(
    () => store.nodes.filter((node) => node.onboarding_status === "awaiting_first_heartbeat"),
    [store.nodes],
  );

  const totalNodes = store.nodes.length;
  const onlineNodes = store.nodes.filter((n) => n.connection_status === "online").length;
  const awaitingCount = awaiting.length;

  // 流程阶段:刚进来 stage=1; 创建完包 stage=2; 创建完且对应 node 已心跳(从 awaiting 消失)stage=3
  const currentStage: StageId = !pkg
    ? 1
    : awaiting.some((n) => n.node_id === pkg.node_id)
      ? 2
      : 3;

  // 懒加载单个节点的 lifecycle 包 (展开行时触发, 已缓存就不重拉)
  const ensureLifecycle = useCallback(
    async (nodeId: string, force = false) => {
      if (!store.token) return;
      if (!force && lifecycleByNode[nodeId]) return;
      setLifecycleLoadingByNode((s) => ({ ...s, [nodeId]: true }));
      setLifecycleErrorByNode((s) => ({ ...s, [nodeId]: "" }));
      try {
        const data = await api.getNodeOnboarding(store.token, nodeId);
        setLifecycleByNode((s) => ({ ...s, [nodeId]: data }));
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "加载失败";
        setLifecycleErrorByNode((s) => ({ ...s, [nodeId]: msg }));
      } finally {
        setLifecycleLoadingByNode((s) => ({ ...s, [nodeId]: false }));
      }
    },
    [store.token, lifecycleByNode],
  );

  // 重发安装包 — 轮换签名 key + token, 返回新 snippet
  const handleRegenerate = useCallback(
    async (nodeId: string) => {
      if (!store.token) return;
      setRegeneratingByNode((s) => ({ ...s, [nodeId]: true }));
      try {
        const data = await api.regenerateNodeOnboarding(store.token, nodeId);
        setLifecycleByNode((s) => ({ ...s, [nodeId]: data }));
        toast.push({
          tone: "success",
          title: "已重发安装包",
          description: "token 与签名 key 已轮换,旧 token 即刻失效",
        });
      } catch (err) {
        toast.push({
          tone: "error",
          title: "重发失败",
          description: labelForError(err, ""),
        });
      } finally {
        setRegeneratingByNode((s) => ({ ...s, [nodeId]: false }));
      }
    },
    [store.token, toast],
  );

  const handleToggleExpand = useCallback(
    (nodeId: string) => {
      const willOpen = expandedNodeId !== nodeId;
      setExpandedNodeId(willOpen ? nodeId : null);
      if (willOpen) void ensureLifecycle(nodeId);
    },
    [expandedNodeId, ensureLifecycle],
  );

  return (
    <div className="py-2">
      {/* ───── Page header ───── */}
      <header className="mb-8 flex items-baseline justify-between gap-6 border-b border-white/[0.045] pb-6">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-white">节点接入</h2>
          <p className="mt-1.5 text-[13px] leading-6 text-gray-500">
            向 Fleet 登记新算力节点 — 三步:登记 → 部署接入包 → 验证心跳上线。
          </p>
        </div>
      </header>

      {/* ───── KPI strip ───── */}
      <div className="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <KpiTile
          label="总节点"
          value={totalNodes}
          dotCls="bg-gray-500"
          textCls="text-white"
        />
        <KpiTile
          label="在线"
          value={onlineNodes}
          dotCls="bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.55)]"
          textCls="text-emerald-300"
        />
        <KpiTile
          label="待接入"
          value={awaitingCount}
          dotCls={awaitingCount > 0 ? "bg-amber-400 shadow-[0_0_6px_rgba(245,176,64,0.55)]" : "bg-gray-600"}
          textCls={awaitingCount > 0 ? "text-amber-300" : "text-gray-400"}
        />
      </div>

      {/* ───── Stepper (横向流程) ───── */}
      <div className="mb-10 flex items-center gap-2">
        {STAGES.map((s, idx) => {
          const isDone = currentStage > s.id;
          const isActive = currentStage === s.id;
          return (
            <div key={s.id} className="flex flex-1 items-center gap-2">
              <div
                className={`flex-1 rounded-md border px-4 py-3 transition-all ${
                  isActive
                    ? "border-cyan-400/40 bg-cyan-500/[0.06]"
                    : isDone
                      ? "border-emerald-400/25 bg-emerald-500/[0.04]"
                      : "border-white/[0.05] bg-[#0b0e13]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <StageBadge id={s.id} isActive={isActive} isDone={isDone} />
                  <span
                    className={`text-[13px] font-medium ${
                      isActive ? "text-cyan-200" : isDone ? "text-emerald-200" : "text-gray-300"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                <div className="mt-1 pl-7 text-[11.5px] text-gray-500">{s.sub}</div>
              </div>
              {idx < STAGES.length - 1 ? (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={`shrink-0 ${isDone ? "text-emerald-400/60" : "text-gray-700"}`}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* ───── 主区: 登记表单 + 接入包 ───── */}
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* 左: 登记表单 */}
        <section>
          <SectionHeading title="登记新节点" sub="填写基本信息,后端生成 NODE_SECRET 与安装包" />
          <div className="mt-5">
            <NodeCreatePanel
              onCreated={(p) => {
                setPkg(p);
                store.setRecentOnboarding(p);
              }}
            />
          </div>
        </section>

        {/* 右: 接入包 / 等待提示 */}
        <section>
          <SectionHeading
            title="部署指令与包"
            sub={pkg ? "在节点机执行 startup 命令,等待首次心跳" : "登记后此处会出现 .env 模板与启动命令"}
          />
          <div className="mt-5">
            {pkg ? (
              <OnboardingPackagePanel pkg={pkg} />
            ) : (
              <div className="rounded-md border border-dashed border-white/[0.07] bg-[#0a0d12] px-6 py-14 text-center">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="mx-auto text-gray-700"
                >
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                </svg>
                <div className="mt-3 text-[12.5px] font-medium text-gray-400">等待登记完成</div>
                <div className="mt-1 text-[11.5px] text-gray-600">
                  左侧表单提交后,这里生成可复制的安装命令与 .env 模板
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ───── 待接入节点列表 ───── */}
      <section className="mt-12 border-t border-white/[0.045] pt-10">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <div>
            <h3 className="text-[14px] font-semibold text-white">待首次心跳</h3>
            <p className="mt-1 text-[12px] leading-5 text-gray-500">
              已登记但尚未上线的节点 — 在节点机上执行 startup 命令即可激活。
            </p>
          </div>
          <span className="font-mono text-[11.5px] text-gray-500">
            {awaitingCount === 0 ? "0 个" : `${awaitingCount} 个等待中`}
          </span>
        </div>

        {awaiting.length === 0 ? (
          <div className="rounded-md border border-dashed border-white/[0.06] bg-[#0a0d12] px-6 py-12 text-center">
            <div className="text-[13px] font-medium text-gray-300">所有节点都已上线</div>
            <div className="mt-1.5 text-[12px] text-gray-500">没有等待首次心跳的节点</div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-white/[0.05]">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-white/[0.05] bg-white/[0.015] text-[11px] text-gray-500">
                  <th className="px-4 py-2.5 font-normal">节点</th>
                  <th className="px-4 py-2.5 font-normal">类型</th>
                  <th className="px-4 py-2.5 font-normal">心跳</th>
                  <th className="px-4 py-2.5 font-normal">等待时长</th>
                  <th className="px-4 py-2.5 text-right font-normal">动作</th>
                </tr>
              </thead>
              <tbody>
                {awaiting.map((node) => {
                  const waitedMs = Date.now() - new Date(node.created_at).getTime();
                  const isStale = waitedMs > 24 * 3600 * 1000; // > 24h 视为长期未上线
                  const isOpen = expandedNodeId === node.node_id;
                  const lifecycle = lifecycleByNode[node.node_id] ?? null;
                  const lifecycleLoading = lifecycleLoadingByNode[node.node_id] ?? false;
                  const lifecycleError = lifecycleErrorByNode[node.node_id] ?? "";
                  const regenerating = regeneratingByNode[node.node_id] ?? false;
                  return (
                    <FragmentRows key={node.node_id}>
                      <tr
                        onClick={() => handleToggleExpand(node.node_id)}
                        className="group cursor-pointer border-b border-white/[0.03] transition-colors last:border-0 hover:bg-white/[0.02]"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className="relative h-2 w-2 shrink-0">
                              <span className="absolute inset-0 animate-ping rounded-full bg-amber-400/60" />
                              <span className="absolute inset-0 rounded-full bg-amber-400" />
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-[13px] font-medium text-gray-200 transition-colors group-hover:text-white">
                                {node.display_name}
                              </div>
                              <div className="mt-0.5 truncate font-mono text-[10.5px] text-gray-600">
                                {node.node_id}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-[12.5px] text-gray-300">
                            {nodeTypeLabel[node.node_type] ?? node.node_type}
                          </div>
                          {node.os_type ? (
                            <div className="mt-0.5 text-[11px] text-gray-600">
                              {osLabel[node.os_type] ?? node.os_type}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11.5px] text-gray-500">
                          ↻ {node.heartbeat_interval_sec}s
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] ${
                              isStale
                                ? "border-red-400/25 bg-red-400/[0.06] text-red-300"
                                : "border-amber-400/25 bg-amber-400/[0.06] text-amber-300"
                            }`}
                            title={`登记时间 ${formatRelative(node.created_at)}`}
                          >
                            ⏱ {formatRelative(node.created_at)}
                          </span>
                          {isStale ? (
                            <div className="mt-1 text-[10.5px] text-red-400/80">超 24h 未上线</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <svg
                            width="14" height="14" viewBox="0 0 24 24"
                            fill="none" stroke="currentColor" strokeWidth="2"
                            className={`inline-block text-gray-600 transition-all group-hover:text-gray-300 ${isOpen ? "rotate-90 text-cyan-300" : ""}`}
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="border-b border-white/[0.03] bg-white/[0.012]">
                          <td colSpan={5} className="px-4 py-4">
                            <OnboardingDetail
                              nodeId={node.node_id}
                              lifecycle={lifecycle}
                              loading={lifecycleLoading}
                              error={lifecycleError}
                              regenerating={regenerating}
                              onRegenerate={() => void handleRegenerate(node.node_id)}
                              onRetry={() => void ensureLifecycle(node.node_id, true)}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </FragmentRows>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      </section>
    </div>
  );
}

// ─────────────────────── 内部子组件 ───────────────────────

function SectionHeading({ title, sub }: { title: string; sub: string }): JSX.Element {
  return (
    <div>
      <h3 className="text-[14px] font-semibold text-white">{title}</h3>
      <p className="mt-1 text-[12px] leading-5 text-gray-500">{sub}</p>
    </div>
  );
}

function KpiTile({
  label,
  value,
  dotCls,
  textCls,
}: {
  label: string;
  value: number;
  dotCls: string;
  textCls: string;
}): JSX.Element {
  return (
    <div className="rounded-md border border-white/[0.05] bg-[#0b0e13] px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />
        <span className="text-[11.5px] font-medium text-gray-400">{label}</span>
      </div>
      <div className={`mt-2 text-[24px] font-semibold tracking-tight tabular-nums ${textCls}`}>
        {value}
      </div>
    </div>
  );
}

function StageBadge({
  id,
  isActive,
  isDone,
}: {
  id: StageId;
  isActive: boolean;
  isDone: boolean;
}): JSX.Element {
  if (isDone) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/[0.15] text-emerald-300">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }
  if (isActive) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-500/[0.15] font-mono text-[10px] font-semibold text-cyan-200 shadow-[0_0_8px_rgba(6,182,212,0.35)]">
        {id}
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.02] font-mono text-[10px] font-semibold text-gray-600">
      {id}
    </span>
  );
}

// React 不允许 tbody 内裸 fragment 在某些版本有警告; 包一层壳子
function FragmentRows({ children }: { children: React.ReactNode }): JSX.Element {
  return <>{children}</>;
}

/** 待接入节点行的展开内容: token 状态徽章 + env_template + install_snippet + 重发按钮 */
function OnboardingDetail({
  nodeId,
  lifecycle,
  loading,
  error,
  regenerating,
  onRegenerate,
  onRetry,
}: {
  nodeId: string;
  lifecycle: NodeOnboardingLifecycleResponse | null;
  loading: boolean;
  error: string;
  regenerating: boolean;
  onRegenerate: () => void;
  onRetry: () => void;
}): JSX.Element {
  if (loading && !lifecycle) {
    return (
      <div className="py-6 text-center text-[12px] text-gray-500">
        加载 onboarding 包…
      </div>
    );
  }
  if (error && !lifecycle) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-red-400/25 bg-red-400/[0.05] px-3 py-2.5">
        <span className="text-[12px] text-red-300">{error}</span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-white/[0.1] bg-white/[0.04] px-2.5 py-1 text-[11.5px] text-gray-300 hover:bg-white/[0.08]"
        >
          重试
        </button>
      </div>
    );
  }
  if (!lifecycle) return <div />;

  const status = lifecycle.token_status;
  const statusTone =
    status === "active"
      ? { dot: "bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.55)]", text: "text-emerald-300", border: "border-emerald-400/30 bg-emerald-400/[0.06]", label: "token 有效" }
      : status === "expired"
        ? { dot: "bg-red-400", text: "text-red-300", border: "border-red-400/30 bg-red-400/[0.06]", label: "token 已过期" }
        : { dot: "bg-gray-500", text: "text-gray-400", border: "border-gray-500/30 bg-white/[0.025]", label: "token 已使用 (节点已上线)" };

  return (
    <div className="space-y-3">
      {/* 状态行 + 重发按钮 */}
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-[11.5px] ${statusTone.border} ${statusTone.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${statusTone.dot}`} />
          {statusTone.label}
        </span>
        {lifecycle.token_expires_at ? (
          <span className="text-[11px] text-gray-500" title={formatTime(lifecycle.token_expires_at)}>
            过期于 {formatRelative(lifecycle.token_expires_at)}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerating}
          className="ml-auto rounded-md border border-cyan-400/40 bg-cyan-500/[0.10] px-3 py-1.5 text-[11.5px] font-medium text-cyan-200 transition-all hover:border-cyan-400/60 hover:bg-cyan-500/[0.18] hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
          title="轮换 token + 签名 key, 旧 token 即刻失效"
        >
          {regenerating ? "重发中…" : status === "consumed" ? "重发安装包 (重置)" : "重发安装包"}
        </button>
      </div>

      {/* consumed 节点提示 */}
      {status === "consumed" ? (
        <div className="rounded-md border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2 text-[11.5px] text-amber-200/90">
          ⚠ 节点已上线 — 重发会轮换签名 key, 旧 agent 失效, 你需要重新部署接入包.
        </div>
      ) : null}

      {/* env_template + install_snippet */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <CodeBlock label=".env 模板" value={lifecycle.env_template} maxHeight={240} />
        <CodeBlock label={`安装命令 · ${nodeId}`} value={lifecycle.install_snippet} maxHeight={240} />
      </div>
    </div>
  );
}
