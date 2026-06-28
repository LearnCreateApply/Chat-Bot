// In-memory structured conversation state, keyed by user_id.
//
// WHY THIS EXISTS (vs. appending raw chat history to the Gemini prompt):
// Appending raw turns ("user: ..., bot: ...") to every future prompt has two
// problems: (1) prompt size grows unboundedly turn over turn, and (2) it lets
// PAST AI-GENERATED REPLIES feed into FUTURE AI prompts, which risks
// compounding hallucinations -- a model reasoning partly over its own
// earlier unverified output, not just fresh handler-verified facts. This
// breaks the spec's core safety property (Gemini only ever sees
// pre-formatted, human/code-verified context).
//
// Instead, we remember a small STRUCTURED snapshot of "what's been
// discussed recently" -- intent, a running list of product names actually
// mentioned, order ids referenced. This is consumed by HANDLERS (the
// deterministic, no-AI layer) to resolve ambiguous follow-ups like "compare
// it to the other one" or "that gel wash from earlier" -- never inserted
// into the Gemini prompt as raw conversation text.
//
// WHY A LIST OF EXACT PRODUCT NAMES IS SAFE (not a hallucination risk):
// Every name added to mentionedProducts comes from a DB-verified match (see
// productComparison.js's resolveMatchedProductNames, productRecommendation.js,
// etc) -- never from Gemini's own prior paraphrasing of a product. Handing
// Gemini a short list of EXACT, REAL names and asking it to pick which one
// the user's current message refers to is a bounded matching/reading-
// comprehension task, not a generative one -- Gemini isn't inventing a
// product, it's selecting among ones we already know exist. The risk would
// only reappear if the list itself were sourced from unverified text (e.g.
// scraped from a previous Gemini reply) -- it never is here.
//
// SCOPE NOTE: this is a hackathon-appropriate in-memory store (resets on
// server restart, not shared across multiple backend instances). A
// production version would back this with Redis or similar.

const stateByUser = new Map();

// Cap on how many distinct product names we remember per user. Keeps the
// list (and therefore the prompt) bounded even in a very long conversation,
// while comfortably covering realistic "earlier you mentioned X" follow-ups.
const MAX_REMEMBERED_PRODUCTS = 8;

const DEFAULT_STATE = {
    lastIntent: null,
    mentionedProducts: [], // running, deduplicated list of real product names mentioned this session
    lastOrderId: null,     // order id most recently referenced, if any
    pendingClarification: null, // see setPendingClarification below
    updatedAt: null,
};

function getState(userId) {
    const existing = stateByUser.get(userId);
    if (!existing) {
        return { ...DEFAULT_STATE, mentionedProducts: [] };
    }
    return existing;
}

/**
 * Merges new fields into the user's stored state. Only pass the fields that
 * actually changed this turn -- e.g. a payment_issue turn shouldn't wipe out
 * previously-remembered products, since the user might still say "actually
 * compare it to X" right after asking about payment.
 */
function updateState(userId, partialUpdate) {
    const current = getState(userId);
    const merged = {
        ...current,
        ...partialUpdate,
        updatedAt: new Date().toISOString(),
    };
    stateByUser.set(userId, merged);
    return merged;
}

/**
 * Appends one or more product names to the user's running mentioned-products
 * list, deduplicating (case-insensitive) and keeping only the most recent
 * MAX_REMEMBERED_PRODUCTS. Newly mentioned names are moved to the END of the
 * list, so "most recently discussed" is always the last entry -- this lets
 * handlers distinguish "the one we were just talking about" from "something
 * mentioned several turns ago" without needing timestamps.
 */
function addMentionedProducts(userId, newProductNames) {
    if (!newProductNames || newProductNames.length === 0) {
        return getState(userId);
    }

    const current = getState(userId);
    const existing = current.mentionedProducts || [];

    // Remove any existing occurrence of names we're about to re-add, so they
    // get moved to the end (most recent) instead of duplicated in place.
    const newNamesLower = newProductNames.map((n) => n.toLowerCase());
    const deduped = existing.filter((name) => !newNamesLower.includes(name.toLowerCase()));

    const updatedList = [...deduped, ...newProductNames].slice(-MAX_REMEMBERED_PRODUCTS);

    return updateState(userId, { mentionedProducts: updatedList });
}

/**
 * Records the order_id most recently discussed, regardless of WHICH handler
 * discussed it (order tracking, returns, or payments). This lets a later
 * "is THAT order shipped yet" or "what about its return status" -- with no
 * order number repeated -- resolve correctly across intents, not just
 * within the same one.
 */
function setLastOrderId(userId, orderId) {
    return updateState(userId, { lastOrderId: orderId });
}

function clearState(userId) {
    stateByUser.delete(userId);
}

/**
 * Records that the bot just asked the user a clarifying question, along
 * with the REAL candidates (DB-verified names/ids) the question was about.
 * This is the fix for a specific observed failure: a handler asks "did you
 * mean X and Y?", the user replies with a short confirmation like "yes" or
 * "yes this two" -- which contains NO product name or order number at all --
 * and the next turn's handler has nothing to resolve, since it only looks
 * for entities IN the current message or in the general mentionedProducts
 * history, not specifically "the thing I just asked about."
 *
 * `kind` identifies what KIND of clarification is pending (e.g.
 * 'product_comparison'), so a handler only consumes a pending clarification
 * that's actually relevant to it -- a payment_issue handler should never
 * accidentally resolve a pending product comparison question.
 */
function setPendingClarification(userId, kind, candidates) {
    return updateState(userId, {
        pendingClarification: { kind, candidates, askedAt: new Date().toISOString() },
    });
}

function clearPendingClarification(userId) {
    return updateState(userId, { pendingClarification: null });
}

// Short confirmation phrases that, on their own, carry no entity information
// but DO signal "proceed with what you just asked me about." Deliberately
// a small, explicit list rather than trying to detect "shortness" generically
// -- a short message isn't always a confirmation (e.g. "107" is short and IS
// an entity), so we only special-case phrases that are CLEARLY agreement/
// continuation with no informational content of their own.
const CONFIRMATION_PHRASES = [
    'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'go ahead',
    'please do', 'sounds good', 'that one', 'those two', 'correct',
];

/**
 * Returns true if `message` is essentially just a bare confirmation with no
 * other meaningful content -- e.g. "yes", "yes this two", "sure go ahead".
 * Strips the message down and checks if what's left is empty or only made
 * of small connector words, after removing a known confirmation phrase.
 */
function isBareConfirmation(message) {
    if (!message) return false;
    const cleaned = message.toLowerCase().trim().replace(/[!.?]/g, '');

    for (const phrase of CONFIRMATION_PHRASES) {
        if (cleaned === phrase || cleaned.startsWith(phrase + ' ')) {
            const remainder = cleaned.slice(phrase.length).trim();
            // Allow trailing filler like "this two", "that", "please" with
            // no real new entity info -- if the remainder contains any
            // digit (likely an order number) or is suspiciously long
            // (likely new, real content), don't treat it as bare.
            const looksLikeNewEntity = /\d/.test(remainder) || remainder.split(/\s+/).length > 3;
            if (!looksLikeNewEntity) {
                return true;
            }
        }
    }
    return false;
}

module.exports = {
    getState,
    updateState,
    addMentionedProducts,
    setLastOrderId,
    clearState,
    setPendingClarification,
    clearPendingClarification,
    isBareConfirmation,
};