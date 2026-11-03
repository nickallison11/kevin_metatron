use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use crate::email;
use crate::identity::require_user;
use crate::routes::connections;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(get_matches).post(generate_matches))
        .route("/suggestions", get(list_suggestions))
        .route("/suggestions/:id/approve", post(approve_suggestion))
        .route("/suggestions/:id/decline", post(decline_suggestion))
        .route("/received-intros", get(get_received_intros))
        .route("/:id/view-deck", post(view_deck))
        .route("/:id/accept-intro", post(accept_intro))
        .route("/:id/pass-intro", post(pass_intro))
        .route("/:id/request-intro", post(request_intro))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct KevinMatch {
    pub id: Uuid,
    pub matched_user_id: Option<Uuid>,
    pub match_type: String,
    pub score: i32,
    pub reasoning: Option<String>,
    pub generated_at: chrono::DateTime<chrono::Utc>,
    pub firm_name: Option<String>,
    pub company_name: Option<String>,
    pub one_liner: Option<String>,
    pub stage: Option<String>,
    pub sector: Option<String>,
    pub country: Option<String>,
    pub angel_score: Option<i32>,
    pub intro_requested_at: Option<chrono::DateTime<chrono::Utc>>,
    pub deck_url: Option<String>,
    pub logo_url: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ReceivedIntro {
    pub id: Uuid,
    pub for_user_id: Uuid,
    pub score: i32,
    pub reasoning: Option<String>,
    pub intro_requested_at: chrono::DateTime<chrono::Utc>,
    pub company_name: Option<String>,
    pub firm_name: Option<String>,
    pub one_liner: Option<String>,
    pub stage: Option<String>,
    pub sector: Option<String>,
    pub country: Option<String>,
    pub angel_score: Option<i32>,
    pub founder_email: String,
    pub deck_url: Option<String>,
    pub deck_viewed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub intro_accepted_at: Option<chrono::DateTime<chrono::Utc>>,
    pub intro_passed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub logo_url: Option<String>,
}

fn internal(e: impl std::fmt::Display) -> (StatusCode, String) {
    tracing::error!("{e}");
    (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string())
}

const FETCH_SQL: &str = r#"
    SELECT km.id, km.matched_user_id, km.match_type, km.score, km.reasoning, km.generated_at,
        COALESCE(km.display_name, ip.firm_name) AS firm_name,
        p.company_name,
        COALESCE(km.display_one_liner, p.one_liner) AS one_liner,
        COALESCE(km.display_stage, p.stage) AS stage,
        COALESCE(km.display_sector, p.sector) AS sector,
        COALESCE(km.display_country, ip.country, p.country) AS country,
        a.score AS angel_score,
        km.intro_requested_at,
        CASE WHEN u.is_basic OR u.is_pro OR p.deck_expires_at IS NULL OR p.deck_expires_at > NOW() THEN p.pitch_deck_url ELSE NULL END AS deck_url,
        u.logo_url
    FROM kevin_matches km
    LEFT JOIN users u ON u.id = km.matched_user_id
    LEFT JOIN investor_profiles ip ON ip.user_id = km.matched_user_id
    LEFT JOIN profiles p ON p.user_id = km.matched_user_id
    LEFT JOIN angel_scores a ON a.founder_user_id = km.matched_user_id
    WHERE km.for_user_id = $1
    ORDER BY (km.intro_requested_at IS NOT NULL), km.score DESC, km.generated_at DESC
"#;

const FETCH_TYPED_SQL: &str = r#"
    SELECT km.id, km.matched_user_id, km.match_type, km.score, km.reasoning, km.generated_at,
        COALESCE(km.display_name, ip.firm_name) AS firm_name,
        p.company_name,
        COALESCE(km.display_one_liner, p.one_liner) AS one_liner,
        COALESCE(km.display_stage, p.stage) AS stage,
        COALESCE(km.display_sector, p.sector) AS sector,
        COALESCE(km.display_country, ip.country, p.country) AS country,
        a.score AS angel_score,
        km.intro_requested_at,
        CASE WHEN u.is_basic OR u.is_pro OR p.deck_expires_at IS NULL OR p.deck_expires_at > NOW() THEN p.pitch_deck_url ELSE NULL END AS deck_url,
        u.logo_url
    FROM kevin_matches km
    LEFT JOIN users u ON u.id = km.matched_user_id
    LEFT JOIN investor_profiles ip ON ip.user_id = km.matched_user_id
    LEFT JOIN profiles p ON p.user_id = km.matched_user_id
    LEFT JOIN angel_scores a ON a.founder_user_id = km.matched_user_id
    WHERE km.for_user_id = $1 AND km.match_type = $2
    ORDER BY (km.intro_requested_at IS NOT NULL), km.score DESC, km.generated_at DESC
"#;

pub(crate) async fn fetch_kevin_matches_for_user(
    state: &AppState,
    user_id: Uuid,
    match_type: Option<&str>,
) -> Result<Vec<KevinMatch>, (StatusCode, String)> {
    let rows = if let Some(mt) = match_type {
        sqlx::query_as::<_, KevinMatch>(FETCH_TYPED_SQL)
            .bind(user_id)
            .bind(mt)
            .fetch_all(&state.db)
            .await
    } else {
        sqlx::query_as::<_, KevinMatch>(FETCH_SQL)
            .bind(user_id)
            .fetch_all(&state.db)
            .await
    }
    .map_err(internal)?;
    Ok(rows)
}

async fn get_matches(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<KevinMatch>>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    let rows = fetch_kevin_matches_for_user(&state, user.id, None).await?;
    Ok(Json(rows))
}

async fn get_received_intros(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<ReceivedIntro>>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    let investor_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_one(&state.db)
        .await
        .map_err(internal)?;
    let rows = sqlx::query_as::<_, ReceivedIntro>(
        r#"SELECT km.id, km.for_user_id, km.score, km.reasoning, km.intro_requested_at,
                    p.company_name, ip_req.firm_name, p.one_liner, p.stage, p.sector, p.country,
                    a.score AS angel_score, u.email AS founder_email,
                    CASE WHEN u.is_basic OR u.is_pro OR p.deck_expires_at IS NULL OR p.deck_expires_at > NOW() THEN p.pitch_deck_url ELSE NULL END AS deck_url,
                    km.deck_viewed_at, km.intro_accepted_at, km.intro_passed_at, u.logo_url
             FROM kevin_matches km
             JOIN users u ON u.id = km.for_user_id
             LEFT JOIN profiles p ON p.user_id = km.for_user_id
             LEFT JOIN investor_profiles ip_req ON ip_req.user_id = km.for_user_id
             LEFT JOIN angel_scores a ON a.founder_user_id = km.for_user_id
             WHERE km.matched_user_id = $1 AND km.intro_requested_at IS NOT NULL

             UNION ALL

             SELECT km.id, km.for_user_id, km.score, km.reasoning, km.intro_requested_at,
                    p.company_name, NULL::text AS firm_name, p.one_liner, p.stage, p.sector, p.country,
                    a.score AS angel_score, u.email AS founder_email,
                    CASE WHEN u.is_basic OR u.is_pro OR p.deck_expires_at IS NULL OR p.deck_expires_at > NOW() THEN p.pitch_deck_url ELSE NULL END AS deck_url,
                    km.deck_viewed_at, km.intro_accepted_at, km.intro_passed_at, u.logo_url
             FROM kevin_matches km
             JOIN connector_network_contacts cnc ON cnc.id = km.contact_id
             JOIN users u ON u.id = km.for_user_id
             LEFT JOIN profiles p ON p.user_id = km.for_user_id
             LEFT JOIN angel_scores a ON a.founder_user_id = km.for_user_id
             WHERE km.contact_id IS NOT NULL
               AND km.intro_requested_at IS NOT NULL
               AND LOWER(cnc.email) = LOWER($2)

             ORDER BY intro_requested_at DESC"#,
    )
    .bind(user.id)
    .bind(&investor_email)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;
    Ok(Json(rows))
}

const DEFAULT_PASS_TEMPLATE: &str = "Thank you for sharing {company} with us. After careful review, this isn't the right fit for our current portfolio focus. We wish you the very best with your raise and hope our paths cross again.\n\n— {firm}";

async fn view_deck(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(match_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    let investor_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_one(&state.db)
        .await
        .map_err(internal)?;

    let row: Option<(Uuid, Option<chrono::DateTime<chrono::Utc>>, Option<String>)> = sqlx::query_as(
        r#"SELECT km.for_user_id, km.deck_viewed_at,
                    CASE WHEN u.is_basic OR u.is_pro OR p.deck_expires_at IS NULL OR p.deck_expires_at > NOW() THEN p.pitch_deck_url ELSE NULL END AS deck_url
             FROM kevin_matches km
             JOIN users u ON u.id = km.for_user_id
             LEFT JOIN profiles p ON p.user_id = km.for_user_id
             WHERE km.id = $1
               AND (km.matched_user_id = $2 OR EXISTS (
                 SELECT 1 FROM connector_network_contacts cnc
                 WHERE cnc.id = km.contact_id AND LOWER(cnc.email) = LOWER($3)
               ))"#,
    )
    .bind(match_id)
    .bind(user.id)
    .bind(&investor_email)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    let (founder_id, deck_viewed_at, deck_url) =
        row.ok_or((StatusCode::NOT_FOUND, "match not found".to_string()))?;

    // Feeds the founder's unified "who viewed my deck" log (`GET
    // /deck-views/mine`) -- logged on every view, not just the first one,
    // unlike `kevin_matches.deck_viewed_at` below which stays first-view-only
    // since it only gates the one-time email notification.
    sqlx::query(
        "INSERT INTO deck_views (startup_user_id, viewer_user_id, source) VALUES ($1, $2, 'matched_intro')",
    )
    .bind(founder_id)
    .bind(user.id)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    let firm_name: Option<String> = sqlx::query_scalar::<_, Option<String>>(
        "SELECT firm_name FROM investor_profiles WHERE user_id = $1",
    )
    .bind(user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?
    .flatten();
    let investor_name = firm_name.unwrap_or_else(|| investor_email.clone());

    if deck_viewed_at.is_none() {
        sqlx::query("UPDATE kevin_matches SET deck_viewed_at = NOW() WHERE id = $1")
            .bind(match_id)
            .execute(&state.db)
            .await
            .map_err(internal)?;

        let founder: Option<(String, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT u.email, u.telegram_id, u.whatsapp_number, p.company_name FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = $1",
        )
        .bind(founder_id)
        .fetch_optional(&state.db)
        .await
        .map_err(internal)?;

        if let Some((f_email, f_tg, f_wa, company_name)) = founder {
            let company = company_name.unwrap_or_else(|| "your company".to_string());
            let subject = format!("{} viewed your pitch deck", investor_name);
            let html = email::deck_viewed_html(&investor_name, &company);
            let msg = format!(
                "👀 {} just viewed your pitch deck for {}! They're actively reviewing your raise — keep up the momentum!",
                investor_name, company
            );
            email::send_email(
                &state.http_client,
                state.resend_api_key.as_deref(),
                &state.email_from,
                &f_email,
                &subject,
                &html,
            )
            .await;
            if let (Some(tg), Some(bot)) = (f_tg.as_deref(), state.telegram_bot_token.as_deref()) {
                let _ = state
                    .http_client
                    .post(format!("https://api.telegram.org/bot{bot}/sendMessage", bot = bot))
                    .json(&serde_json::json!({"chat_id": tg, "text": msg}))
                    .send()
                    .await;
            }
            if let (Some(wa), Some(tok), Some(pid)) = (
                f_wa.as_deref(),
                state.whatsapp_access_token.as_deref(),
                state.whatsapp_phone_number_id.as_deref(),
            ) {
                let _ = state
                    .http_client
                    .post(format!("https://graph.facebook.com/v18.0/{pid}/messages", pid = pid))
                    .bearer_auth(tok)
                    .json(&serde_json::json!({"messaging_product":"whatsapp","recipient_type":"individual","to":wa,"type":"text","text":{"body":msg}}))
                    .send()
                    .await;
            }
        }
    }
    Ok(Json(serde_json::json!({"ok": true, "deck_url": deck_url})))
}

async fn accept_intro(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(match_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    answer_intro_request(&state, user.id, match_id, true).await?;
    Ok(Json(serde_json::json!({"ok": true})))
}

async fn pass_intro(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(match_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    answer_intro_request(&state, user.id, match_id, false).await?;
    Ok(Json(serde_json::json!({"ok": true})))
}

/// The user who received an intro request (a founder or an investor) accepts
/// or passes on it: from the Matches page, or through Kevin.
pub(crate) async fn answer_intro_request(
    state: &AppState,
    user_id: Uuid,
    match_id: Uuid,
    accept: bool,
) -> Result<(), (StatusCode, String)> {
    let user_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .map_err(internal)?;

    let row: Option<(
        Uuid,
        Option<Uuid>,
        Option<chrono::DateTime<chrono::Utc>>,
        Option<chrono::DateTime<chrono::Utc>>,
    )> = sqlx::query_as(
        r#"SELECT km.for_user_id, km.matched_user_id, km.intro_accepted_at, km.intro_passed_at
             FROM kevin_matches km
             WHERE km.id = $1
               AND (km.matched_user_id = $2 OR EXISTS (
                 SELECT 1 FROM connector_network_contacts cnc
                 WHERE cnc.id = km.contact_id AND LOWER(cnc.email) = LOWER($3)
               ))"#,
    )
    .bind(match_id)
    .bind(user_id)
    .bind(&user_email)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    let (requester_id, matched_user_id, intro_accepted_at, intro_passed_at) =
        row.ok_or((StatusCode::NOT_FOUND, "match not found".to_string()))?;
    if intro_accepted_at.is_some() {
        return Err((StatusCode::CONFLICT, "already accepted".to_string()));
    }
    if intro_passed_at.is_some() {
        return Err((StatusCode::CONFLICT, "already passed".to_string()));
    }

    if accept {
        sqlx::query("UPDATE kevin_matches SET intro_accepted_at = NOW() WHERE id = $1")
            .bind(match_id)
            .execute(&state.db)
            .await
            .map_err(internal)?;

        if let Some(matched_uid) = matched_user_id {
            let first = connections::try_first_accept_connect(&state.db, requester_id, matched_uid)
                .await
                .map_err(internal)?;
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM connections WHERE from_user_id = $1 AND to_user_id = $2 AND connection_type = 'connect')",
            )
            .bind(requester_id)
            .bind(matched_uid)
            .fetch_one(&state.db)
            .await
            .map_err(internal)?;
            if first || !exists {
                connections::send_kevin_warm_email_for_intro_accept(state, user_id, requester_id).await;
            }
        } else {
            connections::send_kevin_warm_email_for_intro_accept(state, user_id, requester_id).await;
        }
        return Ok(());
    }

    let profile: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT firm_name, pass_message_template FROM investor_profiles WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;
    let (firm_name, template_opt) = profile.unwrap_or((None, None));
    let investor_name = firm_name.unwrap_or_else(|| user_email.clone());

    sqlx::query("UPDATE kevin_matches SET intro_passed_at = NOW() WHERE id = $1")
        .bind(match_id)
        .execute(&state.db)
        .await
        .map_err(internal)?;

    if let Some(matched_uid) = matched_user_id {
        let _ = connections::mark_connect_declined_for_pair(&state.db, requester_id, matched_uid).await;
    }

    let founder: Option<(String, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT u.email, u.telegram_id, u.whatsapp_number, p.company_name FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = $1",
    )
    .bind(requester_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    if let Some((f_email, f_tg, f_wa, company_name)) = founder {
        let company = company_name.unwrap_or_else(|| "your company".to_string());
        let template = template_opt.as_deref().unwrap_or(DEFAULT_PASS_TEMPLATE);
        let pass_msg = template
            .replace("{company}", &company)
            .replace("{firm}", &investor_name);
        let subject = format!("An update from {}", investor_name);
        let html = email::intro_passed_html(&investor_name, &pass_msg);
        email::send_email(
            &state.http_client,
            state.resend_api_key.as_deref(),
            &state.email_from,
            &f_email,
            &subject,
            &html,
        )
        .await;
        if let (Some(tg), Some(bot)) = (f_tg.as_deref(), state.telegram_bot_token.as_deref()) {
            let _ = state
                .http_client
                .post(format!("https://api.telegram.org/bot{bot}/sendMessage", bot = bot))
                .json(&serde_json::json!({"chat_id": tg, "text": pass_msg}))
                .send()
                .await;
        }
        if let (Some(wa), Some(tok), Some(pid)) = (
            f_wa.as_deref(),
            state.whatsapp_access_token.as_deref(),
            state.whatsapp_phone_number_id.as_deref(),
        ) {
            let _ = state
                .http_client
                .post(format!("https://graph.facebook.com/v18.0/{pid}/messages", pid = pid))
                .bearer_auth(tok)
                .json(&serde_json::json!({"messaging_product":"whatsapp","recipient_type":"individual","to":wa,"type":"text","text":{"body":pass_msg}}))
                .send()
                .await;
        }
    }
    Ok(())
}

// Display info tracked per candidate ID
struct CandidateInfo {
    source: &'static str, // "user" or "contact"
    display_name: Option<String>,
    display_one_liner: Option<String>,
    display_sector: Option<String>,
    display_stage: Option<String>,
    display_country: Option<String>,
}

fn repair_double_encoded_utf8(input: &str) -> String {
    // Recover common mojibake sequences like "EntrÃ©e" -> "Entrée" when UTF-8
    // bytes were interpreted as Latin-1 and re-encoded.
    if !input.contains('Ã') && !input.contains('Â') {
        return input.to_string();
    }
    let mut latin1_bytes = Vec::with_capacity(input.len());
    for ch in input.chars() {
        let cp = ch as u32;
        if cp > 0xFF {
            return input.to_string();
        }
        latin1_bytes.push(cp as u8);
    }
    let Ok(repaired) = String::from_utf8(latin1_bytes) else {
        return input.to_string();
    };
    let repaired_markers = repaired.matches('Ã').count() + repaired.matches('Â').count();
    let original_markers = input.matches('Ã').count() + input.matches('Â').count();
    if repaired_markers < original_markers {
        repaired
    } else {
        input.to_string()
    }
}

async fn generate_matches(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    headers: HeaderMap,
) -> Result<Json<Vec<KevinMatch>>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    // The Monday refresh before the weekly digest: the digest covers these
    // matches, so no strong-match alert from this run.
    let weekly_run = headers.get(WEEKLY_RUN_HEADER).is_some();
    // One-off re-score of the matches the person already has (cron secret only):
    // new scores and reasons, nothing else about the matches changes.
    let rescore = match (
        headers.get(RESCORE_HEADER).and_then(|v| v.to_str().ok()),
        state.cron_secret.as_deref(),
    ) {
        (Some(got), Some(want)) => !want.is_empty() && got == want,
        _ => false,
    };

    let (is_basic, is_pro_user): (bool, bool) =
        sqlx::query_as::<_, (bool, bool)>(
            "SELECT COALESCE(is_basic, false), COALESCE(is_pro, false) FROM users WHERE id = $1",
        )
        .bind(user.id)
        .fetch_one(&state.db)
        .await
        .unwrap_or((false, false));
    let role = user.role.as_str();
    let (limit_free, limit_basic, limit_pro) = if role == "INVESTOR" {
        (
            state.investor_match_limit_free,
            state.investor_match_limit_basic,
            state.investor_match_limit_pro,
        )
    } else {
        (
            state.match_limit_free,
            state.match_limit_basic,
            state.match_limit_pro,
        )
    };
    let match_limit: i64 = if is_pro_user {
        if limit_pro == 0 {
            i64::MAX
        } else {
            limit_pro
        }
    } else if is_basic {
        limit_basic
    } else {
        limit_free
    };
    let cache_interval = if is_basic || is_pro_user { "6 hours" } else { "7 days" };

    let fresh_count: i64 = sqlx::query_scalar(
        &format!("SELECT COUNT(*)::bigint FROM kevin_matches WHERE for_user_id = $1 AND generated_at > NOW() - INTERVAL '{cache_interval}'"),
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);
    if !rescore
        && fresh_count > 0
        && !super::kevin_feedback::preference_since_last_matches(&state, user.id).await
        && !super::readiness::assessed_since_last_matches(&state, user.id).await
    {
        let rows = fetch_kevin_matches_for_user(&state, user.id, None).await?;
        return Ok(Json(rows));
    }

    let gemini_key = std::env::var("GEMINI_API_KEY")
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "GEMINI_API_KEY not set".to_string()))?;

    let (user_context, candidates_json, candidate_info, match_type) = if role == "STARTUP" {
        let profile: Option<(Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)> =
            sqlx::query_as(
                "SELECT company_name, one_liner, stage, sector, country FROM profiles WHERE user_id = $1",
            )
            .bind(user.id)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;

        let (company, one_liner, stage, sector, founder_country) =
            profile.unwrap_or((None, None, None, None, None));
        // Gate: require complete profile before generating matches
        if company.is_none() || one_liner.is_none() || stage.is_none() || sector.is_none() {
            return Ok(Json(vec![]));
        }
        let company = company.unwrap();
        let one_liner = one_liner.unwrap();
        let stage = stage.unwrap();
        let sector = sector.unwrap();

        // Enrich context with pitch detail if available
        let pitch: Option<(Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)> =
            sqlx::query_as(
                "SELECT problem, solution, traction, market_size, funding_ask FROM pitches WHERE created_by = $1 ORDER BY created_at DESC LIMIT 1",
            )
            .bind(user.id)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;

        let ctx = if let Some((problem, solution, traction, market_size, funding_ask)) = pitch {
            let mut parts = vec![format!(
                "Founder: {}, {}, Stage: {}, Sector: {}, Country: {}",
                company,
                one_liner,
                stage,
                sector,
                founder_country.as_deref().unwrap_or("not specified")
            )];
            if let Some(ref v) = problem {
                if !v.trim().is_empty() {
                    let t: String = v.chars().take(200).collect();
                    parts.push(format!("Problem: {t}"));
                }
            }
            if let Some(ref v) = solution {
                if !v.trim().is_empty() {
                    let t: String = v.chars().take(200).collect();
                    parts.push(format!("Solution: {t}"));
                }
            }
            if let Some(ref v) = traction {
                if !v.trim().is_empty() {
                    let t: String = v.chars().take(150).collect();
                    parts.push(format!("Traction: {t}"));
                }
            }
            if let Some(ref v) = market_size {
                if !v.trim().is_empty() {
                    let t: String = v.chars().take(100).collect();
                    parts.push(format!("Market: {t}"));
                }
            }
            if let Some(ref v) = funding_ask {
                if !v.trim().is_empty() {
                    parts.push(format!("Raising: {v}"));
                }
            }
            parts.join(". ")
        } else {
            format!(
                "Founder: {}, {}, Stage: {}, Sector: {}, Country: {}",
                company,
                one_liner,
                stage,
                sector,
                founder_country.as_deref().unwrap_or("not specified")
            )
        };

        // Registered investors
        #[derive(sqlx::FromRow, Serialize)]
        struct InvCandidate {
            user_id: Uuid,
            firm_name: Option<String>,
            bio: Option<String>,
            investment_thesis: Option<String>,
            sectors: Option<Vec<String>>,
            stages: Option<Vec<String>>,
            ticket_size_min: Option<i64>,
            ticket_size_max: Option<i64>,
            country: Option<String>,
        }
        let registered: Vec<InvCandidate> = sqlx::query_as(
            r#"SELECT ip.user_id, ip.firm_name, ip.bio, ip.investment_thesis, ip.sectors, ip.stages,
                      ip.ticket_size_min, ip.ticket_size_max, ip.country
                 FROM investor_profiles ip
                 JOIN users u ON u.id = ip.user_id
                 WHERE CASE WHEN $4 THEN ip.user_id IN (
                     SELECT matched_user_id FROM kevin_matches
                     WHERE for_user_id = $3 AND matched_user_id IS NOT NULL
                   ) ELSE (ip.sectors IS NULL OR ip.sectors = '{}'::text[] OR $1::text IS NULL OR EXISTS (
                         SELECT 1 FROM unnest(string_to_array($1, ',')) AS fsec
                         CROSS JOIN unnest(ip.sectors) AS isec
                         WHERE TRIM(LOWER(fsec)) = TRIM(LOWER(isec))
                       ))
                   AND (ip.stages IS NULL OR ip.stages = '{}'::text[] OR $2::text IS NULL OR LOWER($2) = ANY(SELECT LOWER(s) FROM unnest(ip.stages) AS s))
                   AND ip.user_id NOT IN (
                     SELECT matched_user_id FROM kevin_matches
                     WHERE for_user_id = $3 AND matched_user_id IS NOT NULL
                   ) END
                 ORDER BY RANDOM() LIMIT $5"#,
        )
        .bind(&sector)
        .bind(&stage)
        .bind(user.id)
        .bind(rescore)
        .bind(if rescore { 1000_i64 } else { 30 })
        .fetch_all(&state.db)
        .await
        .map_err(internal)?;

        // Connector network investors (metatron connect + all connectors)
        #[derive(sqlx::FromRow)]
        struct ContactCandidate {
            id: Uuid,
            name: String,
            firm_or_company: Option<String>,
            one_liner: Option<String>,
            sector_focus: Option<String>,
            stage_focus: Option<String>,
            geography: Option<String>,
        }
        let contacts: Vec<ContactCandidate> = sqlx::query_as(
            r#"SELECT id, name, firm_or_company, one_liner, sector_focus, stage_focus, geography
                 FROM connector_network_contacts
                 WHERE role = 'investor' AND is_archived = false
                   AND CASE WHEN $2 THEN id IN (
                     SELECT contact_id FROM kevin_matches
                     WHERE for_user_id = $1 AND contact_id IS NOT NULL
                   ) ELSE id NOT IN (
                     SELECT contact_id FROM kevin_matches
                     WHERE for_user_id = $1 AND contact_id IS NOT NULL
                   ) END
                 ORDER BY RANDOM() LIMIT $3"#,
        )
        .bind(user.id)
        .bind(rescore)
        .bind(if rescore { 1000_i64 } else { 40 })
        .fetch_all(&state.db)
        .await
        .map_err(internal)?;

        let mut info: HashMap<String, CandidateInfo> = HashMap::new();
        let mut all: Vec<Value> = vec![];

        for inv in &registered {
            let id = inv.user_id.to_string();
            info.insert(id.clone(), CandidateInfo {
                source: "user",
                display_name: inv.firm_name.clone(),
                display_one_liner: None,
                display_sector: None,
                display_stage: None,
                display_country: inv.country.clone(),
            });
            all.push(serde_json::json!({
                "id": id,
                "source": "user",
                "name": inv.firm_name,
                "bio": inv.bio,
                "thesis": inv.investment_thesis,
                "sectors": inv.sectors,
                "stages": inv.stages,
                "ticket_min": inv.ticket_size_min,
                "ticket_max": inv.ticket_size_max,
                "country": inv.country,
            }));
        }

        for c in contacts.iter().take(if rescore { usize::MAX } else { 20 }) {
            let id = c.id.to_string();
            let display_name = repair_double_encoded_utf8(
                c.firm_or_company
                    .as_deref()
                    .unwrap_or(c.name.as_str()),
            );
            // Truncate long fields to keep prompt compact
            let sector = c.sector_focus.as_deref().map(|s| &s[..s.len().min(60)]).map(str::to_owned);
            let stage = c.stage_focus.as_deref().map(|s| &s[..s.len().min(40)]).map(str::to_owned);
            info.insert(id.clone(), CandidateInfo {
                source: "contact",
                display_name: Some(display_name.clone()),
                display_one_liner: c.one_liner.clone(),
                display_sector: c.sector_focus.clone(),
                display_stage: c.stage_focus.clone(),
                display_country: c.geography.clone(),
            });
            all.push(serde_json::json!({
                "id": id,
                "name": display_name,
                "one_liner": c.one_liner,
                "sector": sector,
                "stage": stage,
                "country": c.geography,
            }));
        }

        let json = serde_json::to_string(&all).unwrap_or_default();
        (ctx, json, info, "founder_investor")
    } else {
        // Investor → find founders (unchanged logic, no connector contacts for this direction)
        let inv_profile: Option<(Option<String>, Option<String>, Option<Vec<String>>, Option<Vec<String>>)> =
            sqlx::query_as(
                "SELECT firm_name, investment_thesis, sectors, stages FROM investor_profiles WHERE user_id = $1",
            )
            .bind(user.id)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;

        let (firm, thesis, sectors, stages) = inv_profile.unwrap_or((None, None, None, None));
        let ctx = format!(
            "Investor: {}, Thesis: {}, Sectors: {:?}, Stages: {:?}",
            firm.unwrap_or_default(),
            thesis.unwrap_or_default(),
            sectors.clone().unwrap_or_default(),
            stages.clone().unwrap_or_default()
        );

        #[derive(sqlx::FromRow, Serialize)]
        struct FounderCandidate {
            user_id: Uuid,
            company_name: Option<String>,
            one_liner: Option<String>,
            stage: Option<String>,
            sector: Option<String>,
            country: Option<String>,
            angel_score: Option<i32>,
        }
        let founders: Vec<FounderCandidate> = sqlx::query_as(
            r#"SELECT p.user_id, p.company_name, p.one_liner, p.stage, p.sector, p.country,
                      a.score AS angel_score
                 FROM profiles p
                 JOIN users u ON u.id = p.user_id
                 LEFT JOIN angel_scores a ON a.founder_user_id = p.user_id
                 WHERE CASE WHEN $3 THEN p.user_id IN (
                     SELECT matched_user_id FROM kevin_matches
                     WHERE for_user_id = $4 AND matched_user_id IS NOT NULL
                   ) ELSE ($1::text[] IS NULL OR COALESCE(array_length($1, 1), 0) = 0 OR p.sector IS NULL OR EXISTS (
                         SELECT 1 FROM unnest(string_to_array(p.sector, ',')) AS fsec
                         CROSS JOIN unnest($1) AS isec
                         WHERE TRIM(LOWER(fsec)) = TRIM(LOWER(isec))
                       ))
                   AND ($2::text[] IS NULL OR COALESCE(array_length($2, 1), 0) = 0 OR p.stage IS NULL OR LOWER(p.stage) = ANY(SELECT LOWER(s) FROM unnest($2) AS s)) END
                 ORDER BY COALESCE(a.score, 0) DESC
                 LIMIT $5"#,
        )
        .bind(&sectors)
        .bind(&stages)
        .bind(rescore)
        .bind(user.id)
        .bind(if rescore { 1000_i64 } else { 20 })
        .fetch_all(&state.db)
        .await
        .map_err(internal)?;

        let mut info: HashMap<String, CandidateInfo> = HashMap::new();
        for f in &founders {
            let id = f.user_id.to_string();
            info.insert(id.clone(), CandidateInfo {
                source: "user",
                display_name: f.company_name.clone(),
                display_one_liner: f.one_liner.clone(),
                display_sector: f.sector.clone(),
                display_stage: f.stage.clone(),
                display_country: f.country.clone(),
            });
        }

        let json = serde_json::to_string(&founders).unwrap_or_default();
        (ctx, json, info, "investor_founder")
    };

    if candidates_json == "[]" || candidate_info.is_empty() {
        return Ok(Json(vec![]));
    }

    let mut feedback = super::kevin_feedback::matching_section(&state, user.id).await;
    if role == "STARTUP" {
        feedback = format!("{}{feedback}", super::readiness::matching_line(&state, user.id).await);
    }
    // `reasoning` is read by the person these matches are for; `intro_reasoning`
    // goes to the other side when an intro is made.
    let (subject_label, candidates_label, reasoning_rule, intro_rule) = if match_type == "founder_investor" {
        (
            "Founder",
            "Investor candidates",
            "written TO THE FOUNDER (\"you\", \"your\") about the investor (\"they\"): why this investor suits the founder's company and round",
            "written TO THE INVESTOR (\"you\", \"your portfolio\") about the founder: why this founder suits their thesis",
        )
    } else {
        (
            "Investor",
            "Founder candidates",
            "written TO THE INVESTOR (\"you\", \"your portfolio\") about the founder (\"they\"): why this founder suits the investor's thesis",
            "written TO THE FOUNDER (\"you\", \"your\") about the investor: why this investor suits the founder's company and round",
        )
    };
    let build_prompt = |candidates_json: &str, return_rule: &str| format!(
        r#"You are Kevin, metatron's AI matchmaking engine. Score how well each candidate fits.

{subject_label}: {user_context}{feedback}

{candidates_label} (JSON array):
{candidates_json}

Score each candidate on four parts:
- Sector (0-30): 30 = the founder's sector is a stated focus of the investor; 15 = adjacent; 0 = outside their focus.
- Stage (0-25): 25 = the investor invests at the founder's stage; 10 = one stage either side; 0 = otherwise.
- Region (0-25): 25 = the investor explicitly invests in, or has portfolio companies in, the founder's country or region (a global investor counts when they state a focus or portfolio there); 10 = global or no stated region, with nothing said about the founder's region; 0 = their focus excludes it. Investors based only in the US who focus on US/European markets get 0 or 10 for founders in Africa, Southeast Asia, LATAM or other emerging markets unless their thesis explicitly includes those regions.
- Ticket size (0-20): 20 = the founder's raise fits the investor's ticket range; 10 = unknown; 0 = clearly outside it.
Missing information never counts as a strong fit. Use only the values listed for each part.

For each candidate, return:
- sector, stage, region, ticket: the part scores
- reasoning: max 40 words, {reasoning_rule}
- intro_reasoning: max 40 words, {intro_rule}
Both texts: be specific (stage, sector, problem, region, ticket size), name a real mismatch honestly, always include currency symbols for amounts (e.g. $100K, $1M), never be generic.

Return ONLY a valid JSON array, no markdown, no code fences:
[{{"id":"...","sector":0,"stage":0,"region":0,"ticket":0,"reasoning":"...","intro_reasoning":"..."}}]

{return_rule}"#
    );

    let tier = if user.is_pro { "pro" } else if user.is_basic { "basic" } else { "free" };
    let all_candidates: Vec<Value> = serde_json::from_str(&candidates_json).unwrap_or_default();
    // A re-score covers every existing match, in batches that fit one reply.
    let (batch_size, return_rule) = if rescore {
        (15, "Return every candidate.".to_string())
    } else {
        (
            all_candidates.len().max(1),
            format!("Return the top {match_limit} matches only, ranked by the sum of the four parts, highest first."),
        )
    };
    let mut ranked: Vec<Value> = vec![];
    for batch in all_candidates.chunks(batch_size) {
        let batch_json = serde_json::to_string(batch).unwrap_or_default();
        let prompt = build_prompt(&batch_json, &return_rule);
        match rank_with_gemini(&state, &gemini_key, &prompt, user.id, role, tier).await {
            Ok(items) => ranked.extend(items),
            // A re-score keeps going: the other batches still get their new scores.
            Err((_, e)) if rescore => tracing::warn!("rescore batch failed for {}: {e}", user.id),
            Err(e) => return Err(e),
        }
    }

    // The best newly-strong match of this run; at most one alert is sent.
    let mut strong: Option<StrongMatch> = None;

    for item in &ranked {
        let id_str = item["id"].as_str().unwrap_or("");
        let Some(info) = candidate_info.get(id_str) else { continue; };
        let Ok(candidate_uuid) = Uuid::parse_str(id_str) else { continue; };
        let fit = MatchFit::from_item(item);
        let score = fit.total();
        let reasoning = item["reasoning"].as_str().map(str::to_owned);
        let intro_reasoning = item["intro_reasoning"].as_str().map(str::to_owned);
        let hard_fit = fit.hard_fit();

        let id_column = if info.source == "user" { "matched_user_id" } else { "contact_id" };
        if rescore {
            let _ = sqlx::query(&format!(
                "UPDATE kevin_matches SET score = $1, reasoning = $2, intro_reasoning = $3, hard_fit = $4
                  WHERE for_user_id = $5 AND {id_column} = $6 AND match_type = $7"
            ))
            .bind(score)
            .bind(&reasoning)
            .bind(&intro_reasoning)
            .bind(hard_fit)
            .bind(user.id)
            .bind(candidate_uuid)
            .bind(match_type)
            .execute(&state.db)
            .await;
            continue;
        }
        let prev_score: Option<i32> = sqlx::query_scalar(&format!(
            "SELECT score FROM kevin_matches WHERE for_user_id = $1 AND {id_column} = $2 AND match_type = $3"
        ))
        .bind(user.id)
        .bind(candidate_uuid)
        .bind(match_type)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        let newly_strong = hard_fit
            && score >= STRONG_MATCH_SCORE
            && prev_score.map(|p| p < STRONG_MATCH_SCORE).unwrap_or(true);
        if newly_strong && strong.as_ref().map(|s| score > s.score).unwrap_or(true) {
            strong = Some(StrongMatch {
                score,
                name: info.display_name.clone().unwrap_or_else(|| "a strong match".to_string()),
                reasoning: reasoning.clone(),
            });
        }

        if info.source == "user" {
            let _ = sqlx::query(
                r#"INSERT INTO kevin_matches
                    (for_user_id, matched_user_id, contact_id, match_type, score, reasoning,
                     display_name, display_one_liner, display_sector, display_stage, display_country,
                     intro_reasoning, hard_fit)
                   VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                   ON CONFLICT (for_user_id, matched_user_id, match_type) WHERE matched_user_id IS NOT NULL
                   DO UPDATE SET score = EXCLUDED.score, reasoning = EXCLUDED.reasoning,
                     intro_reasoning = EXCLUDED.intro_reasoning, hard_fit = EXCLUDED.hard_fit,
                     generated_at = NOW(), display_name = EXCLUDED.display_name,
                     display_one_liner = EXCLUDED.display_one_liner,
                     weekly_email_sent_at = CASE
                       WHEN kevin_matches.weekly_email_sent_at < NOW() - INTERVAL '7 days'
                       THEN NULL ELSE kevin_matches.weekly_email_sent_at END"#,
            )
            .bind(user.id)
            .bind(candidate_uuid)
            .bind(match_type)
            .bind(score)
            .bind(&reasoning)
            .bind(info.display_name.as_deref())
            .bind(info.display_one_liner.as_deref())
            .bind(info.display_sector.as_deref())
            .bind(info.display_stage.as_deref())
            .bind(info.display_country.as_deref())
            .bind(&intro_reasoning)
            .bind(hard_fit)
            .execute(&state.db)
            .await;
        } else {
            let _ = sqlx::query(
                r#"INSERT INTO kevin_matches
                    (for_user_id, matched_user_id, contact_id, match_type, score, reasoning,
                     display_name, display_one_liner, display_sector, display_stage, display_country,
                     intro_reasoning, hard_fit)
                   VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                   ON CONFLICT (for_user_id, contact_id, match_type) WHERE contact_id IS NOT NULL
                   DO UPDATE SET score = EXCLUDED.score, reasoning = EXCLUDED.reasoning,
                     intro_reasoning = EXCLUDED.intro_reasoning, hard_fit = EXCLUDED.hard_fit,
                     generated_at = NOW(), display_name = EXCLUDED.display_name,
                     display_one_liner = EXCLUDED.display_one_liner,
                     weekly_email_sent_at = CASE
                       WHEN kevin_matches.weekly_email_sent_at < NOW() - INTERVAL '7 days'
                       THEN NULL ELSE kevin_matches.weekly_email_sent_at END"#,
            )
            .bind(user.id)
            .bind(candidate_uuid)
            .bind(match_type)
            .bind(score)
            .bind(&reasoning)
            .bind(info.display_name.as_deref())
            .bind(info.display_one_liner.as_deref())
            .bind(info.display_sector.as_deref())
            .bind(info.display_stage.as_deref())
            .bind(info.display_country.as_deref())
            .bind(&intro_reasoning)
            .bind(hard_fit)
            .execute(&state.db)
            .await;
        }
    }

    if let Some(m) = strong {
        if !weekly_run && (is_basic || is_pro_user) {
            send_strong_match_alert(&state, user.id, match_type, m).await;
        }
    }

    let rows = fetch_kevin_matches_for_user(&state, user.id, Some(match_type)).await?;
    Ok(Json(rows))
}

/// Kevin's part scores for one candidate. The total and the hard-fit check
/// are worked out here, not by the model, so they always follow the guide.
struct MatchFit {
    sector: i32,
    stage: i32,
    region: i32,
    ticket: i32,
}

impl MatchFit {
    const SECTOR_MAX: i32 = 30;
    const STAGE_MAX: i32 = 25;
    const REGION_MAX: i32 = 25;
    const TICKET_MAX: i32 = 20;

    fn from_item(item: &Value) -> Self {
        let part = |key: &str, max: i32| item[key].as_i64().unwrap_or(0).clamp(0, max as i64) as i32;
        Self {
            sector: part("sector", Self::SECTOR_MAX),
            stage: part("stage", Self::STAGE_MAX),
            region: part("region", Self::REGION_MAX),
            ticket: part("ticket", Self::TICKET_MAX),
        }
    }

    fn total(&self) -> i32 {
        self.sector + self.stage + self.region + self.ticket
    }

    /// Sector, stage and region all at their best, and the ticket size not
    /// clearly outside the investor's range (unknown is fine).
    fn hard_fit(&self) -> bool {
        self.sector == Self::SECTOR_MAX
            && self.stage == Self::STAGE_MAX
            && self.region == Self::REGION_MAX
            && self.ticket >= Self::TICKET_MAX / 2
    }
}

/// Header that marks a one-off re-score; its value must be the cron secret.
pub(crate) const RESCORE_HEADER: &str = "x-kevin-rescore";

/// Sends one ranking prompt to Gemini and returns the parsed JSON array.
async fn rank_with_gemini(
    state: &AppState,
    gemini_key: &str,
    prompt: &str,
    user_id: Uuid,
    role: &str,
    tier: &str,
) -> Result<Vec<Value>, (StatusCode, String)> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        state.gemini_model, gemini_key
    );
    // Gemini 3 models expect the default temperature, and take a thinking
    // level instead of a token budget.
    let payload = serde_json::json!({
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 8192, "thinkingConfig": {"thinkingLevel": "minimal"}}
    });

    let client = reqwest::Client::new();
    let res = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        client.post(&url).header("content-type", "application/json").json(&payload).send(),
    )
    .await
    .map_err(|_| (StatusCode::GATEWAY_TIMEOUT, "Gemini timeout".to_string()))?
    .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let ok = res.status().is_success();
    let body: Value = res.json().await.map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    if !ok {
        crate::alerts::check_gemini_error(&body.to_string());
    }

    let usage = crate::ai::gemini_usage(&body);
    crate::cost::record_llm_usage(
        &state.db,
        Some(user_id),
        Some(role),
        Some(tier),
        "match_ranking",
        "gemini",
        &state.gemini_model,
        usage.input_tokens,
        usage.output_tokens,
    )
    .await;

    let text = crate::ai::gemini_text(&body);
    let text = if text.trim().is_empty() { "[]" } else { text.as_str() };
    let clean = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    // Extract just the [...] block in case Gemini adds preamble/postamble text
    let json_str = if let (Some(start), Some(end)) = (clean.find('['), clean.rfind(']')) {
        &clean[start..=end]
    } else {
        clean
    };
    Ok(serde_json::from_str(json_str).unwrap_or_default())
}

