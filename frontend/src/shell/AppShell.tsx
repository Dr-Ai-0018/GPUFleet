import { useEffect, useState } from "react";
import { buildHash, navigate, useRoute, type Route } from "../lib/routing";
import { formatRelative } from "../lib/format";
import { i18n, routeLabels } from "../lib/i18n";
import { useConsoleStore } from "../state/ConsoleStore";
import { OnboardingView } from "../features/nodes/OnboardingView";
import { FleetView } from "../features/nodes/FleetView";
import { NodeDetailView } from "../features/nodes/NodeDetailView";
import { TasksView } from "../features/tasks/TasksView";
import { TaskDetailView } from "../features/tasks/TaskDetailView";
import { SecurityView } from "../features/observability/SecurityView";
import { OverviewView } from "../features/overview/OverviewView";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { PageTransition } from "../ui/Motion";
import { CommandPalette } from "../ui/CommandPalette";

type NavKey = Route["name"];
type Props = { onLogout: () => void };

export function AppShell({ onLogout }: Props): JSX.Element {
  const route = useRoute();
  const store = useConsoleStore();

  const awaitingCount = store.nodes.filter((n) => n.onboarding_status === "awaiting_first_heartbeat").length;
  const warningCount = store.warnings.length;
  const onlineCount = store.nodes.filter((n) => n.connection_status === "online").length;
  const lastSync = store.overview?.server_time ?? null;

  const activeKey: NavKey = route.name === "node-detail" ? "fleet" : route.name === "task-detail" ? "tasks" : route.name;

  const navItems = [
    { id: "overview" as const, label: i18n.shell.nav.overview, icon: <IconDashboard /> },
    { id: "onboarding" as const, label: i18n.shell.nav.onboarding, icon: <IconServer />, badge: awaitingCount || undefined },
    { id: "fleet" as const, label: i18n.shell.nav.fleet, icon: <IconBox /> },
    { id: "tasks" as const, label: i18n.shell.nav.tasks, icon: <IconActivity /> },
    { id: "security" as const, label: i18n.shell.nav.security, icon: <IconShield />, badge: warningCount || undefined },
  ];

  return (
    <div className="min-h-screen bg-[#07080A] text-gray-300 font-sans flex overflow-hidden relative">
      {/* Command Palette */}
      <CommandPalette />

      {/* Ambient glow — single subtle layer, no expensive multi-blur */}
      <div className="fixed top-[-20%] left-[10%] w-[40%] h-[40%] bg-cyan-950/[0.04] blur-[120px] rounded-full pointer-events-none" />

      {/* Sidebar */}
      <aside className="w-[250px] border-r border-white/5 bg-[#08090C] flex flex-col z-20 shrink-0">
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.2)] animate-[float_4s_var(--ease-in-out)_infinite]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-white"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            </div>
            <div>
              <span className="text-white font-bold text-[15px] tracking-wide">GPUFleet</span>
              <span className="text-[9px] text-cyan-500 font-mono block tracking-widest leading-none font-semibold mt-0.5 bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">ENTERPRISE</span>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3.5 py-6 space-y-1">
          <div className="mb-3 flex items-center gap-2 px-2.5">
            <div className="h-3 w-px bg-cyan-400/60" />
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest font-mono">{i18n.shell.operations}</div>
          </div>
          {navItems.map((item) => {
            const isActive = activeKey === item.id;
            return (
              <a
                key={item.id}
                href={buildHash({ name: item.id } as Route)}
                onClick={(e) => { e.preventDefault(); navigate({ name: item.id } as Route); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 relative overflow-hidden ${isActive ? "text-white" : "text-gray-400 hover:text-white"}`}
              >
                {isActive && (
                  <>
                    <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-cyan-400 shadow-[0_0_16px_rgba(15,240,179,0.5)]" />
                    <div className="absolute inset-0 rounded-lg border border-cyan-400/15 bg-cyan-400/[0.06]" />
                  </>
                )}
                <span className={`relative z-10 ${isActive ? "text-cyan-400" : "text-gray-500"}`}>{item.icon}</span>
                <span className="relative z-10">{item.label}</span>
                {item.badge ? (
                  <span className="relative z-10 ml-auto flex items-center gap-1.5 rounded-full border border-cyan-800/30 bg-cyan-950/30 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    {item.badge}
                  </span>
                ) : null}
              </a>
            );
          })}
        </nav>

        {/* User */}
        <div className="border-t border-white/5 bg-[#090A0D]/50 p-4">
          <div className="flex items-center gap-3 px-1 py-1">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-gray-800 to-gray-700 border border-cyan-400/10 shadow-[0_0_0_1px_rgba(15,240,179,0.08)] flex items-center justify-center font-bold text-xs text-white">
              {store.me?.username?.slice(0, 2).toUpperCase() ?? "AD"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-white truncate">{store.me?.username ?? "admin"}</div>
              <div className="text-[10px] text-emerald-400 flex items-center gap-1.5 mt-0.5 font-mono">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> {i18n.shell.online}
              </div>
            </div>
            <button type="button" onClick={onLogout} className="text-gray-500 hover:text-white transition-colors p-1.5 hover:bg-white/5 rounded-md" title={i18n.shell.logoutTitle}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
              <div className="text-[9px] font-mono uppercase text-gray-500">Online</div>
              <div className="mt-1 text-[13px] font-bold font-mono text-white">{onlineCount}/{store.nodes.length || 0}</div>
            </div>
            <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
              <div className="text-[9px] font-mono uppercase text-gray-500">{i18n.shell.lastSync}</div>
              <div className="mt-1 text-[13px] font-bold font-mono text-white">{lastSync ? formatRelative(lastSync) : "—"}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden relative z-10">
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-7 border-b border-white/5 bg-[#08090C] shrink-0">
          <Breadcrumb route={route} />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true })); }}
              className="relative w-48 flex items-center gap-2 bg-[#050507] border border-white/5 rounded-md pl-3 pr-2 py-1.5 text-xs text-gray-500 hover:border-cyan-500/20 hover:text-gray-400 transition-all cursor-pointer group"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <span className="flex-1 text-left">{i18n.shell.commandSearchPlaceholder}</span>
              <kbd className="text-[9px] font-mono border border-white/[0.08] rounded px-1 py-0.5 bg-white/[0.03] text-gray-600 group-hover:text-gray-400 transition-colors">⌘K</kbd>
            </button>
            <button type="button" onClick={() => void store.refresh()} className="bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-md text-[12px] font-medium text-gray-300 hover:text-white flex items-center gap-2 transition-all">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
              {i18n.common.refresh}
            </button>
            <HeaderClock />
          </div>
        </header>

        {/* Error */}
        {store.lastError ? (
          <div className="mx-7 mt-3 px-4 py-3 rounded-lg text-[13px] bg-red-500/8 border border-red-500/20 text-red-400 flex gap-2 items-center">
            <span>{i18n.shell.dataIssue}</span><code className="text-[11px] opacity-80">{store.lastError}</code>
          </div>
        ) : null}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-7 pt-6">
          <ErrorBoundary
            fallbackTitle={i18n.errorBoundary.routeTitle}
            fallbackDescription={i18n.errorBoundary.routeDescription}
            actionLabel={i18n.common.retry}
            onAction={() => window.location.reload()}
            resetKeys={[route.name, route.name === "node-detail" ? route.nodeId : route.name === "task-detail" ? route.taskId : ""]}
          >
            <PageTransition id={route.name === "node-detail" ? `node-${route.nodeId}` : route.name === "task-detail" ? `task-${route.taskId}` : route.name}>
              <RouteOutlet route={route} />
            </PageTransition>
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}

function HeaderClock(): JSX.Element {
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="rounded-md border border-white/5 bg-[#050507] px-3 py-1.5 text-right">
      <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-gray-600">{i18n.shell.beijingTime}</div>
      <div className="text-[12px] font-mono text-cyan-300">{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(clock)}</div>
    </div>
  );
}

function Breadcrumb({ route }: { route: Route }): JSX.Element {
  const store = useConsoleStore();
  const parts: { label: string; to?: Route }[] = [];
  switch (route.name) {
    case "overview": parts.push({ label: routeLabels.overview }); break;
    case "onboarding": parts.push({ label: routeLabels.onboarding }); break;
    case "fleet": parts.push({ label: routeLabels.fleet }); break;
    case "node-detail": {
      parts.push({ label: routeLabels.fleet, to: { name: "fleet" } });
      const node = store.nodes.find((n) => n.node_id === route.nodeId);
      parts.push({ label: node?.display_name ?? route.nodeId });
      break;
    }
    case "tasks": parts.push({ label: routeLabels.tasks }); break;
    case "task-detail": parts.push({ label: routeLabels.tasks, to: { name: "tasks" } }); parts.push({ label: route.taskId }); break;
    case "security": parts.push({ label: routeLabels.security }); break;
  }
  return (
    <div className="flex items-center text-[13px]">
      <span className="text-gray-500">{i18n.shell.brandTrail}</span>
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
