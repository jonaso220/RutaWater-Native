import fs from 'fs';
import path from 'path';

/**
 * Tope diario de cargas completas (todas las fichas, deudas o transferencias
 * de un reparto). Un agente en bucle que abre el servidor una y otra vez
 * vuelve a leer todo cada vez y agota la cuota de Firestore, que es de toda
 * la cuenta (también la usa la app). El conteo vive en disco para sumar entre
 * procesos: un archivo por día, una línea por carga (append es atómico).
 */
export class ReadLimitError extends Error {}

// La cuota gratis de Firestore se reinicia a la medianoche del Pacífico.
const QUOTA_TZ = 'America/Los_Angeles';

export const quotaDay = (now: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: QUOTA_TZ }).format(now);

/** Hora de Uruguay en que se reinicia el día de la cuota (04:00 o 05:00 según el horario de EE. UU.). */
const resetTimeUruguay = (now: Date): string => {
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: QUOTA_TZ, timeZoneName: 'shortOffset' })
    .formatToParts(now).find((part) => part.type === 'timeZoneName')?.value || '';
  const hours = Number(offset.replace('GMT', '')) || -8;
  return `${String(-hours - 3).padStart(2, '0')}:00`;
};

interface LoadLine { carga: string; docs: number }

export class ReadBudget {
  constructor(
    private readonly dir: string,
    private readonly limit: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private file(): string {
    return path.join(this.dir, `${quotaDay(this.now())}.jsonl`);
  }

  private today(): LoadLine[] {
    try {
      return fs.readFileSync(this.file(), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  /** Antes de una carga completa: corta si hoy ya se llegó al tope. */
  check(what: string): void {
    if (this.limit <= 0) return;
    const loads = this.today();
    if (loads.length < this.limit) return;
    const docs = loads.reduce((sum, line) => sum + (line.docs || 0), 0);
    throw new ReadLimitError(
      `Se alcanzó el límite diario de ${this.limit} cargas completas del servidor MCP `
      + `(hoy: ${loads.length} cargas, ${docs} documentos leídos). No se cargó ${what}, `
      + 'para no agotar la cuota de Firestore que también usa la app. '
      + `Se reinicia a las ${resetTimeUruguay(this.now())} hora de Uruguay. `
      + 'No reintentes: avisale al usuario.',
    );
  }

  /** Después de la carga: la anota con cuántos documentos trajo. */
  record(what: string, docs: number): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(this.file(), `${JSON.stringify({ at: this.now().toISOString(), pid: process.pid, carga: what, docs })}\n`);
    } catch (error) {
      console.error('No se pudo anotar la carga en el registro diario:', error);
    }
  }
}

// Sin configurar (tests), no hay tope.
let active: ReadBudget | null = null;

export const setReadBudget = (budget: ReadBudget | null): void => { active = budget; };

export const checkFullLoad = (what: string): void => active?.check(what);

export const recordFullLoad = (what: string, docs: number): void => active?.record(what, docs);
