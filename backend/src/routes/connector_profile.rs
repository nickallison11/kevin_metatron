use std::sync::Arc;

use axum::{
    extract::{Path, State},
    routing::{get, post, put},
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::identity::{require_role, require_user, AuthedUser};
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(get_own).put(put_own))
        .route("/all", get(list_all))
        .route("/introductions", get(list_brokered_introductions))
        .route("/referrals", get(list_referrals))
        .route("/network/batch", post(batch_import_network))
        .route("/network/csv", post(import_network_csv))
        .route("/network", get(list_network).post(add_network_contact))
        .route(
            "/network/{id}",
            put(update_network_contact).delete(delete_network_contact),
        )
        .route("/network/stage", post(stage_contacts))
        .route("/network/staging/enrich", post(enrich_staged_contacts))
        .route("/network/staging/import", post(import_from_staging))
        .route("/network/staging", get(list_staging).delete(clear_staging))
        .route(
            "/network/staging/{id}",
            put(update_staged_contact).delete(delete_staged_contact),
        )
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ConnectorProfileDto {
    pub organisation: Option<String>,
    pub bio: Option<String>,
    pub speciality: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ConnectorPublicDto {
    pub user_id: Uuid,
    pub organisation: Option<String>,
    pub bio: Option<String>,
    pub speciality: Option<String>,
    pub country: Option<String>,
}

#[derive(sqlx::FromRow)]
struct ConnectorRow {
    organisation: Option<String>,
    bio: Option<String>,
    speciality: Option<String>,
    country: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct BrokeredIntroduction {
    pub id: Uuid,
    pub startup_user_id: Uuid,
    pub investor_user_id: Uuid,
    pub status: String,
    pub founder_company: Option<String>,
    pub investor_firm: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ReferralRow {
    pub id: Uuid,
    pub email: Option<String>,
    pub referred_user_id: Option<Uuid>,
    pub status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NetworkContactDto {
    pub role: String,
    pub name: String,
    pub email: Option<String>,
    pub firm_or_company: Option<String>,
    pub linkedin_url: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct NetworkContactRow {
    pub id: Uuid,
    pub role: String,
    pub name: String,
    pub email: Option<String>,
    pub firm_or_company: Option<String>,
    pub linkedin_url: Option<String>,
    pub notes: Option<String>,
    pub invited_at: Option<chrono::DateTime<chrono::Utc>>,
    pub joined_user_id: Option<Uuid>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StagedContactDto {
    pub role: String,
    pub name: String,
    pub firm_or_company: Option<String>,
    pub raw_notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StageBody {
    pub contacts: Vec<StagedContactDto>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct StagedContactRow {
    pub id: Uuid,
    pub role: String,
    pub name: String,
    pub firm_or_company: Option<String>,
    pub raw_notes: Option<String>,
    pub contact_name: Option<String>,
    pub email: Option<String>,
    pub linkedin_url: Option<String>,
    pub website: Option<String>,
    pub sector_focus: Option<String>,
    pub stage_focus: Option<String>,
    pub ticket_size: Option<String>,
    pub geography: Option<String>,
    pub one_liner: Option<String>,
    pub status: String,
    pub enrichment_error: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub enriched_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Deserialize, Default, Serialize)]
struct EnrichmentData {
    website: Option<String>,
    contact_name: Option<String>,
    email: Option<String>,
    linkedin_url: Option<String>,
    sector_focus: Option<String>,
    stage_focus: Option<String>,
    ticket_size: Option<String>,
    geography: Option<String>,
    one_liner: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EnrichBody {
    pub ids: Option<Vec<Uuid>>,
    pub role: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ImportStagingBody {
    pub ids: Option<Vec<Uuid>>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateStagedDto {
    pub contact_name: Option<String>,
    pub email: Option<String>,
    pub linkedin_url: Option<String>,
    pub website: Option<String>,
    pub sector_focus: Option<String>,
    pub stage_focus: Option<String>,
    pub ticket_size: Option<String>,
    pub geography: Option<String>,
    pub one_liner: Option<String>,
}

async fn fetch_dto(
    state: &AppState,
    user_id: Uuid,
) -> Result<ConnectorProfileDto, (axum::http::StatusCode, String)> {
    let row = sqlx::query_as::<_, ConnectorRow>(
        r#"SELECT organisation, bio, speciality, country
             FROM connector_profiles WHERE user_id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    Ok(row
        .map(|r| ConnectorProfileDto {
            organisation: r.organisation,
            bio: r.bio,
            speciality: r.speciality,
            country: r.country,
        })
        .unwrap_or_default())
}

async fn get_own(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<ConnectorProfileDto>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;
    Ok(Json(fetch_dto(&state, id).await?))
}

async fn put_own(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<ConnectorProfileDto>,
) -> Result<Json<ConnectorProfileDto>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;

    let country = body.country.as_ref().and_then(|c| {
        let s: String = c
            .chars()
            .filter(|ch| ch.is_ascii_alphabetic())
            .take(2)
            .collect();
        if s.len() == 2 {
            Some(s.to_uppercase())
        } else {
            None
        }
    });

    sqlx::query(
        r#"INSERT INTO connector_profiles (user_id, organisation, bio, speciality, country)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_id) DO UPDATE SET
                 organisation = EXCLUDED.organisation, bio = EXCLUDED.bio,
                 speciality = EXCLUDED.speciality, country = EXCLUDED.country,
                 updated_at = now()"#,
    )
    .bind(id)
    .bind(&body.organisation)
    .bind(&body.bio)
    .bind(&body.speciality)
    .bind(&country)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(fetch_dto(&state, id).await?))
}

async fn list_all(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<ConnectorPublicDto>>, (axum::http::StatusCode, String)> {
    let _u = require_user(&state, bearer.token()).await?;
    let rows = sqlx::query_as::<_, ConnectorPublicDto>(
        r#"SELECT u.id AS user_id, cp.organisation, cp.bio, cp.speciality, cp.country
             FROM users u INNER JOIN connector_profiles cp ON cp.user_id = u.id
             WHERE u.role = 'INTERMEDIARY'
             ORDER BY cp.updated_at DESC NULLS LAST, cp.created_at DESC"#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;
    Ok(Json(rows))
}

async fn list_brokered_introductions(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<BrokeredIntroduction>>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;
    let rows = sqlx::query_as::<_, BrokeredIntroduction>(
        r#"SELECT i.id, i.startup_user_id, i.investor_user_id, i.status,
                    sf.company_name AS founder_company, inv.firm_name AS investor_firm, i.created_at
             FROM introductions i
             LEFT JOIN profiles sf ON sf.user_id = i.startup_user_id
             LEFT JOIN investor_profiles inv ON inv.user_id = i.investor_user_id
             WHERE i.broker_user_id = $1 ORDER BY i.created_at DESC"#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;
    Ok(Json(rows))
}

async fn list_referrals(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<ReferralRow>>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;
    let rows = sqlx::query_as::<_, ReferralRow>(
        "SELECT id, email, referred_user_id, status, created_at FROM referrals WHERE referrer_user_id = $1 ORDER BY created_at DESC",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;
    Ok(Json(rows))
}

async fn list_network(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<NetworkContactRow>>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;
    let rows = sqlx::query_as::<_, NetworkContactRow>(
        r#"SELECT id, role, name, email, firm_or_company, linkedin_url, notes,
                    invited_at, joined_user_id, created_at
             FROM connector_network_contacts WHERE connector_user_id = $1 ORDER BY created_at DESC"#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;
    Ok(Json(rows))
}

async fn add_network_contact(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<NetworkContactDto>,
) -> Result<Json<NetworkContactRow>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;
    if body.name.trim().is_empty() {
        return Err((axum::http::StatusCode::BAD_REQUEST, "name is required".into()));
    }
    if body.role != "investor" && body.role != "founder" {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            "role must be investor or founder".into(),
        ));
    }
    let joined_user_id: Option<Uuid> = if let Some(ref email) = body.email {
        sqlx::query_scalar("SELECT id FROM users WHERE LOWER(email) = LOWER($1)")
            .bind(email)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None)
    } else {
        None
    };
    let row = sqlx::query_as::<_, NetworkContactRow>(
        r#"INSERT INTO connector_network_contacts
                 (connector_user_id, role, name, email, firm_or_company, linkedin_url, notes, joined_user_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING id, role, name, email, firm_or_company, linkedin_url, notes,
                       invited_at, joined_user_id, created_at"#,
    )
    .bind(id)
    .bind(&body.role)
    .bind(body.name.trim())
    .bind(&body.email)
    .bind(&body.firm_or_company)
    .bind(&body.linkedin_url)
    .bind(&body.notes)
    .bind(joined_user_id)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;
    Ok(Json(row))
}

async fn update_network_contact(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(contact_id): Path<Uuid>,
    Json(body): Json<NetworkContactDto>,
) -> Result<Json<NetworkContactRow>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;
    if body.name.trim().is_empty() {
        return Err((axum::http::StatusCode::BAD_REQUEST, "name is required".into()));
    }
    if body.role != "investor" && body.role != "founder" {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            "role must be investor or founder".into(),
        ));
    }
    let joined_user_id: Option<Uuid> = if let Some(ref email) = body.email {
        sqlx::query_scalar("SELECT id FROM users WHERE LOWER(email) = LOWER($1)")
            .bind(email)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None)
    } else {
        None
    };
    let row = sqlx::query_as::<_, NetworkContactRow>(
        r#"UPDATE connector_network_contacts
             SET role=$1, name=$2, email=$3, firm_or_company=$4, linkedin_url=$5, notes=$6, joined_user_id=$7
             WHERE id=$8 AND connector_user_id=$9
             RETURNING id, role, name, email, firm_or_company, linkedin_url, notes,
                       invited_at, joined_user_id, created_at"#,
    )
    .bind(&body.role)
    .bind(body.name.trim())
    .bind(&body.email)
    .bind(&body.firm_or_company)
    .bind(&body.linkedin_url)
    .bind(&body.notes)
    .bind(joined_user_id)
    .bind(contact_id)
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?
    .ok_or((axum::http::StatusCode::NOT_FOUND, "contact not found".into()))?;
    Ok(Json(row))
}

async fn delete_network_contact(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(contact_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;
    sqlx::query("DELETE FROM connector_network_contacts WHERE id=$1 AND connector_user_id=$2")
        .bind(contact_id)
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(internal)?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct CsvImportBody {
    pub csv: String,
}

async fn import_network_csv(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<CsvImportBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;
    let (mut imported, mut skipped) = (0u32, 0u32);
    for line in body.csv.lines().skip(1) {
        let cols: Vec<&str> = line.splitn(6, ',').collect();
        if cols.len() < 2 {
            skipped += 1;
            continue;
        }
        let role = cols[0].trim().to_lowercase();
        if role != "investor" && role != "founder" {
            skipped += 1;
            continue;
        }
        let name = cols[1].trim();
        if name.is_empty() {
            skipped += 1;
            continue;
        }
        let email = cols.get(2).map(|s| s.trim()).filter(|s| !s.is_empty());
        let firm = cols.get(3).map(|s| s.trim()).filter(|s| !s.is_empty());
        let linkedin = cols.get(4).map(|s| s.trim()).filter(|s| !s.is_empty());
        let notes = cols.get(5).map(|s| s.trim()).filter(|s| !s.is_empty());
        let joined: Option<Uuid> = if let Some(e) = email {
            sqlx::query_scalar("SELECT id FROM users WHERE LOWER(email)=LOWER($1)")
                .bind(e)
                .fetch_optional(&state.db)
                .await
                .unwrap_or(None)
        } else {
            None
        };
        let res = sqlx::query(
            r#"INSERT INTO connector_network_contacts
                     (connector_user_id, role, name, email, firm_or_company, linkedin_url, notes, joined_user_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING"#,
        )
        .bind(id)
        .bind(&role)
        .bind(name)
        .bind(email)
        .bind(firm)
        .bind(linkedin)
        .bind(notes)
        .bind(joined)
        .execute(&state.db)
        .await;
        if res.is_ok() {
            imported += 1;
        } else {
            skipped += 1;
        }
    }
    Ok(Json(serde_json::json!({ "imported": imported, "skipped": skipped })))
}

#[derive(Deserialize)]
pub struct BatchImportBody {
    pub contacts: Vec<NetworkContactDto>,
}

async fn batch_import_network(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<BatchImportBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;
    let (mut imported, mut skipped) = (0u32, 0u32);
    for contact in body.contacts {
        if contact.name.trim().is_empty()
            || (contact.role != "investor" && contact.role != "founder")
        {
            skipped += 1;
            continue;
        }
        let joined: Option<Uuid> = if let Some(ref email) = contact.email {
            sqlx::query_scalar("SELECT id FROM users WHERE LOWER(email)=LOWER($1)")
                .bind(email)
                .fetch_optional(&state.db)
                .await
                .unwrap_or(None)
        } else {
            None
        };
        let res = sqlx::query(
            r#"INSERT INTO connector_network_contacts
                     (connector_user_id, role, name, email, firm_or_company, linkedin_url, notes, joined_user_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING"#,
        )
        .bind(id)
        .bind(&contact.role)
        .bind(contact.name.trim())
        .bind(&contact.email)
        .bind(&contact.firm_or_company)
        .bind(&contact.linkedin_url)
        .bind(&contact.notes)
        .bind(joined)
        .execute(&state.db)
        .await;
        if res.is_ok() {
            imported += 1;
        } else {
            skipped += 1;
        }
    }
    Ok(Json(serde_json::json!({ "imported": imported, "skipped": skipped })))
}

async fn stage_contacts(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<StageBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;
    let mut staged = 0u32;
    for c in body.contacts {
        if c.name.trim().is_empty() || (c.role != "investor" && c.role != "founder") {
            continue;
        }
        let res = sqlx::query(
            r#"INSERT INTO connector_network_staging
                     (connector_user_id, role, name, firm_or_company, raw_notes)
                 VALUES ($1,$2,$3,$4,$5)"#,
        )
        .bind(id)
        .bind(&c.role)
        .bind(c.name.trim())
        .bind(&c.firm_or_company)
        .bind(&c.raw_notes)
        .execute(&state.db)
        .await;
        if res.is_ok() {
            staged += 1;
        }
    }
    Ok(Json(serde_json::json!({ "staged": staged })))
}

async fn list_staging(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<StagedContactRow>>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;
    let rows = sqlx::query_as::<_, StagedContactRow>(
        r#"SELECT id, role, name, firm_or_company, raw_notes, contact_name, email, linkedin_url,
                    website, sector_focus, stage_focus, ticket_size, geography, one_liner,
                    status, enrichment_error, created_at, enriched_at
             FROM connector_network_staging
             WHERE connector_user_id = $1
             ORDER BY created_at DESC"#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;
    Ok(Json(rows))
}

async fn clear_staging(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;
    let result = sqlx::query("DELETE FROM connector_network_staging WHERE connector_user_id=$1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(internal)?;
    Ok(Json(serde_json::json!({ "deleted": result.rows_affected() })))
}

async fn delete_staged_contact(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(staging_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;
    sqlx::query("DELETE FROM connector_network_staging WHERE id=$1 AND connector_user_id=$2")
        .bind(staging_id)
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(internal)?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn update_staged_contact(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(staging_id): Path<Uuid>,
    Json(body): Json<UpdateStagedDto>,
) -> Result<Json<StagedContactRow>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;
    let row = sqlx::query_as::<_, StagedContactRow>(
        r#"UPDATE connector_network_staging SET
                 contact_name=$1, email=$2, linkedin_url=$3, website=$4,
                 sector_focus=$5, stage_focus=$6, ticket_size=$7, geography=$8, one_liner=$9,
                 status = CASE WHEN status = 'pending' THEN 'enriched' ELSE status END
             WHERE id=$10 AND connector_user_id=$11
             RETURNING id, role, name, firm_or_company, raw_notes, contact_name, email, linkedin_url,
                       website, sector_focus, stage_focus, ticket_size, geography, one_liner,
                       status, enrichment_error, created_at, enriched_at"#,
    )
    .bind(&body.contact_name)
    .bind(&body.email)
    .bind(&body.linkedin_url)
    .bind(&body.website)
    .bind(&body.sector_focus)
    .bind(&body.stage_focus)
    .bind(&body.ticket_size)
    .bind(&body.geography)
    .bind(&body.one_liner)
    .bind(staging_id)
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?
    .ok_or((axum::http::StatusCode::NOT_FOUND, "not found".into()))?;
    Ok(Json(row))
}

fn staging_select_cols() -> &'static str {
    r#"id, role, name, firm_or_company, raw_notes, contact_name, email, linkedin_url,
        website, sector_focus, stage_focus, ticket_size, geography, one_liner,
        status, enrichment_error, created_at, enriched_at"#
}

async fn enrich_staged_contacts(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<EnrichBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let AuthedUser { id: user_id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;

    let anthropic_key = std::env::var("ANTHROPIC_API_KEY").map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "ANTHROPIC_API_KEY not set".to_string(),
        )
    })?;

    let rows: Vec<StagedContactRow> = if let Some(ids) = &body.ids {
        if ids.is_empty() {
            return Ok(Json(serde_json::json!({ "enriching": 0 })));
        }
        let id_list = ids
            .iter()
            .map(|u| format!("'{u}'"))
            .collect::<Vec<_>>()
            .join(",");
        let q = format!(
            r#"SELECT {}
             FROM connector_network_staging
             WHERE connector_user_id=$1 AND id IN ({}) AND status IN ('pending','failed')"#,
            staging_select_cols(),
            id_list
        );
        sqlx::query_as::<_, StagedContactRow>(&q)
            .bind(user_id)
            .fetch_all(&state.db)
            .await
            .map_err(internal)?
    } else {
        let role_filter = body.role.as_deref().unwrap_or("%");
        sqlx::query_as::<_, StagedContactRow>(&format!(
            r#"SELECT {}
                 FROM connector_network_staging
                 WHERE connector_user_id=$1 AND status IN ('pending','failed') AND role LIKE $2
                 LIMIT 100"#,
            staging_select_cols()
        ))
        .bind(user_id)
        .bind(role_filter)
        .fetch_all(&state.db)
        .await
        .map_err(internal)?
    };

    let count = rows.len();

    for row in &rows {
        let _ = sqlx::query("UPDATE connector_network_staging SET status='enriching' WHERE id=$1")
            .bind(row.id)
            .execute(&state.db)
            .await;
    }

    let pool = state.db.clone();
    let key = anthropic_key.clone();
    tokio::spawn(async move {
        let sem = Arc::new(Semaphore::new(5));
        let mut handles = vec![];
        for row in rows {
            let pool = pool.clone();
            let key = key.clone();
            let sem = sem.clone();
            handles.push(tokio::spawn(async move {
                let _permit = sem.acquire().await.unwrap();
                enrich_one_contact(
                    &pool,
                    row.id,
                    &row.role,
                    &row.name,
                    row.raw_notes.as_deref(),
                    &key,
                )
                .await;
            }));
        }
        for h in handles {
            let _ = h.await;
        }
    });

    Ok(Json(serde_json::json!({ "enriching": count })))
}

async fn import_from_staging(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<ImportStagingBody>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let AuthedUser { id: user_id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;

    let rows: Vec<StagedContactRow> = if let Some(ids) = &body.ids {
        if ids.is_empty() {
            return Ok(Json(serde_json::json!({ "imported": 0u32 })));
        }
        let id_list = ids
            .iter()
            .map(|u| format!("'{u}'"))
            .collect::<Vec<_>>()
            .join(",");
        let q = format!(
            r#"SELECT {}
 FROM connector_network_staging
                 WHERE connector_user_id=$1 AND id IN ({})"#,
            staging_select_cols(),
            id_list
        );
        sqlx::query_as::<_, StagedContactRow>(&q)
            .bind(user_id)
            .fetch_all(&state.db)
            .await
            .map_err(internal)?
    } else {
        sqlx::query_as::<_, StagedContactRow>(&format!(
            r#"SELECT {}
                 FROM connector_network_staging
                 WHERE connector_user_id=$1 AND status = 'enriched'"#,
            staging_select_cols()
        ))
        .bind(user_id)
        .fetch_all(&state.db)
        .await
        .map_err(internal)?
    };

    let mut imported = 0u32;
    for row in &rows {
        let mut notes_parts: Vec<String> = vec![];
        if let Some(ref s) = row.sector_focus {
            notes_parts.push(format!("Sector: {}", s));
        }
        if let Some(ref s) = row.stage_focus {
            notes_parts.push(format!("Stage: {}", s));
        }
        if let Some(ref s) = row.ticket_size {
            notes_parts.push(format!("Ticket: {}", s));
        }
        if let Some(ref s) = row.geography {
            notes_parts.push(format!("Geography: {}", s));
        }
        if let Some(ref s) = row.one_liner {
            notes_parts.push(s.clone());
        }
        if let Some(ref s) = row.raw_notes {
            notes_parts.push(s.clone());
        }
        let notes = if notes_parts.is_empty() {
            None
        } else {
            Some(notes_parts.join(" | "))
        };

        let name = row
            .contact_name
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(&row.name);
        let firm: Option<&str> = row
            .firm_or_company
            .as_deref()
            .filter(|s| !s.is_empty())
            .or(Some(name));

        let res = sqlx::query(
            r#"INSERT INTO connector_network_contacts
                     (connector_user_id, role, name, email, firm_or_company, linkedin_url, notes)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT DO NOTHING"#,
        )
        .bind(user_id)
        .bind(&row.role)
        .bind(name)
        .bind(&row.email)
        .bind(firm)
        .bind(&row.linkedin_url)
        .bind(&notes)
        .execute(&state.db)
        .await;

        if res.is_ok() {
            imported += 1;
            let _ = sqlx::query("DELETE FROM connector_network_staging WHERE id=$1")
                .bind(row.id)
                .execute(&state.db)
                .await;
        }
    }

    Ok(Json(serde_json::json!({ "imported": imported })))
}

async fn enrich_one_contact(
    pool: &sqlx::PgPool,
    id: Uuid,
    role: &str,
    name: &str,
    notes: Option<&str>,
    anthropic_key: &str,
) {
    let context = notes
        .map(|n| format!("\nContext from spreadsheet: {}", n))
        .unwrap_or_default();

    let prompt = if role == "investor" {
        format!(
            r#"Find information about this investment firm or investor: "{}"{}\n\nSearch the web and return ONLY a JSON object (no other text):\n{{\n  "website": null,\n  "contact_name": null,\n  "email": null,\n  "linkedin_url": null,\n  "sector_focus": null,\n  "stage_focus": null,\n  "ticket_size": null,\n  "geography": null,\n  "one_liner": null\n}}\n\nFill in:\n- website: their website URL\n- contact_name: primary partner/contact name\n- email: contact email if publicly listed\n- linkedin_url: LinkedIn URL\n- sector_focus: sectors they invest in e.g. "Fintech, Healthtech"\n- stage_focus: e.g. "Pre-seed, Seed, Series A"\n- ticket_size: typical check size e.g. "$50k-$500k"\n- geography: geographic focus e.g. "Sub-Saharan Africa"\n- one_liner: one sentence investment thesis"#,
            name, context
        )
    } else {
        format!(
            r#"Find information about this startup: "{}"{}\n\nSearch the web and return ONLY a JSON object (no other text):\n{{\n  "website": null,\n  "contact_name": null,\n  "email": null,\n  "linkedin_url": null,\n  "sector_focus": null,\n  "stage_focus": null,\n  "ticket_size": null,\n  "geography": null,\n  "one_liner": null\n}}\n\nFill in:\n- website: company website\n- contact_name: founder name\n- email: founder/company email if public\n- linkedin_url: founder LinkedIn\n- sector_focus: industry e.g. "Fintech"\n- stage_focus: funding stage e.g. "Seed"\n- ticket_size: total raised e.g. "$2M"\n- geography: HQ location e.g. "Lagos, Nigeria"\n- one_liner: one sentence description of what they do"#,
            name, context
        )
    };

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", anthropic_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": "claude-sonnet-4-6",
            "max_tokens": 1024,
            "tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}],
            "messages": [{"role": "user", "content": prompt}]
        }))
        .send()
        .await;

    let enrichment = match resp {
        Ok(r) => match r.json::<serde_json::Value>().await {
            Ok(body) => {
                let text = body["content"]
                    .as_array()
                    .and_then(|arr| {
                        arr.iter()
                            .find(|b| b["type"] == "text")
                            .and_then(|b| b["text"].as_str())
                    })
                    .unwrap_or("");

                let start = text.find('{');
                let end = text.rfind('}');
                match (start, end) {
                    (Some(s), Some(e)) if e >= s => {
                        serde_json::from_str::<EnrichmentData>(&text[s..=e]).unwrap_or_default()
                    }
                    _ => {
                        let _ = sqlx::query(
                            "UPDATE connector_network_staging SET status='failed', enrichment_error=$1 WHERE id=$2",
                        )
                        .bind("Could not parse enrichment response")
                        .bind(id)
                        .execute(pool)
                        .await;
                        return;
                    }
                }
            }
            Err(e) => {
                let _ = sqlx::query(
                    "UPDATE connector_network_staging SET status='failed', enrichment_error=$1 WHERE id=$2",
                )
                .bind(e.to_string())
                .bind(id)
                .execute(pool)
                .await;
                return;
            }
        },
        Err(e) => {
            let _ = sqlx::query(
                "UPDATE connector_network_staging SET status='failed', enrichment_error=$1 WHERE id=$2",
            )
            .bind(e.to_string())
            .bind(id)
            .execute(pool)
            .await;
            return;
        }
    };

    let _ = sqlx::query(
        r#"UPDATE connector_network_staging SET
                 status='enriched', enriched_at=now(),
                 contact_name=$2, email=$3, linkedin_url=$4, website=$5,
                 sector_focus=$6, stage_focus=$7, ticket_size=$8, geography=$9, one_liner=$10
             WHERE id=$1"#,
    )
    .bind(id)
    .bind(enrichment.contact_name)
    .bind(enrichment.email)
    .bind(enrichment.linkedin_url)
    .bind(enrichment.website)
    .bind(enrichment.sector_focus)
    .bind(enrichment.stage_focus)
    .bind(enrichment.ticket_size)
    .bind(enrichment.geography)
    .bind(enrichment.one_liner)
    .execute(pool)
    .await;
}

fn internal<E: std::fmt::Debug>(_e: E) -> (axum::http::StatusCode, String) {
    (
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        "internal error".to_string(),
    )
}
