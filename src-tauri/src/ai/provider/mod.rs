use async_trait::async_trait;
use tokio::sync::mpsc;

use crate::ai::types::ChatRequest;

pub mod mock;

pub type ProviderStream = mpsc::Receiver<ProviderEvent>;

#[derive(Debug)]
pub enum ProviderEvent {
    Delta(String),
    Finished,
}

#[async_trait]
pub trait AIProvider: Send + Sync + 'static {
    fn name(&self) -> &'static str;
    async fn stream_chat(&self, request: ChatRequest) -> anyhow::Result<ProviderStream>;
}
