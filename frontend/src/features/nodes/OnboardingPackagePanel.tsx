import { useMemo, useState } from "react";
import type { NodeCreateResponse } from "../../types";
import { Card, Field, FieldGrid, cardClasses } from "../../ui/Card";
import { CodeBlock } from "../../ui/CodeBlock";
import { EmptyState } from "../../ui/EmptyState";
import { StatusPill } from "../../ui/StatusPill";
import { Tabs } from "../../ui/Tabs";
import { Button } from "../../ui/Button";
import {
  connectionLabel,
  connectionTone,
  nodeTypeLabel,
  onboardingLabel,
  onboardingTone,
  osLabel,
} from "../../lib/labels";
import { copyText } from "../../lib/copy";
import styles from "./OnboardingPackagePanel.module.css";

type Props = {
  pkg: NodeCreateResponse | null;
};

type PackageTab = "env" | "command" | "steps";

export function OnboardingPackagePanel({ pkg }: Props): JSX.Element {
  const [secretRevealed, setSecretRevealed] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  const [tab, setTab] = useState<PackageTab>("env");

  const maskedSecret = useMemo(() => {
    if (!pkg) return "";
    if (secretRevealed) return pkg.node_secret;
    if (pkg.node_secret.length <= 10) return "•".repeat(pkg.node_secret.length);
    return `${pkg.node_secret.slice(0, 4)}${"•".repeat(pkg.node_secret.length - 8)}${pkg.node_secret.slice(-4)}`;
  }, [pkg, secretRevealed]);

  if (!pkg) {
    return (
      <Card title="接入包" subtitle="一次性密钥与启动命令将在创建节点后立刻显示。">
        <EmptyState
          title="尚未生成接入包"
          description="创建节点后，会立即得到 node_secret、.env 模板与启动命令，整个接入流程不需要再返回这一步。"
        />
      </Card>
    );
  }

  async function handleCopySecret() {
    if (!pkg) return;
    const ok = await copyText(pkg.node_secret);
    if (ok) {
      setSecretCopied(true);
      window.setTimeout(() => setSecretCopied(false), 1600);
    }
  }

  const headlineModeNote =
    pkg.node_type === "modal_runner"
      ? "Modal 代理节点：真实的 Modal token 仅保存在宿主本地，控制面只持有密钥引用。"
      : pkg.os_type === "linux"
        ? "Linux 物理节点：建议落地路径 /opt/gpufleet-node，并以服务方式启动 agent。"
        : "Windows 物理节点：将 .env 写入 node_agent/，以普通用户运行 agent。";

  return (
    <Card
      title={
        <span className={cardClasses.titleRow}>
          接入包
          <span className={cardClasses.titleTag}>{pkg.node_id}</span>
        </span>
      }
      subtitle="把下面内容发到目标主机。子节点写入 .env、运行启动命令，控制面收到首次签名心跳即视为接入完成。"
      actions={
        <span className={cardClasses.actionsRow}>
          <StatusPill
            tone={onboardingTone[pkg.onboarding_status]}
            label={onboardingLabel[pkg.onboarding_status]}
            pulse
          />
          <StatusPill
            tone={connectionTone[pkg.connection_status]}
            label={connectionLabel[pkg.connection_status]}
          />
        </span>
      }
    >
      <div className={styles.grid}>
        <FieldGrid>
          <Field label="显示名" value={pkg.display_name} />
          <Field label="角色" value={nodeTypeLabel[pkg.node_type] ?? pkg.node_type} />
          <Field label="操作系统" value={pkg.os_type ? osLabel[pkg.os_type] ?? pkg.os_type : "—"} />
          <Field label="心跳间隔" value={`${pkg.heartbeat_interval_sec} s`} />
        </FieldGrid>

        <div className={styles.secret}>
          <div className={styles.secretHead}>
            <span className={styles.secretLabel}>node_secret · 仅显示一次</span>
            <div className={styles.secretActions}>
              <Button size="sm" variant="ghost" onClick={() => setSecretRevealed((v) => !v)}>
                {secretRevealed ? "隐藏" : "显示"}
              </Button>
              <Button size="sm" variant="ghost" onClick={handleCopySecret}>
                {secretCopied ? "已复制" : "复制"}
              </Button>
            </div>
          </div>
          <div className={styles.secretWrap}>
            <code className={styles.secretValue}>{maskedSecret}</code>
            <span className={styles.secretMode}>HMAC-SHA256</span>
          </div>
          <span className={styles.secretHint}>{headlineModeNote}</span>
        </div>

        <Tabs<PackageTab>
          value={tab}
          onChange={setTab}
          ariaLabel="接入包"
          items={[
            { value: "env", label: ".env" },
            { value: "command", label: "Startup" },
            { value: "steps", label: "Steps" },
          ]}
        />

        {tab === "env" ? (
          <>
            <CodeBlock label="GPUFLEET_AGENT_*" value={pkg.onboarding.env_template} maxHeight={320} />
            <CodeBlock label="control_plane_url" value={pkg.onboarding.control_plane_url} multiline={false} />
          </>
        ) : null}

        {tab === "command" ? (
          <>
            <CodeBlock label="$ agent · loop" value={pkg.onboarding.startup_command} multiline={false} />
            <CodeBlock
              label="$ agent · 一次性心跳"
              value="uv run gpufleet-agent heartbeat-once"
              multiline={false}
            />
          </>
        ) : null}

        {tab === "steps" ? (
          <ol className={styles.steps}>
            {pkg.onboarding.onboarding_steps.map((step, idx) => (
              <li key={`${idx}-${step}`} className={styles.step}>
                <span>{step.replace(/^\d+\.\s*/, "")}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </Card>
  );
}
