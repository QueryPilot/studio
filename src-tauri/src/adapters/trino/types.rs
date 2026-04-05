use serde::Deserialize;
use serde_json::value::RawValue;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrinoQueryResponse {
    pub id: Option<String>,
    pub info_uri: Option<String>,
    pub next_uri: Option<String>,
    pub columns: Option<Vec<TrinoColumn>>,
    pub data: Option<Vec<Vec<Box<RawValue>>>>, // RawValue prevents f64 precision loss for large numbers
    pub stats: Option<TrinoStats>,
    pub error: Option<TrinoError>,
    pub update_type: Option<String>,
    pub warnings: Option<Vec<TrinoWarning>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrinoColumn {
    pub name: String,
    #[serde(rename = "type")]
    pub type_name: String,
    pub type_signature: Option<TrinoTypeSignature>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrinoTypeSignature {
    pub raw_type: String,
    pub arguments: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrinoError {
    pub message: String,
    pub error_code: i32,
    pub error_name: String,
    pub error_type: String,
    pub failure_info: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrinoStats {
    pub state: String,
    pub queued: bool,
    pub scheduled: bool,
    pub nodes: i32,
    pub total_splits: i32,
    pub queued_splits: i32,
    pub running_splits: i32,
    pub completed_splits: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrinoWarning {
    pub warning_code: TrinoWarningCode,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrinoWarningCode {
    pub code: i32,
    pub name: String,
}
