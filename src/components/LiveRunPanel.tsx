import { useEffect, useRef, useState } from "react";
import { api, type Run, type LiveMetricPoint } from "../lib/api";
import { formatMs, formatNumber, formatPercent, cn } from "../lib/utils";
import { Zap, Activity, Gauge, AlertCircle, Timer, CheckCircle2, XCircle, Terminal, ChevronRight } from "lucide-react";

/** Parse k6's console progress line: `running (01m11.4s), 5/5 VUs, 266 complete and 0 interrupted iterations` */
export interface LiveProgress {
  elapsed: string;
  vusActive: number;
  vusMax: number;
  iterations: number;
  interrupted: number;
}

export function parseK6Progress(log: string | null | undefined): LiveProgress | null {
  if (!log) return null;
  const lines = log.split("\n");
  // Scan bottom-up for the most recent progress line
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/\((\d+m[\d.]+s|\d+[\d.]+s)\)[^\d]*(\d+)\/(\d+)\s+VUs?,\s*(\d+)\s+complete\s+and\s+(\d+)\s+interr/i);
    if (m) {
      return {
        elapsed: m[1],
        vusActive: parseInt(m[2]),
        vusMax: parseInt(m[3]),
        iterations: parseInt(m[4]),
        interrupted: parseInt(m[5]),
      };
    }
  }
  return null;
}

export function parseDurationToSec(d: string): number {
  const m = d.match(/(\d+)(s|m|h)/);
  if (!m) return 30;
  const n = parseInt(m[1]);
  if (m[2] === "s") return n;
  if (m[2] === "m") return n * 60;
  if (m[2] === "h") return n * 3600;
  return 30;
}

export function AnimatedMetric({
  icon: Icon,
  label,
  value,
  active,
  danger,
}: {
  icon: any;
  label: string;
  value: string;
  active: boolean;
  danger?: boolean;
}) {
  return (
    <div className={cn("p-2.5 rounded-rams border transition-all", danger ? "border-rams-fail/20 bg-rams-fail/5" : "border-rams-border bg-rams-bg/30", active && "animate-pulse-subtle")}>
      <div className="flex items-center gap-1 mb-1">
        <Icon className={cn("w-3 h-3", danger ? "text-rams-fail" : "text-rams-text-muted")} strokeWidth={1.5} />
        <span className="text-2xs text-rams-text-secondary uppercase tracking-wider">{label}</span>
      </div>
      <div className={cn("font-mono text-sm font-medium", danger && "text-rams-fail")}>{value}</div>
    </div>
  );
}

