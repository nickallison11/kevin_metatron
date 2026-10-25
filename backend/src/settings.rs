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
    pub openai_api_key: Option<String>,
    /// OpenRouter — used for Hermes 4 70B and Kimi K3. Env: `OPENROUTER_API_KEY`.
    pub openrouter_api_key: Option<String>,
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
    pub whisper_url: String,
    pub resend_api_key: Option<String>,
    pub email_from: String,
    pub internal_automation_token: Option<String>,
    /// Stripe secret key (sk_test_/sk_live_) and webhook signing secret (whsec_).
    pub stripe_secret_key: Option<String>,
    pub stripe_webhook_secret: Option<String>,
    pub whatsapp_verify_token: Option<String>,
    pub whatsapp_access_token: Option<String>,
    pub whatsapp_phone_number_id: Option<String>,
    /// When set, signup must include a matching `invite_secret` (shared invite link code).
    pub invite_secret: Option<String>,
    /// Stripe checkout is refused unless PAYMENTS_ENABLED=1.
    pub payments_enabled: bool,
    /// New accounts can only be created when REGISTRATION_OPEN=true (or 1).
    /// Missing or anything else means closed, so production can't open by accident.
    pub registration_open: bool,
    /// Pinata group IDs for tier-based file organisation. Env: PINATA_GROUP_FREE / PINATA_GROUP_BASIC / PINATA_GROUP_PRO.
    pub pinata_group_free: Option<String>,
    pub pinata_group_basic: Option<String>,
    pub pinata_group_pro: Option<String>,
    pub match_limit_free: i64,
    pub match_limit_basic: i64,
    pub match_limit_pro: i64,
    pub investor_match_limit_free: i64,
    pub investor_match_limit_basic: i64,
    pub investor_match_limit_pro: i64,
    pub cron_secret: Option<String>,
    pub unsubscribe_secret: String,
    /// NadirClaw local LLM base URL (OpenAI-compat). Env: NADIRCLAW_URL.
    pub nadirclaw_url: String,
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
        // A Gemini API key covers both generateContent and embedContent under
        // the same project, so GEMINI_EMBEDDING_KEY only needs setting if
        // someone wants embeddings on a separate key/quota later — otherwise
        // it silently reuses GEMINI_API_KEY.
        let gemini_embedding_key = env::var("GEMINI_EMBEDDING_KEY")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s))
            .or_else(|| ai_api_key.clone());
        let anthropic_api_key = env::var("ANTHROPIC_API_KEY")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));
        let openai_api_key = env::var("OPENAI_API_KEY")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));
        let openrouter_api_key = env::var("OPENROUTER_API_KEY")
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
        let whisper_url =
            env::var("WHISPER_URL").unwrap_or_else(|_| "http://localhost:9000".to_string());
        let resend_api_key = env::var("RESEND_API_KEY")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));
        let email_from = env::var("EMAIL_FROM")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Kevin AI <kevin@metatron.id>".to_string());
        let internal_automation_token = env::var("INTERNAL_AUTOMATION_TOKEN")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));

        let stripe_secret_key = env::var("STRIPE_SECRET_KEY")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s.trim().to_string()));
        let stripe_webhook_secret = env::var("STRIPE_WEBHOOK_SECRET")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s.trim().to_string()));

        let whatsapp_verify_token = env::var("WHATSAPP_VERIFY_TOKEN")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));
        let whatsapp_access_token = env::var("WHATSAPP_ACCESS_TOKEN")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));
        let whatsapp_phone_number_id = env::var("WHATSAPP_PHONE_NUMBER_ID")
            .ok()
            .and_then(|s| (!s.trim().is_empty()).then_some(s));

        let payments_enabled = env::var("PAYMENTS_ENABLED").map(|v| v.trim() == "1").unwrap_or(false);
        let registration_open = env::var("REGISTRATION_OPEN")
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true"))
            .unwrap_or(false);

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

        let match_limit_free = env::var("FOUNDER_FREE_MATCH_LIMIT")
            .ok()
            .and_then(|s| s.trim().parse::<i64>().ok())
            .unwrap_or(1);
        let match_limit_basic = env::var("FOUNDER_BASIC_MATCH_LIMIT")
            .ok()
            .and_then(|s| s.trim().parse::<i64>().ok())
            .unwrap_or(10);
        let match_limit_pro = env::var("FOUNDER_PRO_MATCH_LIMIT")
            .ok()
            .and_then(|s| s.trim().parse::<i64>().ok())
            .unwrap_or(0);

        let investor_match_limit_free = env::var("INVESTOR_FREE_MATCH_LIMIT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1);
        let investor_match_limit_basic = env::var("INVESTOR_BASIC_MATCH_LIMIT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(10);
        let investor_match_limit_pro = env::var("INVESTOR_PRO_MATCH_LIMIT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);

        let cron_secret = env::var("CRON_SECRET")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let nadirclaw_url =
            env::var("NADIRCLAW_URL").unwrap_or_else(|_| "http://localhost:8856/v1".to_string());
        let unsubscribe_secret = env::var("UNSUBSCRIBE_SECRET")
            .unwrap_or_else(|_| "changeme-unsubscribe-secret".to_string());

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
            openai_api_key,
            openrouter_api_key,
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
            whisper_url,
            resend_api_key,
            email_from,
            internal_automation_token,
            stripe_secret_key,
            stripe_webhook_secret,
            whatsapp_verify_token,
            whatsapp_access_token,
            whatsapp_phone_number_id,
            invite_secret,
            payments_enabled,
            registration_open,
            pinata_group_free,
            pinata_group_basic,
            pinata_group_pro,
            match_limit_free,
            match_limit_basic,
            match_limit_pro,
            investor_match_limit_free,
            investor_match_limit_basic,
            investor_match_limit_pro,
            cron_secret,
            unsubscribe_secret,
            nadirclaw_url,
        })
    }
}
