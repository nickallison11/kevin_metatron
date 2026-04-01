use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod app;
mod auth;
mod ai;
mod cleanup;
mod compliance;
mod crypto;
mod identity;
mod memory;
mod routes;
mod settings;
mod state;

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "backend=debug,axum=info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let settings = settings::Settings::from_env().expect("valid settings");
    let shared_state = state::AppState::initialise(&settings)
        .await
        .expect("state init");

    let app = app::build_app(&settings, shared_state.clone());
    cleanup::start_cleanup_task(shared_state.db.clone());

    let port = settings.port;
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind listen address");
    tracing::info!("listening on {}", addr);
    axum::serve(listener, app).await.expect("server error");
}
