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

            tokio::time::sleep(Duration::from_secs(86_400)).await;
        }
    });
}
