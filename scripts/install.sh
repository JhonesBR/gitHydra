#!/bin/sh
# Installs gitHydra (Linux / WSL2 via WSLg) and a `gitHydra` command that
# opens the app detached from the terminal. The AppImage self-updates on launch.
set -eu
REPO=JhonesBR/gitHydra
DIR="$HOME/.local/share/gitHydra"
BIN="$HOME/.local/bin"
mkdir -p "$DIR" "$BIN"

url=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o 'https://[^"]*amd64\.AppImage"' | tr -d '"' | head -n1)
[ -n "$url" ] || { echo "no AppImage found in latest release" >&2; exit 1; }
curl -fL "$url" -o "$DIR/gitHydra.AppImage"
chmod +x "$DIR/gitHydra.AppImage"

cat > "$BIN/gitHydra" <<'WRAP'
#!/bin/sh
# --appimage-extract-and-run: no FUSE needed (absent on most WSL installs)
setsid nohup "$HOME/.local/share/gitHydra/gitHydra.AppImage" --appimage-extract-and-run "$@" >/dev/null 2>&1 &
WRAP
chmod +x "$BIN/gitHydra"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "add $BIN to PATH";; esac
echo "installed: run 'gitHydra'"
