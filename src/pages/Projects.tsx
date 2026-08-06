import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api, type Project, type Test, type Environment } from "../lib/api";
import { formatDate } from "../lib/utils";
import { Plus, Trash2, Globe, ChevronRight, X, Zap, Activity, Flame, TrendingUp, Clock, Play, Loader2, KeyRound, Server, Save, AlertTriangle } from "lucide-react";

export default function Projects() {
  const { projectId } = useParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [tests, setTests] = useState<Test[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getProjects().then((p) => {
      setProjects(p);
      if (projectId) {
        const found = p.find((x) => x.id === projectId);
        if (found) selectProject(found);
      }
      setLoading(false);
    }).catch((err) => {
      console.error("Projects load error:", err);
      setError(String(err));
      setLoading(false);
    });
  }, []);

  async function selectProject(project: Project) {
    setSelected(project);
    const t = await api.getTests(project.id);
    setTests(t);
  }

  async function handleCreate(f: NewProjectFields) {
    const p = await api.createProject({
      name: f.name,
      production_url: f.productionUrl || undefined,
      staging_url: f.stagingUrl || undefined,
      notes: f.notes || undefined,
      tags: f.tags || undefined,
      cloudflare_enabled: f.cloudflare,
      proxy_url: f.proxyType !== "none" ? f.proxyUrl : undefined,
      proxy_type: f.proxyType !== "none" ? f.proxyType : undefined,
    });
    setProjects([p, ...projects]);
    setShowNew(false);
    selectProject(p);
  }

  async function handleDelete(id: string) {
    await api.deleteProject(id);
    setProjects(projects.filter((p) => p.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  if (loading) return <div className="p-8 text-rams-text-secondary text-sm">Loading…</div>;
  if (error) return (
    <div className="p-8">
      <div className="rams-card p-6 text-center">
        <p className="text-sm text-rams-fail mb-2">Failed to load projects</p>
        <p className="text-2xs text-rams-text-muted font-mono">{error}</p>
      </div>
    </div>
  );

  if (selected) {
    return <ProjectDetail project={selected} tests={tests} onBack={() => setSelected(null)} onRefresh={() => selectProject(selected)} />;
  }

  return (
    <div className="p-8 max-w-5xl animate-fade-in">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-semibold">Projects</h1>
        <button onClick={() => setShowNew(true)} className="rams-btn rams-btn-primary">
          <Plus className="w-3.5 h-3.5" strokeWidth={2} />
          New Project
        </button>
      </div>
      <p className="text-2xs text-rams-text-muted mb-6">
        Projects group related tests for a website or API. Each project can have its own proxy settings, test configurations, and run history.
      </p>

      {showNew && <NewProjectForm onCreate={handleCreate} onCancel={() => setShowNew(false)} />}

      {projects.length === 0 ? (
        <div className="rams-card p-12 text-center">
          <Globe className="w-6 h-6 text-rams-text-muted mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-sm text-rams-text-secondary mb-1">No projects yet</p>
          <p className="text-2xs text-rams-text-muted">Create a project to start testing</p>
        </div>
      ) : (
        <div className="rams-card divide-y divide-rams-border">
          {projects.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between px-4 py-3 hover:bg-rams-bg/50 cursor-pointer group"
              onClick={() => selectProject(p)}
            >
              <div className="flex items-center gap-3">
                <div>
                  <div className="text-sm font-medium">{p.name}</div>
                  {p.production_url && (
                    <div className="text-2xs text-rams-text-secondary font-mono">{p.production_url}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {p.cloudflare_enabled && (
                  <span className="text-2xs text-rams-warning px-2 py-0.5 border border-rams-warning/30 rounded-rams">Cloudflare</span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                  className="opacity-0 group-hover:opacity-100 text-rams-text-muted hover:text-rams-fail transition-opacity p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                </button>
                <ChevronRight className="w-4 h-4 text-rams-text-muted" strokeWidth={1.5} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface NewProjectFields {
  name: string;
  productionUrl: string;
  stagingUrl: string;
  notes: string;
  tags: string;
  cloudflare: boolean;
  proxyUrl: string;
  proxyType: string;
}

function NewProjectForm({
  onCreate,
  onCancel,
}: {
  onCreate: (fields: NewProjectFields) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [stagingUrl, setStagingUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [cloudflare, setCloudflare] = useState(false);
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyType, setProxyType] = useState("none");

  return (
    <div className="rams-card p-5 mb-4 animate-slide-up">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium">New Project</h2>
        <button onClick={onCancel} className="rams-btn rams-btn-ghost p-1">
          <X className="w-4 h-4" strokeWidth={1.5} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="rams-label block mb-1.5">Project Name</label>
          <input
            className="rams-input w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ropetackle Arts Centre"
            autoFocus
          />
        </div>
        <div>
          <label className="rams-label block mb-1.5">Production URL</label>
          <input
            className="rams-input w-full"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </div>
        <div>
          <label className="rams-label block mb-1.5">Staging URL <span className="text-rams-text-muted font-normal">(optional)</span></label>
          <input
            className="rams-input w-full"
            value={stagingUrl}
            onChange={(e) => setStagingUrl(e.target.value)}
            placeholder="https://staging.example.com"
          />
        </div>
        <div>
          <label className="rams-label block mb-1.5">Tags <span className="text-rams-text-muted font-normal">(comma separated)</span></label>
          <input
            className="rams-input w-full"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="wordpress, client"
          />
        </div>
        <div className="col-span-2">
          <label className="rams-label block mb-1.5">Notes</label>
          <textarea
            className="rams-input w-full h-16 resize-none"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Hosting details, Cloudflare status, anything relevant to testing…"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 mt-3 cursor-pointer">
        <input
          type="checkbox"
          checked={cloudflare}
          onChange={(e) => setCloudflare(e.target.checked)}
          className="rounded"
        />
        <span className="text-2xs text-rams-text-secondary">Site is behind Cloudflare — runner IPs may need allowlisting</span>
      </label>
      <div className="grid grid-cols-2 gap-4 mt-4">
        <div>
          <label className="rams-label block mb-1.5">Proxy Type</label>
          <select
            className="rams-select w-full"
            value={proxyType}
            onChange={(e) => setProxyType(e.target.value)}
          >
            <option value="none">No Proxy</option>
            <option value="http">HTTP Proxy</option>
            <option value="socks">SOCKS Proxy</option>
          </select>
        </div>
        <div>
          <label className="rams-label block mb-1.5">Proxy URL</label>
          <input
            className="rams-input w-full"
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder="http://proxy.example.com:8080"
            disabled={proxyType === "none"}
          />
        </div>
      </div>
      <p className="text-2xs text-rams-text-muted mt-2">
        Route test traffic through a proxy server. Useful for testing through a specific IP or network. HTTP proxy sets <span className="font-mono">HTTP_PROXY</span>/<span className="font-mono">HTTPS_PROXY</span>; SOCKS sets <span className="font-mono">ALL_PROXY</span>.
      </p>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="rams-btn rams-btn-secondary">Cancel</button>
        <button
          onClick={() => name && onCreate({ name, productionUrl: url, stagingUrl, notes, tags, cloudflare, proxyUrl, proxyType })}
          className="rams-btn rams-btn-primary"
          disabled={!name}
        >
          Create
        </button>
      </div>
    </div>
  );
}

function ProjectDetail({
  project,
  tests,
  onBack,
  onRefresh,
}: {
  project: Project;
  tests: Test[];
  onBack: () => void;
  onRefresh: () => void;
}) {
  const [showNewTest, setShowNewTest] = useState(false);
  const [runningQuick, setRunningQuick] = useState<string | null>(null);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedEnv, setSelectedEnv] = useState<string>(""); // "" = production
  const navigate = useNavigate();

  useEffect(() => {
    api.getEnvironments(project.id).then(setEnvironments).catch(() => {});
  }, [project.id]);

  // Build target list: production URL + custom environments
  const targets = [
    ...(project.production_url ? [{ id: "", name: "Production", url: project.production_url }] : []),
    ...(project.staging_url ? [{ id: "staging", name: "Staging", url: project.staging_url }] : []),
    ...environments.map((e) => ({ id: e.id, name: e.name, url: e.url })),
  ];
  const activeTarget = targets.find((t) => t.id === selectedEnv) ?? targets[0];
  const activeEnvId = selectedEnv === "staging" ? undefined : (selectedEnv || undefined);

  const quickTests = [
    { type: "smoke", label: "Smoke", icon: Zap, vus: 1, duration: "30s", desc: "Quick sanity check", color: "text-rams-pass", border: "border-rams-pass/30", bg: "bg-rams-pass/5", intensity: 1 },
    { type: "load", label: "Load", icon: Activity, vus: 10, duration: "2m", desc: "Typical traffic", color: "text-rams-accent", border: "border-rams-accent/30", bg: "bg-rams-accent/5", intensity: 2 },
    { type: "stress", label: "Stress", icon: Flame, vus: 50, duration: "5m", desc: "High load", color: "text-rams-warning", border: "border-rams-warning/30", bg: "bg-rams-warning/5", intensity: 3 },
    { type: "spike", label: "Spike", icon: TrendingUp, vus: 100, duration: "1m", desc: "Sudden surge", color: "text-rams-fail", border: "border-rams-fail/30", bg: "bg-rams-fail/5", intensity: 4 },
    { type: "soak", label: "Soak", icon: Clock, vus: 5, duration: "10m", desc: "Long-running", color: "text-rams-text-secondary", border: "border-rams-text-secondary/30", bg: "bg-rams-text-secondary/5", intensity: 2 },
  ];

  async function handleQuickRun(testType: string, vus: number, duration: string) {
    if (!activeTarget) return;
    setRunningQuick(testType);
    try {
      const runId = await api.runQuickTest({
        project_id: project.id,
        test_type: testType,
        url: activeTarget.url,
        vus,
        duration,
        proxy_url: project.proxy_url ?? undefined,
        proxy_type: project.proxy_type ?? undefined,
        environment_id: activeEnvId,
      });
      navigate(`/runs/${runId}`);
    } catch (err) {
      console.error("Quick test failed:", err);
      setRunningQuick(null);
    }
  }

  return (
    <div className="p-8 max-w-5xl animate-fade-in">
      <button onClick={onBack} className="text-sm text-rams-text-secondary hover:text-rams-text mb-4 flex items-center gap-1">
        <ChevronRight className="w-3.5 h-3.5 rotate-180" strokeWidth={1.5} />
        Projects
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold mb-1">{project.name}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            {project.production_url && (
              <a href={project.production_url} target="_blank" rel="noopener" className="text-sm text-rams-accent font-mono">
                {project.production_url}
              </a>
            )}
            {project.tags && project.tags.split(",").filter(Boolean).map((t) => (
              <span key={t} className="text-2xs text-rams-text-secondary px-2 py-0.5 border border-rams-border rounded-rams">{t.trim()}</span>
            ))}
          </div>
          {project.notes && (
            <p className="text-2xs text-rams-text-muted mt-1.5 max-w-xl">{project.notes}</p>
          )}
          {project.proxy_type && project.proxy_type !== "none" && project.proxy_url && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="text-2xs text-rams-warning px-2 py-0.5 border border-rams-warning/30 rounded-rams">
                {project.proxy_type === "socks" ? "SOCKS" : "HTTP"} Proxy
              </span>
              <span className="text-2xs text-rams-text-secondary font-mono">{project.proxy_url}</span>
            </div>
          )}
        </div>
        <button onClick={() => setShowNewTest(true)} className="rams-btn rams-btn-primary">
          <Plus className="w-3.5 h-3.5" strokeWidth={2} />
          New Test
        </button>
      </div>

      {showNewTest && (
        <NewTestForm
          projectId={project.id}
          productionUrl={project.production_url}
          onCreated={() => { setShowNewTest(false); onRefresh(); }}
          onCancel={() => setShowNewTest(false)}
        />
      )}

      {/* Quick Tests */}
      {project.production_url && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-medium text-rams-text-secondary">Quick Tests</h2>
            <span className="inline-flex items-center gap-1 text-2xs text-rams-accent font-medium px-1.5 py-0.5 rounded-rams bg-rams-accent/10">
              <Zap className="w-2.5 h-2.5" strokeWidth={2} />
              One-click
            </span>
          </div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-2xs text-rams-text-muted">
              One-click tests against <span className="font-mono">{activeTarget?.url ?? project.production_url}</span>. No setup needed — just hit Run.
            </p>
            {targets.length > 1 && (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-2xs text-rams-text-muted">Target</span>
                <select
                  className="rams-select text-2xs py-1"
                  value={selectedEnv}
                  onChange={(e) => setSelectedEnv(e.target.value)}
                >
                  {targets.map((t) => (
                    <option key={t.id || "prod"} value={t.id}>{t.name} — {t.url}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="grid grid-cols-5 gap-3">
            {quickTests.map((qt, i) => {
              const Icon = qt.icon;
              const isThisRunning = runningQuick === qt.type;
              const isAnyRunning = !!runningQuick;
              return (
                <button
                  key={qt.type}
                  onClick={() => handleQuickRun(qt.type, qt.vus, qt.duration)}
                  disabled={isAnyRunning || !project.production_url}
                  className={`relative overflow-hidden p-4 text-left transition-all group disabled:cursor-not-allowed animate-slide-up border-l-2 ${qt.border} ${qt.bg} ${isThisRunning ? "ring-1 ring-rams-running/30" : "hover:scale-[1.02]"} disabled:opacity-60`}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  {/* Shimmer top bar when running */}
                  {isThisRunning && (
                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-rams-running overflow-hidden">
                      <div className="h-full" style={{ background: "linear-gradient(90deg, transparent, rgba(45,106,159,0.8), transparent)", backgroundSize: "200% 100%", animation: "shimmer 1.5s linear infinite" }} />
                    </div>
                  )}

                  {/* Pulsing ring around icon when running */}
                  <div className="relative flex items-center justify-center w-8 h-8 mb-2.5">
                    {isThisRunning && (
                      <span className="absolute w-3 h-3 rounded-full bg-rams-running animate-pulse-ring" />
                    )}
                    <Icon
                      className={`relative w-4 h-4 ${qt.color} ${isThisRunning ? "animate-pulse-subtle" : "group-hover:scale-110"} transition-transform`}
                      strokeWidth={1.5}
                    />
                  </div>

                  <div className="text-sm font-medium mb-0.5">{qt.label}</div>
                  <div className="text-2xs text-rams-text-secondary mb-2">{qt.desc}</div>

                  {/* Intensity bars */}
                  <div className="flex items-center gap-0.5 mb-2.5">
                    {[1, 2, 3, 4].map((n) => (
                      <div
                        key={n}
                        className={`h-1 flex-1 rounded-sm transition-colors ${n <= qt.intensity ? qt.color.replace("text-", "bg-") : "bg-rams-border"}`}
                        style={{ opacity: n <= qt.intensity ? 0.6 + n * 0.1 : 0.3 }}
                      />
                    ))}
                  </div>

                  {/* VU / Duration stats */}
                  <div className="flex items-center gap-2 text-2xs text-rams-text-muted mb-2.5">
                    <span className="font-mono">{qt.vus} VU</span>
                    <span>·</span>
                    <span className="font-mono">{qt.duration}</span>
                  </div>

                  {/* Animated flow dots when running */}
                  {isThisRunning ? (
                    <div className="flex items-center gap-1 text-2xs text-rams-running font-medium">
                      <div className="flex items-center gap-0.5">
                        <span className="w-1 h-1 rounded-full bg-rams-running animate-flow" style={{ animationDelay: "0ms" }} />
                        <span className="w-1 h-1 rounded-full bg-rams-running animate-flow" style={{ animationDelay: "200ms" }} />
                        <span className="w-1 h-1 rounded-full bg-rams-running animate-flow" style={{ animationDelay: "400ms" }} />
                      </div>
                      <span className="ml-1">Starting…</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-2xs text-rams-accent group-hover:text-rams-text transition-colors">
                      <Play className="w-3 h-3" strokeWidth={2} />
                      <span>Run now</span>
                    </div>
                  )}

                  {/* Hover glow effect */}
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                    style={{ background: `radial-gradient(circle at 50% 0%, ${qt.color.includes("pass") ? "rgba(59,122,87,0.06)" : qt.color.includes("accent") ? "rgba(45,106,159,0.06)" : qt.color.includes("warning") ? "rgba(204,153,51,0.06)" : qt.color.includes("fail") ? "rgba(192,57,43,0.06)" : "rgba(107,107,107,0.06)"}, transparent 70%)` }}
                  />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Environments */}
      <section className="mb-8">
        <h2 className="text-sm font-medium text-rams-text-secondary mb-3">Environments</h2>
        <div className="rams-card divide-y divide-rams-border">
          {project.production_url && (
            <EnvRow name="Production" url={project.production_url} builtin />
          )}
          {project.staging_url && (
            <EnvRow name="Staging" url={project.staging_url} builtin />
          )}
          {environments.map((e) => (
            <EnvRow
              key={e.id}
              name={e.name}
              url={e.url}
              badge={e.env_type}
              onDelete={async () => {
                await api.deleteEnvironment(e.id);
                setEnvironments(environments.filter((x) => x.id !== e.id));
              }}
            />
          ))}
          <NewEnvironmentForm
            projectId={project.id}
            onCreated={(e) => setEnvironments([...environments, e])}
          />
        </div>
      </section>

      {/* Authentication */}
      <AuthSection project={project} onUpdated={onRefresh} />

      {/* Tests */}
      <section className="mb-8">
        <h2 className="text-sm font-medium text-rams-text-secondary mb-3">Custom Tests</h2>
        {tests.length === 0 ? (
          <div className="rams-card p-8 text-center">
            <p className="text-sm text-rams-text-secondary">No custom tests yet</p>
            <p className="text-2xs text-rams-text-muted mt-1">Create a custom test with your own VUs, duration, and thresholds</p>
          </div>
        ) : (
          <div className="rams-card divide-y divide-rams-border">
            {tests.map((t) => (
              <Link
                key={t.id}
                to={`/tests/${t.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-rams-bg/50 group"
              >
                <div>
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-2xs text-rams-text-secondary">
                    {t.test_type} {t.is_custom_script && "· Custom Script"}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-rams-text-muted group-hover:text-rams-text" strokeWidth={1.5} />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Run history */}
      <RunHistory projectId={project.id} />
    </div>
  );
}

function RunHistory({ projectId }: { projectId: string }) {
  const [runs, setRuns] = useState<any[]>([]);

  useEffect(() => {
    api.getRuns(projectId).then(setRuns);
  }, [projectId]);

  if (runs.length === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-medium text-rams-text-secondary mb-3">Run History</h2>
      <div className="rams-card overflow-hidden">
        <table className="rams-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Status</th>
              <th>VUs</th>
              <th>p95</th>
              <th>Requests</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="hover:bg-rams-bg/50 cursor-pointer" onClick={() => window.location.href = `/runs/${r.id}`}>
                <td className="text-2xs text-rams-text-secondary">{formatDate(r.started_at)}</td>
                <td>
                  <span className="text-2xs" style={{ color: r.status === "completed" ? (r.threshold_passed ? "#3B7A57" : "#C0392B") : "#6B6B6B" }}>
                    {r.status === "completed" ? (r.threshold_passed ? "Passed" : "Failed") : r.status}
                  </span>
                </td>
                <td className="font-mono text-2xs">{r.vus}</td>
                <td className="font-mono text-2xs">{r.p95_duration ? `${Math.round(r.p95_duration)}ms` : "—"}</td>
                <td className="font-mono text-2xs">{r.requests || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function NewTestForm({
  projectId,
  productionUrl,
  onCreated,
  onCancel,
}: {
  projectId: string;
  productionUrl: string | null;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [testType, setTestType] = useState("smoke");
  const [vus, setVus] = useState(1);
  const [duration, setDuration] = useState("30s");
  const [url, setUrl] = useState(productionUrl ?? "");
  const [creating, setCreating] = useState(false);

  const templates: Record<string, { vus: number; duration: string }> = {
    smoke: { vus: 1, duration: "30s" },
    load: { vus: 10, duration: "2m" },
    stress: { vus: 50, duration: "5m" },
    spike: { vus: 100, duration: "1m" },
    soak: { vus: 5, duration: "10m" },
    custom: { vus: 1, duration: "30s" },
  };

  function selectTemplate(type: string) {
    setTestType(type);
    const t = templates[type];
    setVus(t.vus);
    setDuration(t.duration);
  }

  async function handleCreate() {
    setCreating(true);
    const config = JSON.stringify({
      url,
      method: "GET",
      vus,
      duration,
      stages: [],
      requests: [],
    });
    const thresholds = JSON.stringify({
      http_req_failed: ["rate<0.01"],
      http_req_duration: ["p(95)<1000"],
    });
    await api.createTest({
      project_id: projectId,
      name,
      test_type: testType,
      config,
      thresholds,
    });
    setCreating(false);
    onCreated();
  }

  return (
    <div className="rams-card p-5 mb-4 animate-slide-up">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium">New Test</h2>
        <button onClick={onCancel} className="rams-btn rams-btn-ghost p-1">
          <X className="w-4 h-4" strokeWidth={1.5} />
        </button>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="rams-label block mb-1.5">Test Name</label>
            <input className="rams-input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Homepage Load" autoFocus />
          </div>
          <div>
            <label className="rams-label block mb-1.5">Target URL</label>
            <input className="rams-input w-full" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
          </div>
        </div>

        <div>
          <label className="rams-label block mb-2">Test Type</label>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(templates).map(([type]) => (
              <button
                key={type}
                onClick={() => selectTemplate(type)}
                className={`rams-btn ${testType === type ? "rams-btn-primary" : "rams-btn-secondary"}`}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
          <p className="text-2xs text-rams-text-muted mt-2">
            <span className="font-medium">Smoke</span> = quick sanity check (1 VU, 30s). <span className="font-medium">Load</span> = typical traffic (10 VUs, 2m). <span className="font-medium">Stress</span> = high load (50 VUs, 5m). <span className="font-medium">Spike</span> = sudden surge (100 VUs, 1m). <span className="font-medium">Soak</span> = long-running (5 VUs, 10m). <span className="font-medium">Custom</span> = your own settings.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="rams-label block mb-1.5">Virtual Users</label>
            <input type="number" className="rams-input w-full" value={vus} onChange={(e) => setVus(Number(e.target.value))} min={1} />
          </div>
          <div>
            <label className="rams-label block mb-1.5">Duration</label>
            <input className="rams-input w-full" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="30s, 1m, 5m" />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onCancel} className="rams-btn rams-btn-secondary">Cancel</button>
        <button onClick={handleCreate} disabled={!name || !url || creating} className="rams-btn rams-btn-primary">
          {creating ? "Creating…" : "Create Test"}
        </button>
      </div>
    </div>
  );
}

function EnvRow({
  name,
  url,
  badge,
  builtin,
  onDelete,
}: {
  name: string;
  url: string;
  badge?: string;
  builtin?: boolean;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="flex items-center gap-3">
        <Server className="w-3.5 h-3.5 text-rams-text-muted" strokeWidth={1.5} />
        <div>
          <div className="text-sm font-medium">{name}</div>
          <div className="text-2xs text-rams-text-muted font-mono">{url}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {builtin && <span className="text-2xs text-rams-text-muted">Built-in</span>}
        {badge && <span className="text-2xs text-rams-accent px-2 py-0.5 border border-rams-accent/30 rounded-rams">{badge}</span>}
        {onDelete && (
          <button onClick={onDelete} className="rams-btn rams-btn-ghost p-1 text-rams-text-muted hover:text-rams-fail">
            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
}

function NewEnvironmentForm({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: (e: Environment) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [envType, setEnvType] = useState("staging");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="w-full px-4 py-2.5 text-2xs text-rams-accent hover:bg-rams-bg/50 flex items-center gap-1.5"
      >
        <Plus className="w-3 h-3" strokeWidth={2} />
        Add environment
      </button>
    );
  }

  return (
    <div className="px-4 py-3 flex items-end gap-3">
      <div className="flex-1 grid grid-cols-3 gap-3">
        <div>
          <label className="rams-label block mb-1">Name</label>
          <input className="rams-input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Staging" autoFocus />
        </div>
        <div>
          <label className="rams-label block mb-1">Base URL</label>
          <input className="rams-input w-full" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://staging.example.com" />
        </div>
        <div>
          <label className="rams-label block mb-1">Type</label>
          <select className="rams-select w-full" value={envType} onChange={(e) => setEnvType(e.target.value)}>
            <option value="staging">Staging</option>
            <option value="dev">Dev</option>
            <option value="qa">QA</option>
            <option value="production">Production</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>
      <button onClick={() => setAdding(false)} className="rams-btn rams-btn-ghost p-1.5">
        <X className="w-4 h-4" strokeWidth={1.5} />
      </button>
      <button
        onClick={async () => {
          if (!name || !url) return;
          setSaving(true);
          const env = await api.createEnvironment({ project_id: projectId, name, url, env_type: envType });
          onCreated(env);
          setName(""); setUrl(""); setAdding(false); setSaving(false);
        }}
        disabled={!name || !url || saving}
        className="rams-btn rams-btn-primary"
      >
        {saving ? "Adding…" : "Add"}
      </button>
    </div>
  );
}

interface AuthConfig {
  type: "none" | "bearer" | "basic" | "apikey" | "headers";
  token?: string;
  username?: string;
  password?: string;
  header?: string;
  value?: string;
  headers?: Record<string, string>;
}

function AuthSection({ project, onUpdated }: { project: Project; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [authType, setAuthType] = useState<AuthConfig["type"]>("none");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [headerName, setHeaderName] = useState("X-API-Key");
  const [headerValue, setHeaderValue] = useState("");
  const [extraHeaders, setExtraHeaders] = useState<{ k: string; v: string }[]>([{ k: "", v: "" }]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const ac = project.auth_config ? (JSON.parse(project.auth_config) as AuthConfig) : null;
      if (ac) {
        setAuthType(ac.type);
        setToken(ac.token ?? "");
        setUsername(ac.username ?? "");
        setPassword(ac.password ?? "");
        setHeaderName(ac.header ?? "X-API-Key");
        setHeaderValue(ac.value ?? "");
        if (ac.headers) setExtraHeaders(Object.entries(ac.headers).map(([k, v]) => ({ k, v })));
      }
    } catch { /* ignore parse errors */ }
  }, [project.auth_config]);

  async function save() {
    setSaving(true);
    const config: AuthConfig = { type: authType };
    if (authType === "bearer") config.token = token;
    if (authType === "basic") { config.username = username; config.password = password; }
    if (authType === "apikey") { config.header = headerName; config.value = headerValue; }
    if (authType === "headers") config.headers = Object.fromEntries(extraHeaders.filter((h) => h.k).map((h) => [h.k, h.v]));
    await api.updateProject({ id: project.id, auth_config: authType === "none" ? "" : JSON.stringify(config) });
    setSaving(false);
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onUpdated();
  }

  const hasAuth = authType !== "none";

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-rams-text-secondary flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5" strokeWidth={1.5} />
          Authentication
        </h2>
        <div className="flex items-center gap-2">
          {saved && <span className="text-2xs text-rams-pass">Saved</span>}
          {!editing ? (
            <button onClick={() => setEditing(true)} className="rams-btn rams-btn-ghost text-2xs">
              {hasAuth ? "Edit" : "Configure"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="rams-card p-4">
        {!editing && !hasAuth && (
          <p className="text-2xs text-rams-text-muted">No authentication configured. Tests will run without auth headers.</p>
        )}
        {!editing && hasAuth && (
          <div className="flex items-center gap-2">
            <span className="text-2xs font-medium text-rams-accent px-2 py-0.5 border border-rams-accent/30 rounded-rams">
              {authType === "bearer" ? "Bearer Token" : authType === "basic" ? "Basic Auth" : authType === "apikey" ? "API Key" : "Custom Headers"}
            </span>
            <span className="text-2xs text-rams-text-muted">Credentials are injected as environment variables — never written to the script file.</span>
          </div>
        )}

        {editing && (
          <div className="space-y-4">
            <div>
              <label className="rams-label block mb-1.5">Auth Type</label>
              <select className="rams-select w-full max-w-xs" value={authType} onChange={(e) => setAuthType(e.target.value as AuthConfig["type"])}>
                <option value="none">None</option>
                <option value="bearer">Bearer Token</option>
                <option value="basic">Basic Auth</option>
                <option value="apikey">API Key Header</option>
                <option value="headers">Custom Headers</option>
              </select>
            </div>

            {authType === "bearer" && (
              <div>
                <label className="rams-label block mb-1.5">Token</label>
                <input type="password" className="rams-input w-full font-mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder="eyJhbGciOi…" autoComplete="off" />
              </div>
            )}

            {authType === "basic" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="rams-label block mb-1.5">Username</label>
                  <input className="rams-input w-full font-mono" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
                </div>
                <div>
                  <label className="rams-label block mb-1.5">Password</label>
                  <input type="password" className="rams-input w-full font-mono" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                </div>
              </div>
            )}

            {authType === "apikey" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="rams-label block mb-1.5">Header Name</label>
                  <input className="rams-input w-full font-mono" value={headerName} onChange={(e) => setHeaderName(e.target.value)} placeholder="X-API-Key" />
                </div>
                <div>
                  <label className="rams-label block mb-1.5">Value</label>
                  <input type="password" className="rams-input w-full font-mono" value={headerValue} onChange={(e) => setHeaderValue(e.target.value)} autoComplete="off" />
                </div>
              </div>
            )}

            {authType === "headers" && (
              <div className="space-y-2">
                <label className="rams-label block mb-1.5">Headers</label>
                {extraHeaders.map((h, i) => (
                  <div key={i} className="flex gap-2">
                    <input className="rams-input flex-1 font-mono text-2xs" value={h.k} onChange={(e) => setExtraHeaders(extraHeaders.map((x, j) => j === i ? { ...x, k: e.target.value } : x))} placeholder="Header-Name" />
                    <input className="rams-input flex-[2] font-mono text-2xs" value={h.v} onChange={(e) => setExtraHeaders(extraHeaders.map((x, j) => j === i ? { ...x, v: e.target.value } : x))} placeholder="value" type="password" autoComplete="off" />
                    <button onClick={() => setExtraHeaders(extraHeaders.filter((_, j) => j !== i))} className="rams-btn rams-btn-ghost p-1.5 text-rams-text-muted">
                      <X className="w-3.5 h-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                ))}
                <button onClick={() => setExtraHeaders([...extraHeaders, { k: "", v: "" }])} className="rams-btn rams-btn-ghost text-2xs flex items-center gap-1">
                  <Plus className="w-3 h-3" strokeWidth={2} /> Add header
                </button>
              </div>
            )}

            <div className="flex items-center gap-1.5 text-2xs text-rams-warning">
              <AlertTriangle className="w-3.5 h-3.5" strokeWidth={1.5} />
              Credentials are stored locally in the app database and passed to k6 as environment variables at runtime.
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(false)} className="rams-btn rams-btn-secondary">Cancel</button>
              <button onClick={save} disabled={saving} className="rams-btn rams-btn-primary flex items-center gap-1.5">
                <Save className="w-3.5 h-3.5" strokeWidth={1.5} />
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
