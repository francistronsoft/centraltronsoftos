function conflict(message) {
  return Object.assign(new Error(message), { status: 409 });
}

export function resetTarget(db, clientId, requestedId) {
  const installations = db.installations.filter(item => item.clientId === clientId);
  if (requestedId) {
    const target = installations.find(item => item.installationId === requestedId);
    if (!target) throw conflict('Ambiente selecionado nao pertence a este cliente.');
    return target.installationId;
  }
  if (installations.length > 1) throw conflict('Selecione o ambiente cujo token sera resetado.');
  return installations[0]?.installationId || null;
}

export function assertClientCanBeDeleted(db, clientId) {
  if (db.installations.some(item => item.clientId === clientId)) {
    throw conflict('Desvincule os ambientes individualmente antes de excluir o cliente.');
  }
}

export function rebindInstallation(db, clientId, targetId, incomingId, newToken) {
  const target = db.installations.find(item => item.clientId === clientId && item.installationId === targetId);
  if (!target) throw conflict('O ambiente original nao existe mais. Gere outro token de pareamento.');
  const id = String(incomingId || '').trim();
  if (!id) throw conflict('Identificador da nova instalacao obrigatorio para migracao.');
  if (db.installations.some(item => item !== target && item.installationId === id)) {
    throw conflict('A nova instalacao ja possui outro vinculo.');
  }
  // Preserve history while invalidating credentials from the previous machine.
  for (const collection of ['alerts', 'events', 'oauthEvents']) {
    for (const item of db[collection] || []) {
      if (item.installationId === targetId) item.installationId = id;
    }
  }
  for (const item of db.pairingTokens || []) {
    if (item.installationId === targetId) item.installationId = id;
  }
  if (id !== targetId) {
    db.oauthCredentials = (db.oauthCredentials || []).filter(item => item.installationId !== targetId);
    db.oauthStates = (db.oauthStates || []).filter(item => item.installationId !== targetId);
  }
  target.installationId = id;
  target.token = newToken;
  return target;
}
