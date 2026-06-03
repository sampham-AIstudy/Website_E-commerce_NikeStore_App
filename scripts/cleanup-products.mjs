/**
 * cleanup-products.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Sua ten san pham generic ("Nike Men Product 60") thanh ten Nike that
 * 2. Xoa san pham khong co file anh tren disk
 *
 * Dung:
 *   node scripts/cleanup-products.mjs --dry-run   (chi xem, khong thay doi)
 *   node scripts/cleanup-products.mjs             (thuc thi that)
 */

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT   = path.resolve(__dirname, '..');
const PUBLIC    = path.join(PROJECT, 'public');

const _require = createRequire(import.meta.url);
const mysql    = _require(path.join(PROJECT, 'backend', 'node_modules', 'mysql2', 'promise'));

const DRY_RUN = process.argv.includes('--dry-run');

// ─── Mau terminal ─────────────────────────────────────────────────────────────
const C = {
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan:  '\x1b[36m', gray:   '\x1b[90m', magenta: '\x1b[35m',
  bold:  '\x1b[1m',  reset:  '\x1b[0m',
};
const ok   = m => console.log(`${C.green}  ✓  ${m}${C.reset}`);
const skip = m => console.log(`${C.gray}  -  ${m}${C.reset}`);
const fail = m => console.log(`${C.red}  ✗  ${m}${C.reset}`);
const info = m => console.log(`${C.cyan}  >>  ${m}${C.reset}`);
const warn = m => console.log(`${C.yellow}  !!  ${m}${C.reset}`);

