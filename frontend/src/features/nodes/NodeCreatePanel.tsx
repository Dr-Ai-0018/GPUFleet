import { type FormEvent, useEffect, useState } from "react";
import { api } from "../../api";
import type { NodeCreateResponse, NodeType, OsType } from "../../types";
import { useConsoleStore } from "../../state/ConsoleStore";
import { useToast } from "../../ui/Toast";
import { labelForError } from "../../lib/labels";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
import forms from "../../ui/forms.module.css";
import {
  buildInitialForm,
  defaultTags,
  defaultWorkdir,
  suggestedNodeId,
  type NodeFormShape,
} from "./nodeDefaults";

type Props = {
  onCreated: (pkg: NodeCreateResponse) => void;
};

export function NodeCreatePanel({ onCreated }: Props): JSX.Element {
  const store = useConsoleStore();
  const toast = useToast();
  const [form, setForm] = useState<NodeFormShape>(() => buildInitialForm());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touchedNodeId, setTouchedNodeId] = useState(false);
  const [touchedDirs, setTouchedDirs] = useState(false);
  const [touchedTags, setTouchedTags] = useState(false);

  useEffect(() => {
    if (form.node_type === "modal_runner" && form.os_type !== "linux") {
      setForm((prev) => ({ ...prev, os_type: "linux" }));
    }
  }, [form.node_type, form.os_type]);

  useEffect(() => {
    if (touchedDirs) return;
    setForm((prev) => ({
      ...prev,
      allowed_workdirs: defaultWorkdir(prev.node_type, prev.os_type),
    }));
  }, [form.node_type, form.os_type, touchedDirs]);

  useEffect(() => {
    if (touchedTags) return;
    setForm((prev) => ({ ...prev, tags: defaultTags(prev.node_type, prev.os_type) }));
  }, [form.node_type, form.os_type, touchedTags]);

  useEffect(() => {
    if (touchedNodeId) return;
    setForm((prev) => ({ ...prev, node_id: suggestedNodeId(prev.display_name, prev.node_type) }));
  }, [form.display_name, form.node_type, touchedNodeId]);

  function update<K extends keyof NodeFormShape>(key: K, value: NodeFormShape[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!store.token) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await store.callApi((token) =>
        api.createNode(token, {
          node_id: form.node_id.trim(),
          display_name: form.display_name.trim(),
          node_type: form.node_type,
          os_type: form.node_type === "control_plane" ? null : form.os_type,
          heartbeat_interval_sec: form.heartbeat_interval_sec,
          allowed_workdirs: form.allowed_workdirs
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean),
          tags: form.tags
            .split(/[,，]/)
            .map((line) => line.trim())
            .filter(Boolean),
        }),
      );
      onCreated(response);
      store.setRecentOnboarding(response);
      toast.push({
        tone: "success",
        title: "节点已登记",
        description: response.display_name,
      });
      void store.refresh({ silent: true });
      setForm(buildInitialForm());
      setTouchedNodeId(false);
      setTouchedDirs(false);
      setTouchedTags(false);
    } catch (err) {
      setError(labelForError(err, "创建节点失败"));
    } finally {
      setSubmitting(false);
    }
  }

  const formValid = form.display_name.trim().length > 0 && form.node_id.trim().length >= 3;

  return (
    <Card title="登记节点">
      <form className={forms.stack} onSubmit={onSubmit}>
        <div className={forms.row}>
          <label className={forms.field}>
            <span className={forms.label}>显示名</span>
            <input
              className={forms.input}
              value={form.display_name}
              onChange={(event) => update("display_name", event.target.value)}
              placeholder="办公室 RTX5080"
              required
            />
          </label>
          <label className={forms.field}>
            <span className={forms.label}>node_id</span>
            <input
              className={`${forms.input} ${forms.mono}`}
              value={form.node_id}
              onChange={(event) => {
                setTouchedNodeId(true);
                update("node_id", event.target.value);
              }}
              placeholder="node-desktop-5080"
              required
              minLength={3}
            />
          </label>
        </div>

        <div className={forms.row}>
          <label className={forms.field}>
            <span className={forms.label}>角色</span>
            <select
              className={forms.select}
              value={form.node_type}
              onChange={(event) => update("node_type", event.target.value as NodeType)}
            >
              <option value="physical">physical</option>
              <option value="modal_runner">modal_runner</option>
              <option value="control_plane">control_plane</option>
            </select>
          </label>
          <label className={forms.field}>
            <span className={forms.label}>OS</span>
            <select
              className={forms.select}
              value={form.os_type}
              onChange={(event) => update("os_type", event.target.value as OsType)}
              disabled={form.node_type === "modal_runner"}
            >
              <option value="windows">windows</option>
              <option value="linux">linux</option>
            </select>
          </label>
        </div>

        <div className={forms.row}>
          <label className={forms.field}>
            <span className={forms.label}>心跳间隔 (秒)</span>
            <input
              className={forms.input}
              type="number"
              min={3}
              max={3600}
              value={form.heartbeat_interval_sec}
              onChange={(event) =>
                update("heartbeat_interval_sec", Number(event.target.value || 5))
              }
            />
          </label>
          <label className={forms.field}>
            <span className={forms.label}>标签</span>
            <input
              className={forms.input}
              value={form.tags}
              onChange={(event) => {
                setTouchedTags(true);
                update("tags", event.target.value);
              }}
              placeholder="desktop, 24x7"
            />
          </label>
        </div>

        <label className={forms.field}>
          <span className={forms.label}>允许的工作目录</span>
          <textarea
            className={forms.textarea}
            rows={3}
            value={form.allowed_workdirs}
            onChange={(event) => {
              setTouchedDirs(true);
              update("allowed_workdirs", event.target.value);
            }}
            placeholder="每行一个绝对路径"
          />
        </label>

        {error ? <div className={forms.error}>{error}</div> : null}

        <div className={forms.actions}>
          <Button type="submit" variant="accent" size="md" disabled={submitting || !formValid}>
            {submitting ? "登记中…" : "登记并下发密钥"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
