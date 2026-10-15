//! The Tauri app: window, plugins and the command registry.

use crate::{cli, events, settings};
use crate::*;
use crate::state::AppState;
use crate::terminal::TerminalState;
use crate::commands::ai_cmds::{ai_generate_pr_description, ai_resolve_conflict, ai_compose_commits, apply_composed_commits, ai_generate_commit_message};
use crate::commands::branch_cmds::{
    checkout_at, checkout_branch, checkout_commit_detached, cherry_pick, create_branch,
    delete_branch_both, delete_local_branch, delete_remote_branch, list_branches, list_tags,
    merge_branch, create_tag, delete_local_tag, delete_remote_tag, list_remote_tags, push_tag, reset_to_commit, reset_to_ref, sync_branch_to_remote,
};
use crate::commands::config_cmds::{list_installed_editors, list_system_fonts, open_in_editor, repo_file_path};
use crate::commands::wsl_cmds::{
    get_global_git_identity, list_ssh_keys, list_wsl_dirs, list_wsl_distros, pending_https_credentials,
    pending_ssh_passphrase, submit_https_credentials, submit_ssh_passphrase, wsl_home,
};
use crate::commands::diff_cmds::{get_commit_diff, get_file_content, get_range_diff};
use crate::commands::github_cmds::{
    github_create_pull_request, github_list_assignees, github_list_open_pull_requests,
    github_list_repo_events,
};
use crate::commands::gitlab_cmds::{
    gitlab_create_merge_request, gitlab_get_project, gitlab_list_open_merge_requests,
    gitlab_list_project_events, gitlab_search_members,
};
use crate::commands::history_cmds::{
    get_blame, get_branch_compare, get_commit_file_diff, get_file_history, get_tree_diff,
    revert_commit,
};
use crate::commands::interactive_rebase_cmds::{get_rebase_plan, start_interactive_rebase};
use crate::commands::repo_tools_cmds::{
    add_worktree, get_lfs_status, get_submodule_count, list_submodules, list_worktrees, prune_worktrees,
    remove_worktree, run_lfs_pull, update_submodules,
};
use crate::commands::log_cmds::{
    get_commit_log, get_repo_fingerprint, search_commits, get_commit_signature, get_head_commit, get_reflog, get_repo_stats,
};
use crate::commands::rebase_cmds::{
    abort_rebase, continue_rebase, get_rebase_status, resolve_rebase_conflict, start_rebase,
};
use crate::commands::pull_cmds::{get_upstream_status, pull_branch};
use crate::commands::remote_cmds::{
    add_remote, fetch_remote, get_remote_url, list_remotes, push_branch, remove_remote,
    rename_remote, set_remote_url,
};
use crate::commands::repo_cmds::{close_repository, get_repo_status, open_repository};
use crate::commands::stash_cmds::{stash_apply, stash_drop, stash_list, stash_pop, stash_save};
use crate::commands::terminal_cmds::{terminal_kill, terminal_resize, terminal_spawn, terminal_write};
use crate::commands::undo_cmds::{get_undo_status, redo_last_action, undo_last_action};
use crate::commands::working_cmds::{
    add_ignore_pattern, amend_commit_message, apply_lines, commit_changes, discard_all,
    discard_path, get_workdir_diff, get_working_status, stage_all, stage_path, unstage_all,
    unstage_path,
};
use crate::commands::workspace_cmds::{fetch_repo_at_path, scan_workspace};


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_path = std::env::current_dir()
        .ok()
        .and_then(|cwd| cli::parse_args(&std::env::args().collect::<Vec<_>>(), &cwd))
        .map(|p| p.to_string_lossy().into_owned());

    let builder = tauri::Builder::default();
    // Must be the first plugin: a second launch (`githydra -p .`) hands its
    // args to the running instance and exits.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        use tauri::{Emitter, Manager};
        if let Some(path) = cli::parse_args(&args, std::path::Path::new(&cwd)) {
            let _ = app.emit("open-path", path.to_string_lossy().into_owned());
        }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            use tauri::Emitter;
            use tauri_plugin_store::StoreExt;
            let handle = app.handle().clone();
            events::set_sink(move |name, payload| {
                let _ = handle.emit(name, payload);
            });
            {
                use tauri::Manager;
                if let Ok(dir) = app.path().resource_dir() {
                    crate::wsl::set_bundled_agent(dir.join("resources/githydra-agent"));
                }
            }
            let handle = app.handle().clone();
            settings::set_provider(move |key| handle.store("layout.json").ok()?.get(key));
            Ok(())
        })
        .manage(AppState::default())
        .manage(cli::InitialPath(std::sync::Mutex::new(initial_path)))
        .manage(TerminalState::default())
        .invoke_handler(tauri::generate_handler![
            submit_ssh_passphrase,
            pending_ssh_passphrase,
            submit_https_credentials,
            pending_https_credentials,
            list_ssh_keys,
            list_wsl_distros,
            list_wsl_dirs,
            wsl_home,
            open_repository,
            get_repo_status,
            close_repository,
            get_commit_log,
            search_commits,
            get_repo_fingerprint,
            get_head_commit,
            get_commit_signature,
            get_commit_diff,
            get_range_diff,
            get_file_content,
            list_branches,
            list_tags,
            ai_compose_commits,
            ai_resolve_conflict,
            ai_generate_pr_description,
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
            revert_commit,
            get_file_history,
            get_commit_file_diff,
            get_blame,
            get_branch_compare,
            get_tree_diff,
            start_rebase,
            get_rebase_status,
            resolve_rebase_conflict,
            continue_rebase,
            abort_rebase,
            get_rebase_plan,
            start_interactive_rebase,
            list_worktrees,
            add_worktree,
            remove_worktree,
            prune_worktrees,
            list_submodules,
            get_submodule_count,
            update_submodules,
            get_lfs_status,
            run_lfs_pull,
            fetch_remote,
            push_branch,
            pull_branch,
            get_upstream_status,
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
            apply_lines,
            add_ignore_pattern,
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
            list_installed_editors,
            list_system_fonts,
            cli::take_initial_path,
            cli::install_cli_launcher,
            repo_file_path,
            open_in_editor,
        list_installed_editors,
        repo_file_path,
        open_in_editor,
            ai_generate_commit_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
