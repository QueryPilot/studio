pub mod adapter;
#[cfg(test)]
mod adapter_test;
pub mod backup;
pub(crate) mod search_path;

pub use adapter::{
    DuckDbAdapter, DuckDbAddFileRequest, DuckDbAttachCatalogRequest, DuckDbAttachDatabaseRequest,
    DuckDbAttachedDatabase, DuckDbAutocompleteSuggestion, DuckDbColumnDefinition,
    DuckDbCreateSecretRequest, DuckDbExportRequest, DuckDbExportResult, DuckDbExportSource,
    DuckDbExtensionInfo, DuckDbManagedObjectLineage, DuckDbManagedObjectSummary, DuckDbQueryPlan,
    DuckDbQueryProgress, DuckDbReplaceManagedObjectRequest, DuckDbSecretInfo, DuckDbSetting,
    ReplayStep,
};
