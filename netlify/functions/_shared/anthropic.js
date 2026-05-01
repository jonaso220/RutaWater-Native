const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-haiku-4-5-20251001';

const PRODUCT_IDS = ['b20', 'b12', 'b6', 'soda', 'bombita', 'disp_elec_new', 'disp_elec_chg', 'disp_nat'];
const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const FREQUENCIES = ['weekly', 'biweekly', 'triweekly', 'monthly', 'once', 'on_demand'];

const TOOLS = [
  {
    name: 'create_new_client',
    description:
      'Crear un cliente nuevo en el directorio. Usar SOLO cuando el texto contiene datos suficientes para dar de alta un cliente que NO existe en la LISTA DE CLIENTES (al menos nombre, idealmente también dirección o productos).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nombre completo del cliente. Capitalizar correctamente (ej. "Manuel Couste", no "MANUEL COUSTE").' },
        phone: { type: 'string', description: 'Teléfono si se menciona, si no string vacío.' },
        address: {
          type: 'string',
          description:
            'Dirección completa. Si el texto separa "Dirección/Esquina/Detalle", combinalos en una sola línea legible (ej. "Jose P. Varela M. 38 Sol. 20, Esquina Sarmiento, Salinas"). Si no hay dirección, string vacío.',
        },
        mapsLink: {
          type: 'string',
          description:
            'URL de Google Maps si aparece en el texto (ej. "https://maps.app.goo.gl/...", "https://goo.gl/maps/...", "https://www.google.com/maps/..."). Si no hay link, string vacío. NO inventar URLs.',
        },
        notes: { type: 'string', description: 'Aclaraciones adicionales del texto que no entren en otros campos (ej. "REPO", "Cliente nuevo", instrucciones especiales). Vacío si no hay.' },
        products: {
          type: 'object',
          description: `Mapa producto_id → cantidad. IDs válidos: ${PRODUCT_IDS.join(', ')}. Solo incluir IDs con cantidad > 0.`,
          additionalProperties: { type: 'number' },
        },
        freq: {
          type: 'string',
          enum: FREQUENCIES,
          description:
            "Frecuencia: 'weekly' si dice 'los lunes/todos los martes' (recurrente). 'biweekly' si 'cada 15 días/quincenal'. 'monthly' si 'una vez al mes'. 'once' si fecha puntual ('el lunes', 'el 15'). 'on_demand' si no se especifica.",
        },
        visitDay: {
          type: 'string',
          enum: ['', ...DAY_NAMES],
          description: "Día de visita capitalizado en español. Vacío '' si no aplica (ej. once o on_demand sin día).",
        },
        specificDate: {
          type: 'string',
          description: "Fecha puntual ISO YYYY-MM-DD. Solo si freq='once', si no string vacío.",
        },
      },
      required: ['name', 'phone', 'address', 'mapsLink', 'notes', 'products', 'freq', 'visitDay', 'specificDate'],
    },
  },
  {
    name: 'schedule_existing_client',
    description:
      'Agendar un pedido (productos y/o día) para un cliente que YA EXISTE en la LISTA DE CLIENTES. Usar cuando hay un match claro con un cliente existente.',
    input_schema: {
      type: 'object',
      properties: {
        matched_client_id: {
          type: 'string',
          description: 'El id exacto del cliente de la LISTA DE CLIENTES (no inventar).',
        },
        matched_client_name: {
          type: 'string',
          description: 'El nombre del cliente matcheado, para mostrar al usuario.',
        },
        products: {
          type: 'object',
          description: `Productos del pedido. IDs válidos: ${PRODUCT_IDS.join(', ')}.`,
          additionalProperties: { type: 'number' },
        },
        freq: {
          type: 'string',
          enum: [...FREQUENCIES, 'keep'],
          description:
            "Frecuencia. 'keep' si el texto NO cambia la frecuencia (ej. solo agenda fecha puntual). 'once' si dice 'el lunes' o fecha puntual. 'weekly' si cambia a recurrente.",
        },
        visitDay: {
          type: 'string',
          enum: ['', ...DAY_NAMES],
          description: "Día capitalizado en español o vacío.",
        },
        specificDate: {
          type: 'string',
          description: "ISO YYYY-MM-DD si freq='once', si no vacío.",
        },
        notes: {
          type: 'string',
          description: 'Aclaraciones del texto. Vacío si no hay.',
        },
      },
      required: [
        'matched_client_id',
        'matched_client_name',
        'products',
        'freq',
        'visitDay',
        'specificDate',
        'notes',
      ],
    },
  },
  {
    name: 'merge_products_into_order',
    description:
      'Agregar/sumar productos al pedido YA AGENDADO de un cliente, sin crear un pedido nuevo ni cambiar día/fecha/frecuencia. Usar cuando el texto dice "agregale/sumale/añadile X al pedido de [cliente]" Y el cliente YA tiene un pedido pendiente (visible en LISTA DE CLIENTES como freq != on_demand). NO usar si el cliente está como on_demand (ahí hay que agendar con schedule_existing_client). NO usar para reemplazar productos, esto SUMA cantidades a las existentes.',
    input_schema: {
      type: 'object',
      properties: {
        matched_client_id: { type: 'string', description: 'ID exacto del cliente.' },
        matched_client_name: { type: 'string', description: 'Nombre para mostrar.' },
        add_products: {
          type: 'object',
          description: `Productos a SUMAR al pedido existente. IDs válidos: ${PRODUCT_IDS.join(', ')}. Solo los que se agregan, no los que ya tenía.`,
          additionalProperties: { type: 'number' },
        },
        notes: { type: 'string', description: 'Aclaración opcional. Vacío si no aplica.' },
      },
      required: ['matched_client_id', 'matched_client_name', 'add_products', 'notes'],
    },
  },
  {
    name: 'update_client_data',
    description:
      'Actualizar SOLO datos del cliente (dirección, teléfono, link de Google Maps, notas) SIN tocar agenda, productos, frecuencia ni día. Usar cuando el texto pide "agregar/actualizar/cambiar X a un cliente que ya existe en la LISTA DE CLIENTES" — por ejemplo "agregá esta URL a Manuel", "actualizá el teléfono de Pedro", "cambia la dirección de Ana". Solo incluir los campos que se mencionan en el texto, los demás dejarlos vacío "".',
    input_schema: {
      type: 'object',
      properties: {
        matched_client_id: { type: 'string', description: 'ID exacto del cliente de la LISTA.' },
        matched_client_name: { type: 'string', description: 'Nombre del cliente para mostrar.' },
        mapsLink: { type: 'string', description: 'URL de Google Maps si se quiere actualizar. Vacío si no aplica.' },
        address: { type: 'string', description: 'Nueva dirección si se quiere actualizar. Vacío si no aplica.' },
        phone: { type: 'string', description: 'Nuevo teléfono si se quiere actualizar. Vacío si no aplica.' },
        notes: { type: 'string', description: 'Nuevas notas si se quieren agregar. Vacío si no aplica.' },
      },
      required: ['matched_client_id', 'matched_client_name', 'mapsLink', 'address', 'phone', 'notes'],
    },
  },
  {
    name: 'report_not_found',
    description:
      'Usar cuando el texto pide agendar a un cliente específico (por nombre) que NO está en la LISTA DE CLIENTES y NO hay datos suficientes para crearlo (no hay dirección, productos, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        mentioned_name: { type: 'string', description: 'Nombre que el usuario mencionó.' },
        reason: { type: 'string', description: 'Mensaje breve para mostrar al usuario.' },
      },
      required: ['mentioned_name', 'reason'],
    },
  },
];

