import { useEffect, useState } from "react";
import { api, type Run } from "../lib/api";
import { formatMs, formatNumber, formatPercent, formatDateTime, cn } from "../lib/utils";
import { GitCompare } from "lucide-react";

export default function Compare() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [runA, setRunA] = useState<string>("");
  const [runB, setRunB] = useState<string>("");

  useEffect(() => {
    api.getRuns().then((r) => {
      setRuns(r.filter((x) => x.status === "completed"));
    });
  }, []);

  const a = runs.find((r) => r.id === runA);
  const b = runs.find((r) => r.id === runB);

  function calcChange(aVal: number | null, bVal: number | null): string {
    if (aVal === null || bVal === null) return "—";
    if (aVal === 0) return "—";
    const change = ((bVal - aVal) / aVal) * 100;
    const sign = change > 0 ? "+" : "";
    return `${sign}${change.toFixed(1)}%`;
  }

  function isImprovement(aVal: number | null, bVal: number | null, lowerIsBetter = true): boolean {
    if (aVal === null || bVal === null) return false;
    return lowerIsBetter ? bVal < aVal : bVal > aVal;
  }

  return (
    <div className="p-8 max-w-5xl animate-fade-in">
      <h1 className="text-xl font-semibold mb-2">Compare Runs</h1>
      <p className="text-2xs text-rams-text-muted mb-6">
        Select two test runs to compare their performance metrics side-by-side. Useful for spotting regressions or improvements after code changes.
      </p>

      {/* Selectors */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="rams-label block mb-1.5">Previous Run</label>
          <select className="rams-select w-full" value={runA} onChange={(e) => setRunA(e.target.value)}>
            <option value="">Select a run…</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {formatDateTime(r.started_at)} · {r.vus} VUs
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="rams-label block mb-1.5">Current Run</label>
          <select className="rams-select w-full" value={runB} onChange={(e) => setRunB(e.target.value)}>
            <option value="">Select a run…</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {formatDateTime(r.started_at)} · {r.vus} VUs
              </option>
            ))}
          </select>
        </div>
      </div>

      {a && b ? (
        <div className="rams-card overflow-hidden animate-fade-in">
          <table className="rams-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Previous</th>
                <th>Current</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              <CompareRow label="Average" a={formatMs(a.avg_duration)} b={formatMs(b.avg_duration)} change={calcChange(a.avg_duration, b.avg_duration)} improved={isImprovement(a.avg_duration, b.avg_duration)} />
              <CompareRow label="p95" a={formatMs(a.p95_duration)} b={formatMs(b.p95_duration)} change={calcChange(a.p95_duration, b.p95_duration)} improved={isImprovement(a.p95_duration, b.p95_duration)} />
              <CompareRow label="p99" a={formatMs(a.p99_duration)} b={formatMs(b.p99_duration)} change={calcChange(a.p99_duration, b.p99_duration)} improved={isImprovement(a.p99_duration, b.p99_duration)} />
              <CompareRow label="Errors" a={formatPercent(a.failed_requests)} b={formatPercent(b.failed_requests)} change={calcChange(a.failed_requests, b.failed_requests)} improved={isImprovement(a.failed_requests, b.failed_requests)} />
              <CompareRow label="Req/sec" a={a.requests_per_second?.toFixed(1) ?? "—"} b={b.requests_per_second?.toFixed(1) ?? "—"} change={calcChange(a.requests_per_second, b.requests_per_second)} improved={isImprovement(a.requests_per_second, b.requests_per_second, false)} />
              <CompareRow label="Requests" a={formatNumber(a.requests)} b={formatNumber(b.requests)} change={calcChange(a.requests, b.requests)} improved={isImprovement(a.requests, b.requests, false)} />
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rams-card p-12 text-center">
          <GitCompare className="w-6 h-6 text-rams-text-muted mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-sm text-rams-text-secondary">Select two runs to compare</p>
          <p className="text-2xs text-rams-text-muted mt-1">Compare before and after changes to see performance impact</p>
        </div>
      )}
    </div>
  );
}

function CompareRow({
  label,
  a,
  b,
  change,
  improved,
}: {
  label: string;
  a: string;
  b: string;
  change: string;
  improved: boolean;
}) {
  const isNeutral = change === "—";
  return (
    <tr>
      <td className="text-rams-text-secondary">{label}</td>
      <td className="font-mono text-2xs">{a}</td>
      <td className="font-mono text-2xs">{b}</td>
      <td className={cn("font-mono text-2xs", isNeutral ? "text-rams-text-muted" : improved ? "text-rams-pass" : "text-rams-fail")}>
        {change}
      </td>
    </tr>
  );
}
