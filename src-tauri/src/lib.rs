mod activity;
mod ai;
mod commands;
mod error;
mod git;
mod github;
mod gitlab;
mod https_credentials;
mod passphrase;
mod ssh_keys;
mod state;
mod terminal;

use commands::ai_cmds::{ai_compose_commits, apply_composed_commits, ai_generate_commit_message};
use commands::branch_cmds::{
    checkout_at, checkout_branch, checkout_commit_detached, cherry_pick, create_branch,
    delete_branch_both, delete_local_branch, delete_remote_branch, list_branches, list_tags,
    merge_branch, create_tag, delete_local_tag, delete_remote_tag, list_remote_tags, push_tag, reset_to_commit, reset_to_ref, sync_branch_to_remote,
};
use commands::config_cmds::get_global_git_identity;
use commands::diff_cmds::{get_commit_diff, get_file_content, get_range_diff};
use commands::github_cmds::{
    github_create_pull_request, github_list_assignees, github_list_open_pull_requests,
    github_list_repo_events,
};
use commands::gitlab_cmds::{
    gitlab_create_merge_request, gitlab_get_project, gitlab_list_open_merge_requests,
    gitlab_list_project_events, gitlab_search_members,
};
use commands::log_cmds::{get_commit_log, get_head_commit, get_reflog, get_repo_stats};
use commands::rebase_cmds::{
    abort_rebase, continue_rebase, get_rebase_status, resolve_rebase_conflict, start_rebase,
};
use commands::remote_cmds::{
    add_remote, fetch_remote, get_remote_url, list_remotes, push_branch, remove_remote,
    rename_remote, set_remote_url,
};
use commands::repo_cmds::{close_repository, get_repo_status, open_repository};
use commands::stash_cmds::{stash_apply, stash_drop, stash_list, stash_pop, stash_save};
use commands::terminal_cmds::{terminal_kill, terminal_resize, terminal_spawn, terminal_write};
use commands::undo_cmds::{get_undo_status, redo_last_action, undo_last_action};
use commands::working_cmds::{
    amend_commit_message, commit_changes, discard_all, discard_path, get_workdir_diff,
    get_working_status, stage_all, stage_path, unstage_all, unstage_path,
};
use commands::workspace_cmds::{fetch_repo_at_path, scan_workspace};
use state::AppState;
use terminal::TerminalState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            activity::init(app.handle().clone());
            passphrase::init(app.handle().clone());
            https_credentials::init(app.handle().clone());
            ssh_keys::init(app.handle().clone());
            Ok(())
        })
        .manage(AppState::default())
        .manage(TerminalState::default())
        .invoke_handler(tauri::generate_handler![
            passphrase::submit_ssh_passphrase,
            passphrase::pending_ssh_passphrase,
            https_credentials::submit_https_credentials,
            https_credentials::pending_https_credentials,
            ssh_keys::list_ssh_keys,
            open_repository,
            get_repo_status,
            close_repository,
            get_commit_log,
            get_head_commit,
            get_commit_diff,
            get_range_diff,
            get_file_content,
            list_branches,
            list_tags,
            ai_compose_commits,
            apply_composed_commits,
            create_tag,
            delete_local_tag,
            push_tag,
            delete_remote_tag,
            list_remote_tags,
            create_branch,
            checkout_branch,
            checkout_at,
            checkout_commit_detached,
            cherry_pick,
            reset_to_commit,
            reset_to_ref,
            sync_branch_to_remote,
            delete_local_branch,
            delete_remote_branch,
            delete_branch_both,
            merge_branch,
            start_rebase,
            get_rebase_status,
            resolve_rebase_conflict,
            continue_rebase,
            abort_rebase,
            fetch_remote,
            push_branch,
            get_remote_url,
            list_remotes,
            add_remote,
            remove_remote,
            rename_remote,
            set_remote_url,
            gitlab_get_project,
            gitlab_list_open_merge_requests,
            gitlab_create_merge_request,
            gitlab_search_members,
            gitlab_list_project_events,
            github_list_open_pull_requests,
            github_create_pull_request,
            github_list_assignees,
            github_list_repo_events,
            get_repo_stats,
            get_reflog,
            undo_last_action,
            redo_last_action,
            get_undo_status,
            stash_save,
            stash_list,
            stash_pop,
            stash_apply,
            stash_drop,
            get_working_status,
            stage_path,
            stage_all,
            unstage_path,
            unstage_all,
            discard_path,
            discard_all,
            get_workdir_diff,
            commit_changes,
            amend_commit_message,
            scan_workspace,
            fetch_repo_at_path,
            terminal_spawn,
            terminal_write,
            terminal_resize,
            terminal_kill,
            get_global_git_identity,
            ai_generate_commit_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
