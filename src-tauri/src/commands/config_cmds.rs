use crate::editors::{self, EditorInfo};
use crate::error::GitCommandError;
use crate::state::AppState;
use tauri::State;

/// Editors found on this machine, for the default-editor setting.
#[tauri::command]
pub async fn list_installed_editors() -> Vec<EditorInfo> {
    editors::detect_editors(&editors::search_dirs())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFonts {
    families: Vec<String>,
    /// What the app's default text / code fonts resolve to, for the "Default" label.
    default_text: String,
    default_code: String,
}

/// Font families installed on this machine, sorted: `fc-list` on Linux/macOS,
/// WPF's font list through PowerShell on Windows.
#[tauri::command]
pub async fn list_system_fonts() -> Result<SystemFonts, String> {
    use std::process::Command;
    // GUI launches often miss the shell's PATH (fontconfig under Homebrew, ...).
    let run = |programs: &[&str], args: &[&str]| -> Result<String, String> {
        let mut last = String::new();
        for p in programs {
            let mut cmd = Command::new(p);
            cmd.args(args);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x0800_0000);
            }
            match cmd.output() {
                Ok(o) if o.status.success() => return Ok(String::from_utf8_lossy(&o.stdout).into_owned()),
                Ok(o) => last = format!("{p}: {}", String::from_utf8_lossy(&o.stderr).trim()),
                Err(e) => last = format!("{p}: {e}"),
            }
        }
        Err(last)
    };
    #[cfg(windows)]
    let (text, default_text, default_code) = (
        run(
            &["powershell"],
            &["-NoProfile", "-Command", "Add-Type -AssemblyName PresentationCore; [Windows.Media.Fonts]::SystemFontFamilies | ForEach-Object { $_.Source }"],
        )?,
        "Segoe UI".to_string(),
        "Consolas".to_string(),
    );
    #[cfg(not(windows))]
    let (text, default_text, default_code) = {
        let fc = ["fc-list", "/usr/bin/fc-list", "/usr/local/bin/fc-list", "/opt/homebrew/bin/fc-list"];
        let m = ["fc-match", "/usr/bin/fc-match", "/usr/local/bin/fc-match", "/opt/homebrew/bin/fc-match"];
        let first = |s: String| s.lines().next().unwrap_or("").split(',').next().unwrap_or("").trim().to_string();
        (
            run(&fc, &[":", "family"]).map_err(|e| format!("fontconfig is not available ({e})"))?,
            run(&m, &["sans-serif", "-f", "%{family}"]).map(first).unwrap_or_default(),
            run(&m, &["monospace", "-f", "%{family}"]).map(first).unwrap_or_default(),
        )
    };
    let mut families: Vec<String> = text
        .lines()
        // fc-list: "Family A,Family B" aliases per line; keep the first.
        .filter_map(|l| l.split(',').next().map(|f| f.trim().to_string()))
        .filter(|f| !f.is_empty())
        .collect();
    families.sort_by_key(|f| f.to_lowercase());
    families.dedup();
    Ok(SystemFonts { families, default_text, default_code })
}

/// Absolute path of `rel_path` inside the repo's working directory.
#[tauri::command]
pub async fn repo_file_path(
    repo_id: String,
    rel_path: String,
    state: State<'_, AppState>,
) -> Result<String, GitCommandError> {
    let root = state.repo_path(&repo_id)?;
    Ok(std::path::Path::new(&root).join(rel_path).to_string_lossy().into_owned())
}

/// Opens `path` with the editor launcher `command` (from `list_installed_editors`).
#[tauri::command]
pub async fn open_in_editor(command: String, path: String) -> Result<(), GitCommandError> {
    editors::open_with(&command, std::path::Path::new(&path))
        .map_err(|e| GitCommandError::Internal(format!("Could not launch {command}: {e}")))
}

/// Settings export/import: the user picked `path` in a native dialog.
#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}
