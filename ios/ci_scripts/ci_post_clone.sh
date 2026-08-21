#!/bin/zsh
set -e

# Xcode Cloud: preparar el entorno antes de compilar (React Native).
# Este script corre automáticamente después de clonar el repo en la nube.

# Brew sin auto-update ni cleanup: más rápido y menos superficie de fallo
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1
export HOMEBREW_NO_ENV_HINTS=1

install_brew_formula() {
  local formula="$1"
  local executable="$2"
  local attempt

  if command -v "$executable" >/dev/null 2>&1; then
    return 0
  fi

  for attempt in 1 2 3; do
    if brew install "$formula"; then
      return 0
    fi

    # Homebrew puede terminar de instalar la fórmula aunque una descarga
    # paralela haya devuelto un error transitorio.
    if command -v "$executable" >/dev/null 2>&1; then
      return 0
    fi

    if [[ "$attempt" -lt 3 ]]; then
      echo "brew install $formula falló (intento $attempt/3); reintentando..."
      sleep $((attempt * 10))
    fi
  done

  echo "No se pudo instalar $formula después de 3 intentos." >&2
  return 1
}

# 1) Node — las build phases de React Native y el Podfile lo necesitan
install_brew_formula node node

# 2) Dependencias JS, con reintentos (la red de la nube a veces corta: ECONNRESET)
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm ci --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 || npm ci

# 3) CocoaPods — genera ios/RutaWaterNative.xcworkspace (no está commiteado)
install_brew_formula cocoapods pod
cd ios
pod install || pod install

# 4) Las build phases de RN/Hermes corren con el PATH pelado de Xcode:
#    dejarles la ruta absoluta del node de la nube en .xcode.env.local
echo "export NODE_BINARY=$(command -v node)" > .xcode.env.local
