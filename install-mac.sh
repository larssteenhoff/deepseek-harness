#!/bin/bash
# Install Harness (this DeepSeek Harness fork) and TensorFold Bar on an Apple Silicon Mac.
#
# usage: ./install-mac.sh [--skip-harness] [--skip-tensorfold-bar] [--no-launch]
#
#   1. Builds the desktop app from this checkout and installs ~/Applications/Harness.app.
#   2. Adds this fork's plugins to the Harness desktop profile (~/.dsh/profiles/desktop):
#      remove-logo, harness-colors and tensorfold-launcher, linked from this checkout,
#      plus a "TensorFold (local)" model at http://127.0.0.1:8080/v1 as the default model.
#   3. Clones (or updates) TensorFold Bar, builds it and installs ~/Applications/TensorFold Bar.app.
#
# Running it again updates both apps and leaves existing profile settings in place.
# Environment: TENSORFOLD_BAR_DIR (default ~/TensorFoldBar) is where TensorFold Bar is cloned;
# INSTALL_APPS_DIR (default ~/Applications) and DSH_PROFILE_DIR (default ~/.dsh/profiles/desktop)
# move the installed apps and the profile that is edited.
set -euo pipefail

TENSORFOLD_BAR_REPO=https://github.com/larssteenhoff/TensorFoldBar.git
TENSORFOLD_BAR_DIR=${TENSORFOLD_BAR_DIR:-$HOME/TensorFoldBar}
APPS=${INSTALL_APPS_DIR:-$HOME/Applications}
PROFILE=${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}
REPO=$(cd "$(dirname "$0")" && pwd)
HARNESS=1 TENSORFOLD_BAR=1 LAUNCH=1
for arg in "$@"; do
 case "$arg" in
  --skip-harness) HARNESS=0 ;;
  --skip-tensorfold-bar) TENSORFOLD_BAR=0 ;;
  --no-launch) LAUNCH=0 ;;
  -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
  *) echo "unknown option: $arg (see --help)" >&2; exit 2 ;;
 esac
done

step() { printf '\n==> %s\n' "$*"; }
fail() { echo "error: $*" >&2; exit 1; }

[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || fail "this installer needs an Apple Silicon Mac"
command -v git >/dev/null || fail "git is missing; install the Xcode command line tools with: xcode-select --install"
mkdir -p "$APPS"

# Quit the copy of an app installed in $APPS (by bundle id) and wait until it has exited.
quit_app() {
 [[ -d "$3" ]] || return 0
 osascript -e "quit app id \"$1\"" >/dev/null 2>&1 || true
 for _ in $(seq 1 40); do pgrep -f "$2" >/dev/null || return 0; sleep 0.5; done
 echo "warning: $1 did not quit; replacing it anyway" >&2
}

if (( HARNESS )); then
 command -v node >/dev/null || fail "Node.js 24.9 or newer is required: https://nodejs.org/en/download"
 node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>24||(a===24&&b>=9)?0:1)' \
  || fail "Node.js 24.9 or newer is required (found $(node -v)): https://nodejs.org/en/download"
 PNPM_VERSION=$(node -p 'require(process.argv[1]).packageManager.split("@")[1]' "$REPO/package.json")
 pnpm() { COREPACK_ENABLE_DOWNLOAD_PROMPT=0 npx -y "pnpm@$PNPM_VERSION" "$@"; }

 step "Building Harness (this takes several minutes the first time)"
 (cd "$REPO" && pnpm install --frozen-lockfile && pnpm run build:artifacts)
 (cd "$REPO/apps/desktop" && pnpm run package:mac:arm64:unsigned -- --dir)
 BUILT="$REPO/apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/mac-arm64/DeepSeek Harness.app"
 [[ -d "$BUILT" ]] || fail "the build did not produce $BUILT"

 step "Installing $APPS/Harness.app"
 quit_app com.deepseek.harness "Harness.app/Contents/MacOS/DeepSeek Harness" "$APPS/Harness.app"
 rm -rf "$APPS/Harness.app"
 ditto "$BUILT" "$APPS/Harness.app"
 # Unsigned local build: clear the download quarantine so Gatekeeper opens it.
 xattr -dr com.apple.quarantine "$APPS/Harness.app" 2>/dev/null || true

 if [[ ! -f "$PROFILE/package.json" ]]; then
  step "Starting Harness once to create its desktop profile"
  open "$APPS/Harness.app"
  for _ in $(seq 1 180); do [[ -f "$PROFILE/package.json" ]] && break; sleep 1; done
  [[ -f "$PROFILE/package.json" ]] || fail "Harness did not create $PROFILE; open it once by hand, then run this again"
  sleep 5
  quit_app com.deepseek.harness "Harness.app/Contents/MacOS/DeepSeek Harness" "$APPS/Harness.app"
 fi

 step "Adding this fork's plugins to the Harness profile"
 (cd "$PROFILE" && pnpm add \
  "@local/remove-logo@link:$REPO/remove-logo" \
  "@local/harness-colors@link:$REPO/harness-colors" \
  "@local/tensorfold-launcher@link:$REPO/tensorfold-launcher")
 node - "$PROFILE/package.json" <<'EOF'
