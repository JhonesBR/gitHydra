#!/bin/sh
# `githydra [-p <path>]` for the .deb: opens gitHydra detached from the terminal.
setsid nohup /usr/bin/gitHydra "$@" >/dev/null 2>&1 &
