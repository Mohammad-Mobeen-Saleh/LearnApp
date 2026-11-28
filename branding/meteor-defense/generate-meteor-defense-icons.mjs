// Erzeugt alle Logo-, Icon- und Splash-Dateien von Meteor Defense.
//
//   npm run icons
//
// Das Logo wird als SVG definiert (siehe art()) und mit Chromium (Playwright)
// pixelgenau in PNG-Dateien gerendert. favicon.ico wird aus 16/32/48-px-PNGs
// zusammengesetzt. Voraussetzung: `npx playwright install chromium`.
//
// Optionale Umgebungsvariablen:
//   PLAYWRIGHT_MODULE  – Pfad/Name des Playwright-Moduls (Standard: @playwright/test)
//   CHROMIUM_PATH      – eigener Pfad zu einer Chromium-Programmdatei

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (p) => path.join(root, p);

// ---------------------------------------------------------------------------
// Geometrie des Logos (512 x 512 Einheiten)
// ---------------------------------------------------------------------------
const f = (n) => Math.round(n * 10) / 10;
const pt = (p) => `${f(p[0])} ${f(p[1])}`;
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (v, s) => [v[0] * s, v[1] * s];
const norm = (v) => {
  const l = Math.hypot(v[0], v[1]);
  return [v[0] / l, v[1] / l];
};
const deg = (d) => (d * Math.PI) / 180;
// Rotation auf dem Bildschirm (y zeigt nach unten), positive Winkel = gegen den Uhrzeigersinn
const rot = (v, d) => [v[0] * Math.cos(deg(d)) + v[1] * Math.sin(deg(d)), -v[0] * Math.sin(deg(d)) + v[1] * Math.cos(deg(d))];

const DOME_C = [256, 476];
const DOME_R = 232;
const domePoint = (theta, r = DOME_R) => [DOME_C[0] + r * Math.cos(deg(theta)), DOME_C[1] - r * Math.sin(deg(theta))];

const IMPACT_THETA = 70;
const IMPACT = domePoint(IMPACT_THETA);
const NORMAL = [Math.cos(deg(IMPACT_THETA)), -Math.sin(deg(IMPACT_THETA))];
const METEOR_R = 56;
const METEOR = add(IMPACT, mul(NORMAL, METEOR_R + 7));
const TRAIL_DIR = norm([0.62, -0.78]); // zeigt vom Meteoriten nach hinten (oben rechts)
const PERP = [-TRAIL_DIR[1], TRAIL_DIR[0]].map((x) => -x); // senkrecht zur Flugbahn

function arcPath(r, from = 158, to = 22) {
  const a = domePoint(from, r);
  const b = domePoint(to, r);
  return `M ${pt(a)} A ${r} ${r} 0 0 1 ${pt(b)}`;
}

function streak(halfStart, halfEnd, length, center = METEOR) {
  const end = add(center, mul(TRAIL_DIR, length));
  const pts = [
    add(center, mul(PERP, halfStart)),
    add(end, mul(PERP, halfEnd)),
    add(end, mul(PERP, -halfEnd)),
    add(center, mul(PERP, -halfStart)),
  ];
  return { d: `M ${pts.map(pt).join(' L ')} Z`, end };
}

function meteorShape(scale = 1, center = METEOR) {
  const radii = [58, 52, 57, 50, 56, 54, 58, 51];
  const verts = radii.map((r, i) => {
    const a = deg(i * 45);
    return [center[0] + r * scale * Math.cos(a), center[1] - r * scale * Math.sin(a)];
  });
  const hub = add(center, [-6 * scale, -5 * scale]);
  // Licht: die Vorderseite (unten links, Flugrichtung) glüht hell
  const colors = ['#5b21b6', '#6d28d9', '#7c3aed', '#a78bfa', '#ddd6fe', '#f0f9ff', '#a5b4fc', '#7c3aed'];
  const facets = verts.map((v, i) => {
    const w = verts[(i + 1) % verts.length];
    return `<path d="M ${pt(hub)} L ${pt(v)} L ${pt(w)} Z" fill="${colors[i]}"/>`;
  });
  const outline = `M ${verts.map(pt).join(' L ')} Z`;
  return { facets: facets.join(''), outline, verts };
}

