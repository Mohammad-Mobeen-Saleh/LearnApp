import { describe, expect, it } from 'vitest';
import { readSupabaseConfig } from '../src/auth/authService.ts';

describe('Supabase-Konfiguration', () => {
  it('ohne Werte oder mit Platzhaltern: lokaler Modus', () => {
    expect(readSupabaseConfig({})).toBeNull();
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'https://DEIN-PROJEKT.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'DEIN-OEFFENTLICHER-SCHLUESSEL' })).toBeNull();
  });

  it('akzeptiert den öffentlichen Publishable- oder anon-Schlüssel', () => {
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_123' })).toEqual({
      url: 'https://abc.supabase.co',
      key: 'sb_publishable_123',
    });
    const anon = `x.${btoa(JSON.stringify({ role: 'anon' }))}.y`;
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_ANON_KEY: anon })?.key).toBe(anon);
  });

  it('verweigert geheime Schlüssel im Frontend', () => {
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' })).toBeNull();
    const serviceRole = `x.${btoa(JSON.stringify({ role: 'service_role' }))}.y`;
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_ANON_KEY: serviceRole })).toBeNull();
  });
});
