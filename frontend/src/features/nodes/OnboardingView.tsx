import { useMemo, useState } from "react";
import { useConsoleStore } from "../../state/ConsoleStore";
import { navigate } from "../../lib/routing";
import type { NodeCreateResponse } from "../../types";
import { NodeCreatePanel } from "./NodeCreatePanel";
import { OnboardingPackagePanel } from "./OnboardingPackagePanel";
import { formatRelative } from "../../lib/format";
import { nodeTypeLabel, osLabel } from "../../lib/labels";

type StageId = 1 | 2 | 3;

const STAGES: Array<{ id: StageId; label: string; sub: string }> = [
  { id: 1, label: "登记节点", sub: "填表生成 token + 安装包" },
  { id: 2, label: "部署接入包", sub: "在节点机执行启动命令" },
  { id: 3, label: "验证心跳", sub: "首次心跳上线即纳管" },
];

export function OnboardingView(): JSX.Element {
  const store = useConsoleStore();
  const [pkg, setPkg] = useState<NodeCreateResponse | null>(store.recentOnboarding);

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
                  return (
                    <tr
                      key={node.node_id}
                      onClick={() => navigate({ name: "node-detail", nodeId: node.node_id })}
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
                        <span className="text-[11.5px] text-cyan-300 transition-colors group-hover:text-cyan-200">
                          查看详情 →
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* TODO[🅲]: 等天云的 GET /admin/nodes/{id}/onboarding + POST .../regenerate
              合上来后, 把这里改成可展开行: 展开看 install snippet + env_template + token 状态,
              加 "重发安装包" 按钮 (对 isStale 节点尤其有用) */}
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
