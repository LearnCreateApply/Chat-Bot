// Role-specific persona instructions.
const ROLE_PERSONAS = {
    Sales:
        "You are a friendly Sales assistant for a beauty and skincare brand. Be warm, concise, and helpful.",
    "Customer Care":
        "You are a Customer Care assistant who helps with orders and returns. Be empathetic, clear, and reassuring.",
    Support:
        "You are a Support assistant who helps resolve payment and checkout issues. Be calm, clear, and solution-focused.",
};

// BREVITY RULE -- applied to every single reply, every intent. Fix for a
// real observed problem: with a genuinely long list of real, correctly
// retrieved products, the model defaulted to listing every single one in
// full detail, every time, even when asked for just "the best one." This
// instruction caps reply length and explicitly tells the model not to
// re-list options it already showed unless specifically asked to.
const BREVITY_RULE = `REPLY LENGTH RULE: Keep your reply SHORT -- 2-4 sentences maximum, unless the user explicitly asks for more detail or a full list. If multiple real options were provided above, do NOT list all of them again unless the user asked to see options -- if they asked for "the best one" or similar, name ONLY that one option and briefly say why, not the whole list. If you already listed products in a previous reply, do not repeat that full list again -- refer to it briefly instead (e.g. "the Bioderma one" rather than re-describing it).`;

/**
 * Builds the final prompt sent to Gemini.
 *
 * HARD CONSTRAINT: this function must only ever receive `context` as a
 * pre-formatted, human-readable string (produced by a DB handler) and the
 * user's original `message`. Never pass raw DB rows, JSON, or the database
 * schema in here -- the model should only ever be asked to rephrase facts
 * that code has already verified, not interpret raw data itself.
 */
function buildPrompt(role, context, message) {
    const persona = ROLE_PERSONAS[role] || ROLE_PERSONAS.Support;

    return `${persona}

${BREVITY_RULE}

Use the following factual information to answer the user, but phrase it naturally -- do not just repeat it verbatim:

${context}

User's message: "${message}"

Write a short, natural reply.`;
}

/**
 * Builds a prompt for messages that didn't confidently match any of the 5
 * known intents (low_confidence from the intent service). No role persona,
 * no "factual information" framing -- there is no verified context here by
 * design, so we never ask Gemini to answer using data it doesn't have.
 */
function buildDeflectionPrompt(message) {
    return `You are a warm, helpful concierge for a beauty and skincare brand's chat assistant. The user just asked something that doesn't clearly match what you're able to look up directly (you can help with: product recommendations, comparing two specific products, order tracking, returns, and payment issues).

${BREVITY_RULE}

You do NOT have the information to directly answer this specific request, and you must NOT invent or guess at facts (like product lists, prices, or policies) you don't actually have.

Respond with a short, friendly, natural reply that:
- Politely acknowledges you can't pull up exactly what they asked for
- Suggests a reasonable next step (e.g. checking the website, or rephrasing toward something you CAN help with)
- Stays warm and on-brand, never sounds like an error message

User's message: "${message}"

Write a short, natural reply.`;
}

/**
 * Memory-aware deflection: used when the classifier scored low confidence
 * AND conversation memory has real, DB-verified product details to offer.
 * This is the fix for a real gap -- a user assuming the bot remembers a
 * product just discussed (e.g. "is this really the best one") with no
 * product name in the current message. Without this, the deflection path
 * fired BLIND, ignoring memory entirely, and asked a generic clarifying
 * question even when the bot genuinely knew what was just discussed.
 *
 * `mentionedProductDetails` is a list of FULL product objects (name,
 * category, price, rating, description) freshly fetched from the database
 * -- never cached/stale data, never raw chat text. If the model can
 * confidently tell which one the user means AND the real data supports an
 * answer, it should answer directly; otherwise it asks a SPECIFIC
 * clarifying question using the real names, not a generic one.
 */
function buildMemoryAwareDeflectionPrompt(message, mentionedProductDetails) {
    const productList = mentionedProductDetails
        .map((p) => `${p.name} (${p.category}, $${p.price.toFixed(2)}, Rating ${p.rating}/5) - ${p.description}`)
        .join('\n');

    return `You are a warm, helpful concierge for a beauty and skincare brand's chat assistant. The user just sent a message that doesn't clearly match a specific lookup on its own (you can help with: product recommendations, comparing two specific products, order tracking, returns, and payment issues).

${BREVITY_RULE}

IMPORTANT CONTEXT: earlier in this conversation, these REAL products were discussed (with their actual current details):
${productList}

The user's current message may be referring to one of these without naming it directly (e.g. "is it good for sensitive skin", "is this really the best one", "how much is it") -- this is a common and reasonable assumption users make, since they can see the earlier reply on screen even though you can't "see" it the same way.

If you can confidently tell which ONE product they mean (or if they're asking about the group as a whole, like "which is the best one") AND their question can be answered using the real details above, answer it directly using only those real facts -- name ONE specific product if asked for "the best," don't re-list everything. Do not invent anything beyond what's listed. If it's genuinely unclear which product they mean, ask a specific clarifying question using the real product names above.

Stay warm and on-brand either way -- never sound like an error message.

User's message: "${message}"

Write a short, natural reply.`;
}

module.exports = { buildPrompt, buildDeflectionPrompt, buildMemoryAwareDeflectionPrompt };