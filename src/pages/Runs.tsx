import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { api, type Run, type RunEndpoint } from "../lib/api";
import { formatMs, formatNumber, formatPercent, formatDateTime, cn } from "../lib/utils";
import { LiveRunPanel, parseDurationToSec } from "../components/LiveRunPanel";
import { ChevronRight, Square } from "lucide-react";

export default function Runs() {
  const { runId } = useParams();
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);
  const [endpoints, setEndpoints] = useState<RunEndpoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getRuns().then((r) => {
      setRuns(r);
      if (runId) {
        const found = r.find((x) => x.id === runId);
        if (found) selectRun(found);
      }
      setLoading(false);
    });
  }, []);

  async function selectRun(run: Run) {
    setSelected(run);
    const ep = await api.getRunMetrics(run.id);
    setEndpoints(ep);
  }

  if (loading) return <div className="p-8 text-rams-text-secondary text-sm">Loading…</div>;

  if (selected) {
    return <RunDetail run={selected} endpoints={endpoints} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="p-8 max-w-5xl animate-fade-in">
      <h1 className="text-xl font-semibold mb-2">Runs</h1>
      <p className="text-2xs text-rams-text-muted mb-6">
        Every test execution is recorded here. Click a run to see detailed metrics including per-endpoint breakdowns. <span className="font-medium">p95</span> = 95% of requests completed within this time. <span className="font-medium">p99</span> = 99% completed within this time.
      </p>

      {runs.length === 0 ? (
        <div className="rams-card p-12 text-center">
          <p className="text-sm text-rams-text-secondary">No runs yet</p>
        </div>
      ) : (
        <div className="rams-card overflow-hidden">
          <table className="rams-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Status</th>
                <th>VUs</th>
                <th>Duration</th>
                <th>Requests</th>
                <th>p95</th>
                <th>p99</th>
                <th>Errors</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.id}
                  className="hover:bg-rams-bg/50 cursor-pointer"
                  onClick={() => selectRun(r)}
                >
                  <td className="text-2xs text-rams-text-secondary">{formatDateTime(r.started_at)}</td>
                  <td>
                    <StatusBadge status={r.status} passed={r.threshold_passed} />
                  </td>
                  <td className="font-mono text-2xs">{r.vus}</td>
                  <td className="font-mono text-2xs">{r.duration ?? "—"}</td>
                  <td className="font-mono text-2xs">{formatNumber(r.requests)}</td>
                  <td className="font-mono text-2xs">{formatMs(r.p95_duration)}</td>
                  <td className="font-mono text-2xs">{formatMs(r.p99_duration)}</td>
                  <td className="font-mono text-2xs">{formatPercent(r.failed_requests)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RunDetail({ run: initialRun, endpoints, onBack }: { run: Run; endpoints: RunEndpoint[]; onBack: () => void }) {
  const [run, setRun] = useState<Run>(initialRun);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(Date.now());

  const isRunning = run.status === "running";

  useEffect(() => {
    // Poll run status while running
    if (isRunning) {
      intervalRef.current = setInterval(async () => {
        const updated = await api.getRun(run.id);
        if (updated) setRun(updated);
      }, 1000);

      // Elapsed timer
      elapsedRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    };
  }, [isRunning, run.id]);

  // Calculate elapsed from started_at when loading an already-running run
  useEffect(() => {
    if (run.started_at && run.status === "running") {
      const started = new Date(run.started_at).getTime();
      startTimeRef.current = started;
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }
  }, [run.started_at, run.status]);

  async function handleStop() {
    await api.stopTest(run.id);
    const updated = await api.getRun(run.id);
    if (updated) setRun(updated);
  }

  return (
    <div className="p-8 max-w-5xl animate-fade-in">
      <button onClick={onBack} className="text-sm text-rams-text-secondary hover:text-rams-text mb-4 flex items-center gap-1">
        <ChevronRight className="w-3.5 h-3.5 rotate-180" strokeWidth={1.5} />
        Runs
      </button>

      {/* Header — same layout as Tests page */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold mb-1">Test Run</h1>
          <p className="text-2xs text-rams-text-secondary">{formatDateTime(run.started_at)}</p>
        </div>
        <div className="flex items-center gap-3">
          {isRunning ? (
            <button onClick={handleStop} className="rams-btn rams-btn-danger">
              <Square className="w-3.5 h-3.5" strokeWidth={2} fill="currentColor" />
              Stop Test
            </button>
          ) : (
            <span
              className={cn(
                "text-sm font-semibold px-3 py-1 rounded-rams",
                run.status === "completed" && run.threshold_passed && "text-rams-pass bg-rams-pass/10",
                run.status === "completed" && !run.threshold_passed && "text-rams-fail bg-rams-fail/10",
                run.status === "stopped" && "text-rams-text-secondary bg-rams-bg",
                run.status === "failed" && "text-rams-fail bg-rams-fail/10",
              )}
            >
              {run.status === "completed" ? (run.threshold_passed ? "PASSED" : "FAILED") : run.status.toUpperCase()}
            </span>
          )}
        </div>
      </div>

      {/* Live run panel — identical to Tests page */}
      <LiveRunPanel
        running={isRunning}
        run={run}
        elapsed={elapsed}
        duration={run.duration ?? "30s"}
        vus={run.vus}
        url=""
      />

      {/* Static detail sections — only when not running */}
      {!isRunning && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-4 gap-px bg-rams-border border border-rams-border rounded-rams overflow-hidden mb-6">
            <StatBox label="Virtual Users" value={String(run.vus)} />
            <StatBox label="Requests" value={formatNumber(run.requests)} />
            <StatBox label="Duration" value={run.duration ?? "—"} />
            <StatBox label="Errors" value={formatPercent(run.failed_requests)} />
          </div>

          {/* Performance */}
          <section className="mb-6">
            <h2 className="text-sm font-medium text-rams-text-secondary mb-3">Performance</h2>
            <div className="rams-card p-4">
              <div className="grid grid-cols-6 gap-4">
                <PerfMetric label="Average" value={formatMs(run.avg_duration)} />
                <PerfMetric label="Median" value={formatMs(run.median_duration)} />
                <PerfMetric label="p90" value={formatMs(run.p90_duration)} />
                <PerfMetric label="p95" value={formatMs(run.p95_duration)} />
                <PerfMetric label="p99" value={formatMs(run.p99_duration)} />
                <PerfMetric label="Maximum" value={formatMs(run.max_duration)} />
              </div>
            </div>
          </section>

          {/* Throughput */}
          <section className="mb-6">
            <h2 className="text-sm font-medium text-rams-text-secondary mb-3">Throughput</h2>
            <div className="rams-card p-4">
              <div className="grid grid-cols-2 gap-8">
                <PerfMetric label="Average requests/sec" value={run.requests_per_second?.toFixed(1) ?? "—"} />
                <PerfMetric label="Peak requests/sec" value={run.peak_rps?.toFixed(1) ?? "—"} />
              </div>
            </div>
          </section>

          {/* Endpoint breakdown */}
          {endpoints.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-rams-text-secondary mb-3">Request Breakdown</h2>
              <div className="rams-card overflow-hidden">
                <table className="rams-table">
                  <thead>
                    <tr>
                      <th>Endpoint</th>
                      <th>Method</th>
                      <th>p95</th>
                      <th>Average</th>
                      <th>Count</th>
                      <th>Failures</th>
                    </tr>
                  </thead>
                  <tbody>
                    {endpoints.map((ep) => (
                      <tr key={ep.id}>
                        <td className="font-mono text-2xs">{ep.endpoint}</td>
                        <td className="font-mono text-2xs text-rams-text-secondary">{ep.method}</td>
                        <td className="font-mono text-2xs">{formatMs(ep.p95)}</td>
                        <td className="font-mono text-2xs">{formatMs(ep.avg)}</td>
                        <td className="font-mono text-2xs">{formatNumber(ep.count)}</td>
                        <td className="font-mono text-2xs">{ep.fail_count > 0 ? <span className="text-rams-fail">{ep.fail_count}</span> : "0"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Error log */}
          {run.stderr_log && (
            <section className="mt-6">
              <h2 className="text-sm font-medium text-rams-text-secondary mb-3">Error Log</h2>
              <div className="rams-card p-4">
                <pre className="text-2xs text-rams-fail font-mono whitespace-pre-wrap break-all max-h-48 overflow-auto">{run.stderr_log}</pre>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function StatusBadge({ status, passed }: { status: string; passed: boolean | null }) {
  const config: Record<string, { color: string; label: string }> = {
    completed: { color: passed ? "bg-rams-pass" : "bg-rams-fail", label: passed ? "Passed" : "Failed" },
    running: { color: "bg-rams-running", label: "Running" },
    failed: { color: "bg-rams-fail", label: "Failed" },
    stopped: { color: "bg-rams-text-muted", label: "Stopped" },
    pending: { color: "bg-rams-warning", label: "Pending" },
  };
  const c = config[status] ?? { color: "bg-rams-text-muted", label: status };
  return (
    <span className="rams-status">
      <span className={cn("rams-status-dot", c.color)} />
      <span className="text-2xs">{c.label}</span>
    </span>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-rams-surface px-5 py-4">
      <div className="text-2xs text-rams-text-secondary uppercase tracking-wider mb-1">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function PerfMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xs text-rams-text-secondary uppercase tracking-wider mb-1">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}
