use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::{routing::get, Router};
use tower_http::cors::{Any, CorsLayer};

use crate::routes;
use crate::settings::Settings;
use crate::state::AppState;

pub fn build_app(_settings: &Settings, state: Arc<AppState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let auth_router = routes::auth::router().merge(routes::oauth::router());

    Router::new()
        .route("/health", get(health))
        .nest("/auth", auth_router)
        .nest("/compliance", routes::compliance::router())
        .nest("/investments", routes::investments::router())
        .nest("/introductions", routes::introductions::router())
        .nest("/pitches", routes::pitches::router())
        .nest("/pools", routes::pools::router())
        .nest("/profile", routes::profile::router())
        .nest("/startup", routes::matches::router())
        .nest("/investor-profile", routes::investor_profile::router())
        .nest("/connector-profile", routes::connector_profile::router())
        .nest("/connections", routes::connections::router())
        .nest("/subscriptions", routes::subscriptions::router())
        .nest("/commerce", routes::commerce::router())
        .nest("/uploads", routes::uploads::router())
        .route("/files/:name", get(routes::uploads::serve_file))
        .nest("/kevin", routes::kevin::router())
        .nest("/calls", routes::calls::router())
        .nest("/deals", routes::deals::router())
        .layer(cors)
        .layer(DefaultBodyLimit::max(55 * 1024 * 1024))
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}
