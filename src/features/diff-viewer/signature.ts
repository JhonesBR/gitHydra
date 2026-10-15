import { call } from "@/lib/tauri-client";

/** Mirrors `CommitSignature` in src-tauri/src/git/signing.rs. */
export type CommitSignature = { format: "ssh" | "gpg" | "x509" | "unknown" };

/** `null` for an unsigned commit. Presence only: not verified. */
export const getCommitSignature = (repoId: string, sha: string) =>
  call<CommitSignature | null>("get_commit_signature", { repoId, sha });

const LABELS: Record<CommitSignature["format"], string> = {
  ssh: "Signed (SSH)",
  gpg: "Signed (GPG)",
  x509: "Signed (X.509)",
  unknown: "Signed",
};

export function signatureLabel(signature: CommitSignature | null | undefined): string | null {
  return signature ? (LABELS[signature.format] ?? LABELS.unknown) : null;
}
