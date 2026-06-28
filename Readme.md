<div align="center">

<br/>

# ✦ Lumière

**skincare concierge · AI chatbot**

<br/>

[![Node.js](https://img.shields.io/badge/Node.js-20+-black?style=flat-square&logo=node.js)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.9+-black?style=flat-square&logo=python)](https://python.org)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-black?style=flat-square&logo=sqlite)](https://sqlite.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-black?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com)
[![Gemini](https://img.shields.io/badge/Gemini_2.5_Flash-black?style=flat-square&logo=google)](https://ai.google.dev)
[![Ollama](https://img.shields.io/badge/Ollama_fallback-black?style=flat-square)](https://ollama.com)
[![Docker](https://img.shields.io/badge/Docker-black?style=flat-square&logo=docker)](https://docker.com)

<br/>

[**Architecture**](#architecture) · [**Setup**](#installation) · [**API**](#api-reference) · [**Docker**](#docker)

<br/>

</div>

---

Lumière is a beauty and skincare brand chatbot with a deliberate constraint at its core: **the LLM is only ever allowed to rephrase facts, never retrieve them.** All data — products, orders, payments, returns — is fetched by deterministic database handlers before the model sees anything. A separate Python microservice classifies intent using sentence embeddings, so the Node backend never touches a classifier.

Five intents are handled. Everything outside them is deflected gracefully, with conversation memory used to ask specific questions rather than generic ones.

---

## Architecture

```
Browser  ──POST /chat {message, user_id}──▶  backend/server.js
                                                    │
                              ┌─────────────────────┤
                              │                     │
                    1. classify intent        read conv. state
                              │               (mentionedProducts,
                   Python / FastAPI            lastOrderId, ...)
                   embeddings + margin               │
                   confidence score                  │
                              │                      │
                    ┌─────────▼──────────────────────▼──────────┐
                    │   low_confidence?                          │
                    │     yes → deflection prompt                │
                    │           (memory-aware if products known) │
                    │     no  → handlerMap[intent](userId, msg)  │
                    │           reads SQLite read-only           │
                    │           returns plain-text context str   │
                    └─────────────────────┬──────────────────────┘
                                          │
                              2. buildPrompt(role, context, msg)
                                 role ← roleMap[intent]
                                 LLM sees: context string + user msg
                                 LLM never sees: raw DB rows or schema
                                          │
                              3. generateReply → Gemini (primary)
                                              → Ollama  (fallback)
                                          │
                              4. update conversation state
                                 addMentionedProducts / setLastOrderId
                                          │
                    Response: { reply, intent, role, low_confidence }
```

**The safety property in one line:** by the time the LLM receives a prompt, a handler has already done every database lookup and formatted the result as readable prose. The model rephrases; it does not retrieve.

---

## How Each Intent Works

| Intent | Role badge | Handler does |
|---|---|---|
| `product_recommendation` | Sales | Detects requested category from message keywords, fetches all matching products for user's skin type from DB — no arbitrary top-N cap that could hide relevant items |
| `product_comparison` | Sales | Resolves up to 2 product names from message + conversation memory, handles bare confirmations ("yes") via pending clarification state |
| `order_tracking` | Customer Care | Extracts order ID or product name from message, falls back to cross-intent `lastOrderId` memory for "that order" references |
| `return_policy` | Customer Care | Same cross-intent order resolution as tracking; appends static policy text to per-order return status |
| `payment_issue` | Support | Same cross-intent resolution; shows most recent transaction with full list if multiple exist |
| *(low confidence)* | — | Memory-aware deflection: if products have been discussed, Gemini gets their real DB-verified details and asks a targeted question |

---

## Conversation Memory

State is stored in-memory per user (resets on restart — a production deploy would use Redis). It tracks:

- **`mentionedProducts`** — running list of DB-verified product names mentioned this session, capped at 8, most-recently-mentioned last. Every name comes from a handler output, never from a previous LLM reply.
- **`lastOrderId`** — the order most recently discussed across *any* intent. Lets "what about that order's payment?" resolve without repeating the order number.
- **`pendingClarification`** — when the bot asks "did you mean X or Y?", stores the real candidates so a bare "yes" on the next turn resolves directly rather than re-asking.

Raw chat history is never appended to prompts. The LLM gets a small structured snapshot of verified facts, not a transcript.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML / CSS / JavaScript |
| Backend | Node.js · Express |
| Intent service | Python · FastAPI · uvicorn |
| Intent classification | `sentence-transformers` (`all-MiniLM-L6-v2`) · `numpy` |
| Database | SQLite · `better-sqlite3` (read-only) |
| LLM — primary | Google Gemini 2.5 Flash |
| LLM — fallback | Ollama (default model: `gemma3:4b`) |
| Containerisation | Docker · Docker Compose |

---

## Project Structure

```
lumiere/
├── backend/
│   ├── handlers/
│   │   ├── orderTracking.js        order ID extraction, cross-intent memory
│   │   ├── paymentIssue.js         payment lookup, same cross-intent resolution
│   │   ├── productComparison.js    2-product resolution, pending clarification state
│   │   ├── productRecommendation.js  category detection, skin-type filtering
│   │   └── returnPolicy.js         return status + static policy text
│   ├── conversationState.js        in-memory state, isBareConfirmation helper
│   ├── db.js                       read-only better-sqlite3 connection
│   ├── geminiClient.js             Gemini primary + Ollama fallback, retry logic
│   ├── handlerMap.js               intent label → handler function
│   ├── intentClient.js             HTTP client for Python intent service
│   ├── productLookup.js            re-fetches current DB details by product name
│   ├── promptBuilder.js            builds role-scoped prompts, deflection prompts
│   ├── roleMap.js                  intent label → agent role
│   ├── server.js                   /chat route, orchestration
│   ├── Dockerfile
│   └── package.json
├── db/
│   ├── beauty_store.db             generated by seed.js — not committed
│   └── seed.js
├── frontend/
│   ├── index.html
│   ├── app.js                      chat UI, role badges, quick-reply buttons
│   └── style.css
├── intent-service/
│   ├── embeddings.py               model loading, cosine similarity, margin confidence
│   ├── intents.py                  intent label → example phrase lists
│   ├── main.py                     FastAPI app, /classify endpoint
│   ├── requirements.txt
│   ├── test.py                     debug script — inspect scores without starting service
│   └── Dockerfile
├── .env                            local secrets — never committed
├── .env.example                    committed template
├── docker-compose.yml
└── .gitignore
```

---

## Prerequisites

- Node.js 18+ and npm
- Python 3.9+
- Ollama running locally with your model pulled (`ollama pull gemma3:4b`), **or** a Gemini API key
- Docker + Docker Compose (for containerised setup)

---

## Installation

**1. Clone**

```bash
git clone <repo-url>
cd lumiere
```

**2. Configure environment**

```bash
cp .env.example .env
# open .env and set GEMINI_API_KEY (and any overrides)
```

**3. Seed the database**

```bash
cd db && npm install && node seed.js && cd ..
```

**4. Install backend dependencies**

```bash
cd backend && npm install && cd ..
```

**5. Install intent service dependencies**

```bash
cd intent-service && pip install -r requirements.txt && cd ..
```

The first run downloads `all-MiniLM-L6-v2` (~80 MB) and precomputes embeddings. Subsequent starts use the local cache.

---

## Environment Variables

`.env.example` — commit this. Never commit `.env`.

```dotenv
# Required if using Gemini as the LLM provider
GEMINI_API_KEY=your_gemini_api_key_here

# Ollama fallback — only set these to override the defaults
# OLLAMA_MODEL=gemma3:4b
# OLLAMA_BASE_URL=http://localhost:11434/v1

# Only needed when running outside Docker
# INTENT_SERVICE_URL=http://localhost:8001/classify

# PORT=3000
```

| Variable | Default | Required |
|---|---|---|
| `GEMINI_API_KEY` | — | Yes (if using Gemini) |
| `OLLAMA_MODEL` | `gemma3:4b` | No |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | No |
| `INTENT_SERVICE_URL` | `http://localhost:8001/classify` | No |
| `PORT` | `3000` | No |

> Gemini is the intended primary provider. The call in `geminiClient.js` is currently commented out — Ollama is active by default. To switch, uncomment the Gemini block and set `GEMINI_API_KEY`.

---

## Running Locally

Three terminals:

```bash
# terminal 1 — intent service
cd intent-service
uvicorn main:app --host 0.0.0.0 --port 8001

# terminal 2 — backend
cd backend
node server.js

# terminal 3 — frontend
# just open frontend/index.html in a browser, no server needed
```

---

## Docker

Docker runs the backend and intent service. The frontend is static HTML — open it directly in a browser.

**Seed the database first (one-time, done locally):**

```bash
cd db && npm install && node seed.js && cd ..
```

**`docker-compose.yml`** (at project root):

```yaml
version: '3.9'

services:
  intent-service:
    build: ./intent-service
    ports:
      - "8001:8001"
    networks:
      - lumiere-net
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8001/docs"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

  backend:
    build: ./backend
    ports:
      - "3000:3000"
    env_file:
      - .env
    environment:
      - INTENT_SERVICE_URL=http://intent-service:8001/classify
      - PORT=3000
    volumes:
      - ./db/beauty_store.db:/app/db/beauty_store.db:ro
    depends_on:
      intent-service:
        condition: service_healthy
    networks:
      - lumiere-net
    restart: unless-stopped

networks:
  lumiere-net:
    driver: bridge
```

**`backend/Dockerfile`:**

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app
RUN addgroup -S lumiere && adduser -S lumiere -G lumiere
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /app/db && chown -R lumiere:lumiere /app
USER lumiere
EXPOSE 3000
CMD ["node", "server.js"]
```

**`intent-service/Dockerfile`:**

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# download model at build time — container starts instantly
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"
COPY . .
EXPOSE 8001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
```

**Start:**

```bash
docker compose up --build
```

The backend waits for the intent service health check before starting. On first build the model is downloaded and baked into the image — subsequent builds use the layer cache.

---

## API Reference

### `POST /chat`

```http
POST http://localhost:3000/chat
Content-Type: application/json

{
  "message": "where is my order",
  "user_id": 1
}
```

| Field | Type | Required |
|---|---|---|
| `message` | string | Yes |
| `user_id` | integer | Yes — must exist in the `users` table |

**200 OK**

```json
{
  "reply": "Your most recent order (#12) for the Vitamin C Serum is currently in transit, arriving by June 30.",
  "intent": "order_tracking",
  "role": "Customer Care",
  "low_confidence": false
}
```

| Field | Description |
|---|---|
| `reply` | Natural-language response from the LLM |
| `intent` | Classified intent, or `"deflected"` for low-confidence queries |
| `role` | `"Sales"` · `"Customer Care"` · `"Support"` · `null` when deflected |
| `low_confidence` | `true` when intent margin < 0.10 — frontend re-surfaces quick-reply buttons |

| Status | Condition |
|---|---|
| `400` | Missing `message` or `user_id` |
| `500` | No handler registered for intent, or both LLM providers failed |

---

## Development & Testing

**Debug intent classification** without starting the full service:

```bash
cd intent-service
python test.py
```

Prints the predicted intent, raw cosine score, margin, runner-up intent, and all per-intent scores for a set of test messages. Use this when tuning `LOW_CONFIDENCE_THRESHOLD` (currently `0.10` in `main.py`) or adding example phrases to `intents.py`.

After editing `intents.py`, restart the intent service — embeddings are precomputed at startup.

**Switch LLM:**
- Gemini: uncomment the Gemini block in `backend/geminiClient.js`, set `GEMINI_API_KEY`
- Different Ollama model: set `OLLAMA_MODEL=<name>` in `.env`, run `ollama pull <name>`

---

## Troubleshooting

**`db/beauty_store.db` not found on backend start**
Run `cd db && node seed.js`. The connection is opened with `fileMustExist: true` and throws immediately if the file is missing.

**`Intent service unavailable` in backend logs**
The Python service isn't running, or `INTENT_SERVICE_URL` is wrong. Inside Docker, the URL must use the service name (`http://intent-service:8001/classify`), not `localhost` — this is set automatically by the compose `environment` block.

**`Both Gemini and Ollama failed`**
Ollama isn't running or the model isn't pulled. Run `ollama serve` and `ollama pull gemma3:4b`.

**All messages return `low_confidence: true`**
The intent phrases in `intents.py` don't cover your test messages well enough, or the threshold is too high. Run `python test.py` to inspect margins, then add more example phrases to the relevant intent.

**Model download hangs on intent service first start**
`all-MiniLM-L6-v2` is ~80 MB from HuggingFace. Needs outbound internet access. When using Docker it's baked into the image at build time, so this only affects bare local installs.

---

## Security Notes

- The database connection is **read-only** (`readonly: true`). No user input touches a write path.
- The LLM **never sees raw DB rows, JSON, or schema.** Every handler returns pre-formatted prose. This is enforced by the architecture, not by prompt instruction.
- `mentionedProducts` in session state is **sourced exclusively from handler outputs**, never from previous LLM replies. This prevents compounding hallucinations across turns.
- `.env` is in `.gitignore`. Only `.env.example` (with placeholder values) belongs in version control.
- Conversation state is **in-memory and process-scoped** — resets on restart, not suitable for multi-instance deployments without an external store like Redis.

---

<div align="center">

<br/>

Built by [**Shivam Ingulkar**](https://github.com/) · Computer Science, VESIT Mumbai

<br/>

</div>