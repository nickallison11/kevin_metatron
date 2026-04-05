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
    pub encryption_key: [u8; 32],
    pub upload_dir: PathBuf,
    pub public_base_url: String,
    pub ai_api_key: Option<String>,
    pub anthropic_api_key: Option<String>,
    pub frontend_url: String,
    pub oauth_google: Option<OAuthProviderConfig>,
    pub oauth_linkedin: Option<OAuthProviderConfig>,
    pub oauth_github: Option<OAuthProviderConfig>,
    pub telegram_bot_secret: Option<String>,
    pub pinata_jwt: Option<String>,
    pub pinata_gateway: Option<String>,
    pub solana_rpc_url: String,
    pub solana_treasury: String,
    pub usdc_mint: String,
    pub usdt_mint: String,
    pub whisper_url: String,
    pub resend_api_key: Option<String>,
    pub email_from: String,
    pub paystack_secret_key: Option<String>,
    pub paystack_currency: String,
    pub paystack_plan_basic_monthly: String,
    pub paystack_plan_basic_annual: String,
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
        let encryption_key = decode_hex_32(&settings.encryption_key)
            .expect("BACKEND_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");

        let http_client = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .expect("reqwest Client");

        Ok(Arc::new(Self {
            db: pool,
            jwt_encoding: encoding,
            jwt_decoding: decoding,
            encryption_key,
            upload_dir: settings.upload_dir.clone(),
            public_base_url: settings.public_base_url.clone(),
            ai_api_key: settings.ai_api_key.clone(),
            anthropic_api_key: settings.anthropic_api_key.clone(),
            frontend_url: settings.frontend_url.clone(),
            oauth_google: settings.oauth_google.clone(),
            oauth_linkedin: settings.oauth_linkedin.clone(),
            oauth_github: settings.oauth_github.clone(),
            telegram_bot_secret: settings.telegram_bot_secret.clone(),
            pinata_jwt: settings.pinata_jwt.clone(),
            pinata_gateway: settings.pinata_gateway.clone(),
            solana_rpc_url: settings.solana_rpc_url.clone(),
            solana_treasury: settings.solana_treasury.clone(),
            usdc_mint: settings.usdc_mint.clone(),
            usdt_mint: settings.usdt_mint.clone(),
            whisper_url: settings.whisper_url.clone(),
            resend_api_key: settings.resend_api_key.clone(),
            email_from: settings.email_from.clone(),
            paystack_secret_key: settings.paystack_secret_key.clone(),
            paystack_currency: settings.paystack_currency.clone(),
            paystack_plan_basic_monthly: settings.paystack_plan_basic_monthly.clone(),
            paystack_plan_basic_annual: settings.paystack_plan_basic_annual.clone(),
            http_client,
        }))
    }
}

fn decode_hex_32(input: &str) -> Result<[u8; 32], String> {
    let hex = input.trim();
    if hex.len() != 64 {
        return Err("length must be exactly 64 hex characters".to_string());
    }

    let mut out = [0u8; 32];
    for i in 0..32 {
        let start = i * 2;
        let end = start + 2;
        out[i] = u8::from_str_radix(&hex[start..end], 16)
            .map_err(|_| "invalid hex character found".to_string())?;
    }
    Ok(out)
}
