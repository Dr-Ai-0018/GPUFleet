import { useMemo, useState } from "react";
import { useConsoleStore } from "../../state/ConsoleStore";
import { CodeBlock } from "../../ui/CodeBlock";
import { StatusPill } from "../../ui/StatusPill";
import { formatRelative, formatTime, prettyJson } from "../../lib/format";
import styles from "./SecurityView.module.css";

type TabKey = "warnings" | "audits";

export function SecurityView(): JSX.Element {
  const store = useConsoleStore();
  const [tab, setTab] = useState<TabKey>(store.warnings.length > 0 ? "warnings" : "audits");
  const [query, setQuery] = useState("");

  const filteredWarnings = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return store.warnings;
    return store.warnings.filter((w) =>
      [w.warning_type, w.source_type, w.command_excerpt ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [store.warnings, query]);

  const filteredAudits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return store.audits;
    return store.audits.filter((e) =>
      [e.action, e.actor_type, e.target_type, e.target_id ?? "", e.request_ip ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [store.audits, query]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>安全审计</h1>
        <div className={styles.headerMeta}>
          <span className={store.warnings.length > 0 ? styles.metaDanger : styles.metaNormal}>
            {store.warnings.length} 告警
          </span>
          <span className={styles.metaNormal}>{store.audits.length} 事件</span>
        </div>
      </header>

      {/* Tab + filter */}
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab}${tab === "warnings" ? ` ${styles.tabActive}` : ""}`}
            onClick={() => setTab("warnings")}
          >
            安全告警
            {store.warnings.length > 0 ? (
              <span className={styles.tabBadge}>{store.warnings.length}</span>
            ) : null}
          </button>
          <button
            type="button"
            className={`${styles.tab}${tab === "audits" ? ` ${styles.tabActive}` : ""}`}
            onClick={() => setTab("audits")}
          >
            审计事件
          </button>
        </div>

        <div className={styles.searchWrap}>
          <SearchIcon />
          <input
            className={styles.searchInput}
            placeholder="搜索…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Content */}
      {tab === "warnings" ? (
        <WarningsTable items={filteredWarnings} />
      ) : (
        <AuditsTable items={filteredAudits} />
      )}
    </div>
  );
}

/* ─── Warnings table ─── */

function WarningsTable({ items }: { items: ReturnType<typeof useConsoleStore>["warnings"] }): JSX.Element {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (items.length === 0) {
    return <div className={styles.empty}>当前没有安全告警</div>;
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>时间</th>
            <th>类型</th>
            <th>来源</th>
            <th>命中片段</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((w) => (
            <WarningRow
              key={w.id}
              item={w}
              isExpanded={expanded === w.id}
              onToggle={() => setExpanded(expanded === w.id ? null : w.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WarningRow({ item, isExpanded, onToggle }: {
  item: ReturnType<typeof useConsoleStore>["warnings"][number];
  isExpanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <>
      <tr
        className={styles.row}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <td className={styles.cellTime}>{formatTime(item.created_at)}</td>
        <td>
          <StatusPill tone="danger" label={item.warning_type} />
        </td>
        <td className={styles.cellMono}>{item.source_type}</td>
        <td className={styles.cellExcerpt}>{item.command_excerpt ?? "—"}</td>
        <td className={styles.cellExpand}>{isExpanded ? "▾" : "▸"}</td>
      </tr>
      {isExpanded ? (
        <tr className={styles.detailRow}>
          <td colSpan={5}>
            <CodeBlock label="详情" value={prettyJson(item.detail)} maxHeight={240} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/* ─── Audits table ─── */

function AuditsTable({ items }: { items: ReturnType<typeof useConsoleStore>["audits"] }): JSX.Element {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (items.length === 0) {
    return <div className={styles.empty}>暂无审计事件</div>;
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>时间</th>
            <th>操作者</th>
            <th>操作</th>
            <th>目标</th>
            <th>IP</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <AuditRow
              key={e.id}
              item={e}
              isExpanded={expanded === e.id}
              onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditRow({ item, isExpanded, onToggle }: {
  item: ReturnType<typeof useConsoleStore>["audits"][number];
  isExpanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <>
      <tr
        className={styles.row}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <td className={styles.cellTime}>{formatTime(item.created_at)}</td>
        <td className={styles.cellMono}>{item.actor_type}</td>
        <td className={styles.cellAction}>{item.action}</td>
        <td className={styles.cellMono}>
          {item.target_type}{item.target_id ? ` · ${item.target_id}` : ""}
        </td>
        <td className={styles.cellMono}>{item.request_ip ?? "—"}</td>
        <td className={styles.cellExpand}>{isExpanded ? "▾" : "▸"}</td>
      </tr>
      {isExpanded ? (
        <tr className={styles.detailRow}>
          <td colSpan={6}>
            <CodeBlock label="详情" value={prettyJson(item.detail)} maxHeight={240} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function SearchIcon(): JSX.Element {
  return (
    <svg className={styles.searchIcon} width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M11 11l3 3" />
    </svg>
  );
}
