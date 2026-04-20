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
    /// Gemini model id for API paths (e.g. `gemini-2.5-flash`). Env: `GEMINI_MODEL`.
    pub gemini_model: String,
    /// Optional separate key for Gemini embeddings (semantic memory for paid tiers). If unset, only text memory is used.
    pub gemini_embedding_key: Option<String>,
    pub anthropic_api_key: Option<String>,
    pub frontend_url: String,
    pub oauth_google: Option<OAuthProviderConfig>,
    pub oauth_linkedin: Option<OAuthProviderConfig>,
    pub oauth_github: Option<OAuthProviderConfig>,
    pub telegram_bot_secret: Option<String>,
    /// Bot token used to send outbound Telegram messages. Env: `TELEGRAM_BOT_TOKEN`.
    pub telegram_bot_token: Option<String>,
    /// Shared secret for platform services (e.g. Kevin Telegram bridge). Empty disables the check (all requests rejected).
    pub platform_bot_secret: String,
    pub pinata_jwt: Option<String>,
    pub pinata_gateway: Option<String>,
    pub solana_rpc_url: String,
    pub solana_treasury: String,
    pub usdc_mint: Option<String>,
    pub usdt_mint: Option<String>,
    pub whisper_url: String,
    pub resend_api_key: Option<String>,
    pub email_from: String,
    pub paystack_secret_key: Option<String>,
    pub paystack_currency: String,
    pub paystack_plan_basic_monthly: String,
    pub paystack_plan_basic_annual: String,
    pub paystack_connector_plan_basic_monthly: String,
    pub paystack_connector_plan_basic_annual: String,
    pub paystack_investor_plan_basic_monthly: String,
    pub paystack_investor_plan_basic_annual: String,
    pub nowpayments_api_key: Option<String>,
    pub nowpayments_ipn_secret: Option<String>,
    pub nowpayments_api_base: String,
    pub whatsapp_verify_token: Option<String>,
    pub whatsapp_access_token: Option<String>,
    pub whatsapp_phone_number_id: Option<String>,
    /// When set, signup must include a matching `invite_secret` (shared invite link code).
    pub invite_secret: Option<String>,
    /// Pinata group IDs for tier-based file organisation. Env: PINATA_GROUP_FREE / PINATA_GROUP_BASIC / PINATA_GROUP_PRO.
    pub pinata_group_free: Option<String>,
    pub pinata_group_basic: Option<String>,
    pub pinata_group_pro: Option<String>,
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
        let gemini_model = env::var("GEMINI_MODEL")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "gemini-2.5-flash".to_string());
        let gemini_embedding_key = env::var("GEMINI_EMBEDDING_KEY")
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
        let telegram_bot_token = env::var("TELEGRAM_BOT_TOKEN")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));
        let platform_bot_secret = env::var("PLATFORM_BOT_SECRET").unwrap_or_default();
        let pinata_jwt = env::var("PINATA_JWT")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));
        let pinata_gateway = env::var("PINATA_GATEWAY")
            .ok()
            .map(|s| {
                let s = s.trim().trim_end_matches('/');
                let s = s.strip_prefix("https://").unwrap_or(s);
                let s = s.strip_prefix("http://").unwrap_or(s);
                s.to_string()
            })
            .and_then(|s| (!s.is_empty()).then_some(s));
        let solana_rpc_url = env::var("SOLANA_RPC_URL")
            .map_err(|_| "SOLANA_RPC_URL must be set".to_string())?;
        let solana_treasury = env::var("SOLANA_TREASURY")
            .map_err(|_| "SOLANA_TREASURY must be set".to_string())?;
        let usdc_mint = env::var("USDC_MINT")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));
        let usdt_mint = env::var("USDT_MINT")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));
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

        let paystack_plan_basic_monthly = env::var("PAYSTACK_PLAN_BASIC_MONTHLY")
            .unwrap_or_default()
            .trim()
            .to_string();
        let paystack_plan_basic_annual = env::var("PAYSTACK_PLAN_BASIC_ANNUAL")
            .unwrap_or_default()
            .trim()
            .to_string();
        let paystack_connector_plan_basic_monthly =
            env::var("PAYSTACK_CONNECTOR_PLAN_BASIC_MONTHLY")
                .unwrap_or_default()
                .trim()
                .to_string();
        let paystack_connector_plan_basic_annual =
            env::var("PAYSTACK_CONNECTOR_PLAN_BASIC_ANNUAL")
                .unwrap_or_default()
                .trim()
                .to_string();
        let paystack_investor_plan_basic_monthly =
            env::var("PAYSTACK_INVESTOR_PLAN_BASIC_MONTHLY")
                .unwrap_or_default()
                .trim()
                .to_string();
        let paystack_investor_plan_basic_annual =
            env::var("PAYSTACK_INVESTOR_PLAN_BASIC_ANNUAL")
                .unwrap_or_default()
                .trim()
                .to_string();

        let nowpayments_api_key = env::var("NOWPAYMENTS_API_KEY")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s.trim().to_string()));
        let nowpayments_ipn_secret = env::var("NOWPAYMENTS_IPN_SECRET")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s.trim().to_string()));
        let nowpayments_api_base = env::var("NOWPAYMENTS_API_BASE")
            .ok()
            .map(|s| s.trim_end_matches('/').to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "https://api.nowpayments.io".to_string());

        let whatsapp_verify_token = env::var("WHATSAPP_VERIFY_TOKEN")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));
        let whatsapp_access_token = env::var("WHATSAPP_ACCESS_TOKEN")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));
        let whatsapp_phone_number_id = env::var("WHATSAPP_PHONE_NUMBER_ID")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));

        let invite_secret = env::var("INVITE_SECRET")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let pinata_group_free = env::var("PINATA_GROUP_FREE")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let pinata_group_basic = env::var("PINATA_GROUP_BASIC")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let pinata_group_pro = env::var("PINATA_GROUP_PRO")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        Ok(Self {
            database_url,
            port,
            jwt_secret,
            encryption_key,
            upload_dir: PathBuf::from(upload_dir),
            public_base_url: public_base_url.trim_end_matches('/').to_string(),
            ai_api_key,
            gemini_model,
            gemini_embedding_key,
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
            telegram_bot_token,
            platform_bot_secret,
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
            paystack_plan_basic_monthly,
            paystack_plan_basic_annual,
            paystack_connector_plan_basic_monthly,
            paystack_connector_plan_basic_annual,
            paystack_investor_plan_basic_monthly,
            paystack_investor_plan_basic_annual,
            nowpayments_api_key,
            nowpayments_ipn_secret,
            nowpayments_api_base,
            whatsapp_verify_token,
            whatsapp_access_token,
            whatsapp_phone_number_id,
            invite_secret,
            pinata_group_free,
            pinata_group_basic,
            pinata_group_pro,
        })
    }
}
