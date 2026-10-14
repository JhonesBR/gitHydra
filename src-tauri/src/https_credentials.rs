//! Session-long cache of HTTPS usernames + passwords/tokens per host, asked
//! from the UI when git's own credential helper has none. Memory only, so it
//! resets when the app closes. Same prompt bridge as `passphrase`.

use std::collections::HashMap;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Clone, PartialEq, Eq)]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

// Hand-written so a stray `{:?}` can never print the password.
impl std::fmt::Debug for Credentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credentials")
            .field("username", &self.username)
            .field("password", &"•••")
            .finish()
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialsRequest {
    /// `scheme://host[:port]`, what the answer is cached under.
    pub host: String,
    pub url: String,
    /// Username from the URL, to prefill.
    pub username: Option<String>,
    /// The previous credentials for this host were rejected.
    pub retry: bool,
}

static CACHE: Mutex<Option<HashMap<String, Credentials>>> = Mutex::new(None);
static PROMPT_LOCK: Mutex<()> = Mutex::new(()); // one prompt at a time; others then hit the cache
static PENDING: Mutex<Option<(CredentialsRequest, Sender<Option<Credentials>>)>> = Mutex::new(None);
/// Last prompt that was cancelled (counter, host), so callers queued behind it
/// don't each ask again.
static LAST_CANCEL: Mutex<(u64, Option<String>)> = Mutex::new((0, None));
static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn init(app: AppHandle) {
    let _ = APP.set(app);
}

/// `scheme://host[:port]` of a remote URL, without user info or path; for
/// scp-like `user@host:path` URLs, just the host.
pub fn host_key(url: &str) -> String {
    if let Some((scheme, rest)) = url.split_once("://") {
        let authority = rest.split('/').next().unwrap_or(rest);
        let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
        return format!("{}://{}", scheme.to_ascii_lowercase(), host.to_ascii_lowercase());
    }
    let without_user = url.rsplit_once('@').map_or(url, |(_, h)| h);
    without_user.split(':').next().unwrap_or(without_user).to_ascii_lowercase()
}

/// Cached credentials for `url`'s host, or asks the UI (blocking until
/// answered). `None` if the user cancelled or there is no UI (tests).
pub fn get(url: &str, username: Option<&str>, retry: bool) -> Option<Credentials> {
    let host = host_key(url);
    let round_before = LAST_CANCEL.lock().unwrap().0;
    let _guard = PROMPT_LOCK.lock().unwrap();
    if let Some(c) = CACHE.lock().unwrap().get_or_insert_default().get(&host) {
        return Some(c.clone());
    }
    {
        // A prompt for this host was cancelled while we waited: honour it.
        let last = LAST_CANCEL.lock().unwrap();
        if last.0 != round_before && last.1.as_deref() == Some(host.as_str()) {
            return None;
        }
    }
    let app = APP.get()?;
    let (tx, rx) = channel();
    let request = CredentialsRequest {
        host: host.clone(),
        url: url.to_string(),
        username: username.map(String::from),
        retry,
    };
    *PENDING.lock().unwrap() = Some((request.clone(), tx));
    // The UI also polls `pending_https_credentials` on mount, in case this
    // fires before it listens.
    let _ = app.emit("https-credentials-request", request);
    let answer = rx.recv().ok().flatten();
    {
        let mut last = LAST_CANCEL.lock().unwrap();
        last.0 += 1;
        last.1 = answer.is_none().then(|| host.clone());
    }
    let answer = answer?;
    CACHE.lock().unwrap().get_or_insert_default().insert(host, answer.clone());
    Some(answer)
}

/// Credentials already given for `url`'s host this session, without asking.
pub fn cached(url: &str) -> Option<Credentials> {
    CACHE.lock().unwrap().get_or_insert_default().get(&host_key(url)).cloned()
}

/// Drops credentials the server rejected so the next use asks again.
pub fn forget(url: &str) {
    CACHE.lock().unwrap().get_or_insert_default().remove(&host_key(url));
}

/// `None` (either field) cancels the prompt.
#[tauri::command]
pub fn submit_https_credentials(username: Option<String>, password: Option<String>) {
    if let Some((_, tx)) = PENDING.lock().unwrap().take() {
        let _ = tx.send(username.zip(password).map(|(username, password)| Credentials { username, password }));
    }
}

/// Request currently waiting for an answer, if any.
#[tauri::command]
pub fn pending_https_credentials() -> Option<CredentialsRequest> {
    PENDING.lock().unwrap().as_ref().map(|(request, _)| request.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_key_drops_user_info_and_path() {
        assert_eq!(host_key("https://user:tok@GitHub.com/o/r.git"), "https://github.com");
        assert_eq!(host_key("https://git.example.com:8443/o/r"), "https://git.example.com:8443");
        assert_eq!(host_key("http://host"), "http://host");
        assert_eq!(host_key("git@github.com:o/r.git"), "github.com");
    }

    #[test]
    fn cached_never_prompts_and_forget_drops_the_host() {
        let url = "https://tests.cached-never-prompts.invalid/a.git";
        assert_eq!(cached(url), None);
        let creds = Credentials { username: "u".into(), password: "p".into() };
        CACHE.lock().unwrap().get_or_insert_default().insert(host_key(url), creds.clone());
        // Same host, other repo: shared.
        assert_eq!(cached("https://tests.cached-never-prompts.invalid/b.git"), Some(creds));
        forget(url);
        assert_eq!(cached(url), None);
    }

    #[test]
    fn without_a_ui_get_returns_none() {
        assert_eq!(get("https://tests.no-ui.invalid/r.git", None, false), None);
    }

    #[test]
    fn debug_never_shows_the_password() {
        let creds = Credentials { username: "u".into(), password: "hunter2".into() };
        assert!(!format!("{creds:?}").contains("hunter2"));
    }
}
