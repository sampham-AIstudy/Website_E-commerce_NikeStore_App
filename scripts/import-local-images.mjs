/**
 * import-local-images.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Quet tat ca anh trong public/assets/products/{men,women,kids}/
 * va chen vao bang products (MySQL nike_store) voi duong dan local dung chuan.
 *
 * Dung:
 *   node scripts/import-local-images.mjs
 *   node scripts/import-local-images.mjs --dry-run       (chi xem, khong insert)
 *   node scripts/import-local-images.mjs --force         (bo qua check trung lap)
 *   node scripts/import-local-images.mjs --category=men  (chi 1 danh muc)
 */

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT   = path.resolve(__dirname, '..');
const ASSETS    = path.join(PROJECT, 'public', 'assets', 'products');

// mysql2 nam trong backend/node_modules
const _require = createRequire(import.meta.url);
const mysql    = _require(path.join(PROJECT, 'backend', 'node_modules', 'mysql2', 'promise'));

// ─── CLI flags ────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');
const CAT_ARG = (() => {
  const a = process.argv.find(x => x.startsWith('--category='));
  return a ? a.split('=')[1] : null;
})();

// ─── Mau terminal ─────────────────────────────────────────────────────────────
const C = {
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan:  '\x1b[36m', gray:   '\x1b[90m', magenta: '\x1b[35m',
  bold:  '\x1b[1m',  reset:  '\x1b[0m',
};
const ok   = m => console.log(`${C.green}  OK  ${m}${C.reset}`);
const skip = m => console.log(`${C.gray}  --  ${m}${C.reset}`);
const fail = m => console.log(`${C.red}  ERR ${m}${C.reset}`);
const info = m => console.log(`${C.cyan}  >>  ${m}${C.reset}`);
const warn = m => console.log(`${C.yellow}  !!  ${m}${C.reset}`);

