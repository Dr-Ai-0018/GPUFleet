import { useConsoleStore } from "../../state/ConsoleStore";
import { CodeBlock } from "../../ui/CodeBlock";
import { StatusPill } from "../../ui/StatusPill";
import { formatRelative, formatTime, prettyJson } from "../../lib/format";
import styles from "./SecurityView.module.css";

export function SecurityView(): JSX.Element {
  const store = useConsoleStore();
  const warnCount = store.warnings.length;
  const auditCount = store.audits.length;

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroLeft}>
          <span className={styles.heroEyebrow}>
            <span className={styles.heroEyebrowDot} aria-hidden />
            SECURITY · AUDIT
          </span>
          <h1 className={styles.heroTitle}>安全审计</h1>
        </div>
        <div className={styles.band}>
          <div className={styles.bandCell}>
            <span className={`${styles.bandLabel} ${warnCount > 0 ? styles.bandLabelDanger : ""}`}>
              WARNINGS
            </span>
            <span
              className={`${styles.bandValue} ${
                warnCount > 0 ? styles.bandValueDanger : styles.bandValueMute
              }`}
            >
              {warnCount}
            </span>
          </div>
          <div className={styles.bandCell}>
            <span className={styles.bandLabel}>AUDIT EVENTS</span>
            <span
              className={`${styles.bandValue} ${auditCount === 0 ? styles.bandValueMute : ""}`}
            >
              {auditCount}
            </span>
          </div>
        </div>
      </header>

      <section className={`${styles.section} ${warnCount > 0 ? styles.sectionDanger : ""}`}>
        <header className={styles.sectionHead}>
          <span className={`${styles.sectionTitle} ${warnCount > 0 ? styles.sectionTitleDanger : ""}`}>
            <ShieldIcon danger={warnCount > 0} />
            安全告警
          </span>
          <span className={styles.sectionMeta}>{warnCount} entries</span>
        </header>
        {warnCount === 0 ? (
          <div className={styles.sectionEmpty}>
            <span className={styles.sectionEmptyMeta}>NO BLOCKED OPERATIONS</span>
            <span className={styles.sectionEmptyLabel}>当前没有被拦截的危险动作</span>
          </div>
        ) : (
          <ul className={styles.list}>
            {store.warnings.map((warning) => (
              <li key={warning.id} className={`${styles.item} ${styles.warn}`}>
                <div className={styles.head}>
                  <span className={`${styles.title} ${styles.titleDanger}`}>
                    {warning.warning_type}
                  </span>
                  <span className={styles.titleMeta}>
                    <StatusPill tone="danger" label={warning.source_type} />
                  </span>
                </div>
                <div className={styles.meta}>
                  {formatTime(warning.created_at)} · {formatRelative(warning.created_at)}
                </div>
                {warning.command_excerpt ? (
                  <CodeBlock label="命中片段" value={warning.command_excerpt} multiline={false} />
                ) : null}
                <CodeBlock label="详情" value={prettyJson(warning.detail)} maxHeight={220} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <span className={styles.sectionTitle}>
            <BookIcon />
            审计事件
          </span>
          <span className={styles.sectionMeta}>{auditCount} entries</span>
        </header>
        {auditCount === 0 ? (
          <div className={styles.sectionEmpty}>
            <span className={styles.sectionEmptyMeta}>NO AUDIT EVENTS</span>
            <span className={styles.sectionEmptyLabel}>—</span>
          </div>
        ) : (
          <ul className={styles.list}>
            {store.audits.map((event) => (
              <li key={event.id} className={styles.item}>
                <div className={styles.head}>
                  <span className={styles.title}>{event.action}</span>
                  <span className={styles.titleMeta}>
                    <span className={styles.metaChip}>{event.actor_type}</span>
                  </span>
                </div>
                <div className={styles.meta}>
                  {formatTime(event.created_at)} · {formatRelative(event.created_at)} · {event.target_type}
                  {event.target_id ? ` · ${event.target_id}` : ""}
                  {event.request_ip ? ` · ${event.request_ip}` : ""}
                </div>
                <CodeBlock label="详情" value={prettyJson(event.detail)} maxHeight={220} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ShieldIcon({ danger }: { danger?: boolean }): JSX.Element {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke={danger ? "var(--c-danger)" : "currentColor"}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1.5L13.5 4v3.5c0 3.2-2.4 5.8-5.5 6.5-3.1-.7-5.5-3.3-5.5-6.5V4L8 1.5z" />
    </svg>
  );
}

function BookIcon(): JSX.Element {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3h6.5L13 5v8H3z" />
      <path d="M9.5 3v2.5H13" />
    </svg>
  );
}
