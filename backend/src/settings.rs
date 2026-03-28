use std::env;

pub struct Settings {
    pub database_url: String,
    pub port: u16,
    pub jwt_secret: String,
}

impl Settings {
    pub fn from_env() -> Result<Self, String> {
        let database_url = env::var("BACKEND_DATABASE_URL")
            .map_err(|_| "BACKEND_DATABASE_URL must be set".to_string())?;

        let jwt_secret =
            env::var("BACKEND_JWT_SECRET").map_err(|_| "BACKEND_JWT_SECRET must be set".to_string())?;

        let port = env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(4000);

        Ok(Self {
            database_url,
            port,
            jwt_secret,
        })
    }
}

