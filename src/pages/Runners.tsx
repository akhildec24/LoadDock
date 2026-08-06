import { Server, Plus, Globe, Cpu, HardDrive, Activity, X, ShieldAlert, Network } from "lucide-react";
import { useState, useEffect } from "react";
import { api, type K6Status, type VpnStatus } from "../lib/api";

export default function Runners() {
  const [showAdd, setShowAdd] = useState(false);
  const [k6, setK6] = useState<K6Status | null>(null);
  const [vpn, setVpn] = useState<VpnStatus | null>(null);

  useEffect(() => {
    api.checkK6().then(setK6).catch(() => {});
    api.checkVpn().then(setVpn).catch(() => {});
  }, []);

  return (
    <div className="p-8 max-w-5xl animate-fade-in">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-semibold">Runners</h1>
        <button onClick={() => setShowAdd(true)} className="rams-btn rams-btn-primary">
          <Plus className="w-3.5 h-3.5" strokeWidth={2} />
          Add Runner
        </button>
      </div>
      <p className="text-2xs text-rams-text-muted mb-6">
        Runners execute k6 tests. The local runner uses this Mac. Add remote runners (VPS instances) to test from different locations or distribute load across machines.
      </p>

      {showAdd && (
        <div className="rams-card p-5 mb-4 animate-slide-up">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium">Add Remote Runner</h2>
            <button onClick={() => setShowAdd(false)} className="rams-btn rams-btn-ghost p-1">
              <X className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="rams-label block mb-1">Runner Name</label>
              <input className="rams-input w-full" placeholder="London VPS" />
            </div>
            <div>
              <label className="rams-label block mb-1">Endpoint</label>
              <input className="rams-input w-full" placeholder="https://loadrunner.example.net" />
            </div>
            <div>
              <label className="rams-label block mb-1">API Token</label>
              <input type="password" className="rams-input w-full" placeholder="••••••••••••••" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="rams-label block mb-1">Proxy Type</label>
                <select className="rams-select w-full" defaultValue="none">
                  <option value="none">No Proxy</option>
                  <option value="http">HTTP Proxy</option>
                  <option value="socks">SOCKS Proxy</option>
                </select>
              </div>
              <div>
                <label className="rams-label block mb-1">Proxy URL</label>
                <input className="rams-input w-full" placeholder="http://proxy:8080" />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setShowAdd(false)} className="rams-btn rams-btn-secondary">Cancel</button>
            <button onClick={() => setShowAdd(false)} className="rams-btn rams-btn-primary">Test Connection</button>
          </div>
        </div>
      )}

      {/* Local runner */}
      <div className="rams-card p-5 mb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center w-8 h-8">
              {k6?.installed && (
                <span className="absolute w-3 h-3 rounded-full bg-rams-pass animate-pulse-ring" />
              )}
              <Server className="w-4 h-4 text-rams-text-secondary" strokeWidth={1.5} />
            </div>
            <span className="text-sm font-medium">Local Mac</span>
          </div>
          <span className="inline-flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${k6?.installed ? "bg-rams-pass animate-pulse-subtle" : "bg-rams-fail"}`} />
            <span className={`text-2xs font-medium ${k6?.installed ? "text-rams-pass" : "text-rams-fail"}`}>
              {k6?.installed ? "Online" : "k6 Missing"}
            </span>
          </span>
        </div>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-2xs text-rams-text-secondary uppercase tracking-wider mb-0.5">Type</div>
            <div className="text-2xs">Local Runner</div>
          </div>
          <div>
            <div className="text-2xs text-rams-text-secondary uppercase tracking-wider mb-0.5">k6</div>
            <div className="text-2xs font-mono">{k6?.version ?? "Not installed"}</div>
          </div>
          <div>
            <div className="text-2xs text-rams-text-secondary uppercase tracking-wider mb-0.5">Max VUs</div>
            <div className="text-2xs font-mono">100</div>
          </div>
          <div>
            <div className="text-2xs text-rams-text-secondary uppercase tracking-wider mb-0.5">Max Duration</div>
            <div className="text-2xs font-mono">30 min</div>
          </div>
        </div>
        {vpn?.active && (
          <div className="mt-3 pt-3 border-t border-rams-border flex items-center gap-2 animate-fade-in">
            <ShieldAlert className="w-3.5 h-3.5 text-rams-warning animate-pulse-subtle" strokeWidth={1.5} />
            <span className="text-2xs text-rams-warning">
              VPN detected ({vpn.interface}) — test traffic routes through VPN, which may affect results
            </span>
          </div>
        )}
      </div>

      {/* No remote runners yet */}
      <div className="rams-card p-12 text-center">
        <Globe className="w-6 h-6 text-rams-text-muted mx-auto mb-3" strokeWidth={1.5} />
        <p className="text-sm text-rams-text-secondary mb-1">No remote runners configured</p>
        <p className="text-2xs text-rams-text-muted max-w-sm mx-auto">
          Remote runners are VPS instances that run k6 tests from a fixed IP address. Add one to test from different geographic locations or to distribute load across multiple machines. The runner's IP can be allowlisted in your infrastructure.
        </p>
      </div>
    </div>
  );
}
