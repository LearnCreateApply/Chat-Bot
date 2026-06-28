from sentence_transformers import SentenceTransformer, util
from intents import INTENTS

print("Loading embedding model (this may take a few seconds on first run)...")
# Load the model once
model = SentenceTransformer('all-MiniLM-L6-v2')

# Precompute embeddings for all example phrases at startup
print("Precomputing phrase embeddings...")
intent_embeddings = {}
for intent_label, phrases in INTENTS.items():
    # compute embeddings for the list of phrases
    embeddings = model.encode(phrases, convert_to_tensor=True)
    intent_embeddings[intent_label] = embeddings
print("Embeddings loaded and ready.")


def classify_intent(message: str) -> tuple[str, float]:
    """
    Embeds the user message, computes cosine similarity against all precomputed
    intent phrases, and returns the best matching intent label and a confidence
    score based on the MARGIN between the top match and the runner-up — not the
    raw top similarity score.

    Why margin instead of raw score: raw cosine similarity between short
    sentence embeddings tends to sit in a compressed range (e.g. 0.2-0.6) even
    for confident, correct matches, because unrelated sentences still share
    some baseline semantic similarity in this embedding space. Treating the raw
    top score as "confidence" produces misleadingly low numbers for perfectly
    good classifications. The gap between the best-matching intent and the
    second-best-matching intent is a much more honest signal: a large gap means
    the message clearly belongs to one intent over all others; a small gap
    means the message is genuinely ambiguous between two intents (e.g. "I want
    my money back" sitting between payment_issue and return_policy).
    """
    # Embed the incoming user message
    message_embedding = model.encode(message, convert_to_tensor=True)

    # Get the best score PER INTENT (not per phrase) so we can compare intents
    # against each other, not just track a single global best phrase.
    per_intent_best = {}
    for intent, stored_embeddings in intent_embeddings.items():
        cosine_scores = util.cos_sim(message_embedding, stored_embeddings)[0]
        per_intent_best[intent] = float(cosine_scores.max())

    # Sort intents by their best score, descending
    ranked = sorted(per_intent_best.items(), key=lambda kv: kv[1], reverse=True)

    best_intent, best_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else 0.0

    # Margin-based confidence: how much better the top intent is vs the runner-up.
    # This is naturally in a more interpretable 0-1-ish range for "how sure are we",
    # independent of the raw similarity scale.
    margin = best_score - second_score

    return best_intent, margin


def classify_intent_debug(message: str) -> dict:
    """
    Same as classify_intent, but returns full diagnostic detail —
    every intent's best score, not just the winner. Useful for tuning
    thresholds and understanding borderline cases (call this from a
    debug/test script, not from the production /classify endpoint).
    """
    message_embedding = model.encode(message, convert_to_tensor=True)

    per_intent_best = {}
    for intent, stored_embeddings in intent_embeddings.items():
        cosine_scores = util.cos_sim(message_embedding, stored_embeddings)[0]
        per_intent_best[intent] = float(cosine_scores.max())

    ranked = sorted(per_intent_best.items(), key=lambda kv: kv[1], reverse=True)
    best_intent, best_score = ranked[0]
    second_intent, second_score = ranked[1] if len(ranked) > 1 else (None, 0.0)

    return {
        "predicted_intent": best_intent,
        "margin_confidence": best_score - second_score,
        "raw_top_score": best_score,
        "runner_up_intent": second_intent,
        "runner_up_score": second_score,
        "all_scores": dict(ranked),
    }