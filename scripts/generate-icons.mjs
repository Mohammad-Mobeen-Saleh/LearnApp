// Erzeugt Logo, App-Symbole und Startbilder der Plattform LernArcade sowie das Snake-Spiellogo.
//
//   npx playwright install chromium   (einmalig)
//   npm run icons
//
// Das Logo ist als SVG definiert und wird mit Chromium (Playwright) in PNG-Dateien gerendert.
// favicon.ico wird aus 16/32/48-px-PNGs zusammengesetzt.
// Das Meteor-Defense-Spiellogo liegt unverändert in public/games/meteor-defense/logo.svg
// (Quelle und Generator: branding/meteor-defense/).
//
// Optionale Umgebungsvariablen:
//   PLAYWRIGHT_MODULE  Pfad/Name des Playwright-Moduls (Standard: @playwright/test)
//   CHROMIUM_PATH      eigener Pfad zu einer Chromium-Programmdatei

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (p) => path.join(root, p);

// ---------------------------------------------------------------------------
// LernArcade-Logo: vier leuchtende Spielkacheln (je ein Spiel), 512 × 512 Einheiten
// ---------------------------------------------------------------------------
const TILES = [
  // [x, y, Farbe hell, Farbe dunkel]
  [92, 92, '#a78bfa', '#6d28d9'], // Meteor (violett)
  [272, 92, '#4ade80', '#15803d'], // Snake (grün)
  [92, 272, '#fbbf24', '#d97706'], // Quiz (bernstein)
  [272, 272, '#22d3ee', '#0e7490'], // weitere Spiele (türkis)
];
const TILE = 148;

function defs(p) {
  return `<defs>
    <linearGradient id="${p}-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1030"/><stop offset="0.6" stop-color="#151a4a"/><stop offset="1" stop-color="#24124f"/>
    </linearGradient>
    <radialGradient id="${p}-glow" cx="0.5" cy="0.45" r="0.6">
      <stop offset="0" stop-color="#6366f1" stop-opacity="0.35"/><stop offset="1" stop-color="#6366f1" stop-opacity="0"/>
    </radialGradient>
    ${TILES.map(
      ([, , light, dark], i) => `<linearGradient id="${p}-t${i}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient>`,
    ).join('\n    ')}
    <filter id="${p}-blur" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="14"/></filter>
    <clipPath id="${p}-clip"><rect width="512" height="512" rx="112"/></clipPath>
  </defs>`;
}

/** Symbole in den Kacheln (bei sehr kleinen Grössen weggelassen) */
function glyphs() {
  const meteor = `<g transform="translate(92 92)">
      <path d="M58 90 L126 22 L136 32 L68 100 Z" fill="#ede9fe" opacity="0.55"/>
      <path d="M48 80 L108 20" stroke="#f5f3ff" stroke-width="8" stroke-linecap="round" opacity="0.5"/>
      <path d="M40 74 L64 60 L88 70 L94 96 L76 116 L50 112 L36 94 Z" fill="#f5f3ff"/>
      <path d="M64 60 L70 86 L94 96 M70 86 L50 112" stroke="#c4b5fd" stroke-width="4" fill="none" stroke-linejoin="round"/>
    </g>`;
  const snake = `<g transform="translate(272 92)">
      <path d="M30 112 C30 82 64 82 74 74 C86 64 86 40 112 40" stroke="#f0fdf4" stroke-width="20" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <circle cx="116" cy="40" r="6" fill="#14532d"/>
      <circle cx="40" cy="40" r="15" fill="#fef08a"/>
      <path d="M40 24 q6 -10 14 -8" stroke="#bbf7d0" stroke-width="5" stroke-linecap="round" fill="none"/>
    </g>`;
  const quiz = `<g transform="translate(92 272)">
      <path d="M50 54 a24 24 0 1 1 34 22 c-8 4 -10 9 -10 18" stroke="#fffbeb" stroke-width="17" stroke-linecap="round" fill="none"/>
      <circle cx="74" cy="118" r="10" fill="#fffbeb"/>
    </g>`;
  const play = `<g transform="translate(272 272)">
      <path d="M56 40 L110 74 L56 108 Z" fill="#ecfeff" stroke="#ecfeff" stroke-width="10" stroke-linejoin="round"/>
    </g>`;
  return meteor + snake + quiz + play;
}

/**
 * Varianten:
 *  rounded  abgerundetes Symbol mit transparenten Ecken (Favicon gross, Manifest, Header)
 *  full     vollflächig quadratisch (Apple Touch Icon, iOS rundet selbst ab)
 *  maskable vollflächig, Motiv auf 72 % (Sicherheitszone)
 *  favicon  vereinfacht ohne Symbole (16/32 px)
 */
function lernArcadeSvg(variant, size = 512) {
  const p = `la${variant}`;
  const rounded = variant === 'rounded' || variant === 'favicon';
  const scale = variant === 'maskable' ? 0.72 : variant === 'full' ? 0.94 : 1;
  const offset = (512 - 512 * scale) / 2;
  const simple = variant === 'favicon';
  const gap = simple ? 0 : 0;
  const tiles = TILES.map(([x, y], i) => {
    const grow = simple ? 18 : 0;
    return `<rect x="${x - grow - gap}" y="${y - grow - gap}" width="${TILE + 2 * grow}" height="${TILE + 2 * grow}" rx="${simple ? 30 : 34}" fill="url(#${p}-t${i})"/>`;
  }).join('');
  const glow = TILES.map(([x, y, light]) => `<rect x="${x}" y="${y}" width="${TILE}" height="${TILE}" rx="34" fill="${light}" opacity="0.35"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512" role="img" aria-label="LernArcade Logo">
  <title>LernArcade</title>
  ${defs(p)}
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="url(#${p}-bg)"/>
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="url(#${p}-glow)"/>
  <g ${rounded ? `clip-path="url(#${p}-clip)"` : ''}>
    <g transform="translate(${offset} ${offset}) scale(${scale})">
      ${simple ? '' : `<g filter="url(#${p}-blur)">${glow}</g>`}
      ${tiles}
      ${simple ? '' : glyphs()}
    </g>
  </g>
