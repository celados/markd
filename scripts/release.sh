#!/bin/bash

# Build and validate a signed macOS release. App/updater creation is separated
# from DMG creation so a packaging failure can resume without recompiling.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$PROJECT_ROOT/.env.notarization.local" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env.notarization.local"
  set +a
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

fail() {
  echo -e "${RED}❌ $1${NC}" >&2
  exit 1
}

usage() {
  echo "Usage: $0 <version> [--type=fix|feature] [--resume] <release-notes>"
  echo "Example: $0 0.1.7 --type=feature \"New properties\""
  echo "Resume:  $0 0.1.7 --type=feature --resume \"New properties\""
}

[ $# -ge 2 ] || {
  usage
  exit 1
}

VERSION="$1"
shift
RELEASE_TYPE=""
RESUME=0
NOTE_PARTS=()

for arg in "$@"; do
  case "$arg" in
    --type=fix|--type=feature) RELEASE_TYPE="${arg#--type=}" ;;
    --type=*) fail "Release type must be fix or feature." ;;
    --resume) RESUME=1 ;;
    --*) fail "Unknown release option: $arg" ;;
    *) NOTE_PARTS+=("$arg") ;;
  esac
done

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Version must use x.y.z format."
NOTES="${NOTE_PARTS[*]}"
[ -n "$NOTES" ] || fail "Release notes cannot be empty."

cd "$PROJECT_ROOT"
node scripts/verify-release-version.js "$VERSION"

if [ "$RESUME" -eq 0 ] && [ -n "$(git status --porcelain)" ]; then
  fail "Commit or stash repository changes before starting a release."
fi

echo -e "${GREEN}🚀 Preparing Markd ${VERSION}${NC}"
echo -e "${YELLOW}🔐 Checking release credentials...${NC}"
pnpm run release:check

BUNDLE_DIR="$PROJECT_ROOT/src-tauri/target/release/bundle"
MACOS_DIR="$BUNDLE_DIR/macos"
DMG_DIR="$BUNDLE_DIR/dmg"

if [ "$RESUME" -eq 0 ]; then
  echo -e "${YELLOW}🧹 Removing stale macOS release artifacts...${NC}"
  rm -rf "$MACOS_DIR/Markd.app"
  rm -f "$MACOS_DIR/Markd.app.tar.gz" "$MACOS_DIR/Markd.app.tar.gz.sig"
  find "$DMG_DIR" -maxdepth 1 -type f \( -name "Markd_${VERSION}_*.dmg" -o -name "rw.*.Markd_${VERSION}_*.dmg" \) -delete 2>/dev/null || true

  echo -e "${YELLOW}📦 Building the macOS app...${NC}"
  env \
    -u APPLE_API_ISSUER \
    -u APPLE_API_KEY \
    -u APPLE_API_KEY_PATH \
    -u APPLE_ID \
    -u APPLE_PASSWORD \
    -u APPLE_TEAM_ID \
    pnpm exec tauri build --bundles app

  echo -e "${YELLOW}✍️  Finalizing the app and updater archive...${NC}"
  bash "$SCRIPT_DIR/finalize-macos-app.sh" "$VERSION"
else
  echo -e "${YELLOW}↩️  Resuming from existing app and updater artifacts...${NC}"
  if ! bash "$SCRIPT_DIR/verify-macos-artifacts.sh" "$VERSION" app; then
    echo -e "${YELLOW}Existing app artifacts need to be finalized again before resuming...${NC}"
    bash "$SCRIPT_DIR/finalize-macos-app.sh" "$VERSION"
  fi
fi

bash "$SCRIPT_DIR/verify-macos-artifacts.sh" "$VERSION" app

echo -e "${YELLOW}💿 Creating the DMG from the verified app...${NC}"
find "$DMG_DIR" -maxdepth 1 -type f \( -name "Markd_${VERSION}_*.dmg" -o -name "rw.*.Markd_${VERSION}_*.dmg" \) -delete 2>/dev/null || true

if ! pnpm exec tauri bundle --bundles dmg; then
  echo -e "${YELLOW}Tauri DMG packaging failed. Retrying with its generated create-dmg helper...${NC}"
  bash "$SCRIPT_DIR/create-macos-dmg.sh" "$VERSION"
fi

DMG_MATCHES=()
while IFS= read -r path; do
  DMG_MATCHES+=("$path")
done < <(find "$DMG_DIR" -maxdepth 1 -type f -name "Markd_${VERSION}_*.dmg" -print | sort)
[ "${#DMG_MATCHES[@]}" -eq 1 ] || fail "Expected exactly one DMG for ${VERSION}, found ${#DMG_MATCHES[@]}."
DMG_PATH="${DMG_MATCHES[0]}"

echo -e "${YELLOW}🎟️  Signing and notarizing the DMG...${NC}"
bash "$SCRIPT_DIR/notarize-dmg.sh" "$DMG_PATH"
bash "$SCRIPT_DIR/verify-macos-artifacts.sh" "$VERSION" all

echo -e "${YELLOW}📝 Generating and validating updater metadata...${NC}"
GENERATE_ARGS=("$VERSION" "--require=darwin-aarch64")
if [ -n "$RELEASE_TYPE" ]; then
  GENERATE_ARGS+=("--type=$RELEASE_TYPE")
fi
GENERATE_ARGS+=("$NOTES")
node "$SCRIPT_DIR/generate-latest-json.js" "${GENERATE_ARGS[@]}"
node scripts/verify-update-manifest.js "$PROJECT_ROOT/latest.json" "$VERSION" "$RELEASE_TYPE"

SITE_UPDATES="$PROJECT_ROOT/site/public/updates"
mkdir -p "$SITE_UPDATES"
cp "$PROJECT_ROOT/latest.json" "$SITE_UPDATES/latest.json"
cmp -s "$PROJECT_ROOT/latest.json" "$SITE_UPDATES/latest.json" || fail "Website updater manifest copy does not match."

echo ""
echo -e "${GREEN}✅ Markd ${VERSION} release artifacts are ready.${NC}"
echo "  DMG: $DMG_PATH"
echo "  Updater: $MACOS_DIR/Markd.app.tar.gz"
echo "  Signature: $MACOS_DIR/Markd.app.tar.gz.sig"
echo "  Manifest: $PROJECT_ROOT/latest.json"
echo ""
echo "If a DMG or notarization step fails, rerun the same command with --resume."
