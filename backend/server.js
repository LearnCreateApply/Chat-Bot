require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { classifyIntent } = require('./intentClient');
const roleMap = require('./roleMap');
const handlerMap = require('./handlerMap');
const { buildPrompt, buildDeflectionPrompt, buildMemoryAwareDeflectionPrompt } = require('./promptBuilder');
const { generateReply } = require('./geminiClient');
const { getState, updateState, addMentionedProducts } = require('./conversationState');
const { getProductDetailsByNames } = require('./productLookup');
const productComparisonHandler = require('./handlers/productComparison');
const productRecommendationHandler = require('./handlers/productRecommendation');
const orderTrackingHandler = require('./handlers/orderTracking');

const app = express();

app.use(express.json());
app.use(cors());

// The main chat endpoint
app.post('/chat', async (req, res) => {
    try {
        const { message, user_id } = req.body;

        if (!message || !user_id) {
            return res.status(400).json({ error: "Missing 'message' or 'user_id' in request body." });
        }

        console.log(`\n--- Received message from user ${user_id}: "${message}"`);

        // 1. Classify intent via the Python intent service
        const { intent, confidence, low_confidence } = await classifyIntent(message);

        console.log(`Classified as [${intent}] (Confidence: ${confidence.toFixed(3)}, low_confidence: ${low_confidence})`);

        // 1b. DEFLECTION PATH: if the classifier wasn't confident the message
        // matches ANY of the 5 known intents, don't force it into one and
        // don't run a handler at all. BUT first check conversation memory --
        // a common real pattern is the user assuming the bot can "see" the
        // chat the same way they can (e.g. "is it good for sensitive skin"
        // right after a product was just discussed, with no product name
        // in THIS message). If we have real, DB-verified product names in
        // memory, we tell Gemini about them so it can ask a SPECIFIC
        // clarifying question instead of acting like nothing was ever
        // discussed. If memory is empty, fall back to the original generic
        // deflection. Either way, Gemini never receives raw chat history --
        // only the same small, verified product-name list every other
        // handler already uses.
        if (low_confidence) {
            const state = getState(user_id);
            const productDetails = getProductDetailsByNames(state.mentionedProducts || []);

            const deflectionPrompt = productDetails.length > 0
                ? buildMemoryAwareDeflectionPrompt(message, productDetails)
                : buildDeflectionPrompt(message);

            const reply = await generateReply(deflectionPrompt);

            return res.json({
                reply,
                intent: 'deflected',
                role: null,
                low_confidence: true,
            });
        }

        // 2. Map intent -> role
        const role = roleMap[intent] || "Unknown Role";

        // 3. Run the matching DB handler to get a clean context string.
        //    product_comparison reads structured conversation state
        //    (mentionedProducts) to resolve follow-ups like "that gel wash
        //    from earlier" -- no raw chat history is involved, only a small
        //    DB-verified product name list. See conversationState.js for why
        //    this is safe.
        const handler = handlerMap[intent];
        if (!handler) {
            return res.status(500).json({ error: `No handler registered for intent: ${intent}` });
        }
        const context = handler(user_id, { message });

        // 4. Build the Gemini prompt from ONLY the clean context string + the
        //    user's message (per spec Section 6.4 -- never raw DB data here,
        //    and never raw conversation history either).
        const prompt = buildPrompt(role, context, message);

        // 5. Call Gemini to get the final natural-language reply
        const reply = await generateReply(prompt);

        // 6. Update structured conversation state for the NEXT turn.
        //
        //    mentionedProducts accumulates REAL, DB-verified product names
        //    across the whole session (capped, deduplicated -- see
        //    conversationState.js), sourced from THREE places so the bot can
        //    resolve follow-ups regardless of how a product first came up:
        //      - product_comparison: names the USER typed this turn
        //      - product_recommendation: names the BOT just suggested
        //      - order_tracking: the product name tied to their most recent order
        if (intent === 'product_comparison') {
            const matchedNames = productComparisonHandler.resolveMatchedProductNames(user_id, message);
            if (matchedNames.length > 0) {
                addMentionedProducts(user_id, matchedNames);
            }
            updateState(user_id, { lastIntent: intent });
        } else if (intent === 'product_recommendation') {
            const recommendedNames = productRecommendationHandler.getRecommendedProductNames(user_id, { message });
            if (recommendedNames.length > 0) {
                addMentionedProducts(user_id, recommendedNames);
            }
            updateState(user_id, { lastIntent: intent });
        } else if (intent === 'order_tracking') {
            const productName = orderTrackingHandler.getMostRecentOrderProductName(user_id);
            if (productName) {
                addMentionedProducts(user_id, [productName]);
            }
            updateState(user_id, { lastIntent: intent });
        }

        // 7. Return the final response shape per spec Section 6.2, plus
        //    low_confidence so the frontend can offer the fallback buttons.
        res.json({
            reply,
            intent,
            role,
            low_confidence,
        });

    } catch (error) {
        console.error("Error processing /chat:", error.message);
        res.status(500).json({ error: "Internal server error" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});