const SYSTEM_RULES = `Sos un asistente que estructura pedidos de aguatería en español rioplatense (Argentina).

Tu trabajo: leer un texto libre que describe un pedido y llamar EXACTAMENTE UNA de las herramientas (tools) provistas con los datos extraídos. Nunca respondas con texto plano, siempre llamá a una tool.

PRODUCTOS DISPONIBLES (usar estos IDs exactos):
- b20: Bidón 20L
- b12: Bidón 12L
- b6: Bidón 6L
- soda: Sifón Soda
- bombita: Bombita
- disp_elec_new: Dispensador eléctrico nuevo
- disp_elec_chg: Dispensador eléctrico (cambio)
- disp_nat: Dispensador natural

Sinónimos comunes: "botellón/bidón 20" = b20, "botellón 12" = b12, "sifón/soda" = soda, "dispenser eléctrico nuevo" = disp_elec_new, "cambio de dispenser eléctrico" = disp_elec_chg, "dispenser de natural/red" = disp_nat.

DÍAS VÁLIDOS (visitDay): "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo".

FRECUENCIAS:
- "weekly" → "los lunes", "todos los martes" (RECURRENTE semanal en ese día)
- "biweekly" → "cada 15 días", "quincenal"
- "triweekly" → "cada 3 semanas"
- "monthly" → "una vez al mes", "todos los meses el 5"
- "once" → "el lunes", "el viernes 8", una fecha puntual (siempre completá specificDate con YYYY-MM-DD)
- "on_demand" → "para cuando puedas", o cuando el texto no especifica frecuencia ni fecha

CRÍTICO — diferencia entre "los lunes" y "el lunes":
- "Los lunes" / "todos los lunes" / "cada lunes" → freq=weekly, visitDay=Lunes
- "El lunes" / "este lunes" / "el lunes que viene" → freq=once, specificDate=fecha calculada del próximo lunes

EXTRACCIÓN DE DIRECCIÓN Y MAPS:
- Si el texto separa la dirección en partes ("Dirección: X / Esquina: Y / Detalle: Z" o similares), combinalas en una sola dirección legible separadas por comas.
- Si encuentras una URL de Google Maps en el texto (maps.app.goo.gl, goo.gl/maps, google.com/maps), poníla en mapsLink. NO inventes URLs.
- Capitalizá nombres y direcciones correctamente (no devuelvas todo en MAYÚSCULAS aunque el texto lo esté).

QUÉ TOOL USAR:
1. **create_new_client**: el texto da datos de alta de alguien que NO está en la LISTA DE CLIENTES.
2. **merge_products_into_order**: el texto pide AGREGAR/SUMAR productos a un pedido YA AGENDADO de un cliente (que en la LISTA aparece con freq != on_demand). Verbos clave: "agregale", "sumale", "añadile", "más", "extra", "también", "y de paso". Solo aplica si el cliente tiene pedido pendiente.
3. **schedule_existing_client**: el texto AGENDA un pedido nuevo o REEMPLAZA agenda (cambia día/fecha/frecuencia/productos completos) para un cliente que SÍ está en la LISTA. Usar cuando el cliente está on_demand o cuando se especifica un día/fecha distinto.
4. **update_client_data**: actualizar SOLO datos del cliente (mapsLink, address, phone, notes) sin tocar agenda ni productos.
5. **report_not_found**: el nombre no está en la LISTA y no hay datos para crearlo.

DESAMBIGUACIÓN CRÍTICA "agregar productos":
- "agregale 2 botellones a Farmacia Central" + Farmacia Central ya tiene pedido pendiente → **merge_products_into_order**
- "agendá a Farmacia Central para el viernes con 2 botellones" → **schedule_existing_client**
- "Farmacia Central" sin más datos + ya tiene pedido pendiente → schedule_existing_client con products vacío y freq=keep (no hace falta merge si no hay productos a sumar).

CLIENTE CON MÚLTIPLES PEDIDOS PENDIENTES:
Un mismo cliente puede aparecer VARIAS VECES en la LISTA, una por cada pedido activo (ej: "Farmacia Central" puede tener una fila weekly Lunes y otra fila once Sábado 2026-05-02). Cada fila tiene su propio ID y son DOCUMENTOS DIFERENTES.

Cuando el usuario diga "agregale al pedido del [día/fecha] de X", DEBES elegir el id correspondiente al pedido de ese día/fecha exacto, no inventar y no elegir cualquiera. Si la solicitud no aclara cuál pedido, y hay múltiples, devolvé schedule_existing_client con notas pidiendo clarificación o elegí el más cercano explicándolo en notes.

CRÍTICO: en merge_products_into_order, add_products contiene SOLO los productos NUEVOS a sumar. La cantidad existente del cliente la maneja la app, no la incluyas vos.

Calculá fechas relativas en base a la FECHA ACTUAL que se te indica más adelante.`;

