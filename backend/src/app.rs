use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::{routing::get, Router};
use tower_http::cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};

use crate::routes;
use crate::settings::Settings;
use crate::state::AppState;

pub fn build_app(_settings: &Settings, state: Arc<AppState>) -> Router {
    let cors = CorsLayer::new()
        // Mirrored rather than "*" so the browser may send the refresh cookie;
        // only /auth reads it, and only from our own frontend.
        .allow_origin(AllowOrigin::mirror_request())
        .allow_methods(AllowMethods::mirror_request())
        .allow_headers(AllowHeaders::mirror_request())
        .allow_credentials(true);

    let auth_router = routes::auth::router()
        .merge(routes::oauth::router())
        .layer(axum::middleware::from_fn(crate::session_cookie::middleware));

    Router::new()
        .route("/health", get(health))
        .nest("/auth", auth_router)
        .nest("/compliance", routes::compliance::router())
        .nest("/investments", routes::investments::router())
        .nest("/introductions", routes::introductions::router())
        .nest("/pitches", routes::pitches::router())
        .nest("/pools", routes::pools::router())
        .nest("/profile", routes::profile::router())
        .nest("/founder-extras", routes::founder_extras::router())
        .nest("/startup", routes::matches::router())
        .nest("/investor-profile", routes::investor_profile::router())
        .nest("/investor-pipeline", routes::investor_pipeline::router())
        .nest("/connector-profile", routes::connector_profile::router())
        .nest("/connections", routes::connections::router())
        .nest("/waitlist", routes::waitlist::router())
        .nest("/subscriptions", routes::subscriptions::router())
        .nest("/commerce", routes::commerce::router())
        .nest("/uploads", routes::uploads::router())
        .route("/files/:name", get(routes::uploads::serve_file))
        .nest("/angel-score", routes::angel_score::router())
        .nest("/readiness", routes::readiness::router())
        .merge(routes::mcp::router())
        .merge(routes::mcp_auth::router())
        .nest("/kevin", routes::kevin::router())
        .nest("/kevin-matches", routes::kevin_matches::router())
        .nest("/cron", routes::kevin_learning::router())
        .nest("/api/admin", routes::admin::router())
        .nest("/whatsapp", routes::whatsapp::router())
        .nest("/calls", routes::calls::router())
        .nest("/integrations/notetaker", routes::notetaker_connections::router())
        .nest("/deals", routes::deals::router())
        .nest("/investment-memos", routes::investment_memos::router())
        .nest("/messages", routes::messages::router())
        .nest("/api/founders", routes::weekly_matches::router())
        .nest("/unsubscribe", routes::unsubscribe::router())
        .nest("/internal/email-ignore", routes::email_ignore::router())
        .nest("/ratings", routes::ratings::router())
        .nest("/reviewer-accounts", routes::reviewer_accounts::router())
        .nest("/deck-views", routes::deck_views::router())
        .layer(cors)
        .layer(DefaultBodyLimit::max(55 * 1024 * 1024))
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}
