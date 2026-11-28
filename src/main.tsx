import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { createServices } from './app/services.ts';
import { registerPwa } from './app/pwa.ts';
import './styles/global.css';

async function bootstrap() {
  const container = document.getElementById('root')!;
  const root = createRoot(container);
  try {
    const services = await createServices();
    // Ladeanzeige aus index.html entfernen
    document.getElementById('boot')?.remove();
    root.render(
      <StrictMode>
        <App services={services} />
      </StrictMode>,
    );
  } catch (err) {
    console.error(err);
    document.getElementById('boot')?.remove();
    root.render(
      <div className="fatal">
        <img src="/icons/logo.svg" width={72} height={72} alt="" />
        <h1>LernArcade konnte nicht starten</h1>
        <p>{err instanceof Error ? err.message : String(err)}</p>
        <p className="muted">
          Der lokale Speicher (IndexedDB) ist nicht verfügbar. Bitte privaten Modus beenden oder Website-Daten für diese Seite
          erlauben.
        </p>
      </div>,
    );
  }
  registerPwa();
}

void bootstrap();
