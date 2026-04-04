// Test modules - separated for better organization

#[cfg(test)]
mod types_test;

#[cfg(test)]
mod error_test;

#[cfg(test)]
mod vault_test;

#[cfg(test)]
mod utils_test;

#[cfg(test)]
mod storage_test;

#[cfg(test)]
mod manager_test;

#[cfg(test)]
mod unified_adapter_test;

mod duckdb_scratchpad_test;
#[cfg(test)]
mod oracle_integration_test;
