"""
Run this on your machine (where the real all-MiniLM-L6-v2 model downloads
fine) to compare OLD raw-score behavior vs NEW margin-based confidence on
the exact messages you tested earlier.

Usage:
    cd intent-service
    python3 test_confidence_comparison.py
"""

from embeddings import classify_intent_debug

test_messages = [
    "I need a cream for peeling skin",
    "put the hyaluronic acid side by side with the niacinamide",
    "where the heck is my stuff?",
    "it said declined but the money left my bank",
    "I bought the wrong thing, need to swap it",
    "I want my money back",
]

print(f"{'MESSAGE':55} {'INTENT':25} {'RAW TOP':>8} {'MARGIN':>8}")
print("-" * 100)
for msg in test_messages:
    result = classify_intent_debug(msg)
    print(
        f"{msg[:53]:55} "
        f"{result['predicted_intent']:25} "
        f"{result['raw_top_score']:>8.3f} "
        f"{result['margin_confidence']:>8.3f}"
    )

print("\nFull breakdown per message:\n")
for msg in test_messages:
    result = classify_intent_debug(msg)
    print(f"'{msg}'")
    print(f"  predicted: {result['predicted_intent']}  (margin: {result['margin_confidence']:.3f})")
    print(f"  runner-up: {result['runner_up_intent']}  ({result['runner_up_score']:.3f})")
    print(f"  all scores: { {k: round(v, 3) for k, v in result['all_scores'].items()} }")
    print()