const db = require('../db');
const { getState, setLastCategory } = require('../conversationState');
const { detectCategory: detectRequestedCategory } = require('./categoryKeywords');

// Cap only applies when NO specific category can be detected (i.e. a fully
// generic "recommend something for me" with no product type mentioned).
// When a category IS detected, we fetch ALL matching products for that
// category + skin type -- no cap -- since the whole point is giving the
// model real, complete options to choose from rather than an arbitrary
// top-N slice that might exclude the one thing the user actually asked for.
const GENERIC_FALLBACK_LIMIT = 5;

/*
 * detectRequestedCategory (imported above from categoryKeywords.js) returns
 * the REAL product category string as stored in products.category, or null
 * if no category is detectable (e.g. a generic "recommend something for
 * me").
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

// Fallback for when the user describes a SKIN CONCERN rather than naming a
// product category outright -- e.g. "my face gets oily by the afternoon"
// names no category word at all, but a real person (and a real sales
// associate) would read that as "this customer needs a cleanser with oil
// control." Checked ONLY as a fallback after CATEGORY_KEYWORDS finds
// nothing, so an explicit category mention always wins (e.g. "moisturizer
// for oily skin" still returns moisturizer, not cleanser).
const SKIN_CONCERN_KEYWORDS = {
    cleanser: ['oily', 'oil', 'greasy', 'shiny', 'shine', 'excess sebum'],
    moisturizer: ['dry', 'flaky', 'flaking', 'tight', 'dehydrated'],
    treatment: ['acne', 'breakout', 'breakouts', 'pimple', 'pimples', 'blemish', 'blemishes', 'zit'],
    serum: ['dark spot', 'dark spots', 'hyperpigmentation', 'dullness', 'dull skin', 'uneven tone', 'glow'],
    sunscreen: ['sunburn', 'sun damage', 'sun protection'],
    haircare: ['frizz', 'frizzy', 'dandruff', 'split ends'],
};

function detectConcernCategory(message) {
    if (!message) return null;
    const msgLower = message.toLowerCase();

    for (const [category, keywords] of Object.entries(SKIN_CONCERN_KEYWORDS)) {
        if (keywords.some((kw) => msgLower.includes(kw))) {
            return category;
        }
    }
    return null;
}


// with no category keyword of their own -- e.g. "another option", "show me
// more", "anything else in that category", "a different one". Deliberately
// narrow (continuation language only) so a genuinely new, category-less
// request like "recommend something for me" still falls through to the
// generic top-picks behavior instead of silently reusing a stale category.
const CONTINUATION_PATTERN = /\b(another|more|else|other|different one|that category|same category)\b/;

/**
 * Resolves which real DB category (if any) this turn should use, given the
 * message AND the user's remembered lastCategory. THE FIX for a real gap:
 * a follow-up like "is there another option in that category" has no
 * category keyword for detectRequestedCategory to match on its own -- only
 * the word "another"/"that category", which by itself isn't tied to any
 * specific category. Without checking memory, this fell through to the
 * generic top-picks-across-everything fallback, silently ignoring that the
 * user was clearly still talking about the category just shown.
 */
function resolveCategory(message, userId) {
    const direct = detectRequestedCategory(message);
    if (direct) return direct;

    const concern = detectConcernCategory(message);
    if (concern) return concern;

    if (CONTINUATION_PATTERN.test((message || '').toLowerCase())) {
        const state = getState(userId);
        if (state.lastCategory) return state.lastCategory;
    }
    return null;
}

// Separate from resolveCategory above -- this checks for continuation
// LANGUAGE specifically (independent of how the category itself got
// resolved), so "do you have ANOTHER cleanser" (direct keyword + "another")
// is treated as a continuation just as much as "is there another option in
// that category" (memory-resolved) is. Used to decide whether to exclude
// products already shown, not just whether to resolve a bare category.
function isContinuationRequest(message) {
    return CONTINUATION_PATTERN.test((message || '').toLowerCase());
}

