import { useState, useCallback } from 'react';
import { useClientsStore } from '../stores/clientsStore';
import { useAiUsageStore } from '../stores/aiUsageStore';
import { API_ENDPOINTS } from '../config/api';
import { toLocalDateString } from '../utils/helpers';
import { fbAuth } from '../config/firebase';

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
  | { tool: 'report_not_found'; input: ReportNotFoundInput };

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
      // 1) Chequear y consumir 1 parseo del contador mensual
      const tryConsume = useAiUsageStore.getState().tryConsume;
      const allowed = await tryConsume();
      if (!allowed) {
        setLimitReached(true);
        return null;
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
      const res = await fetch(API_ENDPOINTS.parseOrder, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text, clients, todayIso }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const data = (await res.json()) as ParseResult;
      return data;
    } catch (e: any) {
      const msg = e?.message || 'Error desconocido';
      console.warn('[useAiParse] error:', msg);
      setError(msg);
      return null;
    } finally {
      setParsing(false);
    }
  }, []);

  return { parsing, parse, error, limitReached, reset };
};
