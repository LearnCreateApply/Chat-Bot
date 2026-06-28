const axios = require('axios');

// Default to 8001 (where we started the Python microservice)
const INTENT_SERVICE_URL = process.env.INTENT_SERVICE_URL || 'http://localhost:8001/classify';

async function classifyIntent(message) {
    try {
        const response = await axios.post(INTENT_SERVICE_URL, { message });
        // The API returns { intent, confidence, low_confidence } based on the Python code update
        return response.data;
    } catch (error) {
        console.error('Error calling intent service:', error.message);
        throw new Error('Intent service unavailable');
    }
}

module.exports = { classifyIntent };
