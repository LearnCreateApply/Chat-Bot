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
            const allPayments = db.prepare(`${baseQuery} ORDER BY p.payment_id DESC LIMIT 5`).all(userId);
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

    const allPayments = db.prepare(`${baseQuery} ORDER BY p.payment_id DESC LIMIT 5`).all(userId);

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