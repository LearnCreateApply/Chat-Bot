const db = require('../db');
const { detectCategory } = require('./categoryKeywords');
const { setLastOrderId, getState } = require('../conversationState');

function extractOrderId(message) {
    if (!message) return null;
    const explicitMatch = message.match(/#\s?(\d+)/) || message.match(/order\s*(?:no\.?|number)?\s*(\d{2,})/i);
    if (explicitMatch) {
        return parseInt(explicitMatch[1], 10);
    }
    return null;
}

function referencesPreviousOrder(message) {
    if (!message) return false;
    const msgLower = message.toLowerCase();
    return /\b(that|this|the same|it)\b.*\border\b/.test(msgLower) || /\border\b.*\b(that|this|same)\b/.test(msgLower);
}

// Detects "my last order" / "my most recent order" -- i.e. the user is
// STARTING a new return and identifying the order by recency, not by
// number or by referencing something already discussed. THE FIX for a real
// gap: this is different from referencesPreviousOrder above, which only
// resolves an order already established as "that order" earlier in THIS
// conversation. A brand-new "I want to return my last order" has no such
// prior reference to fall back on -- without this, it fell straight
// through to checking RETURN history (not order history) for a match,
// found none for a customer with no returns on file yet, and gave up
// without ever identifying (or remembering) which order they meant.
function referencesMostRecentOrder(message) {
    if (!message) return false;
    const msgLower = message.toLowerCase();
    return /\b(last|latest|most recent|newest)\b.*\border\b/.test(msgLower) || /\border\b.*\b(last|latest|most recent|newest)\b/.test(msgLower);
}

// Same exact-then-loose product name matching as orderTracking.js, so
// "what's the status on my cleanser return" works here too, not just for
// order tracking. (This was missing -- returns could previously only be
// found by explicit order number or by "that order" cross-intent memory,
// silently falling back to "most recent return" for any product-name
// phrasing, which isn't what the user actually asked about.)
function findProductMentioned(userId, message) {
    if (!message) return null;
    const msgLower = message.toLowerCase();

    // FIX: prioritize matching against products the customer has ACTUALLY
    // ordered before falling back to the full catalog. A catalog-wide
    // search can match a totally different, never-ordered product that
    // happens to share a word -- e.g. "sunscreen" (the word) appears
    // literally in "Mineral Sunscreen SPF 30", so a catalog-wide search
    // picked that over a customer's REAL sunscreen order, "SPF 50 Watery
    // Sun Gel", whose name doesn't contain the word "sunscreen" at all
    // (and whose only distinguishing word, "Sun", is too short to pass the
    // length>3 filter). Searching the customer's own orders first means
    // "my sunscreen order" finds what they actually bought, not whatever
    // catalog item happens to share a substring.
    const ownedProducts = db.prepare(`
        SELECT DISTINCT p.product_id, p.name
        FROM orders o JOIN products p ON o.product_id = p.product_id
        WHERE o.user_id = ?
    `).all(userId);

    const ownedExact = ownedProducts.find((p) => msgLower.includes(p.name.toLowerCase()));
    if (ownedExact) return ownedExact;

    const ownedLoose = ownedProducts.find((p) => {
        const nameWords = p.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        return nameWords.some((word) => msgLower.includes(word));
    });
    if (ownedLoose) return ownedLoose;

    // CATEGORY FALLBACK: word-overlap can miss a real owned product whose
    // NAME doesn't literally contain the category word the customer used
    // -- e.g. "sunscreen" (customer's word) vs a product actually named
    // "... Sun Gel" (no shared word once "Sun" is filtered out for being
    // too short). If the message names a real category and the customer
    // owns EXACTLY ONE product in it, that's almost certainly what they
    // mean. Deliberately only acts on a single unambiguous match -- with
    // 0 or 2+ owned products in that category, fall through rather than
    // guess which one.
    const category = detectCategory(message);
    if (category) {
        const ownedInCategory = db.prepare(`
            SELECT DISTINCT p.product_id, p.name
            FROM orders o JOIN products p ON o.product_id = p.product_id
            WHERE o.user_id = ? AND p.category = ?
        `).all(userId, category);
        if (ownedInCategory.length === 1) return ownedInCategory[0];
    }

    // Fall through to the full catalog -- covers a customer asking about a
    // product they haven't ordered yet, where "no order on file for that"
    // is the correct, honest reply.
    const allProducts = db.prepare('SELECT product_id, name FROM products').all();
    const exactMatch = allProducts.find((p) => msgLower.includes(p.name.toLowerCase()));
    if (exactMatch) return exactMatch;

    const looseMatch = allProducts.find((p) => {
        const nameWords = p.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        return nameWords.some((word) => msgLower.includes(word));
    });
    return looseMatch || null;
}

const GENERIC_POLICY_TEXT = `General Return Policy Info: We accept returns within 30 days of delivery. Items must be unused. Refunds take 3-5 business days to process once approved.`;

function handleReturnPolicy(userId, extraParams = {}) {
    const message = extraParams.message || "";
    let requestedOrderId = extractOrderId(message);

    // CROSS-INTENT MEMORY: "is THAT order's return approved" with no number
    // given, but a previous turn (in order tracking, returns, OR payments)
    // already resolved a specific order_id.
    if (!requestedOrderId && referencesPreviousOrder(message)) {
        const state = getState(userId);
        if (state.lastOrderId) {
            requestedOrderId = state.lastOrderId;
        }
    }

    // NEW-RETURN-BY-RECENCY: "I want to return my last order" -- no number,
    // and nothing pending from earlier in the conversation to fall back on
    // either. Resolve "last order" against the REAL orders table (not
    // returns) so this reuses the exact same requestedOrderId branch below
    // -- which already correctly says "no return on file for that specific
    // order yet" and, crucially, remembers the order_id for a same-topic
    // follow-up like "did that order even ship yet".
    if (!requestedOrderId && referencesMostRecentOrder(message)) {
        const mostRecentOrder = db.prepare(`SELECT order_id FROM orders WHERE user_id = ? ORDER BY order_date DESC LIMIT 1`).get(userId);
        if (mostRecentOrder) {
            requestedOrderId = mostRecentOrder.order_id;
        }
    }

    if (requestedOrderId) {
        const specificReturn = db.prepare(`
            SELECT r.return_id, r.status as return_status, r.requested_date, r.reason, o.order_id
            FROM returns r
            JOIN orders o ON r.order_id = o.order_id
            WHERE o.user_id = ? AND o.order_id = ?
        `).get(userId, requestedOrderId);

        if (specificReturn) {
            setLastOrderId(userId, specificReturn.order_id);
            return `Customer asked about the return for Order #${specificReturn.order_id}.\n` +
                   `Requested on: ${specificReturn.requested_date}.\n` +
                   `Return Status: ${specificReturn.return_status.toUpperCase()}.\n` +
                   `Reason: ${specificReturn.reason}.\n` +
                   `\n${GENERIC_POLICY_TEXT}`;
        }

        const orderExists = db.prepare(`SELECT order_id FROM orders WHERE user_id = ? AND order_id = ?`).get(userId, requestedOrderId);
        if (orderExists) {
            setLastOrderId(userId, requestedOrderId);
            return `Customer asked about returning Order #${requestedOrderId}, but there is no return request on file for that specific order yet.\n${GENERIC_POLICY_TEXT}`;
        }
        return `Customer asked about returning Order #${requestedOrderId}, but no such order exists under their account. Let them know the order number doesn't match.\n${GENERIC_POLICY_TEXT}`;
    }

    // PRODUCT-NAME RESOLUTION: no order number and no "that order" memory
    // hit -- check if a real product was named instead, e.g. "what's the
    // status on my cleanser return".
    const mentionedProduct = findProductMentioned(userId, message);
    if (mentionedProduct) {
        const matchingReturns = db.prepare(`
            SELECT r.return_id, r.status as return_status, r.requested_date, r.reason, o.order_id
            FROM returns r
            JOIN orders o ON r.order_id = o.order_id
            WHERE o.user_id = ? AND o.product_id = ?
            ORDER BY r.requested_date DESC
        `).all(userId, mentionedProduct.product_id);

        if (matchingReturns.length === 1) {
            const ret = matchingReturns[0];
            setLastOrderId(userId, ret.order_id);
            return `Customer asked about the return for their "${mentionedProduct.name}" (matched from the product name in their message) -- Order #${ret.order_id}.\n` +
                   `Requested on: ${ret.requested_date}.\n` +
                   `Return Status: ${ret.return_status.toUpperCase()}.\n` +
                   `Reason: ${ret.reason}.\n` +
                   `\n${GENERIC_POLICY_TEXT}`;
        } else if (matchingReturns.length > 1) {
            const summary = matchingReturns.map((r) => `Order #${r.order_id} (${r.return_status}, requested ${r.requested_date})`).join('\n');
            return `The user asked about the return for their "${mentionedProduct.name}". They have ${matchingReturns.length} returns on file for this exact product:\n${summary}\nIf it's not obvious which one they mean from their message, ask them to clarify (e.g. by approximate date or status); otherwise answer using the most relevant one.\n\n${GENERIC_POLICY_TEXT}`;
        }

        // Product matched, but no return on file for it -- check if they
        // even have an order for that product before saying "no order".
        const orderForProduct = db.prepare(`SELECT order_id FROM orders WHERE user_id = ? AND product_id = ? ORDER BY order_date DESC LIMIT 1`).get(userId, mentionedProduct.product_id);
        if (orderForProduct) {
            setLastOrderId(userId, orderForProduct.order_id);
            return `Customer asked about returning their "${mentionedProduct.name}" (Order #${orderForProduct.order_id}), but there is no return request on file for that specific order yet.\n${GENERIC_POLICY_TEXT}`;
        }
        return `Customer mentioned "${mentionedProduct.name}", but they have no order on file for that specific product. Let them know honestly rather than guessing, and ask which order they actually mean.\n${GENERIC_POLICY_TEXT}`;
    }

    const allReturns = db.prepare(`
        SELECT r.return_id, r.status as return_status, r.requested_date, r.reason, o.order_id
        FROM returns r
        JOIN orders o ON r.order_id = o.order_id
        WHERE o.user_id = ?
        ORDER BY r.requested_date DESC
    `).all(userId);

    if (allReturns.length === 0) {
        return `Customer has no pending/active returns on file.\n${GENERIC_POLICY_TEXT}`;
    }

    const mostRecent = allReturns[0];
    setLastOrderId(userId, mostRecent.order_id);

    let context = `Customer's most recent return request is for Order #${mostRecent.order_id}.\n` +
                   `Requested on: ${mostRecent.requested_date}.\n` +
                   `Return Status: ${mostRecent.return_status.toUpperCase()}.\n` +
                   `Reason: ${mostRecent.reason}.\n` +
                   `\n${GENERIC_POLICY_TEXT}`;

    if (allReturns.length > 1) {
        const others = allReturns.slice(1).map(r => `Order #${r.order_id} (${r.return_status})`).join(', ');
        context += `\n\n(Note: this is their MOST RECENT return. They also have other returns on file: ${others}. If the user seems to mean a different one, ask which order number they mean.)`;
    }

    return context;
}

module.exports = handleReturnPolicy;