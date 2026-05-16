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
  const offline = store.nodes.filter((n) => n.connection_status === "offline").length;

  // Process ribbon stage logic — drives the visual narrative without prose
  const stage: 1 | 2 | 3 = !pkg
    ? 1
    : awaiting.some((n) => n.node_id === pkg.node_id)
      ? 2
      : 3;

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroLeft}>
          <span className={styles.heroEyebrow}>
            <span className={styles.heroEyebrowDot} aria-hidden />
            ONBOARDING
          </span>
          <h1 className={styles.heroTitle}>节点接入</h1>
        </div>
        <div className={styles.kpiBand} aria-label="fleet overview">
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>
              <span className={`${styles.kpiDot} ${styles.kpiDotMuted}`} />
              FLEET
            </span>
            <span className={`${styles.kpiValue} ${total === 0 ? styles.kpiValueMuted : ""}`}>{total}</span>
          </div>
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>
              <span className={`${styles.kpiDot} ${styles.kpiDotOnline}`} />
              ONLINE
            </span>
            <span className={`${styles.kpiValue} ${online === 0 ? styles.kpiValueMuted : ""}`}>{online}</span>
          </div>
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>
              <span className={`${styles.kpiDot} ${styles.kpiDotWaiting}`} />
              AWAITING
            </span>
            <span className={`${styles.kpiValue} ${awaiting.length === 0 ? styles.kpiValueMuted : ""}`}>
              {awaiting.length}
            </span>
          </div>
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>
              <span className={`${styles.kpiDot} ${styles.kpiDotOffline}`} />
              OFFLINE
            </span>
            <span className={`${styles.kpiValue} ${offline === 0 ? styles.kpiValueMuted : ""}`}>{offline}</span>
          </div>
        </div>
      </header>

      <ProcessRibbon stage={stage} />

      <section className={styles.workspace}>
        <NodeCreatePanel onCreated={setPkg} />
        <OnboardingPackagePanel pkg={pkg} />
      </section>

      <section className={styles.ledger}>
        <header className={styles.ledgerHead}>
          <span className={styles.ledgerTitle}>待首次心跳</span>
          <span className={styles.ledgerCount}>{awaiting.length} pending</span>
        </header>
        {awaiting.length === 0 ? (
          <div className={styles.ledgerEmpty}>NO PENDING NODES</div>
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
                    <span>登记于 {formatRelative(node.created_at)}</span>
                    <span>·</span>
                    <span>心跳 {node.heartbeat_interval_sec}s</span>
                  </div>
                </div>
                <div className={styles.awaitingPills}>
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
      </section>
    </div>
  );
}

function ProcessRibbon({ stage }: { stage: 1 | 2 | 3 }): JSX.Element {
  const stages: { label: string; title: string }[] = [
    { label: "STAGE 01", title: "登记节点 · 下发密钥" },
    { label: "STAGE 02", title: "写入接入包 · 启动 agent" },
    { label: "STAGE 03", title: "首次签名心跳 · 上线" },
  ];
  return (
    <div className={styles.ribbon}>
      {stages.map((s, idx) => {
        const num = (idx + 1) as 1 | 2 | 3;
        const isDone = stage > num;
        const isActive = stage === num;
        const cls = [
          styles.stage,
          isActive ? styles.stageActive : "",
          isDone ? styles.stageDone : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div key={s.label} className={cls}>
            <div className={styles.stageBadge} aria-hidden>
              {isDone ? <CheckIcon /> : String(num).padStart(2, "0")}
            </div>
            <div className={styles.stageBody}>
              <span className={styles.stageLabel}>{s.label}</span>
              <span className={styles.stageTitle}>{s.title}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CheckIcon(): JSX.Element {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5l3 3 6-6" />
    </svg>
  );
}
