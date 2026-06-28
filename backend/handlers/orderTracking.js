const db = require('../db');
const { setLastOrderId, getState } = require('../conversationState');

const MAX_RECENT_ORDERS = 5;

function extractOrderId(message) {
    if (!message) return null;
    const explicitMatch = message.match(/#\s?(\d+)/) || message.match(/order\s*(?:no\.?|number)?\s*(\d{2,})/i);
    if (explicitMatch) {
        return parseInt(explicitMatch[1], 10);
    }
    return null;
}

function findProductMentioned(message) {
    if (!message) return null;
    const msgLower = message.toLowerCase();
    const allProducts = db.prepare('SELECT product_id, name FROM products').all();

    const exactMatch = allProducts.find((p) => msgLower.includes(p.name.toLowerCase()));
    if (exactMatch) return exactMatch;

    const looseMatch = allProducts.find((p) => {
        const nameWords = p.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        return nameWords.some((word) => msgLower.includes(word));
    });
    return looseMatch || null;
}

// Detects phrasing like "that order", "this order", "it" (in an order
// context) -- i.e. the user is referencing a PREVIOUSLY discussed order
// without repeating its number. Deliberately narrow (explicit "order"
// reference required) to avoid false-positives on unrelated uses of
// "that"/"this".
function referencesPreviousOrder(message) {
    if (!message) return false;
    const msgLower = message.toLowerCase();
    return /\b(that|this|the same|it)\b.*\border\b/.test(msgLower) || /\border\b.*\b(that|this|same)\b/.test(msgLower);
}

function formatOrderLine(o) {
    const etaText = o.eta ? `ETA ${o.eta}` : 'no ETA';
    return `#${o.order_id} - ${o.product_name} (${o.status.toUpperCase()}, ordered ${o.order_date}, ${etaText})`;
}

function handleOrderTracking(userId, extraParams = {}) {
    const message = extraParams.message || "";
    const requestedOrderId = extractOrderId(message);

    const baseQuery = `
        SELECT o.order_id, o.status, o.order_date, o.eta, p.name AS product_name
        FROM orders o
        JOIN products p ON o.product_id = p.product_id
        WHERE o.user_id = ?
    `;

    if (requestedOrderId) {
        const order = db.prepare(`${baseQuery} AND o.order_id = ?`).get(userId, requestedOrderId);

        if (!order) {
            const allOrders = db.prepare(`${baseQuery} ORDER BY o.order_date DESC LIMIT ?`).all(userId, MAX_RECENT_ORDERS);
            if (allOrders.length === 0) {
                return `Customer asked about Order #${requestedOrderId}, but they have no order history on file at all. Let them know this order number doesn't match their account.`;
            }
            const summary = allOrders.map(formatOrderLine).join('\n');
            return `Customer asked about Order #${requestedOrderId}, but no such order exists under their account. Their actual recent orders are:\n${summary}\nPolitely let them know the order number doesn't match and list what they do have.`;
        }

        setLastOrderId(userId, order.order_id); // remember this order ACROSS intents
        return `Order #${order.order_id} - Item: ${order.product_name}.\n` +
               `Placed on ${order.order_date}.\n` +
               `Current Status: ${order.status.toUpperCase()}.\n` +
               (order.eta ? `Estimated Delivery Date: ${order.eta}.` : `No specific ETA is available for this status.`);
    }

    // CROSS-INTENT MEMORY: "is THAT order shipped yet" with no number given,
    // but a previous turn (in ANY intent -- order tracking, returns, or
    // payments) already resolved a specific order_id. Check this BEFORE the
    // product-name and most-recent fallbacks, since an explicit "that
    // order" reference is a stronger signal than just defaulting to latest.
    if (referencesPreviousOrder(message)) {
        const state = getState(userId);
        if (state.lastOrderId) {
            const order = db.prepare(`${baseQuery} AND o.order_id = ?`).get(userId, state.lastOrderId);
            if (order) {
                return `Order #${order.order_id} - Item: ${order.product_name} (this is the order the user was just discussing, referenced as "that order").\n` +
                       `Placed on ${order.order_date}.\n` +
                       `Current Status: ${order.status.toUpperCase()}.\n` +
                       (order.eta ? `Estimated Delivery Date: ${order.eta}.` : `No specific ETA is available for this status.`);
            }
        }
        // No lastOrderId in memory, or it didn't resolve -- fall through to
        // normal handling below rather than dead-ending.
    }

    const mentionedProduct = findProductMentioned(message);
    if (mentionedProduct) {
        const matchingOrders = db.prepare(`${baseQuery} AND p.product_id = ? ORDER BY o.order_date DESC`).all(userId, mentionedProduct.product_id);

        if (matchingOrders.length === 1) {
            const order = matchingOrders[0];
            setLastOrderId(userId, order.order_id);
            return `Order #${order.order_id} - Item: ${order.product_name} (matched from the product name in the user's message).\n` +
                   `Placed on ${order.order_date}.\n` +
                   `Current Status: ${order.status.toUpperCase()}.\n` +
                   (order.eta ? `Estimated Delivery Date: ${order.eta}.` : `No specific ETA is available for this status.`);
        } else if (matchingOrders.length > 1) {
            const summary = matchingOrders.map(formatOrderLine).join('\n');
            return `The user asked about their "${mentionedProduct.name}" order. They have ${matchingOrders.length} orders for this exact product:\n${summary}\nIf it's not obvious which one they mean from their message, ask them to clarify (e.g. by approximate date or status); otherwise answer using the most relevant one.`;
        }
    }

    const allOrders = db.prepare(`${baseQuery} ORDER BY o.order_date DESC LIMIT ?`).all(userId, MAX_RECENT_ORDERS);

    if (allOrders.length === 0) {
        return "Customer has no order history on file. Let them know we can't find any recent orders under their account.";
    }

    const mostRecent = allOrders[0];
    setLastOrderId(userId, mostRecent.order_id); // even the "most recent" fallback counts as having discussed this order now

    let context = mentionedProduct
        ? `The user mentioned "${mentionedProduct.name}", but they have no order for that specific product. Their most recent order is -- Order #${mostRecent.order_id} - Item: ${mostRecent.product_name}.\n`
        : `Most recent order -- Order #${mostRecent.order_id} - Item: ${mostRecent.product_name}.\n`;
    context += `Placed on ${mostRecent.order_date}.\n` +
               `Current Status: ${mostRecent.status.toUpperCase()}.\n` +
               (mostRecent.eta ? `Estimated Delivery Date: ${mostRecent.eta}.` : `No specific ETA is available for this status.`);

    if (allOrders.length > 1) {
        const fullList = allOrders.map(formatOrderLine).join('\n');
        context += `\n\n(Note: this is their MOST RECENT order, shown in detail above. Their up-to-${MAX_RECENT_ORDERS} most recent orders in full are:\n${fullList}\nIf the user is asking about a different one -- by order number, item name, or status -- answer using this list directly instead of asking them to repeat the order number.)`;
    }

    return context;
}

function getMostRecentOrderProductName(userId) {
    const order = db.prepare(`
        SELECT p.name AS product_name
        FROM orders o
        JOIN products p ON o.product_id = p.product_id
        WHERE o.user_id = ?
        ORDER BY o.order_date DESC
        LIMIT 1
    `).get(userId);
    return order ? order.product_name : null;
}

module.exports = handleOrderTracking;
module.exports.getMostRecentOrderProductName = getMostRecentOrderProductName;