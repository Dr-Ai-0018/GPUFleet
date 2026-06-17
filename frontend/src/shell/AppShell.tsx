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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const awaitingCount = store.nodes.filter(
    (n) => n.onboarding_status === "awaiting_first_heartbeat",
  ).length;
  const warningCount = store.warnings.length;
  const onlineCount = store.nodes.filter((n) => n.connection_status === "online").length;
  const lastSync = store.overview?.server_time ?? null;

  const activeKey: NavKey =
    route.name === "node-detail" ? "fleet" : route.name === "task-detail" ? "tasks" : route.name;

  const navItems = [
    { id: "overview" as const, label: i18n.shell.nav.overview, icon: <IconDashboard /> },
    {
      id: "onboarding" as const,
      label: i18n.shell.nav.onboarding,
      icon: <IconServer />,
      badge: awaitingCount || undefined,
    },
    { id: "fleet" as const, label: i18n.shell.nav.fleet, icon: <IconBox /> },
    { id: "tasks" as const, label: i18n.shell.nav.tasks, icon: <IconActivity /> },
    {
      id: "security" as const,
      label: i18n.shell.nav.security,
      icon: <IconShield />,
      badge: warningCount || undefined,
    },
  ];

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-[#07090c] font-sans text-gray-300">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:border focus:border-cyan-400/40 focus:bg-[#0a0d12] focus:px-3 focus:py-2 focus:text-[12px] focus:font-semibold focus:text-cyan-100 focus:shadow-xl focus:outline-none"
      >
        跳到主内容
      </a>
      {/* Command Palette */}
      <CommandPalette />

      {mobileNavOpen ? (
        <button
          type="button"
          aria-label="关闭导航"
          className="fixed inset-0 z-10 bg-black/55 sm:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      {/* Sidebar */}
      <aside
        className={`group/sidebar fixed inset-y-0 left-0 z-20 flex w-[244px] shrink-0 flex-col border-r border-white/[0.045] bg-[#090b0f] transition-[transform,width] duration-200 sm:static sm:w-14 sm:translate-x-0 sm:hover:w-[244px] lg:w-[244px] ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Logo */}
        <div className="flex h-16 items-center border-b border-white/5 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 animate-[float_4s_var(--ease-in-out)_infinite] items-center justify-center rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700 shadow-[0_0_15px_rgba(6,182,212,0.2)]">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="text-white"
              >
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <div className="sm:hidden sm:group-hover/sidebar:block lg:block">
              <span className="text-[15px] font-bold tracking-wide text-white">GPUFleet</span>
              <span className="mt-0.5 block bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text font-mono text-[9px] leading-none font-semibold tracking-widest text-cyan-500 text-transparent">
                ENTERPRISE
              </span>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 px-2 py-6 lg:px-3.5">
          <div className="mb-3 flex items-center gap-2 px-2.5 sm:hidden sm:group-hover/sidebar:flex lg:flex">
            <div className="h-3 w-px bg-cyan-400/60" />
            <div className="font-mono text-[10px] font-semibold tracking-widest text-gray-500 uppercase">
              {i18n.shell.operations}
            </div>
          </div>
          {navItems.map((item) => {
            const isActive = activeKey === item.id;
            return (
              <a
                key={item.id}
                href={buildHash({ name: item.id } as Route)}
                onClick={(e) => {
                  e.preventDefault();
                  navigate({ name: item.id } as Route);
                }}
                className={`relative flex min-h-11 w-full items-center gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-200 sm:justify-center sm:group-hover/sidebar:justify-start lg:justify-start ${isActive ? "text-white" : "text-gray-400 hover:text-white"}`}
              >
                {isActive && (
                  <>
                    <div className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-cyan-400 shadow-[0_0_16px_rgba(15,240,179,0.5)]" />
                    <div className="absolute inset-0 rounded-lg border border-cyan-400/15 bg-cyan-400/[0.06]" />
                  </>
                )}
                <span className={`relative z-10 ${isActive ? "text-cyan-400" : "text-gray-500"}`}>
                  {item.icon}
                </span>
                <span className="relative z-10 sm:hidden sm:group-hover/sidebar:inline lg:inline">
                  {item.label}
                </span>
                {item.badge ? (
                  <span className="relative z-10 ml-auto hidden items-center gap-1.5 rounded-full border border-cyan-800/30 bg-cyan-950/30 px-2 py-0.5 text-[10px] font-bold text-cyan-300 sm:group-hover/sidebar:flex lg:flex">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
                    {item.badge}
                  </span>
                ) : null}
              </a>
            );
          })}
        </nav>

        {/* User */}
        <div className="border-t border-white/5 bg-[#090A0D]/50 p-3 sm:hidden sm:group-hover/sidebar:block lg:block lg:p-4">
          <div className="flex items-center gap-3 px-1 py-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-cyan-400/10 bg-gradient-to-tr from-gray-800 to-gray-700 text-xs font-bold text-white shadow-[0_0_0_1px_rgba(15,240,179,0.08)]">
              {store.me?.username?.slice(0, 2).toUpperCase() ?? "AD"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-white">
                {store.me?.username ?? "admin"}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-emerald-400">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />{" "}
                {i18n.shell.online}
              </div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-white/5 hover:text-white"
              title={i18n.shell.logoutTitle}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
              <div className="font-mono text-[9px] text-gray-500 uppercase">Online</div>
              <div className="mt-1 font-mono text-[13px] font-bold text-white">
                {onlineCount}/{store.nodes.length || 0}
              </div>
            </div>
            <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
              <div className="font-mono text-[9px] text-gray-500 uppercase">
                {i18n.shell.lastSync}
              </div>
              <div className="mt-1 font-mono text-[13px] font-bold text-white">
                {lastSync ? formatRelative(lastSync) : "—"}
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main
        id="main"
        tabIndex={-1}
        className="relative z-10 flex h-screen min-w-0 flex-1 flex-col overflow-hidden"
      >
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/[0.045] bg-[#07090c] px-4 sm:px-5 lg:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="打开导航"
              onClick={() => setMobileNavOpen(true)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-white/[0.07] bg-white/[0.03] text-gray-300 sm:hidden"
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <Breadcrumb route={route} />
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => {
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
              }}
              className="group relative hidden w-48 cursor-pointer items-center gap-2 rounded-md border border-white/5 bg-[#050507] py-1.5 pr-2 pl-3 text-xs text-gray-500 transition-all hover:border-cyan-500/20 hover:text-gray-400 md:flex"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="shrink-0"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <span className="flex-1 text-left">{i18n.shell.commandSearchPlaceholder}</span>
              <kbd className="rounded border border-white/[0.08] bg-white/[0.03] px-1 py-0.5 font-mono text-[9px] text-gray-600 transition-colors group-hover:text-gray-400">
                ⌘K
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => void store.refresh()}
              className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-gray-300 transition-all hover:bg-white/10 hover:text-white"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
              {i18n.common.refresh}
            </button>
            <div className="hidden sm:block">
              <HeaderClock />
            </div>
          </div>
        </header>

        {/* Error */}
        {store.lastError ? (
          <div className="mx-7 mt-3 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/8 px-4 py-3 text-[13px] text-red-400">
            <span>{i18n.shell.dataIssue}</span>
            <code className="text-[11px] opacity-80">{store.lastError}</code>
          </div>
        ) : null}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 pt-5 sm:p-5 sm:pt-6 lg:p-7 lg:pt-6">
          <ErrorBoundary
            fallbackTitle={i18n.errorBoundary.routeTitle}
            fallbackDescription={i18n.errorBoundary.routeDescription}
            actionLabel={i18n.common.retry}
            onAction={() => window.location.reload()}
            resetKeys={[
              route.name,
              route.name === "node-detail"
                ? route.nodeId
                : route.name === "task-detail"
                  ? route.taskId
                  : "",
            ]}
          >
            <PageTransition
              id={
                route.name === "node-detail"
                  ? `node-${route.nodeId}`
                  : route.name === "task-detail"
                    ? `task-${route.taskId}`
                    : route.name
              }
            >
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
      <div className="font-mono text-[9px] tracking-[0.18em] text-gray-600 uppercase">
        {i18n.shell.beijingTime}
      </div>
      <div className="font-mono text-[12px] text-cyan-300">
        {new Intl.DateTimeFormat("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
          timeZone: "Asia/Shanghai",
        }).format(clock)}
      </div>
    </div>
  );
}

function Breadcrumb({ route }: { route: Route }): JSX.Element {
  const store = useConsoleStore();
  const parts: { label: string; to?: Route }[] = [];
  switch (route.name) {
    case "overview":
      parts.push({ label: routeLabels.overview });
      break;
    case "onboarding":
      parts.push({ label: routeLabels.onboarding });
      break;
    case "fleet":
      parts.push({ label: routeLabels.fleet });
      break;
    case "node-detail": {
      parts.push({ label: routeLabels.fleet, to: { name: "fleet" } });
      const node = store.nodes.find((n) => n.node_id === route.nodeId);
      parts.push({ label: node?.display_name ?? route.nodeId });
      break;
    }
    case "tasks":
      parts.push({ label: routeLabels.tasks });
      break;
    case "task-detail":
      parts.push({ label: routeLabels.tasks, to: { name: "tasks" } });
      parts.push({ label: route.taskId });
      break;
    case "security":
      parts.push({ label: routeLabels.security });
      break;
  }
  return (
    <div className="flex items-center text-[13px]">
      <span className="text-gray-500">{i18n.shell.brandTrail}</span>
      {parts.map((p, i) => (
        <span key={i} className="flex items-center">
          <svg
            className="mx-2 text-gray-700"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
          {p.to && i < parts.length - 1 ? (
            <a
              href={buildHash(p.to)}
              onClick={(e) => {
                e.preventDefault();
                navigate(p.to!);
              }}
              className="text-gray-500 transition-colors hover:text-gray-300"
            >
              {p.label}
            </a>
          ) : (
            <span className="font-medium text-white">{p.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}

function RouteOutlet({ route }: { route: Route }): JSX.Element {
  switch (route.name) {
    case "overview":
      return <OverviewView />;
    case "onboarding":
      return <OnboardingView />;
    case "fleet":
      return <FleetView />;
    case "node-detail":
      return <NodeDetailView nodeId={route.nodeId} />;
    case "tasks":
      return <TasksView />;
    case "task-detail":
      return <TaskDetailView taskId={route.taskId} />;
    case "security":
      return <SecurityView />;
  }
}

// Icons
function IconDashboard() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="4" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="10" width="7" height="11" rx="1" />
    </svg>
  );
}
function IconServer() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}
function IconBox() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}
function IconActivity() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
