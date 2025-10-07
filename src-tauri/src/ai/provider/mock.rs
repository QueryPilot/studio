use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::mpsc;
use tokio::time::sleep;

use crate::ai::types::ChatRequest;

use super::{AIProvider, ProviderEvent, ProviderStream};

#[derive(Default)]
pub struct MockProvider;

#[async_trait]
impl AIProvider for MockProvider {
    fn name(&self) -> &'static str {
        "mock"
    }

    async fn stream_chat(&self, request: ChatRequest) -> anyhow::Result<ProviderStream> {
        let (tx, rx) = mpsc::channel(16);
        let prompt = request.prompt.trim().to_owned();
        let history_len = request.history.len();

        tokio::spawn(async move {
            let mut response = String::new();
            if prompt.is_empty() {
                response.push_str("It looks like you sent an empty message. Try asking about your database schemas or queries!");
            } else {
                response.push_str("(mock) I see ");
                response.push_str(&prompt);
                if history_len > 0 {
                    response.push_str(&format!(
                        ", and we've already exchanged {} messages in this session.",
                        history_len
                    ));
                } else {
                    response.push_str(".");
                }
                response.push_str(
                    "\n\nThis is a placeholder response until an AI provider is configured.",
                );
            }

            for chunk in response.split_whitespace() {
                if tx
                    .send(ProviderEvent::Delta(format!("{} ", chunk)))
                    .await
                    .is_err()
                {
                    return;
                }
                sleep(Duration::from_millis(60)).await;
            }

            let _ = tx.send(ProviderEvent::Finished).await;
        });

        Ok(rx)
    }
}
