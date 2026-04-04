use std::env;
use std::path::PathBuf;

#[derive(Clone)]
pub struct OAuthProviderConfig {
    pub client_id: String,
    pub client_secret: String,
}

pub struct Settings {
    pub database_url: String,
    pub port: u16,
    pub jwt_secret: String,
    pub encryption_key: String,
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
}

impl Settings {
    fn load_oauth_provider(id_var: &str, secret_var: &str) -> Option<OAuthProviderConfig> {
        let client_id = env::var(id_var).ok().map(|s| s.trim().to_string());
        let client_secret = env::var(secret_var).ok().map(|s| s.trim().to_string());

        match (client_id, client_secret) {
            (Some(id), Some(secret)) if !id.is_empty() && !secret.is_empty() => Some(
                OAuthProviderConfig {
                    client_id: id,
                    client_secret: secret,
                },
            ),
            _ => None,
        }
    }

    pub fn from_env() -> Result<Self, String> {
        let database_url = env::var("BACKEND_DATABASE_URL")
            .map_err(|_| "BACKEND_DATABASE_URL must be set".to_string())?;

        let jwt_secret =
            env::var("BACKEND_JWT_SECRET").map_err(|_| "BACKEND_JWT_SECRET must be set".to_string())?;
        let encryption_key = env::var("BACKEND_ENCRYPTION_KEY")
            .map_err(|_| "BACKEND_ENCRYPTION_KEY must be set (64 hex chars)".to_string())?;

        let port = env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(4000);

        let upload_dir = env::var("BACKEND_UPLOAD_DIR").unwrap_or_else(|_| "./uploads".into());
        let public_base_url =
            env::var("BACKEND_PUBLIC_URL").unwrap_or_else(|_| "http://localhost:4000".into());
        let ai_api_key = env::var("GEMINI_API_KEY")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));
        let anthropic_api_key = env::var("ANTHROPIC_API_KEY")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));

        let frontend_url =
            env::var("FRONTEND_URL").unwrap_or_else(|_| "http://localhost:3000".into());
        let telegram_bot_secret = env::var("TELEGRAM_BOT_SECRET")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));
        let pinata_jwt = env::var("PINATA_JWT")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));
        let pinata_gateway = env::var("PINATA_GATEWAY")
            .ok()
            .map(|s| s.trim().trim_end_matches('/').to_string())
            .and_then(|s| (!s.is_empty()).then_some(s));
        let solana_rpc_url = env::var("SOLANA_RPC_URL")
            .map_err(|_| "SOLANA_RPC_URL must be set".to_string())?;
        let solana_treasury = env::var("SOLANA_TREASURY")
            .map_err(|_| "SOLANA_TREASURY must be set".to_string())?;
        let usdc_mint =
            env::var("USDC_MINT").map_err(|_| "USDC_MINT must be set".to_string())?;
        let usdt_mint =
            env::var("USDT_MINT").map_err(|_| "USDT_MINT must be set".to_string())?;
        let whisper_url =
            env::var("WHISPER_URL").unwrap_or_else(|_| "http://localhost:9000".to_string());
        let resend_api_key = env::var("RESEND_API_KEY")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));
        let email_from = env::var("EMAIL_FROM")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Kevin <kevin@metatron.id>".to_string());

        let paystack_secret_key = env::var("PAYSTACK_SECRET_KEY")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s.trim().to_string()));
        let paystack_currency = env::var("PAYSTACK_CURRENCY")
            .ok()
            .map(|s| s.trim().to_uppercase())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "USD".to_string());

        Ok(Self {
            database_url,
            port,
            jwt_secret,
            encryption_key,
            upload_dir: PathBuf::from(upload_dir),
            public_base_url: public_base_url.trim_end_matches('/').to_string(),
            ai_api_key,
            anthropic_api_key,
            frontend_url: frontend_url.trim_end_matches('/').to_string(),
            oauth_google: Self::load_oauth_provider(
                "OAUTH_GOOGLE_CLIENT_ID",
                "OAUTH_GOOGLE_CLIENT_SECRET",
            ),
            oauth_linkedin: Self::load_oauth_provider(
                "OAUTH_LINKEDIN_CLIENT_ID",
                "OAUTH_LINKEDIN_CLIENT_SECRET",
            ),
            oauth_github: Self::load_oauth_provider(
                "OAUTH_GITHUB_CLIENT_ID",
                "OAUTH_GITHUB_CLIENT_SECRET",
            ),
            telegram_bot_secret,
            pinata_jwt,
            pinata_gateway,
            solana_rpc_url,
            solana_treasury,
            usdc_mint,
            usdt_mint,
            whisper_url,
            resend_api_key,
            email_from,
            paystack_secret_key,
            paystack_currency,
        })
    }
}