/// Set on the weekly refresh's call to `generate_matches` (see weekly_matches.rs).
pub(crate) const WEEKLY_RUN_HEADER: &str = "x-kevin-weekly-run";

/// A strong-match alert needs this score and `hard_fit` (stage, sector,
/// region and ticket size all fit). The scoring guide makes 90+ rare.
const STRONG_MATCH_SCORE: i32 = 90;

struct StrongMatch {
    score: i32,
    name: String,
    reasoning: Option<String>,
}

/// "Kevin found a strong match": the rare, act-now nudge between weekly
/// digests. Basic/Pro only (the caller checks), at most one a week, never
/// within a day of a digest, and only for a match in the person's top 3.
/// Sent on their own channel (WhatsApp, Telegram or email).
async fn send_strong_match_alert(state: &AppState, user_id: Uuid, match_type: &str, m: StrongMatch) {
    let higher: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM kevin_matches WHERE for_user_id = $1 AND match_type = $2 AND score > $3",
    )
    .bind(user_id)
    .bind(match_type)
    .bind(m.score)
    .fetch_one(&state.db)
    .await
    .unwrap_or(i64::MAX);
    if higher >= 3 {
        return;
    }

    // The last digest went out under a day ago, or the next one is due within a day.
    let near_digest: bool = sqlx::query_scalar(
        r#"SELECT COALESCE(
               MAX(sent_at) > NOW() - INTERVAL '1 day'
               OR MAX(sent_at) BETWEEN NOW() - INTERVAL '7 days' AND NOW() - INTERVAL '6 days',
               FALSE)
             FROM email_send_log
            WHERE user_id = $1 AND email_type LIKE 'weekly_matches_%'"#,
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(true);
    if near_digest {
        return;
    }

    #[derive(sqlx::FromRow)]
    struct Recipient {
        email: String,
        telegram_id: Option<String>,
        whatsapp_number: Option<String>,
        role: String,
    }
    // Claims this week's alert, so two runs at once can't both send.
    let Ok(Some(r)) = sqlx::query_as::<_, Recipient>(
        r#"UPDATE users SET strong_match_alert_at = NOW()
            WHERE id = $1
              AND (strong_match_alert_at IS NULL OR strong_match_alert_at < NOW() - INTERVAL '7 days')
        RETURNING email, telegram_id, whatsapp_number, role::text"#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    else {
        return;
    };

    let matches_href = format!(
        "{}{}",
        crate::email::frontend_url(),
        match r.role.as_str() {
            "INVESTOR" => "/investor/matches",
            "INTERMEDIARY" => "/connector/network",
            _ => "/startup/matches",
        }
    );
    let detail = m
        .reasoning
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("\n\n{s}"))
        .unwrap_or_default();
    let text = format!(
        "Kevin found a strong match for you: {} ({}% fit){detail}\n\nSee it on metatron: {matches_href}",
        m.name, m.score
    );

    let wa = r.whatsapp_number.as_deref().filter(|s| !s.trim().is_empty());
    let tg = r.telegram_id.as_deref().filter(|s| !s.trim().is_empty());
    let sent = if let (Some(to), Some(token), Some(phone_id)) = (
        wa,
        state.whatsapp_access_token.as_deref(),
        state.whatsapp_phone_number_id.as_deref(),
    ) {
        state
            .http_client
            .post(format!("https://graph.facebook.com/v18.0/{phone_id}/messages"))
            .bearer_auth(token)
            .json(&serde_json::json!({
                "messaging_product": "whatsapp", "recipient_type": "individual",
                "to": to, "type": "text", "text": { "body": text }
            }))
            .send()
            .await
            .map(|res| res.status().is_success())
            .unwrap_or(false)
    } else if let (Some(chat_id), Some(bot_token)) = (tg, state.telegram_bot_token.as_deref()) {
        state
            .http_client
            .post(format!("https://api.telegram.org/bot{bot_token}/sendMessage"))
            .json(&serde_json::json!({ "chat_id": chat_id, "text": text }))
            .send()
            .await
            .map(|res| res.status().is_success())
            .unwrap_or(false)
    } else {
        false
    };
    if sent {
        return;
    }

    // No messaging channel, or it failed (e.g. outside WhatsApp's 24-hour window).
    let html = crate::email::high_value_match_html(&m.name, m.score, m.reasoning.as_deref(), &matches_href);
    crate::email::send_tracked_email(
        &state.http_client,
        state.resend_api_key.as_deref(),
        &state.email_from,
        &r.email,
        "Kevin found a strong match for you",
        &html,
        &state.db,
        user_id,
        "high_value_match",
    )
    .await;
}

