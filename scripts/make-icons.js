'use strict';

/**
 * Erzeugt die Icons ohne externe Abhängigkeiten:
 *   assets/trayTemplate.png      Menüleiste (22px, Template = nur Alpha zählt)
 *   assets/trayTemplate@2x.png   Menüleiste retina
 *   assets/icon.png              App-Icon 1024px
 *   assets/icon.iconset/*        Vorlage für iconutil → icon.icns
 *
 * Aufruf: node scripts/make-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ------------------------------------------------------------- PNG-Encoder */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** rgba: Uint8Array der Länge w*h*4 */
function encodePng(rgba, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filter
  ihdr[12] = 0; // nicht interlaced

  // Jede Zeile bekommt ein führendes Filter-Byte (0 = None).
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    const rowStart = y * (w * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy
      ? rgba.copy(raw, rowStart + 1, y * w * 4, (y + 1) * w * 4)
      : Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, rowStart + 1);
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------ Zeichenhilfen */

class Canvas {
  constructor(size) {
    this.size = size;
    this.buf = Buffer.alloc(size * size * 4); // startet vollständig transparent
  }

  /** Alpha-Blending eines Pixels. */
  blend(x, y, [r, g, b], alpha) {
    if (alpha <= 0 || x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const a = Math.min(1, alpha);
    const i = (y * this.size + x) * 4;
    const dstA = this.buf[i + 3] / 255;
    const outA = a + dstA * (1 - a);
    if (outA <= 0) return;
    this.buf[i] = Math.round((r * a + this.buf[i] * dstA * (1 - a)) / outA);
    this.buf[i + 1] = Math.round((g * a + this.buf[i + 1] * dstA * (1 - a)) / outA);
    this.buf[i + 2] = Math.round((b * a + this.buf[i + 2] * dstA * (1 - a)) / outA);
    this.buf[i + 3] = Math.round(outA * 255);
  }

  /**
   * Malt eine Form über eine Distanzfunktion.
   * dist < 0 = innen. Der Übergang wird über ~1px weich gezeichnet.
   */
  paint(distFn, colorFn) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const d = distFn(x + 0.5, y + 0.5);
        if (d > 1) continue;
        const coverage = Math.min(1, Math.max(0, 0.5 - d));
        if (coverage <= 0) continue;
        const color = colorFn(x + 0.5, y + 0.5);
        if (!color) continue;
        this.blend(x, y, color, coverage * (color[3] === undefined ? 1 : color[3]));
      }
    }
  }
}

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

/** Signierte Distanz zu einem abgerundeten Rechteck. */
function roundedBoxDist(cx, cy, halfW, halfH, radius) {
  return (x, y) => {
    const dx = Math.abs(x - cx) - (halfW - radius);
    const dy = Math.abs(y - cy) - (halfH - radius);
    const ax = Math.max(dx, 0);
    const ay = Math.max(dy, 0);
    return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(dx, dy), 0) - radius;
  };
}

/** Signierte Distanz zu einem Ring (Kreisrand mit Dicke). */
function ringDist(cx, cy, radius, thickness) {
  return (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    return Math.abs(d - radius) - thickness / 2;
  };
}

/** Ring, aber nur über einen Winkelbereich (Bogen), Start oben, im Uhrzeigersinn. */
function arcDist(cx, cy, radius, thickness, fraction) {
  const ring = ringDist(cx, cy, radius, thickness);
  const maxAngle = fraction * Math.PI * 2;
  return (x, y) => {
    const base = ring(x, y);
    if (base > 1) return base;
    // Winkel ab 12 Uhr im Uhrzeigersinn.
    let angle = Math.atan2(x - cx, cy - y);
    if (angle < 0) angle += Math.PI * 2;
    if (angle <= maxAngle) return base;
    // Außerhalb des Bogens: runde Kappen an beiden Enden.
    const capA = [cx + Math.sin(0) * radius, cy - Math.cos(0) * radius];
    const capB = [cx + Math.sin(maxAngle) * radius, cy - Math.cos(maxAngle) * radius];
    const dA = Math.hypot(x - capA[0], y - capA[1]) - thickness / 2;
    const dB = Math.hypot(x - capB[0], y - capB[1]) - thickness / 2;
    return Math.min(dA, dB);
  };
}

