import {
  connectionLabel,
  connectionTone,
  onboardingLabel,
  onboardingTone,
} from "../../../../lib/labels";
import { formatRelative } from "../../../../lib/format";
import { i18n } from "../../../../lib/i18n";
import type { NodeResponse } from "../../../../types";
import { StatusPill } from "../../../../ui/StatusPill";
import type { NodeDetailTabKey } from "../types";

type Props = {
  node: NodeResponse;
  busy: boolean;
  tab: NodeDetailTabKey;
  onTabChange: (tab: NodeDetailTabKey) => void;
  onResetSecret: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  onRefreshFingerprint: () => void;
};

const tabs: Array<{ id: NodeDetailTabKey; label: string }> = [
  { id: "monitor", label: i18n.nodeDetail.tabs.monitor },
  { id: "config", label: i18n.nodeDetail.tabs.config },
  { id: "tasks", label: i18n.nodeDetail.tabs.tasks },
];

export function HeroSummary({
  node,
  busy,
  tab,
  onTabChange,
  onResetSecret,
  onDelete,
  onToggleEnabled,
  onRefreshFingerprint,
}: Props): JSX.Element {
  return (
    <>
      {/* 页头 — 直接坐在页面背景上, 没有任何卡片边框. 用底部细线分区 */}
      <div className="relative -mx-1 border-b border-white/[0.06] pb-7">
        <div className="flex flex-col items-start justify-between gap-5 lg:flex-row lg:gap-8">
          <div className="flex min-w-0 items-start gap-5">
            <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-[#0c0f14]">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-cyan-400"
              >
                <path d="M4 17l6-6-6-6" />
                <path d="M12 19h8" />
              </svg>
              <div className="absolute -right-0.5 -bottom-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#07080A]">
                <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[clamp(20px,4vw,32px)] leading-tight font-bold text-white">
                  {node.display_name}
                </h1>
                <StatusPill
                  tone={connectionTone[node.connection_status]}
                  label={connectionLabel[node.connection_status]}
                  pulse={node.connection_status === "online"}
                />
                <StatusPill
                  tone={onboardingTone[node.onboarding_status]}
                  label={onboardingLabel[node.onboarding_status]}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[clamp(11px,2.4vw,14px)] text-gray-500">
                <span className="font-mono">{node.node_id}</span>
                <span className="text-white/15">·</span>
                <span>{node.hostname ?? i18n.common.dash}</span>
                <span className="text-white/15">·</span>
                <span>心跳 {node.heartbeat_interval_sec}s</span>
                {node.last_seen_at ? (
                  <>
                    <span className="text-white/15">·</span>
                    <span>最近 {formatRelative(node.last_seen_at)}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {/* 按钮组 — Linear 风格: 同尺寸 segmented 容器 + 实色边框, resting 必须看得见按钮形状 */}
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onRefreshFingerprint}
              disabled={busy}
              className="rounded-lg border border-white/[0.08] bg-white/[0.025] px-3.5 py-2 text-[12.5px] font-medium text-gray-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all hover:border-cyan-400/35 hover:bg-cyan-400/[0.08] hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {i18n.nodeDetail.actions.refreshFingerprint}
            </button>
            <button
              type="button"
              onClick={onResetSecret}
              disabled={busy}
              className="rounded-lg border border-white/[0.08] bg-white/[0.025] px-3.5 py-2 text-[12.5px] font-medium text-gray-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all hover:border-white/20 hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {i18n.nodeDetail.actions.resetSecret}
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="rounded-lg border border-white/[0.08] bg-white/[0.025] px-3.5 py-2 text-[12.5px] font-medium text-gray-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all hover:border-red-500/40 hover:bg-red-500/[0.10] hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {i18n.nodeDetail.actions.deleteNode}
            </button>

            {/* CTA — 主操作, 颜色和上面三个明显区分 */}
            <button
              type="button"
              onClick={onToggleEnabled}
              disabled={busy}
              className={`ml-2 rounded-lg border px-4 py-2 text-[12.5px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                node.is_enabled
                  ? "border-red-500/45 bg-red-500/[0.14] text-red-200 hover:border-red-500/65 hover:bg-red-500/[0.22] hover:text-red-100 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_16px_-4px_rgba(248,81,73,0.45)]"
                  : "border-emerald-500/45 bg-emerald-500/[0.14] text-emerald-200 hover:border-emerald-500/65 hover:bg-emerald-500/[0.22] hover:text-emerald-100 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_16px_-4px_rgba(16,185,129,0.45)]"
              }`}
            >
              {node.is_enabled
                ? i18n.nodeDetail.actions.disableNode
                : i18n.nodeDetail.actions.enableNode}
            </button>
          </div>
        </div>

        {/* 下划线 Tab 条 — 贴底部边线, 拉大间距让每个 tab 真的像独立按钮 */}
        <div className="mt-8 -mb-[1px] flex items-center gap-6">
          {tabs.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={`relative pt-1 pb-3.5 text-[13.5px] font-semibold transition-colors ${
                  active ? "text-white" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {item.label}
                {active ? (
                  <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-t-full bg-gradient-to-r from-cyan-400 to-emerald-400 shadow-[0_0_10px_rgba(15,240,179,0.5)]" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
