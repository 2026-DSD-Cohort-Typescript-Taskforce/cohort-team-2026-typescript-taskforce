#!/usr/bin/env bash
# Sign in as the local seeded user, save the access token, then POST a PDF to extract-invoices.
# Usage: scripts/extract-invoice.sh

set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

pdf="$root/CustomerBills/maple-junction-bill.pdf"
if [[ ! -f "$pdf" ]]; then
  echo "No such file: $pdf" >&2
  exit 1
fi

email=${EXTRACT_EMAIL:-alex.morgan@example.com}
password=${EXTRACT_PASSWORD:-local-dev-password}

eval "$(npx supabase status -o env)"

key=${PUBLISHABLE_KEY:-${ANON_KEY:-}}
if [[ -z "$key" || -z "${API_URL:-}" || -z "${FUNCTIONS_URL:-}" ]]; then
  echo "supabase status did not return API_URL, FUNCTIONS_URL, and a publishable key." >&2
  exit 1
fi

mkdir -p temp
token=$(
  curl -sS -f -X POST "${API_URL}/auth/v1/token?grant_type=password" \
    -H "apikey: ${key}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${email}\",\"password\":\"${password}\"}" \
    | jq -er '.access_token'
)
printf '%s\n' "$token" > temp/access-token.txt
echo "Wrote the access token to temp/access-token.txt"

curl -sS -X POST "${FUNCTIONS_URL}/extract-invoices" \
  -H "apikey: ${key}" \
  -H "Authorization: Bearer ${token}" \
  -H "Content-Type: application/pdf" \
  --data-binary @"$pdf"
echo
