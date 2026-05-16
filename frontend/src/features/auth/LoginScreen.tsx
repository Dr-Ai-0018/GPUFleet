import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../api";
import styles from "./LoginScreen.module.css";

type Props = {
  onAuthenticated: (token: string) => void;
};

export function LoginScreen({ onAuthenticated }: Props): JSX.Element {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Spotlight effect — track mouse on panel
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    el.style.setProperty("--spot-x", `${x}px`);
    el.style.setProperty("--spot-y", `${y}px`);
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
      {/* Background layers */}
      <div className={styles.bgBase} aria-hidden />
      <div className={styles.bgOrb} aria-hidden />
      <div className={styles.bgOrb2} aria-hidden />
      <div className={styles.bgNoise} aria-hidden />
      <GridLines />

      <div className={styles.layout}>
        {/* Brand */}
        <div className={styles.brand}>
          <div className={styles.brandMark}>G</div>
          <span className={styles.brandName}>GPUFleet</span>
        </div>

        {/* Hero text with decrypt effect */}
        <DecryptText
          text="异构 GPU 节点集群"
          className={styles.heroTitle}
        />
        <DecryptText
          text="统一控制面"
          className={styles.heroSub}
          delay={600}
        />

        {/* Login panel with spotlight border */}
        <div
          ref={panelRef}
          className={styles.panel}
          onMouseMove={handleMouseMove}
        >
          <div className={styles.panelSpotlight} aria-hidden />
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
                  <span className={styles.inputGlow} aria-hidden />
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
                  <span className={styles.inputGlow} aria-hidden />
                </div>
              </div>

              {error ? <div className={styles.error}>{error}</div> : null}

              <button
                type="submit"
                className={styles.btn}
                disabled={submitting}
              >
                <span className={styles.btnShine} aria-hidden />
                {submitting ? "验证中…" : "进入控制台"}
              </button>
            </form>

            <div className={styles.foot}>
              <span className={styles.footItem}>HMAC-SHA256</span>
              <span className={styles.footDot} />
              <span className={styles.footItem}>5s 心跳</span>
              <span className={styles.footDot} />
              <span className={styles.footItem}>私有部署</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

/* ─── Decrypt text animation ─── */

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

function DecryptText({ text, className, delay = 0 }: {
  text: string;
  className?: string;
  delay?: number;
}): JSX.Element {
  const [display, setDisplay] = useState(() => text.split("").map(() => CHARS[Math.floor(Math.random() * CHARS.length)]));
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      let frame = 0;
      const interval = setInterval(() => {
        frame++;
        const revealCount = Math.floor(frame / 2);
        setRevealed(revealCount);
        setDisplay(
          text.split("").map((char, i) => {
            if (char === " ") return " ";
            if (i < revealCount) return char;
            return CHARS[Math.floor(Math.random() * CHARS.length)];
          }),
        );
        if (revealCount >= text.length) {
          clearInterval(interval);
        }
      }, 40);
      return () => clearInterval(interval);
    }, delay);
    return () => clearTimeout(timeout);
  }, [text, delay]);

  return (
    <h1 className={className}>
      {display.map((char, i) => (
        <span
          key={i}
          className={i < revealed ? styles.charRevealed : styles.charScramble}
        >
          {char === " " ? "\u00A0" : char}
        </span>
      ))}
    </h1>
  );
}

/* ─── Grid lines background ─── */

function GridLines(): JSX.Element {
  return <div className={styles.gridLines} aria-hidden />;
}
