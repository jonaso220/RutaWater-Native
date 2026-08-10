import {
  DEFAULT_EN_CAMINO,
  DEFAULT_TOMORROW_VISIT,
  EMPTY_WHATSAPP_TEMPLATES,
  buildWhatsAppMessageUrl,
  buildWhatsAppTemplatePatch,
  normalizeWhatsAppTemplates,
  resolveClientCardWhatsAppMessage,
  shouldClearTemplateDirtyField,
  templatesForScope,
} from '../whatsAppTemplates';

test('keeps the approved tomorrow-visit message exactly as the default', () => {
  expect(DEFAULT_TOMORROW_VISIT).toBe(
    'Buenas 👋 Te escribo para recordarte que mañana andaremos por tu casa 🚛💧\n\n'
    + 'En caso de que ya sepas lo que vas a necesitar, te agradezco que me lo digas así lo pongo en la agenda 📝✅\n\n'
    + '¡Saludos! 😃',
  );
});

describe('client-card WhatsApp message', () => {
  test('uses the tomorrow template only for the tomorrow section', () => {
    expect(resolveClientCardWhatsAppMessage(true, 'En camino personalizado', 'Aviso personalizado'))
      .toBe('Aviso personalizado');
    expect(resolveClientCardWhatsAppMessage(false, 'En camino personalizado', 'Aviso personalizado'))
      .toBe('En camino personalizado');
    expect(resolveClientCardWhatsAppMessage(true)).toBe(DEFAULT_TOMORROW_VISIT);
    expect(resolveClientCardWhatsAppMessage(false)).toBe(DEFAULT_EN_CAMINO);
  });

  test('encodes the complete message in the WhatsApp URL', () => {
    const url = buildWhatsAppMessageUrl('59899123456', DEFAULT_TOMORROW_VISIT);
    expect(url).toBe(
      `whatsapp://send?phone=59899123456&text=${encodeURIComponent(DEFAULT_TOMORROW_VISIT)}`,
    );
  });
});

describe('normalizeWhatsAppTemplates', () => {
  test('clears missing, null and invalid values instead of preserving another scope', () => {
    expect(normalizeWhatsAppTemplates({
      whatsappEnCamino: null,
      whatsappDeuda: 'Deuda actual',
    })).toEqual({
      whatsappEnCamino: '',
      whatsappTomorrowVisit: '',
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
      whatsappTomorrowVisit: 'Sin cambios',
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

  test('persists only the new tomorrow template when it is the edited field', () => {
    expect(buildWhatsAppTemplatePatch(
      { ...EMPTY_WHATSAPP_TEMPLATES, whatsappTomorrowVisit: '  Aviso propio  ' },
      new Set(['whatsappTomorrowVisit']),
    )).toEqual({ whatsappTomorrowVisit: 'Aviso propio' });
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
