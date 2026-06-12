// Archivo intencionalmente vacío: fuerza a Xcode a linkear con el driver de Swift,
// que agrega las librerías de compatibilidad (swiftCompatibility56) que los pods
// con Swift (Firebase) necesitan al apuntar a iOS < 16. Sin esto, el archive en
// Xcode Cloud falla con "Undefined symbol: __swift_FORCE_LOAD_$_swiftCompatibility56".
