import { call } from "@/lib/tauri-client";

export const terminalSpawn = (repoId: string, cwd: string) =>
  call<void>("terminal_spawn", { repoId, cwd });

export const terminalWrite = (repoId: string, data: string) =>
  call<void>("terminal_write", { repoId, data });

export const terminalResize = (repoId: string, cols: number, rows: number) =>
  call<void>("terminal_resize", { repoId, cols, rows });

export const terminalKill = (repoId: string) => call<void>("terminal_kill", { repoId });

export type TerminalOutputEvent = { repoId: string; data: string };
