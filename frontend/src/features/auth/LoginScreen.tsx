import { type FormEvent, useCallback, useRef, useState, lazy, Suspense } from "react";
import { ApiError, api } from "../../api";
import { motion } from "motion/react";
import styles from "./LoginScreen.module.css";

const ParticleField = lazy(() => import("../../ui/ParticleField").then(m => ({ default: m.ParticleField })));

type Props = {
  onAuthenticated: (token: string) => void;
};

export function LoginScreen({ onAuthenticated }: Props): JSX.Element {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
  }, []);

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
      {/* 3D particle background */}
      <Suspense fallback={null}>
        <ParticleField />
      </Suspense>

      {/* Noise overlay */}
      <div className={styles.noise} aria-hidden />

      <div className={styles.layout}>
        {/* Brand */}
        <motion.div
          className={styles.brand}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className={styles.brandMark}>G</div>
          <span className={styles.brandName}>GPUFleet</span>
        </motion.div>

        {/* Hero */}
        <motion.h1
          className={styles.hero}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        >
          异构 GPU 节点集群
          <br />
          <span className={styles.heroGradient}>统一控制面</span>
        </motion.h1>

        <motion.p
          className={styles.heroSub}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          节点接入 · 任务派发 · 安全审计 · 实时心跳
        </motion.p>

        {/* Panel */}
        <motion.div
          ref={panelRef}
          className={styles.panel}
          onMouseMove={handleMouseMove}
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className={styles.panelBorderGlow} aria-hidden />
          <div className={styles.panelInner}>
            <h2 className={styles.panelTitle}>登录</h2>

            <form className={styles.form} onSubmit={onSubmit}>
              <div className={styles.inputGroup}>
                <label className={styles.inputLabel}>账号</label>
                <div className={styles.inputWrap}>
                  <input
                    className={styles.input}
                    value={username}
                    autoComplete="username"
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="管理员账号"
                    required
                  />
                  <span className={styles.inputLine} aria-hidden />
                </div>
              </div>

              <div className={styles.inputGroup}>
                <label className={styles.inputLabel}>密码</label>
                <div className={styles.inputWrap}>
                  <input
                    className={styles.input}
                    value={password}
                    type="password"
                    autoComplete="current-password"
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="输入密码"
                    required
                  />
                  <span className={styles.inputLine} aria-hidden />
                </div>
              </div>

              {error ? (
                <motion.div
                  className={styles.error}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  transition={{ duration: 0.2 }}
                >
                  {error}
                </motion.div>
              ) : null}

              <motion.button
                type="submit"
                className={styles.btn}
                disabled={submitting}
                whileHover={{ scale: 1.01, y: -1 }}
                whileTap={{ scale: 0.98 }}
              >
                <span className={styles.btnGlow} aria-hidden />
                <span className={styles.btnText}>
                  {submitting ? "验证中…" : "进入控制台"}
                </span>
              </motion.button>
            </form>

            <div className={styles.foot}>
              <span>HMAC-SHA256</span>
              <span className={styles.footDot} />
              <span>5s 心跳</span>
              <span className={styles.footDot} />
              <span>私有部署</span>
            </div>
          </div>
        </motion.div>
      </div>
    </main>
  );
}
