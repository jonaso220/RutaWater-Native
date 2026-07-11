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

const repairOrRetryDecision = (toolUse, text, clients) => {
  if (!toolUse || !toolUse.input) return { toolUse, retryAsCreate: false };
  const input = toolUse.input;
  const knownIds = new Set((clients || []).map((client) => client.id));

  if (EXISTING_CLIENT_TOOLS.has(toolUse.name) && !knownIds.has(input.matched_client_id)) {
    const match = findUniqueClientNameMatch(input.matched_client_name, text, clients || []);
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
      retryAsCreate: looksLikeCompleteClientCard(text)
        && !hasPotentialClientNameMatch(input.matched_client_name, text, clients || []),
    };
  }

  if (toolUse.name === 'report_not_found' && looksLikeCompleteClientCard(text)) {
    const match = findUniqueClientNameMatch(input.mentioned_name, text, clients || []);
    return {
      toolUse,
      retryAsCreate: !match
        && !hasPotentialClientNameMatch(input.mentioned_name, text, clients || []),
    };
  }

  return { toolUse, retryAsCreate: false };
};

module.exports = {
  extractCardName,
  findUniqueClientNameMatch,
  hasPotentialClientNameMatch,
  looksLikeCompleteClientCard,
  normalizeName,
  repairOrRetryDecision,
};
