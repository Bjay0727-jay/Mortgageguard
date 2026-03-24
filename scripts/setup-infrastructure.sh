#!/bin/bash
# ─────────────────────────────────────────────────────
# MortgageGuard — Infrastructure Setup Script
# Run this once to provision all Cloudflare resources
# ─────────────────────────────────────────────────────

set -e
echo "═══ MortgageGuard Infrastructure Setup ═══"
echo ""

# ─── Step 1: Create R2 Buckets ───
echo "[1/5] Creating R2 buckets..."
wrangler r2 bucket create mortgageguard-documents
wrangler r2 bucket create mortgageguard-exports
wrangler r2 bucket create mortgageguard-documents-dev
wrangler r2 bucket create mortgageguard-exports-dev
echo "  ✓ R2 buckets created"

# ─── Step 2: Create KV Namespaces ───
echo "[2/5] Creating KV namespaces..."
wrangler kv namespace create RULE_CACHE
wrangler kv namespace create SESSIONS
wrangler kv namespace create RULE_CACHE --preview
wrangler kv namespace create SESSIONS --preview
echo "  ✓ KV namespaces created"
echo "  ⚠ Copy the IDs above into wrangler.toml"

# ─── Step 3: Create Queues ───
echo "[3/5] Creating queues..."
wrangler queues create compliance-events
wrangler queues create audit-events
echo "  ✓ Queues created"

# ─── Step 4: Create Hyperdrive Config ───
echo "[4/5] Setting up Hyperdrive..."
echo "  Enter your Neon PostgreSQL connection string:"
read -p "  > " NEON_CONNECTION_STRING
wrangler hyperdrive create mortgageguard-db --connection-string="$NEON_CONNECTION_STRING"
echo "  ✓ Hyperdrive configured"
echo "  ⚠ Copy the Hyperdrive ID into wrangler.toml"

# ─── Step 5: Set Secrets ───
echo "[5/5] Setting Worker secrets..."
echo "  Enter JWT secret (min 32 chars):"
read -sp "  > " JWT_SECRET
echo "$JWT_SECRET" | wrangler secret put JWT_SECRET
echo ""
echo "  Enter Resend API key:"
read -sp "  > " RESEND_KEY
echo "$RESEND_KEY" | wrangler secret put RESEND_API_KEY
echo ""

echo ""
echo "═══ Setup Complete ═══"
echo ""
echo "Next steps:"
echo "  1. Update wrangler.toml with the KV and Hyperdrive IDs printed above"
echo "  2. Run 'pnpm db:generate' to generate Drizzle migrations"
echo "  3. Run 'pnpm db:migrate' to apply migrations to Neon"
echo "  4. Run 'pnpm db:seed' to seed Texas compliance rules"
echo "  5. Run 'pnpm dev' to start local development"
echo "  6. Run 'wrangler deploy' to deploy to production"
