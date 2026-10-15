//! The backend that runs inside a WSL distro for the Windows app.
//! `githydra-agent serve`: speaks `proto` on stdio.

fn main() {
    if tauri_app_lib::answer_askpass() {
        return;
    }
    tauri_app_lib::git::init_network_timeouts();
    match std::env::args().nth(1).as_deref() {
        Some("--version") => println!("{}", tauri_app_lib::wsl::agent_version()),
        Some("serve") => tauri_app_lib::agent::serve_stdio(),
        _ => {
            eprintln!("usage: githydra-agent serve");
            std::process::exit(2);
        }
    }
}
