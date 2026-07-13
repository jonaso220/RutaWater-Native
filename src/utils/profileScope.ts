interface ProfileScopedRecord {
  userId?: string;
  groupId?: string | null;
}

/**
 * Confirma que un documento pertenece al reparto activo.
 *
 * Los repartos personalizados guardan `userId` para auditoría y `groupId`
 * para el aislamiento. Por eso Reparto 1, cuando es personal (sin grupo
 * familiar), no puede aceptar todos los documentos del mismo `userId`: debe
 * quedarse únicamente con los que no tienen `groupId`.
 */
export const belongsToProfileScope = (
  record: ProfileScopedRecord,
  userId: string,
  groupId?: string,
): boolean => {
  if (groupId) return record.groupId === groupId;
  return record.userId === userId && !record.groupId;
};
