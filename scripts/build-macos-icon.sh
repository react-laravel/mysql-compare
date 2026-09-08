#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="$project_root/src-tauri/icons/macos"
mkdir -p "$output"
xcrun actool "$project_root/build/AppIcon.icon" --compile "$output" \
  --platform macosx --minimum-deployment-target 11.0 --app-icon AppIcon \
  --output-partial-info-plist "$output/partial-info.plist" --target-device mac \
  --output-format human-readable-text
