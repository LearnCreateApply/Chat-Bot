const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'beauty_store.db');

// Delete existing DB if it exists to start fresh
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

const db = new Database(dbPath);

console.log('Creating database schema...');

// Create Tables
db.exec(`
  CREATE TABLE users (
    user_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    skin_type TEXT,
    email TEXT
  );

  CREATE TABLE products (
    product_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    skin_type_fit TEXT,
    description TEXT,
    rating REAL,
    stock INTEGER
  );

  CREATE TABLE orders (
    order_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    order_date TEXT NOT NULL,
    eta TEXT,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (product_id) REFERENCES products(product_id)
  );

  CREATE TABLE returns (
    return_id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL,
    reason TEXT,
    status TEXT NOT NULL,
    requested_date TEXT NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
  );

  CREATE TABLE payments (
    payment_id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL,
    method TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
  );
`);

console.log('Inserting seed data...');

// Insert Users (4 users covering skin types) -- UNCHANGED, per explicit
// earlier decision to keep the 4-user dataset for now.
const insertUser = db.prepare('INSERT INTO users (user_id, name, skin_type, email) VALUES (?, ?, ?, ?)');
insertUser.run(1, 'Alice Smith', 'oily', 'alice@example.com');
insertUser.run(2, 'Bob Johnson', 'dry', 'bob@example.com');
insertUser.run(3, 'Chloe Davis', 'combination', 'chloe@example.com');
insertUser.run(4, 'Diana Prince', 'sensitive', 'diana@example.com');

