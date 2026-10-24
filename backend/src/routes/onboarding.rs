use std::sync::Arc;

use sqlx::Error as SqlxError;
use uuid::Uuid;

use crate::state::AppState;

/// Shared onboarding state machine for WhatsApp and Telegram unregistered users.
/// Returns the reply string to send back to the user, with platform links
/// pointed at this environment's frontend.
pub(crate) async fn handle_messaging_onboarding(
    state: &Arc<AppState>,
    channel: &str,    // "whatsapp" or "telegram"
    channel_id: &str, // normalized phone digits or telegram_id string
    text: &str,
) -> Result<String, String> {
    onboarding_reply(state, channel, channel_id, text)
        .await
        .map(|reply| crate::email::localize_links(&reply))
}

async fn onboarding_reply(
    state: &Arc<AppState>,
    channel: &str,
    channel_id: &str,
    text: &str,
) -> Result<String, String> {
    let text_lower = text.trim().to_lowercase();

    let row: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT state, email, role FROM messaging_onboarding WHERE channel = $1 AND channel_id = $2",
    )
    .bind(channel)
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    match row {
        None => {
            sqlx::query(
                "INSERT INTO messaging_onboarding (channel, channel_id, state)
                 VALUES ($1, $2, 'awaiting_email')
                 ON CONFLICT (channel, channel_id) DO UPDATE
                 SET state = 'awaiting_email', email = NULL, role = NULL, user_id = NULL,
                     token = gen_random_uuid()::text,
                     token_expires_at = NOW() + INTERVAL '24 hours'",
            )
            .bind(channel)
            .bind(channel_id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;

            Ok("Hi, I'm Kevin from metatron, your AI dealmaker for founders and investors.\n\nWhat's your email address?".to_string())
        }

        Some((current_state, email, _role)) => match current_state.as_str() {
            "awaiting_email" => {
                if !text_lower.contains('@') || !text_lower.contains('.') {
                    return Ok("That doesn't look like a valid email address. Please try again.".to_string());
                }

                let exists: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM users WHERE LOWER(email) = LOWER($1))",
                )
                .bind(&text_lower)
                .fetch_one(&state.db)
                .await
                .unwrap_or(false);

                if exists {
                    let channel_label = if channel == "whatsapp" {
                        "WhatsApp"
                    } else {
                        "Telegram"
                    };
                    return Ok(format!(
                        "An account with {} already exists. Log in at platform.metatron.id and link your {} in Profile Settings.",
                        text_lower, channel_label
                    ));
                }

                send_email_code(state, channel, channel_id, &text_lower).await?;

                Ok(format!(
                    "Thanks. I've emailed a 6-digit code to {}. Reply here with the code to confirm it's you.\n\nWrong address? Reply with \"change email\".",
                    text_lower
                ))
            }

            "awaiting_code" => {
                let email = email.ok_or_else(|| "missing email in onboarding row".to_string())?;

                if text_lower == "change email" {
                    sqlx::query(
                        "UPDATE messaging_onboarding
                         SET state = 'awaiting_email', email = NULL, email_code = NULL,
                             email_code_expires_at = NULL, email_code_attempts = 0
                         WHERE channel = $1 AND channel_id = $2",
                    )
                    .bind(channel)
                    .bind(channel_id)
                    .execute(&state.db)
                    .await
                    .map_err(|e| e.to_string())?;
                    return Ok("No problem. What's your email address?".to_string());
                }

                if text_lower == "resend" {
                    send_email_code(state, channel, channel_id, &email).await?;
                    return Ok(format!("I've sent a new code to {}.", email));
                }

                let (code, expires_ok, attempts): (Option<String>, bool, i32) = sqlx::query_as(
                    "SELECT email_code, COALESCE(email_code_expires_at > NOW(), FALSE), email_code_attempts
                     FROM messaging_onboarding WHERE channel = $1 AND channel_id = $2",
                )
                .bind(channel)
                .bind(channel_id)
                .fetch_one(&state.db)
                .await
                .map_err(|e| e.to_string())?;

                if attempts >= MAX_CODE_ATTEMPTS {
                    return Ok("Too many wrong codes. Reply with \"resend\" to get a new one.".to_string());
                }
                if !expires_ok {
                    return Ok("That code has expired. Reply with \"resend\" to get a new one.".to_string());
                }

                let entered: String = text.chars().filter(|c| c.is_ascii_digit()).collect();
                if code.as_deref() != Some(entered.as_str()) {
                    sqlx::query(
                        "UPDATE messaging_onboarding SET email_code_attempts = email_code_attempts + 1
                         WHERE channel = $1 AND channel_id = $2",
                    )
                    .bind(channel)
                    .bind(channel_id)
                    .execute(&state.db)
                    .await
                    .map_err(|e| e.to_string())?;
                    return Ok("That code doesn't match. Please check your email and try again, or reply with \"resend\".".to_string());
                }

                sqlx::query(
                    "UPDATE messaging_onboarding
                     SET state = 'awaiting_role', email_code = NULL, email_code_expires_at = NULL
                     WHERE channel = $1 AND channel_id = $2",
                )
                .bind(channel)
                .bind(channel_id)
                .execute(&state.db)
                .await
                .map_err(|e| e.to_string())?;

                Ok("Email confirmed. Are you a founder or an investor?\nReply with founder or investor.".to_string())
            }

            "awaiting_role" => {
                let role_db = match text_lower.as_str() {
                    "founder" => "STARTUP",
                    "investor" => "INVESTOR",
                    _ => {
                        return Ok("Please reply with founder or investor.".to_string());
                    }
                };

                let email = email.ok_or_else(|| "missing email in onboarding row".to_string())?;

                let user_id = Uuid::new_v4();
                let insert_result = if channel == "whatsapp" {
                    sqlx::query(
                        "INSERT INTO users (id, email, password_hash, role, whatsapp_number, channel_connected_at)
                         VALUES ($1, $2, '', $3::user_role, $4, NOW())",
                    )
                    .bind(user_id)
                    .bind(&email)
                    .bind(role_db)
                    .bind(channel_id)
                    .execute(&state.db)
                    .await
                } else {
                    sqlx::query(
                        "INSERT INTO users (id, email, password_hash, role, telegram_id, channel_connected_at)
                         VALUES ($1, $2, '', $3::user_role, $4, NOW())",
                    )
                    .bind(user_id)
                    .bind(&email)
                    .bind(role_db)
                    .bind(channel_id)
                    .execute(&state.db)
                    .await
                };

                if let Err(e) = insert_result {
                    if let SqlxError::Database(db) = &e {
                        if db.code().as_deref() == Some("23505") {
                            return Ok(format!(
                                "An account with {} already exists. Log in at platform.metatron.id.",
                                email
                            ));
                        }
                    }
                    return Err(e.to_string());
                }

                sqlx::query(
                    "UPDATE messaging_onboarding SET role = $1, state = 'complete', user_id = $2
                     WHERE channel = $3 AND channel_id = $4",
                )
                .bind(role_db)
                .bind(user_id)
                .bind(channel)
                .bind(channel_id)
                .execute(&state.db)
                .await
                .map_err(|e| e.to_string())?;

                let token: String = sqlx::query_scalar(
                    "SELECT token FROM messaging_onboarding WHERE channel = $1 AND channel_id = $2",
                )
                .bind(channel)
                .bind(channel_id)
                .fetch_one(&state.db)
                .await
                .map_err(|e| e.to_string())?;

                let channel_label = if channel == "whatsapp" {
                    "WhatsApp"
                } else {
                    "Telegram"
                };
                let link = format!("{}/messaging-signup?token={}", crate::email::frontend_url(), token);

                Ok(format!(
                    "Almost done. Click the link below to set your password — your {} is already linked.\n\n{}",
                    channel_label, link
                ))
            }

            "complete" => Ok(
                "Your account is ready. Visit platform.metatron.id to complete your profile and start using Kevin."
                    .to_string(),
            ),

            _ => Ok("Something went wrong. Message Kevin again to start over.".to_string()),
        },
    }
}

