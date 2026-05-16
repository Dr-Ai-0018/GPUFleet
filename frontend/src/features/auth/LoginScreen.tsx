import { type FormEvent, useState } from "react";
import { ApiError, api } from "../../api";
import { Button } from "../../ui/Button";
import forms from "../../ui/forms.module.css";
import styles from "./LoginScreen.module.css";

type Props = {
  onAuthenticated: (token: string) => void;
};

export function LoginScreen({ onAuthenticated }: Props): JSX.Element {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123456");
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
        setError("账号或密码不正确。");
      } else {
        setError(err instanceof Error ? err.message : "登录失败");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.shell}>
      <div className={styles.frame}>
        <aside className={styles.aside}>
          <div className={styles.brand}>
            <div className={styles.brandMark} aria-hidden>G</div>
            <span className={styles.brandName}>GPUFleet</span>
            <span className={styles.brandSep} aria-hidden />
            <span className={styles.brandTag}>Control Plane</span>
          </div>

          <h1 className={styles.headline}>
            Private GPU fleet,
            <br />
            <span className={styles.headlineEm}>under one control surface.</span>
          </h1>

          <div className={styles.spec}>
            <div className={styles.specItem}>
              <span className={styles.specLabel}>CHANNEL</span>
              <span className={styles.specValue}>HMAC-SHA256</span>
            </div>
            <div className={styles.specItem}>
              <span className={styles.specLabel}>HEARTBEAT</span>
              <span className={styles.specValue}>5s · 3× offline</span>
            </div>
            <div className={styles.specItem}>
              <span className={styles.specLabel}>TENANCY</span>
              <span className={styles.specValue}>Single Operator</span>
            </div>
          </div>
        </aside>

        <section className={styles.panel}>
          <div className={styles.eyebrow}>SIGN IN</div>
          <h2 className={styles.title}>登录</h2>

          <form className={forms.stack} onSubmit={onSubmit}>
            <label className={forms.field}>
              <span className={forms.label}>账号</span>
              <input
                className={forms.input}
                value={username}
                autoComplete="username"
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </label>
            <label className={forms.field}>
              <span className={forms.label}>密码</span>
              <input
                className={forms.input}
                value={password}
                type="password"
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {error ? <div className={forms.error}>{error}</div> : null}
            <Button type="submit" variant="accent" size="lg" disabled={submitting}>
              {submitting ? "登录中…" : "进入控制台"}
            </Button>
          </form>

          <div className={styles.foot}>
            <span>GPUFleet · v0.1</span>
            <span className={styles.footMeta}>private deployment</span>
          </div>
        </section>
      </div>
    </main>
  );
}