const fs = require('node:fs')
const file = process.argv[2]
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
const bundles = manifest.dsh.profile.bundles
for (const name of ['@local/remove-logo', '@local/harness-colors', '@local/tensorfold-launcher']) {
  if (!bundles.includes(name)) bundles.push(name)
}
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
EOF

 PATCH="$PROFILE/cordis.patch.yml"
 touch "$PATCH"
 if ! grep -q '^ *tensorfold:' "$PATCH"; then
  step "Adding the TensorFold model to the Harness profile"
  cat >> "$PATCH" <<'EOF'
# Local TensorFold server started by TensorFold Bar (`serve ... --name local-model --port 8080`).
# TensorFold needs no key; pi-ai's OpenAI-compatible client still requires an Authorization header,
# so a placeholder bearer value is sent. TensorFold Bar's Context menu rewrites contextWindow.
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: tensorfold
    model: local-model
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      tensorfold:
        displayName: TensorFold (local)
        api: openai-completions
        baseURL: http://127.0.0.1:8080/v1
        headers:
          Authorization: Bearer local
        models:
          - id: local-model
            name: TensorFold local model
            contextWindow: 65536
            maxTokens: 8192
            input:
              - text
            reasoningEfforts: false
        compat:
          supportsStore: false
          supportsDeveloperRole: false
          maxTokensField: max_tokens
        retryPolicy:
          mode: normal
          maxRetries: 0
EOF
 else
  echo "The profile already has a TensorFold model; leaving $PATCH unchanged."
 fi
fi

if (( TENSORFOLD_BAR )); then
 step "Getting TensorFold Bar into $TENSORFOLD_BAR_DIR"
 if [[ -d "$TENSORFOLD_BAR_DIR/.git" ]]; then
  git -C "$TENSORFOLD_BAR_DIR" pull --ff-only
 else
  git clone "$TENSORFOLD_BAR_REPO" "$TENSORFOLD_BAR_DIR"
 fi

 step "Building TensorFold Bar (downloads the latest TensorFold runtime)"
 (cd "$TENSORFOLD_BAR_DIR" && bash build.sh)

 step "Installing $APPS/TensorFold Bar.app"
 # Quitting stops its server; a download in progress resumes when the new copy starts.
 quit_app com.larssteenhoff.TensorFoldBar "TensorFold Bar.app/Contents/MacOS/applet" "$APPS/TensorFold Bar.app"
 rm -rf "$APPS/TensorFold Bar.app"
 ditto "$TENSORFOLD_BAR_DIR/dist/TensorFold Bar.app" "$APPS/TensorFold Bar.app"
 xattr -dr com.apple.quarantine "$APPS/TensorFold Bar.app" 2>/dev/null || true
fi

if (( LAUNCH )); then
 step "Opening the apps"
 (( TENSORFOLD_BAR )) && open "$APPS/TensorFold Bar.app"
 (( HARNESS )) && open "$APPS/Harness.app"
fi

cat <<EOF

Done.
- Harness: $APPS/Harness.app. Its default model is the local TensorFold server; the
  TensorFold button above Settings in the sidebar opens TensorFold Bar.
- TensorFold Bar: $APPS/TensorFold Bar.app, in the menu bar. It starts its selected model on
  launch; the first start downloads the weights (the default Qwen3.5 2B is about 1.6 GB, large
  models over 100 GB). Pick a model and context window from its menu.
EOF
