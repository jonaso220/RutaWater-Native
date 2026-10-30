#!/bin/zsh
# Instala «RutaWater Enviar.app», la que aprieta Enviar en WhatsApp del Mac para
# mandar_mensaje (30/10/2026). Después hay que darle permiso una vez en Ajustes
# del Sistema → Privacidad y seguridad → Accesibilidad. Recompilarla pide el permiso de nuevo.
set -e
DIR="$HOME/.rutawater-mcp/enviar-whatsapp"
APP="$DIR/RutaWater Enviar.app"
mkdir -p "$DIR"
osacompile -o "$APP" "${0:A:h}/enviar-whatsapp.applescript"
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.olivera.rutawater-enviar" "$APP/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.olivera.rutawater-enviar" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$APP/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :LSUIElement true" "$APP/Contents/Info.plist"
codesign --force --sign - "$APP"
echo "Instalada: $APP"
