(function () {
  function durationMs(session) {
    if (session.durationSeconds != null && Number.isFinite(Number(session.durationSeconds))) {
      return Number(session.durationSeconds) * 1000;
    }
    const start = new Date(session.connectedAt || session.firstSeenAt || '').getTime();
    const end = new Date(session.disconnectedAt || session.lastSeenAt || Date.now()).getTime();
    return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
  }

  function suspicious(session, nowMs = Date.now()) {
    const duration = durationMs(session);
    const lastSeen = new Date(session.lastSeenAt || '').getTime();
    return (duration != null && duration >= 4 * 60 * 60 * 1000)
      || (!session.disconnectedAt && Number.isFinite(lastSeen) && nowMs - lastSeen >= 15 * 60 * 1000)
      || (!!session.disconnectedAt && /active/i.test(session.lastState || ''))
      || /gbak|gfix|nbackup|backup|restore|sweep/i.test(session.remoteProcess || '');
  }

  function equipmentAddress(session) {
    return String(session.remoteAddress || '').trim().replace(/\/\d+$/, '');
  }

  function group(sessions) {
    const groups = new Map();
    sessions.forEach((session, index) => {
      const address = equipmentAddress(session);
      const key = JSON.stringify([
        session.databaseAlias || session.databaseName || '', session.sourceNode || '',
        address || `unknown-${session.sessionKey || session.id || index}`
      ]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(session);
    });
    return [...groups.entries()].map(([equipmentKey, members]) => {
      const active = members.filter(session => !session.disconnectedAt);
      const candidates = active.length ? active : members;
      const representative = [...candidates].sort((a, b) =>
        Number(suspicious(b)) - Number(suspicious(a))
        || new Date(a.connectedAt || a.firstSeenAt || 0) - new Date(b.connectedAt || b.firstSeenAt || 0)
      )[0];
      return {
        ...representative,
        remoteAddress: equipmentAddress(representative) || representative.remoteAddress,
        equipmentKey, members, sessionCount: members.length, activeCount: active.length,
        suspicious: members.some(session => suspicious(session)),
        processes: [...new Set(candidates.map(session => session.remoteProcess).filter(Boolean))],
        pids: [...new Set(candidates.map(session => session.remotePid).filter(value => value != null))],
        lastSeenAt: members.map(session => session.lastSeenAt).filter(Boolean).sort().at(-1) || null
      };
    });
  }

  function matches(group, filter) {
    if (filter === 'active') return group.activeCount > 0;
    if (filter === 'closed') return group.activeCount === 0;
    if (filter === 'suspicious') return group.suspicious;
    return true;
  }

  globalThis.centralFirebirdSessions = { durationMs, suspicious, group, matches };
})();