async fn request_intro(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(match_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    let role = user.role.as_str();

    if role != "STARTUP" && role != "INVESTOR" {
        return Err((StatusCode::FORBIDDEN, "founders and investors only".to_string()));
    }

    if role == "INVESTOR" {
        let row: Option<(Option<Uuid>, Option<Uuid>, Option<chrono::DateTime<chrono::Utc>>)> =
            sqlx::query_as(
                "SELECT matched_user_id, contact_id, intro_requested_at FROM kevin_matches WHERE id = $1 AND for_user_id = $2",
            )
            .bind(match_id)
            .bind(user.id)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;

        let (matched_user_id, _contact_id, intro_requested_at) =
            row.ok_or((StatusCode::NOT_FOUND, "match not found".to_string()))?;

        if intro_requested_at.is_some() {
            return Err((StatusCode::CONFLICT, "introduction already requested".to_string()));
        }

        let Some(founder_id) = matched_user_id else {
            return Err((
                StatusCode::BAD_REQUEST,
                "intro requests only available for platform founders".to_string(),
            ));
        };

        let investor_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
            .bind(user.id)
            .fetch_one(&state.db)
            .await
            .map_err(internal)?;
        let investor_name: String = sqlx::query_scalar::<_, Option<String>>(
            "SELECT firm_name FROM investor_profiles WHERE user_id = $1",
        )
        .bind(user.id)
        .fetch_optional(&state.db)
        .await
        .map_err(internal)?
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| investor_email.clone());

        let founder: Option<(String, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT u.email, u.telegram_id, u.whatsapp_number, p.company_name FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = $1",
        )
        .bind(founder_id)
        .fetch_optional(&state.db)
        .await
        .map_err(internal)?;

        if let Some((founder_email, founder_tg, founder_wa, company_name)) = founder {
            let company = company_name.unwrap_or_else(|| "your company".to_string());
            let subject = format!("{} wants to connect with {}", investor_name, company);
            let html = email::deck_viewed_html(&investor_name, &company);
            let msg = format!(
                "🎉 {} is interested in connecting with {}! Log in to metatron to accept or pass.",
                investor_name, company
            );
            email::send_email(
                &state.http_client,
                state.resend_api_key.as_deref(),
                &state.email_from,
                &founder_email,
                &subject,
                &html,
            )
            .await;
            if let (Some(tg), Some(bot)) = (founder_tg.as_deref(), state.telegram_bot_token.as_deref()) {
                let _ = state
                    .http_client
                    .post(format!("https://api.telegram.org/bot{bot}/sendMessage", bot = bot))
                    .json(&serde_json::json!({"chat_id": tg, "text": msg}))
                    .send()
                    .await;
            }
            if let (Some(wa), Some(tok), Some(pid)) = (
                founder_wa.as_deref(),
                state.whatsapp_access_token.as_deref(),
                state.whatsapp_phone_number_id.as_deref(),
            ) {
                let _ = state
                    .http_client
                    .post(format!("https://graph.facebook.com/v18.0/{pid}/messages", pid = pid))
                    .bearer_auth(tok)
                    .json(&serde_json::json!({"messaging_product":"whatsapp","recipient_type":"individual","to":wa,"type":"text","text":{"body":msg}}))
                    .send()
                    .await;
            }
        }

        sqlx::query("UPDATE kevin_matches SET intro_requested_at = NOW() WHERE id = $1")
            .bind(match_id)
            .execute(&state.db)
            .await
            .map_err(internal)?;

        let _ = connections::upsert_connect_request(&state.db, user.id, founder_id).await;

        return Ok(Json(serde_json::json!({"ok": true})));
    }

    // ── STARTUP PATH (original logic) ──────────────────────────────
    // Load the match (must belong to this user)
    let row: Option<(
        Uuid,
        Option<Uuid>,
        Option<Uuid>,
        Option<chrono::DateTime<chrono::Utc>>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        r#"SELECT id, contact_id, matched_user_id, intro_requested_at, reasoning, intro_reasoning
           FROM kevin_matches
           WHERE id = $1 AND for_user_id = $2"#,
    )
    .bind(match_id)
    .bind(user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    let (_id, contact_id, matched_user_id, intro_requested_at, founder_reasoning_opt, intro_reasoning_opt) =
        row.ok_or((StatusCode::NOT_FOUND, "match not found".to_string()))?;

    if intro_requested_at.is_some() {
        return Err((StatusCode::CONFLICT, "introduction already requested".to_string()));
    }

    // `reasoning` is what Kevin tells the investor (and the connector);
    // `founder_reasoning` is the founder's own "why this investor" text.
    let founder_reasoning = founder_reasoning_opt.unwrap_or_default();
    let reasoning = intro_reasoning_opt
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| founder_reasoning.clone());

    // Get founder details
    let founder_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_one(&state.db)
        .await
        .map_err(internal)?;

    let founder_profile: Option<(
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        r#"SELECT p.company_name, p.one_liner, p.stage, p.sector,
            CASE WHEN u.is_basic = TRUE OR u.is_pro = TRUE OR p.deck_expires_at IS NULL OR p.deck_expires_at > NOW() THEN p.pitch_deck_url ELSE NULL END AS pitch_deck_url
           FROM profiles p
           JOIN users u ON u.id = p.user_id
           WHERE p.user_id = $1"#,
    )
    .bind(user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    let (fp_company, fp_one_liner, fp_stage, fp_sector, fp_deck_url) =
        founder_profile.unwrap_or((None, None, None, None, None));

    // Block intro request if founder profile is incomplete
    if fp_company.is_none() || fp_one_liner.is_none() || fp_stage.is_none() || fp_sector.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Please complete your founder profile (company name, description, stage and sector) before requesting an introduction.".to_string(),
        ));
    }

    let company_name = fp_company.unwrap_or_else(|| "their company".to_string());
    let founder_one_liner = fp_one_liner.unwrap_or_default();
    let founder_stage = fp_stage.unwrap_or_default();
    let founder_sector = fp_sector.unwrap_or_default();
    let founder_deck_url = fp_deck_url
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // Default investor_channels reflects what we dispatched to the investor.
    // For external-connector intros, the investor is reached via their connector (email).
    let mut investor_channels = String::from("email");
    let mut investor_display_name = String::from("the investor");

    // Founder channels are fetched once here so branches that self-handle
    // founder notifications (e.g. registered investor) can reference them.
    let founder_channels: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT telegram_id, whatsapp_number FROM users WHERE id = $1",
    )
    .bind(user.id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    // When a branch sends the founder-side confirmation + messaging itself,
    // set this flag so the shared tail code doesn't duplicate the sends.
    let mut founder_notified_in_branch = false;

    if let Some(contact_id) = contact_id {
        // Connector network contact
        let contact: Option<(String, Option<String>, Option<String>, Uuid)> = sqlx::query_as(
            r#"SELECT name, email, firm_or_company, connector_user_id
               FROM connector_network_contacts WHERE id = $1"#,
        )
        .bind(contact_id)
        .fetch_optional(&state.db)
        .await
        .map_err(internal)?;

        let (contact_name, contact_email, contact_firm, connector_user_id) =
            contact.ok_or((StatusCode::NOT_FOUND, "contact not found".to_string()))?;

        // Is this a metatron connect contact? Check connector user's email domain
        let connector_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
            .bind(connector_user_id)
            .fetch_one(&state.db)
            .await
            .map_err(internal)?;

        let is_metatron_connect = connector_email.ends_with("@metatrondao.io");

        let investor_name: String = contact_firm.clone().unwrap_or_else(|| contact_name.clone());
        investor_display_name = investor_name.clone();

        if is_metatron_connect {
            // Direct email to investor (test override via env var)
            let to_email = std::env::var("INTRO_TEST_EMAIL")
                .unwrap_or_else(|_| contact_email.clone().unwrap_or_default());

            let mut sent_email = false;
            let mut sent_telegram = false;
            let mut sent_whatsapp = false;

            // Look up investor's Telegram and WhatsApp via their email
            let investor_channels_row: Option<(Option<String>, Option<String>)> = if !to_email
                .trim()
                .is_empty()
            {
                sqlx::query_as(
                    "SELECT telegram_id, whatsapp_number FROM users WHERE LOWER(email) = LOWER($1)",
                )
                .bind(&to_email)
                .fetch_optional(&state.db)
                .await
                .unwrap_or(None)
            } else {
                None
            };

            let (investor_tg, investor_wa) =
                investor_channels_row.unwrap_or((None, None));

            // Send investor email using the new template — always include deck URL
            if !to_email.trim().is_empty() {
                let html = email::intro_investor_email_html(
                    &investor_name,
                    &company_name,
                    &founder_one_liner,
                    &founder_stage,
                    &founder_sector,
                    &reasoning,
                    founder_deck_url.as_deref(),
                );
                email::send_email(
                    &state.http_client,
                    state.resend_api_key.as_deref(),
                    &state.email_from,
                    &to_email,
                    &format!("Introduction request: {} → {}", company_name, investor_name),
                    &html,
                )
                .await;
                sent_email = true;
            }

            // Investor Telegram
            if let (Some(tg_id), Some(bot_token)) = (
                investor_tg.as_deref().filter(|s| !s.trim().is_empty()),
                state.telegram_bot_token.as_deref(),
            ) {
                let deck_line = founder_deck_url
                    .as_deref()
                    .map(|u| format!("\nDeck: {u}"))
                    .unwrap_or_default();
                let tg_text = format!(
                    "New intro request via metatron\n\n{} ({}) would like to connect.\nStage: {} · Sector: {}\n\nWhy Kevin matched you:\n{}{}\n\nReply via metatron or email {}.",
                    company_name,
                    founder_one_liner,
                    founder_stage,
                    founder_sector,
                    reasoning,
                    deck_line,
                    founder_email,
                );
                let tg_url = format!("https://api.telegram.org/bot{}/sendMessage", bot_token);
                let tg_payload = serde_json::json!({
                    "chat_id": tg_id,
                    "text": tg_text,
                });
                match state.http_client.post(&tg_url).json(&tg_payload).send().await {
                    Ok(resp) if resp.status().is_success() => {
                        sent_telegram = true;
                    }
                    Ok(resp) => {
                        tracing::warn!(
                            "investor telegram notification failed status={}",
                            resp.status()
                        );
                    }
                    Err(e) => {
                        tracing::warn!("investor telegram notification error: {e}");
                    }
                }
            }

            // Investor WhatsApp
            if let (Some(wa_number), Some(wa_token), Some(phone_id)) = (
                investor_wa.as_deref().filter(|s| !s.trim().is_empty()),
                state.whatsapp_access_token.as_deref(),
                state.whatsapp_phone_number_id.as_deref(),
            ) {
                let deck_line = founder_deck_url
                    .as_deref()
                    .map(|u| format!("\nDeck: {u}"))
                    .unwrap_or_default();
                let wa_text = format!(
                    "metatron intro request\n\n{} ({}) would like to connect.\nStage: {} · Sector: {}\n\nWhy Kevin matched you:\n{}{}\n\nReply via metatron or email {}.",
                    company_name,
                    founder_one_liner,
                    founder_stage,
                    founder_sector,
                    reasoning,
                    deck_line,
                    founder_email,
                );
                let wa_url = format!("https://graph.facebook.com/v18.0/{}/messages", phone_id);
                let wa_payload = serde_json::json!({
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": wa_number,
                    "type": "text",
                    "text": { "body": wa_text }
                });
                match state
                    .http_client
                    .post(&wa_url)
                    .bearer_auth(wa_token)
                    .json(&wa_payload)
                    .send()
                    .await
                {
                    Ok(resp) if resp.status().is_success() => {
                        sent_whatsapp = true;
                    }
                    Ok(resp) => {
                        tracing::warn!(
                            "investor whatsapp notification failed status={}",
                            resp.status()
                        );
                    }
                    Err(e) => {
                        tracing::warn!("investor whatsapp notification error: {e}");
                    }
                }
            }

            // Build human-readable channels string
            investor_channels = match (sent_email, sent_telegram, sent_whatsapp) {
                (true, true, true) => "email, Telegram and WhatsApp".to_string(),
                (true, true, false) => "email and Telegram".to_string(),
                (true, false, true) => "email and WhatsApp".to_string(),
                (false, true, true) => "Telegram and WhatsApp".to_string(),
                (true, false, false) => "email".to_string(),
                (false, true, false) => "Telegram".to_string(),
                (false, false, true) => "WhatsApp".to_string(),
                (false, false, false) => "metatron".to_string(),
            };
        } else {
            // Create connector_introduction record and notify connector
            let _ = sqlx::query(
                "INSERT INTO connector_introductions (connector_user_id, person_a_name, person_a_email, person_b_name, person_b_email, notes) \
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(connector_user_id)
            .bind(&company_name)
            .bind(&founder_email)
            .bind(contact_firm.as_deref().unwrap_or(contact_name.as_str()))
            .bind(contact_email.as_deref().unwrap_or(""))
            .bind(format!(
                "Introduction requested via Kevin Matches. Founder: {} — {}\n\nKevin's reasoning:\n{}",
                company_name, founder_one_liner, reasoning
            ))
            .execute(&state.db)
            .await;

            // Notify the connector by email
            let resend_key = std::env::var("RESEND_API_KEY").unwrap_or_default();
            let notif = serde_json::json!({
                "from": "Kevin AI <kevin@metatron.id>",
                "to": [connector_email],
                "subject": format!("New intro request: {} → {}", company_name, investor_name),
                "html": format!(
                    "<p>A founder has requested an introduction via metatron.</p>\
                    <p><strong>Founder:</strong> {} ({})<br/><strong>Investor:</strong> {}</p>\
                    <p><strong>Why Kevin matched them:</strong><br/>{}</p>\
                    <p>Please facilitate this introduction via your connector dashboard.</p>",
                    company_name, founder_email, investor_name, reasoning
                )
            });
            if let Err(e) = state
                .http_client
                .post("https://api.resend.com/emails")
                .header("Authorization", format!("Bearer {}", resend_key))
                .json(&notif)
                .send()
                .await
            {
                tracing::warn!("connector notification email send failed: {e}");
            }

            // Investor is reached through their connector.
            investor_channels = "their connector".to_string();
        }
    } else if let Some(investor_user_id) = matched_user_id {
        // Registered platform investor — look up their details directly
        let investor_row: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT email, telegram_id, whatsapp_number FROM users WHERE id = $1",
        )
        .bind(investor_user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(internal)?;

        if let Some((investor_email, investor_telegram_id, investor_whatsapp)) = investor_row {
            // Pull investor display name from investor_profiles
            let investor_name: String = sqlx::query_scalar::<_, Option<String>>(
                "SELECT firm_name FROM investor_profiles WHERE user_id = $1",
            )
            .bind(investor_user_id)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?
            .flatten()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| investor_email.clone());

            let to_email = std::env::var("INTRO_TEST_EMAIL")
                .unwrap_or_else(|_| investor_email.clone());

            // Build investor_channels string
            let mut channels: Vec<&str> = vec!["email"];
            if investor_telegram_id.is_some() {
                channels.push("Telegram");
            }
            if investor_whatsapp.is_some() {
                channels.push("WhatsApp");
            }
            let investor_channels_local = match channels.as_slice() {
                [a] => a.to_string(),
                [a, b] => format!("{a} and {b}"),
                [a, b, c] => format!("{a}, {b} and {c}"),
                _ => "email".to_string(),
            };

            // Investor email
            let deck_url = founder_deck_url.as_deref();
            let reasoning_str: &str = if reasoning.trim().is_empty() {
                "Strong alignment between your investment thesis and this founder's profile."
            } else {
                reasoning.as_str()
            };
            email::send_email(
                &state.http_client,
                state.resend_api_key.as_deref(),
                &state.email_from,
                &to_email,
                &format!("{} — a founder Kevin thinks you should meet", company_name),
                &email::intro_investor_email_html(
                    &investor_name,
                    &company_name,
                    &founder_one_liner,
                    &founder_stage,
                    &founder_sector,
                    reasoning_str,
                    deck_url,
                ),
            )
            .await;

            // Investor Telegram — when INTRO_TEST_EMAIL is set, re-resolve to the
            // test recipient's Telegram instead of the real investor's.
            let effective_telegram = if std::env::var("INTRO_TEST_EMAIL").is_ok() {
                sqlx::query_scalar::<_, Option<String>>(
                    "SELECT telegram_id FROM users WHERE LOWER(email) = LOWER($1)",
                )
                .bind(&to_email)
                .fetch_optional(&state.db)
                .await
                .unwrap_or(None)
                .flatten()
            } else {
                investor_telegram_id.clone()
            };

            if let (Some(tg_id), Some(bot_token)) =
                (effective_telegram, state.telegram_bot_token.as_deref())
            {
                let tg_msg = format!(
                    "👋 {}, Kevin here.\n\nI've matched you with a founder I think you should meet.\n\nHere's why:\n{}\n\n🏢 {}\n💡 {}\n📍 Stage: {} · Sector: {}{}",
                    investor_name,
                    reasoning_str,
                    company_name,
                    founder_one_liner,
                    founder_stage,
                    founder_sector,
                    deck_url.map(|u| format!("\n📄 Deck: {}", u)).unwrap_or_default()
                );
                let _ = state
                    .http_client
                    .post(format!(
                        "https://api.telegram.org/bot{}/sendMessage",
                        bot_token
                    ))
                    .json(&serde_json::json!({ "chat_id": tg_id, "text": tg_msg }))
                    .send()
                    .await;
            }

            // Investor WhatsApp
            let effective_whatsapp = if std::env::var("INTRO_TEST_EMAIL").is_ok() {
                sqlx::query_scalar::<_, Option<String>>(
                    "SELECT whatsapp_number FROM users WHERE LOWER(email) = LOWER($1)",
                )
                .bind(&to_email)
                .fetch_optional(&state.db)
                .await
                .unwrap_or(None)
                .flatten()
            } else {
                investor_whatsapp
            };

            if let (Some(wa_number), Some(wa_token), Some(phone_id)) = (
                effective_whatsapp,
                state.whatsapp_access_token.as_deref(),
                state.whatsapp_phone_number_id.as_deref(),
            ) {
                let wa_msg = format!(
                    "👋 {}, Kevin here.\n\nI've matched you with a founder I think you should meet.\n\nHere's why:\n{}\n\n🏢 {}\n💡 {}\n📍 Stage: {} · Sector: {}{}",
                    investor_name,
                    reasoning_str,
                    company_name,
                    founder_one_liner,
                    founder_stage,
                    founder_sector,
                    deck_url.map(|u| format!("\n📄 Deck: {}", u)).unwrap_or_default()
                );
                let _ = state
                    .http_client
                    .post(format!(
                        "https://graph.facebook.com/v18.0/{}/messages",
                        phone_id
                    ))
                    .bearer_auth(wa_token)
                    .json(&serde_json::json!({
                        "messaging_product": "whatsapp",
                        "recipient_type": "individual",
                        "to": wa_number,
                        "type": "text",
                        "text": { "body": wa_msg }
                    }))
                    .send()
                    .await;
            }

            // Founder confirmation — same as metatron connect path
            email::send_email(
                &state.http_client,
                state.resend_api_key.as_deref(),
                &state.email_from,
                &founder_email,
                &format!("Kevin has introduced you to {}", investor_name),
                &email::intro_founder_confirmation_html(
                    &investor_name,
                    &company_name,
                    reasoning_str,
                    &investor_channels_local,
                ),
            )
            .await;

            // Founder Telegram
            if let Some((founder_tg, _)) = founder_channels.as_ref() {
                if let (Some(tg_id), Some(bot_token)) =
                    (founder_tg.as_deref(), state.telegram_bot_token.as_deref())
                {
                    let msg = format!(
                        "✅ Done! I've introduced you to {}.\n\nHere's what I told them:\n{}\n\nThey've been notified via {} and will reach out if interested. Keep building! 🚀",
                        investor_name, reasoning_str, investor_channels_local
                    );
                    let _ = state
                        .http_client
                        .post(format!(
                            "https://api.telegram.org/bot{}/sendMessage",
                            bot_token
                        ))
                        .json(&serde_json::json!({ "chat_id": tg_id, "text": msg }))
                        .send()
                        .await;
                }
            }

            // Propagate for completeness (so subsequent reads reflect reality),
            // then mark the founder-side as handled so tail code skips duplicates.
            investor_display_name = investor_name;
            investor_channels = investor_channels_local;
            founder_notified_in_branch = true;
        }
    }

    // Mark intro as requested
    sqlx::query("UPDATE kevin_matches SET intro_requested_at = NOW() WHERE id = $1")
        .bind(match_id)
        .execute(&state.db)
        .await
        .map_err(internal)?;

    if let Some(to_uid) = matched_user_id {
        let _ = connections::upsert_connect_request(&state.db, user.id, to_uid).await;
    }

    if !founder_notified_in_branch {
        // Email confirmation to founder — includes reasoning and channels used
        let confirmation_html = email::intro_founder_confirmation_html(
            &investor_display_name,
            &company_name,
            &reasoning,
            &investor_channels,
        );
        email::send_email(
            &state.http_client,
            state.resend_api_key.as_deref(),
            &state.email_from,
            &founder_email,
            &format!("Intro request sent — {}", company_name),
            &confirmation_html,
        )
        .await;

        let kevin_msg = format!(
            "Your intro request for {} has been submitted via {}.\n\nWhy Kevin matched you:\n{}\n\nI'll let you know when they respond. Keep building!",
            company_name, investor_channels, founder_reasoning
        );

        if let Some((telegram_id, whatsapp_number)) = founder_channels {
            // Telegram notification
            if let (Some(tg_id), Some(bot_token)) =
                (telegram_id, state.telegram_bot_token.as_deref())
            {
                let tg_url = format!("https://api.telegram.org/bot{}/sendMessage", bot_token);
                let tg_payload = serde_json::json!({
                    "chat_id": tg_id,
                    "text": kevin_msg,
                });
                if let Err(e) = state
                    .http_client
                    .post(&tg_url)
                    .json(&tg_payload)
                    .send()
                    .await
                {
                    tracing::warn!("founder telegram notification failed: {e}");
                }
            }

            // WhatsApp notification
            if let (Some(wa_number), Some(wa_token), Some(phone_id)) = (
                whatsapp_number,
                state.whatsapp_access_token.as_deref(),
                state.whatsapp_phone_number_id.as_deref(),
            ) {
                let wa_url = format!("https://graph.facebook.com/v18.0/{}/messages", phone_id);
                let wa_payload = serde_json::json!({
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": wa_number,
                    "type": "text",
                    "text": { "body": kevin_msg }
                });
                if let Err(e) = state
                    .http_client
                    .post(&wa_url)
                    .bearer_auth(wa_token)
                    .json(&wa_payload)
                    .send()
                    .await
                {
                    tracing::warn!("founder whatsapp notification failed: {e}");
                }
            }
        }
    }

    Ok(Json(serde_json::json!({"ok": true})))
}


