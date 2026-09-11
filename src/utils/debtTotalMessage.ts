import { formatMoney } from './format';
import { normalizePhone } from './helpers';
import { buildWhatsAppMessageUrl } from './whatsAppTemplates';

// Shared by the client debt modal and the grouped debts list.
export const buildDebtTotalWhatsAppUrl = (
  phone: string,
  total: number,
  debtTemplate?: string,
): string | null => {
  if (!phone || total <= 0) return null;
  const template = debtTemplate || 'La deuda es de ${total}. Saludos';
  const message = template.replace('${total}', formatMoney(total));
  return buildWhatsAppMessageUrl(normalizePhone(phone), message);
};
