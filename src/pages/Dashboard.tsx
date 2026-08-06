import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type DashboardStats, type RecentRun } from "../lib/api";
import { formatMs, formatDate, cn } from "../lib/utils";
import { FolderKanban, FileText, Play, Server, AlertCircle, CheckCircle2, XCircle, Loader2, type LucideIcon } from "lucide-react";

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recent, setRecent] = useState<RecentRun[]>([]);
  const [active, setActive] = useState<RecentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.getDashboardStats(),
      api.getRecentRuns(10),
      api.getActiveRuns(),
    ])
      .then(([s, r, a]) => {
        setStats(s);
        setRecent(r);
        setActive(a);
      })
      .catch((err) => {
        console.error("Dashboard load error:", err);
        setError(String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-8 text-rams-text-secondary text-sm">Loading…</div>;
  }

  if (error) {
    return (
      <div className="p-8 max-w-5xl animate-fade-in">
        <h1 className="text-xl font-semibold mb-6">Overview</h1>
        <div className="rams-card p-6">
          <p className="text-sm text-rams-fail mb-2">Failed to load dashboard data</p>
          <p className="text-2xs text-rams-text-secondary font-mono">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl animate-fade-in">
      <h1 className="text-xl font-semibold mb-2">Overview</h1>
      <p className="text-2xs text-rams-text-muted mb-6">
        Summary of your load testing activity. Click any stat below to jump to that section.
      </p>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-px bg-rams-border border border-rams-border rounded-rams overflow-hidden mb-8">
        <StatCard icon={FolderKanban} label="Projects" value={stats?.projects ?? 0} to="/projects" />
        <StatCard icon={FileText} label="Tests" value={stats?.tests ?? 0} to="/tests" />
        <StatCard icon={Play} label="Runs this month" value={stats?.runs_this_month ?? 0} to="/runs" />
        <StatCard icon={Server} label="Active runs" value={stats?.active_runs ?? 0} to="/runs" highlight={(stats?.active_runs ?? 0) > 0} />
      </div>

      {/* Active runs */}
      {active.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-medium text-rams-text-secondary">Active Tests</h2>
            <span className="inline-flex items-center gap-1 text-2xs text-rams-running font-medium px-1.5 py-0.5 rounded-rams bg-rams-running/10">
              <span className="w-1.5 h-1.5 rounded-full bg-rams-running animate-blink" />
              {active.length} LIVE
            </span>
          </div>
          <div className="rams-card divide-y divide-rams-border">
            {active.map((run) => (
              <div key={run.id} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <div className="relative flex items-center justify-center w-6 h-6">
                    <span className="absolute w-2.5 h-2.5 rounded-full bg-rams-running animate-pulse-ring" />
                    <span className="relative w-2 h-2 rounded-full bg-rams-running animate-pulse-subtle" />
                  </div>
                  <span className="text-sm font-medium">{run.project_name}</span>
                  <span className="text-sm text-rams-text-secondary">{run.test_name}</span>
                </div>
                <Link to={`/runs/${run.id}`} className="text-sm text-rams-text-secondary hover:text-rams-text">
                  View →
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent runs */}
      <section>
        <h2 className="text-sm font-medium text-rams-text-secondary mb-3">Recent Runs</h2>
        {recent.length === 0 ? (
          <div className="rams-card p-8 text-center">
            <AlertCircle className="w-5 h-5 text-rams-text-muted mx-auto mb-2" strokeWidth={1.5} />
            <p className="text-sm text-rams-text-secondary">No test runs yet</p>
            <Link to="/projects" className="text-sm text-rams-accent mt-2 inline-block">
              Create your first test →
            </Link>
          </div>
        ) : (
          <div className="rams-card overflow-hidden">
            <table className="rams-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Test</th>
                  <th>Result</th>
                  <th>p95</th>
                  <th>Run</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((run) => (
                  <tr key={run.id} className="hover:bg-rams-bg/50 cursor-pointer transition-colors" onClick={() => window.location.href = `/runs/${run.id}`}>
                    <td className="font-medium">{run.project_name}</td>
                    <td className="text-rams-text-secondary">{run.test_name}</td>
                    <td>
                      <StatusBadge status={run.status} passed={run.threshold_passed} />
                    </td>
                    <td className="font-mono text-2xs">{formatMs(run.p95)}</td>
                    <td className="text-rams-text-secondary text-2xs">{formatDate(run.started_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  to,
  highlight,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  to: string;
  highlight?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn("bg-rams-surface px-5 py-4 hover:bg-rams-bg/50 transition-all group relative overflow-hidden", highlight && "bg-rams-running/5")}
    >
      {highlight && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-rams-running overflow-hidden">
          <div className="h-full" style={{ background: "linear-gradient(90deg, transparent, rgba(45,106,159,0.6), transparent)", backgroundSize: "200% 100%", animation: "shimmer 2s linear infinite" }} />
        </div>
      )}
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("w-3.5 h-3.5 transition-colors", highlight ? "text-rams-running" : "text-rams-text-muted", "group-hover:text-rams-text")} strokeWidth={1.5} />
        <span className="text-2xs text-rams-text-secondary uppercase tracking-wider">{label}</span>
      </div>
      <div className={cn("text-2xl font-semibold tabular-nums", highlight && "text-rams-running")}>{value}</div>
    </Link>
  );
}

function StatusBadge({ status, passed }: { status: string; passed: boolean | null }) {
  const config = {
    completed: { color: passed ? "bg-rams-pass" : "bg-rams-fail", label: passed ? "Passed" : "Failed", icon: passed ? <CheckCircle2 className="w-3 h-3 text-rams-pass" strokeWidth={2} /> : <XCircle className="w-3 h-3 text-rams-fail" strokeWidth={2} /> },
    running: { color: "bg-rams-running", label: "Running", icon: <Loader2 className="w-3 h-3 text-rams-running animate-spin" strokeWidth={2} /> },
    failed: { color: "bg-rams-fail", label: "Failed", icon: <XCircle className="w-3 h-3 text-rams-fail" strokeWidth={2} /> },
    stopped: { color: "bg-rams-text-muted", label: "Stopped", icon: null },
    pending: { color: "bg-rams-warning", label: "Pending", icon: null },
  };
  const c = config[status as keyof typeof config] ?? { color: "bg-rams-text-muted", label: status, icon: null };
  return (
    <span className="inline-flex items-center gap-1.5 text-2xs">
      {c.icon}
      <span className={cn("w-1.5 h-1.5 rounded-full", c.color)} />
      <span>{c.label}</span>
    </span>
  );
}
