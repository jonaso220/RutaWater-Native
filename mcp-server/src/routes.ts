import type { Firestore } from 'firebase-admin/firestore';
import { belongsToProfileScope } from '../../src/utils/profileScope';
import { normalizeText } from '../../src/utils/helpers';

/** Un reparto (perfil) de la cuenta: Reparto 1 (personal o grupo familiar) o uno personalizado. */
export interface Route {
  id: string;
  name: string;
  isPrimary: boolean;
  groupId?: string;
  writable: boolean;
}

export interface Account {
  uid: string;
  routes: Route[];
  // settings/{grupo familiar || uid}: catálogo de productos y plantillas de
  // WhatsApp. Igual que en la app, no cambia con el reparto activo.
  settingsDocId: string;
}

export const PRIMARY_ROUTE_ID = 'principal';

const active = (data: Record<string, any> | undefined): boolean =>
  (data?.lifecycleState || 'active') === 'active';

/** Misma resolución de repartos que useProfiles + las condiciones de escritura de firestore.rules. */
export const loadAccount = async (db: Firestore, uid: string): Promise<Account> => {
  const userSnap = await db.collection('users').doc(uid).get();
  const user = userSnap.data() || {};
  const accountActive = (user.accountState || 'active') === 'active';
  const familyGroupId: string | undefined = typeof user.groupId === 'string' && user.groupId ? user.groupId : undefined;

  let primaryWritable = accountActive && !user.pendingGroupId;
  if (familyGroupId) {
    const group = await db.collection('groups').doc(familyGroupId).get();
    primaryWritable = accountActive && group.exists && active(group.data());
  }
  const routes: Route[] = [{
    id: PRIMARY_ROUTE_ID,
    name: user.primaryProfileName || 'Reparto 1',
    isPrimary: true,
    groupId: familyGroupId,
    writable: primaryWritable,
  }];

  const profiles = await db.collection('profiles').where('memberUids', 'array-contains', uid).get();
  profiles.docs
    .filter((doc) => active(doc.data()) && doc.id !== familyGroupId)
    .sort((a, b) => String(a.data().name || '').localeCompare(String(b.data().name || '')))
    .forEach((doc) => routes.push({
      id: doc.id,
      name: doc.data().name || 'Reparto',
      isPrimary: false,
      groupId: doc.id,
      writable: accountActive,
    }));

  return { uid, routes, settingsDocId: familyGroupId || uid };
};

export const routeForRecord = (
  account: Account, record: { userId?: string; groupId?: string | null },
): Route | undefined => account.routes.find((route) =>
  belongsToProfileScope(record, account.uid, route.groupId));

/** Acepta id o nombre del reparto (sin distinguir mayúsculas ni tildes). */
export const findRoute = (account: Account, idOrName: string): Route => {
  const wanted = normalizeText(idOrName).trim();
  const route = account.routes.find((candidate) => candidate.id === idOrName
    || normalizeText(candidate.name).trim() === wanted);
  if (!route) {
    throw new Error(`No existe el reparto «${idOrName}». Repartos: ${account.routes.map((r) => r.name).join(', ')}.`);
  }
  return route;
};
