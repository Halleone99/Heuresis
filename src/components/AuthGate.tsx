import { FormEvent, ReactNode, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { LogIn } from "lucide-react";
import { readOfflineSession, rememberOfflineSession } from "../lib/offlineSession";
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

  if (loading) return <div className="boot-screen">Opening Heuresis…</div>;

  if (!supabaseConfigured || !supabase) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="brand-mark"><HeuresisMark /></div>
          <p className="eyebrow">HEURESIS DESKTOP</p>
          <h1>Connect the existing database.</h1>
          <p>The desktop client could not resolve its Supabase configuration.</p>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="auth-shell">
        <form className="auth-card" onSubmit={signIn}>
          <div className="brand-mark"><HeuresisMark /></div>
          <p className="eyebrow">HEURESIS DESKTOP</p>
          <h1>Return to your library.</h1>
          <p>Use the same Supabase account as Personal OS. Once synchronised, this device can reopen Heuresis without a connection.</p>
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label>
          <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /></label>
          {error ? <div className="form-error">{error}</div> : null}
          <button className="primary-button" disabled={submitting} type="submit"><LogIn size={16} />{submitting ? "Signing in…" : "Sign in"}</button>
        </form>
      </main>
    );
  }

  return <>{children(session)}</>;
}
