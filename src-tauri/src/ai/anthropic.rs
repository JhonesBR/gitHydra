use std::time::Duration;

use serde::Deserialize;
use serde_json::json;

use crate::error::GitCommandError;

#[derive(Deserialize)]
struct MessagesResponse {
    content: Vec<ContentBlock>,
}

#[derive(Deserialize)]
struct ContentBlock {
    text: String,
}

pub async fn complete(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    diff: &str,
) -> Result<String, GitCommandError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| GitCommandError::Internal(format!("failed to build HTTP client: {e}")))?;

    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&json!({
            "model": model,
            "max_tokens": 1024,
            "system": system_prompt,
            "messages": [
                { "role": "user", "content": diff },
            ],
        }))
        .send()
        .await
        .map_err(|e| GitCommandError::Internal(format!("Anthropic request failed: {e}")))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(GitCommandError::Internal(format!(
            "Anthropic API error ({status}): {body}"
        )));
    }

    let parsed: MessagesResponse = res.json().await.map_err(|e| {
        GitCommandError::Internal(format!("failed to parse Anthropic response: {e}"))
    })?;

    parsed
        .content
        .into_iter()
        .next()
        .map(|c| c.text)
        .ok_or_else(|| GitCommandError::Internal("Anthropic response had no content".into()))
}
