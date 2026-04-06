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

            tokio::time::sleep(Duration::from_secs(86_400)).await;
        }
    });
}