// Insert Products (~20 products) -- UNCHANGED
const insertProduct = db.prepare('INSERT INTO products (product_id, name, category, price, skin_type_fit, description, rating, stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const products = [
  [1, 'Gentle Foaming Cleanser', 'cleanser', 15.99, 'all', 'A soft foaming cleanser that removes dirt without stripping moisture.', 4.5, 100],
  [2, 'Salicylic Acid Gel Wash', 'cleanser', 18.00, 'oily,combination', 'Deep cleans pores and controls excess sebum.', 4.7, 80],
  [3, 'Hydrating Milk Cleanser', 'cleanser', 16.50, 'dry,sensitive', 'Milky formula that soothes while cleaning.', 4.6, 90],
  [4, 'Vitamin C Brightening Serum', 'serum', 28.00, 'all', 'Antioxidant-rich serum for a radiant glow.', 4.8, 120],
  [5, 'Hyaluronic Acid 2% + B5', 'serum', 12.00, 'dry,combination', 'Intense hydration for plump skin.', 4.9, 200],
  [6, 'Niacinamide 10% Serum', 'serum', 14.50, 'oily,combination', 'Reduces blemishes and balances oil production.', 4.7, 150],
  [7, 'Soothing Centella Ampoule', 'serum', 22.00, 'sensitive', 'Calms redness and repairs skin barrier.', 4.8, 60],
  [8, 'Lightweight Oil-Free Gel', 'moisturizer', 20.00, 'oily', 'Mattifying finish that locks in moisture.', 4.4, 110],
  [9, 'Rich Ceramide Cream', 'moisturizer', 25.00, 'dry,sensitive', 'Thick cream protecting against moisture loss.', 4.9, 85],
  [10, 'Daily Balancing Lotion', 'moisturizer', 22.00, 'combination', 'Perfect middle ground for combination skin.', 4.5, 95],
  [11, 'SPF 50 Watery Sun Gel', 'sunscreen', 24.00, 'oily,combination', 'Invisible finish with no white cast.', 4.8, 130],
  [12, 'Mineral Sunscreen SPF 30', 'sunscreen', 26.00, 'sensitive,dry', 'Gentle physical UV protection.', 4.3, 70],
  [13, 'AHA/BHA Exfoliating Toner', 'toner', 18.50, 'oily,combination', 'Gently sweeps away dead skin cells.', 4.6, 100],
  [14, 'Rosewater Hydrating Toner', 'toner', 15.00, 'dry,sensitive', 'Soothing floral water to prep skin.', 4.7, 90],
  [15, 'Clay Purifying Mask', 'mask', 19.00, 'oily', 'Draws out impurities and tightens pores.', 4.4, 50],
  [16, 'Overnight Sleeping Mask', 'mask', 24.00, 'dry', 'Wake up to intensely hydrated skin.', 4.8, 60],
  [17, 'Refreshing Facial Mist', 'mist', 12.00, 'all', 'Instant hydration boost on the go.', 4.2, 120],
  [18, 'Spot Treatment Gel', 'treatment', 16.00, 'oily,combination', 'Targeted action for sudden breakouts.', 4.6, 80],
  [19, 'Argan Hair Oil', 'haircare', 22.00, 'all', 'Tames frizz and adds shine.', 4.7, 100],
  [20, 'Tinted Lip Balm', 'makeup', 10.00, 'all', 'Moisturizing with a sheer wash of color.', 4.5, 150],

  // ---- EXPANSION: 50+ additional products using REAL, currently popular
  // brand names and formulas (researched via web search), spanning all 10
  // categories in the schema. IDs start at 21 to avoid colliding with the
  // original 1-20, which existing orders/payments/returns reference by
  // product_id -- changing those would break foreign keys.
  //
  // PRICING NOTE: exact current retail prices weren't available for every
  // single item researched. Prices below are realistic estimates consistent
  // with each product's known market tier (e.g. drugstore staples ~$10-20,
  // mid-tier dermatologist-recommended ~$20-35, prestige/luxury $40+) based
  // on the general price ranges found during research, not verbatim
  // confirmed figures for each SKU.

  // --- Cleansers ---
  [21, 'CeraVe Foaming Facial Cleanser', 'cleanser', 16.99, 'oily,combination', 'Drugstore staple with ceramides and niacinamide; removes excess oil without disrupting the skin barrier.', 4.7, 200],
  [22, 'La Roche-Posay Toleriane Hydrating Cleanser', 'cleanser', 17.99, 'dry,sensitive', 'Dermatologist-recommended gentle cleanser with ceramides and niacinamide for reactive skin.', 4.8, 150],
  [23, 'The Inkey List Hydrating Cream-to-Milk Cleanser', 'cleanser', 13.99, 'dry,sensitive', 'Rich, affordable cream-to-milk formula that smooths over skin and feels instantly calming.', 4.5, 130],
  [24, 'Bioderma Sensibio H2O Micellar Water', 'cleanser', 19.99, 'all,sensitive', 'Top-rated micellar water with a minimal ingredient list, gentle enough for daily makeup removal.', 4.9, 220],
  [25, "Ursa Major Fantastic Face Wash", 'cleanser', 46.00, 'all', 'Natural foaming gel cleanser with AHA exfoliation; brightens without stripping the skin.', 4.6, 60],

  // --- Serums ---
  [26, 'The Ordinary Niacinamide 10% + Zinc 1%', 'serum', 12.50, 'oily,combination', 'Cult-favorite affordable serum that regulates sebum and visibly reduces blemishes.', 4.6, 300],
  [27, 'The Ordinary Glycolic Acid 7% Exfoliating Toner', 'toner', 11.00, 'oily,combination', 'Top-selling exfoliating toner that improves texture and brightness with gentle AHA.', 4.5, 250],
  [28, 'Anua PDRN Collagen Glow Facial Serum', 'serum', 24.00, 'all', 'Fast-rising K-beauty serum combining PDRN and collagen-support actives for radiance.', 4.7, 90],
  [29, "Kiehl's Midnight Recovery Concentrate", 'serum', 49.00, 'dry,sensitive', 'Iconic overnight facial oil blend that restores and replenishes skin while you sleep.', 4.7, 75],
  [30, 'Rhode Peptide Glazing Milk', 'toner', 29.00, 'all', "Trending milky toner with ceramides, magnesium, zinc, and copper for a dewy 'glazed' finish.", 4.6, 110],

  // --- Moisturizers ---
  [31, 'CeraVe Moisturizing Cream', 'moisturizer', 19.99, 'dry,sensitive', 'Dermatologist-favorite barrier cream with 3 essential ceramides and hyaluronic acid.', 4.8, 240],
  [32, 'CeraVe Oil Control Gel-Cream', 'moisturizer', 18.99, 'oily,combination', 'Niacinamide and licorice root regulate oil while ceramides maintain the skin barrier.', 4.6, 180],
  [33, 'Neutrogena Hydro Boost Water Gel', 'moisturizer', 21.99, 'oily,combination', 'Hyaluronic acid gel-cream that absorbs quickly with a plump, dewy, non-sticky finish.', 4.7, 200],
  [34, 'Aveeno Calm + Restore Moisturizer', 'moisturizer', 16.99, 'sensitive,combination', 'Salicylic acid and soy complex hydrate while calming redness and clearing pores.', 4.4, 140],
  [35, 'Prequel Half & Half Peptides + Ceramides', 'moisturizer', 24.00, 'dry,sensitive', "Dermatologist-recommended pick that pairs humectants with sealing ceramides for all-day comfort.", 4.6, 95],
  [36, 'Vanicream Daily Facial Moisturizer', 'moisturizer', 14.99, 'sensitive,dry', 'Fragrance-free, dye-free formula designed for the most reactive and easily irritated skin.', 4.7, 160],

  // --- Sunscreens ---
  [37, 'La Roche-Posay Double Repair SPF 30', 'sunscreen', 26.99, 'combination,oily', 'Daily moisturizer with built-in broad-spectrum SPF 30, ceramides, and niacinamide.', 4.7, 170],
  [38, 'EltaMD UV Clear Broad-Spectrum SPF 46', 'sunscreen', 41.00, 'sensitive,combination', 'Niacinamide-infused mineral-hybrid sunscreen frequently recommended by dermatologists for reactive skin.', 4.8, 130],
  [39, 'Dew Guard Milky Sun Serum SPF 50', 'sunscreen', 28.00, 'dry,combination', 'Korean-style milky sunscreen with up to 80 minutes water resistance and a color-changing UV-reactive cap.', 4.6, 100],
  [40, 'Mineral Sun Glow Broad Spectrum SPF', 'sunscreen', 34.00, 'sensitive,all', 'Tinted mineral sunscreen with zero chalky cast and a subtle radiant finish.', 4.5, 85],

  // --- Toners ---
  [41, "Kiehl's Ultra Facial Toner", 'toner', 24.00, 'dry,sensitive', 'Alcohol-free hydrating toner that preps and plumps skin without disrupting its natural balance.', 4.6, 120],
  [42, 'CosRx AHA/BHA Clarifying Treatment Toner', 'toner', 22.00, 'oily,combination', 'Dual-acid exfoliating toner that refines texture and helps prevent breakouts.', 4.5, 140],
  [43, "Paula's Choice Skin Balancing Toner", 'toner', 23.00, 'combination,oily', 'Niacinamide-forward balancing toner that controls oil and minimizes the look of pores.', 4.6, 110],
  [44, 'Medicube Zero Pore Pads 2.0', 'toner', 25.00, 'oily,combination', "Amazon's #1 best-selling toner pads in 2026; pore-refining pads for daily use.", 4.7, 300],

  // --- Masks ---
  [45, 'Biodance Bio-Collagen Real Deep Mask', 'mask', 28.00, 'all,dry', 'Viral hydrogel collagen mask that delivers an intense overnight hydration boost.', 4.8, 200],
  [46, '111SKIN Celestial Black Diamond Eye Mask', 'mask', 95.00, 'all,sensitive', 'Luxury depuffing under-eye mask combining seaweed extracts with vitamin E and CoQ10.', 4.7, 40],
  [47, 'Valmont Hydra3 Regenetic Mask', 'mask', 145.00, 'dry,sensitive', 'Prestige Swiss hydration mask powered by Triple DNA salmon complex and fermented gentian.', 4.8, 25],
  [48, 'Hero Cosmetics Mighty Patch', 'treatment', 12.99, 'oily,combination', "Best-selling hydrocolloid acne patches that flatten blemishes overnight.", 4.8, 350],

  // --- Treatments ---
  [49, 'Major Fade Disco Block Discoloration Treatment', 'treatment', 36.00, 'all,combination', 'Dr. Idriss-formulated treatment that targets discoloration with a lightweight, serum-like feel.', 4.6, 70],
  [50, 'The Ordinary Salicylic Acid 2% Solution', 'treatment', 9.50, 'oily,combination', 'Affordable, highly-rated BHA solution for clearing congested pores and preventing breakouts.', 4.5, 280],

  // --- Mists ---
  [51, 'Mario Badescu Facial Spray with Aloe, Herbs and Rosewater', 'mist', 14.00, 'all', 'Iconic cult-favorite hydrating setting mist used by generations of skincare fans.', 4.7, 190],
  [52, 'Caudalie Grape Water Hydrating Toner Mist', 'mist', 19.00, 'all,sensitive', 'Antioxidant-rich grape water mist that refreshes and hydrates throughout the day.', 4.6, 100],

  // --- Haircare ---
  [53, 'OUAI Bond Repair Balm', 'haircare', 32.00, 'all', 'Salon-quality leave-in treatment that restores the hair bond barrier in just three minutes.', 4.7, 90],
  [54, 'K18 Biomimetic Hairscience Mask', 'haircare', 75.00, 'all', "Proprietary peptide treatment clinically shown to reverse hair damage in four minutes.", 4.8, 60],
  [55, 'Sea buckthorn Repair Hair Mask', 'haircare', 28.00, 'all', "Best-selling fruity hair mask powered by sea buckthorn berry for damaged, dry hair.", 4.6, 80],
  [56, 'Nizoral Anti-Dandruff Shampoo', 'haircare', 16.99, 'all', "Top-10 bestselling medicated shampoo that treats and prevents stubborn dandruff.", 4.5, 220],

  // --- Makeup ---
  [57, 'Rare Beauty Soft Pinch Liquid Blush', 'makeup', 23.00, 'all', 'Best-selling weightless liquid blush that blends seamlessly for a natural flush.', 4.8, 260],
  [58, 'Maybelline Lash Sensational Sky High Mascara', 'makeup', 12.99, 'all', "Top-5 bestselling mascara nationwide for dramatic length and lift.", 4.6, 400],
  [59, 'Patrick Ta Major Glow Highlighter', 'makeup', 38.00, 'all', 'Award-winning cream highlighter for an intense, lit-from-within glow.', 4.7, 130],
  [60, 'Glossier Cloud Paint', 'makeup', 20.00, 'all', 'Cult-favorite gel-cream blush with a dewy, second-skin finish.', 4.6, 210],
  [61, 'Pat McGrath Lip Fetish Lip Liner & Lipstick Duo', 'makeup', 38.00, 'all', "Rich, bleed-proof lip duo infused with avocado oil and purslane for all-night wear.", 4.7, 70],

  // --- More moisturizers / serums for extra depth ---
  [62, 'Olay Regenerist Micro-Sculpting Cream', 'moisturizer', 28.99, 'dry,combination', 'Long-running bestseller with amino-peptides and hyaluronic acid for visibly firmer skin.', 4.6, 175],
  [63, "L'Oreal Revitalift Hyaluronic Acid Serum", 'serum', 22.99, 'all,dry', 'Drugstore dermatologist-developed serum with pure hyaluronic acid for deep hydration.', 4.6, 190],
  [64, 'Augustinus Bader The Rich Cream', 'moisturizer', 280.00, 'dry,sensitive', "Prestige cream built on Bader's proprietary TFC8 complex for intensive skin renewal.", 4.7, 30],
  [65, 'Glow Recipe Watermelon Glow Niacinamide Dew Drops', 'serum', 36.00, 'all,combination', 'Viral glow-boosting drops combining niacinamide with watermelon extract for radiant skin.', 4.6, 150],

  // --- Tinted moisturizer / SPF hybrid for completeness ---
  [66, 'Supergoop Glowscreen SPF 40', 'sunscreen', 38.00, 'all,combination', 'Best-selling glow-boosting sunscreen with hyaluronic acid and a radiant, dewy finish.', 4.6, 160],
  [67, 'Tatcha The Dewy Skin Cream', 'moisturizer', 68.00, 'dry,sensitive', 'Prestige Japanese-beauty-inspired cream with Okinawa algae for plump, dewy skin.', 4.7, 70],

  // --- A couple more cleansers/treatments to round out variety ---
  [68, 'Cetaphil Gentle Skin Cleanser', 'cleanser', 14.99, 'sensitive,dry', 'Dermatologist-trusted classic cleanser, fragrance-free and suitable for the most sensitive skin.', 4.7, 260],
  [69, "Paula's Choice 2% BHA Liquid Exfoliant", 'treatment', 34.00, 'oily,combination', 'Cult-favorite leave-on exfoliant that unclogs pores and smooths texture over time.', 4.8, 200],
  [70, 'Differin Adapalene Gel 0.1%', 'treatment', 14.99, 'oily,combination', 'OTC retinoid gel widely recommended by dermatologists for clearing and preventing acne.', 4.6, 230],

  // --- Final additions for round numbers across remaining categories ---
  [71, 'Summer Fridays Lip Butter Balm', 'makeup', 24.00, 'all', 'Best-selling nourishing lip balm with shea butter and coconut oil for soft, hydrated lips.', 4.7, 240],
  [72, 'Living Proof No Frizz Leave-In Conditioner', 'haircare', 28.00, 'all', 'Lightweight leave-in treatment that controls frizz and adds shine without weighing hair down.', 4.5, 120],
  [73, 'Innisfree Green Tea Hyaluronic Toner', 'toner', 18.00, 'oily,combination', 'Lightweight K-beauty toner combining green tea antioxidants with hydrating hyaluronic acid.', 4.5, 130],
  [74, 'Drunk Elephant Protini Polypeptide Cream', 'moisturizer', 68.00, 'all,combination', 'Protein moisturizer that firms and hydrates with signal peptides and amino acids.', 4.6, 90],
  [75, 'Skin1004 Centella Ampoule', 'serum', 21.00, 'sensitive,combination', 'Beloved Korean centella-based ampoule that calms redness and strengthens the skin barrier.', 4.7, 140],
];
products.forEach(p => insertProduct.run(...p));

