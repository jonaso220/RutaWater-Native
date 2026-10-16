import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Client } from '../../src/types';
import { appendAudit } from './audit';
import type { ServerConfig } from './config';
import { findRoute, Route } from './routes';
import type { Store } from './store';
import {
  addDays, agendaFor, clientDetail, clientSummary, debtReport, debtsForClient, debtTotalMessage, hasPendingTransfer,
  isValidIsoDate, productCatalog, searchClients, todayKey, weekdayOf, whatsappTemplates,
} from './views';
import {
  advanceVisit, ChangeResult, changeFrequency, markDone, markTransferForReview, registerPayment, scheduleOnce, setNote,
  setProducts, setStar, undoDone, WriteError,
} from './writes';

const INSTRUCTIONS = `Acceso directo a RutaWater (reparto de agua) de la cuenta configurada.
- Las fechas son aaaa-mm-dd en hora de Uruguay; agenda_del_dia también acepta «hoy» y «mañana».
- Buscá al cliente con buscar_clientes y usá su id en las demás herramientas.
- Las escrituras devuelven antes/después confirmado por el servidor; si «cambiado» es false ya estaba así.
- marcar_favorito fija la estrella (no la alterna). marcar_listo usa la misma lógica que el botón Listo y se puede deshacer desde la app.
- adelantar_visita trae la próxima visita de un cliente con frecuencia a una fecha más cercana del mismo día (como cambiar la fecha de inicio en Editar cliente).
- agendar_una_vez agenda una visita de una vez con sus productos (como Directorio → Agendar → Una vez): una ficha de directorio pasa a ser esa visita; a un cliente que ya está en agenda se le agrega otra ficha sin tocar la suya. La ficha de la visita queda sin nota ni estrella, como en la app. Si ya tiene visita ese día no agrega otra.
- cambiar_frecuencia cambia semanal/quincenal/cada 3 semanas/mensual manteniendo los días (como Editar cliente).
- registrar_pago salda deudas como Registrar pago / Editar deuda de la app (las más viejas primero; un pago parcial deja el saldo). Pasá deuda_esperada = deuda_total de ver_cliente: si cambió no registra nada. Lo pagado de más vuelve como «sobrante» y no se guarda: anotalo en la nota.
- marcar_revisar_transferencia deja al cliente en la lista Transferencias (como Revisar en Deudas). Marcar una transferencia como revisada queda solo para la app.
- No hay herramientas para borrar clientes, crear deudas, precios ni días de visita.`;

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
    description: 'Marca Listo la visita de esa fecha (igual que el botón Listo): la app calcula sola la próxima visita, que se devuelve. Falla si la fecha no es una visita pendiente.',
    inputSchema: { cliente_id: z.string().min(1), fecha: z.string().describe('aaaa-mm-dd de la visita, «hoy» o «mañana»') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, write('marcar_listo', async ({ cliente_id, fecha }) => markDone(
    store.db, await store.refreshAccount(), cliente_id, resolveDate(fecha),
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

  server.registerTool('agendar_una_vez', {
    title: 'Agendar una vez',
    description: 'Agenda una visita de una vez para esa fecha con esos productos, igual que Directorio → Agendar / + Visita → Una vez: si la ficha es solo de directorio, esa misma ficha pasa a ser la visita; si el cliente ya está en agenda, se agrega otra ficha con el mismo cliente y la suya no cambia. Queda primera en la lista del día. Como en la app, la ficha de la visita queda con nota vacía y sin estrella (en una ficha de directorio, antes muestra la nota y la estrella que tenía, para restaurarlas con actualizar_nota y marcar_favorito). Si el cliente ya tiene una visita esa fecha no agrega otra (cambiado=false, devuelve su ficha_id para fijar_productos). Rechaza fechas pasadas.',
    inputSchema: {
      cliente_id: z.string().min(1),
      fecha: z.string().describe('aaaa-mm-dd, «hoy» o «mañana»'),
      productos: z.record(z.string(), z.number().int().min(0).max(9999)).describe('{ id_producto: cantidad }, ids de ver_productos'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, write('agendar_una_vez', async ({ cliente_id, fecha, productos }) => scheduleOnce(
    store.db, await store.refreshAccount(), await catalog(), cliente_id, resolveDate(fecha), productos,
  )));

  server.registerTool('registrar_pago', {
    title: 'Registrar pago',
    description: 'Registra un pago de deuda como Deudas en la app: salda las deudas más viejas primero (Registrar pago) y, si el monto no cubre una, la deja con el saldo que queda (Editar deuda). deuda_esperada = deuda_total que leíste en ver_cliente: si cambió, no se registra nada (evita pagos dobles). Devuelve antes/después, aplicado_a_deuda y sobrante (pago de más: saldo a favor, que RutaWater no guarda). Falla si el cliente no tiene deudas.',
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

  server.registerTool('marcar_revisar_transferencia', {
    title: 'Marcar transferencia para revisar',
    description: 'Deja al cliente en la lista Transferencias de la app, pendiente de que Jonathan controle si el dinero llegó (igual que «Revisar» en Deudas o «Gestionar transferencia → Agregar» en la tarjeta). Si ya tenía una pendiente no crea otra. No marca transferencias como revisadas.',
    inputSchema: { cliente_id: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, write('marcar_revisar_transferencia', async ({ cliente_id }) => {
    const { all } = await findClient(cliente_id);
    return markTransferForReview(store.db, await store.refreshAccount(), cliente_id, all);
  }));
};

export const createServer = (store: Store, config: ServerConfig): McpServer => {
  const server = new McpServer({ name: 'rutawater', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  registerTools(server, store, config);
  return server;
};
