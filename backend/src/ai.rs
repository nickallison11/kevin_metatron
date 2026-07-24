use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use serde_json::json;

// ----------------------------
// Gemini request/response
// ----------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemInstruction {
    parts: Vec<TextPart>,
}

#[derive(Serialize)]
struct TextPart {
    text: String,
}

#[derive(Serialize)]
struct GeminiContent {
    role: String,
    parts: Vec<TextPart>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiGenerateRequest {
    system_instruction: SystemInstruction,
    contents: Vec<GeminiContent>,
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiCandidate {
    content: Option<GeminiContentOut>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiContentOut {
    parts: Option<Vec<GeminiPartOut>>,
}

#[derive(Deserialize)]
struct GeminiPartOut {
    text: Option<String>,
}

fn map_role_for_gemini(role: &str) -> String {
    match role {
        "assistant" => "model".to_string(), // Gemini's "model" role
        "model" => "model".to_string(),
        _ => "user".to_string(),
    }
}

async fn complete_chat_gemini(
    client: &reqwest::Client,
    api_key: &str,
    system: &str,
    messages: Vec<(String, String)>,
    model: &str,
) -> Result<String, String> {
    let contents: Vec<GeminiContent> = messages
        .into_iter()
        .map(|(role, content)| GeminiContent {
            role: map_role_for_gemini(&role),
            parts: vec![TextPart { text: content }],
        })
        .collect();

    let body = GeminiGenerateRequest {
        system_instruction: SystemInstruction {
            parts: vec![TextPart {
                text: system.to_string(),
            }],
        },
        contents,
    };

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    );

    let res = client
        .post(url)
        .query(&[("key", api_key)])
        .headers(headers)
        .timeout(Duration::from_secs(120))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("gemini request: {e}"))?;

    if !res.status().is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("gemini error: {t}"));
    }

    let parsed: GeminiResponse = res
        .json()
        .await
        .map_err(|e| format!("gemini json: {e}"))?;

    let text = parsed
        .candidates
        .as_ref()
        .and_then(|c| c.first())
        .and_then(|c| c.content.as_ref())
        .and_then(|c| c.parts.as_ref())
        .and_then(|p| p.first())
        .and_then(|p| p.text.as_ref())
        .cloned()
        .unwrap_or_default();

    Ok(text.trim().to_string())
}

// ----------------------------
// Anthropic request/response
// ----------------------------

#[derive(Serialize)]
struct AnthropicMessagesRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    system: &'a str,
    messages: Vec<AnthropicMessage>,
}

#[derive(Serialize)]
struct AnthropicMessage {
    role: String,
    content: Vec<AnthropicContent>,
}

#[derive(Serialize)]
struct AnthropicContent {
    #[serde(rename = "type")]
    kind: String,
    text: String,
}

#[derive(Deserialize)]
struct AnthropicMessagesResponse {
    content: Vec<AnthropicContentBlock>,
}

#[derive(Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    text: Option<String>,
}

async fn complete_chat_anthropic(
    client: &reqwest::Client,
    api_key: &str,
    system: &str,
    messages: Vec<(String, String)>,
    model: &str,
) -> Result<String, String> {
    let msgs: Vec<AnthropicMessage> = messages
        .into_iter()
        .map(|(role, content)| AnthropicMessage {
            role,
            content: vec![AnthropicContent {
                kind: "text".to_string(),
                text: content,
            }],
        })
        .collect();

    let body = AnthropicMessagesRequest {
        model,
        max_tokens: 4096,
        system,
        messages: msgs,
    };

    let mut headers = HeaderMap::new();
    headers.insert(
        "x-api-key",
        HeaderValue::from_str(api_key).map_err(|e| e.to_string())?,
    );
    headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
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

    let parsed: AnthropicMessagesResponse = res
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

// ----------------------------
// OpenAI request/response
// ----------------------------

#[derive(Serialize)]
struct OpenAiChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct OpenAiChatCompletionRequest<'a> {
    model: &'a str,
    messages: Vec<OpenAiChatMessage>,
    temperature: f32,
}

#[derive(Deserialize)]
struct OpenAiChatCompletionResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiChatCompletionMessage,
}