// ---------- Orders ----------
// EXPANDED: each of the 4 users now has 3-4 orders instead of 1-2, covering
// a mix of statuses (delivered, shipped, processing, cancelled) and
// DIFFERENT product categories per user, so category-aware recommendation
// and order-by-product-name lookups have real variety to be tested against.
//
// DATE BUG FIX: the previous version had orders #101 and #104 marked
// "delivered" with an ETA of '2026-10-05' / '2026-11-15' -- months AFTER
// their order_date of '2023-10-01' / '2023-11-10'. A delivered order can't
// have a future ETA, and dates from 2023 don't make sense alongside the
// rest of the data which is all set in 2026. All dates below are
// internally consistent: delivered orders have an ETA shortly after
// order_date, shipped/processing orders have near-future ETAs relative to
// "today" (treated as 2026-06-19 for this dataset), cancelled orders have
// no ETA.
const insertOrder = db.prepare('INSERT INTO orders (order_id, user_id, product_id, status, order_date, eta) VALUES (?, ?, ?, ?, ?, ?)');

// --- Alice Smith (user 1, oily) ---
insertOrder.run(101, 1, 6, 'delivered', '2026-05-01', '2026-05-06');   // Niacinamide 10% Serum
insertOrder.run(102, 1, 2, 'processing', '2026-06-17', '2026-06-22'); // Salicylic Acid Gel Wash
insertOrder.run(108, 1, 11, 'delivered', '2026-04-10', '2026-04-15');  // SPF 50 Watery Sun Gel
insertOrder.run(109, 1, 18, 'shipped', '2026-06-14', '2026-06-19');    // Spot Treatment Gel

