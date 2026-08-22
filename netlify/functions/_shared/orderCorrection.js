const MAX_CORRECTION_LENGTH = 1000;

const TOOL_NAMES = new Set([
  'create_new_client',
  'schedule_existing_client',
  'merge_products_into_order',
  'update_client_data',
  'add_standalone_note',
  'report_not_found',
  'report_no_action',
]);

function normalizeCorrectionRequest(correction, previousResult) {
  const hasCorrection = correction !== undefined && correction !== null;
  const hasPreviousResult = previousResult !== undefined && previousResult !== null;

  if (!hasCorrection && !hasPreviousResult) return null;
  if (!hasCorrection || !hasPreviousResult) {
    throw new Error('La corrección necesita `correction` y `previousResult`.');
  }
  if (typeof correction !== 'string' || !correction.trim()) {
    throw new Error('`correction` debe ser texto no vacío.');
  }
  if (correction.length > MAX_CORRECTION_LENGTH) {
    throw new Error(`La corrección supera el máximo de ${MAX_CORRECTION_LENGTH} caracteres.`);
  }
  if (
    typeof previousResult !== 'object'
    || Array.isArray(previousResult)
    || !TOOL_NAMES.has(previousResult.tool)
    || typeof previousResult.input !== 'object'
    || previousResult.input === null
    || Array.isArray(previousResult.input)
  ) {
    throw new Error('`previousResult` no es una interpretación válida.');
  }

  return {
    correction: correction.trim(),
    previousResult: {
      tool: previousResult.tool,
      input: previousResult.input,
    },
  };
}

function buildTodayBlock(todayIso) {
  const date = new Date(`${todayIso}T12:00:00`);
  const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return `FECHA ACTUAL: ${todayIso} (${dayNames[date.getDay()]})`;
}

function buildOrderUserMessage({ text, todayIso, correction, previousResult }) {
  const todayBlock = buildTodayBlock(todayIso);
  const normalized = normalizeCorrectionRequest(correction, previousResult);
  if (!normalized) {
    return `${todayBlock}\n\nTEXTO A PARSEAR:\n\"\"\"\n${text}\n\"\"\"`;
  }

  return `${todayBlock}

PEDIDO ORIGINAL:
\"\"\"
${text}
\"\"\"

INTERPRETACIÓN ACTUAL (esta es la base que debes corregir):
\"\"\"json
${JSON.stringify(normalized.previousResult)}
\"\"\"

CORRECCIÓN DEL USUARIO:
\"\"\"
${normalized.correction}
\"\"\"

REGLAS PARA CORREGIR:
- Devuelve una única herramienta con el resultado completo ya corregido.
- Conserva exactamente todos los datos de la interpretación actual que la corrección no mencione.
- Cambia solamente lo pedido por el usuario; no vuelvas a inferir ni reinterpretar el resto.
- La corrección pertenece al mismo pedido: no crees una segunda operación ni la conviertas en una nota.
- Si la corrección contradice el texto original, prevalece la corrección más reciente del usuario.`;
}

module.exports = {
  MAX_CORRECTION_LENGTH,
  buildOrderUserMessage,
  buildTodayBlock,
  normalizeCorrectionRequest,
};
