import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import AuthPage from "./components/AuthPage";
import { DevicesProvider, useDevices } from "./components/DevicesContext";
import { IconAnalytics, IconDevices, IconHistory, IconOverview, IconSettings, Logo } from "./components/Icons";
import Legal from "./components/Legal";
import { StatusTag } from "./components/Ui";
import { Link, usePath } from "./lib/router";
import { supabase } from "./lib/supabase";
import Analytics from "./pages/Analytics";
import Devices from "./pages/Devices";
import History from "./pages/History";
import Overview from "./pages/Overview";
import Settings from "./pages/Settings";
import "./App.css";

type NavItem = { to: string; label: string; icon: ReactNode };

const NAV: NavItem[] = [
  { to: "/", label: "Overview", icon: <IconOverview /> },
  { to: "/analytics", label: "Analytics", icon: <IconAnalytics /> },
  { to: "/history", label: "History", icon: <IconHistory /> },
  { to: "/devices", label: "Devices", icon: <IconDevices /> },
  { to: "/settings", label: "Settings", icon: <IconSettings /> },
];

function NavLinks({ path }: { path: string }) {
  return (
    <>
      {NAV.map((item) => (
        <Link key={item.to} to={item.to} className={`nav-item${path === item.to ? " active" : ""}`} current={path === item.to}>
          {item.icon}
          <span>{item.label}</span>
        </Link>
      ))}
    </>
  );
}

function NotFound() {
  return (
    <section className="panel">
      <div className="empty-state">
        <div className="empty-state-line" />
        <h3>Page not found</h3>
        <p>That address does not exist.</p>
        <Link to="/" className="btn btn-primary">
          Go to overview
        </Link>
      </div>
    </section>
  );
}

function Shell({ path, email }: { path: string; email: string }) {
  const { devices, selected, select } = useDevices();

  let page: ReactNode;
  switch (path) {
    case "/":
      page = <Overview />;
      break;
    case "/analytics":
      page = <Analytics />;
      break;
    case "/history":
      page = <History />;
      break;
    case "/devices":
      page = <Devices />;
      break;
    case "/settings":
      page = <Settings email={email} />;
      break;
    default:
      page = <NotFound />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="brand" title="AquaSense home">
          <Logo />
          <span className="brand-name">AquaSense</span>
        </Link>
        <nav className="side-nav" aria-label="Main navigation">
          <NavLinks path={path} />
        </nav>
        <div className="sidebar-bottom">
          <span className="muted-text small">{email}</span>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="content-wrap">
        <header className="topbar">
          <Link to="/" className="brand brand-mobile" title="AquaSense home">
            <Logo size={26} />
            <span className="brand-name">AquaSense</span>
          </Link>
          <div className="topbar-right">
            {devices.length > 1 && (
              <label className="device-select">
                <span className="visually-hidden">Choose device</span>
                <select value={selected?.device_id ?? ""} onChange={(event) => select(event.target.value)}>
                  {devices.map((d) => (
                    <option key={d.device_id} value={d.device_id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selected && <StatusTag online={selected.online} />}
          </div>
        </header>

        <main className="main-content">
          <div className="page" key={path}>
            {page}
          </div>
          <footer className="page-footer">
            <span>AquaSense</span>
            <span className="footer-links">
              <Link to="/privacy">Privacy Policy</Link>
              <Link to="/terms">Terms</Link>
            </span>
          </footer>
        </main>
      </div>

      <nav className="tabbar" aria-label="Main navigation">
        <NavLinks path={path} />
      </nav>
    </div>
  );
}

function App() {
  const path = usePath();
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function initializeAuth() {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;
      if (error) console.error("Session check failed:", error.message);
      setSession(data.session);
      setAuthLoading(false);
    }

    void initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (path === "/privacy") return <Legal kind="privacy" />;
  if (path === "/terms") return <Legal kind="terms" />;

  if (authLoading) return <div className="boot">Loading AquaSense</div>;
  if (!session) return <AuthPage />;

  return (
    <DevicesProvider>
      <Shell path={path} email={session.user.email ?? ""} />
    </DevicesProvider>
  );
}

export default App;
