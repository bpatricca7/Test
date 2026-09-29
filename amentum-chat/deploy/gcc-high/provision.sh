#!/usr/bin/env bash
# Provision Azure OpenAI in Azure Government (GCC High) for Amentum AI.
#
#   RG=rg-amentum-ai LOCATION=usgovvirginia ACCOUNT=amentum-ai-openai ./provision.sh
#
# Requires the Azure CLI. Everything targets the AzureUSGovernment cloud.
set -euo pipefail

RG="${RG:?set RG}"
LOCATION="${LOCATION:-usgovvirginia}"
ACCOUNT="${ACCOUNT:?set ACCOUNT}"
APP_NAME="${APP_NAME:-amentum-ai}"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> Switching Azure CLI to Azure Government"
az cloud set --name AzureUSGovernment
az account show >/dev/null 2>&1 || az login

echo "==> Resource group $RG ($LOCATION)"
az group create -n "$RG" -l "$LOCATION" -o none

echo "==> App registration + service principal for Entra ID auth ($APP_NAME)"
APP_ID="$(az ad app list --display-name "$APP_NAME" --query '[0].appId' -o tsv)"
if [[ -z "$APP_ID" ]]; then
  APP_ID="$(az ad app create --display-name "$APP_NAME" --query appId -o tsv)"
fi
SP_ID="$(az ad sp show --id "$APP_ID" --query id -o tsv 2>/dev/null || az ad sp create --id "$APP_ID" --query id -o tsv)"

echo "==> Deploying Azure OpenAI account + model deployments"
az deployment group create -g "$RG" -f "$HERE/main.bicep" -p "$HERE/main.bicepparam" \
  -p accountName="$ACCOUNT" location="$LOCATION" appPrincipalId="$SP_ID" -o none

ENDPOINT="$(az cognitiveservices account show -n "$ACCOUNT" -g "$RG" --query properties.endpoint -o tsv)"
TENANT_ID="$(az account show --query tenantId -o tsv)"

cat <<EOF

Done. Put these in env/app.env (from env/gcc-high.env.example):

  LLM_PROVIDER=azure_gcc_high
  AZURE_OPENAI_ENDPOINT=$ENDPOINT
  AZURE_AUTH=entra
  AZURE_TENANT_ID=$TENANT_ID
  AZURE_CLIENT_ID=$APP_ID

Then add a credential for the app registration (certificate recommended):
  az ad app credential reset --id $APP_ID --create-cert --keyvault <kv-name> --cert amentum-ai-sp
  # or, for a client secret:  az ad app credential reset --id $APP_ID --display-name amentum-ai

Available models in this region (for main.bicepparam versions):
  az cognitiveservices account list-models -n $ACCOUNT -g $RG -o table
EOF