function defs(prefix) {
  const trail = streak(50, 4, 232);
  const core = streak(22, 2, 172);
  return `
  <defs>
    <linearGradient id="${prefix}-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a0f2c"/>
      <stop offset="0.55" stop-color="#121a4d"/>
      <stop offset="1" stop-color="#2b1468"/>
    </linearGradient>
    <radialGradient id="${prefix}-glow" cx="${f(METEOR[0] / 512)}" cy="${f(METEOR[1] / 512)}" r="0.55">
      <stop offset="0" stop-color="#7c3aed" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#7c3aed" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${prefix}-trail" gradientUnits="userSpaceOnUse" x1="${f(METEOR[0])}" y1="${f(METEOR[1])}" x2="${f(trail.end[0])}" y2="${f(trail.end[1])}">
      <stop offset="0" stop-color="#67e8f9" stop-opacity="0.95"/>
      <stop offset="0.45" stop-color="#818cf8" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#a855f7" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="${prefix}-core" gradientUnits="userSpaceOnUse" x1="${f(METEOR[0])}" y1="${f(METEOR[1])}" x2="${f(core.end[0])}" y2="${f(core.end[1])}">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#a5f3fc" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="${prefix}-shield" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#06b6d4"/>
      <stop offset="0.5" stop-color="#67e8f9"/>
      <stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
    <radialGradient id="${prefix}-impact" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="0.35" stop-color="#67e8f9" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#22d3ee" stop-opacity="0"/>
    </radialGradient>
    <filter id="${prefix}-blur" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="9"/>
    </filter>
  </defs>`;
}

/** Hauptmotiv: Schutzschild-Kuppel wehrt einen Meteoriten mit Leuchtspur ab. */
function art(prefix, { simple = false } = {}) {
  // Vereinfachte Variante (Favicon): grösserer Meteorit, breitere Spur
  const center = simple ? add(IMPACT, mul(NORMAL, 96)) : METEOR;
  const trail = streak(simple ? 80 : 50, simple ? 12 : 4, simple ? 240 : 232, center);
  const core = streak(22, 2, 172);
  const meteor = meteorShape(simple ? 1.5 : 1, center);
  const parts = [];

  if (!simple) {
    const stars = [
      [92, 112, 3.2],
      [168, 66, 2.4],
      [58, 226, 2.6],
      [214, 168, 2],
      [120, 300, 1.8],
      [466, 334, 2.2],
    ];
    parts.push(
      `<g fill="#e0f2fe">${stars.map(([x, y, r], i) => `<circle cx="${x}" cy="${y}" r="${r}" opacity="${i % 2 ? 0.55 : 0.85}"/>`).join('')}</g>`,
    );
  }

  // Schutzschild (Glühen + Hauptbogen + innerer Bogen)
  const shieldWidth = simple ? 54 : 26;
  parts.push(
    `<path d="${arcPath(DOME_R)}" fill="none" stroke="#22d3ee" stroke-width="${shieldWidth + 26}" stroke-linecap="round" opacity="0.35" filter="url(#${prefix}-blur)"/>`,
    `<path d="${arcPath(DOME_R)}" fill="none" stroke="url(#${prefix}-shield)" stroke-width="${shieldWidth}" stroke-linecap="round"/>`,
  );
  if (!simple) {
    parts.push(
      `<path d="${arcPath(DOME_R - 38, 150, 30)}" fill="none" stroke="#38bdf8" stroke-width="8" stroke-linecap="round" opacity="0.55"/>`,
      // Plattform und Verteidigungsstation unter der Kuppel
      `<rect x="70" y="404" width="372" height="14" rx="7" fill="#1e3a8a" opacity="0.9"/>`,
      `<rect x="70" y="404" width="372" height="4" rx="2" fill="#60a5fa" opacity="0.7"/>`,
    );
    const base = [256, 404];
    const barrelDir = norm([METEOR[0] - base[0], METEOR[1] - base[1]]);
    const barrelEnd = add(base, mul(barrelDir, 66));
    parts.push(
      `<line x1="${base[0]}" y1="${base[1] - 8}" x2="${f(barrelEnd[0])}" y2="${f(barrelEnd[1])}" stroke="#bfdbfe" stroke-width="13" stroke-linecap="round"/>`,
      `<path d="M ${base[0] - 38} ${base[1]} A 38 38 0 0 1 ${base[0] + 38} ${base[1]} Z" fill="#312e81" stroke="#818cf8" stroke-width="5"/>`,
    );
  }

  // Leuchtspur
  parts.push(`<path d="${trail.d}" fill="url(#${prefix}-trail)"/>`);
  if (!simple) {
    parts.push(`<path d="${core.d}" fill="url(#${prefix}-core)"/>`);
    for (const side of [1, -1]) {
      const a = add(add(METEOR, mul(PERP, side * 74)), mul(TRAIL_DIR, 40));
      const b = add(a, mul(TRAIL_DIR, 96));
      parts.push(
        `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="#a5f3fc" stroke-width="6" stroke-linecap="round" opacity="0.45"/>`,
      );
    }
  }

  // Aufprall-Lichtblitz am Schild
  parts.push(`<circle cx="${f(IMPACT[0])}" cy="${f(IMPACT[1])}" r="${simple ? 80 : 74}" fill="url(#${prefix}-impact)"/>`);

  // Meteorit (Low-Poly-Facetten)
  parts.push(
    `<g>${meteor.facets}<path d="${meteor.outline}" fill="none" stroke="#e0e7ff" stroke-width="${simple ? 10 : 3}" stroke-linejoin="round" opacity="${simple ? 0.9 : 0.7}"/></g>`,
  );
  if (!simple) {
    parts.push(
      `<circle cx="${f(METEOR[0] + 20)}" cy="${f(METEOR[1] - 20)}" r="7" fill="#4c1d95" opacity="0.8"/>`,
      `<circle cx="${f(METEOR[0] - 14)}" cy="${f(METEOR[1] - 30)}" r="4.5" fill="#4c1d95" opacity="0.7"/>`,
    );
    // Funken entlang des Schildes
    const sparks = [62, 82, -62, -84, 40];
    sparks.forEach((angle, i) => {
      const dir = rot(NORMAL, angle);
      const a = add(IMPACT, mul(dir, 34 + (i % 2) * 6));
      const b = add(IMPACT, mul(dir, 62 + (i % 3) * 10));
      parts.push(
        `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${i % 2 ? '#ffffff' : '#a5f3fc'}" stroke-width="${i === 4 ? 5 : 6}" stroke-linecap="round"/>`,
      );
    });
  }
  return parts.join('\n  ');
}