/* ------------------------------------------------------------------- Icons */

const CYAN = [34, 211, 238];
const GREEN = [74, 222, 128];

/** Menüleisten-Icon: reines Schwarz + Alpha, macOS färbt es selbst ein. */
function makeTray(size) {
  const c = new Canvas(size);
  const mid = size / 2;
  const radius = size * 0.34;
  const thickness = size * 0.11;

  c.paint(arcDist(mid, mid, radius, thickness, 0.78), () => [0, 0, 0]);
  c.paint(
    (x, y) => Math.hypot(x - mid, y - mid) - size * 0.085,
    () => [0, 0, 0]
  );
  return encodePng(c.buf, size, size);
}

/** App-Icon: dunkles Panel, Cyan-Ring, grüner Fortschrittsbogen. */
function makeAppIcon(size) {
  const c = new Canvas(size);
  const mid = size / 2;
  const s = size / 1024; // alles ist für 1024px entworfen

  // Hintergrund mit weichem Verlauf und leichtem Leuchten oben.
  c.paint(
    roundedBoxDist(mid, mid, size * 0.5, size * 0.5, size * 0.225),
    (x, y) => {
      const t = y / size;
      const base = mix([6, 24, 32], [3, 10, 14], t);
      const glow = Math.max(0, 1 - Math.hypot(x - mid, y - size * 0.22) / (size * 0.62));
      return mix(base, [16, 70, 86], glow * 0.55);
    }
  );

  // Feiner heller Rand für Tiefe.
  c.paint(
    (x, y) => {
      const d = roundedBoxDist(mid, mid, size * 0.5, size * 0.5, size * 0.225)(x, y);
      return Math.abs(d + 2 * s) - 1.6 * s;
    },
    () => [...CYAN, 0.22]
  );

  // Gestrichelter Innenkreis — die HUD-Anmutung.
  c.paint(ringDist(mid, mid, 300 * s, 2.5 * s), (x, y) => {
    let angle = Math.atan2(x - mid, mid - y);
    if (angle < 0) angle += Math.PI * 2;
    const segments = 48;
    const on = Math.floor((angle / (Math.PI * 2)) * segments) % 2 === 0;
    return on ? [...CYAN, 0.45] : null;
  });

  // Äußerer Cyan-Ring.
  c.paint(ringDist(mid, mid, 372 * s, 16 * s), () => [...CYAN, 0.32]);

  // Grüner Fortschrittsbogen: 76 % — der Fokus-Score aus dem Dashboard.
  c.paint(arcDist(mid, mid, 372 * s, 34 * s, 0.76), () => GREEN);

  // Kern.
  c.paint(ringDist(mid, mid, 150 * s, 26 * s), () => CYAN);
  c.paint((x, y) => Math.hypot(x - mid, y - mid) - 62 * s, () => CYAN);

  return encodePng(c.buf, size, size);
}

/* -------------------------------------------------------------------- Main */

const assets = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assets, { recursive: true });

fs.writeFileSync(path.join(assets, 'trayTemplate.png'), makeTray(22));
fs.writeFileSync(path.join(assets, 'trayTemplate@2x.png'), makeTray(44));
fs.writeFileSync(path.join(assets, 'icon.png'), makeAppIcon(1024));

// iconset für iconutil (macOS baut daraus die .icns)
const iconset = path.join(assets, 'icon.iconset');
fs.mkdirSync(iconset, { recursive: true });
const variants = [
  [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png'],
];
for (const [size, name] of variants) {
  fs.writeFileSync(path.join(iconset, name), makeAppIcon(size));
}

console.log('Icons geschrieben nach', assets);
