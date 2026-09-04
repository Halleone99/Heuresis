import { FormEvent, ReactNode, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { LogIn } from "lucide-react";
import { supabase, supabaseConfigured } from "../lib/supabase";

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
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (alive) setSession(next);
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
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
          <div className="brand-mark">H</div>
          <p className="eyebrow">HEURESIS DESKTOP</p>
          <h1>Connect the existing database.</h1>
          <p>Copy the Personal OS Supabase URL and publishable key into a local <code>.env</code> file using <code>.env.example</code>.</p>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="auth-shell">
        <form className="auth-card" onSubmit={signIn}>
          <div className="brand-mark">H</div>
          <p className="eyebrow">HEURESIS DESKTOP</p>
          <h1>Return to your library.</h1>
          <p>Use the same Supabase account as Personal OS. The desktop session is stored locally on this device.</p>
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
