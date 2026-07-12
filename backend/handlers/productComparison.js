const db = require('../db');
const { getState, setPendingClarification, clearPendingClarification, isBareConfirmation } = require('../conversationState');

function formatTwoProductContext(p1, p2, note) {
    // DIRECTIVE INSTRUCTION -- fix for an observed hedging failure: with
    // just the two products' facts and no explicit instruction, the model
    // sometimes asked the user "did you want a full comparison or just more
    // detail?" even though both products were already clearly identified
    // and there's nothing left to clarify. Both product names came from a
    // real DB match on THIS message (or a resolved memory reference), so
    // there's no ambiguity left to check for -- tell the model to just
    // compare them now.
    return `Comparison Context:${note || ''}\n` +
           `Product A: ${p1.name} ($${p1.price.toFixed(2)}, Rating ${p1.rating}/5) - ${p1.description}\n` +
           `Product B: ${p2.name} ($${p2.price.toFixed(2)}, Rating ${p2.rating}/5) - ${p2.description}\n` +
           `\nBoth products are confirmed -- do NOT ask the user which one they want, whether they want a comparison, or for any other clarification. Directly compare Product A and Product B using only the facts above and state which one is the better fit and why.`;
}

function handleProductComparison(userId, extraParams = {}) {
    const message = extraParams.message || "";
    const msgLower = message.toLowerCase();

    const allProducts = db.prepare('SELECT product_id, name, price, rating, description FROM products').all();

    // PENDING CLARIFICATION CHECK (the fix for "yes this two"-style replies):
    // if the PREVIOUS turn asked the user to confirm which 2 products they
    // meant, and THIS message is a bare confirmation with no entity info of
    // its own ("yes", "yes this two", "go ahead"), resolve directly using
    // the candidates we already stored -- rather than treating this as a
    // brand new, entity-less comparison request and re-asking the same
    // question. See conversationState.js's isBareConfirmation for exactly
    // what counts as "bare."
    const state = getState(userId);
    if (
        state.pendingClarification &&
        state.pendingClarification.kind === 'product_comparison' &&
        isBareConfirmation(message)
    ) {
        const candidateNames = state.pendingClarification.candidates || [];
        if (candidateNames.length === 2) {
            const p1 = allProducts.find((p) => p.name.toLowerCase() === candidateNames[0].toLowerCase());
            const p2 = allProducts.find((p) => p.name.toLowerCase() === candidateNames[1].toLowerCase());
            if (p1 && p2) {
                clearPendingClarification(userId);
                return formatTwoProductContext(
                    p1,
                    p2,
                    ` (Note: the user just confirmed they want this comparison after being asked to clarify -- proceed directly, don't ask again.)`
                );
            }
        }
        // Candidates didn't resolve cleanly for some reason -- fall through
        // to normal handling below rather than silently failing.
    }

    // Check if the user's message contains any of the known product names
    let matchedProducts = allProducts.filter(p => msgLower.includes(p.name.toLowerCase()));

    // ZERO-MATCH MEMORY FALLBACK: loose word-matching against remembered
    // products (e.g. "gel wash" -> "Salicylic Acid Gel Wash").
    let memoryPartialMatches = [];
    if (matchedProducts.length === 0) {
        const remembered = state.mentionedProducts || [];
        memoryPartialMatches = remembered.filter((name) => {
            const nameWords = name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
            return nameWords.some((word) => msgLower.includes(word));
        });
    }

    // MEMORY: if exactly ONE product was named in THIS message, check the
    // running mentionedProducts list for a second candidate.
    let usedMemory = false;
    let ambiguousCandidates = null;

    if (matchedProducts.length === 1) {
        const remembered = (state.mentionedProducts || []).filter(
            (name) => name.toLowerCase() !== matchedProducts[0].name.toLowerCase()
        );

        if (remembered.length === 1) {
            const rememberedProduct = allProducts.find(
                (p) => p.name.toLowerCase() === remembered[0].toLowerCase()
            );
            if (rememberedProduct) {
                matchedProducts = [matchedProducts[0], rememberedProduct];
                usedMemory = true;
            }
        } else if (remembered.length > 1) {
            ambiguousCandidates = remembered;
        }
    }

    // Format the context depending on how many products were resolved
    if (matchedProducts.length === 2) {
        clearPendingClarification(userId); // a clean resolution -- any earlier pending question is now moot
        const [p1, p2] = matchedProducts;
        const memoryNote = usedMemory
            ? ` (Note: the user only named "${p1.name}" this time -- "${p2.name}" is being carried over from what they were just looking at, so phrase the reply as a natural continuation, e.g. "Comparing that to the X you just asked about...".)`
            : '';
        return formatTwoProductContext(p1, p2, memoryNote);
    } else if (matchedProducts.length > 2) {
        const names = matchedProducts.slice(0, 3).map(p => p.name).join(', ');
        return `The user is asking to compare too many items (${names}). Politely ask them to pick just 2 products to compare.`;
    } else if (matchedProducts.length === 1 && ambiguousCandidates) {
        const p1 = matchedProducts[0];
        // We have ONE confirmed product + an ambiguous set of OTHER
        // candidates. We can't fully resolve this turn, but we CAN narrow
        // it: store p1's name plus our best guess from the candidates as
        // the pending clarification, so a future bare "yes" can complete it.
        // We still ask Gemini to try resolving NOW using the user's wording
        // (it might already have enough to answer); the pending state is
        // just a safety net if it instead asks the user to confirm.
        const bestGuess = ambiguousCandidates[ambiguousCandidates.length - 1]; // most recently mentioned
        setPendingClarification(userId, 'product_comparison', [p1.name, bestGuess]);
        return `The user wants to compare ${p1.name} ($${p1.price.toFixed(2)}) against something they mentioned earlier in the conversation, but it's ambiguous which one. ` +
               `The REAL products they discussed earlier are exactly: ${ambiguousCandidates.join(', ')}. ` +
               `Based on the user's current wording ("${message}"), try to determine which ONE of those they most likely mean. If you can tell, proceed with the comparison. If genuinely unclear, ask them to confirm which one -- if they just reply "yes" next, we'll proceed with ${p1.name} vs ${bestGuess}.`;
    } else if (matchedProducts.length === 1) {
        const p1 = matchedProducts[0];
        return `The user wants to compare ${p1.name} ($${p1.price.toFixed(2)}). However, they didn't specify a second specific item, and there was nothing relevant in the recent conversation to fill the gap. Ask them what they want to compare ${p1.name} against.`;
    } else if (memoryPartialMatches.length === 1) {
        const p1 = allProducts.find((p) => p.name.toLowerCase() === memoryPartialMatches[0].toLowerCase());
        const otherCandidates = (state.mentionedProducts || []).filter(
            (name) => name.toLowerCase() !== memoryPartialMatches[0].toLowerCase()
        );
        if (p1 && otherCandidates.length >= 1) {
            return `The user is referring to "${p1.name}" loosely (e.g. "gel wash" rather than the full name) based on earlier conversation. ` +
                   `They want to compare it against something for their skin type, but didn't name the second product explicitly. ` +
                   `Other real products discussed earlier: ${otherCandidates.join(', ')}. ` +
                   `Use the user's wording ("${message}") to pick the most fitting second product from that list (or from the general catalog if none fit), and proceed with a real comparison using ${p1.name} as Product A. ` +
                   `Product A details: ${p1.name} ($${p1.price.toFixed(2)}, Rating ${p1.rating}/5) - ${p1.description}.`;
        }
        return `The user is referring to "${p1.name}" loosely from earlier conversation, but there's nothing else relevant to compare it against. Ask them what they want to compare ${p1.name} against.`;
    } else if (memoryPartialMatches.length >= 2) {
        // Two clear candidates from loose matching -- this is exactly the
        // "compare this two serum - vitamin c and niacinamide 10%" case.
        // Store them as the pending clarification so a follow-up "yes"
        // resolves cleanly, then ask Gemini to proceed directly since we
        // actually do have enough information already.
        if (memoryPartialMatches.length === 2) {
            setPendingClarification(userId, 'product_comparison', [memoryPartialMatches[0], memoryPartialMatches[1]]);
            const p1 = allProducts.find((p) => p.name.toLowerCase() === memoryPartialMatches[0].toLowerCase());
            const p2 = allProducts.find((p) => p.name.toLowerCase() === memoryPartialMatches[1].toLowerCase());
            if (p1 && p2) {
                clearPendingClarification(userId); // we resolved cleanly, no need for the safety net
                return formatTwoProductContext(p1, p2, ` (Note: resolved from earlier conversation -- the user referred to these loosely rather than by exact name.)`);
            }
        }
        return `The user is referring to earlier-discussed products loosely (not by exact name). The REAL products they discussed earlier that seem relevant are exactly: ${memoryPartialMatches.join(', ')}. ` +
               `Based on the user's current wording ("${message}"), determine which products they most likely mean and proceed with a comparison using only names from this list. Do not invent or assume facts about products not in this list.`;
    } else if ((state.mentionedProducts || []).length === 1 && matchedProducts.length === 0) {
        // THE GAP THIS FIX CLOSES: the current message has ZERO entity
        // content at all (no product name, not even a loose keyword match --
        // e.g. "which is best", "is this good") AND memory has exactly ONE
        // product (e.g. the user was just given ONE recommendation, then
        // asked a comparison-shaped follow-up with nothing to compare it
        // against). The earlier memoryPartialMatches branches require
        // memory to already contain a SECOND candidate to disambiguate
        // between -- they don't fire when there's only one. Without this
        // branch, the handler fell through to the generic "didn't mention
        // which items" fallback, which feels broken since the bot DID just
        // recommend something seconds ago.
        //
        // Fix: hand Gemini the one real remembered product's full details,
        // plus the user's skin type, and ask it to either (a) propose a
        // sensible second product from the broader catalog itself isn't
        // possible here since we don't have the full catalog filtered by
        // skin type loaded in this branch -- so instead we ask the user a
        // SPECIFIC question naming the one real product, rather than a
        // generic "please specify" that ignores what was just discussed.
        const onlyRemembered = state.mentionedProducts[0];
        const p1 = allProducts.find((p) => p.name.toLowerCase() === onlyRemembered.toLowerCase());
        if (p1) {
            return `The user was just told about "${p1.name}" and is now asking a comparison-style question ("${message}") with no second product named. ` +
                   `There is nothing else specific in the conversation to compare it against yet. ` +
                   `Acknowledge "${p1.name}" by name (don't make the user repeat it) and ask what they'd like to compare it against -- e.g. another product they have in mind, or whether they'd like you to suggest an alternative in the same category. ` +
                   `Product details for reference: ${p1.name} ($${p1.price.toFixed(2)}, Rating ${p1.rating}/5) - ${p1.description}.`;
        }
        // Remembered name didn't resolve to a real product (stale/edge
        // case) -- fall through to the generic fallback below.
        const defaults = allProducts.slice(0, 2);
        return `The user asked for a product comparison but didn't clearly mention exactly which items. ` +
               `Gently prompt them to provide the names of the two products. For Example: ` +
               `We have ${defaults[0].name} and ${defaults[1].name}.`;
    } else if ((state.mentionedProducts || []).length >= 2 && matchedProducts.length === 0) {
        // BELT-AND-SUSPENDERS FIX: the message named no product at all --
        // not even a loose keyword match (e.g. "is this really the best
        // one", which shares no words with any product name) -- but memory
        // already has multiple REAL products from earlier in the
        // conversation. This case is normally meant to be resolved by the
        // low-confidence + memory-aware deflection path in server.js
        // instead of ever reaching this handler -- but intent
        // classification for vague phrasing like this isn't 100%
        // deterministic. If it DOES land here anyway, we should still use
        // the real remembered group rather than falling through to the
        // generic branch below, which used to suggest two arbitrary,
        // unrelated catalog products that have nothing to do with what was
        // actually just discussed.
        const rememberedDetails = state.mentionedProducts
            .map((name) => allProducts.find((p) => p.name.toLowerCase() === name.toLowerCase()))
            .filter(Boolean);
        if (rememberedDetails.length >= 2) {
            // Best-guess pending clarification, same pattern used elsewhere
            // in this file: if Gemini ends up asking "did you mean X and
            // Y?" instead of resolving directly, a bare "yes" next needs
            // SOMETHING concrete to fall back to. The two most-recently-
            // mentioned products is the most reasonable default guess when
            // nothing in the message itself disambiguates further.
            const recent = state.mentionedProducts.slice(-2);
            setPendingClarification(userId, 'product_comparison', recent);
            const list = rememberedDetails
                .map((p) => `${p.name} ($${p.price.toFixed(2)}, Rating ${p.rating}/5) - ${p.description}`)
                .join('\n');
            return `The user asked a comparison-style question ("${message}") without naming a specific product. These are the REAL products recently discussed in this conversation:\n${list}\nIf their wording can be answered using only these real facts (e.g. "the best one"), answer directly -- name the single best fit and briefly say why, don't just re-list all of them. Do not invent or assume facts about products not in this list. If it's genuinely unclear what they're asking, ask a specific clarifying question using these real product names -- if they just reply "yes" next, we'll proceed with ${recent[0]} vs ${recent[1]}.`;
        }
        const defaults = allProducts.slice(0, 2);
        return `The user asked for a product comparison but didn't clearly mention exactly which items. ` +
               `Gently prompt them to provide the names of the two products. For Example: ` +
               `We have ${defaults[0].name} and ${defaults[1].name}.`;
    } else {
        const defaults = allProducts.slice(0, 2);
        return `The user asked for a product comparison but didn't clearly mention exactly which items. ` +
               `Gently prompt them to provide the names of the two products. For Example: ` +
               `We have ${defaults[0].name} and ${defaults[1].name}.`;
    }
}

function resolveMatchedProductNames(userId, message) {
    const msgLower = (message || "").toLowerCase();
    const db_ = require('../db');
    const allProducts = db_.prepare('SELECT name FROM products').all();
    return allProducts
        .filter((p) => msgLower.includes(p.name.toLowerCase()))
        .map((p) => p.name);
}

module.exports = handleProductComparison;
module.exports.resolveMatchedProductNames = resolveMatchedProductNames;