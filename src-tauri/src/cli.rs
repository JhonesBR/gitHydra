//! Command-line entry: `githydra`, `githydra .`, `githydra -p <path>`.

use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use tauri::State;

use crate::error::GitCommandError;

/// The repository path the app was launched with, until the frontend takes it.
#[derive(Default)]
pub struct InitialPath(pub Mutex<Option<String>>);

/// The repository path asked for by `args` (argv-style: `args[0]` is the
/// program), resolved against `cwd`. `-p`/`--path` wins over a bare path;
/// unknown flags (e.g. `--appimage-extract-and-run`) are ignored.
pub fn parse_args(args: &[String], cwd: &Path) -> Option<PathBuf> {
    let mut flagged: Option<&str> = None;
    let mut positional: Option<&str> = None;
    let mut it = args.iter().skip(1);
    while let Some(arg) = it.next() {
        if arg == "-p" || arg == "--path" {
            flagged = it.next().map(String::as_str);
        } else if let Some(v) = arg.strip_prefix("--path=") {
            flagged = Some(v);
        } else if !arg.starts_with('-') && positional.is_none() {
            positional = Some(arg);
        }
    }
    let raw = flagged.or(positional).filter(|p| !p.trim().is_empty())?;
    let path = Path::new(raw);
    let joined = if path.is_absolute() { path.to_path_buf() } else { cwd.join(path) };
    // Drop "." segments so `-p .` gives the directory itself, not "/dir/.".
    Some(joined.components().filter(|c| *c != Component::CurDir).collect())
}

/// Hands the frontend the launch path once (None afterwards).
#[tauri::command]
pub fn take_initial_path(state: State<'_, InitialPath>) -> Option<String> {
    state.0.lock().unwrap().take()
}

/// Where the launcher goes and what it contains, for `exe` on this platform.
pub fn launcher_script(exe: &Path, windows: bool) -> (&'static str, String) {
    if windows {
        ("githydra.cmd", format!("@echo off\r\nstart \"\" \"{}\" %*\r\n", exe.display()))
    } else {
        (
            "githydra",
            format!(
                "#!/bin/sh\nsetsid nohup '{}' \"$@\" >/dev/null 2>&1 &\n",
                exe.display().to_string().replace('\'', r"'\''")
            ),
        )
    }
}

/// Writes a `githydra` command that opens this app, in a folder already on
/// the user's PATH where possible. Returns the file written.
#[tauri::command]
pub fn install_cli_launcher() -> Result<String, GitCommandError> {
    // An AppImage's own path, not the temporary mount current_exe points into.
    let exe = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok())
        .ok_or_else(|| GitCommandError::Internal("cannot locate the gitHydra executable".into()))?;
    let windows = cfg!(windows);
    let dir = if windows {
        // Per-user folder Windows already puts on PATH.
        std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("Microsoft").join("WindowsApps"))
    } else {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("bin"))
    }
    .ok_or_else(|| GitCommandError::Internal("cannot find a folder to install the command in".into()))?;
    let (name, script) = launcher_script(&exe, windows);
    std::fs::create_dir_all(&dir).map_err(|e| GitCommandError::Internal(e.to_string()))?;
    let target = dir.join(name);
    std::fs::write(&target, script).map_err(|e| GitCommandError::Internal(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755));
    }
    Ok(target.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }
    const CWD: &str = "/home/me/work";

    fn parse(a: &[&str]) -> Option<String> {
        parse_args(&args(a), Path::new(CWD)).map(|p| p.display().to_string())
    }

    #[test]
    fn no_path_opens_the_app_only() {
        assert_eq!(parse(&["githydra"]), None);
        assert_eq!(parse(&["githydra", "--appimage-extract-and-run"]), None);
    }

    #[test]
    fn dash_p_resolves_against_the_callers_directory() {
        assert_eq!(parse(&["githydra", "-p", "."]).as_deref(), Some(CWD));
        assert_eq!(parse(&["githydra", "-p", "repo"]).as_deref(), Some("/home/me/work/repo"));
        assert_eq!(parse(&["githydra", "--path=/abs/repo"]).as_deref(), Some("/abs/repo"));
        assert_eq!(parse(&["githydra", "--path", "./a/b"]).as_deref(), Some("/home/me/work/a/b"));
    }

    #[test]
    fn a_bare_path_works_and_dash_p_wins() {
        assert_eq!(parse(&["githydra", "."]).as_deref(), Some(CWD));
        assert_eq!(parse(&["githydra", "x", "-p", "y"]).as_deref(), Some("/home/me/work/y"));
        assert_eq!(parse(&["githydra", "-p"]), None);
        assert_eq!(parse(&["githydra", "-p", " "]), None);
    }

    #[test]
    fn launcher_scripts_forward_arguments() {
        let (name, sh) = launcher_script(Path::new("/opt/it's/gitHydra"), false);
        assert_eq!(name, "githydra");
        assert!(sh.starts_with("#!/bin/sh") && sh.contains(r"'/opt/it'\''s/gitHydra'") && sh.contains("\"$@\""));
        let (name, cmd) = launcher_script(Path::new(r"C:\Apps\gitHydra.exe"), true);
        assert_eq!(name, "githydra.cmd");
        assert!(cmd.contains(r#"start "" "C:\Apps\gitHydra.exe" %*"#));
    }
}
