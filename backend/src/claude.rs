use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Serialize)]
struct AnthropicRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    system: &'a str,
    messages: Vec<AnthropicMsg>,
}

#[derive(Serialize)]
struct AnthropicMsg {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<ContentBlock>,
}

#[derive(Deserialize)]
struct ContentBlock {
    #[allow(dead_code)]
    #[serde(rename = "type")]
    block_type: String,
    text: Option<String>,
}

pub async fn complete_chat(
    client: &reqwest::Client,
    api_key: &str,
    system: &str,
    messages: Vec<(String, String)>,
) -> Result<String, String> {
    let msgs: Vec<AnthropicMsg> = messages
        .into_iter()
        .map(|(role, content)| AnthropicMsg { role, content })
        .collect();

    let body = AnthropicRequest {
        model: "claude-3-5-haiku-20241022",
        max_tokens: 4096,
        system,
        messages: msgs,
    };

    let mut headers = HeaderMap::new();
    headers.insert(
        "x-api-key",
        HeaderValue::from_str(api_key).map_err(|e| e.to_string())?,
    );
    headers.insert(
        "anthropic-version",
        HeaderValue::from_static("2023-06-01"),
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .headers(headers)
        .timeout(Duration::from_secs(120))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("anthropic request: {e}"))?;

    if !res.status().is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("anthropic error: {t}"));
    }

    let parsed: AnthropicResponse = res
        .json()
        .await
        .map_err(|e| format!("anthropic json: {e}"))?;

    let text = parsed
        .content
        .into_iter()
        .filter_map(|b| b.text)
        .collect::<Vec<_>>()
        .join("\n");

    Ok(text.trim().to_string())
}

/// Ask Claude to return a single JSON object (no markdown).
pub async fn complete_json_object(
    client: &reqwest::Client,
    api_key: &str,
    system: &str,
    user_prompt: &str,
) -> Result<serde_json::Value, String> {
    let system = format!(
        "{system}\nRespond with ONLY a valid JSON object, no markdown fences or commentary."
    );
    let text = complete_chat(
        client,
        api_key,
        &system,
        vec![("user".into(), user_prompt.to_string())],
    )
    .await?;

    let cleaned = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    serde_json::from_str(cleaned).map_err(|e| format!("json parse: {e}: {cleaned}"))
}

pub fn mock_call_analysis_json(transcript: &str) -> serde_json::Value {
    json!({
        "summary": format!("Overview of the conversation (mock): {}", transcript.chars().take(120).collect::<String>()),
        "key_takeaways": ["Key point one from the discussion", "Key point two to validate in diligence"],
        "action_items": ["Follow up with materials", "Schedule a second call"],
        "investor_sentiment": "cautiously_interested"
    })
}
