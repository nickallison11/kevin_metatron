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
use uuid::Uuid;

use crate::identity::require_role;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/", post(create_introduction))
}

#[derive(Deserialize)]
pub struct CreateIntroductionBody {
    pub investor_user_id: Uuid,
    pub note: Option<String>,
}

#[derive(Serialize)]
pub struct IntroductionResponse {
    pub id: Uuid,
    pub status: String,
}

async fn create_introduction(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<CreateIntroductionBody>,
) -> Result<Json<IntroductionResponse>, (axum::http::StatusCode, String)> {
    let authed =
        require_role(&state, bearer.token(), &["STARTUP"]).await?;

    let ok: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
          SELECT 1 FROM users u
          WHERE u.id = $1 AND u.role = 'INVESTOR'
        )
        "#,
    )
    .bind(body.investor_user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "internal error".to_string(),
        )
    })?;

    if !ok {
        return Err((
            axum::http::StatusCode::NOT_FOUND,
            "investor not found".to_string(),
        ));
    }

    let intro_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO introductions (id, investor_user_id, startup_user_id, status, note)
        VALUES ($1, $2, $3, 'PENDING', $4)
        "#,
    )
    .bind(intro_id)
    .bind(body.investor_user_id)
    .bind(authed.id)
    .bind(&body.note)
    .execute(&state.db)
    .await
    .map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "internal error".to_string(),
        )
    })?;

    Ok(Json(IntroductionResponse {
        id: intro_id,
        status: "PENDING".to_string(),
    }))
}
