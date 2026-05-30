import { create } from 'zustand';

/**
 * Perfiles / Repartos. Un perfil = un "scope" de datos aislado.
 *
 * La app filtra todos los datos por `groupId` (o `userId` si no hay grupo).
 * El perfil ACTIVO decide qué valor de scope se usa, así reutilizamos toda la
 * maquinaria de consultas existente:
 *   - Reparto 1 (primary, implícito): usa el scope actual del usuario (su grupo
 *     real o su userId). No migra datos; el grupo familiar sigue funcionando.
 *   - Perfiles nuevos: `scopeGroupId = id del perfil`; sus datos se guardan con
 *     ese groupId y quedan aislados.
 */
export interface ProfileMember {
  role: 'admin' | 'member';
  name?: string;
  email?: string;
}

export interface Profile {
  id: string; // PRIMARY_PROFILE_ID para Reparto 1, o el id del doc en `profiles`
  name: string;
  isPrimary: boolean;
  // Valor a usar como groupId para el scope. undefined => scope por userId
  // (caso usuario solo, sin grupo, en Reparto 1).
  scopeGroupId?: string;
  // Sharing (solo perfiles nuevos, no primary):
  ownerId?: string;
  code?: string;
  members?: Record<string, ProfileMember>;
  isOwner?: boolean; // true si el usuario actual es dueño/admin del perfil
}

interface ProfileStore {
  profiles: Profile[];
  activeProfileId: string;
  activeProfile: Profile | null;
  loaded: boolean;
  setActiveProfile: (id: string) => Promise<void>;
  createProfile: (name: string) => Promise<void>;
  renameProfile: (id: string, name: string) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  // Sharing
  joinProfile: (code: string) => Promise<'ok' | 'not_found' | 'already' | 'error'>;
  leaveProfile: (id: string) => Promise<void>;
  removeMember: (profileId: string, uid: string) => Promise<void>;
  // UI: visibilidad del gestor de repartos (abierto desde el header del Inicio).
  switcherVisible: boolean;
  setSwitcherVisible: (v: boolean) => void;
}

const noop = async () => {};

export const PRIMARY_PROFILE_ID = '__primary__';

export const useProfileStore = create<ProfileStore>()((set) => ({
  profiles: [],
  activeProfileId: PRIMARY_PROFILE_ID,
  activeProfile: null,
  loaded: false,
  setActiveProfile: noop,
  createProfile: noop,
  renameProfile: noop,
  deleteProfile: noop,
  joinProfile: async () => 'error' as const,
  leaveProfile: noop,
  removeMember: noop,
  switcherVisible: false,
  setSwitcherVisible: (v: boolean) => set({ switcherVisible: v }),
}));

/** Perfiles a los que el usuario tiene acceso (Reparto 1 + los suyos). */
export const useProfiles = () => useProfileStore((s) => s.profiles);

/** Perfil activo actual. */
export const useActiveProfile = () => useProfileStore((s) => s.activeProfile);