#[derive(Deserialize)]
struct OpenAiChatCompletionMessage {
    content: Option<String>,
}

async fn complete_chat_openai(
    client: &reqwest::Client,
    api_key: &str,
    system: &str,
    messages: Vec<(String, String)>,
    model: &str,
) -> Result<String, String> {
    let mut oa_messages: Vec<OpenAiChatMessage> = Vec::new();
    oa_messages.push(OpenAiChatMessage {
        role: "system".to_string(),
        content: system.to_string(),
    });

    for (role, content) in messages {
        let role = if role == "assistant" { "assistant" } else { "user" };
        oa_messages.push(OpenAiChatMessage {
            role: role.to_string(),
            content,
        });
    }

    let body = OpenAiChatCompletionRequest {
        model,
        messages: oa_messages,
        temperature: 0.2,
    };

    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {api_key}")).map_err(|e| e.to_string())?,
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .headers(headers)
        .timeout(Duration::from_secs(120))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("openai request: {e}"))?;

    if !res.status().is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("openai error: {t}"));
    }

    let parsed: OpenAiChatCompletionResponse = res
        .json()
        .await
        .map_err(|e| format!("openai json: {e}"))?;

    let text = parsed
        .choices
        .first()
        .and_then(|c| c.message.content.as_ref())
        .cloned()
        .unwrap_or_default();

    Ok(text.trim().to_string())
}


/// OpenRouter — used for Hermes 4 70B and Kimi K3. Wire-compatible with
/// OpenAI's chat-completions format, so it reuses the same request/response
/// shapes as `complete_chat_openai`, just pointed at a different host and
/// with OpenRouter's recommended attribution headers.
async fn complete_chat_openrouter(
    client: &reqwest::Client,
    api_key: &str,
    system: &str,
    messages: Vec<(String, String)>,
    model: &str,
) -> Result<String, String> {
    let mut oa_messages: Vec<OpenAiChatMessage> = Vec::new();
    oa_messages.push(OpenAiChatMessage {
        role: "system".to_string(),
        content: system.to_string(),
    });

    for (role, content) in messages {
        let role = if role == "assistant" { "assistant" } else { "user" };
        oa_messages.push(OpenAiChatMessage {
            role: role.to_string(),
            content,
        });
    }

    let body = OpenAiChatCompletionRequest {
        model,
        messages: oa_messages,
        temperature: 0.2,
    };

    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {api_key}")).map_err(|e| e.to_string())?,
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert("HTTP-Referer", HeaderValue::from_static("https://platform.metatron.id"));
    headers.insert("X-Title", HeaderValue::from_static("metatron Kevin"));

    let res = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .headers(headers)
        .timeout(Duration::from_secs(120))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("openrouter request: {e}"))?;

    if !res.status().is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("openrouter error: {t}"));
    }

    let parsed: OpenAiChatCompletionResponse = res
        .json()
        .await
        .map_err(|e| format!("openrouter json: {e}"))?;

    let text = parsed
        .choices
        .first()
        .and_then(|c| c.message.content.as_ref())
        .cloned()
        .unwrap_or_default();

    Ok(text.trim().to_string())
}

async fn complete_chat_nadirclaw(
    client: &reqwest::Client,
    base_url: &str,
    system: &str,
    messages: Vec<(String, String)>,
    model: &str,
) -> Result<String, String> {
    let mut oa_messages: Vec<OpenAiChatMessage> = Vec::new();
    oa_messages.push(OpenAiChatMessage {
        role: "system".to_string(),
        content: system.to_string(),
    });
    for (role, content) in messages {
        let role = if role == "assistant" { "assistant" } else { "user" };
        oa_messages.push(OpenAiChatMessage {
            role: role.to_string(),
            content,
        });
    }
    let body = OpenAiChatCompletionRequest { model, messages: oa_messages, temperature: 0.2 };
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let res = client
        .post(&url)
        .header(CONTENT_TYPE, HeaderValue::from_static("application/json"))
        .header(AUTHORIZATION, HeaderValue::from_str(&format!("Bearer local")).unwrap_or(HeaderValue::from_static("Bearer local")))
        .timeout(Duration::from_secs(60))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("nadirclaw request: {e}"))?;
    if !res.status().is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("nadirclaw error: {t}"));
    }
    let parsed: OpenAiChatCompletionResponse = res
        .json()
        .await
        .map_err(|e| format!("nadirclaw json: {e}"))?;
    let text = parsed
        .choices
        .first()
        .and_then(|c| c.message.content.as_ref())
        .cloned()
        .unwrap_or_default();
    Ok(text.trim().to_string())
}