/**
 * Varianten:
 *  rounded  – abgerundetes App-Symbol mit transparenten Ecken (Favicon, Manifest "any", Header)
 *  full     – vollflächig quadratisch (Apple Touch Icon, iOS rundet selbst ab)
 *  maskable – vollflächig, Motiv auf 70 % verkleinert (Sicherheitszone für Android/Windows-Masken)
 *  favicon  – vereinfachtes Motiv für 16/32 px
 *  mark     – nur das Motiv ohne Hintergrund
 */
function svgDoc(variant, size = 512) {
  const prefix = `md${variant}`;
  const rounded = variant === 'rounded' || variant === 'favicon';
  const scale = variant === 'maskable' ? 0.7 : variant === 'full' ? 0.92 : 1;
  const offset = (512 - 512 * scale) / 2;
  const bg =
    variant === 'mark'
      ? ''
      : `<rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="url(#${prefix}-bg)"/>
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="url(#${prefix}-glow)"/>`;
  const clip = rounded ? `<clipPath id="${prefix}-clip"><rect width="512" height="512" rx="112"/></clipPath>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512" role="img" aria-label="Meteor Defense Logo">
  <title>Meteor Defense</title>
  ${defs(prefix).replace('</defs>', `${clip}</defs>`)}
  ${bg}
  <g ${rounded ? `clip-path="url(#${prefix}-clip)"` : ''}>
  <g transform="translate(${f(offset)} ${f(offset)}) scale(${scale})">
  ${art(prefix, { simple: variant === 'favicon' })}
  </g>
  </g>
</svg>
`;
}