</svg>
`;
}

/** Snake-Spiellogo: grüne Schlange mit Frucht auf dunkelgrünem Feld */
function snakeLogoSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="Snake Logo">
  <title>Snake</title>
  <defs>
    <linearGradient id="sn-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#052e1a"/><stop offset="1" stop-color="#0b3d2a"/></linearGradient>
    <linearGradient id="sn-body" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#16a34a"/><stop offset="0.6" stop-color="#4ade80"/><stop offset="1" stop-color="#a7f3d0"/></linearGradient>
    <radialGradient id="sn-fruit" cx="0.35" cy="0.35" r="0.7"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f97316"/></radialGradient>
    <filter id="sn-blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="12"/></filter>
    <pattern id="sn-grid" width="64" height="64" patternUnits="userSpaceOnUse"><rect width="64" height="64" fill="none" stroke="#14532d" stroke-width="2" opacity="0.6"/></pattern>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#sn-bg)"/>
  <rect width="512" height="512" rx="112" fill="url(#sn-grid)"/>
  <path d="M112 400 L112 272 Q112 224 160 224 L304 224 Q352 224 352 176 L352 128" stroke="#4ade80" stroke-width="72" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.45" filter="url(#sn-blur)"/>
  <path d="M112 400 L112 272 Q112 224 160 224 L304 224 Q352 224 352 176 L352 128" stroke="url(#sn-body)" stroke-width="64" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="338" cy="118" r="9" fill="#052e1a"/><circle cx="366" cy="118" r="9" fill="#052e1a"/>
  <circle cx="420" cy="380" r="44" fill="url(#sn-fruit)"/>
  <path d="M420 336 q10 -22 32 -22" stroke="#86efac" stroke-width="12" stroke-linecap="round" fill="none"/>
  <circle cx="404" cy="364" r="10" fill="#fff7ed" opacity="0.7"/>
</svg>
`;
}

