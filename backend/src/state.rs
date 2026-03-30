use std::sync::Arc;
use std::time::Duration;

use jsonwebtoken::{DecodingKey, EncodingKey};
use reqwest::Client;
use sqlx::PgPool;
use std::path::PathBuf;

use crate::settings::{OAuthProviderConfig, Settings};

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub jwt_encoding: EncodingKey,
    pub jwt_decoding: DecodingKey,
    pub upload_dir: PathBuf,
    pub public_base_url: String,
    pub anthropic_api_key: Option<String>,
    pub frontend_url: String,
    pub oauth_google: Option<OAuthProviderConfig>,
    pub oauth_linkedin: Option<OAuthProviderConfig>,
    pub oauth_github: Option<OAuthProviderConfig>,
    pub http_client: Client,
}

impl AppState {
    pub async fn initialise(settings: &Settings) -> Result<Arc<Self>, sqlx::Error> {
        let pool = PgPool::connect(&settings.database_url).await?;

        sqlx::migrate!("./migrations").run(&pool).await?;

        tokio::fs::create_dir_all(&settings.upload_dir)
            .await
            .expect("create BACKEND_UPLOAD_DIR");

        let encoding = EncodingKey::from_secret(settings.jwt_secret.as_bytes());
        let decoding = DecodingKey::from_secret(settings.jwt_secret.as_bytes());

        let http_client = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .expect("reqwest Client");

        Ok(Arc::new(Self {
            db: pool,
            jwt_encoding: encoding,
            jwt_decoding: decoding,
            upload_dir: settings.upload_dir.clone(),
            public_base_url: settings.public_base_url.clone(),
            anthropic_api_key: settings.anthropic_api_key.clone(),
            frontend_url: settings.frontend_url.clone(),
            oauth_google: settings.oauth_google.clone(),
            oauth_linkedin: settings.oauth_linkedin.clone(),
            oauth_github: settings.oauth_github.clone(),
            http_client,
        }))
    }
}
