import { Client } from '../types';
import { getClientPhones } from './clientPhones';
import { normalizeGoogleMapsLink } from './googleMapsLink';

export interface ClientBillingInfo {
  rut: string;
  businessName: string;
  email: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const sanitizeClientBillingInfo = (
  value: Partial<ClientBillingInfo> | null | undefined,
): ClientBillingInfo => ({
  // El RUT se guarda tal cual lo escribió el usuario (con o sin puntos/guiones):
  // cada distribuidor lo copia de la factura del cliente en su propio formato.
  rut: (value?.rut || '').trim().slice(0, 40),
  businessName: (value?.businessName || '').trim().slice(0, 150),
  email: (value?.email || '').trim().toLowerCase().slice(0, 150),
});

export const isValidClientEmail = (email: string): boolean =>
  !email.trim() || EMAIL_REGEX.test(email.trim());

/**
 * Only the billing fields that actually changed, so unrelated edits don't
 * write empty strings over legacy documents that never had these fields.
 */
export const billingInfoUpdates = (
  client: Partial<Pick<Client, 'rut' | 'businessName' | 'email'>>,
  draft: Partial<ClientBillingInfo>,
): Partial<ClientBillingInfo> => {
  const next = sanitizeClientBillingInfo(draft);
  const current = sanitizeClientBillingInfo(client);
  const updates: Partial<ClientBillingInfo> = {};
  (Object.keys(next) as (keyof ClientBillingInfo)[]).forEach((key) => {
    if (next[key] !== current[key]) updates[key] = next[key];
  });
  return updates;
};

export interface ClientShareLabels {
  title: string;
  name: string;
  address: string;
  location: string;
  rut: string;
  businessName: string;
  email: string;
  phone: string;
}

/**
 * Ficha del cliente lista para compartir. Usa *negrita* de WhatsApp en las
 * etiquetas y omite los campos vacíos para que el mensaje quede prolijo.
 */
export const buildClientShareMessage = (
  client: Client,
  labels: ClientShareLabels,
): string => {
  const billing = sanitizeClientBillingInfo(client);
  // El link que cargó el usuario es el que conoce; las coordenadas solo cubren
  // clientes que tienen ubicación pero no guardaron un link.
  const mapsLink = normalizeGoogleMapsLink(client.mapsLink)
    || (client.lat && client.lng
      ? `https://www.google.com/maps/search/?api=1&query=${client.lat},${client.lng}`
      : '');
  const phones = getClientPhones(client).map((phone) => phone.number).join(' / ');

  const rows: [string, string][] = [
    [labels.name, (client.name || '').trim()],
    [labels.address, (client.address || '').trim()],
    [labels.location, mapsLink || ''],
    [labels.rut, billing.rut],
    [labels.businessName, billing.businessName],
    [labels.email, billing.email],
    [labels.phone, phones || (client.phone || '').trim()],
  ];

  const lines = rows
    .filter(([, value]) => !!value)
    .map(([label, value]) => `*${label}:* ${value}`);

  return [`*${labels.title}*`, '', ...lines].join('\n');
};
