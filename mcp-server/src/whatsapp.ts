import { execFile } from 'node:child_process';

// Abre un chat de WhatsApp en el Mac con el mismo enlace que arma RutaWater
// (botón Avisar / ícono de WhatsApp de la tarjeta). Lo necesitan las tareas de
// la nube: sus comandos corren en una VM que no puede abrir apps del Mac,
// mientras que este servidor sí corre en el Mac (20/10/2026). Solo deja el
// borrador: el envío y su verificación siguen en WhatsApp.

// Mismos caracteres que deja sin codificar encodeURIComponent (whatsAppTemplates.ts).
const encode = (text: string) => encodeURIComponent(text);

export const applyReplacements = (text: string, replacements: string[]): string => {
  let result = text;
  for (const rule of replacements) {
    const at = rule.indexOf('=>');
    if (at < 0) throw new Error(`Reemplazo inválido «${rule}»: usá el formato «texto viejo=>texto nuevo».`);
    const [old, replacement] = [rule.slice(0, at), rule.slice(at + 2)];
    const count = result.split(old).length - 1;
    if (count !== 1) throw new Error(`«${old}» aparece ${count} veces en el mensaje; se esperaba exactamente una.`);
    result = result.replace(old, replacement);
  }
  return result;
};

export const whatsappUrl = (phone: string, text?: string): string => {
  if (!/^\d{8,15}$/.test(phone)) throw new Error(`Número inválido: «${phone}». Usá el campo whatsapp de la ficha (solo dígitos, con código de país).`);
  return `whatsapp://send?phone=${phone}${text ? `&text=${encode(text)}` : ''}`;
};

export const openWhatsapp = (phone: string, text?: string): Promise<{ telefono: string; borrador: string | null; abierto: true }> => {
  const url = whatsappUrl(phone, text);
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/open', [url], { timeout: 15_000 }, (error) => {
      if (error) reject(new Error(`No se pudo abrir WhatsApp: ${error.message}`));
      else resolve({ telefono: phone, borrador: text ?? null, abierto: true });
    });
  });
};
