use std::time::Duration;

use serde::Deserialize;
use serde_json::json;

use crate::error::GitCommandError;

#[derive(Deserialize)]
struct GenerateContentResponse {
    candidates: Vec<Candidate>,
}

#[derive(Deserialize)]
struct Candidate {
    content: CandidateContent,
}

#[derive(Deserialize)]
struct CandidateContent {
    parts: Vec<Part>,
}

#[derive(Deserialize)]
struct Part {
    text: String,
}

pub async fn complete(api_key: &str, model: &str, system_prompt: &str, diff: &str) -> Result<String, GitCommandError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| GitCommandError::Internal(format!("failed to build HTTP client: {e}")))?;

    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}");

    let res = client
        .post(url)
        .json(&json!({
            "systemInstruction": { "parts": [{ "text": system_prompt }] },
            "contents": [{ "parts": [{ "text": diff }] }],
        }))
        .send()
        .await
        .map_err(|e| GitCommandError::Internal(format!("Gemini request failed: {e}")))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(GitCommandError::Internal(format!("Gemini API error ({status}): {body}")));
    }

    let parsed: GenerateContentResponse = res
        .json()
        .await
        .map_err(|e| GitCommandError::Internal(format!("failed to parse Gemini response: {e}")))?;

    parsed
        .candidates
        .into_iter()
        .next()
        .and_then(|c| c.content.parts.into_iter().next())
        .map(|p| p.text)
        .ok_or_else(|| GitCommandError::Internal("Gemini response had no candidates".into()))
}
