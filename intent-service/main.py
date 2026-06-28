from fastapi import FastAPI
from pydantic import BaseModel
from embeddings import classify_intent

# Below this margin, the top intent isn't meaningfully more likely than the
# runner-up, so the caller (Node backend) should treat this as ambiguous and
# can fall back to showing the quick-reply buttons instead of trusting the
# classification blindly.
#
# This value was picked by inspecting real margin scores on a handful of
# test messages: clearly-worded queries scored margins of ~0.20-0.43, while
# genuinely ambiguous queries (e.g. "I want my money back") scored ~0.05-0.08.
# 0.10 sits cleanly between those two clusters, but this is based on a small
# sample -- re-tune if you start seeing it misfire in practice.
LOW_CONFIDENCE_THRESHOLD = 0.10

app = FastAPI()


class ClassifyRequest(BaseModel):
    message: str


class ClassifyResponse(BaseModel):
    intent: str
    confidence: float
    low_confidence: bool


@app.post("/classify", response_model=ClassifyResponse)
def classify(request: ClassifyRequest) -> ClassifyResponse:
    intent, confidence = classify_intent(request.message)
    return ClassifyResponse(
        intent=intent,
        confidence=confidence,
        low_confidence=confidence < LOW_CONFIDENCE_THRESHOLD,
    )