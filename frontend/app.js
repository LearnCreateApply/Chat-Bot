const BACKEND_URL = 'http://localhost:3000/chat';

// One representative phrase per intent -- tapping a button sends this exact
// text through the SAME /chat call as typed free text. No separate code
// path for buttons vs typing, per the spec's hard requirement.
const QUICK_REPLIES = [
  { label: 'Get Recommendations', message: 'what moisturizer works for my skin' },
  { label: 'Compare Products', message: 'compare two products for me' },
  { label: 'Track My Order', message: 'where is my order' },
  { label: 'Return Policy', message: 'how do I return this product' },
  { label: 'Payment Help', message: 'my payment failed' },
];

const ROLE_CLASS_MAP = {
  Sales: 'sales',
  'Customer Care': 'customer-care',
  Support: 'support',
};

const chatPanel = document.getElementById('chatPanel');
const quickRepliesEl = document.getElementById('quickReplies');
const composerForm = document.getElementById('composerForm');
const messageInput = document.getElementById('messageInput');
const userPicker = document.getElementById('userPicker');
const landingShell = document.getElementById('landingShell');
const appShell = document.getElementById('appShell');
const startChatBtn = document.getElementById('startChatBtn');

let quickRepliesShown = false;

function renderQuickReplies() {
  quickRepliesEl.innerHTML = '';
  QUICK_REPLIES.forEach(({ label, message }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quick-reply-btn';
    btn.textContent = label;
    // Tapping pre-fills + submits through the exact same sendMessage() path
    // used by typed input -- see composerForm submit handler below.
    btn.addEventListener('click', () => sendMessage(message));
    quickRepliesEl.appendChild(btn);
  });
  quickRepliesEl.classList.remove('hidden');
}

function hideQuickReplies() {
  quickRepliesEl.classList.add('hidden');
}

function addMessage(role, text, roleBadge) {
  const row = document.createElement('div');
  row.className = `message-row ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  row.appendChild(bubble);

  if (role === 'bot' && roleBadge) {
    const badge = document.createElement('span');
    const badgeClass = ROLE_CLASS_MAP[roleBadge] || 'support';
    badge.className = `role-badge ${badgeClass}`;
    badge.textContent = roleBadge;
    row.appendChild(badge);
  }

  chatPanel.appendChild(row);
  chatPanel.scrollTop = chatPanel.scrollHeight;
  return row;
}

function showTypingIndicator() {
  const row = document.createElement('div');
  row.className = 'message-row bot typing-indicator';
  row.innerHTML = `
    <div class="bubble">
      <span class="dot"></span><span class="dot"></span><span class="dot"></span>
    </div>
  `;
  chatPanel.appendChild(row);
  chatPanel.scrollTop = chatPanel.scrollHeight;
  return row;
}

/**
 * The single send path for EVERY message, whether it came from a quick-reply
 * button tap or typed free text. This is intentional per the spec: button
 * taps must not have separate logic from typed input.
 */
async function sendMessage(messageText) {
  const trimmed = messageText.trim();
  if (!trimmed) return;

  // Once the user sends any message (button or typed), the onboarding
  // buttons have done their job and should not reappear after every turn.
  if (quickRepliesShown) {
    hideQuickReplies();
  }

  addMessage('user', trimmed);
  messageInput.value = '';

  const typingRow = showTypingIndicator();
  const userId = parseInt(userPicker.value, 10);

  try {
    const response = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: trimmed, user_id: userId }),
    });

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    const data = await response.json();
    typingRow.remove();

    addMessage('bot', data.reply, data.role);

    // Optional low-confidence fallback: if the backend signals the
    // classification was uncertain, re-surface the quick-reply buttons
    // alongside a clarifying note so the user has an easy way to disambiguate.
    if (data.low_confidence) {
      addMessage('bot', "Not sure I quite caught that — did you mean one of these?", null);
      renderQuickReplies();
    }
  } catch (err) {
    typingRow.remove();
    addMessage(
      'bot',
      "Sorry, I'm having trouble reaching the server right now. Please try again in a moment.",
      null
    );
    console.error('Chat request failed:', err);
  }
}

composerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage(messageInput.value);
});

// Bot's opening message + quick-reply buttons, shown ONCE per session,
// the first time the chat becomes visible.
let chatInitialized = false;
function initChat() {
  if (chatInitialized) return;
  chatInitialized = true;
  addMessage(
    'bot',
    "Hi! I'm Lumière, your skincare concierge. I can help with recommendations, orders, returns, and more. What can I help with today?",
    null
  );
  quickRepliesShown = true;
  renderQuickReplies();
}

// Landing page CTA swaps the landing view for the chat app and starts it.
startChatBtn.addEventListener('click', () => {
  landingShell.classList.add('hidden');
  appShell.classList.remove('hidden');
  initChat();
  messageInput.focus();
});