function buildClientsBlock(clients) {
  if (!clients || clients.length === 0) {
    return 'LISTA DE CLIENTES: (vacía — no hay clientes registrados todavía)';
  }
  const lines = clients.map((c) => {
    const parts = [c.id, c.name];
    if (c.address) parts.push(c.address);

    const status = [];
    if (c.freq && c.freq !== 'on_demand') {
      let when = '';
      if (c.specificDate) when = `${c.freq} ${c.specificDate}`;
      else if (c.visitDay) when = `${c.freq} ${c.visitDay}`;
      else when = c.freq;
      status.push(`pedido pendiente: ${when}`);

      if (c.products && Object.keys(c.products).length > 0) {
        const items = Object.entries(c.products)
          .filter(([_, v]) => Number(v) > 0)
          .map(([k, v]) => `${k}:${v}`)
          .join(', ');
        if (items) status.push(`productos actuales: {${items}}`);
      }
    } else {
      status.push('solo en directorio (sin pedido agendado)');
    }
    parts.push(status.join(' | '));

    return `- ${parts.join(' | ')}`;
  });
  return `LISTA DE CLIENTES (id | nombre | dirección | estado):\n${lines.join('\n')}`;
}

function buildTodayBlock(todayIso) {
  const date = new Date(todayIso + 'T12:00:00');
  const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const dayName = dayNames[date.getDay()];
  return `FECHA ACTUAL: ${todayIso} (${dayName})`;
}

async function parseOrder({ text, clients, todayIso }) {
  const systemBlocks = [
    {
      type: 'text',
      text: SYSTEM_RULES,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: buildClientsBlock(clients),
      cache_control: { type: 'ephemeral' },
    },
  ];

  const userMessage = `${buildTodayBlock(todayIso)}\n\nTEXTO A PARSEAR:\n"""\n${text}\n"""`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemBlocks,
    tools: TOOLS,
    tool_choice: { type: 'any' },
    messages: [{ role: 'user', content: userMessage }],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Modelo no devolvió tool_use');
  }

  return {
    tool: toolUse.name,
    input: toolUse.input,
    usage: response.usage,
  };
}

module.exports = { parseOrder };
