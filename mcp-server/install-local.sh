#!/bin/zsh
# Instala una copia autónoma del servidor MCP en el disco interno del Mac
# (~/.rutawater-mcp/server), para que no dependa de que el repo o un disco
# externo estén montados. Volver a correrlo después de cambiar el servidor.
#
#   cd mcp-server && ./install-local.sh
set -euo pipefail

SRC_DIR="${0:A:h}"
DEST="${RUTAWATER_MCP_HOME:-$HOME/.rutawater-mcp}/server"
FIREBASE_ADMIN_VERSION="$(node -p "require('$SRC_DIR/../package.json').dependencies['firebase-admin']")"
MCP_SDK_VERSION="$(node -p "require('$SRC_DIR/package.json').devDependencies['@modelcontextprotocol/sdk']")"

cd "$SRC_DIR"
node build.mjs

mkdir -p "$DEST"
cat > "$DEST/package.json" <<EOF
{
  "name": "rutawater-mcp-local",
  "private": true,
  "description": "Copia instalada del servidor MCP de RutaWater (generada por mcp-server/install-local.sh; no editar).",
  "dependencies": {
    "firebase-admin": "$FIREBASE_ADMIN_VERSION",
    "@modelcontextprotocol/sdk": "$MCP_SDK_VERSION"
  }
}
EOF
# El SDK solo lo usa el cliente de respaldo de la skill; el servidor lo lleva empaquetado.
(cd "$DEST" && npm install --omit=dev --no-audit --no-fund --loglevel=error)

cp dist/server.cjs "$DEST/server.cjs.tmp"
mv "$DEST/server.cjs.tmp" "$DEST/server.cjs"
echo "Instalado en $DEST/server.cjs"
