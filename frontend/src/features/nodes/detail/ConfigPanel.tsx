import { i18n } from "../../../lib/i18n";
import type { NodeResponse } from "../../../types";
import type { NodeEditForm } from "./types";
import { cardCls, inputCls, labelCls } from "./shared";

type Props = {
  node: NodeResponse;
  editForm: NodeEditForm;
  updateEdit: (updater: (prev: NodeEditForm) => NodeEditForm) => void;
  editError: string | null;
  saving: boolean;
  handleSave: () => void;
};

export function ConfigPanel({
  node,
  editForm,
  updateEdit,
  editError,
  saving,
  handleSave,
}: Props): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className={`${cardCls} space-y-5 lg:col-span-1`}>
        <div className="border-b border-white/5 pb-3"><span className="text-[12px] font-bold font-mono uppercase text-gray-500">运行时后端</span></div>
        <div className="space-y-4">
          <div className="space-y-1.5 rounded-lg border border-white/5 bg-[#050507] p-3.5">
            <span className="block text-xs font-bold text-white">.venv (Default Workspace)</span>
            <span className="block text-[11px] font-mono text-gray-500">{node.allowed_workdirs[0] ?? i18n.common.dash}</span>
            <span className="block text-[11px] font-mono text-cyan-400">Python env</span>
          </div>
        </div>
        <div className="space-y-3 pt-2">
          <span className="block text-[11px] font-mono text-gray-500">标签</span>
          <div className="flex flex-wrap gap-2">
            {node.tags.map((tag) => <span key={tag} className="rounded-md border border-white/5 bg-white/5 px-2.5 py-0.5 text-[11px] font-mono text-gray-400">{tag}</span>)}
            {node.tags.length === 0 ? <span className="text-[11px] text-gray-600">无标签</span> : null}
          </div>
        </div>
      </div>

      <div className={`${cardCls} space-y-5 lg:col-span-2`}>
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <span className="text-[12px] font-bold font-mono uppercase text-gray-500">节点配置 (Node Configuration)</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5"><label className={labelCls}>显示名 (Display Name)</label><input type="text" value={editForm.display_name} onChange={(e) => updateEdit((prev) => ({ ...prev, display_name: e.target.value }))} className={inputCls} /></div>
          <div className="space-y-1.5"><label className={labelCls}>主机名 (Hostname)</label><input type="text" value={editForm.hostname} onChange={(e) => updateEdit((prev) => ({ ...prev, hostname: e.target.value }))} className={inputCls} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5"><label className={labelCls}>OS</label><select value={editForm.os_type} onChange={(e) => updateEdit((prev) => ({ ...prev, os_type: e.target.value as NodeEditForm["os_type"] }))} className={inputCls}><option value="windows">windows</option><option value="linux">linux</option></select></div>
          <div className="space-y-1.5"><label className={labelCls}>心跳间隔 (秒)</label><input type="number" min={3} max={3600} value={editForm.heartbeat_interval_sec} onChange={(e) => updateEdit((prev) => ({ ...prev, heartbeat_interval_sec: Number(e.target.value || 5) }))} className={inputCls} /></div>
        </div>
        <div className="space-y-1.5"><label className={labelCls}>允许的工作目录</label><textarea value={editForm.allowed_workdirs} onChange={(e) => updateEdit((prev) => ({ ...prev, allowed_workdirs: e.target.value }))} className={`${inputCls} h-20 resize-none`} /></div>
        <div className="space-y-1.5"><label className={labelCls}>标签 (逗号分隔)</label><input type="text" value={editForm.tags} onChange={(e) => updateEdit((prev) => ({ ...prev, tags: e.target.value }))} className={inputCls} /></div>
        {editError ? <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">{editError}</div> : null}
        <button type="button" onClick={handleSave} disabled={saving} className="w-full rounded-lg bg-white py-2.5 text-xs font-bold tracking-wide text-[#07080A] shadow-lg transition-colors hover:bg-gray-200 disabled:opacity-40">{saving ? i18n.nodeDetail.actions.saveBusy : i18n.nodeDetail.actions.save}</button>
      </div>
    </div>
  );
}
