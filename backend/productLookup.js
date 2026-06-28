const db = require('./db');

/**
 * Given a list of product NAMES (e.g. from conversation memory), fetches
 * the full, CURRENT details for each from the database -- price, rating,
 * description, category.
 *
 * WHY RE-FETCH INSTEAD OF STORING FULL DETAILS IN MEMORY DIRECTLY: if we
 * stored price/rating/description in conversationState.js at the moment a
 * product was first mentioned, that snapshot could go stale if the
 * underlying data ever changed later in the same session (e.g. a price
 * update). Memory only ever stores the product NAME as an index; this
 * function re-fetches fresh, current facts from the database every time
 * they're actually needed -- keeping the "Gemini only ever sees freshly
 * DB-verified data" property intact with no new staleness risk.
 *
 * Returns only products that still exist (silently skips any name that no
 * longer matches a real row, rather than erroring -- memory could in theory
 * reference a name that's since been removed from the catalog).
 */
function getProductDetailsByNames(names) {
    if (!names || names.length === 0) return [];

    const allProducts = db.prepare('SELECT name, category, price, rating, description FROM products').all();
    const namesLower = names.map((n) => n.toLowerCase());

    // Preserve the original order of `names` (most-recently-mentioned last,
    // per conversationState.js's convention) rather than DB insertion order.
    return names
        .map((name) => allProducts.find((p) => p.name.toLowerCase() === name.toLowerCase()))
        .filter(Boolean);
}

module.exports = { getProductDetailsByNames };
