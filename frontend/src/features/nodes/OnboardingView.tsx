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

  const total = store.nodes.length;
  const online = store.nodes.filter((n) => n.connection_status === "online").length;

  // Stage logic for the process indicator
  const stage: 1 | 2 | 3 = !pkg
    ? 1
    : awaiting.some((n) => n.node_id === pkg.node_id)
      ? 2
      : 3;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>节点接入</h1>
        <div className={styles.headerMeta}>
          <span className={styles.metaItem}>
            <span className={styles.metaDot} data-tone="total" />
            {total} 节点
          </span>
          <span className={styles.metaItem}>
            <span className={styles.metaDot} data-tone="online" />
            {online} 在线
          </span>
          <span className={styles.metaItem}>
            <span className={styles.metaDot} data-tone="waiting" />
            {awaiting.length} 待接入
          </span>
        </div>
      </header>

      {/* Process stage indicator */}
      <div className={styles.stageBar}>
        <StageStep num={1} label="登记节点" active={stage === 1} done={stage > 1} />
        <span className={styles.stageConnector} data-done={stage > 1 ? "" : undefined} />
        <StageStep num={2} label="部署接入包" active={stage === 2} done={stage > 2} />
        <span className={styles.stageConnector} data-done={stage > 2 ? "" : undefined} />
        <StageStep num={3} label="首次心跳上线" active={stage === 3} done={false} />
      </div>

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

function StageStep({ num, label, active, done }: {
  num: number;
  label: string;
  active: boolean;
  done: boolean;
}): JSX.Element {
  const cls = [
    styles.stageStep,
    active ? styles.stageStepActive : "",
    done ? styles.stageStepDone : "",
  ].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      <span className={styles.stageBadge}>
        {done ? <CheckIcon /> : num}
      </span>
      <span className={styles.stageLabel}>{label}</span>
    </div>
  );
}

function CheckIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5l3 3 6-6" />
    </svg>
  );
}
