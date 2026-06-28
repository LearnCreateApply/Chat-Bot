// Role-specific persona instructions, per spec Section 6.4.
const ROLE_PERSONAS = {
    Sales:
        "You are a friendly Sales assistant for a beauty and skincare brand. Be warm, concise, and helpful.",
    "Customer Care":
        "You are a Customer Care assistant who helps with orders and returns. Be empathetic, clear, and reassuring.",
    Support:
        "You are a Support assistant who helps resolve payment and checkout issues. Be calm, clear, and solution-focused.",
};

/**
 * Builds the final prompt sent to Gemini.
 *
 * HARD CONSTRAINT (spec Section 6.4): this function must only ever receive
 * `context` as a pre-formatted, human-readable string (produced by a DB
 * handler) and the user's original `message`. Never pass raw DB rows, JSON,
 * or the database schema in here -- the model should only ever be asked to
 * rephrase facts that code has already verified, not interpret raw data
 * itself. This is what prevents hallucinated order/payment details.
 */
function buildPrompt(role, context, message) {
    const persona = ROLE_PERSONAS[role] || ROLE_PERSONAS.Support;

    return `${persona}

Use the following factual information to answer the user, but phrase it naturally -- do not just repeat it verbatim:

${context}

User's message: "${message}"

Write a short, natural reply.`;
}

/**
 * Builds a prompt for messages that didn't confidently match any of the 5
 * known intents (low_confidence from the intent service). This is
 * DELIBERATELY different from buildPrompt above:
 *
 * - No role persona, no "factual information" framing -- there IS no
 *   verified context here, by design, so we never ask Gemini to answer the
 *   question with data it doesn't have.
 * - The instruction explicitly tells Gemini to DEFLECT gracefully, not
 *   answer -- e.g. "I can't pull up a full catalog here, but I can help you
 *   compare or look up specific products by name" -- rather than guessing at
 *   real data (which would risk inventing facts) or bluntly saying "I don't
 *   understand" (which feels broken to the user).
 * - This is intentionally GENERIC: it doesn't hardcode what the off-script
 *   request might be about (catalog listing, something entirely unrelated,
 *   etc.) -- it works the same way regardless of what specifically didn't
 *   match, which is the whole point: we can't predict every phrasing that
 *   won't match our 5 intents, so this path doesn't try to.
 */
function buildDeflectionPrompt(message) {
    return `You are a warm, helpful concierge for a beauty and skincare brand's chat assistant. The user just asked something that doesn't clearly match what you're able to look up directly (you can help with: product recommendations, comparing two specific products, order tracking, returns, and payment issues).

You do NOT have the information to directly answer this specific request, and you must NOT invent or guess at facts (like product lists, prices, or policies) you don't actually have.

Instead, respond with a short, friendly, natural reply that:
- Politely acknowledges you can't pull up exactly what they asked for
- Suggests a reasonable next step (e.g. checking the website, or rephrasing toward something you CAN help with -- naming specific products to compare, asking about a specific order, etc.)
- Stays warm and on-brand, never sounds like an error message

User's message: "${message}"

Write a short, natural reply.`;
}

/**
 * Builds a deflection prompt that ALSO tells Gemini what's in conversation
 * memory, so it can ask a smart, specific clarifying question instead of a
 * generic "I'm not sure what you mean."
 *
 * WHY THIS EXISTS: a real, common pattern is the user assuming the bot can
 * "see" the conversation the same way they can (e.g. asking "is it good for
 * sensitive skin" right after a product was mentioned, with no product name
 * IN this message). That message has no resolvable intent-bearing content
 * on its own, so the classifier correctly scores it low-confidence -- but
 * blind deflection (the original buildDeflectionPrompt) then responds as if
 * NOTHING was ever discussed, which feels broken to a user who reasonably
 * assumed context would carry over.
 *
 * This function closes that gap WITHOUT reintroducing the raw-history risk
 * the rest of this architecture avoids: it only ever passes REAL, DB-
 * verified product names already in memory (see conversationState.js) --
 * never raw chat text -- and explicitly tells Gemini to ask a targeted
 * clarifying question using those real names, rather than guessing which
 * one the user means or inventing an answer about it.
 */
function buildMemoryAwareDeflectionPrompt(message, mentionedProductDetails) {
    const productList = mentionedProductDetails
        .map((p) => `${p.name} (${p.category}, $${p.price.toFixed(2)}, Rating ${p.rating}/5) - ${p.description}`)
        .join('\n');

    return `You are a warm, helpful concierge for a beauty and skincare brand's chat assistant. The user just sent a message that doesn't clearly match a specific lookup on its own (you can help with: product recommendations, comparing two specific products, order tracking, returns, and payment issues).

IMPORTANT CONTEXT: earlier in this conversation, these REAL products were discussed (with their actual current details):
${productList}

The user's current message may be referring to one of these without naming it directly (e.g. "is it good for sensitive skin", "how much is it", "compare it to something else") -- this is a common and reasonable assumption users make.

If you can confidently tell which ONE product they mean AND their question can be answered using the real details above, go ahead and answer it directly using only those real facts -- do not invent anything beyond what's listed. If it's genuinely unclear which product they mean, ask a specific clarifying question using the real product names above (e.g. "Did you mean the [exact product name]?") rather than a generic "could you clarify?".

Stay warm and on-brand either way -- never sound like an error message.

User's message: "${message}"

Write a short, natural reply.`;
}

module.exports = { buildPrompt, buildDeflectionPrompt, buildMemoryAwareDeflectionPrompt };