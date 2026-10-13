use std::time::Duration;

use serde::Deserialize;
use serde_json::json;

use crate::error::GitCommandError;

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: Message,
}

#[derive(Deserialize)]
struct Message {
    content: String,
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
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": diff },
            ],
        }))
        .send()
        .await
        .map_err(|e| GitCommandError::Internal(format!("OpenAI request failed: {e}")))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(GitCommandError::Internal(format!(
            "OpenAI API error ({status}): {body}"
        )));
    }

    let parsed: ChatResponse = res
        .json()
        .await
        .map_err(|e| GitCommandError::Internal(format!("failed to parse OpenAI response: {e}")))?;

    parsed
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .ok_or_else(|| GitCommandError::Internal("OpenAI response had no choices".into()))
}
