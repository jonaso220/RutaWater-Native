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
