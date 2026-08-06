import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  FolderKanban,
  FileText,
  Play,
  GitCompare,
  Server,
  Settings as SettingsIcon,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useEffect, useState } from "react";
import { api, type K6Status, type VpnStatus } from "../lib/api";
import { Download, Loader2, ShieldAlert } from "lucide-react";

const navItems = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/tests", label: "Tests", icon: FileText },
  { to: "/runs", label: "Runs", icon: Play },
  { to: "/compare", label: "Compare", icon: GitCompare },
];

const navItemsBottom = [
  { to: "/runners", label: "Runners", icon: Server },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export default function Sidebar() {
  const [k6, setK6] = useState<K6Status | null>(null);
  const [vpn, setVpn] = useState<VpnStatus | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    api.checkK6().then(setK6).catch(() => {});
    api.checkVpn().then(setVpn).catch(() => {});
  }, []);

  async function handleInstallK6() {
    setInstalling(true);
    try {
      await api.installK6();
      const k6 = await api.checkK6();
      setK6(k6);
    } catch (e) {
      console.error("Install failed:", e);
    } finally {
      setInstalling(false);
    }
  }

  return (
    <aside className="w-52 shrink-0 border-r border-rams-border bg-rams-surface flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-rams bg-rams-text flex items-center justify-center">
          <Activity className="w-4 h-4 text-rams-bg" strokeWidth={2.5} />
        </div>
        <span className="text-sm font-semibold tracking-tight text-rams-text">
          LoadDock
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 flex flex-col gap-0.5">
        {navItems.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      {/* Bottom nav */}
      <div className="px-3 py-2 flex flex-col gap-0.5 border-t border-rams-border">
        {navItemsBottom.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </div>

      {/* K6 status */}
      <div className="px-4 py-3 border-t border-rams-border">
        {k6?.installed ? (
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-rams-pass" />
            <span className="text-2xs text-rams-text-secondary">
              k6 {k6.version ?? ""}
            </span>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-rams-fail" />
              <span className="text-2xs text-rams-text-secondary">k6 not installed</span>
            </div>
            <button
              onClick={handleInstallK6}
              disabled={installing}
              className="rams-btn rams-btn-primary w-full text-2xs"
            >
              {installing ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2} />
                  Installing…
                </>
              ) : (
                <>
                  <Download className="w-3 h-3" strokeWidth={2} />
                  Install k6
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* VPN warning */}
      {vpn?.active && (
        <div className="px-4 py-2 border-t border-rams-border">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-3 h-3 text-rams-warning" strokeWidth={1.5} />
            <span className="text-2xs text-rams-warning">VPN active — results may be affected</span>
          </div>
        </div>
      )}
    </aside>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2.5 px-2.5 py-1.5 rounded-rams text-sm transition-colors",
          isActive
            ? "bg-rams-bg text-rams-text font-medium"
            : "text-rams-text-secondary hover:text-rams-text hover:bg-rams-bg/50"
        )
      }
    >
      <Icon className="w-4 h-4" strokeWidth={1.75} />
      {label}
    </NavLink>
  );
}
