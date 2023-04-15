#!/usr/bin/env zsh

# Check if code is in PATH

if ! command -v code &> /dev/null
then
    echo "Make sure to add VS Code to your PATH:"
    echo "https://code.visualstudio.com/docs/setup/mac#_launching-from-the-command-line"
    exit
fi

TSS_DEBUG=9559 code --user-data-dir ~/.vscode-debug/ example