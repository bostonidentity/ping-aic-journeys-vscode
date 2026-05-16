#!/bin/bash
# PreToolUse(Bash) hook: before `git commit` or `git push`, scan staged files
# for secrets, sandbox paths, and real AIC tenant URLs. Blocks via exit 2 if found.

# Bash tool input arrives as JSON on stdin; extract the command string.
CMD=$(jq -r '.tool_input.command // empty')

# Only gate git commit / push — every other bash invocation passes through.
echo "$CMD" | grep -qE '^git (commit|push)' || exit 0

# Sensitive keywords in staged diffs. Exclude docs (.md), shell scripts, and
# the .claude/ ruleset — those legitimately describe the very keywords we
# scan for (e.g. .claude/rules/security.md, this hook itself) and would
# false-positive otherwise. Real-secret patterns below still cover every file.
SECRETS=$(git diff --cached --diff-filter=ACM -S 'password' -S 'secret' -S 'api_key' -S 'apikey' -S 'token' -S 'private_key' -S 'saJwk' -S 'service_account' --name-only -- ':(exclude).claude/**' ':(exclude)*.md' ':(exclude)*.sh' 2>/dev/null)

# Known secret patterns (API keys, private keys, JWKs). Exclude .md so doc
# examples of a JWK shape (`"kty": "RSA"`) don't trip. Anything actually
# encoding a key in source/config still matches.
PATTERNS=$(git diff --cached --diff-filter=ACM -G '(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|"kty":\s*"RSA"|"kty":\s*"EC")' --name-only -- ':(exclude)*.md' 2>/dev/null)

# .env files being committed (allow .env.example).
ENVFILES=$(git diff --cached --name-only 2>/dev/null | grep -E '\.env$|\.env\.' | grep -v '\.example$')

# sandbox/ paths staged (should never be committed per CLAUDE.md).
SANDBOX=$(git diff --cached --name-only 2>/dev/null | grep -E '^sandbox/')

# Real AIC tenant hostnames. Allow the dummy `example.forgeblocks.com` /
# `tenant.example` domains used in tests and docs.
AIC_URLS=$(git diff --cached --diff-filter=ACM -G '(openam-[a-zA-Z0-9-]+\.(forgeblocks|id\.forgerock|rapid\.id\.forgerock)\.(com|io)|[a-zA-Z0-9-]+\.forgeblocks\.com)' --name-only 2>/dev/null | while read -r f; do
  if git diff --cached -- "$f" | grep -E '\+.*(openam-[a-zA-Z0-9-]+\.(forgeblocks|id\.forgerock|rapid\.id\.forgerock)\.(com|io)|[a-zA-Z0-9-]+\.forgeblocks\.com)' | grep -qv 'example\.\|tenant\.example\|forgeblocks\.com/example'; then
    echo "$f"
  fi
done)

FOUND="${SECRETS}${PATTERNS}${ENVFILES}${SANDBOX}${AIC_URLS}"

if [ -n "$FOUND" ]; then
  echo "BLOCKED: Potential secrets, sandbox files, or real AIC tenant URLs detected in staged files:" >&2
  echo "$FOUND" | sort -u >&2
  echo "Review these files before committing. See .claude/rules/security.md." >&2
  exit 2
fi

exit 0
