const EXISTING_CLIENT_TOOLS = new Set([
  'schedule_existing_client',
  'merge_products_into_order',
  'update_client_data',
]);

const normalizeName = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const normalizePhone = (value) => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('598')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits;
};

const normalizeAddress = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const clientPhones = (client) => [...new Set(
  [client?.phone, ...(Array.isArray(client?.phones) ? client.phones : [])]
    .map(normalizePhone)
    .filter(Boolean),
)];

const clientAddresses = (client) => [...new Set(
  [client?.address, ...(Array.isArray(client?.addresses) ? client.addresses : [])]
    .map(normalizeAddress)
    .filter(Boolean),
)];

const normalizeMapsLink = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[?#].*$/, '')
  .replace(/\/+$/, '');

const clientMapsLinks = (client) => [...new Set(
  [client?.mapsLink, ...(Array.isArray(client?.mapsLinks) ? client.mapsLinks : [])]
    .map(normalizeMapsLink)
    .filter(Boolean),
)];

// A name alone never proves identity. A matching phone does; a namesake is
// safe to create only when phone and address are both present and distinct
// from every same-name client. Everything in between needs clarification.
const classifyClientIdentity = (input, clients = []) => {
  const sameName = clients.filter(
    (client) => normalizeName(client.name) === normalizeName(input?.name),
  );
  if (sameName.length === 0) return 'new';

  const phone = normalizePhone(input?.phone);
  const address = normalizeAddress(input?.address);
  const mapsLink = normalizeMapsLink(input?.mapsLink);
  if (phone && sameName.some((client) => clientPhones(client).includes(phone))) {
    return 'existing';
  }

  const isDistinctNamesake = Boolean(phone && address) && sameName.every((client) => {
    const phones = clientPhones(client);
    const addresses = clientAddresses(client);
    const mapsLinks = clientMapsLinks(client);
    return phones.length > 0
      && addresses.length > 0
      && !phones.includes(phone)
      && !addresses.includes(address)
      && (!mapsLink || !mapsLinks.includes(mapsLink));
  });
  return isDistinctNamesake ? 'new' : 'ambiguous';
};

const extractCardName = (text) => {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const labelled = lines.find((line) => /^(?:nombre|cliente)\s*:/i.test(line));
  const raw = labelled ? labelled.replace(/^[^:]+:\s*/, '') : (lines[0] || '');
  // WhatsApp cards frequently use "NAME - address" on their first line.
  return raw.split(/\s+-\s+/)[0].trim();
};

const findUniqueClientNameMatch = (mentionedName, text, clients) => {
  const candidates = [mentionedName, extractCardName(text)].map(normalizeName).filter(Boolean);
  for (const candidate of candidates) {
    const exact = clients.filter((client) => normalizeName(client.name) === candidate);
    if (exact.length === 1) return exact[0];

    const contained = clients.filter((client) => {
      const name = normalizeName(client.name);
      return name.length >= 4 && (candidate.includes(name) || name.includes(candidate));
    });
    if (contained.length === 1) return contained[0];
  }
  const normalizedText = normalizeName(text);
  const inFullText = clients.filter((client) => {
    const name = normalizeName(client.name);
    return name.length >= 4 && normalizedText.includes(name);
  });
  if (inFullText.length === 1) return inFullText[0];
  return null;
};

const hasPotentialClientNameMatch = (mentionedName, text, clients) => {
  const normalizedText = normalizeName(text);
  const candidates = [mentionedName, extractCardName(text)].map(normalizeName).filter(Boolean);
  return clients.some((client) => {
    const name = normalizeName(client.name);
    return name.length >= 4 && (
      normalizedText.includes(name)
      || candidates.some((candidate) => candidate.includes(name) || name.includes(candidate))
    );
  });
};

const looksLikeCompleteClientCard = (text) => {
  const raw = String(text || '');
  const hasMaps = /(?:https?:\/\/)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|share\.google|maps\.google\.[^\s/]+|(?:www\.)?google\.[^\s/]+\/maps)/i.test(raw);
  const withoutUrls = raw.replace(/(?:https?:\/\/)?\S*(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|share\.google|maps\.google\.[^\s/]+|google\.[^\s/]+\/maps)\S*/gi, ' ');
  const hasPhone = /(?:^|\D)(?:\+?\d[\d\s().-]{6,}\d)(?:\D|$)/m.test(withoutUrls);
  const hasAddress = /\b(?:direcci[oó]n|domicilio|calle|avenida|av\.?|ruta|esq\.?|esquina|manzana|solar)\b/i.test(raw)
    || raw.split(/\r?\n/).filter((line) => line.trim()).length >= 3;
  return hasMaps && hasPhone && hasAddress && !!extractCardName(raw);
};

