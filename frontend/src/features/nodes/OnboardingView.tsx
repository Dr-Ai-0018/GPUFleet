import { useMemo, useState } from "react";
import { useConsoleStore } from "../../state/ConsoleStore";
import { navigate } from "../../lib/routing";
import type { NodeCreateResponse } from "../../types";
import { NodeCreatePanel } from "./NodeCreatePanel";
import { OnboardingPackagePanel } from "./OnboardingPackagePanel";
import { StatusPill } from "../../ui/StatusPill";
import { Button } from "../../ui/Button";
import { connectionLabel, connectionTone, onboardingLabel, onboardingTone } from "../../lib/labels";
import { formatRelative } from "../../lib/format";

export function OnboardingView(): JSX.Element {
  const store = useConsoleStore();
  const [pkg, setPkg] = useState<NodeCreateResponse | null>(store.recentOnboarding);

  const awaiting = useMemo(
    () => store.nodes.filter((node) => node.onboarding_status === "awaiting_first_heartbeat"),
    [store.nodes],
  );

  const total = store.nodes.length;
  const online = store.nodes.filter((n) => n.connection_status === "online").length;
  const stage: 1 | 2 | 3 = !pkg ? 1 : awaiting.some((n) => n.node_id === pkg.node_id) ? 2 : 3;

  return (
    <div className="max-w-[1300px] mx-auto space-y-8">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white mb-1">Node Onboarding <span className="text-gray-400 font-normal">(接入向导)</span></h1>
          <p className="text-sm text-gray-500">注册、配置、生成接入密钥，并快速激活您的物理/虚拟算力单元。</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>● {total} 节点</span>
          <span className="text-emerald-400">● {online} 在线</span>
          <span className="text-amber-400">● {awaiting.length} 待接入</span>
        </div>
      </div>

      {/* Stepper — flat, no card wrapping */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { step: "01", title: "登记注册节点", desc: "设定名称和系统参数", active: stage === 1, done: stage > 1 },
          { step: "02", title: "部署本地接入包", desc: "安装并配置 daemon", active: stage === 2, done: stage > 2 },
          { step: "03", title: "验证心跳上线", desc: "首次检测心跳并纳管", active: stage === 3, done: false },
        ].map((s, idx) => (
          <div key={idx} className={`p-5 rounded-xl border-2 transition-all ${
            s.active ? "bg-cyan-950/15 border-cyan-500/40" : s.done ? "bg-emerald-950/10 border-emerald-500/20" : "bg-white/[0.01] border-white/5"
          }`}>
            <div className="text-[10px] font-mono font-bold tracking-wider text-gray-500 mb-2">Step {s.step}</div>
            <div className="text-[14px] font-bold text-white mb-1">{s.title}</div>
            <div className="text-[12px] text-gray-500">{s.desc}</div>
          </div>
        ))}
      </div>

      {/* Form + Package — NO nested cards, flat layout */}
      <div className="grid grid-cols-[2fr_1fr] gap-8 items-start">
        {/* Left: form directly, no card wrapper */}
        <div>
          <div className="text-[13px] font-bold uppercase tracking-wider text-cyan-400 mb-6 font-mono">Register Configuration</div>
          <NodeCreatePanel onCreated={(p) => { setPkg(p); store.setRecentOnboarding(p); }} />
        </div>

        {/* Right: deploy info */}
        <div className="space-y-4">
          <div className="text-[14px] font-bold text-white mb-2">部署指令与包</div>
          <p className="text-[12px] text-gray-500 leading-relaxed">在左侧提交节点注册后，系统将自动生成一段内网一键拉取指令。您在节点物理机执行该脚本即可完成部署。</p>
          {pkg ? (
            <OnboardingPackagePanel pkg={pkg} />
          ) : (
            <div className="py-16 text-center text-gray-600 border border-dashed border-white/10 rounded-xl bg-black/20 flex flex-col items-center justify-center gap-3">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-30"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
              <span className="text-[12px]">等待节点登记完成...</span>
            </div>
          )}
        </div>
      </div>

      {/* Awaiting table — flat, no card */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-[14px] font-bold text-white">待首次心跳</h2>
          <span className="text-[12px] text-gray-500 font-mono">{awaiting.length}</span>
        </div>
        {awaiting.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-gray-600 border border-dashed border-white/5 rounded-xl">当前没有待接入节点</div>
        ) : (
          <div className="rounded-xl overflow-hidden border border-[var(--card-border)] bg-[var(--surface-card)]">
            <table className="w-full text-left text-[13px]">
              <thead className="text-gray-500 text-[11px] font-mono uppercase tracking-wider border-b border-white/5">
                <tr><th className="px-5 py-3">节点</th><th className="px-5 py-3">接入状态</th><th className="px-5 py-3">连接</th><th className="px-5 py-3">登记时间</th><th className="px-5 py-3">心跳</th><th className="px-5 py-3"></th></tr>
              </thead>
              <tbody>
                {awaiting.map((node) => (
                  <tr key={node.node_id} className="hover:bg-white/[0.02] transition-colors border-b border-white/[0.03] last:border-0">
                    <td className="px-5 py-3.5"><div className="font-medium text-white">{node.display_name}</div><div className="text-[11px] text-gray-500 font-mono">{node.node_id}</div></td>
                    <td className="px-5 py-3.5"><StatusPill tone={onboardingTone[node.onboarding_status]} label={onboardingLabel[node.onboarding_status]} pulse /></td>
                    <td className="px-5 py-3.5"><StatusPill tone={connectionTone[node.connection_status]} label={connectionLabel[node.connection_status]} /></td>
                    <td className="px-5 py-3.5 text-gray-500 font-mono text-[12px]">{formatRelative(node.created_at)}</td>
                    <td className="px-5 py-3.5 text-gray-500 font-mono text-[12px]">{node.heartbeat_interval_sec}s</td>
                    <td className="px-5 py-3.5"><button type="button" onClick={() => navigate({ name: "node-detail", nodeId: node.node_id })} className="text-[11px] text-cyan-400 hover:text-white">详情</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
