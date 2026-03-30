use std::sync::Arc;

use axum::{routing::post, Json, Router};
use serde::Deserialize;

use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/commit", post(commit))
}

#[derive(Deserialize)]
pub struct CommitRequest {
    pub pool_id: String,
    pub pitch_id: Option<String>,
    pub investor_user_id: String,
    pub amount: f64,
    pub currency: String,
    pub currency_type: String,
    pub onchain_tx_id: Option<String>,
}

async fn commit(Json(_body): Json<CommitRequest>) {
    // TODO: persist investment_commitments row and link onchain_tx_id for stablecoin flows.
}

