export const WHATSAPP_TEMPLATE_FIELDS = [
  'whatsappEnCamino',
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
  whatsappDeuda: '',
  whatsappRecordatorio: '',
};

export const normalizeWhatsAppTemplates = (data: unknown): WhatsAppTemplateValues => {
  const source = data && typeof data === 'object'
    ? data as Record<string, unknown>
    : {};

  return {
    whatsappEnCamino: typeof source.whatsappEnCamino === 'string' ? source.whatsappEnCamino : '',
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
