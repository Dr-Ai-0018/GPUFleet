import { useMemo, useState } from "react";
import { useConsoleStore } from "../../state/ConsoleStore";
import { navigate } from "../../lib/routing";
import type { NodeCreateResponse } from "../../types";
import { NodeCreatePanel } from "./NodeCreatePanel";
import { OnboardingPackagePanel } from "./OnboardingPackagePanel";
import { Card } from "../../ui/Card";
import { StatusPill } from "../../ui/StatusPill";
import { EmptyState } from "../../ui/EmptyState";
import { Button } from "../../ui/Button";
import { connectionLabel, connectionTone, onboardingLabel, onboardingTone } from "../../lib/labels";
import { formatRelative } from "../../lib/format";
import page from "../../ui/page.module.css";
import styles from "./OnboardingView.module.css";

export function OnboardingView(): JSX.Element {
  const store = useConsoleStore();
  const [pkg, setPkg] = useState<NodeCreateResponse | null>(store.recentOnboarding);

  const awaiting = useMemo(
    () => store.nodes.filter((node) => node.onboarding_status === "awaiting_first_heartbeat"),
    [store.nodes],
  );

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.headTitle}>
          <div className={page.eyebrow}>ONBOARDING · 主流程</div>
          <h1 className={page.title}>先把节点拉上线</h1>
          <p className={page.lede}>
            创建节点会立即生成签名密钥与接入包；只有收到首个有效心跳，节点才进入在线状态。
          </p>
        </div>
        <KeyMetrics />
      </header>

      <section className={styles.grid2}>
        <NodeCreatePanel onCreated={setPkg} />
        <OnboardingPackagePanel pkg={pkg} />
      </section>

      <Card
        title="待接入清单"
        subtitle="已在控制平面登记，但还没收到首个有效心跳。"
        actions={<span className="muted tabular">{awaiting.length} 个节点</span>}
        bodyFlush={awaiting.length > 0}
      >
        {awaiting.length === 0 ? (
          <EmptyState
            title="目前没有挂起的接入"
            description="所有已登记节点都已完成首次签名心跳。新建节点会出现在这里。"
          />
        ) : (
          <ul className={styles.awaitingList}>
            {awaiting.map((node) => (
              <li key={node.node_id} className={styles.awaitingRow}>
                <div className={styles.awaitingMain}>
                  <div className={styles.awaitingTitle}>
                    <span className={styles.awaitingName}>{node.display_name}</span>
                    <code className={styles.awaitingId}>{node.node_id}</code>
                  </div>
                  <div className={styles.awaitingMeta}>
                    <span>创建于 {formatRelative(node.created_at)}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <StatusPill
                    tone={onboardingTone[node.onboarding_status]}
                    label={onboardingLabel[node.onboarding_status]}
                    pulse
                  />
                  <StatusPill
                    tone={connectionTone[node.connection_status]}
                    label={connectionLabel[node.connection_status]}
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate({ name: "node-detail", nodeId: node.node_id })}
                >
                  详情
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function KeyMetrics(): JSX.Element {
  const store = useConsoleStore();
  const total = store.nodes.length;
  const awaiting = store.nodes.filter((n) => n.onboarding_status === "awaiting_first_heartbeat").length;
  const online = store.nodes.filter((n) => n.connection_status === "online").length;
  const offline = store.nodes.filter((n) => n.connection_status === "offline").length;
  const items: { label: string; value: number; dot: string }[] = [
    { label: "TOTAL", value: total, dot: styles.metricDotMuted },
    { label: "ONLINE", value: online, dot: styles.metricDotOnline },
    { label: "AWAITING", value: awaiting, dot: styles.metricDotWaiting },
    { label: "OFFLINE", value: offline, dot: styles.metricDotOffline },
  ];
  return (
    <div className={styles.metricStrip}>
      {items.map((item) => (
        <div key={item.label} className={styles.metric}>
          <span className={styles.metricLabel}>
            <i className={`${styles.metricDot} ${item.dot}`} />
            {item.label}
          </span>
          <span className={styles.metricValue}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}
