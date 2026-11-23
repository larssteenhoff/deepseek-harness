#!/bin/bash
# Install Harness (this DeepSeek Harness fork) and TensorFold Bar on an Apple Silicon Mac.
#
# Without a checkout, nothing else to install first (prebuilt apps from the latest release):
#   curl -fsSL https://github.com/larssteenhoff/deepseek-harness/releases/latest/download/install-mac.sh | bash
# From a checkout (builds Harness from source; needs Node.js 24.9 or newer):
#   ./install-mac.sh [--prebuilt] [--build-tensorfold-bar] [--skip-harness] [--skip-tensorfold-bar] [--no-launch]
#
#   1. Installs ~/Applications/Harness.app: downloaded, or built from the checkout.
#   2. Installs ~/Applications/TensorFold Bar.app: downloaded, or with --build-tensorfold-bar
#      cloned into ~/TensorFoldBar (or TENSORFOLD_BAR_DIR) and built.
#   3. Sets up the Harness desktop profile (~/.dsh/profiles/desktop): this fork's plugins
#      remove-logo, harness-colors and tensorfold-launcher, and a "TensorFold (local)" model at
#      http://127.0.0.1:8080/v1 as the default model.
#
# Running it again updates both apps and leaves existing profile settings in place.
# Environment: INSTALL_APPS_DIR (default ~/Applications), DSH_PROFILE_DIR (default
# ~/.dsh/profiles/desktop) and DSH_LOCAL_PLUGINS_DIR (default ~/.dsh/local-plugins, prebuilt only)
# move what is installed; HARNESS_RELEASE_URL replaces the release download address.
set -euo pipefail

RELEASE_URL=${HARNESS_RELEASE_URL:-https://github.com/larssteenhoff/deepseek-harness/releases/latest/download}
TENSORFOLD_BAR_REPO=https://github.com/larssteenhoff/TensorFoldBar.git
TENSORFOLD_BAR_DIR=${TENSORFOLD_BAR_DIR:-$HOME/TensorFoldBar}
APPS=${INSTALL_APPS_DIR:-$HOME/Applications}
PROFILE=${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}
PLUGINS_DIR=${DSH_LOCAL_PLUGINS_DIR:-$HOME/.dsh/local-plugins}
PLUGINS=(remove-logo harness-colors tensorfold-launcher)

# A checkout has this script beside apps/desktop; `curl ... | bash` has none and installs prebuilt apps.
REPO=""
if [[ -f "${BASH_SOURCE[0]:-}" ]]; then
 candidate=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
 [[ -d "$candidate/apps/desktop" ]] && REPO=$candidate
fi
PREBUILT=1; [[ -n "$REPO" ]] && PREBUILT=0
HARNESS=1 TENSORFOLD_BAR=1 BUILD_TENSORFOLD_BAR=0 LAUNCH=1
for arg in "$@"; do
 case "$arg" in
  --prebuilt) PREBUILT=1 ;;
  --build-tensorfold-bar) BUILD_TENSORFOLD_BAR=1 ;;
  --skip-harness) HARNESS=0 ;;
  --skip-tensorfold-bar) TENSORFOLD_BAR=0 ;;
  --no-launch) LAUNCH=0 ;;
  -h|--help)
   [[ -f "${BASH_SOURCE[0]:-}" ]] && awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"
   exit 0 ;;
  *) echo "unknown option: $arg (see --help)" >&2; exit 2 ;;
 esac
done

step() { printf '\n==> %s\n' "$*"; }
fail() { echo "error: $*" >&2; exit 1; }

