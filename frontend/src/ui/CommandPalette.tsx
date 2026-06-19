/**
 * CommandPalette — cmdk 命令面板
 * Ctrl+K / ⌘K 全局触发，支持节点/任务模糊搜索 + 快捷操作
 */
import { useEffect, useState, useCallback } from "react";
import { Command } from "cmdk";
import { useConsoleStore } from "../state/ConsoleStore";
import { navigate } from "../lib/routing";
import { connectionLabel } from "../lib/labels";

export function CommandPalette(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const store = useConsoleStore();

  // Global keyboard shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleSelect = useCallback((value: string) => {
    setOpen(false);
    setSearch("");

    // Parse action
    if (value.startsWith("node:")) {
      navigate({ name: "node-detail", nodeId: value.slice(5) });
    } else if (value.startsWith("task:")) {
      navigate({ name: "task-detail", taskId: value.slice(5) });
    } else if (value.startsWith("nav:")) {
      const target = value.slice(4);
      switch (target) {
        case "overview": navigate({ name: "overview" }); break;
        case "onboarding": navigate({ name: "onboarding" }); break;
        case "fleet": navigate({ name: "fleet" }); break;
        case "tasks": navigate({ name: "tasks" }); break;
        case "security": navigate({ name: "security" }); break;
      }
    } else if (value === "action:refresh") {
      void store.refresh();
    }
  }, [store]);

  if (!open) return <></>;

  return (
    <div className="fixed inset-0 z-[999]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Panel */}
      <div className="absolute left-1/2 top-[18%] -translate-x-1/2 w-full max-w-[560px]">
        <Command
          className="rounded-xl border border-white/[0.08] bg-[#0d0f14] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.03),0_0_60px_rgba(6,182,212,0.05)] overflow-hidden"
          label="Command Palette"
          shouldFilter={true}
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 border-b border-white/[0.06]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-500 shrink-0">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="搜索节点、任务或快捷操作..."
              className="flex-1 bg-transparent py-3.5 text-[14px] text-white placeholder:text-gray-500 outline-none font-mono"
            />
            <kbd className="text-[10px] font-mono text-gray-600 border border-white/[0.08] rounded px-1.5 py-0.5 bg-white/[0.03]">ESC</kbd>
          </div>

          {/* Results */}
          <Command.List className="max-h-[360px] overflow-y-auto p-2 scrollbar-thin">
            <Command.Empty className="py-8 text-center text-[13px] text-gray-500 font-mono">
              无匹配结果
            </Command.Empty>

            {/* Quick actions */}
            <Command.Group heading="快捷操作" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-gray-500">
              <PaletteItem value="nav:overview" onSelect={handleSelect} icon={<IconGrid />} label="系统总览" shortcut="Overview" />
              <PaletteItem value="nav:fleet" onSelect={handleSelect} icon={<IconBox />} label="节点舰队" shortcut="Fleet" />
              <PaletteItem value="nav:tasks" onSelect={handleSelect} icon={<IconActivity />} label="任务管理" shortcut="Tasks" />
              <PaletteItem value="nav:security" onSelect={handleSelect} icon={<IconShield />} label="安全审计" shortcut="Security" />
              <PaletteItem value="nav:onboarding" onSelect={handleSelect} icon={<IconPlus />} label="登记新节点" shortcut="Onboard" />
              <PaletteItem value="action:refresh" onSelect={handleSelect} icon={<IconRefresh />} label="同步数据" shortcut="Refresh" />
            </Command.Group>

            {/* Nodes */}
            {store.nodes.length > 0 && (
              <Command.Group heading="节点" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-gray-500">
                {store.nodes.map((node) => (
                  <PaletteItem
                    key={node.node_id}
                    value={`node:${node.node_id}`}
                    keywords={[node.display_name, node.node_id, node.hostname ?? "", ...node.tags]}
                    onSelect={handleSelect}
                    icon={<IconServer />}
                    label={node.display_name}
                    shortcut={connectionLabel[node.connection_status] ?? node.connection_status}
                    meta={node.node_id}
                    statusDot={node.connection_status === "online" ? "emerald" : node.connection_status === "offline" ? "amber" : "gray"}
                  />
                ))}
              </Command.Group>
            )}

            {/* Tasks */}
            {store.tasks.length > 0 && (
              <Command.Group heading="任务" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-gray-500">
                {store.tasks.slice(0, 20).map((task) => (
                  <PaletteItem
                    key={task.task_id}
                    value={`task:${task.task_id}`}
                    keywords={[task.task_id, task.type, task.node_id]}
                    onSelect={handleSelect}
                    icon={<IconActivity />}
                    label={task.task_id}
                    shortcut={task.status}
                    meta={task.type}
                    statusDot={task.status === "running" ? "cyan" : task.status === "succeeded" ? "emerald" : task.status === "failed" ? "red" : "gray"}
                  />
                ))}
              </Command.Group>
            )}
          </Command.List>

          {/* Footer */}
          <div className="flex items-center gap-4 px-4 py-2.5 border-t border-white/[0.06] text-[10px] font-mono text-gray-600">
            <span className="flex items-center gap-1"><kbd className="border border-white/[0.08] rounded px-1 py-0.5 bg-white/[0.03]">↑↓</kbd> 导航</span>
            <span className="flex items-center gap-1"><kbd className="border border-white/[0.08] rounded px-1 py-0.5 bg-white/[0.03]">↵</kbd> 选择</span>
            <span className="flex items-center gap-1"><kbd className="border border-white/[0.08] rounded px-1 py-0.5 bg-white/[0.03]">ESC</kbd> 关闭</span>
          </div>
        </Command>
      </div>
    </div>
  );
}

type PaletteItemProps = {
  value: string;
  onSelect: (value: string) => void;
  icon: JSX.Element;
  label: string;
  shortcut?: string;
  meta?: string;
  keywords?: string[];
  statusDot?: "emerald" | "cyan" | "amber" | "red" | "gray";
};

function PaletteItem({ value, onSelect, icon, label, shortcut, meta, keywords, statusDot }: PaletteItemProps): JSX.Element {
  const dotColors: Record<string, string> = {
    emerald: "bg-emerald-500",
    cyan: "bg-cyan-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
    gray: "bg-gray-600",
  };

  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-[13px] text-gray-300 transition-colors data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-white group"
    >
      <span className="text-gray-500 group-data-[selected=true]:text-cyan-400 transition-colors shrink-0">{icon}</span>
      {statusDot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColors[statusDot]}`} />}
      <span className="flex-1 truncate font-medium">{label}</span>
      {meta && <span className="text-[11px] font-mono text-gray-600 truncate max-w-[120px]">{meta}</span>}
      {shortcut && (
        <span className="text-[10px] font-mono text-gray-600 border border-white/[0.06] rounded px-1.5 py-0.5 bg-white/[0.02] shrink-0">
          {shortcut}
        </span>
      )}
    </Command.Item>
  );
}

// Compact icons
function IconGrid() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="4" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="10" width="7" height="11" rx="1"/></svg>; }
function IconBox() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>; }
function IconActivity() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>; }
function IconShield() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>; }
function IconServer() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>; }
function IconPlus() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
function IconRefresh() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>; }
