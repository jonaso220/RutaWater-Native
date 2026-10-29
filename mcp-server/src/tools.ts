import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Client } from '../../src/types';
import { appendAudit } from './audit';
import { transcribeAudios } from './audio';
import { applyReplacements, openWhatsapp } from './whatsapp';
import { appRecordsSince, clientsWithoutPurchase, loadDeliveryRecords, loadPhotoRows, mergeHistory, summarizeHistory } from './deliveries';
import { downloadInboxMedia, excludeChat, forwardReceiptToAquapura, markHandled, readInbox, sendReply, transcribeInboxAudios } from './whatsappApi';
import { askJonathan, markAnswersApplied, notifyJonathan, readAnswers } from './telegram';
import { scheduledPass } from './vigilanteControl';
import { saveContact } from './contacts';
import { mergeClients, undoMerge } from './merge';
import path from 'path';
import type { ServerConfig } from './config';
import { findRoute, Route } from './routes';
import type { Store } from './store';
import {
  addDays, agendaFor, clientDetail, clientSummary, debtReport, debtsForClient, debtTotalMessage, hasPendingTransfer,
  isValidIsoDate, nextVisit, productCatalog, searchClients, suggestPosition, todayKey, weekdayOf, whatsappTemplates,
} from './views';
import {
  advanceVisit, ChangeResult, changeFrequency, changePosition, createClient, markDone, markTransferForReview, registerPayment, removeFromList, rescheduleClient, scheduleOnce, setNote,
  setProducts, setStar, undoDone, WriteError,
} from './writes';

const INSTRUCTIONS = `Acceso directo a RutaWater (reparto de agua) de la cuenta configurada.
- Las fechas son aaaa-mm-dd en hora de Uruguay; agenda_del_dia también acepta «hoy» y «mañana».
- Buscá al cliente con buscar_clientes y usá su id en las demás herramientas.
- Las escrituras devuelven antes/después confirmado por el servidor; si «cambiado» es false ya estaba así.
- marcar_favorito fija la estrella (no la alterna). marcar_listo usa la misma lógica que el botón Listo y se puede deshacer desde la app.
- adelantar_visita trae la próxima visita de un cliente con frecuencia a una fecha más cercana del mismo día (como cambiar la fecha de inicio en Editar cliente).
- agendar_una_vez agenda una visita de una vez con sus productos (como Directorio → Agendar → Una vez): una ficha de directorio pasa a ser esa visita; a un cliente que ya está en agenda se le agrega otra ficha sin tocar la suya. La ficha de la visita queda sin nota ni estrella, como en la app. Si ya tiene visita ese día no agrega otra. Queda primera del día, salvo con ubicar=true: entonces va donde indica sugerir_posicion.
- sugerir_posicion calcula dónde conviene una ficha en el recorrido de una fecha: entre las dos paradas consecutivas donde menos desvío agrega en línea recta. Si al cliente o a alguna parada le faltan coordenadas no sugiere nada y dice cuáles faltan.
- cambiar_posicion mueve una ficha al número indicado de la lista de ese día (como «Cambiar posición» en la tarjeta).
- cambiar_frecuencia cambia semanal/quincenal/cada 3 semanas/mensual manteniendo los días (como Editar cliente).
- cambiar_fecha pasa la próxima visita a otra fecha, antes o después (como la fecha de inicio de Editar cliente), y opcionalmente cambia la frecuencia en la misma llamada. Si la fecha cae otro día de semana, un cliente de un solo día o un pedido de una vez pasa a ese día (con ubicar=true, donde indica sugerir_posicion).
- quitar_de_la_lista saca al cliente de la lista de ese día de semana (como «Quitar de la lista» en Inicio): con varios días le saca solo ese; si era el único, vuelve al Directorio. Un pedido de una vez de alguien que tiene otra ficha se borra en vez de dejar una copia en el Directorio.
- registrar_pago salda deudas como Registrar pago / Editar deuda de la app (las más viejas primero; un pago parcial deja el saldo). Pasá deuda_esperada = deuda_total de ver_cliente: si cambió no registra nada. Lo pagado de más vuelve como «sobrante» y no se guarda: es propina salvo que el cliente pida dejarlo a favor (ahí, anotalo en la nota).
- marcar_revisar_transferencia deja al cliente en la lista Transferencias (como Revisar en Deudas). Marcar una transferencia como revisada queda solo para la app.
- crear_cliente crea una ficha nueva solo de directorio (como Directorio → «+»), sin productos ni visitas; si ya hay una ficha con ese teléfono no crea otra y la devuelve. Después se agenda con agendar_una_vez. Crear clientes solo cuando Jonathan lo pide.
- fusionar_duplicados junta dos fichas de la misma persona: queda la de agenda (o la más completa), se le suman los datos que solo tenía la otra y la otra se borra; deudas, transferencias y Parentesco pasan a la que queda. Primero sin aplicar (vista previa) y después con aplicar=true. deshacer_fusion la revierte con la copia que deja.
- abrir_whatsapp abre en el Mac el chat de un número con un borrador (como Avisar o el ícono de WhatsApp de la tarjeta); con plantilla="aviso_manana" usa el aviso de Ajustes. Solo deja el borrador: enviar y verificar sigue en WhatsApp.
- transcribir_audio transcribe en el Mac los últimos audios de WhatsApp guardados en Descargas (sirve aunque los comandos corran en una VM sin acceso a Descargas).
- WhatsApp por la API (coexistencia, gratis): leer_whatsapp trae los mensajes de clientes sin atender con su conversación y sus fichas; transcribir_whatsapp transcribe sus audios; ver_archivo_whatsapp muestra una foto o comprobante; responder_whatsapp contesta dentro de las 24 h (hasta el tope del mes); marcar_whatsapp_atendido los da por resueltos y los marca leídos; excluir_chat deja afuera un chat que no es de clientes (un amigo, un familiar) cuando Jonathan lo pide. Avisos y recordatorios NUNCA por la API: se cobran; van por la app en el Mac.
- guardar_contacto guarda o renombra al cliente en los Contactos de iCloud (iPhone y WhatsApp) como «Nombre - Dirección -» + link de Maps.
- pasada_programada: las pasadas de 9 y 18 avisan «empieza» y «termina»; contestar y agendar lo hace el vigilante.
- Dudas para Jonathan por Telegram: consultar_jonathan le manda la pregunta a su bot; leer_respuestas_jonathan trae lo que contestó (con la pregunta a la que responde); marcar_respuesta_aplicada las da por hechas; avisar_jonathan manda un aviso corto sin pregunta.
- No hay herramientas para borrar clientes (salvo la copia que sobra al fusionar o un pedido de una vez repetido), crear deudas, precios ni días de visita de clientes con varios días.`;

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 1) }] });
const failure = (error: unknown) => ({
  isError: true,
  content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
});

