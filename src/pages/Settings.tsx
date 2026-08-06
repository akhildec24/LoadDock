import { useEffect, useState } from "react";
import { api, type TestPreset, type K6Status } from "../lib/api";
import { Save, AlertTriangle, Terminal, Download, CheckCircle2, Loader2 } from "lucide-react";

export default function Settings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [presets, setPresets] = useState<TestPreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [k6Status, setK6Status] = useState<K6Status | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installMsg, setInstallMsg] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getSettings(), api.getTestPresets(), api.checkK6()]).then(([s, p, k6]) => {
      setSettings(s);
      setPresets(p);
      setK6Status(k6);
    });
  }, []);

  async function handleInstallK6() {
    setInstalling(true);
    setInstallError(null);
    setInstallMsg(null);
    try {
      const output = await api.installK6();
      setInstallMsg("k6 installed successfully");
      const k6 = await api.checkK6();
      setK6Status(k6);
    } catch (err) {
      setInstallError(String(err));
    } finally {
      setInstalling(false);
    }
  }

  function update(key: string, value: string) {
    setSettings({ ...settings, [key]: value });
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    await api.updateSettings(settings);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function updatePreset(id: string, field: string, value: string) {
    const updated = presets.map((p) =>
      p.id === id ? { ...p, [field]: field === "vus" ? Number(value) : value } : p
    );
    setPresets(updated as TestPreset[]);
  }

  async function savePreset(p: TestPreset) {
    await api.updateTestPreset(p.id, p.name, p.vus, p.duration);
  }

  return (
    <div className="p-8 max-w-3xl animate-fade-in">
      <h1 className="text-xl font-semibold mb-6">Settings</h1>

      {/* k6 installation */}
      <section className="mb-6">
        <h2 className="text-sm font-medium text-rams-text-secondary mb-3">k6 Installation</h2>
        <div className="rams-card p-4">
          <div className="flex items-start gap-3">
            <Terminal className="w-5 h-5 text-rams-text-secondary mt-0.5" strokeWidth={1.5} />
            <div className="flex-1">
              {k6Status?.installed ? (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle2 className="w-4 h-4 text-rams-pass" strokeWidth={1.5} />
                      <span className="text-sm font-medium">k6 is installed</span>
                    </div>
                    {k6Status.version && (
                      <p className="text-2xs text-rams-text-secondary font-mono">Version {k6Status.version}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-sm mb-3">k6 is required to run tests locally.</p>
                  {installError && (
                    <div className="mb-3 p-3 rounded-rams border border-rams-fail/30 bg-rams-fail/5">
                      <p className="text-2xs text-rams-fail font-mono">{installError}</p>
                    </div>
                  )}
                  {installMsg && (
                    <div className="mb-3 p-3 rounded-rams border border-rams-pass/30 bg-rams-pass/5">
                      <p className="text-2xs text-rams-pass">{installMsg}</p>
                    </div>
                  )}
                  <button
                    onClick={handleInstallK6}
                    disabled={installing}
                    className="rams-btn rams-btn-primary"
                  >
                    {installing ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
                        Installing…
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" strokeWidth={2} />
                        Install k6 via Homebrew
                      </>
                    )}
                  </button>
                  <p className="text-2xs text-rams-text-muted mt-2">
                    Runs <span className="font-mono">brew install k6</span> on your Mac.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Safety limits */}
      <section className="mb-6">
        <h2 className="text-sm font-medium text-rams-text-secondary mb-3">Safety Limits</h2>
        <div className="rams-card p-4">
          <div className="flex items-start gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-rams-warning mt-0.5 shrink-0" strokeWidth={1.5} />
            <p className="text-2xs text-rams-text-secondary">
              These limits prevent accidental high-volume testing. Tests exceeding warning thresholds require explicit confirmation.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <SettingInput label="Max Local VUs" hint="Maximum concurrent virtual users allowed when running tests on this Mac." value={settings.max_local_vus ?? "100"} onChange={(v) => update("max_local_vus", v)} />
            <SettingInput label="Max Remote VUs" hint="Maximum concurrent virtual users allowed on remote runners." value={settings.max_remote_vus ?? "500"} onChange={(v) => update("max_remote_vus", v)} />
            <SettingInput label="Max Duration (minutes)" hint="Longest test run allowed before it's auto-stopped." value={settings.max_duration_minutes ?? "30"} onChange={(v) => update("max_duration_minutes", v)} />
            <SettingInput label="Max Requests/sec" hint="Hard cap on requests per second. Tests exceeding this are blocked." value={settings.max_rps ?? "100"} onChange={(v) => update("max_rps", v)} />
            <SettingInput label="Warning VU Threshold" hint="Tests above this VU count show a warning before starting." value={settings.warning_vus_threshold ?? "100"} onChange={(v) => update("warning_vus_threshold", v)} />
            <SettingInput label="Warning RPS Threshold" hint="Tests above this RPS show a warning before starting." value={settings.warning_rps_threshold ?? "50"} onChange={(v) => update("warning_rps_threshold", v)} />
          </div>
          <div className="flex justify-end mt-4">
            <button onClick={handleSave} className="rams-btn rams-btn-primary" disabled={saving}>
              <Save className="w-3.5 h-3.5" strokeWidth={1.5} />
              {saving ? "Saving…" : saved ? "Saved!" : "Save Settings"}
            </button>
          </div>
        </div>
      </section>

      {/* Test presets */}
      <section className="mb-6">
        <h2 className="text-sm font-medium text-rams-text-secondary mb-3">Test Presets</h2>
        <div className="rams-card p-4">
          <p className="text-2xs text-rams-text-muted mb-2">
            Quick-start templates for common load test scenarios. When you create a new test, you can pick a preset instead of configuring VUs and duration from scratch. Adjust the values below to match your typical testing needs.
          </p>
          <div className="flex items-start gap-2 mb-4">
            <AlertTriangle className="w-3.5 h-3.5 text-rams-text-muted mt-0.5 shrink-0" strokeWidth={1.5} />
            <p className="text-2xs text-rams-text-muted">
              <span className="font-medium">VUs</span> = Virtual Users (concurrent requests). <span className="font-medium">Duration</span> = how long the test runs (e.g. 30s, 1m, 5m).
            </p>
          </div>
          <div className="space-y-2">
            {presets.map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <span className="text-sm w-24">{p.name}</span>
                <input
                  type="number"
                  className="rams-input w-24"
                  value={p.vus}
                  onChange={(e) => updatePreset(p.id, "vus", e.target.value)}
                  min={1}
                />
                <span className="text-2xs text-rams-text-secondary">VUs for</span>
                <input
                  className="rams-input w-24"
                  value={p.duration}
                  onChange={(e) => updatePreset(p.id, "duration", e.target.value)}
                />
                <button
                  onClick={() => savePreset({ ...p, vus: Number(p.vus) })}
                  className="rams-btn rams-btn-ghost text-2xs p-1"
                >
                  <Save className="w-3 h-3" strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* About */}
      <section>
        <h2 className="text-sm font-medium text-rams-text-secondary mb-3">About</h2>
        <div className="rams-card p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-rams-text-secondary">Version</span>
            <span className="font-mono">0.1.0</span>
          </div>
          <div className="flex items-center justify-between text-sm mt-2">
            <span className="text-rams-text-secondary">Data Location</span>
            <span className="font-mono text-2xs">~/Library/Application Support/LoadDock/</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function SettingInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className="rams-label block mb-1">{label}</label>
      <input className="rams-input w-full" value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="text-2xs text-rams-text-muted mt-1">{hint}</p>}
    </div>
  );
}
