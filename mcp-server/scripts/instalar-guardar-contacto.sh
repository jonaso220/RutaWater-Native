#!/bin/zsh
# Instala lo que guarda los contactos para guardar_contacto (2/11/2026): guardar.js
# (lo que hace; se actualiza siempre) y «RutaWater Contactos.app» (solo si falta:
# tiene el permiso de Contactos; con --app se rearma igual).
set -e
DIR="$HOME/.rutawater-mcp/guardar-contacto"
APP="$DIR/RutaWater Contactos.app"
mkdir -p "$DIR"
cp "${0:A:h}/guardar-contacto.js" "$DIR/guardar.js"
if [[ -d "$APP" && "$1" != "--app" ]]; then echo "Actualizado: $DIR/guardar.js"; exit 0; fi
rm -rf "$APP"
osacompile -l JavaScript -o "$APP" "${0:A:h}/guardar-contacto-app.js"
PLIST="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.olivera.rutawater-contactos" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.olivera.rutawater-contactos" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :LSUIElement true" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :NSAppleEventsUsageDescription string 'Guardar a los clientes de RutaWater en Contactos.'" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :NSAppleEventsUsageDescription 'Guardar a los clientes de RutaWater en Contactos.'" "$PLIST"
# Con el certificado de desarrollador el permiso queda atado a la app y no a su huella.
IDENTITY=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Apple Development: [^"]*\)".*/\1/p' | head -1)
codesign --force --sign "${IDENTITY:--}" "$APP"
echo "Instalada: $APP"
