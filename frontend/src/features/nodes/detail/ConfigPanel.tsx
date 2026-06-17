import { i18n } from "../../../lib/i18n";
import { Dropdown } from "../../../ui/Dropdown";
import type { NodeResponse } from "../../../types";
import type { NodeEditForm } from "./types";

type Props = {
  node: NodeResponse;
  editForm: NodeEditForm;
  updateEdit: (updater: (prev: NodeEditForm) => NodeEditForm) => void;
  editError: string | null;
  saving: boolean;
  handleSave: () => void;
};

// OpenAI Platform 风格: 14px sans 标签, 13.5px sans 输入框, 极轻边框, 不用 mono
const FIELD_LABEL = "block text-[13px] font-medium text-gray-300 mb-1.5";
const FIELD_HELP = "mt-1.5 text-[12px] leading-5 text-gray-500";
const INPUT_BASE =
  "w-full rounded-md border border-white/[0.07] bg-[#0a0d12] px-3 py-2 text-[13px] text-white outline-none transition-colors placeholder:text-gray-600 focus:border-cyan-400/40 focus:bg-[#0c1017] focus:ring-2 focus:ring-cyan-400/[0.08]";

export function ConfigPanel({
  node,
  editForm,
  updateEdit,
  editError,
  saving,
  handleSave,
}: Props): JSX.Element {
  const currentBackend = node.allowed_workdirs[0] ?? i18n.common.dash;

  return (
    <div className="mx-auto max-w-[820px] py-2">
      {/* Page heading */}
      <header className="mb-10">
        <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-white">环境配置</h2>
        <p className="mt-1.5 text-[13px] leading-6 text-gray-500">
          配置节点的基本信息、心跳频率、工作目录与标签。修改后点击右下角保存生效。
        </p>
      </header>

      {/* ───── Section: Identity ───── */}
      <section className="border-t border-white/[0.045] py-8">
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-[200px_1fr]">
          <div className="md:pr-4">
            <h3 className="text-[14px] font-semibold text-white">基本身份</h3>
            <p className="mt-1 text-[12px] leading-5 text-gray-500">用于在控制台中辨认此节点。</p>
          </div>
          <div className="space-y-5">
            <div>
              <label className={FIELD_LABEL}>显示名 <span className="text-gray-600">Display Name</span></label>
              <input
                type="text"
                value={editForm.display_name}
                onChange={(e) => updateEdit((prev) => ({ ...prev, display_name: e.target.value }))}
                className={INPUT_BASE}
              />
            </div>
            <div>
              <label className={FIELD_LABEL}>主机名 <span className="text-gray-600">Hostname</span></label>
              <input
                type="text"
                value={editForm.hostname}
                onChange={(e) => updateEdit((prev) => ({ ...prev, hostname: e.target.value }))}
                className={INPUT_BASE}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ───── Section: Runtime ───── */}
      <section className="border-t border-white/[0.045] py-8">
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-[200px_1fr]">
          <div className="md:pr-4">
            <h3 className="text-[14px] font-semibold text-white">运行时设置</h3>
            <p className="mt-1 text-[12px] leading-5 text-gray-500">控制操作系统、心跳频率等行为参数。</p>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className={FIELD_LABEL}>操作系统 <span className="text-gray-600">OS</span></label>
              <Dropdown
                value={editForm.os_type}
                onChange={(v) => updateEdit((prev) => ({ ...prev, os_type: v as NodeEditForm["os_type"] }))}
                options={[
                  { value: "windows", label: "Windows" },
                  { value: "linux", label: "Linux" },
                ]}
              />
            </div>
            <div>
              <label className={FIELD_LABEL}>心跳间隔 <span className="text-gray-600">Heartbeat (s)</span></label>
              <input
                type="number"
                min={3}
                max={3600}
                value={editForm.heartbeat_interval_sec}
                onChange={(e) => updateEdit((prev) => ({ ...prev, heartbeat_interval_sec: Number(e.target.value || 5) }))}
                className={INPUT_BASE}
              />
              <p className={FIELD_HELP}>建议 3–60 秒。过短会增大上传开销,过长延迟会影响实时性。</p>
            </div>
          </div>
        </div>
      </section>

      {/* ───── Section: Workdir & Tags ───── */}
      <section className="border-t border-white/[0.045] py-8">
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-[200px_1fr]">
          <div className="md:pr-4">
            <h3 className="text-[14px] font-semibold text-white">权限与归类</h3>
            <p className="mt-1 text-[12px] leading-5 text-gray-500">
              限制任务可写入的工作目录,以及供舰队检索的标签。
            </p>
          </div>
          <div className="space-y-5">
            <div>
              <label className={FIELD_LABEL}>允许的工作目录 <span className="text-gray-600">Allowed Workdirs</span></label>
              <textarea
                value={editForm.allowed_workdirs}
                onChange={(e) => updateEdit((prev) => ({ ...prev, allowed_workdirs: e.target.value }))}
                className={`${INPUT_BASE} h-24 resize-y font-mono text-[12.5px]`}
                placeholder="每行一个绝对路径,例如 E:/GPUFleetNode"
              />
              <p className={FIELD_HELP}>每行一个绝对路径。任务尝试写入此白名单外的目录将被节点直接拒绝。</p>
            </div>
            <div>
              <label className={FIELD_LABEL}>标签 <span className="text-gray-600">Tags</span></label>
              <input
                type="text"
                value={editForm.tags}
                onChange={(e) => updateEdit((prev) => ({ ...prev, tags: e.target.value }))}
                className={INPUT_BASE}
                placeholder="逗号分隔,例如 windows, lab-a, rtx-3050"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ───── Section: Current backend (read-only display) ───── */}
      <section className="border-t border-white/[0.045] py-8">
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-[200px_1fr]">
          <div className="md:pr-4">
            <h3 className="text-[14px] font-semibold text-white">当前后端</h3>
            <p className="mt-1 text-[12px] leading-5 text-gray-500">节点 agent 上报的默认 Python 环境。</p>
          </div>
          <div className="rounded-md border border-white/[0.05] bg-[#0a0d12] px-4 py-3.5">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]" />
              <span className="text-[13px] font-medium text-white">.venv (Default Workspace)</span>
            </div>
            <div className="mt-2 font-mono text-[12px] text-gray-500">{currentBackend}</div>
            <div className="mt-1 font-mono text-[12px] text-cyan-400">Python env</div>
          </div>
        </div>
      </section>

      {/* ───── Footer: Save action ───── */}
      <div className="mt-8 flex items-center justify-end gap-4 border-t border-white/[0.045] pt-6">
        {editError ? (
          <span className="mr-auto rounded-md border border-red-500/20 bg-red-500/[0.08] px-3 py-1.5 text-[12.5px] text-red-300">
            {editError}
          </span>
        ) : null}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md border border-cyan-400/40 bg-cyan-500/[0.14] px-5 py-2 text-[13px] font-semibold text-cyan-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-all hover:border-cyan-400/60 hover:bg-cyan-500/[0.22] hover:text-cyan-100 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_18px_-4px_rgba(15,240,179,0.4)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? i18n.nodeDetail.actions.saveBusy : i18n.nodeDetail.actions.save}
        </button>
      </div>
    </div>
  );
}
