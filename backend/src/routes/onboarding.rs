use std::sync::Arc;

use sqlx::Error as SqlxError;
use uuid::Uuid;

use crate::state::AppState;

/// Shared onboarding state machine for WhatsApp and Telegram unregistered users.
/// Returns the reply string to send back to the user.
pub(crate) async fn handle_messaging_onboarding(
    state: &Arc<AppState>,
    channel: &str,    // "whatsapp" or "telegram"
    channel_id: &str, // normalized phone digits or telegram_id string
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

            Ok("Welcome to metatron. I'm Kevin, your AI matchmaking agent for founders, connectors and investors.\n\nWhat's your email address?".to_string())
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

                sqlx::query(
                    "UPDATE messaging_onboarding SET email = $1, state = 'awaiting_role'
                     WHERE channel = $2 AND channel_id = $3",
                )
                .bind(&text_lower)
                .bind(channel)
                .bind(channel_id)
                .execute(&state.db)
                .await
                .map_err(|e| e.to_string())?;

                Ok("Got it. Are you a founder, connector or investor?\nReply with founder, connector or investor.".to_string())
            }

            "awaiting_role" => {
                let role_db = match text_lower.as_str() {
                    "founder" => "STARTUP",
                    "connector" => "INTERMEDIARY",
                    "investor" => "INVESTOR",
                    _ => {
                        return Ok("Please reply with founder, connector or investor.".to_string());
                    }
                };

                let email = email.ok_or_else(|| "missing email in onboarding row".to_string())?;

                let user_id = Uuid::new_v4();
                let insert_result = if channel == "whatsapp" {
                    sqlx::query(
                        "INSERT INTO users (id, email, password_hash, role, whatsapp_number)
                         VALUES ($1, $2, '', $3::user_role, $4)",
                    )
                    .bind(user_id)
                    .bind(&email)
                    .bind(role_db)
                    .bind(channel_id)
                    .execute(&state.db)
                    .await
                } else {
                    sqlx::query(
                        "INSERT INTO users (id, email, password_hash, role, telegram_id)
                         VALUES ($1, $2, '', $3::user_role, $4)",
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
                let link = format!("https://platform.metatron.id/messaging-signup?token={}", token);

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
