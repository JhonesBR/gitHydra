use tauri::State;

use crate::ai;
use crate::git::actor::ComposeArgs;
use crate::git::compose::ComposedCommitInput;
use crate::state::AppState;
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

#[tauri::command]
pub async fn ai_compose_commits(
    repo_id: String,
    provider: String,
    api_key: String,
    model: String,
    custom_instructions: String,
    answers: String,
    state: State<'_, AppState>,
) -> Result<ai::ComposeResult, GitCommandError> {
    let staged = state.actor(&repo_id)?.staged_units().await?;
    let units: Vec<(String, String)> = staged.units.into_iter().map(|u| (u.id, u.text)).collect();
    let mut result =
        ai::compose_commits(&provider, &api_key, &model, &units, &custom_instructions, &answers).await?;
    result.tree_id = staged.tree_id;
    Ok(result)
}

#[tauri::command]
pub async fn apply_composed_commits(
    repo_id: String,
    tree_id: String,
    commits: Vec<ComposedCommitInput>,
    author_name: Option<String>,
    author_email: Option<String>,
    no_verify: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, GitCommandError> {
    state
        .actor(&repo_id)?
        .apply_compose(ComposeArgs {
            tree_id,
            commits,
            author_name,
            author_email,
            no_verify: no_verify.unwrap_or(false),
        })
        .await
}
