require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { classifyIntent } = require('./intentClient');
const { generateReply } = require('./geminiClient');
const { handleChatMessage } = require('./chatController');

const app = express();

app.use(express.json());
app.use(cors());

app.post('/chat', async (req, res) => {
    try {
        const { message, user_id } = req.body;

        if (!message || !user_id) {
            return res.status(400).json({ error: "Missing 'message' or 'user_id' in request body." });
        }

        console.log(`\n--- Received message from user ${user_id}: "${message}"`);

        const result = await handleChatMessage({
            message,
            userId: user_id,
            classifyIntent,
            generateReply,
        });

        console.log(`Classified as [${result._debug.classifiedIntent}] (Confidence: ${result._debug.confidence.toFixed(3)}, low_confidence: ${result.low_confidence})`);
        if (result._debug.clarificationOverride) {
            console.log(`Bare confirmation detected with a pending clarification -- overrode classifier to [${result.intent}].`);
        }

        // _debug is for internal/test use only -- never sent to the client.
        const { _debug, ...clientResult } = result;
        res.json(clientResult);

    } catch (error) {
        console.error("Error processing /chat:", error.message);
        res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Internal server error" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});