function handleProductRecommendation(userId, extraParams = {}) {
    const message = extraParams.message || "";

    const user = db.prepare('SELECT skin_type FROM users WHERE user_id = ?').get(userId);
    if (!user) {
        return "User not found. Recommend our general best-sellers, suitable for all skin types.";
    }
    const skinType = user.skin_type;

    const requestedCategory = resolveCategory(message, userId);
    // FIX: only ever SET lastCategory when this turn actually carries a
    // category signal (direct keyword, concern keyword, or a continuation
    // resolved via memory) -- never CLEAR it just because this particular
    // turn happened to be category-agnostic. Previously, ANY
    // product_recommendation turn overwrote lastCategory with whatever
    // resolveCategory returned, including null -- so a later, unrelated
    // recommendation turn (e.g. an objection like "you don't know my skin
    // type", which has no category signal at all) would silently erase a
    // perfectly good "customer was just looking at cleansers" memory,
    // breaking a LATER "another option in that category" that has nothing
    // to do with the turn that cleared it.
    if (requestedCategory) {
        setLastCategory(userId, requestedCategory);
    }

    let products;
    // FIX for a real gap: "another option in that category" was resolving
    // the RIGHT category, but re-running the exact same query -- so a
    // second "anything else?" showed the identical list again instead of
    // something new. Only exclude when continuation language is actually
    // present, so a fresh, direct category ask (e.g. first-time "recommend
    // a cleanser") still gets the full real list, unaffected.
    const state = getState(userId);
    const excludeNames = (requestedCategory && isContinuationRequest(message))
        ? (state.mentionedProducts || [])
        : [];

    if (requestedCategory) {
        // Category detected: fetch ALL matching products for this category
        // + skin type, no limit. This is the actual fix -- "serum" gets
        // every real serum that fits their skin type, not a slice of
        // whatever happened to rank highest across the whole catalog.
        if (excludeNames.length > 0) {
            const placeholders = excludeNames.map(() => '?').join(',');
            products = db.prepare(`
                SELECT name, price, rating, description 
                FROM products 
                WHERE category = ?
                  AND (skin_type_fit LIKE ? OR skin_type_fit LIKE '%all%')
                  AND name NOT IN (${placeholders})
                ORDER BY rating DESC
            `).all(requestedCategory, `%${skinType}%`, ...excludeNames);
        } else {
            products = db.prepare(`
                SELECT name, price, rating, description 
                FROM products 
                WHERE category = ?
                  AND (skin_type_fit LIKE ? OR skin_type_fit LIKE '%all%')
                ORDER BY rating DESC
            `).all(requestedCategory, `%${skinType}%`);
        }
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
        if (requestedCategory && excludeNames.length > 0) {
            // Ran out, rather than repeating -- tell Gemini the honest
            // reason so it can say so plainly instead of looping back to
            // an option already shown or inventing a new one.
            return `The customer has now been shown ALL real "${requestedCategory}" products available for their skin type across this conversation -- there are no further NEW options left in this category. Let them know honestly that they've now seen everything currently available in ${requestedCategory} for their skin type, rather than repeating an earlier option or inventing a new one. Offer to help with a different category instead if they're interested.`;
        }
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

    const requestedCategory = resolveCategory(message, userId);
    const state = getState(userId);
    const excludeNames = (requestedCategory && isContinuationRequest(message))
        ? (state.mentionedProducts || [])
        : [];

    let products;
    if (requestedCategory) {
        if (excludeNames.length > 0) {
            const placeholders = excludeNames.map(() => '?').join(',');
            products = db.prepare(`
                SELECT name FROM products 
                WHERE category = ? AND (skin_type_fit LIKE ? OR skin_type_fit LIKE '%all%')
                  AND name NOT IN (${placeholders})
                ORDER BY rating DESC
            `).all(requestedCategory, `%${user.skin_type}%`, ...excludeNames);
        } else {
            products = db.prepare(`
                SELECT name FROM products 
                WHERE category = ? AND (skin_type_fit LIKE ? OR skin_type_fit LIKE '%all%')
                ORDER BY rating DESC
            `).all(requestedCategory, `%${user.skin_type}%`);
        }
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