[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || fail "this installer needs an Apple Silicon Mac"
mkdir -p "$APPS"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Quit the copy of an app installed in $APPS (by bundle id) and wait until it has exited.
quit_app() {
 [[ -d "$3" ]] || return 0
 osascript -e "quit app id \"$1\"" >/dev/null 2>&1 || true
 for _ in $(seq 1 40); do pgrep -f "$2" >/dev/null || return 0; sleep 0.5; done
 echo "warning: $1 did not quit; replacing it anyway" >&2
}

# Download one release file into $WORK.
fetch() {
 echo "Downloading $1"
 curl -fL --retry 3 --progress-bar -o "$WORK/$1" "$RELEASE_URL/$1" || fail "could not download $RELEASE_URL/$1"
}

# Replace an installed app with a new copy. These apps are ad hoc signed, not notarized: clear any
# download quarantine so macOS opens them.
install_app() {
 rm -rf "$APPS/$2"
 ditto "$1" "$APPS/$2"
 xattr -dr com.apple.quarantine "$APPS/$2" 2>/dev/null || true
}

if (( HARNESS )); then
 if (( PREBUILT )); then
  step "Downloading Harness"
  fetch Harness-mac-arm64.zip
  ditto -x -k "$WORK/Harness-mac-arm64.zip" "$WORK/harness"
  BUILT="$WORK/harness/Harness.app"
 else
  command -v node >/dev/null || fail "building from source needs Node.js 24.9 or newer (https://nodejs.org/en/download), or run with --prebuilt"
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>24||(a===24&&b>=9)?0:1)' \
   || fail "building from source needs Node.js 24.9 or newer (found $(node -v)), or run with --prebuilt"
  PNPM_VERSION=$(node -p 'require(process.argv[1]).packageManager.split("@")[1]' "$REPO/package.json")
  step "Building Harness (this takes several minutes the first time)"
  (cd "$REPO" && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 npx -y "pnpm@$PNPM_VERSION" install --frozen-lockfile \
   && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 npx -y "pnpm@$PNPM_VERSION" run build:artifacts)
  (cd "$REPO/apps/desktop" && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 npx -y "pnpm@$PNPM_VERSION" run package:mac:arm64:unsigned -- --dir)
  BUILT="$REPO/apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/mac-arm64/DeepSeek Harness.app"
 fi
 [[ -d "$BUILT" ]] || fail "no Harness app at $BUILT"

 step "Installing $APPS/Harness.app"
 quit_app com.deepseek.harness "Harness.app/Contents/MacOS/DeepSeek Harness" "$APPS/Harness.app"
 install_app "$BUILT" Harness.app

 if [[ ! -f "$PROFILE/package.json" ]]; then
  step "Starting Harness once to create its desktop profile"
  open "$APPS/Harness.app"
  for _ in $(seq 1 180); do [[ -f "$PROFILE/package.json" ]] && break; sleep 1; done
  [[ -f "$PROFILE/package.json" ]] || fail "Harness did not create $PROFILE; open it once by hand, then run this again"
  sleep 5
  quit_app com.deepseek.harness "Harness.app/Contents/MacOS/DeepSeek Harness" "$APPS/Harness.app"
 fi

 # Harness carries its own Node.js and pnpm; use them so the profile matches the app.
 RUNTIME="$APPS/Harness.app/Contents/Resources/runtime/primary-runtime/dependencies"
 NODE="$RUNTIME/node/bin/node"
 [[ -x "$NODE" ]] || fail "Harness.app has no bundled Node.js at $NODE"
 pnpm() { PATH="$(dirname "$NODE"):$PATH" "$NODE" "$RUNTIME/pnpm/bin/pnpm.mjs" "$@"; }

 step "Adding this fork's plugins to the Harness profile"
 if (( PREBUILT )); then
  fetch harness-plugins.zip
  ditto -x -k "$WORK/harness-plugins.zip" "$WORK/plugins"
  mkdir -p "$PLUGINS_DIR"
  for plugin in "${PLUGINS[@]}"; do
   [[ -d "$WORK/plugins/$plugin" ]] || fail "harness-plugins.zip has no $plugin"
   rm -rf "${PLUGINS_DIR:?}/$plugin"
   ditto "$WORK/plugins/$plugin" "$PLUGINS_DIR/$plugin"
  done
  SOURCE=$PLUGINS_DIR
 else
  # Linked from the checkout, so `git pull` updates them; keep the checkout in place.
  SOURCE=$REPO
 fi
 specs=()
 for plugin in "${PLUGINS[@]}"; do specs+=("@local/$plugin@link:$SOURCE/$plugin"); done
 (cd "$PROFILE" && pnpm add "${specs[@]}")
 "$NODE" - "$PROFILE/package.json" "${PLUGINS[@]}" <<'EOF'
