interface OptimisticProfileSwitchOptions {
  nextId: string;
  getCurrentId: () => string;
  applyId: (id: string) => void;
  persistId: (id: string) => Promise<void>;
}

/**
 * Cambia de reparto inmediatamente y persiste la preferencia en segundo plano.
 * Si la escritura falla, revierte solo cuando el reparto fallido sigue activo,
 * para no pisar una selección más nueva.
 */
export const switchProfileOptimistically = async ({
  nextId,
  getCurrentId,
  applyId,
  persistId,
}: OptimisticProfileSwitchOptions): Promise<void> => {
  const previousId = getCurrentId();
  if (nextId === previousId) return;

  applyId(nextId);
  try {
    await persistId(nextId);
  } catch (error) {
    if (getCurrentId() === nextId) applyId(previousId);
    throw error;
  }
};
