import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAuthState, useLiveQuery, useServices, useSettings, useSyncStatus } from '../app/ServicesContext.tsx';
import { getPwaState, isIos, isStandalone, promptInstall, subscribePwa } from '../app/pwa.ts';
import { createBackup, parseBackup, previewRestore, restoreBackup, type BackupFile, type RestorePreview } from '../data/backup.ts';
import { LIMITS, SPEED_LABELS, type SpeedSetting } from '../domain/types.ts';
import { formatDateTime, formatRelative, plural } from '../lib/text.ts';
import { Button, describeSync, LinkButton, PageHeader, useDownload, useFeedback } from '../ui/components.tsx';
import { Icon } from '../ui/Icon.tsx';

const COLLECTION_LABEL: Record<string, string> = {
  decks: 'Lernpaket',
  questions: 'Frage',
  user_settings: 'Einstellungen',
  sync_conflicts: 'Konflikt',
  game_sessions: 'Spiel',
  answer_events: 'Antwort',
};

export function SettingsPage() {
  const { store, sync, cloudConfigured } = useServices();
  const settings = useSettings();
  const status = useSyncStatus();
  const auth = useAuthState();
  const { toast, confirm } = useFeedback();
  const download = useDownload();
  const failed = useLiveQuery((s) => s.listFailed(), []);
  const deviceLabel = useLiveQuery((s) => s.getDeviceLabel(), []);
  const deviceId = useLiveQuery((s) => s.getDeviceId(), []);
  const pwa = useSyncExternalStore(subscribePwa, () => getPwaState().installEvent);
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [backup, setBackup] = useState<BackupFile | null>(null);
  const [backupWarnings, setBackupWarnings] = useState<string[]>([]);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [restoreDecks, setRestoreDecks] = useState<Record<string, boolean>>({});
  const [includeProgress, setIncludeProgress] = useState(true);
  const [restoreDeleted, setRestoreDeleted] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [cleaningDemo, setCleaningDemo] = useState(false);

  useEffect(() => setName(settings?.playerName ?? ''), [settings?.playerName]);
  useEffect(() => setLabel(deviceLabel ?? ''), [deviceLabel]);
  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  const view = describeSync(status);

  const exportBackup = async () => {
    const file = await createBackup(store);
    const date = new Date().toISOString().slice(0, 10);
    await download(`lernarcade-sicherung-${date}.json`, JSON.stringify(file, null, 2));
    toast('Sicherung erstellt.', 'success');
  };

  const cleanupDemo = async () => {
    if (cleaningDemo) return;
    setCleaningDemo(true);
    try {
      // Vor dem Aufräumen die letzte Cloud-Version abholen.
      if (sync.hasRemote) {
        const result = await sync.sync();
        if (!result.ok) throw new Error('Cloud-Synchronisierung fehlgeschlagen. Bitte zuerst die Verbindung prüfen.');
      }
      const preview = await store.previewDemoCleanup();
      if (!preview.deckToRemove && !preview.questionsToRemove && !preview.conflictsToResolve) {
        toast(preview.protectedRecords
          ? 'Demo-Inhalte wurden verändert. Aus Sicherheitsgründen nicht automatisch entfernt.'
          : 'Keine alten Demo-Daten oder Demo-Konflikte gefunden.', 'info');
        return;
      }
      const ok = await confirm({
        title: 'Alte Demo-Daten bereinigen?',
        message: (
          <div>
            <p>Es werden {preview.deckToRemove ? '1 Lernpaket, ' : ''}{preview.questionsToRemove} unveränderte Demo-Fragen und {preview.conflictsToResolve} eindeutig zugeordnete Demo-Konflikte bereinigt.</p>
            {preview.protectedRecords ? <p>{preview.protectedRecords} veränderte oder nicht eindeutig zuordenbare Datensätze bleiben geschützt.</p> : null}
            <p>Vor der Bereinigung wird automatisch eine JSON-Datensicherung erstellt. Bitte bewahre sie auf. Eigene Lernpakete werden nicht entfernt.</p>
          </div>
        ),
        confirmLabel: 'Sicherung erstellen und bereinigen',
        danger: true,
      });
      if (!ok) return;
      const date = new Date().toISOString().slice(0, 10);
      await download(`lernarcade-vor-demo-bereinigung-${date}.json`, JSON.stringify(await createBackup(store), null, 2));
      const report = await store.cleanupDemoData();
      if (sync.hasRemote) {
        const synced = await sync.sync();
        toast(synced.ok
          ? `Demo-Bereinigung synchronisiert: ${report.questionsToRemove} Fragen, ${report.conflictsToResolve} Konflikte.`
          : 'Lokal bereinigt. Die Übertragung in die Cloud steht noch aus.', synced.ok ? 'success' : 'warning');
      } else {
        toast('Demo-Daten lokal bereinigt. Ohne Anmeldung wird nicht synchronisiert.', 'warning');
      }
      if (report.protectedRecords) toast('Einige bearbeitete Demo-Inhalte wurden aus Sicherheitsgründen behalten.', 'warning');
    } catch (error) {
      toast(`Demo-Bereinigung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setCleaningDemo(false);
    }
  };

  const loadBackup = async (file: File) => {
    try {
      const { backup: parsed, errors } = parseBackup(JSON.parse(await file.text()));
      setBackupWarnings(errors);
      if (!parsed) {
        setBackup(null);
        setRestorePreview(null);
        return;
      }
      setBackup(parsed);
      const preview = await previewRestore(store, parsed);
      setRestorePreview(preview);
      setRestoreDecks(Object.fromEntries(preview.decks.map((d) => [d.id, d.status !== 'existing' || d.newQuestions > 0])));
    } catch (err) {
      setBackup(null);
      setRestorePreview(null);
      setBackupWarnings([`Die Datei konnte nicht gelesen werden: ${(err as Error).message}`]);
    }
  };

  const runRestore = async () => {
    if (!backup) return;
    const deckIds = Object.entries(restoreDecks).filter(([, v]) => v).map(([k]) => k);
    const ok = await confirm({
      title: 'Sicherung wiederherstellen?',
      message: (
        <p>
          Fehlende Inhalte aus der Sicherung werden ergänzt. Bestehende Lernpakete und Fragen werden nicht überschrieben.
          {restoreDeleted ? ' Gelöschte Inhalte aus der Sicherung werden zurückgeholt.' : ''}
        </p>
      ),
      confirmLabel: 'Wiederherstellen',
    });
    if (!ok) return;
    const report = await restoreBackup(store, backup, { deckIds, includeProgress, restoreDeleted });
    toast(
      `Wiederhergestellt: ${report.decksAdded + report.decksRestored} Lernpakete, ${report.questionsAdded + report.questionsRestored} Fragen, ${report.sessionsAdded} Spiele. ${report.questionsSkipped} bereits vorhanden.`,
      'success',
    );
    setBackup(null);
    setRestorePreview(null);
  };

  const discard = async (key: string) => {
    const ok = await confirm({
      title: 'Lokale Änderung verwerfen?',
      message: <p>Die Änderung wird nicht übertragen. Danach wird der Stand aus der Cloud neu geladen.</p>,
      confirmLabel: 'Verwerfen',
      danger: true,
    });
    if (!ok) return;
    await store.discardFailed(key);
    void sync.sync();
  };

  return (
    <div className="page">
      <PageHeader title="Einstellungen" subtitle="Spiel, Konto, Synchronisierung und Datensicherung." />

      <div className="settings-grid">
        <section className="card">
          <div className="card-title">
            <Icon name="play" />
            <h2>Spiel</h2>
          </div>
          <form className="form" onSubmit={(e) => e.preventDefault()}>
            <label className="field">
              <span>Dein Name (für die Begrüssung)</span>
              <input
                value={name}
                maxLength={LIMITS.playerName}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name !== (settings?.playerName ?? '') && void store.updateSettings({ playerName: name.trim() })}
              />
            </label>
            <label className="switch">
              <input type="checkbox" checked={settings?.soundEnabled ?? true} onChange={(e) => void store.updateSettings({ soundEnabled: e.target.checked })} />
              <span>Soundeffekte</span>
            </label>
            <label className="field">
              <span>Lautstärke</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={settings?.volume ?? 0.7}
                disabled={settings?.soundEnabled === false}
                onChange={(e) => void store.updateSettings({ volume: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>Tempo der Meteoriten (Abwehr- und Tippmodus)</span>
              <select value={settings?.speed ?? 'normal'} onChange={(e) => void store.updateSettings({ speed: e.target.value as SpeedSetting })}>
                {(Object.keys(SPEED_LABELS) as SpeedSetting[]).map((s) => (
                  <option key={s} value={s}>
                    {SPEED_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="switch">
              <input type="checkbox" checked={settings?.reduceMotion ?? false} onChange={(e) => void store.updateSettings({ reduceMotion: e.target.checked })} />
              <span>Weniger Bewegung (keine Erschütterungen)</span>
            </label>
          </form>
        </section>

        <section className={`card sync-card sync-card-${view.tone}`} id="sync">
          <div className="card-title">
            <Icon name={view.icon} className={view.spinning ? 'spin' : undefined} />
            <h2>Konto & Synchronisierung</h2>
          </div>
          <p>
            <span className={`pill pill-${view.tone}`}>{view.label}</span>
          </p>
          <p className="muted">{view.detail}</p>
          <dl className="facts">
            <dt>Lokal gespeichert, noch nicht übertragen</dt>
            <dd>{status.pending}</dd>
            <dt>Offene Konflikte</dt>
            <dd>{status.conflicts}</dd>
            <dt>Letzte Synchronisierung</dt>
            <dd>{status.lastSyncAt ? `${formatRelative(status.lastSyncAt)} (${formatDateTime(status.lastSyncAt)})` : 'noch nie'}</dd>
          </dl>
          {!cloudConfigured ? (
            <p className="info-text">
              Die Cloud (Supabase) ist nicht eingerichtet. Die App läuft im lokalen Modus, die geräteübergreifende Synchronisierung ist
              <strong> nicht aktiv</strong>. Anleitung: README, Abschnitt «Supabase einrichten».
            </p>
          ) : null}
          <div className="row">
            {cloudConfigured && auth.status === 'signed_in' ? (
              <Button icon="sync" onClick={() => void sync.sync()} disabled={status.phase === 'syncing'}>
                Jetzt synchronisieren
              </Button>
            ) : null}
            {cloudConfigured ? (
              <LinkButton to="/account" icon="user" variant={auth.status === 'signed_in' ? 'secondary' : 'primary'}>
                {auth.status === 'signed_in' ? `Konto (${auth.user?.email ?? ''})` : 'Anmelden / Registrieren'}
              </LinkButton>
            ) : null}
            {status.conflicts > 0 ? (
              <LinkButton to="/conflicts" icon="conflict" variant="primary">
                Konflikte lösen
              </LinkButton>
            ) : null}
          </div>
          {failed && failed.length > 0 ? (
            <div className="failed-list">
              <h3>Nicht übertragbare Änderungen</h3>
              <ul>
                {failed.map((e) => (
                  <li key={e.key}>
                    <span>
                      {COLLECTION_LABEL[e.collection] ?? e.collection}: {e.lastError}
                    </span>
                    <span className="row">
                      <Button size="sm" onClick={() => void store.retryFailed(e.key).then(() => sync.sync())}>
                        Erneut versuchen
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void discard(e.key)}>
                        Verwerfen
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="card">
          <div className="card-title">
            <Icon name="export" />
            <h2>Datensicherung</h2>
          </div>
          <p className="muted">
            Exportiert alle Lernpakete, Fragen, Einstellungen und den Lernfortschritt als JSON-Datei. Die Wiederherstellung ergänzt nur fehlende
            Inhalte und überschreibt nichts.
          </p>
          <div className="row">
            <Button variant="primary" icon="export" onClick={() => void exportBackup()}>
              Sicherung exportieren
            </Button>
            <label className="btn btn-secondary file-button">
              <Icon name="import" size={18} />
              <span>Sicherung wiederherstellen</span>
              <input type="file" accept=".json,application/json" onChange={(e) => e.target.files?.[0] && void loadBackup(e.target.files[0])} />
            </label>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="secondary" disabled={cleaningDemo} onClick={() => void cleanupDemo()}>
              {cleaningDemo ? 'Bereinigung läuft …' : 'Alte Demo-Daten bereinigen'}
            </Button>
          </div>
          <p className="muted small">Entfernt nur das automatisch erstellte Informatik-Demopaket und eindeutig zugehörige Konflikte. Eigene oder bearbeitete Inhalte werden geschützt.</p>
          {backupWarnings.length ? (
            <ul className="warning-list">
              {backupWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          {restorePreview && backup ? (
            <div className="restore-preview">
              <p className="small muted">Sicherung vom {formatDateTime(backup.exportedAt)}</p>
              <ul className="plain-list">
                {restorePreview.decks.map((d) => (
                  <li key={d.id}>
                    <label className="choice">
                      <input type="checkbox" checked={!!restoreDecks[d.id]} onChange={(e) => setRestoreDecks({ ...restoreDecks, [d.id]: e.target.checked })} />
                      <span>
                        <strong>{d.name}</strong>
                        <small className="muted">
                          {d.status === 'new' ? 'neu' : d.status === 'deleted' ? 'auf diesem Gerät gelöscht' : 'vorhanden'} · {d.newQuestions} fehlende Fragen
                          {d.deletedQuestions ? ` · ${d.deletedQuestions} gelöschte` : ''} · {d.unchangedQuestions} vorhanden
                        </small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <label className="switch">
                <input type="checkbox" checked={includeProgress} onChange={(e) => setIncludeProgress(e.target.checked)} />
                <span>
                  Lernfortschritt übernehmen ({plural(restorePreview.newSessions, 'Spiel', 'Spiele')}, {restorePreview.newAnswers} Antworten)
                </span>
              </label>
              <label className="switch">
                <input type="checkbox" checked={restoreDeleted} onChange={(e) => setRestoreDeleted(e.target.checked)} />
                <span>Gelöschte Inhalte aus der Sicherung zurückholen</span>
              </label>
              <div className="row">
                <Button variant="primary" onClick={() => void runRestore()}>
                  Wiederherstellen
                </Button>
                <Button variant="ghost" onClick={() => { setBackup(null); setRestorePreview(null); }}>
                  Abbrechen
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="card">
          <div className="card-title">
            <Icon name="device" />
            <h2>Dieses Gerät & App</h2>
          </div>
          <label className="field">
            <span>Gerätename (erscheint bei Konflikten)</span>
            <input value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} onBlur={() => label.trim() && label !== deviceLabel && void store.setDeviceLabel(label)} />
          </label>
          <dl className="facts">
            <dt>Geräte-ID</dt>
            <dd className="mono small">{deviceId?.slice(0, 8) ?? '…'}</dd>
            <dt>Dauerhafter Speicher</dt>
            <dd>{persisted === null ? 'unbekannt' : persisted ? 'ja' : 'nein (Browser darf Daten bei Speichermangel löschen)'}</dd>
            <dt>Als App installiert</dt>
            <dd>{isStandalone() ? 'ja' : 'nein'}</dd>
            <dt>Version</dt>
            <dd>{__APP_VERSION__}</dd>
          </dl>
          {!isStandalone() ? (
            pwa ? (
              <Button variant="primary" icon="device" onClick={() => void promptInstall()}>
                Als App installieren
              </Button>
            ) : isIos() ? (
              <p className="info-text">
                iPhone: In Safari auf <strong>Teilen</strong> tippen und <strong>«Zum Home-Bildschirm»</strong> wählen.
              </p>
            ) : (
              <p className="muted small">
                Installation: In Chrome oder Edge über das Installationssymbol in der Adressleiste bzw. Menü → «App installieren».
              </p>
            )
          ) : null}
        </section>
      </div>
    </div>
  );
}
