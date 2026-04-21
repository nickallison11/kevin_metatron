use std::time::Duration;

use std::sync::Arc;

use crate::email;
use crate::state::AppState;

pub fn start_cleanup_task(state: Arc<AppState>) {
    tokio::task::spawn(async move {
        loop {
            match sqlx::query(
                "DELETE FROM kevin_memories WHERE created_at < NOW() - INTERVAL '12 months'",
            )
            .execute(&state.db)
            .await
            {
                Ok(result) => {
                    tracing::info!(
                        "cleanup: removed {} old kevin_memories rows",
                        result.rows_affected()
                    );
                }
                Err(e) => {
                    tracing::error!("cleanup: failed deleting old kevin_memories rows: {e}");
                }
            }

            match sqlx::query(
                "DELETE FROM kevin_text_memories WHERE created_at < NOW() - INTERVAL '12 months'",
            )
            .execute(&state.db)
            .await
            {
                Ok(result) => {
                    tracing::info!(
                        "cleanup: removed {} old kevin_text_memories rows",
                        result.rows_affected()
                    );
                }
                Err(e) => {
                    tracing::error!("cleanup: failed deleting old kevin_text_memories rows: {e}");
                }
            }

            match sqlx::query(
                r#"
                UPDATE users
                SET subscription_status = 'inactive', is_pro = FALSE
                WHERE cancel_at_period_end = TRUE
                AND subscription_period_end < NOW()
                AND subscription_status = 'active'
                "#,
            )
            .execute(&state.db)
            .await
            {
                Ok(result) => {
                    tracing::info!(
                        "cleanup: expired {} cancelled-at-period-end subscriptions",
                        result.rows_affected()
                    );
                }
                Err(e) => {
                    tracing::error!("cleanup: failed expiring cancelled subscriptions: {e}");
                }
            }

            match sqlx::query_as::<_, (sqlx::types::Uuid, String, Option<String>)>(
                r#"
                SELECT id, email, subscription_period_end::text FROM users
                WHERE subscription_status = 'active'
                AND subscription_period_end BETWEEN NOW() + INTERVAL '3 days' AND NOW() + INTERVAL '4 days'
                "#,
            )
            .fetch_all(&state.db)
            .await
            {
                Ok(rows) => {
                    for (id, email_addr, period_end) in rows {
                        let expiry = period_end.unwrap_or_else(|| "in 3 days".to_string());
                        email::send_email(
                            &state.http_client,
                            state.resend_api_key.as_deref(),
                            &state.email_from,
                            &email_addr,
                            "Your metatron Pro subscription renews in 3 days",
                            &email::renewal_reminder_email_html(&expiry),
                        )
                        .await;
                        tracing::info!(
                            "cleanup: renewal reminder sent attempt for user {} ({})",
                            id,
                            email_addr
                        );
                    }
                }
                Err(e) => {
                    tracing::error!("cleanup: failed loading renewal reminder users: {e}");
                }
            }

            // ----------------------------------------------------------------
            // Deck expiry: day-7 email reminder
            // ----------------------------------------------------------------
            match sqlx::query_as::<_, (sqlx::types::Uuid, String)>(
                r#"
                SELECT u.id, u.email
                FROM profiles p
                JOIN users u ON u.id = p.user_id
                WHERE p.deck_expires_at BETWEEN NOW() + INTERVAL '6 days' AND NOW() + INTERVAL '7 days'
                AND p.pitch_deck_url IS NOT NULL
                AND u.is_pro = FALSE
                AND p.deck_7day_email_sent = FALSE
                "#,
            )
            .fetch_all(&state.db)
            .await
            {
                Ok(rows) => {
                    for (id, email_addr) in rows {
                        email::send_email(
                            &state.http_client,
                            state.resend_api_key.as_deref(),
                            &state.email_from,
                            &email_addr,
                            "Your metatron pitch deck expires in 7 days",
                            &email::deck_expiry_7_days_html(),
                        )
                        .await;
                        let _ = sqlx::query(
                            "UPDATE profiles SET deck_7day_email_sent = TRUE WHERE user_id = $1",
                        )
                        .bind(id)
                        .execute(&state.db)
                        .await;
                        tracing::info!("cleanup: deck expiry 7-day reminder sent for user {}", id);
                    }
                }
                Err(e) => {
                    tracing::error!("cleanup: failed loading deck expiry 7-day reminder users: {e}");
                }
            }

            // ----------------------------------------------------------------
            // Deck expiry: day-13 email reminder (expires within 24 hours)
            // ----------------------------------------------------------------
            match sqlx::query_as::<_, (sqlx::types::Uuid, String)>(
                r#"
                SELECT u.id, u.email
                FROM profiles p
                JOIN users u ON u.id = p.user_id
                WHERE p.deck_expires_at BETWEEN NOW() AND NOW() + INTERVAL '1 day'
                AND p.pitch_deck_url IS NOT NULL
                AND u.is_pro = FALSE
                AND p.deck_1day_email_sent = FALSE
                "#,
            )
            .fetch_all(&state.db)
            .await
            {
                Ok(rows) => {
                    for (id, email_addr) in rows {
                        email::send_email(
                            &state.http_client,
                            state.resend_api_key.as_deref(),
                            &state.email_from,
                            &email_addr,
                            "Investors are looking — your deck goes dark tomorrow",
                            &email::deck_expiry_1_day_html(),
                        )
                        .await;
                        let _ = sqlx::query(
                            "UPDATE profiles SET deck_1day_email_sent = TRUE WHERE user_id = $1",
                        )
                        .bind(id)
                        .execute(&state.db)
                        .await;
                        tracing::info!("cleanup: deck expiry 1-day reminder sent for user {}", id);
                    }
                }
                Err(e) => {
                    tracing::error!("cleanup: failed loading deck expiry 1-day reminder users: {e}");
                }
            }

            // ----------------------------------------------------------------
            // Deck expiry: send expired email then clear flags on re-upload
            // ----------------------------------------------------------------
            match sqlx::query_as::<_, (sqlx::types::Uuid, String)>(
                r#"
                SELECT u.id, u.email
                FROM profiles p
                JOIN users u ON u.id = p.user_id
                WHERE p.deck_expires_at IS NOT NULL
                AND p.deck_expires_at < NOW()
                AND p.pitch_deck_url IS NOT NULL
                AND u.is_pro = FALSE
                AND p.deck_expired_email_sent = FALSE
                "#,
            )
            .fetch_all(&state.db)
            .await
            {
                Ok(rows) => {
                    for (id, email_addr) in rows {
                        email::send_email(
                            &state.http_client,
                            state.resend_api_key.as_deref(),
                            &state.email_from,
                            &email_addr,
                            "Your pitch deck has expired",
                            &email::deck_expired_html(),
                        )
                        .await;
                        let _ = sqlx::query(
                            "UPDATE profiles SET deck_expired_email_sent = TRUE WHERE user_id = $1",
                        )
                        .bind(id)
                        .execute(&state.db)
                        .await;
                        tracing::info!("cleanup: deck expired email sent for user {}", id);
                    }
                }
                Err(e) => {
                    tracing::error!("cleanup: failed loading expired deck email users: {e}");
                }
            }

            // ----------------------------------------------------------------
            // Deck expiry: unpin from Pinata and clear profile fields
            // ----------------------------------------------------------------
            if let Some(pinata_jwt) = state.pinata_jwt.as_deref().filter(|v| !v.trim().is_empty()) {
                let pinata_jwt = pinata_jwt.to_string();
                match sqlx::query_as::<_, (sqlx::types::Uuid, String)>(
                    r#"
                    SELECT p.user_id, p.pitch_deck_url
                    FROM profiles p
                    JOIN users u ON u.id = p.user_id
                    WHERE p.deck_expires_at IS NOT NULL
                    AND p.deck_expires_at < NOW()
                    AND p.pitch_deck_url IS NOT NULL
                    AND u.is_pro = FALSE
                    "#,
                )
                .fetch_all(&state.db)
                .await
                {
                    Ok(rows) => {
                        for (user_id, deck_url) in rows {
                            let cid_opt = deck_url
                                .split("/ipfs/")
                                .nth(1)
                                .and_then(|s| {
                                    let c = s.split('/').next().unwrap_or("").trim().to_string();
                                    if c.is_empty() { None } else { Some(c) }
                                });

                            if let Some(cid) = cid_opt {
                                // v3 delete: search for file ID by CID, then DELETE /v3/files/{id}.
                                let search_url = format!(
                                    "https://api.pinata.cloud/v3/files?cid={cid}&limit=1"
                                );
                                let file_id = match state
                                    .http_client
                                    .get(&search_url)
                                    .bearer_auth(&pinata_jwt)
                                    .send()
                                    .await
                                {
                                    Ok(r) if r.status().is_success() => {
                                        let j: serde_json::Value =
                                            r.json().await.unwrap_or_default();
                                        j.pointer("/data/files/0/id")
                                            .and_then(|v| v.as_str())
                                            .map(|s| s.to_string())
                                    }
                                    _ => None,
                                };

                                if let Some(file_id) = file_id {
                                    let delete_url = format!(
                                        "https://api.pinata.cloud/v3/files/{file_id}"
                                    );
                                    match state
                                        .http_client
                                        .delete(&delete_url)
                                        .bearer_auth(&pinata_jwt)
                                        .send()
                                        .await
                                    {
                                        Ok(resp) => {
                                            let status = resp.status();
                                            if status.is_success() || status.as_u16() == 404 {
                                                tracing::info!(
                                                    "cleanup: deleted v3 file {} (CID {}) for user {}",
                                                    file_id, cid, user_id
                                                );
                                            } else {
                                                tracing::warn!(
                                                    "cleanup: pinata v3 delete returned {} for file {} user {}",
                                                    status, file_id, user_id
                                                );
                                            }
                                        }
                                        Err(e) => {
                                            tracing::error!(
                                                "cleanup: pinata v3 delete failed for file {file_id}: {e}"
                                            );
                                        }
                                    }
                                } else {
                                    tracing::warn!(
                                        "cleanup: no v3 file found for CID {} user {} — skipping unpin",
                                        cid, user_id
                                    );
                                }
                            }

                            // Always clear the profile fields regardless of unpin outcome,
                            // so we don't retry the same record indefinitely.
                            if let Err(e) = sqlx::query(
                                r#"
                                UPDATE profiles
                                SET pitch_deck_url = NULL, deck_expires_at = NULL
                                WHERE user_id = $1
                                "#,
                            )
                            .bind(user_id)
                            .execute(&state.db)
                            .await
                            {
                                tracing::error!(
                                    "cleanup: failed clearing expired deck fields for user {user_id}: {e}"
                                );
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!("cleanup: failed loading expired decks: {e}");
                    }
                }
            }

            tokio::time::sleep(Duration::from_secs(86_400)).await;
        }
    });
}
