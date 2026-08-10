export const DEFAULT_EN_CAMINO = 'Buenas 🚚. Ya estamos en camino, sos el/la siguiente en la lista de entrega. ¡Nos vemos en unos minutos!\n\nAquapura';
export const DEFAULT_TOMORROW_VISIT = 'Buenas 👋 Te escribo para recordarte que mañana andaremos por tu casa 🚛💧\n\nEn caso de que ya sepas lo que vas a necesitar, te agradezco que me lo digas así lo pongo en la agenda 📝✅\n\n¡Saludos! 😃';

export const resolveClientCardWhatsAppMessage = (
  isTomorrowVisit: boolean,
  enCaminoMessage?: string,
  tomorrowVisitMessage?: string,
): string => (
  isTomorrowVisit
    ? (tomorrowVisitMessage || DEFAULT_TOMORROW_VISIT)
    : (enCaminoMessage || DEFAULT_EN_CAMINO)
);

export const buildWhatsAppMessageUrl = (normalizedPhone: string, message: string): string => (
  `whatsapp://send?phone=${normalizedPhone}&text=${encodeURIComponent(message)}`
);

export const WHATSAPP_TEMPLATE_FIELDS = [
  'whatsappEnCamino',
  'whatsappTomorrowVisit',
  'whatsappDeuda',
  'whatsappRecordatorio',
] as const;

export type WhatsAppTemplateField = typeof WHATSAPP_TEMPLATE_FIELDS[number];

export type WhatsAppTemplateValues = Record<WhatsAppTemplateField, string>;

export interface ScopedWhatsAppTemplates {
  scopeKey: string;
  data: WhatsAppTemplateValues | null;
}

export const EMPTY_WHATSAPP_TEMPLATES: WhatsAppTemplateValues = {
  whatsappEnCamino: '',
  whatsappTomorrowVisit: '',
  whatsappDeuda: '',
  whatsappRecordatorio: '',
};

export const normalizeWhatsAppTemplates = (data: unknown): WhatsAppTemplateValues => {
  const source = data && typeof data === 'object'
    ? data as Record<string, unknown>
    : {};

  return {
    whatsappEnCamino: typeof source.whatsappEnCamino === 'string' ? source.whatsappEnCamino : '',
    whatsappTomorrowVisit: typeof source.whatsappTomorrowVisit === 'string' ? source.whatsappTomorrowVisit : '',
    whatsappDeuda: typeof source.whatsappDeuda === 'string' ? source.whatsappDeuda : '',
    whatsappRecordatorio: typeof source.whatsappRecordatorio === 'string' ? source.whatsappRecordatorio : '',
  };
};

export const buildWhatsAppTemplatePatch = (
  values: WhatsAppTemplateValues,
  dirtyFields: ReadonlySet<WhatsAppTemplateField>,
): Partial<Record<WhatsAppTemplateField, string | null>> => {
  const patch: Partial<Record<WhatsAppTemplateField, string | null>> = {};
  WHATSAPP_TEMPLATE_FIELDS.forEach((field) => {
    if (!dirtyFields.has(field)) return;
    patch[field] = values[field].trim() || null;
  });
  return patch;
};

export const templatesForScope = (
  currentScopeKey: string,
  snapshot: ScopedWhatsAppTemplates,
): WhatsAppTemplateValues | null => (
  currentScopeKey && snapshot.scopeKey === currentScopeKey ? snapshot.data : null
);

export const shouldClearTemplateDirtyField = (
  savedRevision: number | undefined,
  currentRevision: number,
): boolean => savedRevision !== undefined && savedRevision === currentRevision;
