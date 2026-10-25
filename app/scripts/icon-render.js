// Icon source of Kup / Nekup. Regenerate every PNG after editing the drawing:
//   cd app && npm i --no-save sharp && node scripts/icon-render.js apply D .
//   (preview: node scripts/icon-render.js preview -> out/*.png next to this file)

// Renders the "shopping cart with a question mark" icon from an inline SVG.
// Usage: node render.js preview            -> out/A-512.png, out/B-512.png
//        node render.js apply A <appDir>   -> writes every icon the app needs
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const GREEN = "#1F6F43";
const VARIANTS = {
  // white cart on the brand green, green question mark
  A: { bg: GREEN, cart: "#FFFFFF", mark: GREEN },
  // green cart on a light background, white question mark
  B: { bg: "#F1F6F2", cart: GREEN, mark: "#FFFFFF" },
};

/** The cart drawing in a 1024 box; `scale` shrinks it around the centre (adaptive icon safe zone). */
function cart({ cart, mark }, scale = 1) {
  const t = scale === 1 ? "" : `transform="translate(512 512) scale(${scale}) translate(-512 -512)"`;
  return `
  <g ${t}>
    <polyline points="115,195 228,195 268,310" fill="none" stroke="${cart}" stroke-width="58" stroke-linecap="round" stroke-linejoin="round"/>
    <polygon points="250,300 885,300 808,660 326,660" fill="${cart}" stroke="${cart}" stroke-width="40" stroke-linejoin="round"/>
    <circle cx="405" cy="802" r="62" fill="${cart}"/>
    <circle cx="735" cy="802" r="62" fill="${cart}"/>
    <path d="M 505 412 A 62 62 0 1 1 604 461 C 588 482 567 500 567 545" fill="none" stroke="${mark}" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="567" cy="604" r="29" fill="${mark}"/>
  </g>`;
}

/**
 * Perspective cart: an open box seen from the front and slightly above – top
 * opening with a dark inner wall, lighter front face, shaded side face, wheels
 * with a highlight and a soft ground shadow. `p` = palette.
 */
function cart3d(p, scale = 1) {
  const t = scale === 1 ? "" : `transform="translate(512 512) scale(${scale}) translate(-512 -512)"`;
  const dx = 58; // depth offset of the back edge (to the right and up)
  const dy = -62;
  return `
  <defs>
    <linearGradient id="front" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.frontTop}"/><stop offset="1" stop-color="${p.frontBottom}"/>
    </linearGradient>
    <linearGradient id="side" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.sideTop}"/><stop offset="1" stop-color="${p.sideBottom}"/>
    </linearGradient>
    <linearGradient id="inner" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.innerTop}"/><stop offset="1" stop-color="${p.innerBottom}"/>
    </linearGradient>
    <radialGradient id="wheel" cx="0.35" cy="0.3" r="0.8">
      <stop offset="0" stop-color="${p.wheelHi}"/><stop offset="1" stop-color="${p.wheelLo}"/>
    </radialGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="22"/>
    </filter>
    <filter id="markShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="8"/>
    </filter>
  </defs>
  <g ${t}>
    <!-- ground shadow -->
    <ellipse cx="575" cy="845" rx="330" ry="46" fill="${p.shadow}" opacity="0.45" filter="url(#shadow)"/>
    <!-- handle -->
    <polyline points="110,190 226,190 266,318" fill="none" stroke="${p.handle}" stroke-width="58" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- inner wall seen through the opening -->
    <polygon points="252,318 ${252 + dx},${318 + dy} ${890 + dx},${318 + dy} 890,318" fill="url(#inner)"/>
    <!-- side face -->
    <polygon points="890,318 ${890 + dx},${318 + dy} ${812 + dx},${662 + dy + 20} 812,662" fill="url(#side)"/>
    <!-- front face -->
    <polygon points="252,318 890,318 812,662 330,662" fill="url(#front)" stroke="${p.rim}" stroke-width="10" stroke-linejoin="round"/>
    <!-- rim highlight along the opening -->
    <polyline points="252,318 ${252 + dx},${318 + dy} ${890 + dx},${318 + dy} 890,318" fill="none" stroke="${p.rim}" stroke-width="14" stroke-linejoin="round" stroke-linecap="round"/>
    <!-- wheels -->
    <circle cx="420" cy="800" r="64" fill="url(#wheel)"/>
    <circle cx="420" cy="800" r="22" fill="${p.hub}"/>
    <circle cx="745" cy="800" r="64" fill="url(#wheel)"/>
    <circle cx="745" cy="800" r="22" fill="${p.hub}"/>
    <!-- question mark standing in the cart: shadow, then the mark -->
    <g opacity="0.35" filter="url(#markShadow)" transform="translate(10 14)">
      <path d="M 500 418 A 66 66 0 1 1 606 470 C 589 493 571 512 571 556" fill="none" stroke="#000" stroke-width="50" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="571" cy="616" r="31" fill="#000"/>
    </g>
    <path d="M 500 418 A 66 66 0 1 1 606 470 C 589 493 571 512 571 556" fill="none" stroke="${p.mark}" stroke-width="50" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="571" cy="616" r="31" fill="${p.mark}"/>
  </g>`;
}

