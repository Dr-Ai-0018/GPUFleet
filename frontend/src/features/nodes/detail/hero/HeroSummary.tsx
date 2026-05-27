import { connectionLabel, connectionTone, onboardingLabel, onboardingTone } from "../../../../lib/labels";
import { formatRelative } from "../../../../lib/format";
import { i18n } from "../../../../lib/i18n";
import type { NodeResponse } from "../../../../types";
import { StatusPill } from "../../../../ui/StatusPill";
import type { NodeDetailTabKey } from "../types";
import { cardCls } from "../shared";

type Props = {
  node: NodeResponse;
  busy: boolean;
  tab: NodeDetailTabKey;
  onTabChange: (tab: NodeDetailTabKey) => void;
  onResetSecret: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
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
}: Props): JSX.Element {
  return (
    <>
      <div className={`${cardCls} relative overflow-hidden px-6 py-7`}>
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-[radial-gradient(ellipse_at_right,_var(--tw-gradient-stops))] from-cyan-950/20 to-transparent pointer-events-none" />
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-start gap-5">
            <div className="relative flex h-14 w-14 items-center justify-center rounded-xl border border-white/5 bg-[#0F1116]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-cyan-400"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>
              <div className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#07080A]">
                <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-white">{node.display_name}</h1>
                <StatusPill tone={connectionTone[node.connection_status]} label={connectionLabel[node.connection_status]} pulse={node.connection_status === "online"} />
                <StatusPill tone={onboardingTone[node.onboarding_status]} label={onboardingLabel[node.onboarding_status]} />
              </div>
              <div className="flex items-center gap-5 text-[12px] text-gray-500">
                <span className="font-mono">{node.node_id}</span>
                <span>{node.hostname ?? i18n.common.dash}</span>
                <span>心跳 {node.heartbeat_interval_sec}s</span>
                {node.last_seen_at ? <span>最近 {formatRelative(node.last_seen_at)}</span> : null}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onResetSecret} disabled={busy} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[12px] font-medium text-white transition-all hover:bg-white/10 disabled:opacity-40">{i18n.nodeDetail.actions.resetSecret}</button>
            <button type="button" onClick={onDelete} disabled={busy} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[12px] font-medium text-white transition-all hover:bg-white/10 disabled:opacity-40">{i18n.nodeDetail.actions.deleteNode}</button>
            <button type="button" onClick={onToggleEnabled} disabled={busy} className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-[12px] font-medium text-red-400 transition-all hover:bg-red-500/20 disabled:opacity-40">{node.is_enabled ? i18n.nodeDetail.actions.disableNode : i18n.nodeDetail.actions.enableNode}</button>
          </div>
        </div>
      </div>

      <div className="flex gap-2 rounded-lg border border-white/5 bg-[#090A0D] p-1.5">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onTabChange(item.id)}
            className={`flex-1 rounded-md px-4 py-2.5 text-center text-[13px] font-bold transition-all ${tab === item.id ? "bg-white/10 text-white shadow-md" : "text-gray-400 hover:text-white"}`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
