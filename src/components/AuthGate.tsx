import { FormEvent, ReactNode, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowRight, BookOpenText, Eye, EyeOff, LockKeyhole, WifiOff } from "lucide-react";
import { readOfflineSession, rememberOfflineSession } from "../lib/offlineSession";
import { setOfflineAccount } from "../lib/offlineFetch";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { reconcileStaleHeuresisSessions } from "../lib/sessionLifecycle";
import HeuresisMark from "./HeuresisMark";

type Props = { children: (session: Session) => ReactNode };

export default function AuthGate({ children }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let alive = true;
    let reconciledUserId = "";
    const reconcile = (next: Session | null) => {
      const userId = next?.user.id ?? "";
      if (!userId || reconciledUserId === userId) return;
      reconciledUserId = userId;
      void reconcileStaleHeuresisSessions().catch((reconcileError) => {
        console.warn("Could not reconcile stale Heuresis sessions", reconcileError);
      });
    };
    const acceptSession = (next: Session | null) => {
      const usable = next ?? ((typeof navigator !== "undefined" && !navigator.onLine) ? readOfflineSession() : null);
      setOfflineAccount(usable?.user.id ?? null);
      setSession(usable);
      rememberOfflineSession(usable);
      reconcile(usable);
    };

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!alive) return;
      acceptSession(next);
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      acceptSession(data.session);
      setLoading(false);
    }).catch(() => {
      if (!alive) return;
      acceptSession(readOfflineSession());
      setLoading(false);
    });

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSubmitting(true);
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) setError(signInError.message);
    setSubmitting(false);
  }

  if (loading) return (
    <main className="auth-shell auth-shell--blue">
      <div className="auth-loading" role="status" aria-live="polite">
        <div className="auth-emblem"><HeuresisMark /></div>
        <span>Opening your library…</span>
      </div>
    </main>
  );

  if (!supabaseConfigured || !supabase) {
    return (
      <main className="auth-shell auth-shell--blue">
        <section className="auth-card auth-card--notice">
          <div className="auth-emblem"><HeuresisMark /></div>
          <p className="auth-kicker">HEURESIS · CONNECTION</p>
          <h1>Library unavailable.</h1>
          <p>The application could not find its Supabase configuration. Check your installation settings and reopen Heuresis.</p>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="auth-shell auth-shell--blue">
        <div className="auth-layout">
          <section className="auth-intro" aria-labelledby="auth-intro-title">
            <div className="auth-wordmark">
              <div className="auth-emblem"><HeuresisMark /></div>
              <div className="auth-wordmark-text"><strong>Heuresis</strong><span>KNOWLEDGE WORKSPACE</span></div>
            </div>
            <div className="auth-intro-content">
              <div className="auth-overline"><span /> A MORE CONSIDERED WAY TO LEARN</div>
              <h1 id="auth-intro-title">Make room for <em>everything you discover.</em></h1>
              <p>Reading, languages, ideas and notes — one quiet place for what you learn and want to remember.</p>
              <div className="auth-chapters" aria-label="Your library">
                <span><BookOpenText size={17} strokeWidth={1.7} /> Read</span>
                <i aria-hidden="true" />
                <span>Connect</span>
                <i aria-hidden="true" />
                <span>Remember</span>
              </div>
            </div>
            <div className="auth-intro-footer"><span>Η</span> YOUR PERSONAL LIBRARY</div>
          </section>

          <section className="auth-form-panel" aria-label="Sign in to Heuresis">
            <form className="auth-card auth-card--blue" onSubmit={signIn}>
              <p className="auth-kicker"><LockKeyhole size={13} strokeWidth={1.8} /> PRIVATE LIBRARY ACCESS</p>
              <h2>Welcome back.</h2>
              <p className="auth-form-description">Sign in to continue where you left off.</p>

              <div className="auth-fields">
                <label htmlFor="heuresis-sign-in-email">Email address</label>
                <input id="heuresis-sign-in-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" autoCapitalize="none" placeholder="you@example.com" />
                <label htmlFor="heuresis-sign-in-password">Password</label>
                <div className="auth-password-wrap">
                  <input id="heuresis-sign-in-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" placeholder="Enter your password" />
                  <button type="button" className="auth-password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>

              {error ? <p className="form-error auth-error" role="alert">{error}</p> : null}
              <button className="auth-submit" disabled={submitting} type="submit">
                <span>{submitting ? "Signing in…" : "Open my library"}</span>
                <ArrowRight size={18} aria-hidden="true" />
              </button>
              <div className="auth-form-divider" aria-hidden="true" />
              <p className="auth-account-help">Use the same Supabase account as Personal OS.</p>
              <p className="auth-offline-note"><WifiOff size={15} strokeWidth={1.8} aria-hidden="true" /> After synchronisation, this device can reopen your library offline.</p>
            </form>
            <span className="auth-form-footnote">HEURESIS · A PLACE TO THINK AND REMEMBER</span>
          </section>
        </div>
      </main>
    );
  }

  return <>{children(session)}</>;
}
