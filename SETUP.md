# RutaWater Native - Setup Guide

## Requisitos previos

1. **Node.js** (v18+): `brew install node`
2. **Watchman**: `brew install watchman`
3. **Xcode** (desde App Store, version 15+)
4. **CocoaPods**: `sudo gem install cocoapods`
5. **Ruby** (viene con macOS)

## Paso 1: Instalar dependencias

```bash
cd RutaWaterNative
npm install
cd ios && pod install && cd ..
```

## Paso 2: Configurar Firebase para iOS

1. Ir a [Firebase Console](https://console.firebase.google.com) > Proyecto `rutawater`
2. Agregar una app iOS:
   - **Bundle ID**: `com.rutawater.native` (o el que elijas)
   - Descargar `GoogleService-Info.plist`
3. Copiar `GoogleService-Info.plist` a `ios/RutaWaterNative/`
4. En Xcode, agregar el archivo al proyecto (drag & drop, marcar "Copy items if needed")

## Paso 3: Configurar Google Sign-In

1. En Firebase Console > Authentication > Sign-in method > Google (debe estar habilitado)
2. En `GoogleService-Info.plist`, buscar el valor de `REVERSED_CLIENT_ID`
3. En Xcode > RutaWaterNative > Info > URL Types, agregar:
   - **URL Schemes**: el valor de `REVERSED_CLIENT_ID`
4. En `src/hooks/useAuth.ts`, reemplazar el `webClientId` con el de tu proyecto:
   - Lo encuentras en Firebase Console > Authentication > Sign-in method > Google > Web client ID

## Paso 4: Ejecutar

```bash
# Terminal 1: Metro bundler
npm start

# Terminal 2: Build iOS
npm run ios
```

## Paso 5: Probar en iPhone fisico

1. Conectar iPhone por USB
2. En Xcode: seleccionar tu iPhone como destino
3. Xcode > Signing & Capabilities: seleccionar tu Apple ID como Team
4. Build & Run (Cmd+R)

## Estructura del proyecto

```
src/
├── config/firebase.ts     # Firebase init (usa GoogleService-Info.plist)
├── constants/products.ts  # Productos, dias, frecuencias
├── types/index.ts         # TypeScript interfaces (Client, Debt, etc)
├── utils/helpers.ts       # Funciones utilitarias (port del web app)
├── hooks/
│   ├── useAuth.ts         # Hook de autenticacion (Google Sign-In)
│   └── useClients.ts      # Hook de clientes (Firestore real-time)
├── navigation/
│   └── AppNavigator.tsx   # Tab navigator (Inicio, Directorio)
├── screens/
│   ├── LoginScreen.tsx    # Pantalla de login
│   ├── HomeScreen.tsx     # Pantalla principal con lista de clientes
│   └── DirectoryScreen.tsx # Directorio de clientes
└── components/
    └── ClientCard.tsx     # Tarjeta de cliente / nota
```

## Base de datos

Usa la **misma** base de datos Firestore que la web app (proyecto `rutawater`).
Todos los cambios se sincronizan en tiempo real entre ambas apps.
