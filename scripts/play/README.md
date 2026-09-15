# Publicación Android en Google Play

El workflow **Android - Google Play** se ejecuta al publicar en `main` un incremento de `versionCode` en `android/app/build.gradle`. Compila, ejecuta las pruebas, firma con la clave de subida de RutaWater y carga un **borrador en Producción**. Los cambios sin incremento de código no generan una subida.

Con cada versión, actualizar también `scripts/play/release-notes.json` (máximo 500 caracteres por idioma). No guardar contraseñas ni claves en Git.

## Botón manual

Abrir [GitHub Actions](https://github.com/jonaso220/RutaWater-Native/actions/workflows/android-play.yml), elegir **Run workflow**, rama **main**:

- `verify`: compila y firma; comprueba acceso al canal sin subir ni enviar a revisión.
- `upload`: compila y sube la versión actual como borrador si aún no existe.
- `submit`: envía el borrador a Google Play. Introducir su código exacto en `version_code`; debe coincidir con el código de `main`. No recompila.

La aprobación y publicación dependen de Google y de los ajustes de publicación de Play Console. Enviar un borrador mientras hay cambios en revisión puede reiniciar esa revisión. La subida automática se detiene si ya hay una revisión en curso (volver a ejecutar `upload` cuando termine) y solicita explícitamente no enviar cambios a revisión; si Google no acepta esa modalidad, el workflow falla sin reintentar un envío.

No se sobrescriben otros borradores ni se suben códigos duplicados. Resolver primero cualquier borrador anterior en Play Console. Una ejecución fallida muestra el error en Actions; `verify` es una comprobación segura para diagnosticar el acceso.

## Credenciales

Los cinco secretos `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_KEY_ALIAS`, `ANDROID_UPLOAD_STORE_PASSWORD`, `ANDROID_UPLOAD_KEY_PASSWORD` y `ANDROID_GOOGLE_SERVICES_JSON` pertenecen exclusivamente a esta app. Las variables `PLAY_WIF_PROVIDER` y `PLAY_SERVICE_ACCOUNT` conectan GitHub con Google mediante identidad federada y tokens temporales, sin claves JSON permanentes. Solo se permite el repositorio correcto y la rama `main` con eventos push o workflow_dispatch.

El bundle firmado queda como artefacto de Actions durante 14 días. Para revocar publicación, retirar la cuenta técnica de Usuarios y permisos en Play Console y deshabilitar su proveedor de identidad en Google Cloud.
