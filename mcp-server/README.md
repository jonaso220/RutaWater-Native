# RutaWater MCP

Servidor [MCP](https://modelcontextprotocol.io) local para que un asistente (Claude, Codex) lea y edite RutaWater directamente en Firestore, sin controlar la interfaz del Mac.

Reutiliza la lógica de la app (`src/utils`): la agenda se calcula con `getNextVisitDate` y «Listo» usa el mismo reductor de comandos de visita que el botón, así que el resultado es idéntico y se puede deshacer desde la app.

## Herramientas

| Lectura | Escritura |
|---|---|
| `listar_repartos`, `ver_productos` | `fijar_productos` (solo los indicados; 0 quita) |
| `buscar_clientes` (nombre, dirección o teléfono) | `actualizar_nota` (con `nota_esperada` para no pisar cambios) |
| `ver_cliente` (ficha completa, Parentesco con WhatsApp de cada familiar, deudas) | `marcar_favorito` (fija, no alterna) |
| `agenda_del_dia` («hoy», «mañana» o aaaa-mm-dd, con atrasadas y plantillas de WhatsApp) | `marcar_listo` (rechaza fechas que no son visita pendiente) |
| `listar_deudas` | `deshacer_listo` |

No hay herramientas para borrar clientes, tocar deudas, precios ni frecuencias. Cada escritura queda en `~/.rutawater-mcp/audit.jsonl` con el antes y el después.

## Instalación

```bash
cd mcp-server
npm install
npm run build
```

`firebase-admin` se toma de `node_modules` de la app (correr `npm install` en la raíz).

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
      "args": ["/Volumes/OLIVERA/RutaWater-Native/mcp-server/dist/server.cjs"],
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
