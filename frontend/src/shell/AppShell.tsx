import { useEffect, useMemo, useState, type ReactNode } from "react";
import { buildHash, navigate, useRoute, type Route } from "../lib/routing";
import { formatRelative } from "../lib/format";
import { useConsoleStore } from "../state/ConsoleStore";
import { OnboardingView } from "../features/nodes/OnboardingView";
import { FleetView } from "../features/nodes/FleetView";
import { NodeDetailView } from "../features/nodes/NodeDetailView";
import { TasksView } from "../features/tasks/TasksView";
import { TaskDetailView } from "../features/tasks/TaskDetailView";
import { SecurityView } from "../features/observability/SecurityView";
import { OverviewView } from "../features/overview/OverviewView";
import { Button } from "../ui/Button";
import { PageTransition } from "../ui/Motion";

type NavKey = Route["name"];
type Props = { onLogout: () => void };

export function AppShell({ onLogout }: Props): JSX.Element {
  const route = useRoute();
  const store = useConsoleStore();

  const awaitingCount = store.nodes.filter((n) => n.onboarding_status === "awaiting_first_heartbeat").length;
  const warningCount = store.warnings.length;

  const activeKey: NavKey = route.name === "node-detail" ? "fleet" : route.name === "task-detail" ? "tasks" : route.name;

  const navItems = [
    { id: "overview" as const, label: "系统总览", icon: <IconDashboard /> },
    { id: "onboarding" as const, label: "节点接入", icon: <IconServer />, badge: awaitingCount || undefined },
    { id: "fleet" as const, label: "节点舰队", icon: <IconBox /> },
    { id: "tasks" as const, label: "任务管理", icon: <IconActivity /> },
    { id: "security" as const, label: "安全审计", icon: <IconShield />, badge: warningCount || undefined },
  ];

  return (
    <div className="min-h-screen bg-[#07080A] text-gray-300 font-sans flex overflow-hidden relative">
      {/* Background glow */}
      <div className="fixed top-[-40%] left-[-20%] w-[60%] h-[60%] bg-cyan-950/10 blur-[200px] rounded-full pointer-events-none mix-blend-screen" />
      <div className="fixed bottom-[-40%] right-[-20%] w-[60%] h-[60%] bg-emerald-950/5 blur-[200px] rounded-full pointer-events-none mix-blend-screen" />

      {/* Sidebar */}
      <aside className="w-[250px] border-r border-white/5 bg-[#08090C]/90 backdrop-blur-2xl flex flex-col z-20 shrink-0">
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.2)]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-white"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            </div>
            <div>
              <span className="text-white font-bold text-[15px] tracking-wide">GPUFleet</span>
              <span className="text-[9px] text-cyan-500 font-mono block tracking-widest leading-none font-semibold mt-0.5">ENTERPRISE</span>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3.5 py-6 space-y-1">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest px-2.5 mb-3 font-mono">Operations</div>
          {navItems.map((item) => {
            const isActive = activeKey === item.id;
            return (
              <a
                key={item.id}
                href={buildHash({ name: item.id } as Route)}
                onClick={(e) => { e.preventDefault(); navigate({ name: item.id } as Route); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 relative ${isActive ? "text-white" : "text-gray-400 hover:text-white"}`}
              >
                {isActive && <div className="absolute inset-0 bg-white/[0.04] rounded-lg border border-white/10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]" />}
                <span className={`relative z-10 ${isActive ? "text-cyan-400" : "text-gray-500"}`}>{item.icon}</span>
                <span className="relative z-10">{item.label}</span>
                {item.badge ? (
                  <span className="relative z-10 ml-auto text-[10px] font-bold min-w-[20px] h-[18px] px-1.5 rounded-md bg-cyan-950/40 text-cyan-400 border border-cyan-800/30 flex items-center justify-center">
                    {item.badge}
                  </span>
                ) : null}
              </a>
            );
          })}
        </nav>

        {/* User */}
        <div className="p-4 border-t border-white/5 bg-[#090A0D]/50">
          <div className="flex items-center gap-3 px-1 py-1">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-gray-800 to-gray-700 border border-white/10 flex items-center justify-center font-bold text-xs text-white">
              {store.me?.username?.slice(0, 2).toUpperCase() ?? "AD"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-white truncate">{store.me?.username ?? "admin"}</div>
              <div className="text-[10px] text-emerald-400 flex items-center gap-1.5 mt-0.5 font-mono">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Online
              </div>
            </div>
            <button type="button" onClick={onLogout} className="text-gray-500 hover:text-white transition-colors p-1.5 hover:bg-white/5 rounded-md" title="退出">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden relative z-10">
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-7 border-b border-white/5 bg-[#08090C]/50 backdrop-blur-md shrink-0">
          <Breadcrumb route={route} />
          <div className="flex items-center gap-3">
            <div className="relative w-48">
              <svg className="absolute left-3 top-2.5 text-gray-600" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input type="text" placeholder="Search instances..." className="w-full bg-[#050507] border border-white/5 rounded-md pl-9 pr-3 py-1.5 text-xs text-gray-300 outline-none focus:border-cyan-500/30 transition-all" />
            </div>
            <button type="button" onClick={() => void store.refresh()} className="bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-md text-[12px] font-medium text-gray-300 hover:text-white flex items-center gap-2 transition-all">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
              同步数据
            </button>
          </div>
        </header>

        {/* Error */}
        {store.lastError ? (
          <div className="mx-7 mt-3 px-4 py-3 rounded-lg text-[13px] bg-red-500/8 border border-red-500/20 text-red-400 flex gap-2 items-center">
            <span>数据异常</span><code className="text-[11px] opacity-80">{store.lastError}</code>
          </div>
        ) : null}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-7 pt-6">
          <PageTransition id={route.name === "node-detail" ? `node-${route.nodeId}` : route.name === "task-detail" ? `task-${route.taskId}` : route.name}>
            <RouteOutlet route={route} />
          </PageTransition>
        </div>
      </main>
    </div>
  );
}

function Breadcrumb({ route }: { route: Route }): JSX.Element {
  const store = useConsoleStore();
  const parts: { label: string; to?: Route }[] = [];
  switch (route.name) {
    case "overview": parts.push({ label: "系统总览" }); break;
    case "onboarding": parts.push({ label: "节点接入" }); break;
    case "fleet": parts.push({ label: "节点舰队" }); break;
    case "node-detail": {
      parts.push({ label: "节点舰队", to: { name: "fleet" } });
      const node = store.nodes.find((n) => n.node_id === route.nodeId);
      parts.push({ label: node?.display_name ?? route.nodeId });
      break;
    }
    case "tasks": parts.push({ label: "任务管理" }); break;
    case "task-detail": parts.push({ label: "任务管理", to: { name: "tasks" } }); parts.push({ label: route.taskId }); break;
    case "security": parts.push({ label: "安全审计" }); break;
  }
  return (
    <div className="flex items-center text-[13px]">
      <span className="text-gray-500">GPUFleet Node-Network</span>
      {parts.map((p, i) => (
        <span key={i} className="flex items-center">
          <svg className="mx-2 text-gray-700" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
          {p.to && i < parts.length - 1 ? (
            <a href={buildHash(p.to)} onClick={(e) => { e.preventDefault(); navigate(p.to!); }} className="text-gray-500 hover:text-gray-300 transition-colors">{p.label}</a>
          ) : (
            <span className="text-white font-medium">{p.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}

function RouteOutlet({ route }: { route: Route }): JSX.Element {
  switch (route.name) {
    case "overview": return <OverviewView />;
    case "onboarding": return <OnboardingView />;
    case "fleet": return <FleetView />;
    case "node-detail": return <NodeDetailView nodeId={route.nodeId} />;
    case "tasks": return <TasksView />;
    case "task-detail": return <TaskDetailView taskId={route.taskId} />;
    case "security": return <SecurityView />;
  }
}

// Icons
function IconDashboard() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="4" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="10" width="7" height="11" rx="1"/></svg>; }
function IconServer() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>; }
function IconBox() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>; }
function IconActivity() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>; }
function IconShield() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>; }
