// Shared vocabulary mapping everyday words to the REAL category values
// stored in products.category. Originally lived only inside
// productRecommendation.js; extracted here so order/return/payment
// handlers can ALSO resolve category references (e.g. "my sunscreen
// order") using the exact same vocabulary, instead of duplicating (and
// risking drifting) a second copy.
const CATEGORY_KEYWORDS = {
    cleanser: ['cleanser', 'face wash', 'facewash', 'wash', 'cleansing'],
    serum: ['serum'],
    moisturizer: ['moisturizer', 'moisturiser', 'cream', 'lotion'],
    sunscreen: ['sunscreen', 'sunblock', 'spf', 'sun cream', 'sun gel'],
    toner: ['toner', 'toning'],
    mask: ['mask', 'masque'],
    mist: ['mist', 'spray'],
    treatment: ['treatment', 'spot treatment', 'blemish'],
    haircare: ['hair', 'haircare', 'shampoo', 'conditioner'],
    makeup: ['makeup', 'make-up', 'lipstick', 'lip balm', 'mascara'],
};

function detectCategory(message) {
    if (!message) return null;
    const msgLower = message.toLowerCase();
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (keywords.some((kw) => msgLower.includes(kw))) {
            return category;
        }
    }
    return null;
}

module.exports = { CATEGORY_KEYWORDS, detectCategory };