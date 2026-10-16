# Seguimiento del camión (webapp para clientes)

Una página que sirve solo para ver dónde está el camión. Cuando el repartidor toca «En camino», al cliente le llega por WhatsApp un link que le muestra «¡Estamos cerca!» y el camión en vivo durante 30 minutos. Lo abre sin cuenta ni app. La ubicación sale de Realtime Database (`seguimiento/<token>`) y la página la escucha en vivo por streaming REST (`EventSource`), sin SDK de Firebase. El mapa usa Leaflet (incluido en `vendor/`) con mapas de OpenStreetMap.

## Link

```
https://rutawater.web.app/s/<token>
```

`token` tiene entre 22 y 64 caracteres `A-Z a-z 0-9 _ -` y es aleatorio. Se crea uno nuevo **en cada aviso «En camino»**, con `vence` = ahora + 30 minutos. Mientras dura el reparto, la app escribe cada posición en todos los links que todavía no vencieron (normalmente uno o dos a la vez). Quien no tiene el link no puede adivinarlo ni listar los otros.

## Formato del dato (`seguimiento/<token>`)

Lo escribe la app del repartidor y lo validan las reglas en [`database.rules.json`](../../database.rules.json).

| Campo | Tipo | Notas |
|---|---|---|
| `ownerUid` | string | uid del repartidor. Solo él puede escribir el registro. |
| `estado` | `preparado` · `en_camino` · `terminado` | `preparado`: el link ya existe pero el camión no salió. |
| `dia` | `aaaa-mm-dd` | Día del reparto. |
| `vence` | ms | Hasta cuándo se puede leer: 30 minutos desde el aviso (las reglas aceptan hasta 2 h). Después de esa hora las reglas no dejan leer ni escribir más posiciones (solo borrar), y la página dice que el seguimiento terminó. |
| `actualizado` | ms | Siempre `ServerValue.TIMESTAMP`, así la hora es la del servidor. |
| `lat`, `lng`, `precision`, `rumbo` | number | **Solo** con `en_camino`. Al pasar a `terminado` hay que borrarlos (`null`), o las reglas rechazan la escritura. |
| `rastro/<pushId>` | `{lat, lng, t}` | Recorrido desde el aviso, un `push` cada tanto. También se borra al terminar. |
| `titulo` | string ≤ 60 | Opcional. Se muestra arriba (por defecto «RutaWater»). |

Cuando la posición no se actualiza hace más de 3 minutos, la página avisa «sin señal» y muestra la última ubicación conocida.

## En la app del repartidor

El botón «En camino» de la tarjeta del cliente ([`ClientCard`](../../src/components/ClientCard.tsx)) llama a `startEnCaminoLink` ([`src/services/liveTracking.ts`](../../src/services/liveTracking.ts)), que hace esto:

1. Pide permiso de ubicación (solo «mientras se usa la app»). Si el permiso se niega, el mensaje sale como antes, sin link.
2. Crea el link de 30 minutos y abre WhatsApp enseguida, sin esperar al servidor. El link va donde la plantilla diga `{link}`, o en una línea al final («Mira el camión en vivo: …»).
3. Empieza a mandar el GPS, como mucho cada 10 segundos, a todos los links vivos, y suma un punto al recorrido cada 40 m o cada minuto. Esto sigue funcionando con la pantalla bloqueada: en iOS por el modo de segundo plano `location`; en Android por un servicio en primer plano (Notifee) con una notificación que tiene el botón «Dejar de compartir».
4. Cuando vence el último link, apaga el GPS y borra los registros.

Para probar la app contra el emulador, en `liveTracking.ts` poner `EMULATOR_HOST = '127.0.0.1'` (simulador de iOS) o `'10.0.2.2'` (emulador de Android). En el simulador de iOS, la ubicación se mueve con `xcrun simctl location booted start …`.

## Probar en local

1. Levantar los emuladores de hosting y de la base. Es la configuración `seguimiento` de `.claude/launch.json`:

   ```bash
   firebase emulators:start --only hosting,database --project demo-rutawater
   ```

2. Simular un reparto (imprime el link que hay que abrir):

   ```bash
   node web/seguimiento/dev/simular-camion.mjs
   ```

   Con `--terminar` cierra el reparto al final.

Las reglas tienen tests en `tests/firestore/__tests__/liveTracking.database.test.ts`, y corren con `npm run test:rules`.

## Publicar (una sola vez)

1. Firebase → Realtime Database → **Crear base de datos** → ubicación **Estados Unidos (us-central1)**. La URL tiene que ser `https://rutawater-default-rtdb.firebaseio.com`, que es la que usa `app.js`. Arrancar en modo bloqueado: las reglas reales se suben en el paso siguiente.
2. Subir las reglas y la página:

   ```bash
   firebase deploy --only database,hosting
   ```

## Costo

Cada link se mira como mucho 30 minutos. Con 130 avisos por día, una actualización cada 15 segundos y unos 300 bytes por actualización, son unos 15 MB por día: menos de 0,5 GB por mes. La parte gratis de Realtime Database es de 10 GB por mes, y la de Hosting también es de 10 GB por mes. Cuando la pestaña queda en segundo plano, la página corta la conexión y deja de descargar.
