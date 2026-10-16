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
| `listar_deudas` | `deshacer_listo` |
| | `adelantar_visita` (próxima visita a una fecha más cercana del mismo día) |
| | `agendar_una_vez` (como Directorio → Agendar → Una vez: la ficha de directorio pasa a ser la visita; a un cliente en agenda se le agrega otra ficha; no duplica una visita del mismo día; rechaza fechas pasadas) |
| | `cambiar_frecuencia` (semanal, quincenal, cada 3 semanas, mensual; mantiene los días) |
| | `registrar_pago` (como Registrar pago / Editar deuda: salda las más viejas primero, deja el saldo de un pago parcial; exige `deuda_esperada` para no pagar dos veces; devuelve el `sobrante`) |
| | `marcar_revisar_transferencia` (como «Revisar» en Deudas; no duplica y nunca marca como revisada) |

No hay herramientas para borrar clientes, crear o editar deudas a mano, marcar transferencias como revisadas, tocar precios ni cambiar el día de visita. Cada escritura queda en `~/.rutawater-mcp/audit.jsonl` con el antes y el después.

## Instalación

```bash
cd mcp-server
npm install
npm run build
```

`firebase-admin` se toma de `node_modules` de la app (correr `npm install` en la raíz).

### Copia instalada en el disco interno

Para que el servidor no dependa del repo ni de un disco externo, `./install-local.sh` arma una copia autónoma en `~/.rutawater-mcp/server` (programa + `firebase-admin` + SDK de MCP). Claude Code la tiene registrada a nivel de usuario apuntando a `~/.rutawater-mcp/server/server.cjs`. **Después de cambiar el servidor, volver a correr `./install-local.sh`** para que los cambios lleguen a la copia instalada.

## Configuración (variables de entorno)

| Variable | Uso |
|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | Ruta al JSON de la cuenta de servicio (Firebase → Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada). Guardarlo fuera del repo, con `chmod 600`. |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | Alternativa: el mismo JSON en base64 (formato de las Netlify Functions). |
| `RUTAWATER_EMAIL` o `RUTAWATER_UID` | Cuenta de RutaWater por la que actúa el servidor. Solo ve y edita los repartos de esa cuenta. |
| `RUTAWATER_MCP_READONLY=1` | Registra solo las herramientas de lectura. |
| `RUTAWATER_MCP_AUDIT` | Ruta alternativa del registro de auditoría. |
| `RUTAWATER_TZ` | Zona horaria de la agenda (por defecto `America/Montevideo`). |

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
