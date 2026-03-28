use std::sync::Arc;

use jsonwebtoken::{DecodingKey, EncodingKey};
use sqlx::PgPool;

use crate::settings::Settings;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub jwt_encoding: EncodingKey,
    pub jwt_decoding: DecodingKey,
}

impl AppState {
    pub async fn initialise(settings: &Settings) -> Result<Arc<Self>, sqlx::Error> {
        let pool = PgPool::connect(&settings.database_url).await?;

        sqlx::migrate!("./migrations").run(&pool).await?;

        let encoding = EncodingKey::from_secret(settings.jwt_secret.as_bytes());
        let decoding = DecodingKey::from_secret(settings.jwt_secret.as_bytes());

        Ok(Arc::new(Self {
            db: pool,
            jwt_encoding: encoding,
            jwt_decoding: decoding,
        }))
    }
}

