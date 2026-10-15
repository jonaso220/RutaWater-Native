import fs from 'fs';
import path from 'path';

/**
 * Registro local (JSONL) de cada escritura: qué herramienta, qué ficha y el
 * antes/después. Queda en el Mac, fuera de Firestore, para revisar o revertir.
 */
export const appendAudit = (auditPath: string, entry: Record<string, unknown>): void => {
  try {
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    fs.appendFileSync(auditPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch (error) {
    // Nunca bloquear una escritura ya confirmada por no poder registrar.
    console.error('No se pudo escribir el registro de auditoría:', error);
  }
};
