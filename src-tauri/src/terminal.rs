use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;

use crate::error::GitCommandError;

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputEvent {
    repo_id: String,
    data: String,
}

fn default_shell() -> String {
    if cfg!(windows) {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

/// Idempotent: re-toggling the terminal panel just reuses the existing shell
/// session instead of spawning a new one.
pub fn spawn(
    state: &TerminalState,
    repo_id: String,
    cwd: String,
) -> Result<(), GitCommandError> {
    let mut sessions = state.sessions.lock().unwrap();
    if sessions.contains_key(&repo_id) {
        return Ok(());
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| GitCommandError::Internal(e.to_string()))?;

    let mut cmd = match crate::wslpath::parse_unc(&cwd) {
        // A repo inside WSL: the shell must run there, not on Windows.
        Some((distro, linux)) => {
            let mut cmd = CommandBuilder::new("wsl.exe");
            cmd.args(["-d", &distro, "--cd", &linux]);
            cmd
        }
        None => {
            let mut cmd = CommandBuilder::new(default_shell());
            cmd.cwd(&cwd);
            cmd
        }
    };
    // Packaged apps launch without inheriting a terminal's env at all, so TERM
    // is often unset — zsh prompts like powerlevel10k then assume a dumb
    // terminal and fall back to a degraded render instead of the user's
    // actual configured prompt. xterm.js (the frontend here) emulates xterm
    // with 256-color and truecolor support, so advertise exactly that.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| GitCommandError::Internal(e.to_string()))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| GitCommandError::Internal(e.to_string()))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| GitCommandError::Internal(e.to_string()))?;

    let emit_repo_id = repo_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    crate::events::emit(
                        "terminal://output",
                        TerminalOutputEvent {
                            repo_id: emit_repo_id.clone(),
                            data,
                        },
                    );
                }
            }
        }
    });

    sessions.insert(
        repo_id,
        TerminalSession {
            master: pair.master,
            writer,
            child,
        },
    );
    Ok(())
}

pub fn write(state: &TerminalState, repo_id: &str, data: &str) -> Result<(), GitCommandError> {
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get_mut(repo_id)
        .ok_or_else(|| GitCommandError::Internal("no terminal session for this repo".into()))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| GitCommandError::Internal(e.to_string()))?;
    session
        .writer
        .flush()
        .map_err(|e| GitCommandError::Internal(e.to_string()))?;
    Ok(())
}

pub fn resize(
    state: &TerminalState,
    repo_id: &str,
    cols: u16,
    rows: u16,
) -> Result<(), GitCommandError> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get(repo_id)
        .ok_or_else(|| GitCommandError::Internal("no terminal session for this repo".into()))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| GitCommandError::Internal(e.to_string()))?;
    Ok(())
}

/// Idempotent: killing an already-closed (or never-opened) session is a no-op.
pub fn kill(state: &TerminalState, repo_id: &str) -> Result<(), GitCommandError> {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(mut session) = sessions.remove(repo_id) {
        let _ = session.child.kill();
    }
    Ok(())
}