const PALETTES = {
  // white cart with a grey underside on a deep green gradient
  C: {
    bgTop: "#2E8F5C", bgBottom: "#14532F",
    frontTop: "#FFFFFF", frontBottom: "#E4EAE6", sideTop: "#C9D3CD", sideBottom: "#9FB0A7",
    innerTop: "#0F3D22", innerBottom: "#1C6A3E", rim: "#FFFFFF", handle: "#FFFFFF",
    wheelHi: "#FFFFFF", wheelLo: "#B8C4BD", hub: "#1F6F43", shadow: "#000000", mark: "#1F6F43",
  },
  // green cart on a light gradient
  D: {
    bgTop: "#FFFFFF", bgBottom: "#DCE8E0",
    frontTop: "#2C8A55", frontBottom: "#1A5F38", sideTop: "#17522F", sideBottom: "#0F3D22",
    innerTop: "#0B2E19", innerBottom: "#15492A", rim: "#4CAF6E", handle: "#1F6F43",
    wheelHi: "#3F9A66", wheelLo: "#154B2A", hub: "#E8F2EB", shadow: "#1F3A2A", mark: "#FFFFFF",
  },
};

function svg3d(name, { background = true, scale = 1, size = 1024 } = {}) {
  const p = PALETTES[name];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="bg" cx="0.3" cy="0.25" r="1.1">
      <stop offset="0" stop-color="${p.bgTop}"/><stop offset="1" stop-color="${p.bgBottom}"/>
    </radialGradient>
  </defs>
  ${background ? `<rect width="1024" height="1024" fill="url(#bg)"/>` : ""}
  ${cart3d(p, scale)}
</svg>`;
}

function svg(v, { background = true, scale = 1, size = 1024 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  ${background ? `<rect width="1024" height="1024" fill="${v.bg}"/>` : ""}
  ${cart(v, scale)}
</svg>`;
}

async function png(svgText, size, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(svgText), { density: 300 }).resize(size, size).png().toFile(file);
  console.log(`${path.basename(file)} ${size}px`);
}

async function main() {
  const [mode, variantName = "A", appDir] = process.argv.slice(2);
  if (mode === "preview") {
    for (const [name, v] of Object.entries(VARIANTS)) await png(svg(v), 512, path.join(__dirname, "out", `${name}-512.png`));
    for (const name of Object.keys(PALETTES)) await png(svg3d(name), 512, path.join(__dirname, "out", `${name}-512.png`));
    return;
  }
  if (mode === "preview3d") {
    for (const name of Object.keys(PALETTES)) await png(svg3d(name), 512, path.join(__dirname, "out", `${name}-512.png`));
    return;
  }
  if (mode === "apply") {
    if (!appDir) throw new Error("usage: node render.js apply A|B|C|D <appDir>");
    const flat = VARIANTS[variantName];
    const p = PALETTES[variantName];
    if (!flat && !p) throw new Error("unknown variant " + variantName);
    const full = (opts) => (p ? svg3d(variantName, opts) : svg(flat, opts));
    const bgColor = p ? p.bgBottom : flat.bg;
    const assets = path.join(appDir, "assets");
    const pub = path.join(appDir, "public");
    await png(full(), 1024, path.join(assets, "icon.png"));
    await png(full(), 48, path.join(assets, "favicon.png"));
    await png(full(), 1024, path.join(assets, "splash-icon.png"));
    await png(full(), 180, path.join(pub, "apple-touch-icon.png"));
    await png(full(), 192, path.join(pub, "icon-192.png"));
    await png(full(), 512, path.join(pub, "icon-512.png"));
    // Android adaptive icon: foreground inside the safe zone, flat background, white monochrome
    await png(full({ background: false, scale: 0.62 }), 1024, path.join(assets, "android-icon-foreground.png"));
    await png(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${bgColor}"/></svg>`, 1024, path.join(assets, "android-icon-background.png"));
    await png(svg({ bg: "#000", cart: "#FFFFFF", mark: "#000000" }, { background: false, scale: 0.62 }), 1024, path.join(assets, "android-icon-monochrome.png"));
    console.log("background colour for app.json:", bgColor);
    return;
  }
  throw new Error("unknown mode");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