/// Kevin's reply to a user's first message after signing up on the web: says
/// they're connected and points them back to the dashboard, where the main
/// work happens.
pub(crate) fn messaging_welcome(role: &str) -> String {
    let base = crate::email::frontend_url();
    match role {
        "INVESTOR" => format!(
            "Hi, I'm Kevin from metatron, your AI dealmaker for founders and investors. You're connected.\n\nNext step is on your dashboard: set your investment thesis so I know which founders to bring you. I'll message you here when I find a fit.\n\n{base}/investor"
        ),
        "STARTUP" => format!(
            "Hi, I'm Kevin from metatron, your AI dealmaker for founders and investors. You're connected.\n\nNext step is on your dashboard: add your pitch so I can score it and find investors who fit. I'll message you here when I find them.\n\n{base}/startup"
        ),
        _ => format!(
            "Hi, I'm Kevin from metatron, your AI dealmaker for founders and investors. You're connected, and I'll message you here with updates.\n\n{base}"
        ),
    }
}

const MAX_CODE_ATTEMPTS: i32 = 5;

/// Emails a fresh 6-digit code and moves the onboarding row to `awaiting_code`.
async fn send_email_code(
    state: &Arc<AppState>,
    channel: &str,
    channel_id: &str,
    email: &str,
) -> Result<(), String> {
    let code = {
        use rand::Rng;
        format!("{:06}", rand::thread_rng().gen_range(0..1_000_000))
    };

    sqlx::query(
        "UPDATE messaging_onboarding
         SET email = $1, state = 'awaiting_code', email_code = $2,
             email_code_expires_at = NOW() + INTERVAL '15 minutes', email_code_attempts = 0
         WHERE channel = $3 AND channel_id = $4",
    )
    .bind(email)
    .bind(&code)
    .bind(channel)
    .bind(channel_id)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let channel_label = if channel == "whatsapp" { "WhatsApp" } else { "Telegram" };
    let html = format!(
        r#"<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Here's your code to finish signing up with Kevin on {channel_label}:</p>
<p style="margin:0 0 16px 0;font-size:28px;font-weight:700;letter-spacing:6px;color:#e8e8ed;">{code}</p>
<p style="margin:0;font-size:13px;color:#8888a0;">Reply to Kevin with this code. It expires in 15 minutes. If you didn't ask for it, you can ignore this email.</p>"#
    );
    crate::email::send_email(
        &state.http_client,
        state.resend_api_key.as_deref(),
        &state.email_from,
        email,
        &format!("Your code: {code}"),
        &html,
    )
    .await;
    Ok(())
}
