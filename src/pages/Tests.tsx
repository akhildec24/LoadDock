import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, type Test, type Run, type Project, type Environment } from "../lib/api";
import { Play, Save, Plus, Trash2, Code2, Settings2, ChevronRight, AlertTriangle, Square, X, Activity, Zap, Timer, Gauge, AlertCircle, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { formatMs, formatNumber, formatPercent, formatDate, cn } from "../lib/utils";
import { LiveRunPanel, AnimatedMetric, parseDurationToSec } from "../components/LiveRunPanel";

export default function Tests() {
  const { testId } = useParams();
  const navigate = useNavigate();
  const [test, setTest] = useState<Test | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [tab, setTab] = useState<"builder" | "script">("builder");
  const [script, setScript] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [config, setConfig] = useState<any>({});
  const [running, setRunning] = useState(false);
  const [showRunConfirm, setShowRunConfirm] = useState(false);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [runEnv, setRunEnv] = useState(""); // "" = production / base URL
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<Run | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!testId) return;
    api.getTest(testId).then((t) => {
      if (t) {
        setTest(t);
        setScript(t.script ?? "");
        setIsCustom(t.is_custom_script);
        try {
          setConfig(JSON.parse(t.config));
        } catch {
          setConfig({});
        }
        api.getProjects().then((projects) => {
          const p = projects.find((x) => x.id === t.project_id);
          if (p) setProject(p);
        });
        api.getEnvironments(t.project_id).then(setEnvironments).catch(() => {});
      }
    });
    api.getRuns().then(setRuns);
  }, [testId]);

  // Poll for active run status
  useEffect(() => {
    if (!activeRunId) return;
    startTimeRef.current = Date.now();
    setElapsed(0);
    const interval = setInterval(async () => {
      const run = await api.getRun(activeRunId);
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      if (run && run.status !== "running") {
        setRunning(false);
        setRunStatus(run);
        clearInterval(interval);
      } else if (run) {
        setRunStatus(run);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [activeRunId]);

  if (!test) {
    return (
      <div className="p-8">
        <div className="rams-card p-12 text-center">
          <p className="text-sm text-rams-text-secondary">Select a test from a project</p>
        </div>
      </div>
    );
  }

  async function handleSaveScript() {
    if (!test) return;
    await api.updateTest({
      id: test.id,
      script,
      is_custom_script: true,
    });
    setIsCustom(true);
  }

  async function handleSaveConfig() {
    if (!test) return;
    const configStr = JSON.stringify(config);
    const newScript = await api.generateScript(configStr, test.thresholds ?? undefined);
    await api.updateTest({
      id: test.id,
      config: configStr,
      script: newScript,
      is_custom_script: false,
    });
    setScript(newScript);
    setIsCustom(false);
  }

  async function handleRun() {
    if (!test) return;
    setShowRunConfirm(false);
    setRunning(true);
    setRunStatus(null);
    setElapsed(0);
    try {
      const runId = await api.runTest({
        test_id: test.id,
        project_id: test.project_id,
        script: script,
        vus: config.vus ?? 1,
        duration: config.duration ?? "30s",
        proxy_url: project?.proxy_url ?? undefined,
        proxy_type: project?.proxy_type ?? undefined,
        environment_id: runEnv || undefined,
      });
      setActiveRunId(runId);
      startTimeRef.current = Date.now();
    } catch (err) {
      setRunning(false);
      alert(String(err));
    }
  }

  // Rough estimate of total requests for the confirmation dialog.
  // VU mode: vus × duration / iteration_time; RPS mode: rate × duration.
  function estimateRequests(): number {
    const durSec = parseDurationToSec(config.duration ?? "30s");
    const numReqs = Math.max(1, config.requests?.length ?? 0);
    if (config.mode === "rps" && config.target_rps) {
      return Math.round(config.target_rps * durSec * numReqs);
    }
    const think = (config.requests ?? []).reduce((s: number, r: any) => s + (r.think_time ?? 1), 0);
    const iterTime = Math.max(0.5, 1 + think); // ~1s sleep + think times + response time
    return Math.round(((config.vus ?? 1) * durSec) / iterTime * numReqs);
  }

  const estRequests = estimateRequests();
  const isAggressive = (config.vus ?? 1) > 50 || (config.mode === "rps" && (config.target_rps ?? 0) > 50) || parseDurationToSec(config.duration ?? "30s") > 600;

  async function handleStop() {
    if (activeRunId) {
      await api.stopTest(activeRunId);
      setRunning(false);
    }
  }

  return (
    <div className="p-8 max-w-5xl animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold mb-1">{test.name}</h1>
          {test.is_custom_script && (
            <span className="text-2xs text-rams-warning px-2 py-0.5 border border-rams-warning/30 rounded-rams">Custom Script</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {running ? (
            <button onClick={handleStop} className="rams-btn rams-btn-danger">
              <Square className="w-3.5 h-3.5" strokeWidth={2} fill="currentColor" />
              Stop Test
            </button>
          ) : (
            <button onClick={() => setShowRunConfirm(true)} className="rams-btn rams-btn-primary">
              <Play className="w-3.5 h-3.5" strokeWidth={2} fill="currentColor" />
              Run Test
            </button>
          )}
        </div>
      </div>

      {/* Run confirmation */}
      {showRunConfirm && (
        <div className="rams-card p-5 mb-4 animate-slide-up">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium">Ready to test</h2>
            <button onClick={() => setShowRunConfirm(false)} className="rams-btn rams-btn-ghost p-1">
              <X className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm mb-4">
            <div className="flex justify-between">
              <span className="text-rams-text-secondary">Target</span>
              <span className="font-mono text-2xs">{environments.find((e) => e.id === runEnv)?.url ?? config.url ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-rams-text-secondary">Runner</span>
              <span>Local Mac</span>
            </div>
            <div className="flex justify-between">
              <span className="text-rams-text-secondary">Virtual users</span>
              <span className="font-mono">{config.vus ?? 1}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-rams-text-secondary">Duration</span>
              <span className="font-mono">{config.duration ?? "30s"}</span>
            </div>
            <div className="flex justify-between col-span-2">
              <span className="text-rams-text-secondary">Environment</span>
              <select className="rams-select text-2xs py-1 w-64" value={runEnv} onChange={(e) => setRunEnv(e.target.value)}>
                <option value="">Default ({config.url ?? "base URL"})</option>
                {project?.staging_url && <option value="staging">Staging — {project.staging_url}</option>}
                {environments.map((e) => (
                  <option key={e.id} value={e.id}>{e.name} — {e.url}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-between col-span-2">
              <span className="text-rams-text-secondary">Est. max requests</span>
              <span className="font-mono text-2xs">~{formatNumber(estRequests)}</span>
            </div>
          </div>
          {isAggressive && (
            <div className="flex items-start gap-2 mb-4 p-3 rounded-rams border border-rams-warning/40 bg-rams-warning/5">
              <AlertTriangle className="w-4 h-4 text-rams-warning shrink-0 mt-0.5" strokeWidth={1.5} />
              <p className="text-2xs text-rams-text-secondary">
                This is an aggressive test ({config.mode === "rps" ? `${config.target_rps} req/s` : `${config.vus ?? 1} VUs`} for {config.duration ?? "30s"}, ~{formatNumber(estRequests)} requests).
                Make sure you are authorised to load test this target and that the runner IP is allowlisted if the site is behind Cloudflare.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowRunConfirm(false)} className="rams-btn rams-btn-secondary">Cancel</button>
            <button onClick={handleRun} className="rams-btn rams-btn-primary">
              <Play className="w-3.5 h-3.5" strokeWidth={2} fill="currentColor" />
              Run Test
            </button>
          </div>
        </div>
      )}

      {/* Live run status */}
      {(running || runStatus) && (
        <LiveRunPanel
          running={running}
          run={runStatus}
          elapsed={elapsed}
          duration={config.duration ?? "30s"}
          vus={config.vus ?? 1}
          url={config.url ?? ""}
          proxyUrl={project?.proxy_url ?? undefined}
          proxyType={project?.proxy_type ?? undefined}
        />
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-rams-border mb-4">
        <button className={cn("rams-tab", tab === "builder" && "rams-tab-active")} onClick={() => setTab("builder")}>
          <span className="flex items-center gap-1.5"><Settings2 className="w-3.5 h-3.5" strokeWidth={1.5} />Builder</span>
        </button>
        <button className={cn("rams-tab", tab === "script" && "rams-tab-active")} onClick={() => setTab("script")}>
          <span className="flex items-center gap-1.5"><Code2 className="w-3.5 h-3.5" strokeWidth={1.5} />Script</span>
        </button>
      </div>

      {tab === "builder" ? (
        <BuilderView config={config} setConfig={setConfig} onSave={handleSaveConfig} />
      ) : (
        <ScriptView script={script} setScript={setScript} onSave={handleSaveScript} isCustom={isCustom} />
      )}

      {/* Test history */}
      {runs.filter((r) => r.test_id === test.id).length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-rams-text-secondary mb-3">History</h2>
          <div className="rams-card overflow-hidden">
            <table className="rams-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Result</th>
                  <th>VUs</th>
                  <th>p95</th>
                  <th>Requests</th>
                  <th>Errors</th>
                </tr>
              </thead>
              <tbody>
                {runs.filter((r) => r.test_id === test.id).map((r) => (
                  <tr key={r.id} className="hover:bg-rams-bg/50 cursor-pointer transition-colors" onClick={() => navigate(`/runs/${r.id}`)}>
                    <td className="text-2xs text-rams-text-secondary">{formatDate(r.started_at)}</td>
                    <td>
                      <span className="inline-flex items-center gap-1 text-2xs">
                        {r.status === "completed" && r.threshold_passed && <CheckCircle2 className="w-3 h-3 text-rams-pass" strokeWidth={2} />}
                        {r.status === "completed" && !r.threshold_passed && <XCircle className="w-3 h-3 text-rams-fail" strokeWidth={2} />}
                        {r.status === "failed" && <XCircle className="w-3 h-3 text-rams-fail" strokeWidth={2} />}
                        {r.status === "stopped" && <Square className="w-2.5 h-2.5 text-rams-text-muted" strokeWidth={2} />}
                        {r.status === "running" && <Loader2 className="w-3 h-3 text-rams-running animate-spin" strokeWidth={2} />}
                        <span style={{ color: r.status === "completed" ? (r.threshold_passed ? "#3B7A57" : "#C0392B") : r.status === "failed" ? "#C0392B" : "#6B6B6B" }}>
                          {r.status === "completed" ? (r.threshold_passed ? "Passed" : "Failed") : r.status}
                        </span>
                      </span>
                    </td>
                    <td className="font-mono text-2xs">{r.vus}</td>
                    <td className="font-mono text-2xs">{formatMs(r.p95_duration)}</td>
                    <td className="font-mono text-2xs">{formatNumber(r.requests)}</td>
                    <td className="font-mono text-2xs" style={{ color: r.failed_requests > 0 ? "#C0392B" : undefined }}>{formatPercent(r.failed_requests)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}


function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xs text-rams-text-secondary uppercase tracking-wider mb-0.5">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}

function BuilderView({ config, setConfig, onSave }: { config: any; setConfig: (c: any) => void; onSave: () => void }) {
  function update(partial: any) {
    setConfig({ ...config, ...partial });
  }

  return (
    <div className="space-y-4">
      {/* Target */}
      <div className="rams-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium">Target</h3>
            <p className="text-2xs text-rams-text-muted mt-0.5">The URL and HTTP method that k6 will send requests to during the test.</p>
          </div>
          <button onClick={onSave} className="rams-btn rams-btn-secondary text-2xs">
            <Save className="w-3 h-3" strokeWidth={1.5} />
            Save
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="rams-label block mb-1">URL</label>
            <input className="rams-input w-full" value={config.url ?? ""} onChange={(e) => update({ url: e.target.value })} placeholder="https://example.com" />
          </div>
          <div>
            <label className="rams-label block mb-1">Method</label>
            <select className="rams-select w-full" value={config.method ?? "GET"} onChange={(e) => update({ method: e.target.value })}>
              {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Traffic */}
      <div className="rams-card p-4">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="text-sm font-medium">Traffic</h3>
            <p className="text-2xs text-rams-text-muted mt-0.5">
              <span className="font-medium">Virtual Users (VUs)</span> = how many concurrent requests run at once. <span className="font-medium">Duration</span> = total test time (e.g. 30s, 1m, 5m).
            </p>
          </div>
          <div className="flex items-center gap-1 text-2xs">
            <button
              onClick={() => update({ mode: "vus" })}
              className={cn("rams-btn text-2xs", (config.mode ?? "vus") === "vus" ? "rams-btn-primary" : "rams-btn-ghost")}
            >
              VU-based
            </button>
            <button
              onClick={() => update({ mode: "rps" })}
              className={cn("rams-btn text-2xs", config.mode === "rps" ? "rams-btn-primary" : "rams-btn-ghost")}
            >
              RPS-based
            </button>
          </div>
        </div>
        {config.mode === "rps" ? (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="rams-label block mb-1">Target req/s</label>
              <input type="number" className="rams-input w-full" value={config.target_rps ?? 10} onChange={(e) => update({ target_rps: Number(e.target.value) })} min={1} />
            </div>
            <div>
              <label className="rams-label block mb-1">Duration</label>
              <input className="rams-input w-full" value={config.duration ?? "30s"} onChange={(e) => update({ duration: e.target.value })} placeholder="30s, 1m, 5m" />
            </div>
            <div>
              <label className="rams-label block mb-1">Max VUs</label>
              <input type="number" className="rams-input w-full" value={config.vus ?? 50} onChange={(e) => update({ vus: Number(e.target.value) })} min={1} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="rams-label block mb-1">Virtual Users</label>
              <input type="number" className="rams-input w-full" value={config.vus ?? 1} onChange={(e) => update({ vus: Number(e.target.value) })} min={1} />
            </div>
            <div>
              <label className="rams-label block mb-1">Duration</label>
              <input className="rams-input w-full" value={config.duration ?? "30s"} onChange={(e) => update({ duration: e.target.value })} placeholder="30s, 1m, 5m" />
            </div>
          </div>
        )}
        {config.mode === "rps" && (
          <p className="text-2xs text-rams-text-muted mt-2">
            RPS mode uses k6's constant-arrival-rate executor — it hits the target request rate regardless of response time. Max VUs caps how many virtual users k6 may allocate to sustain the rate.
          </p>
        )}
      </div>

      {/* Ramp stages */}
      <div className="rams-card p-4">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="text-sm font-medium">Ramp Stages</h3>
            <p className="text-2xs text-rams-text-muted mt-0.5">Gradually increase or decrease traffic over time. Each stage sets a VU count and how long to hold it before moving to the next.</p>
          </div>
          <button
            onClick={() => update({ stages: [...(config.stages ?? []), { target_vus: 10, duration: "1m" }] })}
            className="rams-btn rams-btn-secondary text-2xs"
          >
            <Plus className="w-3 h-3" strokeWidth={1.5} />
            Add Stage
          </button>
        </div>
        {(config.stages?.length ?? 0) === 0 ? (
          <p className="text-2xs text-rams-text-muted py-2 mt-2">No ramp stages defined. The test will use a fixed number of VUs for the full duration. Add stages to gradually ramp up traffic (e.g. 10 VUs for 1m, then 50 VUs for 2m).</p>
        ) : (
          <div className="space-y-2">
            {config.stages?.map((stage: any, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-2xs text-rams-text-muted font-mono w-6">{i + 1}.</span>
                <input
                  type="number"
                  className="rams-input w-28"
                  value={stage.target_vus}
                  onChange={(e) => {
                    const stages = [...config.stages];
                    stages[i] = { ...stage, target_vus: Number(e.target.value) };
                    update({ stages });
                  }}
                  min={0}
                />
                <span className="text-2xs text-rams-text-secondary">VUs for</span>
                <input
                  className="rams-input w-28"
                  value={stage.duration}
                  onChange={(e) => {
                    const stages = [...config.stages];
                    stages[i] = { ...stage, duration: e.target.value };
                    update({ stages });
                  }}
                  placeholder="1m"
                />
                <button
                  onClick={() => update({ stages: config.stages.filter((_: any, j: number) => j !== i) })}
                  className="text-rams-text-muted hover:text-rams-fail p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Requests */}
      <div className="rams-card p-4">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="text-sm font-medium">Requests</h3>
            <p className="text-2xs text-rams-text-muted mt-0.5">Define specific endpoints to hit during the test. If left empty, k6 will repeatedly request the target URL above.</p>
          </div>
          <button
            onClick={() => update({ requests: [...(config.requests ?? []), { method: "GET", url: "/", think_time: 0 }] })}
            className="rams-btn rams-btn-secondary text-2xs"
          >
            <Plus className="w-3 h-3" strokeWidth={1.5} />
            Add Request
          </button>
        </div>
        {(config.requests?.length ?? 0) === 0 ? (
          <p className="text-2xs text-rams-text-muted py-2 mt-2">No individual requests defined. The test will repeatedly hit the target URL. Add requests to test multiple endpoints with different methods and think times.</p>
        ) : (
          <div className="space-y-2">
            {config.requests?.map((req: any, i: number) => (
              <RequestRow
                key={i}
                index={i}
                req={req}
                onChange={(r) => {
                  const requests = [...config.requests];
                  requests[i] = r;
                  update({ requests });
                }}
                onDelete={() => update({ requests: config.requests.filter((_: any, j: number) => j !== i) })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Thresholds */}
      <div className="rams-card p-4">
        <h3 className="text-sm font-medium mb-1">Thresholds</h3>
        <p className="text-2xs text-rams-text-muted mb-3">
          Pass/fail criteria for the test. If any threshold is breached, the run is marked as failed. Leave at 0 to disable a threshold.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="rams-label block mb-1">HTTP errors</label>
            <div className="flex items-center gap-1">
              <span className="text-2xs text-rams-text-secondary">{"<"}</span>
              <input className="rams-input w-full" defaultValue="1" />
              <span className="text-2xs text-rams-text-secondary">%</span>
            </div>
          </div>
          <div>
            <label className="rams-label block mb-1">p95 response</label>
            <div className="flex items-center gap-1">
              <span className="text-2xs text-rams-text-secondary">{"<"}</span>
              <input className="rams-input w-full" defaultValue="1000" />
              <span className="text-2xs text-rams-text-secondary">ms</span>
            </div>
          </div>
          <div>
            <label className="rams-label block mb-1">p99 response</label>
            <div className="flex items-center gap-1">
              <span className="text-2xs text-rams-text-secondary">{"<"}</span>
              <input className="rams-input w-full" defaultValue="2000" />
              <span className="text-2xs text-rams-text-secondary">ms</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RequestRow({
  index,
  req,
  onChange,
  onDelete,
}: {
  index: number;
  req: any;
  onChange: (r: any) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = (req.headers && Object.keys(req.headers).length > 0) || req.body || (req.expected_status && req.expected_status !== 200);

  function updateReq(partial: any) {
    onChange({ ...req, ...partial });
  }

  function setHeader(k: string, v: string) {
    const headers = { ...(req.headers ?? {}), [k]: v };
    updateReq({ headers });
  }

  function removeHeader(k: string) {
    const headers = { ...(req.headers ?? {}) };
    delete headers[k];
    updateReq({ headers });
  }

  const headerEntries = Object.entries(req.headers ?? {}) as [string, string][];

  return (
    <div className="rounded-rams border border-rams-border">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-rams-text-muted hover:text-rams-text p-0.5"
          title={expanded ? "Collapse" : "Headers, body, expected status"}
        >
          <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", expanded && "rotate-90")} strokeWidth={1.5} />
        </button>
        <select
          className="rams-select w-24"
          value={req.method}
          onChange={(e) => updateReq({ method: e.target.value })}
        >
          {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <input
          className="rams-input flex-1"
          value={req.url}
          onChange={(e) => updateReq({ url: e.target.value })}
          placeholder="/path"
        />
        {hasDetails && !expanded && (
          <span className="text-2xs text-rams-accent">details</span>
        )}
        <input
          type="number"
          className="rams-input w-20"
          value={req.think_time ?? 0}
          onChange={(e) => updateReq({ think_time: Number(e.target.value) })}
          placeholder="sleep"
          title="Think time (seconds)"
        />
        <span className="text-2xs text-rams-text-secondary">s</span>
        <button
          onClick={onDelete}
          className="text-rams-text-muted hover:text-rams-fail p-1"
        >
          <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-rams-border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="rams-label block mb-1">Expected status</label>
              <input
                type="number"
                className="rams-input w-28"
                value={req.expected_status ?? 200}
                onChange={(e) => updateReq({ expected_status: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="rams-label block mb-1">Request body <span className="text-rams-text-muted font-normal">(JSON)</span></label>
              <textarea
                className="rams-input w-full h-16 resize-none font-mono text-2xs"
                value={req.body ?? ""}
                onChange={(e) => updateReq({ body: e.target.value || undefined })}
                placeholder='{"key": "value"}'
                disabled={req.method === "GET" || req.method === "HEAD"}
              />
            </div>
          </div>

          <div>
            <label className="rams-label block mb-1">Headers <span className="text-rams-text-muted font-normal">(override project auth/defaults)</span></label>
            {headerEntries.length === 0 ? (
              <p className="text-2xs text-rams-text-muted">None — project auth/default headers still apply.</p>
            ) : (
              <div className="space-y-1.5">
                {headerEntries.map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <input
                      className="rams-input flex-1 font-mono text-2xs"
                      value={k}
                      onChange={(e) => {
                        const headers = { ...(req.headers ?? {}) };
                        delete headers[k];
                        headers[e.target.value] = v;
                        updateReq({ headers });
                      }}
                    />
                    <input
                      className="rams-input flex-[2] font-mono text-2xs"
                      value={v}
                      onChange={(e) => setHeader(k, e.target.value)}
                    />
                    <button onClick={() => removeHeader(k)} className="text-rams-text-muted hover:text-rams-fail p-1">
                      <X className="w-3.5 h-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => setHeader(`Header-${headerEntries.length + 1}`, "")}
              className="rams-btn rams-btn-ghost text-2xs mt-1.5 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" strokeWidth={2} /> Add header
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScriptView({ script, setScript, onSave, isCustom }: { script: string; setScript: (s: string) => void; onSave: () => void; isCustom: boolean }) {
  return (
    <div>
      {isCustom && (
        <div className="flex items-center gap-2 mb-3 text-2xs text-rams-warning">
          <AlertTriangle className="w-3.5 h-3.5" strokeWidth={1.5} />
          This script has been manually modified. Saving will mark it as custom.
        </div>
      )}
      <div className="flex justify-end mb-2">
        <button onClick={onSave} className="rams-btn rams-btn-secondary text-2xs">
          <Save className="w-3 h-3" strokeWidth={1.5} />
          Save Script
        </button>
      </div>
      <textarea
        className="w-full h-[500px] p-4 font-mono text-xs rounded-rams border border-rams-border resize-none focus:outline-none focus:border-rams-text-secondary"
        style={{ background: "#1C1C1C", color: "#FAFAF9" }}
        value={script}
        onChange={(e) => setScript(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