// ─── Ten san pham Nike thuc te de thay the ten generic ───────────────────────
const REAL_NAMES = {
  men: [
    "Nike Air Max 90",             "Nike Air Force 1 '07",        "Nike Dunk Low Retro",
    "Nike Air Zoom Pegasus 41",    "Nike Air Max Plus TN",        "Nike Blazer Mid '77 Vintage",
    "Nike React Infinity Run FK3", "Nike Air Max 270",            "Nike ZoomX Vaporfly Next%",
    "Nike Metcon 9",               "Nike Air Huarache",           "Nike Court Vision Low",
    "Nike Air Max 97",             "Nike Air Jordan 1 Retro High","Nike Free RN 5.0 Next",
    "Nike Zoom Fly 5",             "Nike Pegasus Trail 4 GTX",    "Nike Invincible 3",
    "Nike Structure 25",           "Nike Air Max Scorpion FK",    "Nike Air Rift Breathe",
    "Nike SB Dunk Low Pro",        "Nike Air Max 1 '87",          "Nike Killshot 2 Leather",
    "Nike Waffle One SE",          "Nike Air Max Dawn",           "Nike Air Presto",
    "Nike Dunk High Retro SE",     "Nike ACG Mountain Fly Low",   "Nike Air VaporMax Plus",
    "Nike Tempo Next%",            "Nike Air Max INTRLK Lite",    "Nike Revolution 7",
    "Nike Downshifter 13",         "Nike Interact Run SE",        "Nike Winflo 11",
    "Nike Court Legacy Canvas",    "Nike Air Max Excee",          "Nike Precision 7",
    "Nike GT Cut 3 Elite",         "Nike LeBron XXI",             "Nike Kyrie Infinity 2",
    "Nike KD 16",                  "Nike Zoom Freak 5",           "Nike PG 6",
    "Nike Air Max 95",             "Nike Air Max Pre-Day",        "Nike Dunk Low Twist",
    "Nike Windrunner Woven",       "Nike Tech Fleece Jogger",     "Nike Club Fleece Hoodie",
    "Nike Dri-FIT Miler Top",      "Nike Pro Compression Shirt",  "Nike Therma-FIT Pullover",
    "Nike Club Cargo Pants",       "Nike Challenger Shorts",      "Nike Air Max Genome",
    "Nike Air Max 2021",           "Nike React Vision",           "Nike Crater Impact SE",
    "Nike Air Trainer 1",          "Nike Air Max Solo",           "Nike V2K Run",
    "Nike P-6000",                 "Nike Air Max Dn",             "Nike Zoom Vomero 17",
  ],
  women: [
    "Nike Air Force 1 Shadow",     "Nike Air Max 270",            "Nike Dunk Low",
    "Nike Air Max Pulse",          "Nike Pegasus Trail 4 GTX",    "Nike Air Max 1 '87",
    "Nike Blazer Low '77 Jumbo",   "Nike InfinityRN 4",          "Nike Zoom Fly 5",
    "Nike Court Vision Low",       "Nike Free Metcon 5",          "Nike Motiva",
    "Nike Air Max 90 Futura",      "Nike V2K Run",                "Nike InfinaRN",
    "Nike Pegasus 41",             "Nike Invincible 3",           "Nike Structure 25",
    "Nike Air Max Scorpion FK",    "Nike Dunk High",              "Nike Air Max Dawn SE",
    "Nike Waffle One",             "Nike Air Presto",             "Nike P-6000",
    "Nike Air Max 97",             "Nike React Phantom Run FK2",  "Nike Go FlyEase",
    "Nike Vapormax 2023 FK",       "Nike Blazer Mid '77 SE",      "Nike Revolution 7",
    "Nike Court Royale 2",         "Nike Downshifter 13",         "Nike Interact Run",
    "Nike Winflo 11",              "Nike Court Legacy Canvas",    "Nike Air Max Excee",
    "Nike Free RN NN",             "Nike Metcon 9",               "Nike SuperRep Go 3",
    "Nike City Trainer 3",         "Nike Air Max INTRLK",         "Nike Zoom Vomero 17",
    "Nike Air Jordan 1 Low",       "Nike Dunk Low Twist",         "Nike Blazer Low Platform",
    "Nike One Leggings",           "Nike Zenvy Leggings",         "Nike Dri-FIT One Tank",
    "Nike Alate Bra",              "Nike Indy Plunge Bra",        "Nike Swoosh Tank",
    "Nike Tech Fleece Hoodie",     "Nike Phoenix Fleece Crew",    "Nike Windrunner Jacket",
    "Nike Club Fleece Sweatshirt", "Nike Tempo Running Shorts",   "Nike Sportswear Essential Tee",
    "Nike Trail Repel Jacket",     "Nike Air Rift Breathe",       "Nike Crater Impact SE",
    "Nike React Vision",           "Nike Air Max Solo",           "Nike Air Max Pre-Day",
  ],
  kids: [
    "Nike Air Force 1 LE",         "Nike Dunk Low",               "Nike Air Max 270 GO",
    "Nike Revolution 6 FlyEase",   "Nike Star Runner 4",          "Nike Flex Runner 2",
    "Nike Court Borough Low 2",    "Nike Dynamo Free",            "Nike Downshifter 12",
    "Nike Air Max 90 LTR",         "Nike Pico 5",                 "Nike Omni Multi-Court",
    "Nike Waffle One",             "Nike Crater Impact",          "Nike Revolution 7",
    "Nike Air Max INTRLK Lite",    "Nike Spark FlyEase",          "Nike Team Hustle D11",
    "Nike Air Jordan 1 Mid",       "Nike Dunk High",              "Nike Blazer Mid '77",
    "Nike Court Vision Mid",       "Nike Air Max Motif",          "Nike Huarache Run 2.0",
    "Nike MD Valiant",             "Nike Tanjun EasyOn",          "Nike Wearallday",
    "Nike Air Zoom Crossover 2",   "Nike Star Runner 3",          "Nike Flex Experience Run",
    "Nike Downshifter 13",         "Nike Air More Uptempo",       "Nike LeBron Witness 8",
    "Nike Kyrie Infinity 2",       "Nike KD 16",                  "Nike Zoom Freak 5",
    "Nike Court Borough Mid 2",    "Nike Air Max SC",             "Nike Sunray Protect 3",
    "Nike Club Fleece Hoodie",     "Nike Dri-FIT Academy Pants",  "Nike Sportswear Windrunner",
    "Nike Club Jogger Pants",      "Nike Pro Compression Top",    "Nike Swoosh T-Shirt",
    "Nike Trophy Training Shorts", "Nike Therma-FIT Pullover",    "Nike Brasilia Backpack",
    "Nike Everyday Socks 3-Pack",  "Nike Free RN Flyknit",        "Nike Interact Run",
    "Nike Pegasus 41",             "Nike Air Max 90",              "Nike Air Max 97",
    "Nike Air Presto",             "Nike Dunk Low Retro",          "Nike Air Max 270",
  ],
};

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.cyan}${'='.repeat(60)}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  Nike Products Cleanup${C.reset}`);
  if (DRY_RUN) console.log(`${C.yellow}  [DRY RUN] Chi xem, khong thay doi DB${C.reset}`);
  console.log(`${C.cyan}${'='.repeat(60)}${C.reset}\n`);

  let db;
  try {
    db = await mysql.createConnection({
      host: 'localhost', user: 'root', password: '', database: 'nike_store',
    });
    info('Ket noi MySQL nike_store thanh cong');
  } catch (e) {
    fail(`Khong ket noi duoc MySQL: ${e.message}`);
    process.exit(1);
  }

  const [allProducts] = await db.query('SELECT id, title, image, category FROM products ORDER BY id');
  info(`Tong san pham trong DB: ${allProducts.length}`);

  let renamed = 0, deleted = 0, goodCount = 0;

  // ── Track da dung ten nao de khong trung ────────────────────────────────────
  const usedNames = { men: 0, women: 0, kids: 0 };

  // ══════════════════════════════════════════════════════════════════════════════
  // PHAN 1: Xoa san pham khong co file anh
  // ══════════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}${C.cyan}  ---- XOA SAN PHAM KHONG CO ANH ----${C.reset}`);

  const toDelete = [];
  for (const p of allProducts) {
    if (!p.image || p.image.trim() === '') {
      toDelete.push(p);
      continue;
    }

    // Kiem tra file co ton tai tren disk khong
    const imgPath = p.image.startsWith('/')
      ? path.join(PUBLIC, p.image)
      : path.join(PUBLIC, '/', p.image);

    if (!fs.existsSync(imgPath)) {
      toDelete.push(p);
    }
  }

  if (toDelete.length === 0) {
    ok('Khong co san pham nao thieu anh.');
  } else {
    warn(`Tim thay ${toDelete.length} san pham khong co file anh tren disk:`);
    for (const p of toDelete) {
      console.log(`${C.red}    ID ${p.id}: "${p.title}" -> ${p.image}${C.reset}`);
      if (!DRY_RUN) {
        await db.execute('DELETE FROM products WHERE id = ?', [p.id]);
      }
      deleted++;
    }
    if (!DRY_RUN) ok(`Da xoa ${deleted} san pham khong co anh.`);
    else warn(`[DRY] Se xoa ${deleted} san pham.`);
  }

  // Lay lai danh sach sau khi xoa
  const [remainingProducts] = await db.query('SELECT id, title, image, category FROM products ORDER BY id');

  // ══════════════════════════════════════════════════════════════════════════════
  // PHAN 2: Sua ten san pham generic
  // ══════════════════════════════════════════════════════════════════════════════
  console.log(`\n${C.bold}${C.cyan}  ---- SUA TEN SAN PHAM GENERIC ----${C.reset}`);

  // Tim san pham co ten generic
  const genericPattern = /^Nike\s+(Men|Women|Kids|Misc)\s+Product\s+\d+$/i;

  // Dem so ten da dung trong DB (de tiep tuc tu vi tri chua dung)
  for (const p of remainingProducts) {
    const cat = (p.category || '').toLowerCase();
    if (cat in usedNames && !genericPattern.test(p.title)) {
      usedNames[cat]++;
    }
  }

  const toRename = remainingProducts.filter(p => genericPattern.test(p.title));

  if (toRename.length === 0) {
    ok('Khong co san pham nao co ten generic.');
  } else {
    warn(`Tim thay ${toRename.length} san pham co ten generic:`);

    // Lay tat ca ten hien co trong DB de tranh trung
    const existingTitles = new Set(remainingProducts.map(p => p.title));

    for (const p of toRename) {
      const cat = (p.category || 'men').toLowerCase();
      const namePool = REAL_NAMES[cat] || REAL_NAMES.men;

      // Tim ten chua bi trung
      let newName = null;
      for (let i = 0; i < namePool.length; i++) {
        const candidate = namePool[i];
        if (!existingTitles.has(candidate)) {
          newName = candidate;
          existingTitles.add(candidate); // danh dau da dung
          break;
        }
      }

      // Neu het ten thi tao ten co so thu tu
      if (!newName) {
        let idx = namePool.length + 1;
        do {
          newName = `Nike ${cat.charAt(0).toUpperCase() + cat.slice(1)} Special Edition ${idx}`;
          idx++;
        } while (existingTitles.has(newName));
        existingTitles.add(newName);
      }

      console.log(`${C.yellow}    ID ${p.id}: "${p.title}" -> "${newName}"${C.reset}`);

      if (!DRY_RUN) {
        // Cap nhat ten + description
        const desc = `${newName} - Thiet ke cao cap tu Nike, hieu suat vuot troi va phong cach hien dai.`;
        await db.execute('UPDATE products SET title = ?, description = ? WHERE id = ?', [newName, desc, p.id]);
      }
      renamed++;
    }

    if (!DRY_RUN) ok(`Da doi ten ${renamed} san pham.`);
    else warn(`[DRY] Se doi ten ${renamed} san pham.`);
  }

  // ── Ket qua ─────────────────────────────────────────────────────────────────
  const [finalProducts] = await db.query('SELECT id, category FROM products');
  const countByCat = {};
  for (const p of finalProducts) {
    const cat = p.category || 'misc';
    countByCat[cat] = (countByCat[cat] || 0) + 1;
  }

  console.log(`\n${C.bold}${C.cyan}${'='.repeat(60)}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  KET QUA CLEANUP${C.reset}`);
  console.log(`${C.cyan}${'='.repeat(60)}${C.reset}`);
  console.log(`${C.red}  Xoa   : ${deleted} san pham (khong co anh)${C.reset}`);
  console.log(`${C.yellow}  Doi ten: ${renamed} san pham (generic -> ten that)${C.reset}`);
  console.log(`${C.green}  Con lai : ${finalProducts.length} san pham${C.reset}`);
  for (const [cat, count] of Object.entries(countByCat).sort()) {
    console.log(`${C.gray}    ${cat}: ${count}${C.reset}`);
  }
  console.log(`${C.cyan}${'='.repeat(60)}${C.reset}\n`);

  await db.end();
}

main().catch(err => {
  fail(`Fatal: ${err.message}`);
  process.exit(1);
});
