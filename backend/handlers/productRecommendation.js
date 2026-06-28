const db = require('../db');

// Cap only applies when NO specific category can be detected (i.e. a fully
// generic "recommend something for me" with no product type mentioned).
// When a category IS detected, we fetch ALL matching products for that
// category + skin type -- no cap -- since the whole point is giving the
// model real, complete options to choose from rather than an arbitrary
// top-N slice that might exclude the one thing the user actually asked for.
const GENERIC_FALLBACK_LIMIT = 5;

// Maps the words a user might actually type to the REAL category values
// stored in products.category. Multiple keywords can map to the same
// category (e.g. "face wash" and "cleanser" both mean "cleanser") -- this
// is necessary because customers don't know or use our internal category
// names, they use everyday language.
const CATEGORY_KEYWORDS = {
    cleanser: ['cleanser', 'face wash', 'facewash', 'wash', 'cleansing'],
    serum: ['serum'],
    moisturizer: ['moisturizer', 'moisturiser', 'cream', 'lotion'],
    sunscreen: ['sunscreen', 'sunblock', 'spf', 'sun cream'],
    toner: ['toner', 'toning'],
    mask: ['mask', 'masque'],
    mist: ['mist', 'spray'],
    treatment: ['treatment', 'spot treatment', 'blemish'],
    haircare: ['hair', 'haircare', 'shampoo', 'conditioner'],
    makeup: ['makeup', 'make-up', 'lipstick', 'lip balm', 'mascara'],
};

/**
 * Detects which REAL product category (if any) the user's message is
 * asking about, based on everyday keywords. Returns the category string
 * exactly as stored in the database, or null if no category is detectable
 * (e.g. a generic "recommend something for me").
 *
 * THIS IS THE CORE FIX for a real observed bug: the old version only ever
 * filtered by skin type, then took a top-5-by-rating slice across ALL
 * categories. That meant asking for "face wash" vs "serum" vs "sunscreen"
 * all hit the exact same query and got the exact same 5 products back --
 * any category-specific accuracy only ever happened by Gemini guessing at
 * the label, not because the data was actually filtered. If the relevant
 * product for what the user asked about didn't happen to make the
 * across-the-board top-5 cut, it was invisible to the model entirely, even
 * though it existed in the catalog.
 */
function detectRequestedCategory(message) {
    if (!message) return null;
    const msgLower = message.toLowerCase();

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (keywords.some((kw) => msgLower.includes(kw))) {
            return category;
        }
    }
    return null;
}

function handleProductRecommendation(userId, extraParams = {}) {
    const message = extraParams.message || "";

    const user = db.prepare('SELECT skin_type FROM users WHERE user_id = ?').get(userId);
    if (!user) {
        return "User not found. Recommend our general best-sellers, suitable for all skin types.";
    }
    const skinType = user.skin_type;

    const requestedCategory = detectRequestedCategory(message);

    let products;
    if (requestedCategory) {
        // Category detected: fetch ALL matching products for this category
        // + skin type, no limit. This is the actual fix -- "serum" gets
        // every real serum that fits their skin type, not a slice of
        // whatever happened to rank highest across the whole catalog.
        products = db.prepare(`
            SELECT name, price, rating, description 
            FROM products 
            WHERE category = ?
              AND (skin_type_fit LIKE ? OR skin_type_fit LIKE '%all%')
            ORDER BY rating DESC
        `).all(requestedCategory, `%${skinType}%`);
    } else {
        // No specific category detectable -- fall back to the old
        // general "top picks across everything" behavior, still capped,
        // since this is a genuinely open-ended request, not a category
        // search the cap could be hiding real options from.
        products = db.prepare(`
            SELECT name, price, rating, description 
            FROM products 
            WHERE skin_type_fit LIKE ? OR skin_type_fit LIKE '%all%'
            ORDER BY rating DESC 
            LIMIT ?
        `).all(`%${skinType}%`, GENERIC_FALLBACK_LIMIT);
    }

    if (products.length === 0) {
        const categoryNote = requestedCategory ? ` in the "${requestedCategory}" category` : '';
        return `Found no products${categoryNote} that match ${skinType} skin. Let the customer know honestly that there's currently nothing in that category for their skin type, rather than suggesting something that doesn't fit.`;
    }

    const scopeNote = requestedCategory
        ? `The customer specifically asked about "${requestedCategory}" products. These are ALL of the real ${requestedCategory} products available that fit their skin type -- not a partial list.`
        : `The customer didn't ask about a specific product category, so these are general top picks across the catalog for their skin type.`;

    let context = `VERIFIED ACCOUNT DATA: this customer's skin type is recorded as "${skinType}" in their profile. This is a confirmed fact from their account, not a guess -- if the user questions or disputes this (e.g. "you don't know my skin type"), confidently affirm that their profile shows ${skinType} skin and continue helping, rather than backing down or claiming you don't have this information.\n\n` +
        `${scopeNote} These are the ONLY ${products.length} real products available to recommend right now -- do not mention, suggest, or invent ANY product not in this exact list, even if asked for "other options" or "more choices". If the user wants more than what's listed here, say these are all the current matches rather than making up additional products:\n`;
    products.forEach((p, i) => {
        context += `${i + 1}. ${p.name} (Price: $${p.price.toFixed(2)}, Rating: ${p.rating}/5) - ${p.description}\n`;
    });
    console.log(context.trim());
    
    return context.trim();
}

/**
 * Returns the names of products THIS handler is about to suggest, so
 * server.js can add them to conversation state. Mirrors the SAME
 * category-detection logic as the main handler so memory stays consistent
 * with what was actually shown to the user.
 */
function getRecommendedProductNames(userId, extraParams = {}) {
    const message = extraParams.message || "";
    const user = db.prepare('SELECT skin_type FROM users WHERE user_id = ?').get(userId);
    if (!user) return [];

    const requestedCategory = detectRequestedCategory(message);

    let products;
    if (requestedCategory) {
        products = db.prepare(`
            SELECT name FROM products 
            WHERE category = ? AND (skin_type_fit LIKE ? OR skin_type_fit LIKE '%all%')
            ORDER BY rating DESC
        `).all(requestedCategory, `%${user.skin_type}%`);
    } else {
        products = db.prepare(`
            SELECT name FROM products 
            WHERE skin_type_fit LIKE ? OR skin_type_fit LIKE '%all%'
            ORDER BY rating DESC LIMIT ?
        `).all(`%${user.skin_type}%`, GENERIC_FALLBACK_LIMIT);
    }

    return products.map((p) => p.name);
}

module.exports = handleProductRecommendation;
module.exports.getRecommendedProductNames = getRecommendedProductNames;