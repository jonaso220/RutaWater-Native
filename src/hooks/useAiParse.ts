import { useState, useCallback } from 'react';
import { useClientsStore } from '../stores/clientsStore';
import { useAiUsageStore } from '../stores/aiUsageStore';
import { API_ENDPOINTS } from '../config/api';
import { toLocalDateString } from '../utils/helpers';
import { fbAuth } from '../config/firebase';
import { looksLikeCompleteClientCardText, parseDirectoryContactCard } from '../utils/googleMapsLink';
import { isAiLimitResponse, quotaFromResponseBody } from '../utils/aiQuota';

export interface CreateNewClientInput {
  name: string;
  phone: string;
  address: string;
  mapsLink: string;
  notes: string;
  products: Record<string, number>;
  freq: 'weekly' | 'biweekly' | 'triweekly' | 'monthly' | 'once' | 'on_demand';
  visitDay: string;
  specificDate: string;
}

export type NotesMode = 'append' | 'replace' | 'clear' | 'keep';
export type ScheduleMode = 'replace' | 'add';

export interface ScheduleExistingClientInput {
  matched_client_id: string;
  matched_client_name: string;
  products: Record<string, number>;
  add_products?: Record<string, number>;
  remove_products?: Record<string, number>;
  freq: 'weekly' | 'biweekly' | 'triweekly' | 'monthly' | 'once' | 'on_demand' | 'keep';
  visitDay: string;
  specificDate: string;
  schedule_mode?: ScheduleMode;
  notes: string;
  notes_mode?: NotesMode;
}

export interface MergeProductsInput {
  matched_client_id: string;
  matched_client_name: string;
  add_products: Record<string, number>;
  remove_products: Record<string, number>;
  notes: string;
  notes_mode: NotesMode;
}

export interface UpdateClientDataInput {
  matched_client_id: string;
  matched_client_name: string;
  mapsLink: string;
  address: string;
  phone: string;
  notes: string;
  notes_mode: NotesMode;
}

export interface ReportNotFoundInput {
  mentioned_name: string;
  reason: string;
}

export interface ReportNoActionInput {
  message: string;
}

export interface AddStandaloneNoteInput {
  notes: string;
  specificDate: string;
}

export type ParseResult =
  | { tool: 'create_new_client'; input: CreateNewClientInput }
  | { tool: 'schedule_existing_client'; input: ScheduleExistingClientInput }
  | { tool: 'merge_products_into_order'; input: MergeProductsInput }
  | { tool: 'update_client_data'; input: UpdateClientDataInput }
  | { tool: 'add_standalone_note'; input: AddStandaloneNoteInput }
  | { tool: 'report_not_found'; input: ReportNotFoundInput }
  | { tool: 'report_no_action'; input: ReportNoActionInput };

interface UseAiParseReturn {
  parsing: boolean;
  parse: (text: string) => Promise<ParseResult | null>;
  error: string | null;
  limitReached: boolean;
  reset: () => void;
}

