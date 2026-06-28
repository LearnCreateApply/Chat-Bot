const handleProductRecommendation = require('./handlers/productRecommendation');
const handleProductComparison = require('./handlers/productComparison');
const handleOrderTracking = require('./handlers/orderTracking');
const handleReturnPolicy = require('./handlers/returnPolicy');
const handlePaymentIssue = require('./handlers/paymentIssue');

// Maps each intent label to the handler function responsible for producing
// its context string. Mirrors roleMap.js's structure intentionally, so both
// lookups read the same way at the call site in server.js.
const handlerMap = {
    "product_recommendation": handleProductRecommendation,
    "product_comparison": handleProductComparison,
    "order_tracking": handleOrderTracking,
    "return_policy": handleReturnPolicy,
    "payment_issue": handlePaymentIssue,
};

module.exports = handlerMap;