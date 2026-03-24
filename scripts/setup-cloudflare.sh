#!/usr/bin/env bash
# ─────────────────────────────────────────────────────
# MortgageGuard — Cloudflare Infrastructure Setup
# Run once to provision all required resources.
# Prerequisites: wrangler CLI authenticated.
# ─────────────────────────────────────────────────────
set -euo pipefail

echo "=== MortgageGuard Cloudflare Setup ==="
echo ""

# ─── 1. KV Namespaces ───
echo "[1/5] Creating KV namespaces..."
RULE_CACHE_ID=$(wrangler kv namespace create RULE_CACHE --json | jq -r '.id')
SESSIONS_ID=$(wrangler kv namespace create SESSIONS --json | jq -r '.id')
echo "  RULE_CACHE: $RULE_CACHE_ID"
echo "  SESSIONS:   $SESSIONS_ID"

# ─── 2. R2 Buckets ───
echo "[2/5] Creating R2 buckets..."
wrangler r2 bucket create mortgageguard-documents 2>/dev/null || echo "  (already exists)"
wrangler r2 bucket create mortgageguard-exports 2>/dev/null || echo "  (already exists)"
wrangler r2 bucket create mortgageguard-documents-dev 2>/dev/null || echo "  (already exists)"
wrangler r2 bucket create mortgageguard-exports-dev 2>/dev/null || echo "  (already exists)"

# ─── 3. Queues ───
echo "[3/5] Creating queues..."
wrangler queues create compliance-events 2>/dev/null || echo "  (already exists)"
wrangler queues create audit-events 2>/dev/null || echo "  (already exists)"

# ─── 4. Hyperdrive ───
echo "[4/5] Hyperdrive setup..."
echo "  Create Hyperdrive manually with your Neon connection string:"
echo "  wrangler hyperdrive create mortgageguard-db --connection-string=\"postgres://user:pass@host/db\""
echo ""

# ─── 5. Secrets ───
echo "[5/5] Setting secrets..."
echo "  Set the following secrets in Cloudflare dashboard or via CLI:"
echo "  wrangler secret put JWT_SECRET"
echo "  wrangler secret put RESEND_API_KEY"
echo ""

# ─── Output wrangler.toml IDs ───
echo "=== Update apps/api/wrangler.toml with these IDs ==="
echo ""
echo "[[kv_namespaces]]"
echo "binding = \"RULE_CACHE\""
echo "id = \"$RULE_CACHE_ID\""
echo ""
echo "[[kv_namespaces]]"
echo "binding = \"SESSIONS\""
echo "id = \"$SESSIONS_ID\""
echo ""
echo "=== Setup complete! ==="
