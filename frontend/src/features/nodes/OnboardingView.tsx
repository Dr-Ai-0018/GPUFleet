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

const cardCls = "rounded-xl p-5 transition-all duration-300 bg-[linear-gradient(180deg,rgba(16,18,23,0.95)_0%,rgba(10,11,14,0.98)_100%)] border border-white/[0.04] shadow-[0_4px_20px_-2px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.03)] hover:border-white/[0.08]";

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
    <div className="max-w-[1000px] mx-auto space-y-8">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white font-mono mb-2">Node Onboarding (接入向导)</h1>
          <p className="text-xs text-gray-500">注册、配置、生成接入密钥，并快速激活您的物理/虚拟算力单元。</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>● {total} 节点</span>
          <span className="text-emerald-400">● {online} 在线</span>
          <span className="text-amber-400">● {awaiting.length} 待接入</span>
        </div>
      </div>

      {/* Stepper */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { step: "01", title: "登记注册节点", desc: "设定名称和系统参数", active: stage === 1, done: stage > 1 },
          { step: "02", title: "部署本地接入包", desc: "安装并配置 daemon", active: stage === 2, done: stage > 2 },
          { step: "03", title: "验证心跳上线", desc: "首次检测心跳并纳管", active: stage === 3, done: false },
        ].map((s, idx) => (
          <div key={idx} className={`p-4 rounded-xl border transition-all ${
            s.active ? "bg-cyan-950/20 border-cyan-500/30 text-white" : s.done ? "bg-emerald-950/10 border-emerald-500/20 text-emerald-400" : "bg-white/[0.01] border-white/5 text-gray-500"
          }`}>
            <div className="text-xs font-mono font-bold tracking-wider mb-1">Step {s.step}</div>
            <div className="text-[13px] font-bold text-gray-200">{s.title}</div>
            <div className="text-[11px] text-gray-500 mt-1">{s.desc}</div>
          </div>
        ))}
      </div>

      {/* Main content: form + package */}
      <div className="grid grid-cols-3 gap-6">
        <div className={`${cardCls} col-span-2`}>
          <div className="text-[13px] font-bold font-mono uppercase tracking-wider text-cyan-400 border-b border-white/5 pb-3 mb-5">Register Configuration</div>
          <NodeCreatePanel onCreated={(p) => { setPkg(p); store.setRecentOnboarding(p); }} />
        </div>

        <div className={`${cardCls} col-span-1 flex flex-col justify-between border-dashed border-white/10`}>
          <div>
            <div className="text-[13px] font-bold font-mono uppercase tracking-wider text-gray-400 mb-3">部署指令与包</div>
            <p className="text-xs text-gray-500 leading-relaxed">在右侧提交节点注册后，系统将自动生成一段内网一键拉取指令。您在节点物理机执行该脚本即可完成部署。</p>
          </div>
          {pkg ? (
            <OnboardingPackagePanel pkg={pkg} />
          ) : (
            <div className="py-12 text-center text-gray-600 border border-dashed border-white/5 rounded-lg bg-black/30 flex flex-col items-center justify-center gap-2 mt-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-40"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
              <span className="text-[11px] font-mono">等待节点登记完成...</span>
            </div>
          )}
        </div>
      </div>

      {/* Awaiting list */}
      <div className={`${cardCls} p-0`}>
        <div className="px-5 py-4 border-b border-white/5 flex justify-between items-center bg-[#090A0D]/50">
          <span className="text-[13px] font-bold tracking-wide text-gray-400 font-mono uppercase">待首次心跳</span>
          <span className="text-[11px] text-gray-500 font-mono">{awaiting.length}</span>
        </div>
        {awaiting.length === 0 ? (
          <div className="px-5 py-10 text-center text-xs text-gray-600 font-mono">当前没有待接入节点</div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-gray-500 font-mono uppercase tracking-wider border-b border-white/5 bg-[#090A0D]/20">
              <tr>
                <th className="px-5 py-3 font-medium">节点</th>
                <th className="px-5 py-3 font-medium">接入状态</th>
                <th className="px-5 py-3 font-medium">连接</th>
                <th className="px-5 py-3 font-medium">登记时间</th>
                <th className="px-5 py-3 font-medium">心跳</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {awaiting.map((node) => (
                <tr key={node.node_id} className="hover:bg-white/[0.01] transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-white">{node.display_name}</div>
                    <div className="text-[11px] text-gray-500 font-mono">{node.node_id}</div>
                  </td>
                  <td className="px-5 py-3.5"><StatusPill tone={onboardingTone[node.onboarding_status]} label={onboardingLabel[node.onboarding_status]} pulse /></td>
                  <td className="px-5 py-3.5"><StatusPill tone={connectionTone[node.connection_status]} label={connectionLabel[node.connection_status]} /></td>
                  <td className="px-5 py-3.5 font-mono text-gray-500">{formatRelative(node.created_at)}</td>
                  <td className="px-5 py-3.5 font-mono text-gray-500">{node.heartbeat_interval_sec}s</td>
                  <td className="px-5 py-3.5">
                    <button type="button" onClick={() => navigate({ name: "node-detail", nodeId: node.node_id })} className="text-[11px] text-cyan-400 hover:text-white transition-colors">详情</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
