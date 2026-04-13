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
use uuid::Uuid;

use crate::identity::{require_role, require_user, AuthedUser};
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(get_own).put(put_own))
        .route("/all", get(list_all))
        .route("/introductions", get(list_brokered_introductions))
        .route("/referrals", get(list_referrals))
        .route("/network/csv", post(import_network_csv))
        .route("/network", get(list_network).post(add_network_contact))
        .route(
            "/network/{id}",
            put(update_network_contact).delete(delete_network_contact),
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

async fn fetch_dto(
    state: &AppState,
    user_id: Uuid,
) -> Result<ConnectorProfileDto, (axum::http::StatusCode, String)> {
    let row = sqlx::query_as::<_, ConnectorRow>(
        r#"
        SELECT organisation, bio, speciality, country
        FROM connector_profiles WHERE user_id = $1
        "#,
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
        r#"
        INSERT INTO connector_profiles (user_id, organisation, bio, speciality, country)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id) DO UPDATE SET
            organisation = EXCLUDED.organisation,
            bio = EXCLUDED.bio,
            speciality = EXCLUDED.speciality,
            country = EXCLUDED.country,
            updated_at = now()
        "#,
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
    let sql = r#"
        SELECT
            u.id AS user_id,
            cp.organisation,
            cp.bio,
            cp.speciality,
            cp.country
        FROM users u
        INNER JOIN connector_profiles cp ON cp.user_id = u.id
        WHERE u.role = 'INTERMEDIARY'
        ORDER BY cp.updated_at DESC NULLS LAST, cp.created_at DESC
        "#;

    let rows = sqlx::query_as::<_, ConnectorPublicDto>(sql)
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
        r#"
        SELECT
            i.id,
            i.startup_user_id,
            i.investor_user_id,
            i.status,
            sf.company_name AS founder_company,
            inv.firm_name AS investor_firm,
            i.created_at
        FROM introductions i
        LEFT JOIN profiles sf ON sf.user_id = i.startup_user_id
        LEFT JOIN investor_profiles inv ON inv.user_id = i.investor_user_id
        WHERE i.broker_user_id = $1
        ORDER BY i.created_at DESC
        "#,
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
        r#"
        SELECT id, email, referred_user_id, status, created_at
        FROM referrals
        WHERE referrer_user_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(rows))
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

async fn list_network(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<NetworkContactRow>>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;

    let rows = sqlx::query_as::<_, NetworkContactRow>(
        r#"
        SELECT id, role, name, email, firm_or_company, linkedin_url, notes,
               invited_at, joined_user_id, created_at
        FROM connector_network_contacts
        WHERE connector_user_id = $1
        ORDER BY created_at DESC
        "#,
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
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            "name is required".to_string(),
        ));
    }
    if body.role != "investor" && body.role != "founder" {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            "role must be investor or founder".to_string(),
        ));
    }

    let joined_user_id: Option<Uuid> = if let Some(ref email) = body.email {
        sqlx::query_scalar("SELECT id FROM users WHERE LOWER(email) = LOWER($1)")
            .bind(email)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?
    } else {
        None
    };

    let row = sqlx::query_as::<_, NetworkContactRow>(
        r#"
        INSERT INTO connector_network_contacts
            (connector_user_id, role, name, email, firm_or_company, linkedin_url, notes, joined_user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, role, name, email, firm_or_company, linkedin_url, notes,
                  invited_at, joined_user_id, created_at
        "#,
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
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            "name is required".to_string(),
        ));
    }
    if body.role != "investor" && body.role != "founder" {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            "role must be investor or founder".to_string(),
        ));
    }

    let joined_user_id: Option<Uuid> = if let Some(ref email) = body.email {
        sqlx::query_scalar("SELECT id FROM users WHERE LOWER(email) = LOWER($1)")
            .bind(email)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?
    } else {
        None
    };

    let row = sqlx::query_as::<_, NetworkContactRow>(
        r#"
        UPDATE connector_network_contacts
        SET role = $1,
            name = $2,
            email = $3,
            firm_or_company = $4,
            linkedin_url = $5,
            notes = $6,
            joined_user_id = $7
        WHERE id = $8 AND connector_user_id = $9
        RETURNING id, role, name, email, firm_or_company, linkedin_url, notes,
                  invited_at, joined_user_id, created_at
        "#,
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
    .map_err(internal)?;

    let row = row.ok_or((
        axum::http::StatusCode::NOT_FOUND,
        "contact not found".to_string(),
    ))?;

    Ok(Json(row))
}

async fn delete_network_contact(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(contact_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;

    sqlx::query(
        "DELETE FROM connector_network_contacts WHERE id = $1 AND connector_user_id = $2",
    )
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

    let mut imported = 0u32;
    let mut skipped = 0u32;

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
        let email: Option<&str> = cols
            .get(2)
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        let firm: Option<&str> = cols
            .get(3)
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        let linkedin: Option<&str> = cols
            .get(4)
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        let notes: Option<&str> = cols
            .get(5)
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());

        let joined_user_id: Option<Uuid> = if let Some(e) = email {
            sqlx::query_scalar("SELECT id FROM users WHERE LOWER(email) = LOWER($1)")
                .bind(e)
                .fetch_optional(&state.db)
                .await
                .unwrap_or(None)
        } else {
            None
        };

        let res = sqlx::query(
            r#"
            INSERT INTO connector_network_contacts
                (connector_user_id, role, name, email, firm_or_company, linkedin_url, notes, joined_user_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(id)
        .bind(&role)
        .bind(name)
        .bind(email)
        .bind(firm)
        .bind(linkedin)
        .bind(notes)
        .bind(joined_user_id)
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

fn internal<E: std::fmt::Debug>(_e: E) -> (axum::http::StatusCode, String) {
    (
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        "internal error".to_string(),
    )
}
