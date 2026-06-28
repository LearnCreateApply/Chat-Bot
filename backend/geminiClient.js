const OpenAI = require('openai');

// ---------------------------------------------------------------------------
// Model config
// ---------------------------------------------------------------------------
const GEMINI_MODEL = 'gemini-2.5-flash';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b'; // swap to any model you have pulled
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';

// ---------------------------------------------------------------------------
// Clients (lazy-initialised so missing keys don't crash at import time)
// ---------------------------------------------------------------------------
let _geminiClient = null;
let _ollamaClient = null;

function getGeminiClient() {
  if (!_geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set in environment variables.');

    _geminiClient = new OpenAI({
      apiKey,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    });
  }
  return _geminiClient;
}

function getOllamaClient() {
  if (!_ollamaClient) {
    // Ollama's OpenAI-compatible endpoint doesn't need a real key
    _ollamaClient = new OpenAI({
      apiKey: 'ollama',
      baseURL: OLLAMA_BASE_URL,
    });
  }
  return _ollamaClient;
}

// ---------------------------------------------------------------------------
// Retry / sleep helpers
// ---------------------------------------------------------------------------
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500; // doubles each attempt: 1.5 s -> 3 s -> 6 s

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true for transient errors worth retrying:
 *   429 - rate-limited
 *   503 - overloaded / unavailable
 *   OpenAI SDK wraps HTTP errors in typed subclasses; we check both paths.
 */
function isRetryable(error) {
  const status = error?.status ?? error?.response?.status;
  return status === 429 || status === 503;
}

// ---------------------------------------------------------------------------
// Core call helper (shared by both providers)
// ---------------------------------------------------------------------------
async function callWithRetry(client, model, prompt, providerName) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = completion.choices?.[0]?.message?.content;
      if (!text) throw new Error(`${providerName} response did not contain expected text content.`);

      return text.trim();
    } catch (error) {
      lastError = error;

      console.error(
        `${providerName} error (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
        error?.status ?? error?.message
      );

      if (!isRetryable(error) || attempt === MAX_RETRIES) break;

      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      console.log(`Retrying ${providerName} in ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a reply using Gemini (primary) with Ollama as a local fallback.
 *
 * IMPORTANT (per spec Section 6.4): `prompt` must only ever be built from
 * the already-clean context string and the user's message -- never raw DB
 * rows or schema. promptBuilder.js is responsible for assembling a safe
 * prompt before it reaches here.
 *
 * @param {string} prompt - Pre-sanitised prompt from promptBuilder.js
 * @returns {Promise<string>} - The generated reply text
 */
async function generateReply(prompt) {
  // Primary: Gemini via OpenAI-compatible endpoint
  if (process.env.GEMINI_API_KEY) {
    try {
      console.log(`Calling Gemini (${GEMINI_MODEL})...`);
      const reply = await callWithRetry(getGeminiClient(), GEMINI_MODEL, prompt, 'Gemini');
      return reply;
    } catch (error) {
      console.warn(
        `Gemini failed after retries (${error?.status ?? error?.message}). Falling back to Ollama...`
      );
    }
  } else {
    console.warn('GEMINI_API_KEY not set -- skipping Gemini, going straight to Ollama fallback.');
  }

  // Fallback: local Ollama
  try {
    console.log(`Calling Ollama (${OLLAMA_MODEL} @ ${OLLAMA_BASE_URL})...`);
    const reply = await callWithRetry(getOllamaClient(), OLLAMA_MODEL, prompt, 'Ollama');
    return reply;
  } catch (error) {
    throw new Error(
      `Both Gemini and Ollama failed. Ollama error: ${error?.message ?? 'unknown'}. ` +
        `Make sure Ollama is running locally on ${OLLAMA_BASE_URL} with model "${OLLAMA_MODEL}" pulled.`
    );
  }
}

module.exports = { generateReply };