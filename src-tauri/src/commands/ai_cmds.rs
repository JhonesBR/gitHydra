use crate::ai;
use crate::error::GitCommandError;

#[tauri::command]
pub async fn ai_generate_commit_message(
    provider: String,
    api_key: String,
    model: String,
    diff: String,
    custom_instructions: String,
) -> Result<ai::CommitMessageResult, GitCommandError> {
    ai::generate_commit_message(&provider, &api_key, &model, &diff, &custom_instructions).await
}