// ─── Ten san pham Nike theo danh muc ─────────────────────────────────────────
const PRODUCT_NAMES = {
  men: [
    "Nike Air Max 90 Men",            "Nike Air Force 1 '07 Men",       "Nike Dunk Low Retro Men",
    "Nike Air Zoom Pegasus 41 Men",   "Nike Air Max Plus TN Men",       "Nike Blazer Mid '77 Men",
    "Nike React Infinity Run Men",    "Nike Air Max 270 Men",           "Nike ZoomX Vaporfly Next% Men",
    "Nike Metcon 9 Men",              "Nike Air Huarache Men",          "Nike Court Vision Low Men",
    "Nike Air Max 97 Men",            "Nike Air Jordan 1 Retro Men",    "Nike Free RN 5.0 Men",
    "Nike Tech Fleece Hoodie Men",    "Nike Dri-FIT Running Shirt Men", "Nike Club Fleece Pants Men",
    "Nike Windrunner Jacket Men",     "Nike Dri-FIT Training Shorts Men",
    "Nike Sport Cap Dri-FIT Men",     "Nike Heritage Backpack Men",     "Nike Running Socks Men",
    "Nike Air Max 2090 Men",          "Nike Air Max Dn Men",            "Nike V2K Run Men",
    "Nike LeBron XX Men",             "Nike Air VaporMax Plus Men",     "Nike Zoom Fly 5 Men",
    "Nike Pegasus Trail 4 Men",       "Nike Invincible 3 Men",          "Nike Structure 25 Men",
    "Nike Tempo Next% Men",           "Nike Air Max Scorpion Men",      "Nike Air Rift Men",
    "Nike SB Dunk Low Pro Men",       "Nike Air Max 1 Men",             "Nike Killshot 2 Men",
    "Nike Waffle One Men",            "Nike Air Max Dawn Men",          "Nike Air Presto Men",
    "Nike Dunk High Retro Men",       "Nike ACG Mountain Fly Men",      "Nike Dri-FIT Miler Top Men",
    "Nike Pro Compression Shirt Men", "Nike Therma-FIT Pullover Men",   "Nike Club Cargo Pants Men",
    "Nike Challenger Running Shorts Men", "Nike Air Max INTRLK Men",    "Nike Revolution 7 Men",
    "Nike Downshifter 13 Men",        "Nike Interact Run Men",          "Nike Winflo 11 Men",
    "Nike Court Legacy Canvas Men",   "Nike Air Max Excee Men",         "Nike Precision 7 Men",
    "Nike GT Cut 3 Men",
  ],
  women: [
    "Nike Air Force 1 Shadow Women",  "Nike Air Max 270 Women",         "Nike Dunk Low Women",
    "Nike Air Max Pulse Women",       "Nike Pegasus Trail GTX Women",   "Nike Air Max 1 Women",
    "Nike Blazer Low '77 Women",      "Nike Infinity Run Women",        "Nike Zoom Fly Women",
    "Nike Court Vision Low Women",    "Nike Free Metcon Women",         "Nike Motiva Women",
    "Nike Air Max 90 Futura Women",   "Nike V2K Run Women",             "Nike InfinaRN Women",
    "Nike One Leggings Women",        "Nike Tech Fleece Cropped Hoodie Women",
    "Nike Indy Plunge Bra Women",     "Nike Dri-FIT Swoosh Tank Women",
    "Nike Windrunner ADV Jacket Women", "Nike Club Fleece Sweatshirt Women",
    "Nike Yoga Mat 6mm Women",        "Nike Resistance Bands Women",
    "Nike Air Vapormax 2023 Women",   "Nike Blazer Mid '77 SE Women",   "Nike Revolution 7 Women",
    "Nike Court Royale 2 Women",      "Nike Pegasus 41 Women",          "Nike Invincible 3 Women",
    "Nike Structure 25 Women",        "Nike Air Max Scorpion Women",    "Nike Dunk High Women",
    "Nike Air Max Dawn Women",        "Nike Waffle One Women",          "Nike Air Presto Women",
    "Nike P-6000 Women",              "Nike Air Max 97 Women",          "Nike React Phantom Run Women",
    "Nike Dri-FIT One Tank Women",    "Nike Zenvy Leggings Women",      "Nike Go FlyEase Women",
    "Nike Alate Bra Women",           "Nike Trail Repel Jacket Women",  "Nike Sportswear Essential Tee Women",
    "Nike Tempo Running Shorts Women", "Nike Phoenix Fleece Hoodie Women", "Nike Air Max INTRLK Women",
    "Nike Downshifter 13 Women",      "Nike Interact Run Women",        "Nike Winflo 11 Women",
    "Nike Court Legacy Canvas Women", "Nike Air Max Excee Women",       "Nike Free RN NN Women",
    "Nike Metcon 9 Women",            "Nike SuperRep Go 3 Women",       "Nike City Trainer 3 Women",
  ],
  kids: [
    "Nike Air Force 1 LE Kids",       "Nike Dunk Low Kids",             "Nike Air Max 270 GO Kids",
    "Nike Revolution 6 FlyEase Kids", "Nike Star Runner 4 Kids",        "Nike Flex Runner 2 Kids",
    "Nike Court Borough Low Kids",    "Nike Dynamo Free Kids",          "Nike Downshifter 12 Kids",
    "Nike Air Max 90 Kids",           "Nike Pico 5 Kids",               "Nike Omni Multi-Court Kids",
    "Nike Waffle One Kids",           "Nike Crater Impact Kids",
    "Nike Club Fleece Hoodie Kids",   "Nike Dri-FIT Sport T-Shirt Kids",
    "Nike Park 20 Fleece Pants Kids", "Nike Trophy Training Shorts Kids",
    "Nike Therma-FIT Pullover Hoodie Kids", "Nike Revolution 7 Kids",
    "Nike Air Max INTRLK Kids",       "Nike Spark Flyease Kids",        "Nike Team Hustle Kids",
    "Nike Free RN Flyknit Kids",      "Nike Interact Run Kids",         "Nike Pegasus 41 Kids",
    "Nike Summer Essentials Kids",    "Nike Air Jordan 1 Mid Kids",     "Nike Dunk High Kids",
    "Nike Air Max 90 LTR Kids",       "Nike Blazer Mid '77 Kids",       "Nike Court Vision Mid Kids",
    "Nike Air Max Motif Kids",        "Nike Huarache Run Kids",         "Nike MD Valiant Kids",
    "Nike Tanjun EasyOn Kids",        "Nike Wearallday Kids",           "Nike Air Zoom Crossover Kids",
    "Nike Swoosh T-Shirt Kids",       "Nike Dri-FIT Academy Pants Kids", "Nike Sportswear Windrunner Kids",
    "Nike Club Jogger Pants Kids",    "Nike Pro Compression Top Kids",  "Nike Everyday Cushioned Socks Kids",
    "Nike Brasilia Backpack Kids",    "Nike Sunray Protect Sandal Kids", "Nike Flex Experience Run Kids",
    "Nike Downshifter 13 Kids",       "Nike Star Runner 3 Kids",        "Nike Air More Uptempo Kids",
    "Nike LeBron Witness Kids",       "Nike Kyrie Infinity Kids",       "Nike KD 16 Kids",
    "Nike Zoom Freak 5 Kids",         "Nike Court Borough Mid Kids",    "Nike Air Max SC Kids",
  ],
};

