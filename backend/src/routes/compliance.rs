use std::sync::Arc;

use axum::{routing::post, Json, Router};
use serde::{Deserialize, Serialize};

use crate::compliance::{AmlProvider, KycProvider, MockAmlProvider, MockKycProvider};
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/kyc/start", post(start_kyc))
        .route("/aml/start", post(start_aml))
}

#[derive(Deserialize)]
struct KycStartRequest {
    user_id: String,
}

#[derive(Deserialize)]
struct AmlStartRequest {
    org_id: String,
}

#[derive(Serialize)]
struct ComplianceResponse {
    status: String,
}

async fn start_kyc(Json(body): Json<KycStartRequest>) -> Json<ComplianceResponse> {
    let provider = MockKycProvider;
    provider.start_kyc(&body.user_id);
    let status = provider.get_kyc_status(&body.user_id);
    Json(ComplianceResponse { status })
}

async fn start_aml(Json(body): Json<AmlStartRequest>) -> Json<ComplianceResponse> {
    let provider = MockAmlProvider;
    provider.start_aml(&body.org_id);
    let status = provider.get_aml_status(&body.org_id);
    Json(ComplianceResponse { status })
}

