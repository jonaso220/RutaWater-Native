# RutaWater MCP

Servidor [MCP](https://modelcontextprotocol.io) local para que un asistente (Claude, Codex) lea y edite RutaWater directamente en Firestore, sin controlar la interfaz del Mac.

Reutiliza la lógica de la app (`src/utils`): la agenda se calcula con `getNextVisitDate` y «Listo» usa el mismo reductor de comandos de visita que el botón, así que el resultado es idéntico y se puede deshacer desde la app.

## Herramientas

| Lectura | Escritura |
|---|---|
| `listar_repartos`, `ver_productos` | `fijar_productos` (solo los indicados; 0 quita) |
| `buscar_clientes` (nombre, dirección o teléfono) | `actualizar_nota` (con `nota_esperada` para no pisar cambios) |
| `ver_cliente` (ficha completa, Parentesco con WhatsApp de cada familiar, deudas con total, transferencia pendiente y mensaje de «Enviar total») | `marcar_favorito` (fija, no alterna) |
| `agenda_del_dia` («hoy», «mañana» o aaaa-mm-dd, con atrasadas y plantillas de WhatsApp) | `marcar_listo` (rechaza fechas que no son visita pendiente) |
| `sugerir_posicion` (inserción más barata en el recorrido de una fecha, en línea recta; sin coordenadas no sugiere y dice cuáles faltan) | `cambiar_posicion` (como «Cambiar posición» de la tarjeta: mismo `planPositionChange` que la app, una escritura) |
| `listar_deudas` | `deshacer_listo` |
| | `adelantar_visita` (próxima visita a una fecha más cercana del mismo día) |
| | `agendar_una_vez` (como Directorio → Agendar → Una vez: la ficha de directorio pasa a ser la visita; a un cliente en agenda se le agrega otra ficha; no duplica una visita del mismo día; rechaza fechas pasadas; con `ubicar: true` la deja donde indica `sugerir_posicion` en vez de primera) |
| | `cambiar_frecuencia` (semanal, quincenal, cada 3 semanas, mensual; mantiene los días) |
| | `cambiar_fecha` (como la fecha de inicio de Editar cliente: la próxima visita a cualquier fecha futura, opcionalmente con otra frecuencia; un cliente de un solo día o un pedido de una vez pasa al día de esa fecha, con `ubicar: true` donde indica `sugerir_posicion`) |
| | `quitar_de_la_lista` (como «Quitar de la lista» de Inicio: saca ese día de semana; si era el único vuelve al Directorio; un pedido de una vez repetido se borra en vez de quedar como copia) |
| | `registrar_pago` (como Registrar pago / Editar deuda: salda las más viejas primero, deja el saldo de un pago parcial; exige `deuda_esperada` para no pagar dos veces; devuelve el `sobrante`) |
| | `marcar_revisar_transferencia` (como «Revisar» en Deudas; no duplica y nunca marca como revisada) |
| | `crear_cliente` (como Directorio → «+»: ficha solo de directorio, sin productos ni visitas, con coordenadas del link de Maps; si ya hay una ficha con ese teléfono no crea otra) |

WhatsApp por la API de YCloud (coexistencia con la app de WhatsApp Business, desde el 23/10/2026): la función de Netlify `whatsapp-webhook` (`/api/whatsapp-webhook`, firma `YCloud-Signature` con `YCLOUD_WEBHOOK_SECRET`) guarda en `whatsappInbox` los mensajes de clientes y los que salen desde la app, menos los chats de `WHATSAPP_EXCLUDED_PHONES` y los grupos. El servidor los usa con:

- `leer_whatsapp` (pendientes por chat, con 48 h de conversación, fichas por teléfono y fin de la ventana de 24 h; `uso` del mes)
- `transcribir_whatsapp` (baja los audios con la clave y los transcribe con Whisper) y `ver_archivo_whatsapp` (fotos como imagen)
- `responder_whatsapp` (texto dentro de las 24 h, nunca a excluidos, con tope mensual en `whatsappUsage/AAAA-MM`; por defecto 3.600 = 1.000 gratis + ~US$30)
- `marcar_whatsapp_atendido` (los saca de pendientes y marca leído el último de cada chat)

Clave en `~/.rutawater-mcp/ycloud.key` (no se respalda) y configuración en `~/.rutawater-mcp/whatsapp.json` (`negocio`, `excluidos`, `tope_mes`). Los avisos y recordatorios no van por la API: son plantillas y se cobran siempre.

Fuera de Firestore, en el Mac donde corre el servidor (para que también las usen las tareas de la nube, cuyos comandos corren en una VM):

- `abrir_whatsapp` abre `whatsapp://send` con el número de la ficha y un borrador: el aviso de mañana de Ajustes (`plantilla: "aviso_manana"`) o un `texto`, con `reemplazar` opcional (`«viejo=>nuevo»`, cada uno exactamente una vez). Es el mismo enlace que Avisar o el ícono de WhatsApp de la tarjeta; no envía.
- `transcribir_audio` transcribe con Whisper los últimos audios de WhatsApp guardados en `~/Downloads` (script de la skill `whatsapp-rutawater`; rutas en `RUTAWATER_WHISPER_PYTHON`, `RUTAWATER_TRANSCRIBIR` y `RUTAWATER_DESCARGAS`).

No hay herramientas para borrar clientes (salvo la copia que sobra al fusionar o un pedido de una vez repetido) ni editar sus contactos, crear o editar deudas a mano, marcar transferencias como revisadas, tocar precios ni cambiar los días de un cliente con varios días. Cada escritura queda en `~/.rutawater-mcp/audit.jsonl` con el antes y el después.

## Instalación

```bash
cd mcp-server
npm install
npm run build
```

`firebase-admin` se toma de `node_modules` de la app (correr `npm install` en la raíz).

### Copia instalada en el disco interno

Para que el servidor no dependa del repo ni de un disco externo, `./install-local.sh` arma una copia autónoma en `~/.rutawater-mcp/server` (programa + `firebase-admin` + SDK de MCP). Claude Code la tiene registrada a nivel de usuario apuntando a `~/.rutawater-mcp/server/server.cjs`. **Después de cambiar el servidor, volver a correr `./install-local.sh`** para que los cambios lleguen a la copia instalada.

## Coordenadas y posición en el recorrido

Las fichas guardan `lat`/`lng` (strings, como el resto de la app) en cada dirección y en los campos de la ubicación principal. La app los completa en segundo plano al crear o editar una ubicación con link de Google Maps (`src/services/clientCoordinates.ts`): sigue la redirección del link corto y toma las coordenadas de la URL (`src/utils/geo.ts`). Un link que solo nombra un lugar (`?q=<nombre>&ftid=…`) no trae coordenadas y queda sin resolver.

`sugerir_posicion` toma las paradas de esa fecha en el orden del día y busca el par consecutivo A, B que minimiza d(A,P) + d(P,B) − d(A,B) (haversine), o un extremo. Si al cliente o a una parada le falta lat/lng devuelve `posicion: null` con la lista `sin_coordenadas`, salvo `ignorar_sin_coordenadas: true`. `posicion` es el número de tarjeta en la lista completa de ese día de semana, el mismo que recibe `cambiar_posicion`.

Para las fichas que ya existían, un script de una sola vez:

```bash
npm run build
GOOGLE_APPLICATION_CREDENTIALS=~/.rutawater-mcp/service-account.json RUTAWATER_EMAIL=<email> \
  node dist/completar-coordenadas.cjs --escribir
```

Lee las fichas de cada reparto una sola vez (una consulta por reparto), resuelve cada link distinto una vez (caché en `~/.rutawater-mcp/coordenadas-cache.json`) y escribe solo las fichas que cambian, con la hora de actualización leída como condición: si una ficha cambió mientras tanto no se pisa. Sin `--escribir` solo informa. Deja la cobertura y las fichas sin resolver en `~/.rutawater-mcp/coordenadas-reporte.json`.

## Configuración (variables de entorno)

| Variable | Uso |
|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | Ruta al JSON de la cuenta de servicio (Firebase → Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada). Guardarlo fuera del repo, con `chmod 600`. |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | Alternativa: el mismo JSON en base64 (formato de las Netlify Functions). |
| `RUTAWATER_EMAIL` o `RUTAWATER_UID` | Cuenta de RutaWater por la que actúa el servidor. Solo ve y edita los repartos de esa cuenta. |
| `RUTAWATER_MCP_READONLY=1` | Registra solo las herramientas de lectura. |
| `RUTAWATER_MCP_AUDIT` | Ruta alternativa del registro de auditoría. |
| `RUTAWATER_TZ` | Zona horaria de la agenda (por defecto `America/Montevideo`). |
| `RUTAWATER_MCP_CARGAS_DIARIAS` | Tope de cargas completas por día (por defecto `250`, unas 50.000 lecturas, el límite gratis de Firestore; `0` = sin tope). Ver abajo. |
| `RUTAWATER_MCP_LECTURAS_POR_HORA` | Tope de documentos que un mismo proceso puede leer en cargas completas en una hora (por defecto `10000`; `0` = sin tope). Corta un bucle que relee todo antes de agotar la cuota del día. |
| `RUTAWATER_MCP_CARGAS_DIR` | Carpeta del registro diario de cargas (por defecto `~/.rutawater-mcp/cargas`). |

### Tope diario de cargas completas

Cada vez que el servidor arranca vuelve a leer, una vez por reparto, todas las fichas, deudas o transferencias que necesita. También lo hacen `agendar_una_vez`, `registrar_pago` y `marcar_revisar_transferencia`, dentro de su transacción. Esas son las «cargas completas», y son las lecturas que más pesan en la cuota de Firestore. Esa cuota es de toda la cuenta: la comparte con la app. Si un agente entra en un bucle que abre el servidor una y otra vez, la puede agotar.

Cada carga se anota como una línea (con cuántos documentos trajo) en `~/.rutawater-mcp/cargas/<día>.jsonl`. El registro es compartido entre todos los procesos del servidor. Al llegar al tope, las herramientas que necesitan otra carga devuelven un error y no leen nada. Lo que ya está cargado en un proceso sigue funcionando en vivo.

El día es el de la cuota de Firestore: cambia a la medianoche del Pacífico, que son las 04:00 de Uruguay (o las 05:00 durante el horario de invierno de EE. UU.). Para ver cuánto se usó hoy:

```bash
wc -l ~/.rutawater-mcp/cargas/*.jsonl
```

Ejemplo de `.mcp.json` (Claude Code):

```json
{
  "mcpServers": {
    "rutawater": {
      "command": "node",
      "args": ["/Users/<usuario>/.rutawater-mcp/server/server.cjs"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/Users/<usuario>/.rutawater-mcp/service-account.json",
        "RUTAWATER_EMAIL": "<email de la cuenta>",
        "RUTAWATER_MCP_READONLY": "1"
      }
    }
  }
}
```

## Pruebas

```bash
npm test
```

Corre las pruebas contra el emulador de Firestore (proyecto `demo-rutawater`, nunca producción) y después una prueba de punta a punta que levanta el servidor por stdio y llama a cada herramienta.
