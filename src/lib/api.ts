import { invoke } from "@tauri-apps/api/core";

export interface K6Status {
  installed: boolean;
  version: string | null;
  path: string | null;
}

export interface VpnStatus {
  active: boolean;
  interface: string | null;
}

export interface Project {
  id: string;
  name: string;
  production_url: string | null;
  staging_url: string | null;
  default_runner: string;
  default_headers: string | null;
  auth_config: string | null;
  notes: string | null;
  tags: string | null;
  cloudflare_enabled: boolean;
  safe_traffic_limits: string | null;
  proxy_url: string | null;
  proxy_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface Test {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  test_type: string;
  config: string;
  script: string | null;
  is_custom_script: boolean;
  thresholds: string | null;
  created_at: string;
  updated_at: string;
}

export interface Run {
  id: string;
  test_id: string;
  project_id: string;
  runner_id: string | null;
  environment_id: string | null;
  started_at: string;
  finished_at: string | null;
  status: string;
  vus: number;
  duration: string | null;
  requests: number;
  failed_requests: number;
  avg_duration: number | null;
  min_duration: number | null;
  max_duration: number | null;
  median_duration: number | null;
  p90_duration: number | null;
  p95_duration: number | null;
  p99_duration: number | null;
  requests_per_second: number | null;
  peak_rps: number | null;
  threshold_passed: boolean | null;
  raw_results_path: string | null;
  stdout_log: string | null;
  stderr_log: string | null;
}

export interface RunEndpoint {
  id: string;
  run_id: string;
  endpoint: string;
  method: string;
  p95: number | null;
  avg: number | null;
  min: number | null;
  max: number | null;
  count: number;
  fail_count: number;
}

export interface LiveMetricPoint {
  ts: number;
  requests: number;
  errors: number;
  avg_ms: number | null;
  max_ms: number | null;
  vus: number | null;
}

export interface Environment {
  id: string;
  project_id: string;
  name: string;
  url: string;
  env_type: string;
}

export interface TestPreset {
  id: string;
  name: string;
  vus: number;
  duration: string;
  is_default: boolean;
  sort_order: number;
}

export interface DashboardStats {
  projects: number;
  tests: number;
  runs_this_month: number;
  active_runs: number;
}

export interface RecentRun {
  id: string;
  project_name: string;
  test_name: string;
  status: string;
  p95: number | null;
  started_at: string;
  threshold_passed: boolean | null;
}

export const api = {
  checkK6: () => invoke<K6Status>("check_k6"),
  installK6: () => invoke<string>("install_k6"),
  checkVpn: () => invoke<VpnStatus>("check_vpn"),
  getProjects: () => invoke<Project[]>("get_projects"),
  createProject: (input: {
    name: string;
    production_url?: string;
    staging_url?: string;
    notes?: string;
    tags?: string;
    cloudflare_enabled?: boolean;
    proxy_url?: string;
    proxy_type?: string;
  }) => invoke<Project>("create_project", { input }),
  updateProject: (input: {
    id: string;
    name?: string;
    production_url?: string;
    staging_url?: string;
    default_headers?: string;
    auth_config?: string;
    notes?: string;
    tags?: string;
    cloudflare_enabled?: boolean;
    proxy_url?: string;
    proxy_type?: string;
  }) => invoke<void>("update_project", { input }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),
  getTests: (projectId: string) => invoke<Test[]>("get_tests", { projectId }),
  getTest: (id: string) => invoke<Test | null>("get_test", { id }),
  createTest: (input: {
    project_id: string;
    name: string;
    description?: string;
    test_type: string;
    config: string;
    thresholds?: string;
  }) => invoke<Test>("create_test", { input }),
  updateTest: (input: {
    id: string;
    name?: string;
    description?: string;
    config?: string;
    script?: string;
    is_custom_script?: boolean;
    thresholds?: string;
  }) => invoke<void>("update_test", { input }),
  deleteTest: (id: string) => invoke<void>("delete_test", { id }),
  generateScript: (config: string, thresholds?: string) =>
    invoke<string>("generate_script", { config, thresholds }),
  runTest: (input: {
    test_id: string;
    project_id: string;
    script: string;
    vus: number;
    duration: string;
    proxy_url?: string;
    proxy_type?: string;
    environment_id?: string;
  }) => invoke<string>("run_test", { input }),
  runQuickTest: (input: {
    project_id: string;
    test_type: string;
    url: string;
    vus: number;
    duration: string;
    proxy_url?: string;
    proxy_type?: string;
    environment_id?: string;
  }) => invoke<string>("run_quick_test", { input }),
  stopTest: (runId: string) => invoke<void>("stop_test", { runId }),
  getRuns: (projectId?: string) => invoke<Run[]>("get_runs", { projectId }),
  getRun: (id: string) => invoke<Run | null>("get_run", { id }),
  getRunMetrics: (runId: string) => invoke<RunEndpoint[]>("get_run_metrics", { runId }),
  getLiveMetrics: (runId: string) => invoke<LiveMetricPoint[]>("get_live_metrics", { runId }),
  getSettings: () => invoke<Record<string, string>>("get_settings"),
  updateSettings: (settings: Record<string, string>) => invoke<void>("update_settings", { settings }),
  getDashboardStats: () => invoke<DashboardStats>("get_dashboard_stats"),
  getRecentRuns: (limit?: number) => invoke<RecentRun[]>("get_recent_runs", { limit }),
  getActiveRuns: () => invoke<RecentRun[]>("get_active_runs"),
  getTestPresets: () => invoke<TestPreset[]>("get_test_presets"),
  getEnvironments: (projectId: string) => invoke<Environment[]>("get_environments", { projectId }),
  createEnvironment: (input: {
    project_id: string;
    name: string;
    url: string;
    env_type?: string;
  }) => invoke<Environment>("create_environment", { input }),
  deleteEnvironment: (id: string) => invoke<void>("delete_environment", { id }),
  updateTestPreset: (id: string, name: string, vus: number, duration: string) =>
    invoke<void>("update_test_preset", { id, name, vus, duration }),
};
