use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct TestConfig {
    pub url: String,
    pub method: Option<String>,
    pub requests: Vec<RequestConfig>,
    pub stages: Vec<StageConfig>,
    pub vus: Option<i64>,
    pub duration: Option<String>,
    pub mode: Option<String>,
    pub target_rps: Option<i64>,
    pub think_time: Option<f64>,
    pub default_headers: Option<HashMap<String, String>>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RequestConfig {
    pub method: String,
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub expected_status: Option<i64>,
    pub think_time: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct StageConfig {
    pub target_vus: i64,
    pub duration: String,
}

use std::collections::HashMap;

pub fn generate_script(config_str: &str, thresholds: Option<&str>) -> String {
    let config: TestConfig = match serde_json::from_str(config_str) {
        Ok(c) => c,
        Err(_) => return generate_fallback_script(config_str),
    };

    let mut script = String::new();

    script.push_str("import http from 'k6/http';\n");
    script.push_str("import { check, sleep } from 'k6';\n\n");

    // Options
    script.push_str("export const options = {\n");

    // Stages or fixed VUs
    if !config.stages.is_empty() {
        script.push_str("  stages: [\n");
        for stage in &config.stages {
            script.push_str(&format!(
                "    {{ duration: '{}', target: {} }},\n",
                stage.duration, stage.target_vus
            ));
        }
        script.push_str("  ],\n");
    } else if let Some(rps) = config.target_rps {
        if config.mode.as_deref() == Some("rps") {
            script.push_str(&format!(
                "  scenarios: {{\n    constant_rps: {{\n      executor: 'constant-arrival-rate',\n      rate: {},\n      timeUnit: '1s',\n      duration: '{}',\n      preAllocatedVUs: {},\n    }},\n  }},\n",
                rps,
                config.duration.as_deref().unwrap_or("1m"),
                (rps as f64 * 1.5).ceil() as i64
            ));
        }
    } else if let Some(vus) = config.vus {
        script.push_str(&format!(
            "  vus: {},\n  duration: '{}',\n",
            vus,
            config.duration.as_deref().unwrap_or("1m")
        ));
    }

    // Thresholds
    script.push_str("  thresholds: {\n");
    if let Some(t) = thresholds {
        if let Ok(custom) = serde_json::from_str::<serde_json::Value>(t) {
            if let Some(obj) = custom.as_object() {
                for (key, val) in obj {
                    script.push_str(&format!("    {}: {},\n", key, val));
                }
            }
        }
    }
    if !script.contains("http_req_failed") {
        script.push_str("    http_req_failed: ['rate<0.01'],\n");
    }
    if !script.contains("http_req_duration") {
        script.push_str("    http_req_duration: ['p(95)<1000'],\n");
    }
    script.push_str("  },\n");
    script.push_str("};\n\n");

    // Default headers (project auth + custom defaults).
    // Values starting with "__ENV." are emitted unquoted so k6 resolves them
    // as environment variables — keeps secrets out of the script file.
    let default_headers = config.default_headers.as_ref().filter(|h| !h.is_empty());
    if let Some(dh) = default_headers {
        let entries: Vec<String> = dh
            .iter()
            .map(|(k, v)| {
                if v.starts_with("__ENV.") {
                    format!("'{}': {}", k, v)
                } else {
                    format!("'{}': '{}'", k, v.replace('\'', "\\'"))
                }
            })
            .collect();
        script.push_str(&format!("const __defaultHeaders = {{ {} }};\n\n", entries.join(", ")));
    }

    // Helper to render merged headers for a request
    let render_headers = |req_headers: Option<&HashMap<String, String>>| -> String {
        match (default_headers, req_headers) {
            (None, None) => String::new(),
            (Some(_), None) => "{ headers: __defaultHeaders }".to_string(),
            (None, Some(h)) if !h.is_empty() => {
                let entries: Vec<String> = h
                    .iter()
                    .map(|(k, v)| format!("'{}': '{}'", k, v.replace('\'', "\\'")))
                    .collect();
                format!("{{ headers: {{ {} }} }}", entries.join(", "))
            }
            (Some(_), Some(h)) if !h.is_empty() => {
                let entries: Vec<String> = h
                    .iter()
                    .map(|(k, v)| format!("'{}': '{}'", k, v.replace('\'', "\\'")))
                    .collect();
                format!("{{ headers: Object.assign({{}}, __defaultHeaders, {{ {} }}) }}", entries.join(", "))
            }
            _ => String::new(),
        }
    };

    // Default function
    script.push_str("export default function () {\n");

    if config.requests.is_empty() {
        let method = config.method.as_deref().unwrap_or("GET");
        let lower = method.to_lowercase();
        let params = render_headers(None);
        if params.is_empty() {
            script.push_str(&format!(
                "  const response = http.{}('{}');\n",
                lower, config.url
            ));
        } else {
            script.push_str(&format!(
                "  const response = http.{}('{}', {});\n",
                lower, config.url, params
            ));
        }
        script.push_str("  check(response, {\n");
        script.push_str(&format!(
            "    'status is 200': (r) => r.status === 200,\n"
        ));
        script.push_str("  });\n");
        let think = config.think_time.unwrap_or(1.0);
        script.push_str(&format!("  sleep({});\n", think));
    } else {
        for req in &config.requests {
            let lower = req.method.to_lowercase();
            let url = if req.url.starts_with("http") {
                req.url.clone()
            } else {
                format!("{}{}", config.url, req.url)
            };

            let headers_params = render_headers(req.headers.as_ref());
            let body_val = req.body.clone().unwrap_or_else(|| "null".to_string());
            let body_js = if body_val == "null" {
                "null".to_string()
            } else {
                format!("'{}'", body_val.replace('\'', "\\'"))
            };

            if headers_params.is_empty() {
                script.push_str(&format!(
                    "  const response = http.{}('{}', {});\n",
                    lower, url, body_js
                ));
            } else {
                script.push_str(&format!(
                    "  const response = http.{}('{}', {}, {});\n",
                    lower, url, body_js, headers_params
                ));
            }

            let expected = req.expected_status.unwrap_or(200);
            script.push_str(&format!(
                "  check(response, {{\n    'status is {}': (r) => r.status === {},\n  }});\n",
                expected, expected
            ));

            let think = req.think_time.unwrap_or(config.think_time.unwrap_or(1.0));
            if think > 0.0 {
                script.push_str(&format!("  sleep({});\n", think));
            }
        }
    }

    script.push_str("}\n");

    script
}

fn generate_fallback_script(config_str: &str) -> String {
    format!(
        "import http from 'k6/http';\nimport {{ check, sleep }} from 'k6';\n\nexport const options = {{\n  vus: 1,\n  duration: '30s',\n  thresholds: {{\n    http_req_failed: ['rate<0.01'],\n    http_req_duration: ['p(95)<1000'],\n  }},\n}};\n\nexport default function () {{\n  const response = http.get('{}');\n  check(response, {{\n    'status is 200': (r) => r.status === 200,\n  }});\n  sleep(1);\n}}\n",
        config_str.replace('\'', "\\'")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_headers_emit_env_refs_unquoted() {
        let config = r#"{
            "url": "https://example.com",
            "method": "GET",
            "requests": [], "stages": [],
            "vus": 5, "duration": "30s",
            "default_headers": {
                "Authorization": "__ENV.LD_H0",
                "X-Custom": "static-val"
            }
        }"#;
        let s = generate_script(config, None);
        // Env placeholder emitted unquoted — k6 resolves at runtime
        assert!(s.contains("'Authorization': __ENV.LD_H0"), "env ref unquoted:\n{}", s);
        assert!(s.contains("'X-Custom': 'static-val'"), "static header quoted:\n{}", s);
        assert!(s.contains("headers: __defaultHeaders"));
        // Secret value must NOT appear in script
        assert!(!s.contains("Bearer"));
    }

    #[test]
    fn request_headers_merge_with_defaults() {
        let config = r#"{
            "url": "https://example.com",
            "requests": [{"method": "POST", "url": "/api", "headers": {"Content-Type": "application/json"}, "body": "{\"a\":1}", "expected_status": 201}],
            "stages": [],
            "vus": 1, "duration": "10s",
            "default_headers": {"Authorization": "__ENV.LD_H0"}
        }"#;
        let s = generate_script(config, None);
        assert!(s.contains("Object.assign({}, __defaultHeaders"), "merged headers:\n{}", s);
        assert!(s.contains("'status is 201'"), "expected status:\n{}", s);
        assert!(s.contains("http.post('https://example.com/api'"), "post call:\n{}", s);
    }

    #[test]
    fn rps_mode_emits_constant_arrival_rate() {
        let config = r#"{
            "url": "https://example.com",
            "requests": [], "stages": [],
            "vus": 50, "duration": "1m",
            "mode": "rps", "target_rps": 20
        }"#;
        let s = generate_script(config, None);
        assert!(s.contains("constant-arrival-rate"), "executor:\n{}", s);
        assert!(s.contains("rate: 20"), "rate:\n{}", s);
        assert!(!s.contains("vus: 50,"), "plain vus should not be emitted in rps mode:\n{}", s);
    }

    #[test]
    fn relative_request_url_joins_base() {
        let config = r#"{
            "url": "https://staging.example.com",
            "requests": [{"method": "GET", "url": "/health"}],
            "stages": [], "vus": 1, "duration": "10s"
        }"#;
        let s = generate_script(config, None);
        assert!(s.contains("http.get('https://staging.example.com/health'"), "{}", s);
    }
}