export const useAiParse = (): UseAiParseReturn => {
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  const reset = useCallback(() => {
    setError(null);
    setLimitReached(false);
  }, []);

  const parse = useCallback(async (text: string): Promise<ParseResult | null> => {
    setParsing(true);
    setError(null);
    setLimitReached(false);

    try {
      // Una ficha sin nombre separado no necesita interpretación semántica:
      // dirección + Maps + teléfono ya determinan exactamente el alta pedida.
      // Resolverla antes del fetch evita que un backend publicado con un prompt
      // anterior vuelva a responder "cliente no encontrado". Además no consume
      // un parseo de IA porque en este camino no se consulta ningún modelo.
      const localCard = parseDirectoryContactCard(text);
      if (localCard?.usedAddressAsName) {
        const { usedAddressAsName: _usedAddressAsName, ...contact } = localCard;
        return {
          tool: 'create_new_client',
          input: {
            ...contact,
            notes: '',
            products: {},
            freq: 'on_demand',
            visitDay: '',
            specificDate: '',
          },
        };
      }

      // 2) Construir lista de clientes con estado del pedido pendiente.
      //    Un mismo cliente puede aparecer en MÚLTIPLES filas: una por cada pedido
      //    activo (ej: "Farmacia Central" puede tener un pedido semanal de lunes Y
      //    un pedido puntual de sábado al mismo tiempo, son docs separados).
      //    Si solo tiene la "ficha" en directorio (on_demand), aparece una sola fila.
      //    Pero si hay duplicados con on_demand + alguno activo, omitimos el on_demand
      //    para no confundir a la IA cuando claramente hay un pedido pendiente.
      const allClients = useClientsStore.getState().clients.filter((c) => c.name && !c.isNote);
      const groupedByKey = new Map<string, typeof allClients>();
      for (const c of allClients) {
        const key = `${(c.name || '').toLowerCase().trim()}|${(c.phone || '').replace(/\D/g, '')}`;
        const arr = groupedByKey.get(key) || [];
        arr.push(c);
        groupedByKey.set(key, arr);
      }
      const visibleClients: typeof allClients = [];
      for (const group of groupedByKey.values()) {
        const hasActive = group.some((c) => c.freq && c.freq !== 'on_demand');
        for (const c of group) {
          // Si existe versión activa, omitimos las on_demand (son la "ficha" duplicada)
          if (hasActive && c.freq === 'on_demand') continue;
          visibleClients.push(c);
        }
      }
      const clients = visibleClients.map((c) => {
        const products: Record<string, number> = {};
        if (c.products) {
          Object.entries(c.products).forEach(([k, v]) => {
            const n = typeof v === 'number' ? v : parseInt(String(v), 10);
            if (n > 0) products[k] = n;
          });
        }
        return {
          id: c.id,
          name: c.name,
          address: c.address || '',
          freq: c.freq || 'on_demand',
          visitDay: c.visitDay || '',
          specificDate: c.specificDate || '',
          products,
          notes: c.notes || '',
        };
      });
      // Local date: toISOString() is UTC and already says "tomorrow" after
      // 21:00 in UTC-3, shifting every relative date the AI resolves.
      const todayIso = toLocalDateString(new Date());

      const idToken = await fbAuth.currentUser?.getIdToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (idToken) headers.Authorization = `Bearer ${idToken}`;

      // 3) Llamar al servidor local / Netlify
      const requestParse = async (requestText: string): Promise<Response> => {
        const requestInit = {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: requestText, clients, todayIso }),
        };
        try {
          let response = await fetch(API_ENDPOINTS.parseOrder, requestInit);
          // Un servidor local levantado pero mal configurado (sin API key, por
          // ejemplo) tampoco debe inutilizar Pedido IA en el simulador.
          if (response.status >= 500 && API_ENDPOINTS.parseOrderFallback) {
            response = await fetch(API_ENDPOINTS.parseOrderFallback, requestInit);
          }
          return response;
        } catch (localError) {
          if (!API_ENDPOINTS.parseOrderFallback) throw localError;
          return fetch(API_ENDPOINTS.parseOrderFallback, requestInit);
        }
      };

      let res = await requestParse(text);

      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        const quota = quotaFromResponseBody(body);
        if (quota) {
          useAiUsageStore.setState({ ...quota, loading: false });
        }
        if (isAiLimitResponse(res.status, body)) {
          setLimitReached(true);
          return null;
        }
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      let data = (await res.json()) as ParseResult & { quota?: unknown };
      const firstQuota = quotaFromResponseBody(data);
      if (firstQuota) {
        useAiUsageStore.setState({ ...firstQuota, loading: false });
      }

      // El backend actual ya reintenta internamente las fichas completas. Si
      // aun devuelve report_not_found, la ficha suficientemente estructurada
      // se recupera en forma local: no hacemos una segunda llamada facturable
      // ni consumimos dos cupos por una sola acción del usuario.
      if (data.tool === 'report_not_found' && looksLikeCompleteClientCardText(text)) {
        const card = parseDirectoryContactCard(text);
        if (card) {
          const { usedAddressAsName: _usedAddressAsName, ...contact } = card;
          data = {
            tool: 'create_new_client',
            input: {
              ...contact,
              notes: '',
              products: {},
              freq: 'on_demand',
              visitDay: '',
              specificDate: '',
            },
          };
        }
      }

      return data;
    } catch (e: any) {
      const raw = e?.message || 'Error desconocido';
      const isNetwork = /network request failed|failed to fetch|abort/i.test(raw);
      const msg = isNetwork
        ? 'Sin conexión. Verificá tu internet e intentá de nuevo.'
        : raw;
      console.warn('[useAiParse] error:', raw);
      setError(msg);
      return null;
    } finally {
      setParsing(false);
    }
  }, []);

  return { parsing, parse, error, limitReached, reset };
};
