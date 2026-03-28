pub trait KycProvider {
    fn start_kyc(&self, user_id: &str);
    fn get_kyc_status(&self, user_id: &str) -> String;
}

pub trait AmlProvider {
    fn start_aml(&self, org_id: &str);
    fn get_aml_status(&self, org_id: &str) -> String;
}

pub struct MockKycProvider;

impl KycProvider for MockKycProvider {
    fn start_kyc(&self, _user_id: &str) {
        // simulate async start
    }

    fn get_kyc_status(&self, _user_id: &str) -> String {
        "APPROVED".to_string()
    }
}

pub struct MockAmlProvider;

impl AmlProvider for MockAmlProvider {
    fn start_aml(&self, _org_id: &str) {
        // simulate async start
    }

    fn get_aml_status(&self, _org_id: &str) -> String {
        "CLEAR".to_string()
    }
}