const fs = require('node:fs')
const [file, ...plugins] = process.argv.slice(2)
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
const bundles = manifest.dsh.profile.bundles
for (const plugin of plugins) {
  const name = `@local/${plugin}`
  if (!bundles.includes(name)) bundles.push(name)
}
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
EOF

 PATCH="$PROFILE/cordis.patch.yml"
 touch "$PATCH"
 if ! grep -q '^ *tensorfold: *$' "$PATCH"; then
  step "Adding the TensorFold model to the Harness profile"
  # Drop an empty list (`[]`) so the entries below form the array.
  grep -v '^\[\] *$' "$PATCH" > "$WORK/patch.yml" || true
  cat >> "$WORK/patch.yml" <<'EOF'
# Local TensorFold server started by TensorFold Bar, which keeps this model entry in step with the
# model it serves. TensorFold needs no key; pi-ai's OpenAI-compatible client still requires an
# Authorization header, so a placeholder bearer value is sent.
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
            name: TensorFold
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
  mv -f "$WORK/patch.yml" "$PATCH"
 else
  echo "The profile already has a TensorFold model; leaving $PATCH unchanged."
 fi
fi

if (( TENSORFOLD_BAR )); then
 if (( BUILD_TENSORFOLD_BAR )); then
  command -v git >/dev/null || fail "git is missing; install the Xcode command line tools with: xcode-select --install"
  step "Getting TensorFold Bar into $TENSORFOLD_BAR_DIR"
  if [[ -d "$TENSORFOLD_BAR_DIR/.git" ]]; then
   git -C "$TENSORFOLD_BAR_DIR" pull --ff-only
  else
   git clone "$TENSORFOLD_BAR_REPO" "$TENSORFOLD_BAR_DIR"
  fi
  step "Building TensorFold Bar (downloads the latest TensorFold runtime)"
  (cd "$TENSORFOLD_BAR_DIR" && bash build.sh)
  BAR="$TENSORFOLD_BAR_DIR/dist/TensorFold Bar.app"
 else
  step "Downloading TensorFold Bar"
  fetch TensorFoldBar-mac-arm64.zip
  ditto -x -k "$WORK/TensorFoldBar-mac-arm64.zip" "$WORK/bar"
  BAR="$WORK/bar/TensorFold Bar.app"
 fi
 [[ -d "$BAR" ]] || fail "no TensorFold Bar app at $BAR"

 step "Installing $APPS/TensorFold Bar.app"
 # Quitting stops its server; a download in progress resumes when the new copy starts.
 quit_app com.larssteenhoff.TensorFoldBar "TensorFold Bar.app/Contents/MacOS/applet" "$APPS/TensorFold Bar.app"
 install_app "$BAR" "TensorFold Bar.app"
fi

if (( LAUNCH )); then
 step "Opening the apps"
 if (( TENSORFOLD_BAR )); then open "$APPS/TensorFold Bar.app"; fi
 if (( HARNESS )); then open "$APPS/Harness.app"; fi
fi

cat <<EOF

Done.
- Harness: $APPS/Harness.app. Its default model is the local TensorFold server; the
  TensorFold button above Settings in the sidebar opens TensorFold Bar.
- TensorFold Bar: $APPS/TensorFold Bar.app, in the menu bar. It starts its selected model on
  launch; the first start downloads the weights (the default Qwen3.5 2B is about 1.6 GB, large
  models over 100 GB). Pick a model and context window from its menu.
EOF
