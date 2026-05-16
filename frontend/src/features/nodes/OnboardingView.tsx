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
      <header className={styles.header}>
        <h1 className={styles.title}>节点接入</h1>
        <div className={styles.headerMeta}>
          <span className={styles.metaItem}>
            <span className={styles.metaDot} data-tone="total" />
            {store.nodes.length} 节点
          </span>
          <span className={styles.metaItem}>
            <span className={styles.metaDot} data-tone="online" />
            {store.nodes.filter((n) => n.connection_status === "online").length} 在线
          </span>
          <span className={styles.metaItem}>
            <span className={styles.metaDot} data-tone="waiting" />
            {awaiting.length} 待接入
          </span>
        </div>
      </header>

      {/* Two-column workspace: form + package */}
      <section className={styles.workspace}>
        <NodeCreatePanel onCreated={setPkg} />
        <OnboardingPackagePanel pkg={pkg} />
      </section>

      {/* Awaiting list */}
      <section className={styles.awaitingSection}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>待首次心跳</h2>
          <span className={styles.sectionCount}>{awaiting.length}</span>
        </div>
        {awaiting.length === 0 ? (
          <div className={styles.sectionEmpty}>当前没有待接入节点</div>
        ) : (
          <div className={styles.awaitingTable}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>节点</th>
                  <th>接入状态</th>
                  <th>连接</th>
                  <th>登记时间</th>
                  <th>心跳</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {awaiting.map((node) => (
                  <tr key={node.node_id} className={styles.row}>
                    <td>
                      <div className={styles.cellNode}>
                        <span className={styles.nodeName}>{node.display_name}</span>
                        <code className={styles.nodeId}>{node.node_id}</code>
                      </div>
                    </td>
                    <td>
                      <StatusPill
                        tone={onboardingTone[node.onboarding_status]}
                        label={onboardingLabel[node.onboarding_status]}
                        pulse
                      />
                    </td>
                    <td>
                      <StatusPill
                        tone={connectionTone[node.connection_status]}
                        label={connectionLabel[node.connection_status]}
                      />
                    </td>
                    <td className={styles.cellTime}>{formatRelative(node.created_at)}</td>
                    <td className={styles.cellMono}>{node.heartbeat_interval_sec}s</td>
                    <td>
                      <Button
                        size="sm"
                        variant="quiet"
                        onClick={() => navigate({ name: "node-detail", nodeId: node.node_id })}
                      >
                        详情
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