// ---------------------------------------------------------------------------
function pngSize(buf) {
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Keine gültige PNG-Datei');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function buildIco(images) {
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
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

// iPhone-Startbildschirme: CSS-Breite × CSS-Höhe (Hochformat) @ Pixeldichte (passend zu index.html)
const SPLASH_DEVICES = [
  { w: 440, h: 956, dpr: 3 },
  { w: 402, h: 874, dpr: 3 },
  { w: 430, h: 932, dpr: 3 },
  { w: 393, h: 852, dpr: 3 },
  { w: 428, h: 926, dpr: 3 },
  { w: 390, h: 844, dpr: 3 },
  { w: 375, h: 812, dpr: 3 },
  { w: 414, h: 896, dpr: 3 },
  { w: 414, h: 896, dpr: 2 },
  { w: 375, h: 667, dpr: 2 },
];

function splashHtml(logoSvg, landscape) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;}
    body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${landscape ? '3vh' : '2.5vh'};
      background:#080c22;font-family:-apple-system,'Segoe UI','Noto Sans',system-ui,sans-serif;}
    .logo{width:${landscape ? '26vh' : '34vw'}}.logo svg{width:100%;height:auto;display:block}
    h1{margin:0;font-weight:800;letter-spacing:.04em;font-size:${landscape ? '6.5vh' : '7.4vw'};color:#e0e7ff}
    h1 span{color:#a5b4fc}
  </style></head><body><div class="logo">${logoSvg}</div><h1>Lern<span>Arcade</span></h1></body></html>`;
}

async function main() {
  const pwModule = process.env.PLAYWRIGHT_MODULE ?? '@playwright/test';
  const imported = await import(pwModule.startsWith('/') ? pathToFileURL(pwModule).href : pwModule);
  const chromium = imported.chromium ?? imported.default?.chromium;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });

  const svgs = {
    rounded: lernArcadeSvg('rounded'),
    full: lernArcadeSvg('full'),
    maskable: lernArcadeSvg('maskable'),
    favicon: lernArcadeSvg('favicon'),
  };
  const files = {
    'branding/lernarcade/lernarcade-logo.svg': svgs.rounded,
    'branding/lernarcade/lernarcade-logo-square.svg': svgs.full,
    'branding/lernarcade/lernarcade-logo-maskable.svg': svgs.maskable,
    'public/favicon.svg': svgs.favicon,
    'public/icons/logo.svg': svgs.rounded,
    'public/games/snake/logo.svg': snakeLogoSvg(),
  };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(out(file)), { recursive: true });
    await writeFile(out(file), content);
    console.log('SVG ', file);
  }

  async function render(svg, size) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`)}</body></html>`);
    const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    const dim = pngSize(buf);
    if (dim.width !== size || dim.height !== size) throw new Error(`Falsche Grösse ${dim.width}x${dim.height}`);
    return buf;
  }

  const jobs = [
    ['public/favicon-16.png', 'favicon', 16],
    ['public/favicon-32.png', 'favicon', 32],
    ['public/apple-touch-icon.png', 'full', 180],
    ['public/icons/icon-192.png', 'rounded', 192],
    ['public/icons/icon-512.png', 'rounded', 512],
    ['public/icons/maskable-192.png', 'maskable', 192],
    ['public/icons/maskable-512.png', 'maskable', 512],
    ['branding/lernarcade/lernarcade-logo-1024.png', 'rounded', 1024],
  ];
  for (const [file, variant, size] of jobs) {
    const buf = await render(svgs[variant], size);
    await mkdir(path.dirname(out(file)), { recursive: true });
    await writeFile(out(file), buf);
    console.log('PNG ', file, `${size}x${size}`);
  }
  const ico = buildIco(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await render(svgs[size === 48 ? 'rounded' : 'favicon'], size) }))));
  await writeFile(out('public/favicon.ico'), ico);
  console.log('ICO  public/favicon.ico');

  await mkdir(out('public/splash'), { recursive: true });
  for (const d of SPLASH_DEVICES) {
    for (const landscape of [false, true]) {
      const page = await browser.newPage({ viewport: { width: landscape ? d.h : d.w, height: landscape ? d.w : d.h }, deviceScaleFactor: d.dpr });
      await page.setContent(splashHtml(svgs.rounded, landscape));
      const buf = await page.screenshot({ type: 'png' });
      await page.close();
      const dim = pngSize(buf);
      await writeFile(out(`public/splash/apple-splash-${dim.width}x${dim.height}.png`), buf);
      console.log('PNG ', `public/splash/apple-splash-${dim.width}x${dim.height}.png`);
    }
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
