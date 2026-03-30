use std::sync::Arc;

use axum::{
    extract::State,
    routing::post,
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::auth::Claims;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", post(create_pitch).get(list_pitches))
}

#[derive(Deserialize)]
pub struct CreatePitchRequest {
    pub title: String,
    pub description: Option<String>,
}

#[derive(Serialize)]
pub struct PitchResponse {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
}

async fn create_pitch(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<CreatePitchRequest>,
) -> Result<Json<PitchResponse>, (axum::http::StatusCode, String)> {
    let claims = decode_claims(&state, bearer.token())?;
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| (axum::http::StatusCode::UNAUTHORIZED, "invalid token".to_string()))?;

    let org_id = ensure_user_org(&state.db, user_id)
        .await
        .map_err(internal)?;

    let pitch_id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO pitches (id, organization_id, created_by, title, description)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(pitch_id)
    .bind(org_id)
    .bind(user_id)
    .bind(&body.title)
    .bind(&body.description)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(PitchResponse {
        id: pitch_id,
        title: body.title,
        description: body.description,
    }))
}

async fn list_pitches(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<PitchResponse>>, (axum::http::StatusCode, String)> {
    let claims = decode_claims(&state, bearer.token())?;
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| (axum::http::StatusCode::UNAUTHORIZED, "invalid token".to_string()))?;

    let org_id = ensure_user_org(&state.db, user_id)
        .await
        .map_err(internal)?;

    let rows = sqlx::query(
        r#"
        SELECT id, title, description
        FROM pitches
        WHERE organization_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(org_id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    let items = rows
        .into_iter()
        .map(|r| {
            Ok(PitchResponse {
                id: r.try_get::<Uuid, _>("id").map_err(internal)?,
                title: r.try_get::<String, _>("title").map_err(internal)?,
                description: r
                    .try_get::<Option<String>, _>("description")
                    .map_err(internal)?,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Json(items))
}

fn decode_claims(
    state: &AppState,
    token: &str,
) -> Result<Claims, (axum::http::StatusCode, String)> {
    jsonwebtoken::decode::<Claims>(
        token,
        &state.jwt_decoding,
        &jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256),
    )
    .map(|data| data.claims)
    .map_err(|_| {
        (
            axum::http::StatusCode::UNAUTHORIZED,
            "invalid token".to_string(),
        )
    })
}

async fn ensure_user_org(db: &PgPool, user_id: Uuid) -> Result<Uuid, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT organization_id, email
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_one(db)
    .await?;

    let org_existing: Option<Uuid> = row.try_get::<Option<Uuid>, _>("organization_id")?;
    if let Some(org_id) = org_existing {
        return Ok(org_id);
    }

    let email: String = row.try_get::<String, _>("email")?;
    let org_id = Uuid::new_v4();
    let name = format!("{} org", email);

    sqlx::query(
        r#"
        INSERT INTO organizations (id, name, country_code)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(org_id)
    .bind(&name)
    .bind("US")
    .execute(db)
    .await?;

    sqlx::query(
        r#"
        UPDATE users
        SET organization_id = $1
        WHERE id = $2
        "#,
    )
    .bind(org_id)
    .bind(user_id)
    .execute(db)
    .await?;

    Ok(org_id)
}

fn internal<E>(_err: E) -> (axum::http::StatusCode, String) {
    (
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        "internal error".to_string(),
    )
}