// ─── item_type detect ─────────────────────────────────────────────────────────
function detectItemType(name) {
  const n = name.toLowerCase();
  if (/shoes?|air max|dunk|force 1|blazer|pegasus|vaporfly|metcon|runner|flyknit|vomero|jordan|huarache|waffle|revolution|pico|borough|dynamo|interact|invincible|structure|tempo|court|v2k|lebron|kyrie|pg\s|gt cut|sb dunk/.test(n)) return 'shoes';
  if (/hoodie|sweatshirt/.test(n)) return 'hoodie';
  if (/jacket|windrunner|puffer/.test(n)) return 'jacket';
  if (/shirt|tee|polo/.test(n)) return 'shirt';
  if (/bra|tank|top/.test(n)) return 'apparel';
  if (/legging|tight|pant|jogger/.test(n)) return 'pants';
  if (/short/.test(n)) return 'shorts';
  if (/sock/.test(n)) return 'socks';
  if (/cap|hat|beanie/.test(n)) return 'cap';
  if (/bag|backpack|duffel/.test(n)) return 'bags';
  if (/mat|rope|band|equipment|yoga|resist/.test(n)) return 'equipment';
  return 'shoes';
}

// ─── Gia ngau nhien ───────────────────────────────────────────────────────────
function generatePrice(itemType, category) {
  const ranges = {
    shoes: [1800, 4500], hoodie: [1200, 3500], jacket: [1500, 5500],
    shirt: [600, 1400],  pants:  [900, 2800],  shorts: [600, 1400],
    socks: [200, 500],   cap:    [350, 900],   bags:   [800, 2500],
    equipment: [400, 1500], apparel: [600, 2000],
  };
  const [min, max] = ranges[itemType] || [800, 2500];
  const factor = category === 'kids' ? 0.8 : 1.0;
  return Math.floor((Math.random() * (max - min) + min) * factor / 100) * 100;
}

const COLORS   = ['Black', 'White', 'Gray', 'Navy', 'Red', 'Blue', 'Green', 'Orange'];
const pick     = arr => arr[Math.floor(Math.random() * arr.length)];
const randRate = ()  => parseFloat((Math.random() * 1.5 + 3.5).toFixed(1));

// ─── Quet anh trong thu muc (chi cap thu muc goc, khong de quy) ──────────────
function scanImages(category) {
  const dir = path.join(ASSETS, category);
  if (!fs.existsSync(dir)) return [];

  const EXT     = new Set(['.jpg', '.jpeg', '.png', '.webp']);
  const MIN_KB  = 8 * 1024; // bo anh < 8KB

  return fs.readdirSync(dir)
    .filter(f => {
      const ext  = path.extname(f).toLowerCase();
      const stat = fs.statSync(path.join(dir, f));
      return EXT.has(ext) && stat.isFile() && stat.size >= MIN_KB;
    })
    .map(f => ({
      filename: f,
      webPath:  `/assets/products/${category}/${f}`,
      sizeKB:   Math.round(fs.statSync(path.join(dir, f)).size / 1024),
    }));
}

// ─── MySQL connection ─────────────────────────────────────────────────────────
async function getDb() {
  return mysql.createConnection({
    host: 'localhost', user: 'root', password: '', database: 'nike_store',
  });
}

