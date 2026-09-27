import { useEffect, useRef } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Select } from "./components/ui";
import { useApp } from "./context/app";
import { usePref } from "./lib/hooks";
import { CampaignDetail, CampaignList } from "./views/campaigns";
import { CharacterList, CharacterSheet } from "./views/characters";
import { DataPage } from "./views/data";
import { HandbookEditor, HandbookList } from "./views/handbook";
import { Reference } from "./views/reference";
import { SessionDetail, SessionList } from "./views/sessions";
import { Tools } from "./views/tools";

const NAV = [
  { to: "/", icon: "🗺️", label: "Campaigns", match: (p: string) => p === "/" || p.startsWith("/campaigns") },
  { to: "/sessions", icon: "⚔️", label: "Sessions" },
  { to: "/characters", icon: "🧙", label: "Characters" },
  { to: "/reference", icon: "📖", label: "Rules & SRD" },
  { to: "/handbook", icon: "📜", label: "Handbook" },
  { to: "/tools", icon: "🧮", label: "Dice & Calculator" },
  { to: "/data", icon: "💾", label: "Import / Export" },
];

function CampaignPicker() {
  const { campaigns, campaignId, setCampaignId } = useApp();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <div className="campaign-pick">
      <span className="small muted">Campaign</span>
      <Select
        aria-label="Active campaign"
        value={campaignId}
        options={[["", campaigns.length ? "All campaigns" : "No campaigns yet"], ...campaigns.map((c): [string, string] => [c.id, c.name])]}
        onChange={(v) => {
          setCampaignId(v);
          if (pathname.startsWith("/campaigns/")) navigate(v ? `/campaigns/${v}` : "/");
        }}
      />
    </div>
  );
}

function useTheme() {
  const [theme, setTheme] = usePref<"" | "light" | "dark">("theme", "");
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);
  return () => {
    const dark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(dark ? "light" : "dark");
  };
}

export default function App() {
  const toggleTheme = useTheme();
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  useEffect(() => main.current?.focus({ preventScroll: true }), [pathname]);

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <NavLink className="brand" to="/"><span aria-hidden="true">🎲</span> Pocket DM</NavLink>
        <CampaignPicker />
        <ul className="nav">
          {NAV.map((n) => (
            <li key={n.to}>
              <NavLink to={n.to} end={n.to === "/"} className={({ isActive }) => ((n.match ? n.match(pathname) : isActive) ? "active" : "")}>
                <span aria-hidden="true">{n.icon}</span> {n.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="sidebar-foot">
          <button type="button" className="link small" onClick={toggleTheme}>Toggle theme</button>
        </div>
      </nav>
      <main ref={main} tabIndex={-1}>
        <Routes>
          <Route path="/" element={<CampaignList />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/sessions" element={<SessionList />} />
          <Route path="/sessions/:id/:tab?" element={<SessionDetail />} />
          <Route path="/characters" element={<CharacterList />} />
          <Route path="/characters/:id" element={<CharacterSheet />} />
          <Route path="/reference/*" element={<Reference />} />
          <Route path="/handbook" element={<HandbookList />} />
          <Route path="/handbook/:id" element={<HandbookEditor />} />
          <Route path="/tools" element={<Tools />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="*" element={<CampaignList />} />
        </Routes>
      </main>
    </div>
  );
}
