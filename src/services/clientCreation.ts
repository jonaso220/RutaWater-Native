import auth from '@react-native-firebase/auth';
import { db } from '../config/firebase';
import { API_ENDPOINTS } from '../config/api';

const MAX_CREATE_BATCH = 100;

export class ClientCreationRequestError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'ClientCreationRequestError';
  }
}

export const isClientLimitError = (error: unknown): boolean =>
  error instanceof ClientCreationRequestError && error.code === 'CLIENT_LIMIT_REACHED';

export interface ClientDocumentCreate {
  id?: string;
  data: Record<string, unknown>;
}

const sendCreateRequest = async (
  items: Array<{ id: string; data: Record<string, unknown> }>,
): Promise<string[]> => {
  const currentUser = auth().currentUser;
  if (!currentUser) throw new ClientCreationRequestError('AUTH_REQUIRED');
  const response = await fetch(API_ENDPOINTS.createClient, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await currentUser.getIdToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items }),
  });
  const payload = await response.json().catch(() => ({})) as {
    status?: string;
    code?: string;
    ids?: unknown;
  };
  if (!response.ok || payload.status !== 'ok' || !Array.isArray(payload.ids)) {
    throw new ClientCreationRequestError(payload.code || 'CLIENT_CREATE_FAILED');
  }
  return payload.ids.filter((id): id is string => typeof id === 'string');
};

export const createClientDocuments = async (
  documents: ClientDocumentCreate[],
): Promise<string[]> => {
  if (documents.length < 1) return [];
  const createdIds: string[] = [];
  for (let offset = 0; offset < documents.length; offset += MAX_CREATE_BATCH) {
    const items = documents.slice(offset, offset + MAX_CREATE_BATCH).map(({ id, data }) => ({
      id: id || db.collection('clients').doc().id,
      data,
    }));
    createdIds.push(...await sendCreateRequest(items));
  }
  return createdIds;
};

export const createClientDocument = async (
  data: Record<string, unknown>,
  id?: string,
): Promise<string> => {
  const [createdId] = await createClientDocuments([{ id, data }]);
  if (!createdId) throw new ClientCreationRequestError('CLIENT_CREATE_FAILED');
  return createdId;
};