async function getExistingImages(db) {
  const [rows] = await db.query('SELECT image FROM products');
  return new Set(rows.map(r => r.image));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.cyan}${'='.repeat(60)}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  Nike Local Image Importer v2${C.reset}`);
  if (DRY_RUN) console.log(`${C.yellow}  [DRY RUN] Chi xem, khong insert vao DB${C.reset}`);
  if (FORCE)   console.log(`${C.magenta}  [FORCE]   Bo qua kiem tra trung lap${C.reset}`);
  console.log(`${C.cyan}${'='.repeat(60)}${C.reset}\n`);

  let db;
  try {
    db = await getDb();
    info('Ket noi MySQL nike_store thanh cong');
  } catch (e) {
    fail(`Khong ket noi duoc MySQL: ${e.message}`);
    fail('Hay chac chan backend dang chay (port 3306)');
    process.exit(1);
  }

  const existingImages = FORCE ? new Set() : await getExistingImages(db);
  info(`Anh da co trong DB: ${existingImages.size}`);

  const categories = CAT_ARG ? [CAT_ARG] : ['men', 'women', 'kids'];
  const stats = { inserted: 0, skipped: 0, failed: 0, total: 0 };

  for (const category of categories) {
    console.log(`\n${C.bold}${C.cyan}  ---- ${category.toUpperCase()} ----------------------------------------${C.reset}`);

    const images = scanImages(category);
    if (images.length === 0) {
      warn(`Khong tim thay anh nao trong: assets/products/${category}/`);
      continue;
    }
    info(`Tim thay ${images.length} anh trong '${category}'`);

    const names = PRODUCT_NAMES[category] || [];

    for (let i = 0; i < images.length; i++) {
      const { filename, webPath, sizeKB } = images[i];
      stats.total++;

      if (!FORCE && existingImages.has(webPath)) {
        skip(`Da co trong DB: ${filename}`);
        stats.skipped++;
        continue;
      }

      const productName = names[i] || `Nike ${category.charAt(0).toUpperCase() + category.slice(1)} Product ${i + 1}`;
      const itemType    = detectItemType(productName);
      const price       = generatePrice(itemType, category);
      const sizes       = category === 'kids' ? '30,31,32,33,34,35,36' : '37,38,39,40,41,42,43,44';

      if (DRY_RUN) {
        ok(`[DRY] "${productName}" | ${webPath} | ${price.toLocaleString()}d | ${itemType} | ${sizeKB}KB`);
        stats.inserted++;
        continue;
      }

      try {
        const sql = `
          INSERT INTO products
            (title, price, image, category, rating, color, sizes, item_type,
             is_new, discount_percent, description, stock)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await db.execute(sql, [
          productName,
          price,
          webPath,
          category,
          randRate(),
          pick(COLORS),
          sizes,
          itemType,
          Math.random() < 0.3 ? 1 : 0,
          pick([0, 0, 0, 5, 10, 15, 20]),
          `${productName} - Thiet ke cao cap tu Nike, hieu suat vuot troi va phong cach hien dai.`,
          Math.floor(Math.random() * 150) + 30,
        ]);

        existingImages.add(webPath);
        ok(`Inserted: "${productName}" -> ${webPath} (${sizeKB}KB)`);
        stats.inserted++;
      } catch (e) {
        fail(`Failed: "${productName}" -- ${e.message}`);
        stats.failed++;
      }
    }
  }

  // Ket qua
  console.log(`\n${C.bold}${C.cyan}${'='.repeat(60)}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  KET QUA${C.reset}`);
  console.log(`${C.cyan}${'='.repeat(60)}${C.reset}`);
  console.log(`${C.green}  Inserted : ${stats.inserted}${C.reset}`);
  console.log(`${C.gray}  Skipped  : ${stats.skipped}${C.reset}`);
  console.log(`${C.red}  Failed   : ${stats.failed}${C.reset}`);
  console.log(`${C.cyan}  Total    : ${stats.total}${C.reset}`);
  console.log(`${C.cyan}${'='.repeat(60)}${C.reset}\n`);

  console.log(`${C.bold}  Anh trong thu muc:${C.reset}`);
  for (const cat of categories) {
    const dir  = path.join(ASSETS, cat);
    if (!fs.existsSync(dir)) continue;
    const imgs = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
    console.log(`${C.gray}  ${cat}/  ->  ${imgs.length} files${C.reset}`);
  }
  console.log();

  await db.end();
}

main().catch(err => {
  fail(`Fatal: ${err.message}`);
  process.exit(1);
});
