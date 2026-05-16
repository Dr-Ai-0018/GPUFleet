import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../api";
import { Button } from "../../ui/Button";
import forms from "../../ui/forms.module.css";
import styles from "./LoginScreen.module.css";

type Props = {
  onAuthenticated: (token: string) => void;
};

export function LoginScreen({ onAuthenticated }: Props): JSX.Element {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const pair = await api.login(username, password);
      onAuthenticated(pair.access_token);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("账号或密码不正确");
      } else {
        setError(err instanceof Error ? err.message : "登录失败");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.shell}>
      {/* Animated background mesh */}
      <div className={styles.bgMesh} aria-hidden />
      <div className={styles.bgOrb1} aria-hidden />
      <div className={styles.bgOrb2} aria-hidden />
      <div className={styles.bgGrid} aria-hidden />

      <div className={styles.frame}>
        {/* Left: identity */}
        <aside className={styles.aside}>
          <div className={styles.brand}>
            <div className={styles.brandMark}>G</div>
            <span className={styles.brandName}>GPUFleet</span>
          </div>

          <div className={styles.heroBlock}>
            <ShinyText text="异构 GPU 节点集群控制台" />
            <p className={styles.heroSub}>
              节点接入 · 任务派发 · 安全审计 · 实时心跳
            </p>
          </div>

          <div className={styles.features}>
            <FeatureItem icon="🔐" label="HMAC-SHA256 签名通道" />
            <FeatureItem icon="💓" label="5s 心跳 · 3× 超时离线" />
            <FeatureItem icon="🖥" label="异构节点统一管控" />
          </div>
        </aside>

        {/* Right: login form */}
        <section className={styles.panel}>
          <div className={styles.panelGlow} aria-hidden />
          <h2 className={styles.panelTitle}>登录</h2>
          <p className={styles.panelSub}>进入 GPUFleet 控制台</p>

          <form className={styles.form} onSubmit={onSubmit}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>账号</span>
              <input
                className={styles.input}
                value={username}
                autoComplete="username"
                onChange={(e) => setUsername(e.target.value)}
                placeholder="输入管理员账号"
                required
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>密码</span>
              <input
                className={styles.input}
                value={password}
                type="password"
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                placeholder="输入密码"
                required
              />
            </label>
            {error ? <div className={styles.error}>{error}</div> : null}
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={submitting}
            >
              <span className={styles.submitBtnBg} aria-hidden />
              <span className={styles.submitBtnText}>
                {submitting ? "登录中…" : "进入控制台"}
              </span>
            </button>
          </form>

          <div className={styles.panelFoot}>
            <span>GPUFleet v0.1</span>
            <span>私有部署</span>
          </div>
        </section>
      </div>
    </main>
  );
}

/* ─── Shiny animated text ─── */

function ShinyText({ text }: { text: string }): JSX.Element {
  return (
    <h1 className={styles.shinyText}>
      {text.split("").map((char, i) => (
        <span
          key={i}
          className={styles.shinyChar}
          style={{ animationDelay: `${i * 0.03}s` }}
        >
          {char === " " ? "\u00A0" : char}
        </span>
      ))}
    </h1>
  );
}

/* ─── Feature item ─── */

function FeatureItem({ icon, label }: { icon: string; label: string }): JSX.Element {
  return (
    <div className={styles.featureItem}>
      <span className={styles.featureIcon}>{icon}</span>
      <span className={styles.featureLabel}>{label}</span>
    </div>
  );
}
