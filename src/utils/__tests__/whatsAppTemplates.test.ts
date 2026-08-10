import {
  EMPTY_WHATSAPP_TEMPLATES,
  buildWhatsAppTemplatePatch,
  normalizeWhatsAppTemplates,
  shouldClearTemplateDirtyField,
  templatesForScope,
} from '../whatsAppTemplates';

describe('normalizeWhatsAppTemplates', () => {
  test('clears missing, null and invalid values instead of preserving another scope', () => {
    expect(normalizeWhatsAppTemplates({
      whatsappEnCamino: null,
      whatsappDeuda: 'Deuda actual',
    })).toEqual({
      whatsappEnCamino: '',
      whatsappDeuda: 'Deuda actual',
      whatsappRecordatorio: '',
    });
    expect(normalizeWhatsAppTemplates(undefined)).toEqual(EMPTY_WHATSAPP_TEMPLATES);
  });
});

describe('buildWhatsAppTemplatePatch', () => {
  test('writes only fields edited by this device', () => {
    const values = {
      whatsappEnCamino: 'Sin cambios',
      whatsappDeuda: '  Nueva deuda  ',
      whatsappRecordatorio: 'Sin cambios',
    };

    expect(buildWhatsAppTemplatePatch(values, new Set(['whatsappDeuda']))).toEqual({
      whatsappDeuda: 'Nueva deuda',
    });
  });

  test('uses null to restore the default for an edited empty field', () => {
    expect(buildWhatsAppTemplatePatch(
      { ...EMPTY_WHATSAPP_TEMPLATES, whatsappEnCamino: '   ' },
      new Set(['whatsappEnCamino']),
    )).toEqual({ whatsappEnCamino: null });
  });
});

describe('templatesForScope', () => {
  test('never exposes settings that belong to another scope', () => {
    const data = { ...EMPTY_WHATSAPP_TEMPLATES, whatsappEnCamino: 'Cuenta A' };
    expect(templatesForScope('group-b', { scopeKey: 'group-a', data })).toBeNull();
    expect(templatesForScope('group-a', { scopeKey: 'group-a', data })).toEqual(data);
  });
});

describe('shouldClearTemplateDirtyField', () => {
  test('keeps a field dirty when it changed again while the save was pending', () => {
    expect(shouldClearTemplateDirtyField(2, 3)).toBe(false);
    expect(shouldClearTemplateDirtyField(2, 2)).toBe(true);
    expect(shouldClearTemplateDirtyField(undefined, 0)).toBe(false);
  });
});
