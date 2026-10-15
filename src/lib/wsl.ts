/** Distro of a `\\wsl.localhost\<distro>\...` (or `\\wsl$\`) path; null for anything else. */
export function wslDistro(path: string | undefined | null): string | null {
  const m = /^[\\/]{2}(?:\?[\\/]UNC[\\/])?wsl(?:\.localhost|\$)[\\/]+([^\\/]+)/i.exec(path ?? "");
  return m ? m[1] : null;
}
