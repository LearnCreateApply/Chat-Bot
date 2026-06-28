const db = require('../db');
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