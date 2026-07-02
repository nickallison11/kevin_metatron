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
                WITH expired AS (
                    UPDATE users
                    SET subscription_status = 'inactive',
                        is_pro = FALSE,
                        subscription_plan = 'free',
                        cancel_at_period_end = FALSE
                    WHERE cancel_at_period_end = TRUE
                    AND subscription_period_end < NOW()
                    AND subscription_status = 'active'
                    RETURNING id
                ),
                reset_investors AS (
                    UPDATE investor_profiles
                    SET investor_tier = 'free'
                    WHERE user_id IN (SELECT id FROM expired)
                )
                UPDATE connector_profiles
                SET connector_tier = 'free'
                WHERE user_id IN (SELECT id FROM expired)
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

            match sqlx::query_as::<_, (sqlx::types::Uuid, String, String, Option<String>)>(
                r#"
                SELECT id, email, role::text, subscription_period_end::text FROM users
                WHERE subscription_status = 'active'
                AND subscription_period_end BETWEEN NOW() + INTERVAL '3 days' AND NOW() + INTERVAL '4 days'
                "#,
            )
            .fetch_all(&state.db)
            .await
            {
                Ok(rows) => {
                    for (id, email_addr, role, period_end) in rows {
                        let expiry = period_end.unwrap_or_else(|| "in 3 days".to_string());
                        email::send_email(
                            &state.http_client,
                            state.resend_api_key.as_deref(),
                            &state.email_from,
                            &email_addr,
                            "Your metatron subscription renews in 3 days",
                            &email::renewal_reminder_email_html(&expiry, &role),
                        )
                        .await;
                        tracing::info!(
                            "cleanup: renewal reminder sent attempt for user {} ({}) role={}",
                            id,
                            email_addr,
                            role
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
                WHERE p.deck_expires_at <= NOW() + INTERVAL '8 days'
                AND p.deck_expires_at > NOW() + INTERVAL '1 day'
                AND p.pitch_deck_url IS NOT NULL
                AND u.is_basic = FALSE
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
                WHERE p.deck_expires_at <= NOW() + INTERVAL '24 hours'
                AND p.deck_expires_at > NOW()
                AND p.pitch_deck_url IS NOT NULL
                AND u.is_basic = FALSE
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
                AND u.is_basic = FALSE
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


pub fn start_kevin_suggestions_task(state: std::sync::Arc<AppState>) {
    tokio::task::spawn(async move {
        // Stagger by 2 hours so it doesn't collide with the main cleanup task
        tokio::time::sleep(std::time::Duration::from_secs(7_200)).await;

        loop {
            generate_proactive_suggestions(&state).await;
            tokio::time::sleep(std::time::Duration::from_secs(86_400)).await;
        }
    });
}

async fn generate_proactive_suggestions(state: &AppState) {
    let gemini_key = match std::env::var("GEMINI_API_KEY") {
        Ok(k) if !k.is_empty() => k,
        _ => {
            tracing::warn!("suggestions: GEMINI_API_KEY not set, skipping");
            return;
        }
    };

    // Find pro founders with high-scoring uncontacted matches that have no suggestion yet
    #[derive(sqlx::FromRow)]
    struct CandidateRow {
        for_user_id: sqlx::types::Uuid,
        matched_user_id: sqlx::types::Uuid,
        score: i32,
        reasoning: Option<String>,
        founder_email: String,
        founder_company: Option<String>,
        founder_one_liner: Option<String>,
        firm_name: Option<String>,
        thesis: Option<String>,
    }

    let candidates = match sqlx::query_as::<_, CandidateRow>(
        r#"
        SELECT DISTINCT ON (km.for_user_id)
            km.for_user_id,
            km.matched_user_id,
            km.score,
            km.reasoning,
            u.email AS founder_email,
            p.company_name AS founder_company,
            p.one_liner AS founder_one_liner,
            ip.firm_name,
            ip.investment_thesis AS thesis
        FROM kevin_matches km
        JOIN users u ON u.id = km.for_user_id
        LEFT JOIN profiles p ON p.user_id = km.for_user_id
        LEFT JOIN investor_profiles ip ON ip.user_id = km.matched_user_id
        WHERE u.role = 'STARTUP'
        AND u.is_pro = TRUE
        AND km.score >= 70
        AND km.intro_requested_at IS NULL
        AND km.matched_user_id IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM kevin_intro_suggestions kis
            WHERE kis.for_user_id = km.for_user_id
            AND kis.matched_user_id = km.matched_user_id
        )
        AND (
            SELECT COUNT(*) FROM kevin_intro_suggestions
            WHERE for_user_id = km.for_user_id AND status = 'pending'
        ) < 3
        ORDER BY km.for_user_id, km.score DESC
        "#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!("suggestions: failed to load candidates: {e}");
            return;
        }
    };

    tracing::info!("suggestions: generating for {} founder-investor pairs", candidates.len());

    for row in candidates {
        let company = row.founder_company.as_deref().unwrap_or("a startup");
        let one_liner = row.founder_one_liner.as_deref().unwrap_or("");
        let investor = row.firm_name.as_deref().unwrap_or("an investor");
        let thesis = row.thesis.as_deref().unwrap_or("");
        let reasoning = row.reasoning.as_deref().unwrap_or("");

        let prompt = format!(
            "You are Kevin, a startup-investor matchmaker.\n\
             Write a SHORT personalised intro message (max 120 words) that a founder could send to an investor to request a meeting.\n\
             Founder company: {company}\n\
             Founder pitch: {one_liner}\n\
             Investor firm: {investor}\n\
             Investor thesis: {thesis}\n\
             Why they match: {reasoning}\n\n\
             Respond with ONLY a JSON object with two fields:\n\
             {{\"fit_reason\": \"one sentence why this is a strong match\", \"draft_message\": \"the intro message text\"}}"
        );

        let result = crate::ai::complete_json_object(
            &state.http_client,
            "gemini",
            &gemini_key,
            "gemini-2.5-flash",
            "You are Kevin, metatron's AI matchmaker. Be concise and professional.",
            &prompt,
        )
        .await;

        let (fit_reason, draft_message) = match result {
            Ok(v) => {
                let fr = v["fit_reason"].as_str().unwrap_or(reasoning).to_string();
                let dm = v["draft_message"].as_str().unwrap_or("").to_string();
                if dm.is_empty() { continue; }
                (fr, dm)
            }
            Err(e) => {
                tracing::error!("suggestions: AI call failed for user {}: {e}", row.for_user_id);
                continue;
            }
        };

        // Store suggestion (ignore conflict if already exists)
        let insert = sqlx::query(
            r#"
            INSERT INTO kevin_intro_suggestions
                (for_user_id, matched_user_id, fit_score, fit_reason, draft_message, status)
            VALUES ($1, $2, $3, $4, $5, 'pending')
            ON CONFLICT (for_user_id, matched_user_id) DO NOTHING
            "#,
        )
        .bind(row.for_user_id)
        .bind(row.matched_user_id)
        .bind(row.score as f64)
        .bind(&fit_reason)
        .bind(&draft_message)
        .execute(&state.db)
        .await;

        match insert {
            Ok(r) if r.rows_affected() > 0 => {
                tracing::info!("suggestions: created suggestion for user {}", row.for_user_id);

                // Send notification email to founder
                if let Some(resend_key) = state.resend_api_key.as_deref() {
                    email::send_email(
                        &state.http_client,
                        Some(resend_key),
                        &state.email_from,
                        &row.founder_email,
                        &format!("Kevin found a match — {} wants to hear from you", investor),
                        &email::kevin_intro_suggestion_email_html(investor, &fit_reason, &draft_message),
                    )
                    .await;
                }
            }
            Ok(_) => {} // already existed, skip email
            Err(e) => tracing::error!("suggestions: insert failed for user {}: {e}", row.for_user_id),
        }
    }
}
