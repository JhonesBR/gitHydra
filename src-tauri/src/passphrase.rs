//! Session-long cache of SSH key passphrases, asked from the UI on demand.
//! Lives in memory only, so it resets when the app closes.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter};

static CACHE: Mutex<Option<HashMap<PathBuf, String>>> = Mutex::new(None);
static PROMPT_LOCK: Mutex<()> = Mutex::new(()); // one prompt at a time; others then hit the cache
static PENDING: Mutex<Option<(String, Sender<Option<String>>)>> = Mutex::new(None);
/// Last prompt that was cancelled, tagged with a counter bumped on every
/// prompt, so callers that queued behind it don't each ask again.
static LAST_CANCEL: Mutex<(u64, Option<PathBuf>)> = Mutex::new((0, None));
static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn init(app: AppHandle) {
    let _ = APP.set(app);
}

/// Cached passphrase for `key`, or asks the UI (blocking until answered).
/// `None` if the user cancelled or there is no UI (tests).
pub fn get(key: &Path) -> Option<String> {
    let round_before = LAST_CANCEL.lock().unwrap().0;
    let _guard = PROMPT_LOCK.lock().unwrap();
    if let Some(p) = CACHE.lock().unwrap().get_or_insert_default().get(key) {
        return Some(p.clone());
    }
    {
        // A prompt for this key was cancelled while we waited: honour it
        // (e.g. a workspace "Fetch all" running several at once).
        let last = LAST_CANCEL.lock().unwrap();
        if last.0 != round_before && last.1.as_deref() == Some(key) {
            return None;
        }
    }
    let app = APP.get()?;
    let (tx, rx) = channel();
    let key_str = key.display().to_string();
    *PENDING.lock().unwrap() = Some((key_str.clone(), tx));
    // The event can fire before the UI is listening (app launch); the UI also
    // polls `pending_ssh_passphrase` on mount, so the request isn't lost.
    let _ = app.emit("ssh-passphrase-request", key_str);
    let answer = rx.recv().ok().flatten();
    {
        let mut last = LAST_CANCEL.lock().unwrap();
        last.0 += 1;
        last.1 = answer.is_none().then(|| key.to_path_buf());
    }
    let answer = answer?;
    CACHE
        .lock()
        .unwrap()
        .get_or_insert_default()
        .insert(key.to_path_buf(), answer.clone());
    Some(answer)
}

/// Drops a passphrase that didn't work so the next use asks again.
pub fn forget(key: &Path) {
    CACHE.lock().unwrap().get_or_insert_default().remove(key);
}

#[tauri::command]
pub fn submit_ssh_passphrase(passphrase: Option<String>) {
    if let Some((_, tx)) = PENDING.lock().unwrap().take() {
        let _ = tx.send(passphrase);
    }
}

/// Key currently waiting for a passphrase, if any.
#[tauri::command]
pub fn pending_ssh_passphrase() -> Option<String> {
    PENDING.lock().unwrap().as_ref().map(|(key, _)| key.clone())
}

/// True if the private key file needs a passphrase. OpenSSH-format keys carry
/// the cipher name right after the magic: base64 of "...\0\0\0\0\x04none"
/// is a fixed prefix for unencrypted keys.
pub fn is_encrypted(key: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(key) else {
        return false;
    };
    if text.contains("ENCRYPTED") {
        return true;
    }
    match text.split("-----").nth(2) {
        Some(body) if text.contains("OPENSSH PRIVATE KEY") => {
            !body.trim_start().starts_with("b3BlbnNzaC1rZXktdjEAAAAABG5vbmU")
        }
        _ => false,
    }
}

