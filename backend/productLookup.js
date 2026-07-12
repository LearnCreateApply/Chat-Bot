const db = require('./db');

/**
 * Given a list of product NAMES (from conversation memory), fetches the
 * full, CURRENT details for each from the database -- price, rating,
 * description, category. Re-fetches fresh every time rather than caching,
 * so memory never hands the AI stale data -- only a name index is stored in
 * memory; the real facts always come straight from the database.
 *
 * Silently skips any name that no longer matches a real product, rather
 * than erroring.
 */
function getProductDetailsByNames(names) {
    if (!names || names.length === 0) return [];

    const allProducts = db.prepare('SELECT name, category, price, rating, description FROM products').all();
    return names
        .map((name) => allProducts.find((p) => p.name.toLowerCase() === name.toLowerCase()))
        .filter(Boolean);
}

module.exports = { getProductDetailsByNames };