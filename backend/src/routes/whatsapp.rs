use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use reqwest::multipart::{Form, Part};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;

use super::kevin::{kevin_reply_for_linked_user, KevinReplyError, UserForTelegram};

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/webhook", get(verify_webhook).post(webhook_post))
}

#[derive(Deserialize)]
pub struct HubVerify {
    #[serde(rename = "hub.mode")]
    pub hub_mode: Option<String>,
    #[serde(rename = "hub.verify_token")]
    pub hub_verify_token: Option<String>,
    #[serde(rename = "hub.challenge")]
    pub hub_challenge: Option<String>,
}

async fn verify_webhook(
    State(state): State<Arc<AppState>>,
    Query(q): Query<HubVerify>,
) -> Result<String, StatusCode> {
    let mode = q.hub_mode.as_deref();
    let token = q.hub_verify_token.as_deref();
    let expected = state.whatsapp_verify_token.as_deref();
    if mode == Some("subscribe")
        && token.is_some()
        && expected.is_some()
        && token == expected
    {
        return Ok(q.hub_challenge.unwrap_or_default());
    }
    Err(StatusCode::FORBIDDEN)
}

async fn webhook_post(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Value>,
) -> StatusCode {
    if let Err(e) = process_whatsapp_webhook(&state, body).await {
        tracing::error!("whatsapp webhook: {e}");
    }
    StatusCode::OK
}

fn normalize_digits(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_digit()).collect()
}

async fn process_whatsapp_webhook(state: &Arc<AppState>, body: Value) -> Result<(), String> {
    let Some(entries) = body.get("entry").and_then(|e| e.as_array()) else {
        return Ok(());
    };

    for entry in entries {
        let Some(changes) = entry.get("changes").and_then(|c| c.as_array()) else {
            continue;
        };
        for ch in changes {
            let Some(value) = ch.get("value") else {
                continue;
            };
            let Some(messages) = value.get("messages").and_then(|m| m.as_array()) else {
                continue;
            };
            for msg in messages {
                let from = msg
                    .get("from")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string());
                let Some(from_id) = from else { continue };

                let msg_type = msg.get("type").and_then(|t| t.as_str());

                let text_opt: Option<String> = if msg_type == Some("text") {
                    msg.get("text")
                        .and_then(|t| t.get("body"))
                        .and_then(|b| b.as_str())
                        .map(|s| s.to_string())
                } else if msg_type == Some("audio") {
                    let media_id = msg
                        .get("audio")
                        .and_then(|a| a.get("id"))
                        .and_then(|id| id.as_str());
                    match media_id {
                        Some(mid) => {
                            let bytes = download_whatsapp_media(state, mid).await?;
                            Some(transcribe_whisper(state, &bytes).await?)
                        }
                        None => None,
                    }
                } else {
                    continue;
                };

                let Some(text) = text_opt else {
                    continue;
                };
                if text.trim().is_empty() {
                    continue;
                }

                let _ = handle_whatsapp_message(state, &from_id, text).await;
            }
        }
    }
    Ok(())
}

async fn download_whatsapp_media(state: &AppState, media_id: &str) -> Result<Vec<u8>, String> {
    let token = state
        .whatsapp_access_token
        .as_deref()
        .ok_or_else(|| "WHATSAPP_ACCESS_TOKEN not set".to_string())?;
    let meta_url = format!("https://graph.facebook.com/v18.0/{}", media_id);
    let r = state
        .http_client
        .get(&meta_url)
        .query(&[("access_token", token)])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let v: Value = r.json().await.map_err(|e| e.to_string())?;
    let media_url = v
        .get("url")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "missing media url".to_string())?;
    let r2 = state
        .http_client
        .get(media_url)
        .query(&[("access_token", token)])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(r2.bytes().await.map_err(|e| e.to_string())?.to_vec())
}

async fn transcribe_whisper(state: &AppState, audio_bytes: &[u8]) -> Result<String, String> {
    let base = state.whisper_url.trim_end_matches('/');
    let url = format!("{base}/asr?encode=true&task=transcribe&language=en&output=txt");
    let form = Form::new().part(
        "audio_file",
        Part::bytes(audio_bytes.to_vec()).file_name("audio.ogg".to_string()),
    );
    let resp = state
        .http_client
        .post(url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let txt = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "whisper: {} {}",
            status,
            txt.chars().take(200).collect::<String>()
        ));
    }
    Ok(txt.trim().to_string())
}

async fn handle_whatsapp_message(
    state: &Arc<AppState>,
    from_wa_id: &str,
    text: String,
) -> Result<(), String> {
    let norm = normalize_digits(from_wa_id);

    let user: Option<UserForTelegram> = sqlx::query_as(
        r#"
        SELECT id, is_pro, subscription_tier, role::text,
               custom_ai_provider, custom_ai_api_key, custom_ai_model
        FROM users
        WHERE regexp_replace(COALESCE(whatsapp_number, ''), '[^0-9]', '', 'g') = $1
        "#,
    )
    .bind(&norm)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let Some(user) = user else {
        send_whatsapp_text(
            state,
            from_wa_id,
            "Link your WhatsApp number in Settings on platform.metatron.id, then message Kevin again.",
        )
        .await?;
        return Ok(());
    };

    match kevin_reply_for_linked_user(state, user, text).await {
        Ok(reply) => send_whatsapp_text(state, from_wa_id, &reply).await,
        Err(KevinReplyError::Limit(msg)) => send_whatsapp_text(state, from_wa_id, &msg).await,
        Err(KevinReplyError::ServiceUnavailable) => {
            send_whatsapp_text(state, from_wa_id, "Kevin is temporarily unavailable.").await
        }
        Err(KevinReplyError::BadGateway(_)) => {
            send_whatsapp_text(state, from_wa_id, "Kevin hit an error. Please try again.").await
        }
        Err(KevinReplyError::Internal) => {
            send_whatsapp_text(state, from_wa_id, "Something went wrong. Please try again.").await
        }
    }
}

async fn send_whatsapp_text(state: &AppState, to: &str, body: &str) -> Result<(), String> {
    let token = state
        .whatsapp_access_token
        .as_deref()
        .ok_or_else(|| "WHATSAPP_ACCESS_TOKEN not set".to_string())?;
    let phone_id = state
        .whatsapp_phone_number_id
        .as_deref()
        .ok_or_else(|| "WHATSAPP_PHONE_NUMBER_ID not set".to_string())?;

    let url = format!("https://graph.facebook.com/v18.0/{}/messages", phone_id);
    let payload = json!({
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "text",
        "text": { "body": body }
    });

    let r = state
        .http_client
        .post(url)
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !r.status().is_success() {
        let t = r.text().await.unwrap_or_default();
        return Err(format!(
            "whatsapp send: {}",
            t.chars().take(300).collect::<String>()
        ));
    }
    Ok(())
}
