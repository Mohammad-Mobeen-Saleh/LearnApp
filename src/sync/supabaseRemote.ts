import type { SupabaseClient } from '@supabase/supabase-js';
import { parsePullPage, parsePushResults, toRpcChanges } from './protocol.ts';
import { RemoteError, type SyncRemote } from './types.ts';

interface PostgrestLikeError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

function toRemoteError(error: PostgrestLikeError): RemoteError {
  const code = error.code ?? null;
  // Funktion fehlt: Datenbank-Migration wurde noch nicht ausgeführt
  if (code === 'PGRST202' || code === '42883') {
    return new RemoteError(
      'Die Supabase-Datenbank ist noch nicht eingerichtet (SQL-Migration fehlt, siehe README «Datenbankmigrationen»).',
      { code, transient: false },
    );
  }
  if (code === '42501' || code === 'PGRST301') {
    return new RemoteError('Anmeldung abgelaufen oder keine Berechtigung. Bitte erneut anmelden.', { code, transient: true });
  }
  const network = !code || /fetch|network|load failed/i.test(error.message);
  return new RemoteError(network ? `Verbindungsproblem: ${error.message}` : error.message, { code, transient: network });
}

/** Cloud-Anbindung über die beiden RPC-Funktionen der Datenbank (siehe supabase/migrations). */
export function createSupabaseRemote(client: SupabaseClient): SyncRemote {
  return {
    async push({ deviceId, knownSeq, changes }) {
      const { data, error } = await client.rpc('push_changes', {
        p_device_id: deviceId,
        p_known_seq: knownSeq,
        p_changes: toRpcChanges(changes),
      });
      if (error) throw toRemoteError(error);
      return parsePushResults(data);
    },
    async pull({ since, limit }) {
      const { data, error } = await client.rpc('pull_changes', { p_since: since, p_limit: limit });
      if (error) throw toRemoteError(error);
      return parsePullPage(data);
    },
  };
}
