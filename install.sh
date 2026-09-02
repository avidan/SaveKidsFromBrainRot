#!/usr/bin/env bash
# SaveKidsFromBrainRot — one-command installer.
#
#   curl -fsSL https://raw.githubusercontent.com/avidan/SaveKidsFromBrainRot/main/install.sh | bash
#
# Checks prerequisites, clones (or updates) the repository into
# ~/SaveKidsFromBrainRot, and runs the interactive setup, which deploys the
# whole product to YOUR free Cloudflare account. Safe to re-run any time.
#
# Options via environment variables:
#   SKFBR_DIR=/some/path       install location (default: ~/SaveKidsFromBrainRot)
#   SKFBR_BOOTSTRAP_ONLY=1     clone/update only; skip the deploy step

set -euo pipefail

REPO="https://github.com/avidan/SaveKidsFromBrainRot.git"
DIR="${SKFBR_DIR:-$HOME/SaveKidsFromBrainRot}"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
okay()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

bold ""
bold "🛡️  SaveKidsFromBrainRot installer"
echo "   Self-hosted AI parental controls for YouTube — your server, your rules."
echo ""

# ---------- prerequisites ----------

command -v git >/dev/null 2>&1 || fail "git is required. Install it (macOS: xcode-select --install) and re-run."

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js 18+ is required. Install it from https://nodejs.org (or: brew install node) and re-run."
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node.js 18+ required (you have $(node -v)). Update at https://nodejs.org and re-run."
fi
okay "git and Node $(node -v) found"

# ---------- clone or update ----------

if [ -d "$DIR/.git" ]; then
  echo "  Updating existing install in $DIR…"
  git -C "$DIR" pull --ff-only || fail "Could not update $DIR — resolve the git state there and re-run."
  okay "repository up to date"
elif [ -e "$DIR" ]; then
  fail "$DIR exists but is not a SaveKidsFromBrainRot checkout. Move it aside or set SKFBR_DIR."
else
  echo "  Cloning into $DIR…"
  git clone --depth 1 "$REPO" "$DIR"
  okay "repository cloned"
fi

cd "$DIR"

if [ "${SKFBR_BOOTSTRAP_ONLY:-}" = "1" ]; then
  okay "bootstrap complete (SKFBR_BOOTSTRAP_ONLY=1 — skipping deploy)"
  echo "  To deploy later: cd $DIR && npm run setup"
  exit 0
fi

# ---------- hand off to the interactive setup ----------
# When this script is piped from curl, stdin is the pipe, not the keyboard —
# reattach the terminal so the Cloudflare login and API-key prompts work.

if [ -t 0 ]; then
  exec npm run setup
elif [ -e /dev/tty ]; then
  exec npm run setup </dev/tty
else
  echo ""
  bold "Repository ready. No terminal available for the interactive part — finish with:"
  echo ""
  echo "    cd $DIR && npm run setup"
  echo ""
fi
