//! Reaching a WSL distro from the app: starting its `githydra-agent`, listing
//! distros, and routing paths to the right backend.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, OnceLock};

use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use crate::error::GitCommandError;
use crate::git::actor::RepoActor;
use crate::git::repo::RepoSummary;
use crate::remote_agent::{AgentConn, RemoteRepo};
use crate::state::{AppState, RepoHandle};
use crate::wslpath;

/// Dev/test override: a local `githydra-agent` binary to run directly
/// instead of going through `wsl.exe`.
const AGENT_OVERRIDE_ENV: &str = "GITHYDRA_AGENT_BIN";

/// Where the app installs the agent inside a distro (relative to `$HOME`).
pub const AGENT_REL_PATH: &str = ".githydra/githydra-agent";

/// The Linux agent shipped inside the app, copied into a distro on first use
/// and whenever the app's version changes. Unset in dev builds.
static BUNDLED_AGENT: OnceLock<PathBuf> = OnceLock::new();

pub fn set_bundled_agent(path: PathBuf) {
    if path.is_file() {
        let _ = BUNDLED_AGENT.set(path);
    }
}

/// What `githydra-agent --version` prints for this build.
pub fn agent_version() -> String {
    format!("{} proto{}", env!("CARGO_PKG_VERSION"), crate::proto::PROTOCOL_VERSION)
}

fn wsl_sh(distro: &str, script: &str) -> Command {
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["-d", distro, "--exec", "sh", "-c", script]);
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut cmd, 0x0800_0000);
    cmd
}

/// Puts the bundled agent into `distro` unless the installed one is current.
/// Blocking. No bundled agent (dev builds): leaves the distro as it is.
pub fn ensure_agent_installed(distro: &str) -> Result<(), GitCommandError> {
    let Some(bundled) = BUNDLED_AGENT.get() else { return Ok(()) };
    let fail = |what: &str, e: &dyn std::fmt::Display| {
        GitCommandError::Internal(format!("could not {what} the gitHydra agent in WSL ({distro}): {e}"))
    };
    let installed = wsl_sh(distro, &format!("\"$HOME/{AGENT_REL_PATH}\" --version"))
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    if installed.as_deref() == Some(agent_version().as_str()) {
        return Ok(());
    }
    let bytes = std::fs::read(bundled).map_err(|e| fail("read", &e))?;
    // Written beside the target, then renamed: a running old agent keeps its
    // inode, and a half-copied file is never executed.
    let script = format!(
        "mkdir -p \"$HOME/.githydra\" && cat > \"$HOME/{AGENT_REL_PATH}.new\" && chmod +x \"$HOME/{AGENT_REL_PATH}.new\" && mv -f \"$HOME/{AGENT_REL_PATH}.new\" \"$HOME/{AGENT_REL_PATH}\""
    );
    let mut child = wsl_sh(distro, &script)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| fail("install", &e))?;
    child.stdin.take().expect("piped").write_all(&bytes).map_err(|e| fail("install", &e))?;
    let out = child.wait_with_output().map_err(|e| fail("install", &e))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(fail("install", &String::from_utf8_lossy(&out.stderr).trim()))
    }
}

pub fn agent_command(distro: &str) -> Command {
    if let Some(bin) = std::env::var_os(AGENT_OVERRIDE_ENV) {
        let mut cmd = Command::new(bin);
        cmd.arg("serve");
        return cmd;
    }
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["-d", distro, "--exec", "sh", "-c"])
        .arg(format!("exec \"$HOME/{AGENT_REL_PATH}\" serve"));
    cmd
}

/// Runs blocking `f` on its own thread, awaitable from async commands.
pub async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, GitCommandError> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        let _ = tx.send(f());
    });
    rx.await.map_err(|_| GitCommandError::Internal("worker thread died".into()))
}

/// Distro names from `wsl.exe -l -q` (UTF-16LE output); empty off Windows.
pub fn list_distros() -> Vec<String> {
    let out = match Command::new("wsl.exe").args(["-l", "-q"]).output() {
        Ok(out) if out.status.success() => out.stdout,
        _ => return Vec::new(),
    };
    let units: Vec<u16> = out.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    String::from_utf16_lossy(&units)
        .lines()
        .map(|l| l.trim().trim_start_matches('\u{feff}').to_string())
        .filter(|l| !l.is_empty() && !l.starts_with("docker-desktop"))
        .collect()
}

impl AppState {
    /// The (lazily started) agent of `distro`; restarted if it died.
    pub async fn agent(&self, distro: &str) -> Result<Arc<AgentConn>, GitCommandError> {
        if let Some(conn) = self.agents.lock().unwrap().get(distro).filter(|c| c.is_alive()) {
            return Ok(conn.clone());
        }
        let name = distro.to_string();
        let conn = blocking(move || {
            if std::env::var_os(AGENT_OVERRIDE_ENV).is_none() {
                ensure_agent_installed(&name)?;
            }
            AgentConn::connect(agent_command(&name), name)
        })
        .await??;
        self.agents.lock().unwrap().insert(distro.to_string(), conn.clone());
        Ok(conn)
    }

    /// For a WSL UNC path: its agent and the Linux path. `None` for local paths.
    pub async fn route(&self, path: &str) -> Result<Option<(Arc<AgentConn>, String)>, GitCommandError> {
        match wslpath::parse_unc(path) {
            Some((distro, linux)) => Ok(Some((self.agent(&distro).await?, linux))),
            None => Ok(None),
        }
    }

    /// Opens a repo of a WSL distro through its agent; paths in the summary
    /// come back as UNC paths, which is how the app knows the repo from then on.
    pub async fn open_remote(&self, distro: &str, linux_path: String) -> Result<RepoSummary, GitCommandError> {
        let agent = self.agent(distro).await?;
        let repo_id = uuid::Uuid::new_v4().to_string();
        let mut summary: RepoSummary = agent
            .call_as("open_repository", json!({ "repoId": repo_id, "path": linux_path }))
            .await?;
        let unc = |p: &str| wslpath::to_unc(distro, p);
        summary.path = unc(&summary.path);
        summary.common_dir = unc(&summary.common_dir);
        let actor = RepoActor::Remote(RemoteRepo { conn: agent.clone(), repo_id: repo_id.clone() });
        self.repos
            .lock()
            .unwrap()
            .insert(repo_id, RepoHandle { actor, path: summary.path.clone(), agent: Some(agent) });
        Ok(summary)
    }

    fn live_agents(&self) -> Vec<Arc<AgentConn>> {
        self.agents.lock().unwrap().values().filter(|c| c.is_alive()).cloned().collect()
    }

    /// Prompt answers/queries are global: tell every live agent, since the
    /// one that asked is not tracked.
    pub async fn broadcast(&self, op: &str, args: Value) {
        for conn in self.live_agents() {
            let _ = conn.call(op, args.clone()).await;
        }
    }

    /// First non-null answer among the agents (for `pending_*` queries).
    pub async fn first_answer<T: DeserializeOwned>(&self, op: &str) -> Option<T> {
        for conn in self.live_agents() {
            if let Ok(Some(v)) = conn.call_as::<Option<T>>(op, json!({})).await {
                return Some(v);
            }
        }
        None
    }
}
