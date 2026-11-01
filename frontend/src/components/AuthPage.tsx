import { useState, type FormEvent } from "react";
import { Link } from "../lib/router";
import { supabase } from "../lib/supabase";
import { Logo } from "./Icons";
import "./AuthPage.css";

type AuthMode = "login" | "signup";

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function switchMode(next: AuthMode) {
    setMode(next);
    setError("");
    setMessage("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() } },
        });

        if (error) throw error;

        if (data.session) {
          setMessage("Account created. You are signed in.");
        } else {
          setMessage("Account created. Check your email to confirm your address, then sign in.");
          setMode("login");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) throw error;
        setMessage("Signed in. Opening your dashboard.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-brand">
          <Logo size={32} />
          <span>AquaSense</span>
        </div>

        <div className="auth-intro">
          <p className="auth-eyebrow">Water tank monitoring</p>
          <h1>Tank level, pump activity and usage history in one place.</h1>
          <p>Connect an ESP32 with an ultrasonic sensor, then check your tank from your phone or laptop. Several accounts can follow the same device.</p>
        </div>

        <p className="auth-panel-footer">
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms</Link>
        </p>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-container">
          <p className="auth-eyebrow">AquaSense account</p>
          <h2>{mode === "login" ? "Sign in" : "Create your account"}</h2>
          <p className="auth-subtitle">
            {mode === "login" ? "Use the email and password you registered with." : "It takes less than a minute."}
          </p>

          <div className="auth-tabs" role="group" aria-label="Sign in or create account">
            <button type="button" className={mode === "login" ? "auth-tab active" : "auth-tab"} aria-pressed={mode === "login"} onClick={() => switchMode("login")}>
              Sign in
            </button>
            <button type="button" className={mode === "signup" ? "auth-tab active" : "auth-tab"} aria-pressed={mode === "signup"} onClick={() => switchMode("signup")}>
              Create account
            </button>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {mode === "signup" && (
              <label className="auth-field">
                <span>Full name</span>
                <input type="text" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required />
              </label>
            )}

            <label className="auth-field">
              <span>Email address</span>
              <input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>

            <label className="auth-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="At least 8 characters"
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>

            {error && <p className="auth-message error" role="alert">{error}</p>}
            {message && <p className="auth-message success">{message}</p>}

            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? "Please wait" : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          <p className="auth-terms">
            By continuing you agree to the <Link to="/terms">Terms</Link> and the <Link to="/privacy">Privacy Policy</Link>.
          </p>
        </div>
      </section>
    </main>
  );
}
