//! Session-long cache of SSH key passphrases, asked from the UI on demand.
//! Lives in memory only, so it resets when the app closes.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter};

static CACHE: Mutex<Option<HashMap<PathBuf, String>>> = Mutex::new(None);
static PROMPT_LOCK: Mutex<()> = Mutex::new(()); // one prompt at a time; others then hit the cache
static PENDING: Mutex<Option<Sender<Option<String>>>> = Mutex::new(None);
static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn init(app: AppHandle) {
    let _ = APP.set(app);
}

/// Cached passphrase for `key`, or asks the UI (blocking until answered).
/// `None` if the user cancelled or there is no UI (tests).
pub fn get(key: &Path) -> Option<String> {
    let _guard = PROMPT_LOCK.lock().unwrap();
    if let Some(p) = CACHE.lock().unwrap().get_or_insert_default().get(key) {
        return Some(p.clone());
    }
    let app = APP.get()?;
    let (tx, rx) = channel();
    *PENDING.lock().unwrap() = Some(tx);
    app.emit("ssh-passphrase-request", key.display().to_string()).ok()?;
    let answer = rx.recv().ok().flatten()?;
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
    if let Some(tx) = PENDING.lock().unwrap().take() {
        let _ = tx.send(passphrase);
    }
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
