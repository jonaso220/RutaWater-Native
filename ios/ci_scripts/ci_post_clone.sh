#!/bin/zsh
set -e

# Xcode Cloud: preparar el entorno antes de compilar (React Native).
# Este script corre automáticamente después de clonar el repo en la nube.

# 1) Node — las build phases de React Native y el Podfile lo necesitan
brew install node

# 2) Dependencias JS (npm ci usa package-lock.json)
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm ci

# 3) CocoaPods — genera ios/RutaWaterNative.xcworkspace (no está commiteado)
command -v pod >/dev/null 2>&1 || brew install cocoapods
cd ios
pod install

# 4) Las build phases de RN/Hermes corren con el PATH pelado de Xcode:
#    dejarles la ruta absoluta del node de la nube en .xcode.env.local
echo "export NODE_BINARY=$(command -v node)" > .xcode.env.local
