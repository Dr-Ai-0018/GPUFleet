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
import { Button } from "../ui/Button";
import { PageTransition } from "../ui/Motion";
import styles from "./AppShell.module.css";

type NavKey = Route["name"];

type NavItem = {
  key: NavKey;
  to: Route;
  label: string;
  icon: ReactNode;
  badge?: () => ReactNode | null;
};

type Props = { onLogout: () => void };

export function AppShell({ onLogout }: Props): JSX.Element {
  const route = useRoute();
  const store = useConsoleStore();
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const awaitingCount = store.nodes.filter(
    (n) => n.onboarding_status === "awaiting_first_heartbeat",
  ).length;
  const offlineCount = store.nodes.filter((n) => n.connection_status === "offline").length;
  const warningCount = store.warnings.length;

  const navItems = useMemo<NavItem[]>(
    () => [
      {
        key: "onboarding",
        to: { name: "onboarding" },
        label: "节点接入",
        icon: <NavIcon kind="onboarding" />,
        badge: () =>
          awaitingCount ? <span className={styles.badge}>{awaitingCount}</span> : null,
      },
      {
        key: "fleet",
        to: { name: "fleet" },
        label: "节点舰队",
        icon: <NavIcon kind="fleet" />,
        badge: () =>
          offlineCount ? <span className={`${styles.badge} ${styles.badgeMute}`}>{offlineCount}</span> : null,
      },
      {
        key: "tasks",
        to: { name: "tasks" },
        label: "任务中心",
        icon: <NavIcon kind="tasks" />,
      },
      {
        key: "security",
        to: { name: "security" },
        label: "安全审计",
        icon: <NavIcon kind="security" />,
        badge: () =>
          warningCount ? <span className={`${styles.badge} ${styles.badgeDanger}`}>{warningCount}</span> : null,
      },
    ],
    [awaitingCount, offlineCount, warningCount],
  );

  const activeKey: NavKey =
    route.name === "node-detail" ? "fleet" : route.name === "task-detail" ? "tasks" : route.name;

  return (
    <div className={styles.shell}>
      {/* ─── Sidebar ─── */}
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandMark} aria-hidden>G</div>
          <span className={styles.brandName}>GPUFleet</span>
        </div>

        <nav className={styles.nav}>
          {navItems.map((item) => (
            <a
              key={item.key}
              className={`${styles.navItem}${activeKey === item.key ? ` ${styles.navActive}` : ""}`}
              href={buildHash(item.to)}
              onClick={(e) => { e.preventDefault(); navigate(item.to); }}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              <span className={styles.navLabel}>{item.label}</span>
              {item.badge?.() ?? null}
            </a>
          ))}
        </nav>

        <div className={styles.sidebarFoot}>
          <SidebarStats />
        </div>
      </aside>

      {/* ─── Main ─── */}
      <div className={styles.main}>
        <header className={styles.topbar}>
          <Breadcrumb route={route} />
          <div className={styles.topbarRight}>
            <SyncChip now={now.getTime()} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void store.refresh()}
              disabled={store.loading === "loading"}
            >
              {store.loading === "loading" ? "同步中…" : "刷新"}
            </Button>
            <Button variant="quiet" size="sm" onClick={onLogout}>退出</Button>
          </div>
        </header>

        {store.lastError ? (
          <div className={styles.errorBanner}>
            <span>数据加载异常</span>
            <code>{store.lastError}</code>
          </div>
        ) : null}

        <main className={styles.content}>
          <RouteOutlet route={route} />
        </main>
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function SidebarStats(): JSX.Element {
  const store = useConsoleStore();
  const total = store.nodes.length;
  const online = store.nodes.filter((n) => n.connection_status === "online").length;
  return (
    <div className={styles.stats}>
      <div className={styles.statRow}>
        <span className={styles.statLabel}>节点</span>
        <span className={styles.statValue}>{total}</span>
      </div>
      <div className={styles.statRow}>
        <span className={styles.statLabel}>在线</span>
        <span className={`${styles.statValue} ${styles.statOnline}`}>{online}</span>
      </div>
    </div>
  );
}

function SyncChip({ now }: { now: number }): JSX.Element {
  const store = useConsoleStore();
  if (!store.lastSyncedAt) {
    return <span className={styles.sync}>等待同步</span>;
  }
  return (
    <span className={styles.sync}>
      <span className={styles.syncDot} />
      {formatRelative(new Date(store.lastSyncedAt).toISOString(), now)}
    </span>
  );
}

function Breadcrumb({ route }: { route: Route }): JSX.Element {
  const store = useConsoleStore();
  const trail: { label: string; to?: Route }[] = [];
  switch (route.name) {
    case "onboarding":
      trail.push({ label: "节点接入" });
      break;
    case "fleet":
      trail.push({ label: "节点舰队" });
      break;
    case "node-detail": {
      trail.push({ label: "节点舰队", to: { name: "fleet" } });
      const node = store.nodes.find((n) => n.node_id === route.nodeId);
      trail.push({ label: node ? node.display_name : route.nodeId });
      break;
    }
    case "tasks":
      trail.push({ label: "任务中心" });
      break;
    case "task-detail":
      trail.push({ label: "任务中心", to: { name: "tasks" } });
      trail.push({ label: route.taskId });
      break;
    case "security":
      trail.push({ label: "安全审计" });
      break;
  }
  return (
    <div className={styles.breadcrumb}>
      {trail.map((entry, idx) => {
        const isLast = idx === trail.length - 1;
        return (
          <span key={`${entry.label}-${idx}`} className={styles.crumbItem}>
            {entry.to && !isLast ? (
              <a
                href={buildHash(entry.to)}
                className={styles.crumbLink}
                onClick={(e) => { e.preventDefault(); navigate(entry.to!); }}
              >
                {entry.label}
              </a>
            ) : (
              <span className={isLast ? styles.crumbCurrent : ""}>{entry.label}</span>
            )}
            {!isLast ? <span className={styles.crumbSep}>/</span> : null}
          </span>
        );
      })}
    </div>
  );
}

function RouteOutlet({ route }: { route: Route }): JSX.Element {
  const content = (() => {
    switch (route.name) {
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
  })();

  return (
    <PageTransition id={route.name === "node-detail" ? `node-${route.nodeId}` : route.name === "task-detail" ? `task-${route.taskId}` : route.name}>
      {content}
    </PageTransition>
  );
}

/* ─── Icons ─── */

function NavIcon({ kind }: { kind: "onboarding" | "fleet" | "tasks" | "security" }): JSX.Element {
  const p = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "onboarding":
      return <svg {...p}><path d="M3 8h6" /><path d="M9 5l3 3-3 3" /><path d="M13 3v10" /></svg>;
    case "fleet":
      return <svg {...p}><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>;
    case "tasks":
      return <svg {...p}><path d="M3 4h10" /><path d="M3 8h10" /><path d="M3 12h6" /></svg>;
    case "security":
      return <svg {...p}><path d="M8 1.5L13.5 4v3.5c0 3.2-2.4 5.8-5.5 6.5-3.1-.7-5.5-3.3-5.5-6.5V4L8 1.5z" /></svg>;
  }
}
