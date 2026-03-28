use std::sync::Arc;

use axum::{routing::get, Router};

use crate::settings::Settings;
use crate::routes;
use crate::state::AppState;

pub fn build_app(_settings: &Settings, state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .nest("/auth", routes::auth::router())
        .nest("/compliance", routes::compliance::router())
        .nest("/investments", routes::investments::router())
        .nest("/pitches", routes::pitches::router())
        .nest("/pools", routes::pools::router())
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}