export function LiveRunPanel({
  running,
  run,
  elapsed,
  duration,
  vus,
  url,
  proxyUrl,
  proxyType,
}: {
  running: boolean;
  run: Run | null;
  elapsed: number;
  duration: string;
  vus: number;
  url?: string;
  proxyUrl?: string;
  proxyType?: string;
}) {
  const totalSec = parseDurationToSec(duration);
  const progress = running ? Math.min((elapsed / totalSec) * 100, 100) : 100;
  const status = run?.status ?? (running ? "running" : "idle");
  const isRunning = status === "running";
  const isFailed = status === "failed" || (status === "completed" && run?.threshold_passed === false) || (status === "completed" && (run?.requests ?? 0) === 0);
  const isPassed = status === "completed" && run?.threshold_passed === true && (run?.requests ?? 0) > 0;
  const isStopped = status === "stopped";

  const statusColor = isRunning ? "text-rams-running" : isPassed ? "text-rams-pass" : isFailed ? "text-rams-fail" : "text-rams-text-muted";
  const statusBg = isRunning ? "bg-rams-running" : isPassed ? "bg-rams-pass" : isFailed ? "bg-rams-fail" : "bg-rams-text-muted";
  const statusBorder = isRunning ? "border-rams-running/30" : isPassed ? "border-rams-pass/30" : isFailed ? "border-rams-fail/30" : "border-rams-border";

  // Live stats parsed from k6's console output
  const k6Progress = parseK6Progress(run?.stdout_log);
  const liveRequests = isRunning && k6Progress ? k6Progress.iterations : (run?.requests ?? 0);
  const liveVus = isRunning && k6Progress ? `${k6Progress.vusActive}/${k6Progress.vusMax}` : String(run?.vus ?? vus);

  return (
    <div className={cn("rams-card p-5 mb-4 animate-slide-up border-l-2", statusBorder)} style={{ borderLeftColor: isRunning ? "#2D6A9F" : isPassed ? "#3B7A57" : isFailed ? "#C0392B" : "#A0A0A0" }}>
      {/* Status header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {/* Pulsing ring indicator */}
          <div className="relative flex items-center justify-center w-8 h-8">
            {isRunning && (
              <span className={cn("absolute w-3 h-3 rounded-full animate-pulse-ring", statusBg)} />
            )}
            <span className={cn("relative w-2.5 h-2.5 rounded-full", statusBg, isRunning && "animate-pulse-subtle")} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={cn("text-sm font-semibold uppercase tracking-wider", statusColor)}>
                {isRunning ? "Running" : isPassed ? "Passed" : isFailed ? "Failed" : isStopped ? "Stopped" : "Idle"}
              </span>
              {isRunning && (
                <span className="inline-flex items-center gap-1 text-2xs text-rams-running font-medium px-1.5 py-0.5 rounded-rams bg-rams-running/10">
                  <span className="w-1.5 h-1.5 rounded-full bg-rams-running animate-blink" />
                  LIVE
                </span>
              )}
            </div>
            <div className="text-2xs text-rams-text-muted mt-0.5">
              {isRunning ? `Elapsed: ${elapsed}s / ${duration}` : run ? `Completed in ${run.duration ?? "—"}` : ""}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {url && (
            <span className="text-2xs text-rams-text-muted font-mono hidden sm:inline">→ {url}</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {isRunning && (
        <div className="mb-4">
          <div className="h-1.5 rounded-full bg-rams-border overflow-hidden relative">
            <div
              className={cn("h-full rounded-full transition-all duration-1000 ease-linear", statusBg)}
              style={{ width: `${progress}%` }}
            />
            {/* Shimmer overlay */}
            <div
              className="absolute inset-0 opacity-30"
              style={{
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)",
                backgroundSize: "200% 100%",
                animation: "shimmer 2s linear infinite",
              }}
            />
          </div>
          <div className="flex justify-between mt-1 text-2xs text-rams-text-muted">
            <span>{elapsed}s elapsed</span>
            <span>{totalSec}s total</span>
          </div>
        </div>
      )}

      {/* Request flow animation + live status line */}
      {isRunning && (
        <div className="mb-4">
          <div className="flex items-center gap-1 h-6 overflow-hidden">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-rams-running shrink-0"
                style={{
                  animation: `flow 1.5s linear infinite`,
                  animationDelay: `${i * 0.12}s`,
                }}
              />
            ))}
            <span className="text-2xs text-rams-text-secondary ml-2 font-mono">
              {k6Progress
                ? `${k6Progress.elapsed} · ${k6Progress.vusActive}/${k6Progress.vusMax} VUs · ${formatNumber(k6Progress.iterations)} iterations · ${k6Progress.interrupted} interrupted`
                : "waiting for k6 output…"}
            </span>
          </div>
        </div>
      )}

      {/* Metrics grid */}
      <div className="grid grid-cols-6 gap-3">
        <AnimatedMetric icon={Zap} label="VUs" value={liveVus} active={isRunning} />
        <AnimatedMetric icon={Activity} label={isRunning ? "Iterations" : "Requests"} value={isRunning ? formatNumber(liveRequests) : (run ? formatNumber(run.requests) : "0")} active={isRunning} />
        <AnimatedMetric icon={Gauge} label="p95" value={run ? formatMs(run.p95_duration) : "—"} active={isRunning} />
        <AnimatedMetric icon={Gauge} label="p99" value={run ? formatMs(run.p99_duration) : "—"} active={isRunning} />
        <AnimatedMetric icon={AlertCircle} label="Errors" value={run ? formatPercent(run.failed_requests) : "0.00%"} active={isRunning} danger={run ? run.failed_requests > 0 : false} />
        <AnimatedMetric icon={Timer} label="RPS" value={run?.requests_per_second?.toFixed(1) ?? "—"} active={isRunning} />
      </div>

      {/* Live charts — response time, RPS, VUs, errors per second */}
      <LiveCharts runId={run?.id} isRunning={isRunning} />

      {/* Live console output */}
      <ConsoleLog log={run?.stdout_log} isRunning={isRunning} />

      {/* Proxy info */}
      {proxyUrl && proxyType && proxyType !== "none" && (
        <div className="mt-3 flex items-center gap-2 text-2xs text-rams-text-muted">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-rams border border-rams-border bg-rams-bg/50">
            <span className="font-medium">Proxy:</span>
            <span className="font-mono">{proxyType.toUpperCase()}</span>
            <span className="font-mono">{proxyUrl}</span>
          </span>
        </div>
      )}

      {/* Error log */}
      {run?.stderr_log && (isFailed || isStopped || (run.status === "completed" && run.requests === 0)) && (
        <div className="mt-3 p-3 rounded-rams border border-rams-fail/30 bg-rams-fail/5 animate-fade-in">
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertCircle className="w-3 h-3 text-rams-fail" strokeWidth={2} />
            <span className="text-2xs font-medium text-rams-fail uppercase tracking-wider">Error Output</span>
          </div>
          <pre className="text-2xs text-rams-fail font-mono whitespace-pre-wrap break-all max-h-32 overflow-auto">{run.stderr_log.slice(-800)}</pre>
        </div>
      )}

      {/* Success/fail banner */}
      {!isRunning && run && (
        <div className={cn("mt-3 p-3 rounded-rams border animate-bounce-in", isPassed ? "border-rams-pass/30 bg-rams-pass/5" : "border-rams-fail/30 bg-rams-fail/5")}>
          <div className="flex items-center gap-2">
            {isPassed ? (
              <CheckCircle2 className="w-4 h-4 text-rams-pass" strokeWidth={2} />
            ) : (
              <XCircle className="w-4 h-4 text-rams-fail" strokeWidth={2} />
            )}
            <span className={cn("text-sm font-medium", isPassed ? "text-rams-pass" : "text-rams-fail")}>
              {isPassed ? "All thresholds passed" : run.requests === 0 ? "Test produced 0 requests — see diagnostic output above" : run.failed_requests > 0 ? `${run.failed_requests.toFixed(2)}% error rate — thresholds breached` : "Threshold breach — p95 or p99 exceeded the limit"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Polls run_live_metrics and draws 4 minimal sparkline charts. */
function LiveCharts({ runId, isRunning }: { runId: string | undefined; isRunning: boolean }) {
  const [points, setPoints] = useState<LiveMetricPoint[]>([]);

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    const fetch = () =>
      api.getLiveMetrics(runId).then((p) => {
        if (alive) setPoints(p);
      }).catch(() => {});
    fetch();
    if (isRunning) {
      const t = setInterval(fetch, 1500);
      return () => {
        alive = false;
        clearInterval(t);
      };
    }
    return () => {
      alive = false;
    };
  }, [runId, isRunning]);

  if (points.length < 2) return null;

  const series = {
    rt: points.map((p) => p.avg_ms ?? 0),
    rps: points.map((p) => p.requests),
    vus: points.map((p) => p.vus ?? 0),
    err: points.map((p) => p.errors),
  };

  return (
    <div className="mt-3 grid grid-cols-4 gap-3">
      <MiniChart label="Response time" unit="ms" data={series.rt} color="#2D6A9F" />
      <MiniChart label="Requests/sec" unit="" data={series.rps} color="#3B7A57" />
      <MiniChart label="Virtual users" unit="" data={series.vus} color="#8A6D3B" />
      <MiniChart label="Errors/sec" unit="" data={series.err} color="#C0392B" />
    </div>
  );
}

function MiniChart({ label, unit, data, color }: { label: string; unit: string; data: number[]; color: string }) {
  const w = 200;
  const h = 48;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = Math.max(max - min, 1e-9);
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const path = data
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - 4 - ((v - min) / range) * (h - 8)).toFixed(1)}`)
    .join(" ");
  const latest = data[data.length - 1];

  return (
    <div className="rounded-rams border border-rams-border p-2">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-2xs text-rams-text-muted">{label}</span>
        <span className="text-2xs font-mono font-medium">
          {unit === "ms" ? formatMs(latest) : formatNumber(latest)}
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-12" preserveAspectRatio="none">
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        <path d={`${path} L${w},${h} L0,${h} Z`} fill={color} fillOpacity="0.08" stroke="none" />
      </svg>
    </div>
  );
}

/** Collapsible dark console showing the last N lines of k6's output. */
function ConsoleLog({ log, isRunning }: { log: string | null | undefined; isRunning: boolean }) {
  const [open, setOpen] = useState(true);
  const preRef = useRef<HTMLPreElement>(null);

  // Auto-scroll to bottom as new lines arrive
  useEffect(() => {
    if (open && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [log, open]);

  const lines = (log ?? "").split("\n").filter((l) => l.trim() !== "");
  const hasContent = lines.length > 0;

  if (!hasContent && !isRunning) return null;

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-2xs text-rams-text-secondary hover:text-rams-text mb-1.5"
      >
        <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-90")} strokeWidth={1.5} />
        <Terminal className="w-3.5 h-3.5" strokeWidth={1.5} />
        <span className="font-medium uppercase tracking-wider">k6 output</span>
        {hasContent && <span className="text-rams-text-muted">({lines.length} lines)</span>}
      </button>
      {open && (
        <pre
          ref={preRef}
          className="p-3 rounded-rams border border-rams-border text-2xs font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto"
          style={{ background: "#1C1C1C", color: "#D4D4D4" }}
        >
          {hasContent ? lines.slice(-200).join("\n") : <span className="text-rams-text-muted">Waiting for k6 output…</span>}
        </pre>
      )}
    </div>
  );
}