const handle = <A>(run: (args: A) => Promise<unknown>) => async (args: A) => {
  try {
    return text(await run(args));
  } catch (error) {
    if (!(error instanceof WriteError)) console.error(error);
    return failure(error);
  }
};

const resolveDate = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'hoy') return todayKey();
  if (normalized === 'mañana' || normalized === 'manana') return addDays(todayKey(), 1);
  if (!isValidIsoDate(value.trim())) throw new Error(`Fecha inválida: ${value}. Usá aaaa-mm-dd, «hoy» o «mañana».`);
  return value.trim();
};

export const registerTools = (server: McpServer, store: Store, config: ServerConfig): void => {
  const routesFor = async (reparto?: string): Promise<Route[]> => {
    const account = await store.getAccount();
    return reparto ? [findRoute(account, reparto)] : account.routes;
  };

  const findClient = async (clientId: string): Promise<{ client: Client; route: Route; all: Client[] }> => {
    for (const route of await routesFor()) {
      const all = await store.getClients(route);
      const client = all.find((candidate) => candidate.id === clientId);
      if (client) return { client, route, all };
    }
    throw new Error(`No encontré el cliente ${clientId} en los repartos de esta cuenta.`);
  };

  const catalog = async () => productCatalog(await store.getSettings());

  server.registerTool('historia_cliente', {
    title: 'Historia del cliente',
    description: 'Lo que compró un cliente: sus visitas (registro de entregas de cada Listo y, para fechas anteriores, la foto de la agenda), qué suele llevar, cada cuántos días, cuántas veces compró cada mes, cuántos días lleva sin comprar, cuántas veces no necesitó y las últimas 10 visitas. Junta todas las fichas de la misma persona. Para entender un pedido («lo de siempre», «un bidón»), ver si cambió su consumo o antes de consultarle algo a Jonathan. Solo lectura.',
    inputSchema: { cliente_id: z.string().min(1) },
    annotations: { readOnlyHint: true },
  }, handle(async ({ cliente_id }: { cliente_id: string }) => {
    const { client, all } = await findClient(cliente_id);
    const customerId = client.customerId || client.id;
    const ids = new Set(all.filter((candidate) => (candidate.customerId || candidate.id) === customerId).map((candidate) => candidate.id));
    const account = await store.getAccount();
    const records = await loadDeliveryRecords(store.db, account, { customerId });
    const appSince = await appRecordsSince(store.db, account);
    const rows = mergeHistory(records, loadPhotoRows(await catalog(), { ids }), appSince || '');
    return summarizeHistory(client, rows, todayKey());
  }));

  server.registerTool('entregas_del_periodo', {
    title: 'Entregas del período',
    description: 'Todas las visitas completadas entre dos fechas (aaaa-mm-dd), una por cliente y fecha, con productos y cantidades y si hubo entrega. origen «registro» es el Listo; «foto» es lo agendado según la foto de la agenda (solo para fechas anteriores al registro). Para el resumen mensual. Solo lectura.',
    inputSchema: { desde: z.string(), hasta: z.string() },
    annotations: { readOnlyHint: true },
  }, handle(async ({ desde, hasta }: { desde: string; hasta: string }) => {
    if (!isValidIsoDate(desde) || !isValidIsoDate(hasta)) throw new Error('Fechas inválidas: usá aaaa-mm-dd.');
    const account = await store.getAccount();
    const records = await loadDeliveryRecords(store.db, account, { desde, hasta });
    const appSince = await appRecordsSince(store.db, account);
    const clients = (await Promise.all((await routesFor()).map((route) => store.getClients(route)))).flat();
    const customerOf = new Map(clients.map((client) => [client.id, client.customerId || client.id]));
    // Las fotos traen el id de la ficha: se pasan a la persona para juntar sus fichas.
    const photos = loadPhotoRows(await catalog(), { desde, hasta })
      .map((row) => ({ ...row, customer_id: customerOf.get(row.cliente_id) || row.customer_id }));
    const rows = mergeHistory(records, photos, appSince || '');
    return {
      desde, hasta, registro_de_la_app_desde: appSince,
      productos: (await catalog()).map(({ id, nombre }) => ({ id, nombre })), visitas: rows,
    };
  }));

  server.registerTool('clientes_sin_comprar', {
    title: 'Clientes sin comprar',
    description: 'Clientes que pasaron más de N días (por defecto 30) sin comprar: última compra y qué llevó, próxima visita y frecuencia. Junta las fichas de la misma persona; sin compras en la historia cuenta desde el primer día con datos, solo para los que siguen en la agenda. Para el aviso de quienes pasan un mes sin comprar. Solo lectura.',
    inputSchema: { dias: z.number().int().min(7).max(180).optional() },
    annotations: { readOnlyHint: true },
  }, handle(async ({ dias }: { dias?: number }) => {
    const days = dias ?? 30;
    const today = todayKey();
    const desde = addDays(today, -Math.max(120, days * 3));
    const account = await store.getAccount();
    const records = await loadDeliveryRecords(store.db, account, { desde, hasta: today });
    const appSince = await appRecordsSince(store.db, account);
    const products = await catalog();
    const rows = mergeHistory(records, loadPhotoRows(products, { desde, hasta: today }), appSince || '');
    const clients = (await Promise.all((await routesFor()).map((route) => store.getClients(route)))).flat();
    const names = new Map(products.map((product) => [product.id, product.nombre]));
    return {
      dias: days, datos_desde: rows[0]?.fecha || null,
      clientes: clientsWithoutPurchase(clients, rows, today, days, nextVisit).map((client) => ({
        ...client, compro: Object.fromEntries(Object.entries(client.compro).map(([id, qty]) => [names.get(id) || id, qty])),
      })),
    };
  }));

  server.registerTool('listar_repartos', {
    title: 'Listar repartos',
    description: 'Repartos (perfiles) de la cuenta: id, nombre y si admiten cambios.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, handle(async () => (await store.getAccount()).routes.map((route) => ({
    id: route.id, nombre: route.name, principal: route.isPrimary, compartido: !!route.groupId, admite_cambios: route.writable,
  }))));

  server.registerTool('ver_productos', {
    title: 'Ver productos',
    description: 'Catálogo de productos con el id que usan las fichas y el nombre que ve el usuario.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, handle(async () => catalog()));

  server.registerTool('buscar_clientes', {
    title: 'Buscar clientes',
    description: 'Busca fichas por nombre, dirección o teléfono (misma búsqueda difusa que el Directorio). Excluye notas.',
    inputSchema: {
      texto: z.string().min(1).describe('Nombre, parte de la dirección o teléfono'),
      reparto: z.string().optional().describe('Id o nombre del reparto; por defecto todos'),
      incluir_inactivos: z.boolean().optional(),
      limite: z.number().int().min(1).max(50).optional(),
    },
    annotations: { readOnlyHint: true },
  }, handle(async ({ texto, reparto, incluir_inactivos, limite }: {
    texto: string; reparto?: string; incluir_inactivos?: boolean; limite?: number;
  }) => {
    const products = await catalog();
    const results = [];
    for (const route of await routesFor(reparto)) {
      const clients = await store.getClients(route);
      results.push(...searchClients(clients, texto, !!incluir_inactivos)
        .map((client) => clientSummary(client, { route, catalog: products })));
    }
    return results.slice(0, limite ?? 10);
  }));

  server.registerTool('ver_cliente', {
    title: 'Ver cliente',
    description: 'Ficha completa: teléfonos, direcciones, productos, nota, estrella, próxima visita, Parentesco (familiares con su WhatsApp), deudas con su total, si tiene una transferencia pendiente de revisar y el mensaje de «Enviar total».',
    inputSchema: { cliente_id: z.string().min(1) },
    annotations: { readOnlyHint: true },
  }, handle(async ({ cliente_id }: { cliente_id: string }) => {
    const { client, route, all } = await findClient(cliente_id);
    const debts = debtsForClient(all, await store.getDebts(route), client);
    const total = debts.reduce((sum, debt) => sum + (Number(debt.amount) || 0), 0);
    const settings = await store.getSettings();
    return {
      ...clientDetail(client, { route, catalog: productCatalog(settings), debts, clients: all }),
      transferencia_pendiente: hasPendingTransfer(all, await store.getTransfers(route), client),
      // Texto exacto de «Enviar total ($X)» en Deudas, para mandarlo por WhatsApp.
      ...(total > 0 ? { mensaje_total_deuda: debtTotalMessage(settings.whatsappDeuda, total) } : {}),
    };
  }));

  server.registerTool('agenda_del_dia', {
    title: 'Agenda del día',
    description: 'Clientes que Inicio muestra para una fecha, en el orden del reparto, con productos, estrella, «una vez», nota y WhatsApp. Incluye las plantillas de aviso.',
    inputSchema: {
      fecha: z.string().describe('aaaa-mm-dd, «hoy» o «mañana»'),
      reparto: z.string().optional().describe('Id o nombre del reparto; por defecto todos'),
    },
    annotations: { readOnlyHint: true },
  }, handle(async ({ fecha, reparto }: { fecha: string; reparto?: string }) => {
    const date = resolveDate(fecha);
    const settings = await store.getSettings();
    const products = productCatalog(settings);
    const routes = [];
    for (const route of await routesFor(reparto)) {
      const clients = await store.getClients(route);
      const debts = await store.getDebts(route);
      const agenda = agendaFor(clients, date).map(({ client, occurrence, overdue, position }) => ({
        posicion: position,
        ...clientSummary(client, { route, catalog: products, debts: debtsForClient(clients, debts, client) }),
        fecha_visita: occurrence,
        atrasada: overdue,
      }));
      routes.push({ reparto: route.name, reparto_id: route.id, clientes: agenda });
    }
    return {
      fecha: date, dia: weekdayOf(date), es_manana: date === addDays(todayKey(), 1),
      plantillas_whatsapp: whatsappTemplates(settings), repartos: routes,
    };
  }));

  server.registerTool('listar_deudas', {
    title: 'Listar deudas',
    description: 'Deudas por cliente (total, cantidad de registros y desde cuándo), de mayor a menor. Solo lectura.',
    inputSchema: {
      reparto: z.string().optional(),
      minimo: z.number().min(0).optional().describe('Total mínimo a mostrar'),
    },
    annotations: { readOnlyHint: true },
  }, handle(async ({ reparto, minimo }: { reparto?: string; minimo?: number }) => {
    const report = [];
    for (const route of await routesFor(reparto)) {
      report.push(...debtReport(await store.getClients(route), await store.getDebts(route), route.name, minimo ?? 0));
    }
    report.sort((a, b) => b.total - a.total);
    return { total_general: report.reduce((sum, entry) => sum + entry.total, 0), clientes: report };
  }));

  server.registerTool('sugerir_posicion', {
    title: 'Sugerir posición',
    description: 'Dónde conviene ubicar al cliente en el recorrido de esa fecha: entre las dos paradas consecutivas (en el orden del día) donde menos desvío agrega en línea recta (haversine), d(A,P) + d(P,B) − d(A,B), o antes de la primera / después de la última. Devuelve posicion (el número que queda en la tarjeta; se pasa tal cual a cambiar_posicion), anterior y siguiente con su número actual y desvio_metros. Si al cliente o a alguna parada le faltan coordenadas, posicion es null y sin_coordenadas dice cuáles; con ignorar_sin_coordenadas=true calcula igual con las que tienen (completa=false). Solo lectura.',
    inputSchema: {
      cliente_id: z.string().min(1),
      fecha: z.string().describe('aaaa-mm-dd, «hoy» o «mañana»'),
      ignorar_sin_coordenadas: z.boolean().optional().describe('Calcular aunque falten coordenadas de algunas paradas'),
    },
    annotations: { readOnlyHint: true },
  }, handle(async ({ cliente_id, fecha, ignorar_sin_coordenadas }: { cliente_id: string; fecha: string; ignorar_sin_coordenadas?: boolean }) => {
    const date = resolveDate(fecha);
    const { client, route, all } = await findClient(cliente_id);
    return {
      cliente_id: client.id, nombre: client.name, reparto: route.name, fecha: date, dia: weekdayOf(date),
      ...suggestPosition(all, client, date, !!ignorar_sin_coordenadas),
    };
  }));

  const allClients = async () => (await Promise.all((await routesFor()).map((route) => store.getClients(route)))).flat();

  server.registerTool('leer_whatsapp', {
    title: 'Leer WhatsApp (API)',
    description: 'Mensajes de clientes que todavía no se atendieron, recibidos por la API de WhatsApp (gratis, sin abrir WhatsApp en el Mac), agrupados por chat y en orden de llegada. Por chat: telefono, nombre_perfil (el de WhatsApp), fichas de RutaWater con ese teléfono, pendientes (id, hora, tipo, texto; los audios y fotos dicen archivo), conversacion (últimas 48 h, con lo que mandamos desde la app o la API) y responder_hasta (fin de la ventana de 24 h). uso: respuestas por API este mes y cuántas quedan. Los chats excluidos y los grupos no llegan. Solo lectura.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, handle(async () => readInbox(store.db, await allClients())));

  server.registerTool('ver_archivo_whatsapp', {
    title: 'Ver archivo de WhatsApp',
    description: 'Baja la foto o el documento de un mensaje recibido por la API (por ejemplo un comprobante) y lo devuelve: las fotos como imagen para mirarlas, los documentos como ruta en el Mac. Solo lectura.',
    inputSchema: { id: z.string().min(1).describe('id del mensaje (de leer_whatsapp)') },
    annotations: { readOnlyHint: true },
  }, async ({ id }: { id: string }) => {
    try {
      const { data, ...info } = await downloadInboxMedia(store.db, id);
      const content: any[] = [{ type: 'text', text: JSON.stringify(info, null, 1) }];
      if (info.mime.startsWith('image/') && data.length < 5_000_000) {
        content.push({ type: 'image', data: data.toString('base64'), mimeType: info.mime.split(';')[0] });
      }
      return { content };
    } catch (error) {
      return failure(error);
    }
  });

  if (config.readOnly) return;

  const write = (tool: string, run: (args: any) => Promise<ChangeResult>) => handle(async (args: any) => {
    const result = await run(args);
    if (result.cambiado) {
      appendAudit(config.auditPath, { tool, args, cliente: result.nombre, reparto: result.reparto, antes: result.antes, despues: result.despues });
    }
    return result;
  });

  server.registerTool('fijar_productos', {
    title: 'Fijar productos',
    description: 'Cambia cantidades de productos de la ficha (lo que hay que llevar). Solo toca los productos indicados; 0 lo quita. Con reemplazar_todo=true la ficha queda exactamente con esos productos.',
    inputSchema: {
      cliente_id: z.string().min(1),
      productos: z.record(z.string(), z.number().int().min(0).max(9999)).describe('{ id_producto: cantidad }, ids de ver_productos'),
      reemplazar_todo: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, write('fijar_productos', async ({ cliente_id, productos, reemplazar_todo }) => setProducts(
    store.db, await store.refreshAccount(), await catalog(), cliente_id, productos, !!reemplazar_todo,
  )));

  server.registerTool('actualizar_nota', {
    title: 'Actualizar nota',
    description: 'Reemplaza la nota completa de la ficha (texto vacío la borra). Pasá nota_esperada con la nota que leíste para no pisar un cambio hecho desde la app.',
    inputSchema: {
      cliente_id: z.string().min(1),
      nota: z.string().max(2000),
      nota_esperada: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, write('actualizar_nota', async ({ cliente_id, nota, nota_esperada }) => setNote(
    store.db, await store.refreshAccount(), cliente_id, nota, nota_esperada,
  )));

  server.registerTool('marcar_favorito', {
    title: 'Marcar favorito',
    description: 'Fija la estrella de favorito (true por defecto). Si ya estaba así no cambia nada.',
    inputSchema: { cliente_id: z.string().min(1), favorito: z.boolean().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, write('marcar_favorito', async ({ cliente_id, favorito }) => setStar(
    store.db, await store.refreshAccount(), cliente_id, favorito ?? true,
  )));

  server.registerTool('marcar_listo', {
    title: 'Marcar Listo',
    description: 'Marca Listo la visita de esa fecha (igual que el botón Listo): la app calcula sola la próxima visita, que se devuelve. Falla si la fecha no es una visita pendiente. Queda registrada como entrega con los productos de la ficha; con sin_entrega=true (el cliente avisó que no necesita) queda como «Visitado, no necesitó».',
    inputSchema: {
      cliente_id: z.string().min(1),
      fecha: z.string().describe('aaaa-mm-dd de la visita, «hoy» o «mañana»'),
      sin_entrega: z.boolean().optional().describe('true si el cliente no necesita esta vez (no se entrega nada)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, write('marcar_listo', async ({ cliente_id, fecha, sin_entrega }) => markDone(
    store.db, await store.refreshAccount(), cliente_id, resolveDate(fecha), sin_entrega === true,
  )));

  server.registerTool('deshacer_listo', {
    title: 'Deshacer Listo',
    description: 'Deshace el Listo de esta cuenta sobre la ficha (igual que Deshacer en la app).',
    inputSchema: { cliente_id: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, write('deshacer_listo', async ({ cliente_id }) => undoDone(
    store.db, await store.refreshAccount(), cliente_id,
  )));
  server.registerTool('adelantar_visita', {
    title: 'Adelantar visita',
    description: 'Adelanta la próxima visita de un cliente con frecuencia (p. ej. quincenal) a una fecha más cercana del MISMO día de semana; el ciclo sigue desde esa fecha. Igual que cambiar la fecha de inicio en Editar cliente. No cambia días ni frecuencia.',
    inputSchema: { cliente_id: z.string().min(1), fecha: z.string().describe('aaaa-mm-dd, «hoy» o «mañana»') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, write('adelantar_visita', async ({ cliente_id, fecha }) => advanceVisit(
    store.db, await store.refreshAccount(), cliente_id, resolveDate(fecha),
  )));
  server.registerTool('cambiar_frecuencia', {
    title: 'Cambiar frecuencia',
    description: 'Cambia la frecuencia de un cliente con agenda periódica (semanal, quincenal, cada 3 semanas, mensual) manteniendo sus días, igual que Editar cliente. Opcional: fecha_inicio (mismo día de semana) para fijar desde cuándo corre el ciclo. Devuelve frecuencia y próxima visita antes y después.',
    inputSchema: {
      cliente_id: z.string().min(1),
      frecuencia: z.string().describe('semanal, quincenal, cada 3 semanas o mensual'),
      fecha_inicio: z.string().optional().describe('aaaa-mm-dd, «hoy» o «mañana»; mismo día de semana del cliente'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, write('cambiar_frecuencia', async ({ cliente_id, frecuencia, fecha_inicio }) => changeFrequency(
    store.db, await store.refreshAccount(), cliente_id, frecuencia, fecha_inicio ? resolveDate(fecha_inicio) : undefined,
  )));

  server.registerTool('cambiar_fecha', {
    title: 'Cambiar fecha',
    description: 'Pasa la próxima visita a otra fecha, antes o después, igual que cambiar la fecha de inicio en Editar cliente: el ciclo sigue desde esa fecha. Sirve para clientes con frecuencia y para pedidos de una vez. Con frecuencia (semanal, quincenal, cada 3 semanas, mensual) cambia también la frecuencia en la misma escritura; en un pedido de una vez lo vuelve periódico desde esa fecha. Si la fecha cae otro día de semana, un cliente de un solo día pasa a ese día y conserva su número de orden, y un pedido de una vez queda primero; con ubicar=true queda donde indica sugerir_posicion. Un cliente con varios días solo se mueve dentro de sus días. Devuelve frecuencia, días, próxima visita y posición antes y después. Rechaza fechas pasadas, fichas de directorio (usar agendar_una_vez), notas y fichas con alarma.',
    inputSchema: {
      cliente_id: z.string().min(1).describe('Id de la ficha que figura en la agenda'),
      fecha: z.string().describe('Nueva fecha de la próxima visita: aaaa-mm-dd, «hoy» o «mañana»'),
      frecuencia: z.string().optional().describe('semanal, quincenal, cada 3 semanas o mensual; si no se pasa, queda la que tiene'),
      ubicar: z.boolean().optional().describe('Si cambia de día de semana: ubicarla donde indica sugerir_posicion'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, write('cambiar_fecha', async ({ cliente_id, fecha, frecuencia, ubicar }) => {
    const { all } = await findClient(cliente_id);
    return rescheduleClient(store.db, await store.refreshAccount(), all, cliente_id, resolveDate(fecha), frecuencia, !!ubicar);
  }));

  server.registerTool('quitar_de_la_lista', {
    title: 'Quitar de la lista',
    description: 'Saca al cliente de la lista del día de semana de esa fecha, igual que «Quitar de la lista» en Inicio: si va varios días le saca solo ese día; si era el único, la ficha vuelve al Directorio (sin agenda, conserva su última entrega, nota, productos y deudas). Un pedido de una vez de alguien que ya tiene otra ficha (agenda o directorio) se borra en vez de dejar una copia en el Directorio (despues.queda dice cuál ficha sigue). Para que no vaya una sola vez, usar marcar_listo o cambiar_fecha. Rechaza notas y fichas con alarma.',
    inputSchema: {
      cliente_id: z.string().min(1).describe('Id de la ficha que figura en la agenda'),
      fecha: z.string().describe('aaaa-mm-dd, «hoy» o «mañana»; se usa su día de semana'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, write('quitar_de_la_lista', async ({ cliente_id, fecha }) => {
    const { all, route } = await findClient(cliente_id);
    const related = async () => [...await store.getDebts(route), ...await store.getTransfers(route)];
    return removeFromList(store.db, await store.refreshAccount(), all, cliente_id, resolveDate(fecha), related);
  }));

  server.registerTool('agendar_una_vez', {
    title: 'Agendar una vez',
    description: 'Agenda una visita de una vez para esa fecha con esos productos, igual que Directorio → Agendar / + Visita → Una vez: si la ficha es solo de directorio, esa misma ficha pasa a ser la visita; si el cliente ya está en agenda, se agrega otra ficha con el mismo cliente y la suya no cambia. Queda primera en la lista del día (con ubicar=true, entre las dos paradas donde menos desvío agrega; despues.posicion y ubicacion lo detallan). Como en la app, la ficha de la visita queda con nota vacía y sin estrella (en una ficha de directorio, antes muestra la nota y la estrella que tenía, para restaurarlas con actualizar_nota y marcar_favorito). Si el cliente ya tiene una visita esa fecha no agrega otra (cambiado=false, devuelve su ficha_id para fijar_productos). Rechaza fechas pasadas.',
    inputSchema: {
      cliente_id: z.string().min(1),
      fecha: z.string().describe('aaaa-mm-dd, «hoy» o «mañana»'),
      productos: z.record(z.string(), z.number().int().min(0).max(9999)).describe('{ id_producto: cantidad }, ids de ver_productos'),
      ubicar: z.boolean().optional().describe('true: en vez de primera, la ubica donde indica sugerir_posicion (si faltan coordenadas queda primera y ubicacion.motivo dice por qué)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, write('agendar_una_vez', async ({ cliente_id, fecha, productos, ubicar }) => scheduleOnce(
    store.db, await store.refreshAccount(), await catalog(), cliente_id, resolveDate(fecha), productos, !!ubicar,
  )));

  server.registerTool('crear_cliente', {
    title: 'Crear cliente',
    description: 'Crea una ficha nueva solo de directorio, igual que Directorio → «+» en la app: nombre, dirección, teléfono, link de Google Maps (de ahí saca las coordenadas) y nota opcional; sin productos, sin día ni visitas. Antes busca en el reparto la misma persona o el mismo teléfono: si existe no crea nada (cambiado=false) y devuelve esas fichas. Para que aparezca en la agenda, después usar agendar_una_vez con su cliente_id. Usar solo cuando Jonathan pide dar de alta a alguien.',
    inputSchema: {
      nombre: z.string().min(1).max(200),
      direccion: z.string().max(500).optional(),
      telefono: z.string().max(40).optional().describe('Como lo guarda la app, por ejemplo 099309717'),
      link_maps: z.string().max(500).optional(),
      nota: z.string().max(2000).optional(),
      reparto: z.string().optional().describe('Id o nombre; por defecto el reparto principal'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, write('crear_cliente', async ({ nombre, direccion, telefono, link_maps, nota, reparto }) => {
    const account = await store.refreshAccount();
    const route = reparto ? findRoute(account, reparto) : (account.routes.find((candidate) => candidate.isPrimary) || account.routes[0]);
    return createClient(store.db, account, route, {
      name: nombre, address: direccion || '', phone: telefono || '', mapsLink: link_maps || '', notes: nota || '',
    });
  }));

  const mergeBackups = path.join(path.dirname(config.auditPath), 'fusiones');

  server.registerTool('fusionar_duplicados', {
    title: 'Fusionar fichas duplicadas',
    description: 'Junta dos fichas de la misma persona (por ejemplo, la de agenda y una copia en el directorio). Queda la que tiene visitas en la agenda; si ninguna tiene, la activa con más datos. A esa se le suman los datos que solo tenía la otra (teléfonos, direcciones que no estaban, link de Maps y coordenadas, RUT/razón social/email, Parentesco, última entrega; la nota de una copia de directorio solo con sumar_nota=true) y la otra se borra. Las deudas, transferencias, familiares y otras fichas que apuntaban a la borrada pasan a la que queda. No fusiona dos fichas que tienen visitas (se perdería una). Sin aplicar devuelve la vista previa (qué queda, qué se suma, qué se mueve) y no escribe nada; con aplicar=true fusiona y guarda una copia de todo lo que tocó (campo copia) para deshacer_fusion.',
    inputSchema: {
      cliente_a: z.string().min(1),
      cliente_b: z.string().min(1),
      aplicar: z.boolean().optional().describe('false o ausente: solo vista previa'),
      sumar_nota: z.boolean().optional().describe('true: suma también la nota de la copia de directorio a la ficha de agenda (por defecto queda afuera, en nota_de_la_copia_sin_sumar)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, write('fusionar_duplicados', async ({ cliente_a, cliente_b, aplicar, sumar_nota }) => {
    const { route, all } = await findClient(cliente_a);
    const cache = { clients: all, debts: await store.getDebts(route), transfers: await store.getTransfers(route) };
    return mergeClients(store.db, await store.refreshAccount(), cliente_a, cliente_b, !!aplicar, mergeBackups, cache, !!sumar_nota);
  }));

  server.registerTool('deshacer_fusion', {
    title: 'Deshacer una fusión',
    description: 'Vuelve a dejar las fichas, deudas, transferencias y familiares como estaban antes de una fusión, con la copia que devolvió fusionar_duplicados (campo copia). La ficha borrada vuelve con el mismo id. Pisa los cambios que se hayan hecho después en esas fichas.',
    inputSchema: { copia: z.string().min(1).describe('Ruta del archivo de copia') },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, write('deshacer_fusion', async ({ copia }) => {
    const file = path.resolve(copia);
    if (path.dirname(file) !== path.resolve(mergeBackups)) throw new Error(`La copia tiene que estar en ${mergeBackups}.`);
    return undoMerge(store.db, await store.refreshAccount(), file);
  }));

  server.registerTool('cambiar_posicion', {
    title: 'Cambiar posición',
    description: 'Mueve la ficha al número indicado de la lista de ese día de semana, igual que «Cambiar posición» en la tarjeta de Inicio (el número es el de la tarjeta y cuenta todas las fichas de ese día de semana; uno mayor que la lista la deja última). Normalmente escribe solo esa ficha. Falla si la ficha no está en la lista de ese día o si alguien cambió el orden mientras tanto.',
    inputSchema: {
      cliente_id: z.string().min(1).describe('Id de la ficha que figura en la agenda (la de la visita)'),
      fecha: z.string().describe('aaaa-mm-dd, «hoy» o «mañana»; se usa su día de semana'),
      posicion: z.number().int().min(1).max(10000),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, write('cambiar_posicion', async ({ cliente_id, fecha, posicion }) => {
    const { all } = await findClient(cliente_id);
    return changePosition(store.db, await store.refreshAccount(), all, cliente_id, resolveDate(fecha), posicion);
  }));

  server.registerTool('registrar_pago', {
    title: 'Registrar pago',
    description: 'Registra un pago de deuda como Deudas en la app: salda las deudas más viejas primero (Registrar pago) y, si el monto no cubre una, la deja con el saldo que queda (Editar deuda). deuda_esperada = deuda_total que leíste en ver_cliente: si cambió, no se registra nada (evita pagos dobles). Devuelve antes/después, aplicado_a_deuda y sobrante (pago de más, que RutaWater no guarda). Falla si el cliente no tiene deudas.',
    inputSchema: {
      cliente_id: z.string().min(1),
      monto: z.number().positive().max(10_000_000).describe('Monto recibido, en pesos'),
      deuda_esperada: z.number().min(0).describe('deuda_total actual según ver_cliente'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, write('registrar_pago', async ({ cliente_id, monto, deuda_esperada }) => {
    const { all } = await findClient(cliente_id);
    return registerPayment(store.db, await store.refreshAccount(), cliente_id, monto, deuda_esperada, all);
  }));

  server.registerTool('abrir_whatsapp', {
    title: 'Abrir chat de WhatsApp en el Mac',
    description: 'Abre WhatsApp en el Mac en el chat del número indicado, con un borrador opcional: el mismo enlace whatsapp://send que usan el botón Avisar y el ícono de WhatsApp de la tarjeta, sin tocar la app de RutaWater. plantilla="aviso_manana" usa el aviso de mañana de Ajustes (el de agenda_del_dia); texto pone un mensaje propio; sin ninguno abre el chat vacío. reemplazar aplica cambios «viejo=>nuevo» al texto (cada «viejo» tiene que aparecer una sola vez, p. ej. «por tu casa=>por el local»). NO envía: después hay que verificar destinatario y borrador en WhatsApp y apretar Enviar.',
    inputSchema: {
      telefono: z.string().min(8).describe('Campo whatsapp de la ficha (solo dígitos, con código de país)'),
      plantilla: z.enum(['aviso_manana']).optional().describe('Usar el aviso de mañana de Ajustes'),
      texto: z.string().max(4000).optional().describe('Mensaje propio para el borrador'),
      reemplazar: z.array(z.string()).max(5).optional().describe('Cambios «texto viejo=>texto nuevo» sobre el borrador'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, handle(async ({ telefono, plantilla, texto, reemplazar }: { telefono: string; plantilla?: 'aviso_manana'; texto?: string; reemplazar?: string[] }) => {
    if (plantilla && texto) throw new Error('Pasá plantilla o texto, no los dos.');
    let borrador = plantilla ? whatsappTemplates(await store.getSettings()).aviso_manana : texto;
    if (reemplazar?.length) {
      if (!borrador) throw new Error('reemplazar necesita plantilla o texto.');
      borrador = applyReplacements(borrador, reemplazar);
    }
    return openWhatsapp(telefono.replace(/\D/g, ''), borrador || undefined);
  }));

  server.registerTool('transcribir_audio', {
    title: 'Transcribir audios de WhatsApp',
    description: 'Transcribe en el Mac, con Whisper, los audios «WhatsApp Audio …» más nuevos de Descargas (los que se guardan con «Guardar en Descargas»), en orden cronológico. Devuelve por audio texto, confianza, dudoso, segundos y hora_mensaje (para cotejar con la burbuja). Con borrar=true borra el archivo si la transcripción no quedó dudosa. Espera hasta 10 s a que aparezca el archivo. No toca RutaWater.',
    inputSchema: {
      cantidad: z.number().int().min(1).max(10).optional().describe('Cuántos audios, los más nuevos (por defecto 1)'),
      borrar: z.boolean().optional().describe('Borrar el archivo después de transcribirlo bien (por defecto true)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, handle(async ({ cantidad, borrar }: { cantidad?: number; borrar?: boolean }) => transcribeAudios(cantidad ?? 1, borrar ?? true)));

  server.registerTool('transcribir_whatsapp', {
    title: 'Transcribir audios de WhatsApp (API)',
    description: 'Baja los audios de esos mensajes (ids de leer_whatsapp) y los transcribe con Whisper en el Mac, sin abrir WhatsApp. Devuelve por audio id, texto, confianza, dudoso y segundos. No toca RutaWater ni WhatsApp.',
    inputSchema: { ids: z.array(z.string().min(1)).min(1).max(10) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handle(async ({ ids }: { ids: string[] }) => transcribeInboxAudios(store.db, ids)));

  server.registerTool('responder_whatsapp', {
    title: 'Responder por WhatsApp (API)',
    description: 'Envía un mensaje de texto al cliente por la API de WhatsApp, desde el número del negocio (aparece también en la app). Solo dentro de las 24 h desde el último mensaje del cliente (si no, se contesta desde la app en el Mac), nunca a un chat excluido y sin pasar el tope del mes (las primeras 1.000 son gratis; después ~US$0,0113 cada una hasta el tope). NO sirve para avisos ni recordatorios. Devuelve enviado, id y el uso del mes. Un envío que falló no cuenta; ante un resultado dudoso, mirar leer_whatsapp antes de reintentar.',
    inputSchema: {
      telefono: z.string().min(10).describe('telefono del chat, como lo da leer_whatsapp (598…)'),
      texto: z.string().min(1).max(4000),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, handle(async ({ telefono, texto }: { telefono: string; texto: string }) => {
    const result = await sendReply(store.db, telefono, texto);
    appendAudit(config.auditPath, { tool: 'responder_whatsapp', args: { telefono }, cliente: telefono, reparto: '', antes: null, despues: { id: result.id } });
    return result;
  }));

  server.registerTool('enviar_comprobante_aquapura', {
    title: 'Enviar comprobante a Aquapura (API)',
    description: 'Le manda a Fabrica Aquapura el comprobante (PDF o foto) de un cliente que transfirió a la cuenta BROU de Aquapura, por la API: si Aquapura escribió en las últimas 24 h va solo el archivo (gratis); si no, con la plantilla «Comprobante de la transferencia de {cliente} por $ {monto} a la cuenta BROU de Aquapura.» (se cobra como utilidad). Solo el comprobante: nunca lo que escribió el cliente. Usar después de registrar el pago.',
    inputSchema: {
      id: z.string().min(1).describe('id del mensaje del comprobante (de leer_whatsapp)'),
      cliente: z.string().min(1).max(60).describe('Nombre del cliente como lo conoce Aquapura'),
      monto: z.number().positive().max(10_000_000),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, handle(async ({ id, cliente, monto }: { id: string; cliente: string; monto: number }) => {
    const result = await forwardReceiptToAquapura(store.db, id, cliente, monto);
    appendAudit(config.auditPath, { tool: 'enviar_comprobante_aquapura', args: { id, monto }, cliente, reparto: '', antes: null, despues: result });
    return result;
  }));

  server.registerTool('pasada_programada', {
    title: 'Avisar al vigilante (pasada programada)',
    description: 'Lo usan las pasadas programadas de las 9 y las 18: estado «empieza» al arrancar (el vigilante deja de contestar mientras se mandan avisos o recordatorios) y «termina» apenas se manda el último (el vigilante se reanuda y se despierta enseguida para contestar y agendar). Llamar a «termina» siempre, también si la pasada se corta. Si nadie avisa, la pausa vence sola a las 3 h.',
    inputSchema: {
      estado: z.enum(['empieza', 'termina']),
      pasada: z.string().max(40).optional().describe('«9 hs» o «18 hs»'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, handle(async ({ estado, pasada }: { estado: 'empieza' | 'termina'; pasada?: string }) => scheduledPass(estado, pasada)));

  server.registerTool('guardar_contacto', {
    title: 'Guardar contacto (iCloud)',
    description: 'Guarda al cliente en los Contactos del Mac (iCloud: los mismos del iPhone y de WhatsApp) como «Nombre - Dirección -» con el link de Maps al final. Si ya hay un contacto con ese teléfono le cambia el nombre (también a los duplicados); si no, lo crea. Usar con los mismos datos de la ficha de RutaWater (nombre y dirección con mayúscula inicial). Nunca guardar la cédula ni otros documentos.',
    inputSchema: {
      nombre: z.string().min(1).max(200),
      direccion: z.string().max(500).optional(),
      link_maps: z.string().max(500).optional(),
      telefono: z.string().min(8).max(40).describe('Como 099123456 o +59899123456'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, handle(async (args: { nombre: string; direccion?: string; link_maps?: string; telefono: string }) => {
    const result = await saveContact(args);
    appendAudit(config.auditPath, { tool: 'guardar_contacto', args: { nombre: args.nombre }, cliente: args.nombre, reparto: '', antes: null, despues: result });
    return result;
  }));

  server.registerTool('marcar_whatsapp_atendido', {
    title: 'Marcar WhatsApp atendido',
    description: 'Da por resueltos esos mensajes (ids de leer_whatsapp) para que no vuelvan a aparecer y, por chat, marca el último como leído en WhatsApp (tildes azules, también en la app; gratis). Con marcar_leido=false solo los saca de la lista. Lo que queda para Jonathan no se marca: sigue pendiente y sin leer.',
    inputSchema: {
      ids: z.array(z.string().min(1)).min(1).max(50),
      marcar_leido: z.boolean().optional().describe('Marcar leído en WhatsApp (por defecto true)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, handle(async ({ ids, marcar_leido }: { ids: string[]; marcar_leido?: boolean }) => markHandled(store.db, ids, marcar_leido ?? true)));

  server.registerTool('excluir_chat', {
    title: 'Excluir chat de WhatsApp',
    description: 'Solo cuando Jonathan lo pide (un amigo, un familiar, alguien que no es cliente): suma el chat a los excluidos de la base, que leen el webhook y este servidor, así sus mensajes ya no llegan a la API ni a leer_whatsapp y nunca se le contesta. Borra de la bandeja de la API lo que ya se había guardado de ese chat; en WhatsApp el chat queda intacto (sin leer, para Jonathan). Por teléfono o por el nombre del perfil (mensajes de los últimos 14 días). Si el teléfono es de una ficha de RutaWater no lo hace salvo aunque_sea_cliente=true, después de confirmarlo con Jonathan. deshacer=true lo vuelve a incluir (lo borrado no vuelve).',
    inputSchema: {
      telefono: z.string().max(20).optional().describe('Con código de país (598…) o 09…'),
      nombre: z.string().max(100).optional().describe('Nombre como lo dijo Jonathan; si no hay teléfono, se busca en el perfil de WhatsApp'),
      motivo: z.string().max(200).optional().describe('Por qué, en pocas palabras («amigo de Jonathan»)'),
      aunque_sea_cliente: z.boolean().optional(),
      deshacer: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, handle(async (args: { telefono?: string; nombre?: string; motivo?: string; aunque_sea_cliente?: boolean; deshacer?: boolean }) =>
    excludeChat(store.db, await allClients(), args)));

  server.registerTool('consultar_jonathan', {
    title: 'Consultar a Jonathan (Telegram)',
    description: 'Le manda a Jonathan una duda por Telegram (su bot de RutaWater), con el cliente y el mensaje literal, para que conteste desde el teléfono. Devuelve consulta_id. Una duda por llamada, con la pregunta concreta. La respuesta se lee después con leer_respuestas_jonathan. El mensaje del cliente queda pendiente en WhatsApp hasta aplicar la respuesta.',
    inputSchema: {
      pregunta: z.string().min(1).max(1500).describe('La pregunta concreta, p. ej. «¿Le agendo 12 o 20 L?»'),
      cliente: z.string().max(200).optional().describe('Nombre y dirección de la ficha'),
      mensaje_cliente: z.string().max(1500).optional().describe('Texto literal del cliente (o la transcripción)'),
      telefono: z.string().max(20).optional().describe('telefono del chat (no se le muestra a Jonathan)'),
      whatsapp_ids: z.array(z.string()).max(20).optional().describe('ids de leer_whatsapp de ese caso'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, handle(async (args: { pregunta: string; cliente?: string; mensaje_cliente?: string; telefono?: string; whatsapp_ids?: string[] }) => askJonathan(args)));

  server.registerTool('leer_respuestas_jonathan', {
    title: 'Leer respuestas de Jonathan (Telegram)',
    description: 'Mensajes que Jonathan mandó al bot de Telegram y todavía no se aplicaron. tipo «respuesta»: contesta una duda (consulta trae pregunta, cliente, telefono y whatsapp_ids del caso); sin «responder» se asocia a la última pregunta abierta, y si no encaja, tomarla como instrucción. tipo «respuesta_varias»: contesta varias dudas abiertas en un mismo mensaje o audio, nombrando a cada cliente; repartirlo entre preguntas_sin_respuesta por cliente y cerrar esas dudas con marcar_respuesta_aplicada (consultas). tipo «instruccion»: una orden puntual («a Noelia agendale 2 de 20 para el jueves») o una regla nueva («Regla: …»). También lista las preguntas sin respuesta, con cliente, mensaje, teléfono e ids.',
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, handle(async () => readAnswers()));

  server.registerTool('marcar_respuesta_aplicada', {
    title: 'Marcar respuesta aplicada',
    description: 'Da por aplicadas esas respuestas de Jonathan (ids R… de leer_respuestas_jonathan) para que no vuelvan a aparecer. consultas: las dudas (ids D…) que quedaron contestadas por una respuesta_varias, o que se resolvieron sin Jonathan (el audio se pudo transcribir después, el cliente aclaró): en ese caso ids va vacío. Las que no se nombran siguen abiertas.',
    inputSchema: {
      ids: z.array(z.string().min(1)).max(50),
      consultas: z.array(z.string().min(1)).max(50).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, handle(async ({ ids, consultas }: { ids: string[]; consultas?: string[] }) => {
    if (!ids.length && !consultas?.length) throw new WriteError('Pasá al menos una respuesta (ids) o una duda (consultas).');
    return markAnswersApplied(ids, consultas);
  }));

  server.registerTool('avisar_jonathan', {
    title: 'Avisar a Jonathan (Telegram)',
    description: 'Manda un aviso corto a Jonathan por Telegram, sin esperar respuesta (por ejemplo, que se llegó al tope del mes o que la API se desconectó). Para dudas usar consultar_jonathan.',
    inputSchema: { texto: z.string().min(1).max(3500) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, handle(async ({ texto }: { texto: string }) => notifyJonathan(texto)));

  server.registerTool('marcar_revisar_transferencia', {
    title: 'Marcar transferencia para revisar',
    description: 'Deja al cliente en la lista Transferencias de la app, pendiente de que Jonathan controle si el dinero llegó (igual que «Revisar» en Deudas o «Gestionar transferencia → Agregar» en la tarjeta). Pasá monto (el del comprobante) y cuenta (Mercado Pago, OCA Blue, Prex, Santander, BROU…): se muestran en la lista para controlar en el banco. Si ya tenía una pendiente no crea otra. No marca transferencias como revisadas.',
    inputSchema: {
      cliente_id: z.string().min(1),
      monto: z.number().positive().max(10_000_000).optional().describe('Monto del comprobante, en pesos'),
      cuenta: z.string().max(60).optional().describe('Cuenta de destino: Mercado Pago, OCA Blue, Prex, Santander, BROU'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, write('marcar_revisar_transferencia', async ({ cliente_id, monto, cuenta }) => {
    const { all } = await findClient(cliente_id);
    return markTransferForReview(store.db, await store.refreshAccount(), cliente_id, all, monto, cuenta);
  }));
};

export const createServer = (store: Store, config: ServerConfig): McpServer => {
  const server = new McpServer({ name: 'rutawater', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  registerTools(server, store, config);
  return server;
};
