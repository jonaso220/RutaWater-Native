const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-haiku-4-5-20251001';

// ⚠️ ACOPLADO A LA APP: estos listados replican src/constants/products.ts
// (PRODUCTS ids, ALL_DAYS y Frequency). Si se agrega/cambia un producto, día
// o frecuencia en la app, actualizar acá también — si no, la IA nunca lo
// reconoce (o devuelve valores que la app rechaza).
const PRODUCT_IDS = ['b20', 'b12', 'b6', 'soda', 'bombita', 'disp_elec_new', 'disp_elec_chg', 'disp_nat'];
const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const FREQUENCIES = ['weekly', 'biweekly', 'triweekly', 'monthly', 'once', 'on_demand'];

const TOOLS = [
  {
    name: 'create_new_client',
    description:
      'Crear un cliente NUEVO en el directorio. Usar SOLO cuando el nombre del texto NO matchea con NINGÚN cliente de la LISTA DE CLIENTES según las reglas de MATCHING DEL NOMBRE. ANTES de elegir esta tool ES OBLIGATORIO recorrer la LISTA buscando el nombre — un texto con formato de ficha completa (NOMBRE + DIRECCIÓN + ESQUINA + URL de Google Maps) NO exime del chequeo: muchas veces el usuario te pasa la ficha del directorio existente para que la agendes, no para crear un duplicado. Si el nombre matchea (exacto o por substring), usar schedule_existing_client / merge_products_into_order / update_client_data según el caso. Si dudás entre crear nuevo o matchear con uno existente, preferí matchear.',
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
      'Agendar/mover/reemplazar un pedido (día, fecha, frecuencia y/o productos) para un cliente que YA EXISTE en la LISTA DE CLIENTES. Es la ÚNICA tool que toca día/fecha/frecuencia. Usar SIEMPRE que el texto pida cambiar día, fecha o frecuencia, AUNQUE TAMBIÉN haya cambios de notas o productos (combinar todo en una sola llamada). También permite gestionar las notas (notes + notes_mode) en la misma operación.',
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
          description: `SET ABSOLUTO de productos del pedido (reemplaza). IDs válidos: ${PRODUCT_IDS.join(', ')}. Solo usar cuando el usuario lista TODOS los productos del nuevo pedido explícitamente. Si el usuario NO menciona productos, mandar objeto vacío {} (la app usa los actuales). Si quiere AJUSTAR (agregar/quitar) sobre los actuales, NO uses este campo: usá add_products / remove_products en su lugar.`,
          additionalProperties: { type: 'number' },
        },
        add_products: {
          type: 'object',
          description: `Productos a SUMAR a los actuales del cliente al mover/agendar. IDs válidos: ${PRODUCT_IDS.join(', ')}. Objeto vacío {} si no se agrega nada. Útil cuando el usuario dice "movélo al lunes y agregale 2 botellones".`,
          additionalProperties: { type: 'number' },
        },
        remove_products: {
          type: 'object',
          description: `Productos a QUITAR de los actuales del cliente al mover/agendar. IDs válidos: ${PRODUCT_IDS.join(', ')}. Cantidad a restar. Objeto vacío {} si no se quita nada. Útil cuando el usuario dice "movélo al lunes y sacale el dispenser".`,
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
        schedule_mode: {
          type: 'string',
          enum: ['replace', 'add'],
          description:
            "'replace' (DEFAULT) → mover/reemplazar el pedido existente del cliente con el nuevo día/fecha. Usar cuando el usuario dice 'movélo', 'pasalo a', 'cambialo para', 'agendalo el [día]', o cualquier acción que reemplaza la fecha actual. 'add' → AGREGAR un pedido NUEVO sin borrar el actual. Usar SOLO si el usuario explícitamente dice 'extra', 'aparte', 'además', 'otro pedido', 'sumá otro', 'agendá un pedido adicional'. Si el cliente actualmente es on_demand (sin pedido pendiente), siempre 'replace'.",
        },
        notes: {
          type: 'string',
          description: 'Texto LITERAL de la nota del usuario (sin justificaciones, sin describir acciones). Vacío "" si el usuario no menciona notas.',
        },
        notes_mode: {
          type: 'string',
          enum: ['append', 'replace', 'clear', 'keep'],
          description: 'Cómo combinar `notes` con la nota actual del cliente: "keep" (default cuando notes=""), "append" (cuando agrega), "replace" (cuando reemplaza), "clear" (cuando dice "borrale las notas").',
        },
      },
      required: [
        'matched_client_id',
        'matched_client_name',
        'products',
        'add_products',
        'remove_products',
        'freq',
        'visitDay',
        'specificDate',
        'schedule_mode',
        'notes',
        'notes_mode',
      ],
    },
  },
  {
    name: 'merge_products_into_order',
    description:
      'MODIFICAR los productos del pedido YA AGENDADO de un cliente, sin crear un pedido nuevo ni cambiar día/fecha/frecuencia. Soporta SUMAR (add_products), QUITAR (remove_products), o AMBAS a la vez. También permite gestionar las notas del pedido (notes + notes_mode). Usar SIEMPRE que el cliente YA tenga un pedido pendiente (en LISTA DE CLIENTES como freq != on_demand) y el texto pida cambiar productos o notas. NO usar si el cliente está como on_demand (ahí hay que agendar con schedule_existing_client). NO usar schedule_existing_client para cambiar productos de un cliente que ya tiene pedido pendiente, porque eso crea un pedido duplicado.',
    input_schema: {
      type: 'object',
      properties: {
        matched_client_id: { type: 'string', description: 'ID exacto del cliente.' },
        matched_client_name: { type: 'string', description: 'Nombre para mostrar.' },
        add_products: {
          type: 'object',
          description: `Productos a SUMAR al pedido existente. IDs válidos: ${PRODUCT_IDS.join(', ')}. Solo los que se agregan; objeto vacío {} si no se agrega nada.`,
          additionalProperties: { type: 'number' },
        },
        remove_products: {
          type: 'object',
          description: `Productos a QUITAR del pedido existente. IDs válidos: ${PRODUCT_IDS.join(', ')}. Cantidad a restar (si la cantidad >= la actual, el producto se elimina por completo). Objeto vacío {} si no se quita nada. Solo incluir IDs que actualmente están en "productos actuales" del cliente; si no está, no agregarlo acá (avisalo en notes).`,
          additionalProperties: { type: 'number' },
        },
        notes: {
          type: 'string',
          description: 'Texto LITERAL de la nota del usuario (sin justificaciones, sin descripciones de tus acciones). Vacío "" si el usuario no menciona notas.',
        },
        notes_mode: {
          type: 'string',
          enum: ['append', 'replace', 'clear', 'keep'],
          description: 'Cómo combinar `notes` con la nota actual del cliente: "keep" → no tocar (default cuando notes=""). "append" → agregar al final de la nota actual (default cuando el usuario dice "agregale a las notas X"). "replace" → reemplazar la nota completa (cuando dice "cambia la nota a X" o "borrale la nota y poné Y"). "clear" → borrar la nota (cuando dice "borrale las notas").',
        },
      },
      required: ['matched_client_id', 'matched_client_name', 'add_products', 'remove_products', 'notes', 'notes_mode'],
    },
  },
  {
    name: 'update_client_data',
    description:
      'Actualizar SOLO datos del cliente (dirección, teléfono, link de Google Maps, notas) SIN tocar agenda, productos, frecuencia ni día. Usar cuando el texto pide "agregar/actualizar/cambiar X a un cliente que ya existe en la LISTA DE CLIENTES" — por ejemplo "agregá esta URL a Manuel", "actualizá el teléfono de Pedro", "cambia la dirección de Ana". Solo incluir los campos que se mencionan en el texto, los demás dejarlos vacío "". Si el cliente YA tiene pedido pendiente y el texto solo afecta notas/productos, preferí merge_products_into_order en su lugar.',
    input_schema: {
      type: 'object',
      properties: {
        matched_client_id: { type: 'string', description: 'ID exacto del cliente de la LISTA.' },
        matched_client_name: { type: 'string', description: 'Nombre del cliente para mostrar.' },
        mapsLink: { type: 'string', description: 'URL de Google Maps si se quiere actualizar. Vacío si no aplica.' },
        address: { type: 'string', description: 'Nueva dirección si se quiere actualizar. Vacío si no aplica.' },
        phone: { type: 'string', description: 'Nuevo teléfono si se quiere actualizar. Vacío si no aplica.' },
        notes: {
          type: 'string',
          description: 'Texto LITERAL de la nota del usuario (sin justificaciones, sin descripciones). Vacío "" si el usuario no menciona notas.',
        },
        notes_mode: {
          type: 'string',
          enum: ['append', 'replace', 'clear', 'keep'],
          description: 'Cómo combinar `notes` con la nota actual: "keep" (default cuando notes=""), "append" (cuando el usuario agrega), "replace" (cuando reemplaza), "clear" (cuando borra).',
        },
      },
      required: ['matched_client_id', 'matched_client_name', 'mapsLink', 'address', 'phone', 'notes', 'notes_mode'],
    },
  },
  {
    name: 'add_standalone_note',
    description:
      'Crear una NOTA SUELTA (recordatorio del día) para una fecha específica — NO está asociada a ningún cliente. PRIORIDAD ALTA: usar SIEMPRE que el texto pida agregar/añadir/dejar una nota para un día/fecha y NO mencione un nombre de cliente. La palabra "nota" + un día/fecha + ningún nombre propio = esta tool. Ejemplos disparadores (todos van acá): "añadí una nota para el lunes...", "agregá una nueva nota para el día martes...", "quiero que añadas una nota para el viernes...", "anotá para el sábado que...", "recordame el lunes que...", "dejá una nota el jueves: ...", "una nota para mañana: ...". Calculá specificDate (YYYY-MM-DD) en base a la FECHA ACTUAL si dice "el lunes próximo", "este viernes", "mañana", etc.',
    input_schema: {
      type: 'object',
      properties: {
        notes: {
          type: 'string',
          description: 'Texto LITERAL de la nota (sin justificaciones, sin describir tu acción). Ej: "Entregar pos al correo", "Llamar al proveedor".',
        },
        specificDate: {
          type: 'string',
          description: 'Fecha de la nota en ISO YYYY-MM-DD. Calcular en base a la FECHA ACTUAL si el usuario dice "el lunes próximo", "este viernes", etc.',
        },
      },
      required: ['notes', 'specificDate'],
    },
  },
  {
    name: 'report_not_found',
    description:
      'Usar SOLO cuando el texto pide agendar/modificar a un cliente específico mencionado por NOMBRE PROPIO (ej: "agregale 2 botellones a Farmacia Central") y ese nombre NO existe en la LISTA DE CLIENTES y NO hay datos suficientes para crearlo. PROHIBIDO usar esta tool si el texto NO menciona ningún nombre de cliente — un texto como "añadí una nota para el lunes" NO menciona cliente, así que NO va acá: va a add_standalone_note. Regla: si no podés citar un nombre propio textual del input que falte en la lista, NO uses report_not_found.',
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
- Si el texto separa la dirección en partes ("Dirección: X / Esquina: Y" o similares), combinalas en una sola dirección legible separadas por comas.
- Si encuentras una URL de Google Maps en el texto (maps.app.goo.gl, goo.gl/maps, google.com/maps), poníla en mapsLink. NO inventes URLs.
- Capitalizá nombres y direcciones correctamente (no devuelvas todo en MAYÚSCULAS aunque el texto lo esté).

REGLAS PARA notes Y notes_mode (CRÍTICO — leer 2 veces):

OBLIGATORIO: cada vez que llames a merge_products_into_order o update_client_data, DEBÉS incluir AMBOS campos notes y notes_mode. Nunca los omitas. Default seguro: notes="" + notes_mode="keep".


CONTEXTO: en la LISTA DE CLIENTES, cada cliente puede mostrar "notas actuales: ...". La app las preserva por default — vos NO tenés que copiarlas al campo notes. Solo decidís si las modificás y cómo.

REGLA #0 — Devolvés DOS campos coordinados:
  • notes = el texto LITERAL nuevo que el usuario quiere anotar (sin justificaciones, sin describir acciones). "" si el usuario no menciona notas.
  • notes_mode = qué hacer con ese texto en relación a la nota actual del cliente:
    - "keep" → no toca la nota actual. USAR ESTE cuando el usuario NO menciona notas. (La IA puede dejar notes="" en ese caso.)
    - "append" → agrega el texto de notes al final de la nota actual (con un punto y espacio en el medio). USAR cuando el usuario dice "agregale a las notas...", "anotá que...", "dejá una nota...", "ponele de nota...", "que diga en las notas...", "agregá a la nota...".
    - "replace" → reemplaza la nota actual con el texto de notes. USAR cuando el usuario dice "cambia la nota a X", "reemplaza la nota por Y", "borrale la nota y poné Z".
    - "clear" → borra la nota actual (notes puede ir vacío). USAR cuando dice "borrale las notas", "saca la nota", "limpia las notas".

REGLA #1 — PROHIBIDO redactar texto descriptivo en notes. NUNCA escribas en notes oraciones como "Se agregó X", "Se añadió Y", "Se quita Z", "Modificación de productos", "Pedido actualizado", "Cliente nuevo", "El usuario menciona X pero...". Esa info ya está en add_products/remove_products/products/freq. Repetirla en notes ENSUCIA el doc.

Ejemplos PROHIBIDOS (todos deberían ser notes="" + notes_mode="keep"):
  ❌ "Se agregan 3 botellones al pedido existente"
  ❌ "Se quita el dispensador eléctrico de cambio del pedido semanal"
  ❌ "Se añadió dispensador eléctrico de cambio"
  ❌ "El usuario también menciona X pero este producto no existe"

REGLA #2 — Si el usuario menciona productos que NO están en PRODUCTOS DISPONIBLES (ej: "3 bebidas", "2 pomelos", "1 caja de galletitas"), NO los pongas en add_products. Van TAL CUAL en notes con notes_mode="append" (o "replace" si dice "cambia la nota a X").

REGLA #3 — Si el usuario pide solo agregar/reemplazar nota sin tocar productos: add_products={}, remove_products={}, notes con el texto, notes_mode según corresponda. Si no menciona notas: notes="", notes_mode="keep".

EJEMPLOS COMPLETOS:
  Usuario: "quitale el dispenser electrico a Roberto"  (Roberto tiene nota "Necesita 3 bebidas")
    → add_products={}, remove_products={disp_elec_chg:1}, notes="", notes_mode="keep"   (preserva "Necesita 3 bebidas")

  Usuario: "agregale a las notas de Roberto que tambien llamar antes"  (Roberto tiene nota "Necesita 3 bebidas")
    → add_products={}, remove_products={}, notes="Llamar antes", notes_mode="append"   (resultado: "Necesita 3 bebidas. Llamar antes")

  Usuario: "borrale las notas a Roberto"
    → add_products={}, remove_products={}, notes="", notes_mode="clear"   (resultado: nota vacía)

  Usuario: "cambia la nota de Roberto a: prioritario"
    → add_products={}, remove_products={}, notes="Prioritario", notes_mode="replace"

DÓNDE PONER las notas (qué tool elegir):
- Cliente con pedido pendiente + cualquier cosa de notas o productos → **merge_products_into_order**.
- Cliente sin pedido pendiente (on_demand) + actualizar nota persistente → **update_client_data** con notes + notes_mode.

MATCHING DEL NOMBRE DE CLIENTE (CRÍTICO — leer 2 veces):
Cuando el texto menciona el nombre de un cliente, buscarlo en la LISTA DE CLIENTES con ESTAS REGLAS, en orden:

1. **Match exacto** (case-insensitive, ignorando tildes): el texto contiene el nombre exacto de un cliente → usar ese.
2. **Match por contención**: el nombre completo de un cliente aparece como SUBCADENA en el texto, AUNQUE haya palabras extra alrededor. Las palabras adicionales (apellidos extra, zona, barrio, número) son ACLARACIONES — NO razón para descartar el match.
   - texto: "agendá a Akita Pinar Viñale" + cliente "Akita Pinar" → matchear "Akita Pinar" (Viñale es aclaración de zona).
   - texto: "movélo a Plasticos Mica Solymar" + cliente "Plasticos Mica" → match.
   - texto: "Maria Lopez del 18" + cliente "Maria Lopez" → match.
3. **Match por inicio + apellido**: si la primera palabra y la segunda del texto coinciden con nombre y apellido (o variantes con tildes/typos leves), considerar match.
4. **Ambigüedad — múltiples matches**: si MÁS DE UN cliente matchea por reglas 1-3 (ej: hay "Maria Lopez" y "Maria Gonzalez" y el texto solo dice "Maria"), usar report_not_found con reason explicando ambas opciones.
5. **Sin match**: solo entonces report_not_found.

PROHIBIDO descartar un match por palabras adicionales en el texto (zona, apellido extra, barrio). Esas son aclaraciones del usuario, no parte del nombre del cliente.

PASO 0 — BÚSQUEDA OBLIGATORIA EN EL DIRECTORIO (leer ANTES que cualquier otra cosa):
Si el texto menciona un nombre de cliente, ANTES DE TODO recorré la LISTA DE CLIENTES y comparalo contra cada nombre usando las reglas de MATCHING DEL NOMBRE (exacto, substring, inicio+apellido). Esto es OBLIGATORIO incluso si el texto tiene formato de "ficha de alta" con muchos datos (NOMBRE + DIRECCIÓN + ESQUINA + URL de Google Maps): el usuario suele copiar la ficha del directorio existente para pedirte que la agendes, NO para crear un duplicado.

Si encontrás match → usar la tool del cliente existente (schedule_existing_client / merge_products_into_order / update_client_data según corresponda), AUNQUE la dirección, teléfono o mapsLink del texto sean distintos a los de la LISTA — esos son datos a actualizar, no razón para crear duplicado.

Solo si el nombre NO matchea con NINGÚN cliente de la LISTA, recién considerar create_new_client.

PROHIBIDO: elegir create_new_client sin haber recorrido antes la LISTA buscando el nombre.

Ejemplo del bug que esto previene:
  Texto: "BARBARA SILVEIRA - MEDANOS DE SOLYMAR EDEN ROK M22 S35  Esquina: ENTRE JAGUEL E INDIANA - https://maps.app.goo.gl/..."
  LISTA contiene "Barbara Silveira" con misma dirección.
  ❌ MAL: create_new_client (duplicaría el cliente).
  ✅ BIEN: si el texto pide agendar (con día/fecha/freq) → schedule_existing_client con el id de "Barbara Silveira". Si el texto solo trae datos sin pedido → no hay nada que hacer (el cliente ya existe); devolvé update_client_data SOLO si hay un dato nuevo a actualizar (mapsLink, teléfono, dirección distinta), si no, report_not_found con reason="El cliente ya existe en el directorio".

PRIMER FILTRO (leer ANTES de elegir tool):
¿El texto menciona un NOMBRE DE CLIENTE (un nombre propio: persona, comercio, institución como "Juan", "Farmacia Central", "Plásticos Mica")?

- NO menciona cliente Y pide algo tipo nota/recordatorio para un día/fecha → **add_standalone_note**. PUNTO. No considerar report_not_found, ni update_client_data, ni nada más. Frases típicas: "añadí una nota para el lunes...", "agregá una nueva nota para el día X...", "anotá para el viernes que...", "recordame el martes...". Estas SIEMPRE son add_standalone_note.
- NO menciona cliente Y no es nota → revisá si entendiste mal el texto; pedidos requieren cliente.
- SÍ menciona cliente → seguir con las reglas QUÉ TOOL USAR de abajo.

QUÉ TOOL USAR (cuando hay cliente mencionado):
1. **create_new_client**: el texto da datos de alta de alguien que NO está en la LISTA DE CLIENTES.
2. **merge_products_into_order**: el texto pide CAMBIAR los productos (agregar y/o quitar) de un pedido YA AGENDADO sin tocar día/fecha/frecuencia. Verbos clave de agregar: "agregale", "sumale", "añadile", "más", "también", "y de paso". Verbos clave de quitar: "quítale", "quitale", "sacale", "removeé", "borrale", "ya no lleva", "menos". Si el texto pide ambos a la vez (ej: "quitale la bombita y agregale 2 sifones"), usar este tool con add_products Y remove_products poblados a la vez. Solo aplica si el cliente tiene pedido pendiente Y el texto NO cambia día/fecha/freq.
3. **schedule_existing_client**: única tool que toca día/fecha/frecuencia. Usar en estos casos: (a) el cliente está como on_demand y se le agenda un pedido por primera vez, (b) se mueve/cambia el día, fecha o frecuencia (verbos: "movélo", "pasalo a", "cambialo para", "agendalo el [día]", "para el [fecha]"), o (c) el usuario pide explícitamente un pedido aparte (verbos: "extra", "aparte", "además", "otro pedido"). Para distinguir entre mover (default) y pedido extra, usá schedule_mode: 'replace' por default, 'add' SOLO si el texto lo indica explícitamente. Esta tool ACEPTA notes + notes_mode, así que si el texto pide "movélo y borrale las notas", combiná todo acá en una sola llamada (no llames update_client_data ni merge aparte).
4. **update_client_data**: actualizar SOLO datos del cliente (mapsLink, address, phone, notes) sin tocar agenda ni productos. PROHIBIDO usar si el texto menciona cambio de día/fecha/freq o de productos.
5. **add_standalone_note**: crear una NOTA SUELTA (recordatorio del día) que NO pertenece a un cliente. Usar cuando el texto NO menciona ningún cliente y solo pide anotar algo para un día/fecha. Ejemplos disparadores: "anotá para el lunes", "recordame el viernes", "una nota el sábado", "añadí una nota para el martes". Si el texto menciona un cliente además de la nota, usar las tools 2/3/4 según corresponda — esta es solo para notas sin cliente.
6. **report_not_found**: el nombre no está en la LISTA y no hay datos para crearlo (NO usar para notas sueltas — para eso está add_standalone_note).

REGLA DE PRIORIDAD ABSOLUTA (leer 2 veces):
Si el texto del usuario menciona cambio de día, fecha o frecuencia (verbos típicos: "movélo", "pasalo a", "cambialo para", "agendalo el [día/fecha]", "ya no es los lunes, ahora los martes", "ponelo para el [fecha]"), DEBÉS usar **schedule_existing_client**. NUNCA elijas update_client_data ni merge_products_into_order en ese caso, AUNQUE el texto también pida tocar notas o productos. Combiná TODO (fecha + notas + productos) en una sola llamada a schedule_existing_client. Ignorar esta regla rompe la agenda del usuario.

Ejemplo: "movélo del 29-4 al 6 de mayo y borrale las notas"
  → schedule_existing_client con freq='once', specificDate='YYYY-05-06', schedule_mode='replace', products={} (mantiene actuales), notes='', notes_mode='clear'.

Ejemplo: "agendá a Fabricia para el viernes extra, sumando 2 botellones"
  → schedule_existing_client con freq='once', specificDate=fecha del próximo viernes, schedule_mode='add', products={}, add_products={b20:2}, remove_products={}, notes='', notes_mode='keep'.

Ejemplo: "movélo a Fabricia al lunes próximo y sacale el dispenser"
  → schedule_existing_client con freq='once', specificDate=fecha del lunes, schedule_mode='replace', products={}, add_products={}, remove_products={disp_nat:1}, notes='', notes_mode='keep'.

CLAVE para schedule_existing_client:
- Si el texto NO menciona productos → products={}, add_products={}, remove_products={} (mantiene actuales del cliente).
- Si el texto AGREGA productos al mover → products={}, add_products={...}, remove_products={}.
- Si el texto QUITA productos al mover → products={}, add_products={}, remove_products={...}.
- Si el texto LISTA EXACTAMENTE los productos del nuevo pedido → products={...}, add_products={}, remove_products={}.

REFUERZO: si el cliente YA TIENE pedido pendiente y el texto pide cambiar/agregar/borrar/reemplazar las NOTAS sin mencionar día/fecha/freq, usá **merge_products_into_order** con add_products={}, remove_products={}, notes y notes_mode. NO uses update_client_data en ese caso (update_client_data es para clientes on_demand o cuando no hay pedido pendiente).

PROHIBIDO ABSOLUTO — verbos destructivos del PEDIDO ENTERO o CLIENTE:
Si el texto del usuario pide BORRAR/ELIMINAR/CANCELAR/SACAR un cliente del listado, o el pedido COMPLETO de un cliente (sin especificar qué productos quitar), DEBÉS responder con **report_not_found** y reason="No se puede borrar ni cancelar pedidos por IA. Usá los botones de la app (eliminar / completar / quitar del día).". NUNCA uses schedule_existing_client con freq='on_demand' como forma de cancelar. NUNCA uses merge_products_into_order vaciando todos los productos. La eliminación es exclusivamente manual desde la UI.

Ejemplos PROHIBIDOS (todos van a report_not_found con la razón anterior):
  ❌ "Borrá a Maria Lopez del listado"
  ❌ "Eliminá el pedido del miércoles a Plasticos Mica"
  ❌ "Cancelá el pedido de Pedro Perez"
  ❌ "Sacá a Maria del lunes"
  ❌ "Quitá a Juan del listado"
  ❌ "Removelo a Pedro de mañana"
  ❌ "Eliminale el pedido"

PERMITIDO (NO confundir con lo anterior):
  ✅ "Quitale la bombita a Maria" → merge_products_into_order (quita UN producto, NO el pedido)
  ✅ "Sacale el dispenser a Plasticos" → merge_products_into_order
  ✅ "Borrale las notas a X" → merge_products_into_order con notes_mode='clear' (borra notas, NO el pedido)
  ✅ "Movélo de X a Y" → schedule_existing_client (mueve, NO elimina)

Regla mental: si el verbo destructivo apunta a un PRODUCTO específico ("la bombita", "el sifón", "el dispenser") o a las NOTAS, está OK. Si apunta al PEDIDO entero, al CLIENTE o a un DÍA ("del lunes", "del miércoles"), está PROHIBIDO.

DESAMBIGUACIÓN CRÍTICA "modificar productos":
- "agregale 2 botellones a Farmacia Central" + Farmacia Central ya tiene pedido pendiente → **merge_products_into_order** con add_products={b20:2}, remove_products={}
- "quitale la bombita a Farmacia Central" + ya tiene pedido pendiente → **merge_products_into_order** con add_products={}, remove_products={bombita:1}
- "quitale la bombita y agregale 2 sifones a Farmacia Central" + ya tiene pedido pendiente → **merge_products_into_order** con add_products={soda:2}, remove_products={bombita:1}
- "agendá a Farmacia Central para el viernes con 2 botellones" → **schedule_existing_client** (porque agenda día nuevo)
- "Farmacia Central" sin más datos + ya tiene pedido pendiente → no hace nada útil, devolvé merge_products_into_order con ambos {} y notes explicando que falta info.

CLIENTE CON MÚLTIPLES PEDIDOS PENDIENTES:
Un mismo cliente puede aparecer VARIAS VECES en la LISTA, una por cada pedido activo (ej: "Farmacia Central" puede tener una fila weekly Lunes y otra fila once Sábado 2026-05-02). Cada fila tiene su propio ID y son DOCUMENTOS DIFERENTES.

Cuando el usuario diga "modificale el pedido del [día/fecha] de X", DEBES elegir el id correspondiente al pedido de ese día/fecha exacto, no inventar y no elegir cualquiera. Si la solicitud no aclara cuál pedido y hay múltiples, elegí el de la frecuencia/día que mejor matchee con lo que dice el texto (ej: "como semanal hoy viernes" → elegir la fila weekly Viernes).

CRÍTICO en merge_products_into_order:
- add_products contiene SOLO los productos NUEVOS a sumar. La cantidad existente la maneja la app, no la incluyas vos.
- remove_products contiene SOLO los productos a restar de la cantidad actual. Si vas a remover más de lo que tiene, la app igual lo maneja (deja en 0 / elimina).
- Solo incluí en remove_products productos que ESTÉN en "productos actuales" del cliente. Si el usuario pide quitar algo que el cliente no tiene, no lo metas en remove_products; explicalo en notes.

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
    if (c.notes && c.notes.trim()) {
      status.push(`notas actuales: "${c.notes.trim()}"`);
    }
    parts.push(status.join(' | '));

    return `- ${parts.join(' | ')}`;
  });
  return `LISTA DE CLIENTES (id | nombre | dirección | estado | notas actuales):\n${lines.join('\n')}`;
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

module.exports = { parseOrder, MODEL };
