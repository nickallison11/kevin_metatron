use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, put},
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::email;
use crate::identity::require_user;
use crate::routes::profile::FounderPublicDto;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/following", get(list_following_founders))
        .route("/:id", put(accept_connection).delete(decline_or_cancel_connection))
        .route("/", get(list_connect_handshakes).post(create_connection))
}

// --- Shared connect handshake (used by kevin_matches + deals) ----------------

pub async fn upsert_connect_request(
    pool: &PgPool,
    from_user_id: Uuid,
    to_user_id: Uuid,
) -> Result<(), sqlx::Error> {
    if from_user_id == to_user_id {
        return Ok(());
    }
    sqlx::query(
        r#"
        INSERT INTO connections (from_user_id, to_user_id, connection_type, status, requested_at)
        VALUES ($1, $2, 'connect', 'pending', NOW())
        ON CONFLICT (from_user_id, to_user_id) DO UPDATE SET
            connection_type = CASE
                WHEN connections.accepted_at IS NOT NULL THEN connections.connection_type
                ELSE 'connect'
            END,
            requested_at = CASE
                WHEN connections.accepted_at IS NOT NULL THEN connections.requested_at
                WHEN connections.declined_at IS NOT NULL OR connections.status = 'declined' THEN NOW()
                ELSE COALESCE(connections.requested_at, NOW())
            END,
            declined_at = CASE
                WHEN connections.accepted_at IS NOT NULL THEN connections.declined_at
                WHEN connections.declined_at IS NOT NULL OR connections.status = 'declined' THEN NULL
                ELSE connections.declined_at
            END,
            status = CASE
                WHEN connections.accepted_at IS NOT NULL THEN 'accepted'
                ELSE 'pending'
            END
        "#,
    )
    .bind(from_user_id)
    .bind(to_user_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn mark_connect_declined_for_pair(
    pool: &PgPool,
    from_user_id: Uuid,
    to_user_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE connections
        SET declined_at = NOW(), status = 'declined'
        WHERE from_user_id = $1 AND to_user_id = $2 AND connection_type = 'connect'
          AND accepted_at IS NULL
        "#,
    )
    .bind(from_user_id)
    .bind(to_user_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Sets `accepted_at` if still pending; returns `true` if this call performed the first accept
/// (caller should send Kevin warm notifications).
pub async fn try_first_accept_connect(
    pool: &PgPool,
    from_user_id: Uuid,
    to_user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let id: Option<Uuid> = sqlx::query_scalar(
        r#"
        UPDATE connections
        SET accepted_at = NOW(), status = 'accepted', declined_at = NULL
        WHERE from_user_id = $1 AND to_user_id = $2 AND connection_type = 'connect'
          AND accepted_at IS NULL
        RETURNING id
        "#,
    )
    .bind(from_user_id)
    .bind(to_user_id)
    .fetch_optional(pool)
    .await?;
    Ok(id.is_some())
}

/// Same semantics as `accept_intro`: `accepter_user_id` is the JWT user; `km_for_user_id` is
/// `kevin_matches.for_user_id` (legacy variable name `founder_id` in that handler).
pub async fn send_kevin_warm_email_for_intro_accept(
    state: &Arc<AppState>,
    accepter_user_id: Uuid,
    km_for_user_id: Uuid,
) {
    // Detect which of the two users is the investor and which is the founder.
    // Don't assume accepter==investor — the new investor->founder Connect flow
    // has the founder accepting, which is the reverse of the legacy direction.
    let roles: Vec<(Uuid, String)> = match sqlx::query_as(
        "SELECT id, role::text FROM users WHERE id = ANY($1)",
    )
    .bind(vec![accepter_user_id, km_for_user_id])
    .fetch_all(&state.db)
    .await
    {
        Ok(r) => r,
        Err(_) => return,
    };
    let (investor_user_id, founder_user_id) = {
        let mut investor: Option<Uuid> = None;
        let mut founder: Option<Uuid> = None;
        for (id, role) in &roles {
            match role.as_str() {
                "INVESTOR" => investor = Some(*id),
                "STARTUP" => founder = Some(*id),
                _ => {}
            }
        }
        match (investor, founder) {
            (Some(i), Some(f)) => (i, f),
            // Legacy path or unexpected pair — fall back to the historical assumption
            // (accepter=investor, km_for_user=founder) so existing flows don't break.
            _ => (accepter_user_id, km_for_user_id),
        }
    };

    let investor_email: String = match sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(investor_user_id)
        .fetch_one(&state.db)
        .await
    {
        Ok(e) => e,
        Err(_) => return,
    };

    let firm_name: Option<String> = sqlx::query_scalar::<_, Option<String>>(
        "SELECT firm_name FROM investor_profiles WHERE user_id = $1",
    )
    .bind(investor_user_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .flatten();
    let investor_name = firm_name.unwrap_or_else(|| investor_email.clone());

    let investor_notif: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT telegram_id, whatsapp_number FROM users WHERE id = $1",
    )
    .bind(investor_user_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let (inv_tg, inv_wa) = investor_notif.unwrap_or((None, None));

    let founder: Option<(String, Option<String>, Option<String>, Option<String>, Option<String>)> =
        sqlx::query_as(
            r#"SELECT u.email, u.telegram_id, u.whatsapp_number, p.company_name,
                    CASE WHEN u.is_basic OR u.is_pro OR p.deck_expires_at IS NULL OR p.deck_expires_at > NOW() THEN p.pitch_deck_url ELSE NULL END
             FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = $1"#,
        )
        .bind(founder_user_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

    if let Some((f_email, f_tg, f_wa, company_name, deck_url)) = founder {
        let company = company_name.unwrap_or_else(|| "your company".to_string());

        let f_subject = format!("{} is interested in {}!", investor_name, company);
        let f_html = email::intro_accepted_founder_html(&investor_name, &company, &investor_email);
        let f_msg = format!(
            "🎉 {} wants to connect with {}! Reach them at: {}\n\nThey'll be in touch to arrange a call.",
            investor_name, company, investor_email
        );
        email::send_email(
            &state.http_client,
            state.resend_api_key.as_deref(),
            &state.email_from,
            &f_email,
            &f_subject,
            &f_html,
        )
        .await;
        if let (Some(tg), Some(bot)) = (f_tg.as_deref(), state.telegram_bot_token.as_deref()) {
            let _ = state
                .http_client
                .post(format!("https://api.telegram.org/bot{bot}/sendMessage", bot = bot))
                .json(&serde_json::json!({"chat_id": tg, "text": f_msg}))
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
                .post(format!(
                    "https://graph.facebook.com/v18.0/{pid}/messages",
                    pid = pid
                ))
                .bearer_auth(tok)
                .json(&serde_json::json!({"messaging_product":"whatsapp","recipient_type":"individual","to":wa,"type":"text","text":{"body":f_msg}}))
                .send()
                .await;
        }

        let deck_msg = deck_url
            .as_deref()
            .map(|u| format!("\nDeck: {}", u))
            .unwrap_or_default();
        let inv_subject = format!("You're connected with {}", company);
        let inv_html = email::intro_accepted_investor_html(
            &investor_name,
            &company,
            &f_email,
            deck_url.as_deref(),
        );
        let inv_msg = format!(
            "✅ You're now connected with {}!\n\nFounder email: {}{}\n\nGood luck!",
            company, f_email, deck_msg
        );
        email::send_email(
            &state.http_client,
            state.resend_api_key.as_deref(),
            &state.email_from,
            &investor_email,
            &inv_subject,
            &inv_html,
        )
        .await;
        if let (Some(tg), Some(bot)) = (inv_tg.as_deref(), state.telegram_bot_token.as_deref()) {
            let _ = state
                .http_client
                .post(format!("https://api.telegram.org/bot{bot}/sendMessage", bot = bot))
                .json(&serde_json::json!({"chat_id": tg, "text": inv_msg}))
                .send()
                .await;
        }
        if let (Some(wa), Some(tok), Some(pid)) = (
            inv_wa.as_deref(),
            state.whatsapp_access_token.as_deref(),
            state.whatsapp_phone_number_id.as_deref(),
        ) {
            let _ = state
                .http_client
                .post(format!(
                    "https://graph.facebook.com/v18.0/{pid}/messages",
                    pid = pid
                ))
                .bearer_auth(tok)
                .json(&serde_json::json!({"messaging_product":"whatsapp","recipient_type":"individual","to":wa,"type":"text","text":{"body":inv_msg}}))
                .send()
                .await;
        }
    }
}

// --- HTTP DTOs ----------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateConnectionBody {
    pub to_user_id: Uuid,
    #[serde(default)]
    pub connection_type: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ConnectionOut {
    pub id: Uuid,
    pub to_user_id: Uuid,
    pub connection_type: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct ConnectListItem {
    pub id: Uuid,
    pub other_user_id: Uuid,
    pub other_email: String,
    pub other_role: String,
    pub firm_name: Option<String>,
    pub company_name: Option<String>,
    pub status: String,
    pub requested_at: Option<DateTime<Utc>>,
    pub accepted_at: Option<DateTime<Utc>>,
    pub declined_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct ConnectListsResponse {
    pub incoming: Vec<ConnectListItem>,
    pub outgoing: Vec<ConnectListItem>,
}

#[derive(sqlx::FromRow)]
#[allow(dead_code)]
struct ConnectRow {
    id: Uuid,
    from_user_id: Uuid,
    to_user_id: Uuid,
    connection_type: String,
    status: String,
    requested_at: Option<DateTime<Utc>>,
    accepted_at: Option<DateTime<Utc>>,
    declined_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct ConnectSideRow {
    id: Uuid,
    from_user_id: Uuid,
    to_user_id: Uuid,
    status: String,
    requested_at: Option<DateTime<Utc>>,
    accepted_at: Option<DateTime<Utc>>,
    declined_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    other_email: String,
    other_role: String,
    firm_name: Option<String>,
    company_name: Option<String>,
}

async fn create_connection(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<CreateConnectionBody>,
) -> Result<Json<ConnectionOut>, (StatusCode, String)> {
    let u = require_user(&state, bearer.token()).await?;

    if body.to_user_id == u.id {
        return Err((StatusCode::BAD_REQUEST, "cannot connect to self".to_string()));
    }

    let type_key = body
        .connection_type
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_lowercase);

    if type_key.is_none() || type_key.as_deref() == Some("connect") {
        upsert_connect_request(&state.db, u.id, body.to_user_id)
            .await
            .map_err(internal)?;
        let row = sqlx::query_as::<_, ConnectionOut>(
            r#"
            SELECT id, to_user_id, connection_type, status, created_at
            FROM connections
            WHERE from_user_id = $1 AND to_user_id = $2
            "#,
        )
        .bind(u.id)
        .bind(body.to_user_id)
        .fetch_one(&state.db)
        .await
        .map_err(internal)?;
        return Ok(Json(row));
    }

    let t = type_key.unwrap();
    if !matches!(
        t.as_str(),
        "follow" | "message_request" | "intro_request"
    ) {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid connection_type".to_string(),
        ));
    }

    let status: &str = if t == "follow" { "accepted" } else { "pending" };

    let row = sqlx::query_as::<_, ConnectionOut>(
        r#"
        INSERT INTO connections (from_user_id, to_user_id, connection_type, status)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (from_user_id, to_user_id) DO UPDATE SET
            connection_type = EXCLUDED.connection_type,
            status = EXCLUDED.status
        RETURNING id, to_user_id, connection_type, status, created_at
        "#,
    )
    .bind(u.id)
    .bind(body.to_user_id)
    .bind(&t)
    .bind(status)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(row))
}

async fn list_connect_handshakes(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<ConnectListsResponse>, (StatusCode, String)> {
    let u = require_user(&state, bearer.token()).await?;

    let incoming = load_connect_side(&state.db, u.id, true).await.map_err(internal)?;
    let outgoing = load_connect_side(&state.db, u.id, false).await.map_err(internal)?;

    Ok(Json(ConnectListsResponse { incoming, outgoing }))
}

async fn load_connect_side(
    db: &PgPool,
    user_id: Uuid,
    incoming: bool,
) -> Result<Vec<ConnectListItem>, sqlx::Error> {
    let rows: Vec<ConnectSideRow> = if incoming {
        sqlx::query_as(
            r#"
            SELECT
                c.id, c.from_user_id, c.to_user_id, c.status,
                c.requested_at, c.accepted_at, c.declined_at, c.created_at,
                u.email AS other_email, u.role::text AS other_role,
                ip.firm_name, p.company_name
            FROM connections c
            INNER JOIN users u ON u.id = c.from_user_id
            LEFT JOIN investor_profiles ip ON ip.user_id = u.id
            LEFT JOIN profiles p ON p.user_id = u.id
            WHERE c.to_user_id = $1 AND c.connection_type = 'connect'
            ORDER BY c.created_at DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(db)
        .await?
    } else {
        sqlx::query_as(
            r#"
            SELECT
                c.id, c.from_user_id, c.to_user_id, c.status,
                c.requested_at, c.accepted_at, c.declined_at, c.created_at,
                u.email AS other_email, u.role::text AS other_role,
                ip.firm_name, p.company_name
            FROM connections c
            INNER JOIN users u ON u.id = c.to_user_id
            LEFT JOIN investor_profiles ip ON ip.user_id = u.id
            LEFT JOIN profiles p ON p.user_id = u.id
            WHERE c.from_user_id = $1 AND c.connection_type = 'connect'
            ORDER BY c.created_at DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(db)
        .await?
    };

    Ok(rows
        .into_iter()
        .map(|c| ConnectListItem {
            id: c.id,
            other_user_id: if incoming {
                c.from_user_id
            } else {
                c.to_user_id
            },
            other_email: c.other_email,
            other_role: c.other_role,
            firm_name: c.firm_name,
            company_name: c.company_name,
            status: c.status,
            requested_at: c.requested_at,
            accepted_at: c.accepted_at,
            declined_at: c.declined_at,
            created_at: c.created_at,
        })
        .collect())
}

async fn accept_connection(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(conn_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let u = require_user(&state, bearer.token()).await?;

    let row: Option<ConnectRow> = sqlx::query_as(
        r#"
        SELECT id, from_user_id, to_user_id, connection_type, status,
               requested_at, accepted_at, declined_at, created_at
        FROM connections WHERE id = $1
        "#,
    )
    .bind(conn_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    let c = row.ok_or((StatusCode::NOT_FOUND, "not found".to_string()))?;
    if c.connection_type != "connect" {
        return Err((
            StatusCode::BAD_REQUEST,
            "not a connect handshake".to_string(),
        ));
    }
    if c.to_user_id != u.id {
        return Err((StatusCode::FORBIDDEN, "only recipient can accept".to_string()));
    }
    if c.accepted_at.is_some() {
        return Err((StatusCode::CONFLICT, "already accepted".to_string()));
    }

    let first = try_first_accept_connect(&state.db, c.from_user_id, c.to_user_id)
        .await
        .map_err(internal)?;
    if first {
        send_kevin_warm_email_for_intro_accept(&state, u.id, c.from_user_id).await;
    }

    Ok(Json(serde_json::json!({"ok": true})))
}

async fn decline_or_cancel_connection(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(conn_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let u = require_user(&state, bearer.token()).await?;

    let row: Option<ConnectRow> = sqlx::query_as(
        r#"
        SELECT id, from_user_id, to_user_id, connection_type, status,
               requested_at, accepted_at, declined_at, created_at
        FROM connections WHERE id = $1
        "#,
    )
    .bind(conn_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    let c = row.ok_or((StatusCode::NOT_FOUND, "not found".to_string()))?;
    if c.connection_type != "connect" {
        return Err((
            StatusCode::BAD_REQUEST,
            "not a connect handshake".to_string(),
        ));
    }
    if c.from_user_id != u.id && c.to_user_id != u.id {
        return Err((StatusCode::FORBIDDEN, "forbidden".to_string()));
    }
    if c.accepted_at.is_some() {
        return Err((
            StatusCode::CONFLICT,
            "cannot decline an accepted connection".to_string(),
        ));
    }

    sqlx::query(
        r#"
        UPDATE connections
        SET declined_at = NOW(), status = 'declined'
        WHERE id = $1 AND accepted_at IS NULL
        "#,
    )
    .bind(conn_id)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(serde_json::json!({"ok": true})))
}

async fn list_following_founders(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<FounderPublicDto>>, (StatusCode, String)> {
    let u = require_user(&state, bearer.token()).await?;

    let rows = sqlx::query_as::<_, FounderPublicDto>(
        r#"
        SELECT
            p.user_id,
            p.company_name,
            p.one_liner,
            p.stage,
            p.sector,
            p.country::text AS country,
            CASE WHEN u.is_basic = TRUE OR u.is_pro = TRUE OR p.deck_expires_at IS NULL OR p.deck_expires_at > NOW() THEN p.pitch_deck_url ELSE NULL END AS pitch_deck_url
        FROM connections c
        INNER JOIN profiles p ON p.user_id = c.to_user_id
        INNER JOIN users u ON u.id = p.user_id AND u.role = 'STARTUP'
        WHERE c.from_user_id = $1
          AND c.connection_type = 'follow'
          AND c.status = 'accepted'
        ORDER BY c.created_at DESC
        "#,
    )
    .bind(u.id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(rows))
}

fn internal<E: std::fmt::Debug>(_e: E) -> (StatusCode, String) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "internal error".to_string(),
    )
}
