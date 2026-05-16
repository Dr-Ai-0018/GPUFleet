import { useConsoleStore } from "../../state/ConsoleStore";
import { Card } from "../../ui/Card";
import { CodeBlock } from "../../ui/CodeBlock";
import { EmptyState } from "../../ui/EmptyState";
import { StatusPill } from "../../ui/StatusPill";
import { formatRelative, formatTime, prettyJson } from "../../lib/format";
import page from "../../ui/page.module.css";
import fleet from "../nodes/FleetView.module.css";
import styles from "./SecurityView.module.css";

export function SecurityView(): JSX.Element {
  const store = useConsoleStore();

  return (
    <div className={page.page}>
      <header className={page.head}>
        <div className={page.titleBlock}>
          <div className={page.eyebrow}>SECURITY · AUDIT</div>
          <h1 className={page.title}>安全告警与审计</h1>
          <p className={page.lede}>每一次危险操作被拦截、每一次管理员动作都会落到这里。</p>
        </div>
      </header>

      <Card
        title="安全告警"
        subtitle="被拒绝的危险命令或安全策略命中将出现在这里。"
        actions={<span className="muted tabular">{store.warnings.length}</span>}
        bodyFlush={store.warnings.length > 0}
      >
        {store.warnings.length === 0 ? (
          <EmptyState title="暂无告警" description="尚未发生被拒绝的危险操作。" />
        ) : (
          <ul className={styles.list}>
            {store.warnings.map((warning) => (
              <li key={warning.id} className={`${styles.item} ${styles.warn}`}>
                <div className={styles.head}>
                  <span className={styles.title}>
                    <span className={`${styles.titleAccent} ${styles.titleAccentWarn}`} />
                    {warning.warning_type}
                  </span>
                  <StatusPill tone="danger" label={warning.source_type} />
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
      </Card>

      <Card
        title="审计事件"
        subtitle="管理员操作流水。"
        actions={<span className="muted tabular">{store.audits.length}</span>}
        bodyFlush={store.audits.length > 0}
      >
        {store.audits.length === 0 ? (
          <EmptyState title="暂无审计事件" description="还没有被记录的管理员操作。" />
        ) : (
          <ul className={styles.list}>
            {store.audits.map((event) => (
              <li key={event.id} className={styles.item}>
                <div className={styles.head}>
                  <span className={styles.title}>
                    <span className={styles.titleAccent} />
                    {event.action}
                  </span>
                  <span className={fleet.metaChip}>{event.actor_type}</span>
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
      </Card>
    </div>
  );
}
