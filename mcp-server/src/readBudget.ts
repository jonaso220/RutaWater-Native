import fs from 'fs';
import path from 'path';

/**
 * Tope diario de cargas completas (todas las fichas, deudas o transferencias
 * de un reparto). Un agente en bucle que abre el servidor una y otra vez
 * vuelve a leer todo cada vez y agota la cuota de Firestore, que es de toda
 * la cuenta (también la usa la app). El conteo vive en disco para sumar entre
 * procesos: un archivo por día, una línea por carga (append es atómico).
 *
 * Además, cada proceso tiene un tope de documentos leídos por hora
 * (22/10/2026): un error que releía todo dentro de un bucle leyó 38.000
 * documentos en 2 minutos desde un solo proceso y dejó a la app sin cuota.
 * Un uso normal (el servidor de la app de Claude lee unos 2.000 por día) no
 * se acerca; un bucle se corta a los pocos minutos.
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
    private readonly hourlyDocsLimit = 0,
  ) {}

  private file(): string {
    return path.join(this.dir, `${quotaDay(this.now())}.jsonl`);
  }

  private today(): Array<LoadLine & { at?: string; pid?: number }> {
    try {
      return fs.readFileSync(this.file(), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  /** Antes de una carga completa: corta si hoy ya se llegó al tope. */
  check(what: string): void {
    if (this.limit <= 0 && this.hourlyDocsLimit <= 0) return;
    const loads = this.today();
    const docs = loads.reduce((sum, line) => sum + (line.docs || 0), 0);
    if (this.hourlyDocsLimit > 0) {
      const since = this.now().getTime() - 60 * 60 * 1000;
      const mine = loads
        .filter((line) => line.pid === process.pid && line.at && Date.parse(line.at) >= since)
        .reduce((sum, line) => sum + (line.docs || 0), 0);
      if (mine >= this.hourlyDocsLimit) {
        throw new ReadLimitError(
          `Este proceso del servidor MCP ya leyó ${mine} documentos en la última hora (tope ${this.hourlyDocsLimit}). `
          + `No se cargó ${what}: parece un bucle que relee todo. No reintentes: avisale al usuario.`,
        );
      }
    }
    if (this.limit <= 0 || loads.length < this.limit) return;
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