// ---------------------------------------------------------------------------
// PNG/ICO-Helfer
// ---------------------------------------------------------------------------
function pngSize(buf) {
  const sig = buf.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') throw new Error('Keine gültige PNG-Datei');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function buildIco(images) {
  // ICO mit eingebetteten PNG-Bildern (von allen aktuellen Browsern unterstützt)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

// iPhone-Startbildschirme: CSS-Breite x CSS-Höhe (Hochformat) @ Pixeldichte
export const SPLASH_DEVICES = [
  { w: 440, h: 956, dpr: 3, label: 'iPhone 16 Pro Max' },
  { w: 402, h: 874, dpr: 3, label: 'iPhone 16 Pro' },
  { w: 430, h: 932, dpr: 3, label: 'iPhone 14 Pro Max / 15 Plus / 15 Pro Max / 16 Plus' },
  { w: 393, h: 852, dpr: 3, label: 'iPhone 14 Pro / 15 / 15 Pro / 16' },
  { w: 428, h: 926, dpr: 3, label: 'iPhone 12 Pro Max / 13 Pro Max / 14 Plus' },
  { w: 390, h: 844, dpr: 3, label: 'iPhone 12 / 13 / 14' },
  { w: 375, h: 812, dpr: 3, label: 'iPhone X / XS / 11 Pro / 12 mini / 13 mini' },
  { w: 414, h: 896, dpr: 3, label: 'iPhone XS Max / 11 Pro Max' },
  { w: 414, h: 896, dpr: 2, label: 'iPhone XR / 11' },
  { w: 375, h: 667, dpr: 2, label: 'iPhone SE / 8' },
];

function splashHtml(logoSvg, landscape) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;}
    body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${landscape ? '3vh' : '2.5vh'};
      background:#080c22;
      font-family:-apple-system,'Segoe UI','Noto Sans',system-ui,sans-serif;color:#e0e7ff;}
    .logo{width:${landscape ? '26vh' : '34vw'};height:auto;}
    .logo svg{width:100%;height:auto;display:block}
    h1{margin:0;font-weight:800;letter-spacing:.06em;font-size:${landscape ? '6.5vh' : '7.4vw'};
      color:#a5b4fc;}
  </style></head><body><div class="logo">${logoSvg}</div><h1>METEOR DEFENSE</h1></body></html>`;
}

async function main() {
  const pwModule = process.env.PLAYWRIGHT_MODULE ?? '@playwright/test';
  const imported = await import(pwModule.startsWith('/') ? pathToFileURL(pwModule).href : pwModule);
  const chromium = imported.chromium ?? imported.default?.chromium;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox'],
  });

  const svgs = {
    rounded: svgDoc('rounded'),
    full: svgDoc('full'),
    maskable: svgDoc('maskable'),
    favicon: svgDoc('favicon'),
    mark: svgDoc('mark'),
  };

  const svgFiles = {
    'branding/meteor-defense-logo.svg': svgs.rounded,
    'branding/meteor-defense-logo-square.svg': svgs.full,
    'branding/meteor-defense-logo-maskable.svg': svgs.maskable,
    'branding/meteor-defense-mark.svg': svgs.mark,
    'public/favicon.svg': svgs.favicon,
    'public/icons/logo.svg': svgs.rounded,
  };
  for (const [file, content] of Object.entries(svgFiles)) {
    await mkdir(path.dirname(out(file)), { recursive: true });
    await writeFile(out(file), content);
    console.log('SVG ', file);
  }

  async function render(svg, size) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const sized = svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${sized}</body></html>`,
    );
    const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    const dim = pngSize(buf);
    if (dim.width !== size || dim.height !== size) throw new Error(`Falsche Grösse ${dim.width}x${dim.height}`);
    return buf;
  }

  const pngJobs = [
    ['public/favicon-16.png', 'favicon', 16],
    ['public/favicon-32.png', 'favicon', 32],
    ['public/apple-touch-icon.png', 'full', 180],
    ['public/icons/icon-192.png', 'rounded', 192],
    ['public/icons/icon-512.png', 'rounded', 512],
    ['public/icons/maskable-192.png', 'maskable', 192],
    ['public/icons/maskable-512.png', 'maskable', 512],
    ['branding/meteor-defense-logo-1024.png', 'rounded', 1024],
  ];
  for (const [file, variant, size] of pngJobs) {
    const buf = await render(svgs[variant], size);
    await mkdir(path.dirname(out(file)), { recursive: true });
    await writeFile(out(file), buf);
    console.log('PNG ', file, `${size}x${size}`, `${buf.length} B`);
  }

  const ico = buildIco(
    await Promise.all(
      [16, 32, 48].map(async (size) => ({ size, data: await render(svgs[size === 48 ? 'rounded' : 'favicon'], size) })),
    ),
  );
  await writeFile(out('public/favicon.ico'), ico);
  console.log('ICO  public/favicon.ico 16/32/48', `${ico.length} B`);

  await mkdir(out('public/splash'), { recursive: true });
  const links = [];
  for (const d of SPLASH_DEVICES) {
    for (const orientation of ['portrait', 'landscape']) {
      const landscape = orientation === 'landscape';
      const vw = landscape ? d.h : d.w;
      const vh = landscape ? d.w : d.h;
      const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: d.dpr });
      await page.setContent(splashHtml(svgs.rounded, landscape));
      const buf = await page.screenshot({ type: 'png' });
      await page.close();
      const dim = pngSize(buf);
      const name = `splash/apple-splash-${dim.width}x${dim.height}.png`;
      await writeFile(out(`public/${name}`), buf);
      links.push(
        `<link rel="apple-touch-startup-image" media="screen and (device-width: ${d.w}px) and (device-height: ${d.h}px) and (-webkit-device-pixel-ratio: ${d.dpr}) and (orientation: ${orientation})" href="/${name}" />`,
      );
      console.log('PNG ', `public/${name}`, d.label, orientation);
    }
  }
  await writeFile(out('branding/apple-splash-links.html'), `${links.join('\n')}\n`);
  await browser.close();
  console.log('Fertig. Splash-Links: branding/apple-splash-links.html');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
