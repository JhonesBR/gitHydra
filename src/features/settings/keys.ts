// Tabs apply changes live (query cache + config file). [query key, config key] pairs.
export const SNAPSHOT_KEYS = [
  ["aiSettings", "aiSettings"],
  ["integrationsSettings", "integrationsSettings"],
  ["profiles", "profiles"],
  ["activeProfileId", "activeProfileId"],
  ["sshKeys", "sshKeys"],
  ["autoFetchMinutes", "autoFetchMinutes"],
  ["signCommits", "signCommits"],
  ["defaultEditor", "defaultEditor"],
  ["shortcuts", "shortcuts"],
  ["autoUpdate", "autoUpdate"],
] as const;
