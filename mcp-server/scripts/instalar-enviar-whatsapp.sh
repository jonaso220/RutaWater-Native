#!/bin/zsh
# Instala lo que aprieta Enviar en WhatsApp del Mac para mandar_mensaje (30/10/2026):
# enviar.applescript (lo que hace; se actualiza siempre) y «RutaWater Enviar.app»
# (solo si falta: tiene el permiso de Accesibilidad y rearmarla lo pierde; con
# --app se rearma igual y hay que volver a darle el permiso en Ajustes del Sistema →
# Privacidad y seguridad → Accesibilidad).
set -e
DIR="$HOME/.rutawater-mcp/enviar-whatsapp"
APP="$DIR/RutaWater Enviar.app"
mkdir -p "$DIR"
cp "${0:A:h}/enviar-whatsapp.applescript" "$DIR/enviar.applescript"
if [[ -d "$APP" && "$1" != "--app" ]]; then echo "Actualizado: $DIR/enviar.applescript"; exit 0; fi
rm -rf "$APP"
osacompile -o "$APP" "${0:A:h}/enviar-whatsapp-app.applescript"
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.olivera.rutawater-enviar" "$APP/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.olivera.rutawater-enviar" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$APP/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :LSUIElement true" "$APP/Contents/Info.plist"
# Con el certificado de desarrollador el permiso queda atado a la app y no a su
# huella (firmada «-» macOS no la reconocía después de rearmarla).
IDENTITY=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Apple Development: [^"]*\)".*/\1/p' | head -1)
codesign --force --sign "${IDENTITY:--}" "$APP"
echo "Instalada: $APP"
