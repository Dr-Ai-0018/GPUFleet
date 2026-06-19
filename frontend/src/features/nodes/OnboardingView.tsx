import { useCallback, useMemo, useState } from "react";
import { api } from "../../api";
import { useConsoleStore } from "../../state/ConsoleStore";
import type { NodeCreateResponse, NodeOnboardingLifecycleResponse } from "../../types";
import { NodeCreatePanel } from "./NodeCreatePanel";
import { OnboardingPackagePanel } from "./OnboardingPackagePanel";
import { CodeBlock } from "../../ui/CodeBlock";
import { KpiTile } from "../../ui/KpiTile";
import { LinearStepper } from "../../ui/LinearStepper";
import { useToast } from "../../ui/Toast";
import { formatRelative, formatTime } from "../../lib/format";
import { labelForError, nodeTypeLabel, osLabel } from "../../lib/labels";

type StageId = 1 | 2 | 3;

const STAGES = [
  { id: 1 as StageId, label: "登记节点", sub: "填表生成 token + 安装包" },
  { id: 2 as StageId, label: "部署接入包", sub: "在节点机执行启动命令" },
  { id: 3 as StageId, label: "验证心跳", sub: "首次心跳上线即纳管" },
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
        setLifecycleErrorByNode((s) => ({ ...s, [nodeId]: labelForError(err, "加载失败") }));
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

      {/* ───── KPI 卡片 (独立卡 + gap + 底部波浪装饰, 取浅色参考图精华移植深底) ───── */}
      <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile
          label="总节点"
          value={totalNodes}
          sublabel="Fleet nodes"
          icon={<IconServer />}
        />
        <KpiTile
          label="在线"
          value={onlineNodes}
          tone="online"
          active={onlineNodes > 0}
          sublabel={totalNodes > 0 ? `${Math.round((onlineNodes / totalNodes) * 100)}% 可用` : "—"}
          icon={<IconPulse />}
        />
        <KpiTile
          label="待接入"
          value={awaitingCount}
          tone="waiting"
          active={awaitingCount > 0}
          sublabel={awaitingCount > 0 ? "等待首次心跳" : "全部已上线"}
          icon={<IconHourglass />}
        />
      </div>

      {/* ───── Stepper (Stripe / Linear 线性 stepper, 不再是 3 个独立发光卡片) ───── */}
      <div className="mb-12">
        <LinearStepper stages={STAGES} currentStage={currentStage} />
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
              <div
                className="rounded-[10px] border px-6 py-14 text-center"
                style={{
                  backgroundColor: "#0a0d12",
                  backgroundImage: "var(--surface-grad)",
                  borderColor: "rgba(255,255,255,0.05)",
                }}
              >
                {/* icon 在 tone 软方框里 (跟 KpiTile icon 同款语言) */}
                <div
                  className="mx-auto flex h-10 w-10 items-center justify-center rounded-[8px] text-[var(--c-running-soft-text)]"
                  style={{ backgroundColor: "var(--tone-soft-bg-cyan)" }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                  </svg>
                </div>
                <div className="mt-4 text-[13px] font-medium tracking-[-0.005em] text-gray-200">等待登记完成</div>
                <div className="mt-1.5 text-[11.5px] leading-[1.6] text-gray-500">
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

// ─── KPI 行的 icon — 16x16 mono SVG, 颜色由父级 currentColor 决定 ───

function IconServer(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
      <line x1="7" y1="17" x2="7.01" y2="17" />
    </svg>
  );
}

function IconPulse(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 12 7 12 10 5 14 19 17 12 21 12" />
    </svg>
  );
}

function IconHourglass(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12" />
      <path d="M6 21h12" />
      <path d="M6 3v3a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3" />
      <path d="M6 21v-3a6 6 0 0 1 6-6 6 6 0 0 1 6 6v3" />
    </svg>
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
