import { execFile } from 'node:child_process';
import { WriteError } from './writes';

// Contactos del Mac (iCloud, los mismos del iPhone y de WhatsApp). Jonathan,
// 24/10/2026: cada cliente queda como «Nombre - Dirección -» con el link de
// Maps al final (en el apellido, como los que ya tenía), con mayúscula inicial.
// Si ya hay un contacto con ese teléfono se le cambia el nombre; si no, se crea.

const SCRIPT = `
function run(argv) {
  const [first, last, phone] = argv;
  const key = (s) => String(s || '').replace(/\\D/g, '').slice(-8);
  const C = Application('Contacts');
  const ids = C.people.id();
  const phones = C.people.phones.value();
  const matches = ids.filter((id, i) => (phones[i] || []).some((p) => key(p) === key(phone)));
  for (const id of matches) {
    const person = C.people.byId(id);
    person.firstName = first;
    person.lastName = last;
  }
  if (!matches.length) {
    const person = C.Person({ firstName: first, lastName: last });
    C.people.push(person);
    person.phones.push(C.Phone({ label: 'mobile', value: phone }));
  }
  C.save();
  return JSON.stringify({ actualizados: matches.length, creado: !matches.length });
}`;

const digits = (value: string) => value.replace(/\D/g, '');

/** Teléfono uruguayo en formato internacional: 099 123 456 → +59899123456. */
export const uyPhone = (value: string): string => {
  const d = digits(value);
  if (d.startsWith('598') && d.length >= 11) return `+${d}`;
  if (d.startsWith('0') && d.length === 9) return `+598${d.slice(1)}`;
  if (d.length === 8 && d.startsWith('9')) return `+598${d}`;
  throw new WriteError(`Teléfono inválido: ${value}. Usá 099123456 o +59899123456.`);
};

export const contactName = (name: string, address: string, mapsLink: string) => {
  const parts = [name.trim(), address.trim()].filter(Boolean);
  const link = mapsLink.trim();
  return { first: parts.join(' - ') + (link ? ' -' : ''), last: link };
};

export const saveContact = (input: { nombre: string; direccion?: string; link_maps?: string; telefono: string }) => {
  const phone = uyPhone(input.telefono);
  const { first, last } = contactName(input.nombre, input.direccion || '', input.link_maps || '');
  if (!input.nombre.trim()) throw new WriteError('Falta el nombre.');
  return new Promise<unknown>((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SCRIPT, first, last, phone], { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr.trim().split('\n').pop() || error.message;
        return reject(new WriteError(`No se pudo guardar el contacto: ${detail}. Puede faltar el permiso de Contactos en el Mac (o quedó esperando que lo acepten): el cliente en RutaWater no se toca; anotarlo en state/contactos-pendientes.jsonl para guardarlo después.`));
      }
      resolve({ contacto: `${first} ${last}`.trim(), telefono: phone, ...JSON.parse(stdout.trim() || '{}') });
    });
  });
};
