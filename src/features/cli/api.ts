import { call } from "@/lib/tauri-client";

/** The path `githydra -p <path>` launched the app with (once; null afterwards). */
export const takeInitialPath = () => call<string | null>("take_initial_path");

/** Writes a `githydra` command that opens this app; returns the file written. */
export const installCliLauncher = () => call<string>("install_cli_launcher");
