mod commands;
mod error;
mod git;
mod state;
mod terminal;

use commands::branch_cmds::{
    checkout_at, checkout_branch, checkout_commit_detached, cherry_pick, create_branch, list_branches,
    reset_to_commit,
};
use commands::config_cmds::get_global_git_identity;
use commands::diff_cmds::{get_commit_diff, get_file_content, get_range_diff};
use commands::log_cmds::get_commit_log;
use commands::rebase_cmds::{abort_rebase, continue_rebase, get_rebase_status, resolve_rebase_conflict, start_rebase};
use commands::remote_cmds::{fetch_remote, push_branch};
use commands::repo_cmds::{close_repository, get_repo_status, open_repository};
use commands::stash_cmds::{stash_apply, stash_drop, stash_list, stash_pop, stash_save};
use commands::terminal_cmds::{terminal_kill, terminal_resize, terminal_spawn, terminal_write};
use commands::working_cmds::{
    commit_changes, discard_all, discard_path, get_workdir_diff, get_working_status, stage_all, stage_path,
    unstage_all, unstage_path,
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
        .manage(AppState::default())
        .manage(TerminalState::default())
        .invoke_handler(tauri::generate_handler![
            open_repository,
            get_repo_status,
            close_repository,
            get_commit_log,
            get_commit_diff,
            get_range_diff,
            get_file_content,
            list_branches,
            create_branch,
            checkout_branch,
            checkout_at,
            checkout_commit_detached,
            cherry_pick,
            reset_to_commit,
            start_rebase,
            get_rebase_status,
            resolve_rebase_conflict,
            continue_rebase,
            abort_rebase,
            fetch_remote,
            push_branch,
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
            scan_workspace,
            fetch_repo_at_path,
            terminal_spawn,
            terminal_write,
            terminal_resize,
            terminal_kill,
            get_global_git_identity
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
