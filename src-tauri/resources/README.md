The release workflow drops the static Linux `githydra-agent` here before
bundling the Windows installer (see `tauri.windows.conf.json`). The app copies
it into a WSL distro on first use. Empty in dev builds.