// ── Kevin intro suggestions ────────────────────────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
pub struct IntroSuggestion {
    pub id: Uuid,
    pub matched_user_id: Uuid,
    pub fit_score: f64,
    pub fit_reason: String,
    pub draft_message: String,
    pub status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub firm_name: Option<String>,
    pub investor_email: String,
    pub thesis: Option<String>,
}

async fn list_suggestions(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<IntroSuggestion>>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;

    let rows = sqlx::query_as::<_, IntroSuggestion>(
        r#"
        SELECT
            kis.id,
            kis.matched_user_id,
            kis.fit_score,
            kis.fit_reason,
            kis.draft_message,
            kis.status,
            kis.created_at,
            ip.firm_name,
            u2.email AS investor_email,
            ip.investment_thesis AS thesis
        FROM kevin_intro_suggestions kis
        JOIN users u2 ON u2.id = kis.matched_user_id
        LEFT JOIN investor_profiles ip ON ip.user_id = kis.matched_user_id
        WHERE kis.for_user_id = $1
        AND kis.status = 'pending'
        ORDER BY kis.fit_score DESC, kis.created_at DESC
        "#,
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(rows))
}

async fn approve_suggestion(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(suggestion_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;

    // Load suggestion
    let row: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT matched_user_id, draft_message FROM kevin_intro_suggestions WHERE id = $1 AND for_user_id = $2 AND status = 'pending'",
    )
    .bind(suggestion_id)
    .bind(user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    let (investor_id, draft_note) = row.ok_or((StatusCode::NOT_FOUND, "suggestion not found".to_string()))?;

    // Check investor exists
    let investor_ok: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND role = 'INVESTOR')")
        .bind(investor_id)
        .fetch_one(&state.db)
        .await
        .map_err(internal)?;

    if !investor_ok {
        return Err((StatusCode::NOT_FOUND, "investor not found".to_string()));
    }

    // Fire the intro via introductions table
    let intro_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO introductions (id, investor_user_id, startup_user_id, status, note) VALUES ($1, $2, $3, 'PENDING', $4) ON CONFLICT DO NOTHING",
    )
    .bind(intro_id)
    .bind(investor_id)
    .bind(user.id)
    .bind(&draft_note)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    // Mark kevin_match intro_requested_at if a match exists
    let _ = sqlx::query(
        "UPDATE kevin_matches SET intro_requested_at = NOW() WHERE for_user_id = $1 AND matched_user_id = $2 AND intro_requested_at IS NULL",
    )
    .bind(user.id)
    .bind(investor_id)
    .execute(&state.db)
    .await;

    // Mark suggestion approved
    sqlx::query(
        "UPDATE kevin_intro_suggestions SET status = 'approved', actioned_at = NOW() WHERE id = $1",
    )
    .bind(suggestion_id)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    // Notify investor via email
    let investor_email: Option<String> = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(investor_id)
        .fetch_optional(&state.db)
        .await
        .unwrap_or(None);

    let founder_fp: Option<(Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT p.company_name, p.one_liner, p.stage, p.sector, p.pitch_deck_url FROM profiles p WHERE p.user_id = $1",
    )
    .bind(user.id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    if let (Some(inv_email), Some(resend_key)) = (investor_email, state.resend_api_key.as_deref()) {
        let (fp_company, fp_one_liner, fp_stage, fp_sector, fp_deck) =
            founder_fp.unwrap_or((None, None, None, None, None));
        let company = fp_company.unwrap_or_else(|| "a founder".to_string());
        let one_liner = fp_one_liner.unwrap_or_default();
        let stage = fp_stage.unwrap_or_default();
        let sector = fp_sector.unwrap_or_default();
        crate::email::send_email(
            &state.http_client,
            Some(resend_key),
            &state.email_from,
            &inv_email,
            &format!("{company} wants to connect via Kevin"),
            &crate::email::intro_investor_email_html("Investor", &company, &one_liner, &stage, &sector, &draft_note, fp_deck.as_deref()),
        )
        .await;
    }
    Ok(Json(serde_json::json!({"ok": true, "intro_id": intro_id})))
}

async fn decline_suggestion(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(suggestion_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;

    let updated = sqlx::query(
        "UPDATE kevin_intro_suggestions SET status = 'declined', actioned_at = NOW() WHERE id = $1 AND for_user_id = $2 AND status = 'pending'",
    )
    .bind(suggestion_id)
    .bind(user.id)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    if updated.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "suggestion not found".to_string()));
    }

    Ok(Json(serde_json::json!({"ok": true})))
}

#[cfg(test)]
mod tests {
    use super::MatchFit;

    #[test]
    fn fit_totals_and_hard_fit() {
        let fit = MatchFit::from_item(&serde_json::json!({"sector": 30, "stage": 25, "region": 25, "ticket": 10}));
        assert_eq!(fit.total(), 90);
        assert!(fit.hard_fit());

        // Out-of-range parts are capped; a ticket mismatch fails the fit check.
        let fit = MatchFit::from_item(&serde_json::json!({"sector": 99, "stage": 25, "region": 25, "ticket": 0}));
        assert_eq!(fit.total(), 80);
        assert!(!fit.hard_fit());

        let fit = MatchFit::from_item(&serde_json::json!({"score": 95}));
        assert_eq!(fit.total(), 0);
        assert!(!fit.hard_fit());
    }
}