// ----------------------------
// Public wrapper
// ----------------------------

pub async fn complete_chat(
    client: &reqwest::Client,
    provider: &str,
    api_key: &str,
    model: &str,
    system: &str,
    messages: Vec<(String, String)>,
) -> Result<String, String> {
    match provider {
        "gemini" => complete_chat_gemini(client, api_key, system, messages, model).await,
        "anthropic" => complete_chat_anthropic(client, api_key, system, messages, model).await,
        "openai" => complete_chat_openai(client, api_key, system, messages, model).await,
        "nadirclaw" => complete_chat_nadirclaw(client, api_key, system, messages, model).await,
        "openrouter" => complete_chat_openrouter(client, api_key, system, messages, model).await,
        _ => Err("unsupported provider".to_string()),
    }
}

/// Ask the model to return a single JSON object (no markdown).
pub async fn complete_json_object(
    client: &reqwest::Client,
    provider: &str,
    api_key: &str,
    model: &str,
    system: &str,
    user_prompt: &str,
) -> Result<serde_json::Value, String> {
    let system = format!(
        "{system}\nRespond with ONLY a valid JSON object, no markdown fences or commentary."
    );
    let text = complete_chat(
        client,
        provider,
        api_key,
        model,
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

/// Extract structured pitch fields from a PDF deck using Gemini (multimodal).
pub async fn extract_pitch_from_deck_pdf(
    client: &reqwest::Client,
    api_key: &str,
    pdf_bytes: &[u8],
    gemini_model: &str,
) -> Result<serde_json::Value, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let b64 = STANDARD.encode(pdf_bytes);

    let prompt = "Extract the following fields from this pitch deck and return as JSON with these exact field names: company_name, one_liner, problem, solution, market_size, business_model, traction, funding_ask, use_of_funds, incorporation_country, team_members (array of {name, role} objects), and full_text (the complete plaintext content of every slide concatenated in slide order, with each slide's heading prefixed and slides separated by a blank line; no markdown, no styling commentary, just the words on the slides plus visible chart labels). If a field is not found, omit it or set to null.";

    let body = json!({
        "contents": [{
            "role": "user",
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": "application/pdf", "data": b64}}
            ]
        }],
        "generationConfig": {
            "responseMimeType": "application/json"
        }
    });

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent"
    );

    let res = client
        .post(url.as_str())
        .query(&[("key", api_key)])
        .header(CONTENT_TYPE, HeaderValue::from_static("application/json"))
        .timeout(Duration::from_secs(120))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("gemini pdf request: {e}"))?;

    if !res.status().is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("gemini pdf error: {t}"));
    }

    let parsed: GeminiResponse = res
        .json()
        .await
        .map_err(|e| format!("gemini pdf json: {e}"))?;

    let text = parsed
        .candidates
        .as_ref()
        .and_then(|c| c.first())
        .and_then(|c| c.content.as_ref())
        .and_then(|c| c.parts.as_ref())
        .and_then(|p| p.first())
        .and_then(|p| p.text.as_ref())
        .cloned()
        .unwrap_or_default();

    let cleaned = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    serde_json::from_str(cleaned).map_err(|e| format!("deck json parse: {e}: {cleaned}"))
}

pub fn mock_call_analysis_json(transcript: &str) -> serde_json::Value {
    json!({
        "summary": format!("Overview of the conversation (mock): {}", transcript.chars().take(120).collect::<String>()),
        "key_takeaways": ["Key point one from the discussion", "Key point two to validate in diligence"],
        "action_items": ["Follow up with materials", "Schedule a second call"],
        "investor_sentiment": "cautiously_interested"
    })
}
