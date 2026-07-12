const roleMap = require('./roleMap');
const handlerMap = require('./handlerMap');
const { buildPrompt, buildDeflectionPrompt, buildMemoryAwareDeflectionPrompt } = require('./promptBuilder');
const { getState, updateState, addMentionedProducts, isBareConfirmation } = require('./conversationState');
const { getProductDetailsByNames } = require('./productLookup');
const productComparisonHandler = require('./handlers/productComparison');
const productRecommendationHandler = require('./handlers/productRecommendation');
const orderTrackingHandler = require('./handlers/orderTracking');

/**
 * Core per-message chat logic, factored out of the Express route in
 * server.js. WHY: the route handler used to own this logic directly, which
 * meant the only way to exercise it was over real HTTP, with a real
 * classifier hit and a real Gemini call -- so testing routing/memory
 * behavior always required a live model and API key, even though those
 * pieces have nothing to do with intent routing or state management. This
 * version takes classifyIntent and generateReply as PARAMETERS instead of
 * importing them directly, so:
 *   - server.js passes the real ones (intentClient.js, geminiClient.js) in
 *     production, behavior is 100% unchanged.
 *   - a test/demo-rehearsal script can pass in stand-ins (e.g. a fixed
 *     lookup table, or a fake that just echoes the prompt back) to verify
 *     routing, handler context, and conversation memory end-to-end without
 *     network access or an API key.
 *
 * Returns the same shape server.js sends as JSON, plus a `_debug` field
 * (classifiedIntent, confidence, context, prompt, clarificationOverride)
 * that server.js strips before responding -- useful for exactly this kind
 * of inspection.
 */
async function handleChatMessage({ message, userId, classifyIntent, generateReply }) {
    const classified = await classifyIntent(message);
    let intent = classified.intent;
    let confidence = classified.confidence;
    let low_confidence = classified.low_confidence;

    let clarificationOverride = false;
    const stateForClarification = getState(userId);
    if (stateForClarification.pendingClarification && isBareConfirmation(message)) {
        intent = stateForClarification.pendingClarification.kind;
        low_confidence = false;
        clarificationOverride = true;
    }

    if (low_confidence) {
        const state = getState(userId);
        const productDetails = getProductDetailsByNames(state.mentionedProducts || []);

        const deflectionPrompt = productDetails.length > 0
            ? buildMemoryAwareDeflectionPrompt(message, productDetails)
            : buildDeflectionPrompt(message);

        const reply = await generateReply(deflectionPrompt);

        return {
            reply,
            intent: 'deflected',
            role: null,
            low_confidence: true,
            _debug: { classifiedIntent: classified.intent, confidence, prompt: deflectionPrompt, clarificationOverride },
        };
    }

    const role = roleMap[intent] || "Unknown Role";
    const handler = handlerMap[intent];
    if (!handler) {
        const err = new Error(`No handler registered for intent: ${intent}`);
        err.statusCode = 500;
        throw err;
    }
    const context = handler(userId, { message });
    const prompt = buildPrompt(role, context, message);
    const reply = await generateReply(prompt);

    if (intent === 'product_comparison') {
        const matchedNames = productComparisonHandler.resolveMatchedProductNames(userId, message);
        if (matchedNames.length > 0) addMentionedProducts(userId, matchedNames);
        updateState(userId, { lastIntent: intent });
    } else if (intent === 'product_recommendation') {
        const recommendedNames = productRecommendationHandler.getRecommendedProductNames(userId, { message });
        if (recommendedNames.length > 0) addMentionedProducts(userId, recommendedNames);
        updateState(userId, { lastIntent: intent });
    } else if (intent === 'order_tracking') {
        const productName = orderTrackingHandler.getMostRecentOrderProductName(userId);
        if (productName) addMentionedProducts(userId, [productName]);
        updateState(userId, { lastIntent: intent });
    }

    return {
        reply,
        intent,
        role,
        low_confidence,
        _debug: { classifiedIntent: classified.intent, confidence, context, prompt, clarificationOverride },
    };
}

module.exports = { handleChatMessage };