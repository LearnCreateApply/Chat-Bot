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

// Same exact-then-loose product name matching as orderTracking.js, so
// "did my sunscreen payment go through" works here too, not just for order
// tracking. (This was missing -- payments could previously only be found
// by explicit order number or "that order" cross-intent memory, silently
// falling back to "most recent transaction" for any product-name phrasing.)
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

function formatPaymentLine(p) {
    return `Order #${p.order_id} - ${p.product_name}: $${p.amount.toFixed(2)} via ${p.method} (${p.status.toUpperCase()})`;
}

function handlePaymentIssue(userId, extraParams = {}) {
    const message = extraParams.message || "";
    let requestedOrderId = extractOrderId(message);

    // CROSS-INTENT MEMORY: "did the payment for that order go through" with
    // no number given, but a previous turn (order tracking, returns, OR
    // payments) already resolved a specific order_id.
    if (!requestedOrderId && referencesPreviousOrder(message)) {
        const state = getState(userId);
        if (state.lastOrderId) {
            requestedOrderId = state.lastOrderId;
        }
    }

    const baseQuery = `
        SELECT p.payment_id, p.amount, p.status, p.method, o.order_id, pr.name AS product_name
        FROM payments p
        JOIN orders o ON p.order_id = o.order_id
        JOIN products pr ON o.product_id = pr.product_id
        WHERE o.user_id = ?
    `;

    if (requestedOrderId) {
        const payment = db.prepare(`${baseQuery} AND o.order_id = ? ORDER BY p.payment_id DESC LIMIT 1`).get(userId, requestedOrderId);

        if (!payment) {
            const orderExists = db.prepare(`SELECT order_id FROM orders WHERE user_id = ? AND order_id = ?`).get(userId, requestedOrderId);
            if (orderExists) {
                setLastOrderId(userId, requestedOrderId);
                return `Customer asked about the payment for Order #${requestedOrderId}, but there is no payment record on file for that specific order.`;
            }
            const allPayments = db.prepare(`${baseQuery} ORDER BY o.order_date DESC LIMIT 5`).all(userId);
            if (allPayments.length === 0) {
                return `Customer asked about Order #${requestedOrderId}, but they have no payment history on file at all. Let them know this order number doesn't match their account.`;
            }
            const summary = allPayments.map(formatPaymentLine).join('\n');
            return `Customer asked about the payment for Order #${requestedOrderId}, but no such order exists under their account. Their actual recent payments are:\n${summary}\nPolitely let them know the order number doesn't match and list what they do have.`;
        }

        setLastOrderId(userId, payment.order_id);
        return `Order #${payment.order_id} - Item: ${payment.product_name}.\n` +
               `Payment Amount: $${payment.amount.toFixed(2)}.\n` +
               `Payment Method: ${payment.method}.\n` +
               `Payment Status: ${payment.status.toUpperCase()}.`;
    }

    // PRODUCT-NAME RESOLUTION: no order number and no "that order" memory
    // hit -- check if a real product was named instead, e.g. "did my
    // sunscreen payment go through".
    const mentionedProduct = findProductMentioned(userId, message);
    if (mentionedProduct) {
        const matchingPayments = db.prepare(`${baseQuery} AND o.product_id = ? ORDER BY p.payment_id DESC`).all(userId, mentionedProduct.product_id);

        if (matchingPayments.length === 1) {
            const payment = matchingPayments[0];
            setLastOrderId(userId, payment.order_id);
            return `Order #${payment.order_id} - Item: ${payment.product_name} (matched from the product name in the user's message).\n` +
                   `Payment Amount: $${payment.amount.toFixed(2)}.\n` +
                   `Payment Method: ${payment.method}.\n` +
                   `Payment Status: ${payment.status.toUpperCase()}.`;
        } else if (matchingPayments.length > 1) {
            const summary = matchingPayments.map(formatPaymentLine).join('\n');
            return `The user asked about the payment for their "${mentionedProduct.name}" order. They have ${matchingPayments.length} payments on file tied to this exact product:\n${summary}\nIf it's not obvious which one they mean from their message, ask them to clarify (e.g. by approximate date or status); otherwise answer using the most relevant one.`;
        }
        // Product matched, but no payment on file for it -- check if they
        // even have an order for that product before saying "no order".
        const orderForProduct = db.prepare(`SELECT order_id FROM orders WHERE user_id = ? AND product_id = ? ORDER BY order_date DESC LIMIT 1`).get(userId, mentionedProduct.product_id);
        if (orderForProduct) {
            setLastOrderId(userId, orderForProduct.order_id);
            return `Customer asked about the payment for their "${mentionedProduct.name}" (Order #${orderForProduct.order_id}), but there is no payment record on file for that specific order.`;
        }
        return `Customer mentioned "${mentionedProduct.name}", but they have no order on file for that specific product. Let them know honestly rather than guessing, and ask which order they actually mean.`;
    }

    // FIX: sort by the REAL order date, not payment_id (payment insertion
    // order). These can disagree -- e.g. a customer's chronologically
    // latest order can have a LOWER payment_id than an earlier order's
    // payment, if payments weren't inserted in strict order-date sequence.
    // Sorting by payment_id here meant "most recent transaction" could
    // silently point at a different order than orderTracking.js or
    // returnPolicy.js would call "the most recent order" for the exact
    // same customer -- three handlers, three different answers to the same
    // question. Sorting by the joined order_date makes "most recent" mean
    // the same real-world thing everywhere.
    const allPayments = db.prepare(`${baseQuery} ORDER BY o.order_date DESC LIMIT 5`).all(userId);

    if (allPayments.length === 0) {
        return "Customer has no payment history on file.";
    }

    const mostRecent = allPayments[0];
    setLastOrderId(userId, mostRecent.order_id);

    let context = `Most recent transaction -- Order #${mostRecent.order_id} - Item: ${mostRecent.product_name}.\n` +
                   `Payment Amount: $${mostRecent.amount.toFixed(2)}.\n` +
                   `Payment Method: ${mostRecent.method}.\n` +
                   `Payment Status: ${mostRecent.status.toUpperCase()}.`;

    if (allPayments.length > 1) {
        const fullList = allPayments.map(formatPaymentLine).join('\n');
        context += `\n\n(Note: this is their MOST RECENT transaction, shown in detail above. Their up-to-5 most recent payments in full are:\n${fullList}\nIf the user is asking about a different one -- by order number, item name, or status -- answer using this list directly instead of asking them to repeat the order number.)`;
    }

    return context;
}

module.exports = handlePaymentIssue;