const extractCardIdentity = (text) => {
  const raw = String(text || '');
  const mapsLink = raw.match(/(?:https?:\/\/)?\S*(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|share\.google|maps\.google\.[^\s/]+|google\.[^\s/]+\/maps)\S*/i)?.[0] || '';
  const withoutUrls = raw.replace(/(?:https?:\/\/)?\S*(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|share\.google|maps\.google\.[^\s/]+|google\.[^\s/]+\/maps)\S*/gi, ' ');
  const labelledPhone = withoutUrls.match(/(?:tel[eé]fono|tel|celular|cel)\s*:?\s*(\+?\d[\d\s().-]{6,}\d)/i)?.[1];
  const phone = labelledPhone
    || withoutUrls.match(/(?:^|\D)(\+?\d[\d\s().-]{6,}\d)(?:\D|$)/m)?.[1]
    || '';

  const lines = withoutUrls.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const addressParts = [];
  for (const line of lines) {
    const addressMatch = /^(?:direcci[oó]n|domicilio)\s*:\s*(.+)$/i.exec(line);
    const cornerMatch = /^(?:esquina|esq\.?)\s*:\s*(.+)$/i.exec(line);
    if (addressMatch) addressParts.push(addressMatch[1]);
    if (cornerMatch) addressParts.push(`Esquina ${cornerMatch[1]}`);
  }

  if (addressParts.length === 0) {
    const compactParts = withoutUrls.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
    const name = normalizeName(extractCardName(raw));
    const addressCandidate = compactParts.find((part) => (
      normalizeName(part) !== name
      && normalizePhone(part) !== normalizePhone(phone)
      && /[a-záéíóúñ]/i.test(part)
      && !/^(?:tel[eé]fono|tel|celular|cel)\s*:/i.test(part)
    ));
    if (addressCandidate) addressParts.push(addressCandidate);
  }

  return {
    name: extractCardName(raw),
    phone,
    address: addressParts.join(', '),
    mapsLink,
  };
};

const repairOrRetryDecision = (toolUse, text, clients) => {
  if (!toolUse || !toolUse.input) return { toolUse, retryAsCreate: false };
  const input = toolUse.input;
  const availableClients = clients || [];
  const knownIds = new Set(availableClients.map((client) => client.id));
  const completeCard = looksLikeCompleteClientCard(text);
  const cardIdentity = completeCard
    ? classifyClientIdentity(extractCardIdentity(text), availableClients)
    : null;

  if (EXISTING_CLIENT_TOOLS.has(toolUse.name) && cardIdentity === 'new') {
    return { toolUse, retryAsCreate: true };
  }

  if (EXISTING_CLIENT_TOOLS.has(toolUse.name) && !knownIds.has(input.matched_client_id)) {
    if (completeCard && cardIdentity === 'ambiguous') {
      return { toolUse, retryAsCreate: false };
    }
    const match = findUniqueClientNameMatch(input.matched_client_name, text, availableClients);
    if (match) {
      return {
        toolUse: {
          ...toolUse,
          input: { ...input, matched_client_id: match.id, matched_client_name: match.name },
        },
        retryAsCreate: false,
      };
    }
    return {
      toolUse,
      retryAsCreate: completeCard
        && !hasPotentialClientNameMatch(input.matched_client_name, text, availableClients),
    };
  }

  if (
    completeCard
    && ['report_not_found', 'report_no_action'].includes(toolUse.name)
  ) {
    return { toolUse, retryAsCreate: cardIdentity === 'new' };
  }

  return { toolUse, retryAsCreate: false };
};

module.exports = {
  classifyClientIdentity,
  clientAddresses,
  clientMapsLinks,
  clientPhones,
  extractCardIdentity,
  extractCardName,
  findUniqueClientNameMatch,
  hasPotentialClientNameMatch,
  looksLikeCompleteClientCard,
  normalizeAddress,
  normalizeMapsLink,
  normalizeName,
  normalizePhone,
  repairOrRetryDecision,
};
