use std::time::Duration;

pub fn start_cleanup_task(pool: sqlx::PgPool) {
    tokio::task::spawn(async move {
        loop {
            match sqlx::query(
                "DELETE FROM kevin_memories WHERE created_at < NOW() - INTERVAL '12 months'",
            )
            .execute(&pool)
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

            match sqlx::query_as::<_, (sqlx::types::Uuid, String)>(
                r#"
                SELECT id, email FROM users
                WHERE subscription_status = 'active'
                AND subscription_period_end BETWEEN NOW() + INTERVAL '3 days' AND NOW() + INTERVAL '4 days'
                "#,
            )
            .fetch_all(&pool)
            .await
            {
                Ok(rows) => {
                    for (id, email) in rows {
                        tracing::info!(
                            "RENEWAL REMINDER: user {} ({}) subscription expires in ~3 days",
                            id,
                            email
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
