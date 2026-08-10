import { useState, useCallback, useRef } from 'react';
import { useClientsStore } from '../stores/clientsStore';
import { useAiUsageStore } from '../stores/aiUsageStore';
import { API_ENDPOINTS } from '../config/api';
import { toLocalDateString } from '../utils/helpers';
import { fbAuth } from '../config/firebase';
import { looksLikeCompleteClientCardText, parseDirectoryContactCard } from '../utils/googleMapsLink';
import { isAiLimitResponse, quotaFromResponseBody } from '../utils/aiQuota';
import i18n from '../i18n';
import { useProductCatalogStore } from '../stores/productCatalogStore';
import {
  AiParseContext,
  AiProductError,
  buildAiClientPayload,
  buildAiProductCatalog,
  fingerprintCatalog,
  fingerprintClientState,
  getAiLocale,
  validateAiProductResult,
} from '../utils/aiProducts';

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

type ParseResultPayload =
  | { tool: 'create_new_client'; input: CreateNewClientInput }
  | { tool: 'schedule_existing_client'; input: ScheduleExistingClientInput }
  | { tool: 'merge_products_into_order'; input: MergeProductsInput }
  | { tool: 'update_client_data'; input: UpdateClientDataInput }
  | { tool: 'add_standalone_note'; input: AddStandaloneNoteInput }
  | { tool: 'report_not_found'; input: ReportNotFoundInput }
  | { tool: 'report_no_action'; input: ReportNoActionInput };

export type ParseResult = ParseResultPayload & { context?: AiParseContext };

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
  const requestEpochRef = useRef(0);

  const reset = useCallback(() => {
    requestEpochRef.current += 1;
    setParsing(false);
    setError(null);
    setLimitReached(false);
  }, []);

  const parse = useCallback(async (text: string): Promise<ParseResult | null> => {
    const requestEpoch = ++requestEpochRef.current;
    const isCurrentRequest = () => requestEpoch === requestEpochRef.current;
    setParsing(true);
    setError(null);
    setLimitReached(false);

    try {
      const sourceText = text.trim();
      const catalogState = useProductCatalogStore.getState();
      if (!catalogState.loaded || catalogState.loadError || !catalogState.scopeKey) {
        throw new Error(i18n.t('smartOrder.catalogNotReady'));
      }
      const catalog = buildAiProductCatalog(catalogState.allProducts, catalogState.hidden);
      const clientsState = useClientsStore.getState();
      if (clientsState.loading || !clientsState.scopeKey) {
        throw new Error(i18n.t('smartOrder.clientsNotReady'));
      }
      const clients = buildAiClientPayload(clientsState.clients);
      const locale = getAiLocale(i18n.resolvedLanguage || i18n.language);
      // Local date: toISOString() is UTC and already says "tomorrow" after
      // 21:00 in UTC-3, shifting every relative date the AI resolves.
      const todayIso = toLocalDateString(new Date());
      const context: AiParseContext = {
        sourceText,
        todayIso,
        locale,
        catalogScopeKey: catalogState.scopeKey,
        catalogGeneration: catalogState.generation,
        catalogFingerprint: fingerprintCatalog(catalog),
        clientsScopeKey: clientsState.scopeKey,
        clientsFingerprint: fingerprintClientState(clientsState.clients),
      };

      // Una ficha sin nombre separado no necesita interpretación semántica:
      // dirección + Maps + teléfono ya determinan exactamente el alta pedida.
      // Resolverla antes del fetch evita que un backend publicado con un prompt
      // anterior vuelva a responder "cliente no encontrado". Además no consume
      // un parseo de IA porque en este camino no se consulta ningún modelo.
      const localCard = parseDirectoryContactCard(sourceText);
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
          context,
        };
      }

      const idToken = await fbAuth.currentUser?.getIdToken();
      if (!isCurrentRequest()) return null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (idToken) headers.Authorization = `Bearer ${idToken}`;

      // 3) Llamar al servidor local / Netlify
      const requestParse = async (requestText: string): Promise<Response> => {
        const requestInit = {
          method: 'POST',
          headers,
          body: JSON.stringify({
            text: requestText,
            clients,
            todayIso,
            catalog,
            locale,
          }),
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

      let res = await requestParse(sourceText);
      if (!isCurrentRequest()) return null;

      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        const quota = quotaFromResponseBody(body);
        if (quota && isCurrentRequest()) {
          useAiUsageStore.setState({ ...quota, loading: false });
        }
        if (isAiLimitResponse(res.status, body)) {
          if (isCurrentRequest()) setLimitReached(true);
          return null;
        }
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      let data = (await res.json()) as ParseResultPayload & { quota?: unknown };
      const firstQuota = quotaFromResponseBody(data);
      if (firstQuota && isCurrentRequest()) {
        useAiUsageStore.setState({ ...firstQuota, loading: false });
      }

      // El backend actual ya reintenta internamente las fichas completas. Si
      // aun devuelve report_not_found, la ficha suficientemente estructurada
      // se recupera en forma local: no hacemos una segunda llamada facturable
      // ni consumimos dos cupos por una sola acción del usuario.
      if (data.tool === 'report_not_found' && looksLikeCompleteClientCardText(sourceText)) {
        const card = parseDirectoryContactCard(sourceText);
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

      const validated = validateAiProductResult(data, catalog, clients);
      if (!isCurrentRequest()) return null;
      return { ...validated, context } as ParseResult;
    } catch (e: any) {
      const raw = e?.message || 'Error desconocido';
      const isNetwork = /network request failed|failed to fetch|abort/i.test(raw);
      const msg = e instanceof AiProductError
        ? i18n.t('smartOrder.invalidProductsReinterpret')
        : isNetwork
          ? i18n.t('smartOrder.networkError')
          : raw;
      if (isCurrentRequest()) {
        console.warn('[useAiParse] error:', raw);
        setError(msg);
      }
      return null;
    } finally {
      if (isCurrentRequest()) setParsing(false);
    }
  }, []);

  return { parsing, parse, error, limitReached, reset };
};