// --- Bob Johnson (user 2, dry) ---
insertOrder.run(103, 2, 5, 'shipped', '2026-06-15', '2026-06-20');     // Hyaluronic Acid 2% + B5
insertOrder.run(104, 2, 9, 'delivered', '2026-05-12', '2026-05-17');   // Rich Ceramide Cream
insertOrder.run(110, 2, 16, 'delivered', '2026-03-20', '2026-03-25');  // Overnight Sleeping Mask
insertOrder.run(111, 2, 12, 'cancelled', '2026-06-05', null);          // Mineral Sunscreen SPF 30

// --- Chloe Davis (user 3, combination) ---
insertOrder.run(105, 3, 11, 'cancelled', '2026-06-12', null);          // SPF 50 Watery Sun Gel
insertOrder.run(107, 3, 4, 'delivered', '2026-06-01', '2026-06-06');   // Vitamin C Brightening Serum
insertOrder.run(112, 3, 10, 'delivered', '2026-04-22', '2026-04-27');  // Daily Balancing Lotion
insertOrder.run(113, 3, 13, 'processing', '2026-06-18', '2026-06-23'); // AHA/BHA Exfoliating Toner

// --- Diana Prince (user 4, sensitive) ---
insertOrder.run(106, 4, 7, 'processing', '2026-06-18', '2026-06-24');  // Soothing Centella Ampoule
insertOrder.run(114, 4, 3, 'delivered', '2026-05-08', '2026-05-13');   // Hydrating Milk Cleanser
insertOrder.run(115, 4, 12, 'shipped', '2026-06-16', '2026-06-21');    // Mineral Sunscreen SPF 30

