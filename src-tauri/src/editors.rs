use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EditorInfo {
    pub id: String,
    pub name: String,
    /// Absolute path of the launcher.
    pub command: String,
}

/// (id, display name, executable names tried in order)
const KNOWN: &[(&str, &str, &[&str])] = &[
    ("code", "VS Code", &["code"]),
    ("code-insiders", "VS Code Insiders", &["code-insiders"]),
    ("cursor", "Cursor", &["cursor"]),
    ("windsurf", "Windsurf", &["windsurf"]),
    ("zed", "Zed", &["zed", "zeditor"]),
    ("subl", "Sublime Text", &["subl"]),
    ("idea", "IntelliJ IDEA", &["idea", "idea.sh"]),
    ("webstorm", "WebStorm", &["webstorm", "webstorm.sh"]),
    ("pycharm", "PyCharm", &["pycharm", "pycharm.sh"]),
    ("rustrover", "RustRover", &["rustrover", "rustrover.sh"]),
    ("goland", "GoLand", &["goland", "goland.sh"]),
    ("clion", "CLion", &["clion", "clion.sh"]),
    ("phpstorm", "PhpStorm", &["phpstorm", "phpstorm.sh"]),
    ("gnome-text-editor", "Text Editor", &["gnome-text-editor"]),
    ("gedit", "gedit", &["gedit"]),
    ("kate", "Kate", &["kate"]),
    ("xed", "Xed", &["xed"]),
    ("mousepad", "Mousepad", &["mousepad"]),
    ("notepad++", "Notepad++", &["notepad++"]),
];

fn find_executable(name: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    let candidates = [name.to_string(), format!("{name}.exe"), format!("{name}.cmd")];
    dirs.iter()
        .flat_map(|d| candidates.iter().map(move |c| d.join(c)))
        .find(|p| p.is_file())
}

/// Known editors whose launcher is found in `dirs`.
pub fn detect_editors(dirs: &[PathBuf]) -> Vec<EditorInfo> {
    KNOWN
        .iter()
        .filter_map(|(id, name, names)| {
            let path = names.iter().find_map(|n| find_executable(n, dirs))?;
            Some(EditorInfo {
                id: id.to_string(),
                name: name.to_string(),
                command: path.to_string_lossy().into_owned(),
            })
        })
        .collect()
}

/// PATH plus the usual install spots PATH misses for GUI apps.
pub fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    let mut extra: Vec<PathBuf> = ["/usr/local/bin", "/opt/homebrew/bin", "/snap/bin", "/var/lib/flatpak/exports/bin"]
        .into_iter()
        .map(PathBuf::from)
        .collect();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        extra.push(home.join(".local/bin"));
        extra.push(home.join(".local/share/JetBrains/Toolbox/scripts"));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        extra.push(local.join("Programs/Microsoft VS Code/bin"));
        extra.push(local.join("Programs/cursor/resources/app/bin"));
        extra.push(local.join("Programs/Zed"));
    }
    for pf in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(pf) = std::env::var_os(pf).map(PathBuf::from) {
            extra.push(pf.join("Notepad++"));
            extra.push(pf.join("Sublime Text"));
        }
    }
    extra.push(PathBuf::from("/Applications/Visual Studio Code.app/Contents/Resources/app/bin"));
    extra.push(PathBuf::from("/Applications/Cursor.app/Contents/Resources/app/bin"));
    extra.push(PathBuf::from("/Applications/Sublime Text.app/Contents/SharedSupport/bin"));
    dirs.extend(extra.into_iter().filter(|d| d.is_dir()));
    dirs
}

/// Launches `command` on `path`, detached (a GUI editor outlives the app call).
pub fn open_with(command: &str, path: &Path) -> std::io::Result<()> {
    let mut cmd = std::process::Command::new(command);
    cmd.arg(path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    // `.cmd` launchers (VS Code on Windows) need a shell.
    #[cfg(windows)]
    if command.to_lowercase().ends_with(".cmd") {
        cmd = std::process::Command::new("cmd");
        cmd.args(["/C", command]).arg(path);
    }
    cmd.spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &Path, name: &str) {
        std::fs::write(dir.join(name), "#!/bin/sh\n").unwrap();
    }

    #[test]
    fn detects_known_editors_in_the_given_dirs_only() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        touch(a.path(), "code");
        touch(b.path(), "zeditor"); // alias for Zed
        touch(b.path(), "not-an-editor");

        let found = detect_editors(&[a.path().to_path_buf(), b.path().to_path_buf()]);
        let ids: Vec<_> = found.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, ["code", "zed"]);
        assert_eq!(found[0].command, a.path().join("code").to_string_lossy());
        assert!(detect_editors(&[]).is_empty());
    }

    #[test]
    fn prefers_the_first_directory_on_the_path() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        touch(a.path(), "subl");
        touch(b.path(), "subl");
        let found = detect_editors(&[a.path().to_path_buf(), b.path().to_path_buf()]);
        assert_eq!(found.len(), 1);
        assert!(found[0].command.starts_with(&a.path().to_string_lossy().into_owned()));
    }
}