// ---------- Returns ----------
// EXPANDED slightly: kept the original 2, added one more so more than one
// user has return history to test against (previously only orders 104 and
// 107 had returns at all).
const insertReturn = db.prepare('INSERT INTO returns (return_id, order_id, reason, status, requested_date) VALUES (?, ?, ?, ?, ?)');
insertReturn.run(201, 104, 'Allergic reaction', 'approved', '2026-05-18');
insertReturn.run(202, 107, 'Wrong item sent', 'pending', '2026-06-08');
insertReturn.run(203, 110, 'Changed my mind', 'rejected', '2026-03-27');

// ---------- Payments ----------
// EXPANDED: every order above now has a corresponding payment (previously
// orders 105, 107 had no payment row at all, and order 103 had 2 payments
// tied to it while several others had none). One deliberate failed+retry
// pair kept (order 103) to keep exercising "most recent payment for an
// order" logic.
const insertPayment = db.prepare('INSERT INTO payments (payment_id, order_id, amount, status, method) VALUES (?, ?, ?, ?, ?)');
insertPayment.run(301, 101, 14.50, 'success', 'card');
insertPayment.run(302, 102, 18.00, 'success', 'card');
insertPayment.run(303, 103, 12.00, 'failed', 'UPI');   // Simulating a failed payment scenario
insertPayment.run(304, 103, 12.00, 'success', 'card'); // Retried and succeeded
insertPayment.run(305, 104, 25.00, 'refunded', 'card'); // Tied to the approved return
insertPayment.run(306, 106, 22.00, 'success', 'card');
insertPayment.run(307, 105, 24.00, 'refunded', 'UPI');  // cancelled order, refunded
insertPayment.run(308, 107, 28.00, 'success', 'card');
insertPayment.run(309, 108, 24.00, 'success', 'card');
insertPayment.run(310, 109, 16.00, 'success', 'UPI');
insertPayment.run(311, 110, 24.00, 'success', 'card');
insertPayment.run(312, 111, 26.00, 'refunded', 'card'); // cancelled order, refunded
insertPayment.run(313, 112, 22.00, 'success', 'card');
insertPayment.run(314, 113, 18.50, 'success', 'UPI');
insertPayment.run(315, 114, 16.50, 'success', 'card');
insertPayment.run(316, 115, 26.00, 'success', 'card');

console.log('Database setup complete! SQLite file generated at:', dbPath);
console.log(`Seeded 4 users, ${products.length} products, 15 orders, 3 returns, 16 payments.`);
db.close();