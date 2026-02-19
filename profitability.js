/**
 * Vinted Profitability Engine
 * Analiza opłacalności ofert na Vinted
 */

// Opłaty Vinted (Buyer Protection Fee)
const VINTED_FEE_PERCENT = 0.05; // 5%
const VINTED_FEE_FIXED = 0.70;   // €0.70

// Premium brands get higher resale potential
const PREMIUM_BRANDS = [
    'nike', 'adidas', 'puma', 'new balance', 'jordan', 'the north face',
    'patagonia', 'carhartt', 'stussy', 'supreme', 'palace', 'ralph lauren',
    'tommy hilfiger', 'calvin klein', 'levi\'s', 'converse', 'vans',
    'dr. martens', 'timberland', 'lacoste', 'hugo boss', 'gucci',
    'louis vuitton', 'balenciaga', 'prada', 'burberry', 'versace',
    'dolce & gabbana', 'yves saint laurent', 'dior', 'fendi', 'givenchy',
    'off-white', 'stone island', 'moncler', 'canada goose', 'arcteryx',
    'zara', 'h&m', 'reserved', 'sinsay', 'bershka', 'pull&bear'
];

const LUXURY_BRANDS = [
    'gucci', 'louis vuitton', 'balenciaga', 'prada', 'burberry', 'versace',
    'dolce & gabbana', 'yves saint laurent', 'dior', 'fendi', 'givenchy',
    'hermes', 'chanel', 'bottega veneta', 'valentino', 'alexander mcqueen',
    'moncler', 'stone island', 'off-white'
];

// Condition multipliers
const CONDITION_MULTIPLIERS = {
    'new_with_tags': 1.0,    // Nowy z metkami
    'new_without_tags': 0.9, // Nowy bez metek
    'very_good': 0.75,       // Bardzo dobry
    'good': 0.6,             // Dobry
    'satisfactory': 0.4      // Zadowalający
};

/**
 * Calculate buyer's total cost including Vinted fees
 */
function calculateTotalCost(price) {
    const fee = (price * VINTED_FEE_PERCENT) + VINTED_FEE_FIXED;
    return {
        itemPrice: price,
        buyerFee: Math.round(fee * 100) / 100,
        totalCost: Math.round((price + fee) * 100) / 100
    };
}

/**
 * Get brand tier (luxury, premium, regular)
 */
function getBrandTier(brandName) {
    if (!brandName) return 'regular';
    const lower = brandName.toLowerCase();
    if (LUXURY_BRANDS.some(b => lower.includes(b))) return 'luxury';
    if (PREMIUM_BRANDS.some(b => lower.includes(b))) return 'premium';
    return 'regular';
}

/**
 * Calculate profitability score (1-10)
 * @param {Object} item - Item data
 * @param {number} medianPrice - Median price of similar items
 * @returns {Object} profitability analysis
 */
function analyzeProfitability(item, medianPrice) {
    const price = parseFloat(item.price || item.total_item_price || 0);
    const favourites = parseInt(item.favourite_count || item.favorites || 0);
    const brandName = item.brand_title || item.brand || '';
    const condition = item.status || item.condition || 'good';

    // 1. Price vs Median (0-4 points)
    let priceScore = 0;
    if (medianPrice > 0) {
        const priceRatio = price / medianPrice;
        if (priceRatio <= 0.4) priceScore = 4;       // 60%+ below median
        else if (priceRatio <= 0.6) priceScore = 3;   // 40-60% below
        else if (priceRatio <= 0.75) priceScore = 2.5; // 25-40% below
        else if (priceRatio <= 0.9) priceScore = 2;    // 10-25% below
        else if (priceRatio <= 1.0) priceScore = 1;    // at median
        else if (priceRatio <= 1.15) priceScore = 0.5; // slightly above
        else priceScore = 0;                            // well above median
    } else {
        priceScore = 2; // no median available, neutral
    }

    // 2. Brand value (0-2 points)
    const brandTier = getBrandTier(brandName);
    let brandScore = 0;
    if (brandTier === 'luxury') brandScore = 2;
    else if (brandTier === 'premium') brandScore = 1.5;
    else brandScore = 0.5;

    // 3. Popularity/demand - favourites/hearts (0-2 points)
    let popularityScore = 0;
    if (favourites >= 50) popularityScore = 2;
    else if (favourites >= 20) popularityScore = 1.5;
    else if (favourites >= 10) popularityScore = 1;
    else if (favourites >= 5) popularityScore = 0.5;
    else popularityScore = 0;

    // 4. Condition (0-2 points)
    const conditionKey = Object.keys(CONDITION_MULTIPLIERS).find(k =>
        condition.toLowerCase().includes(k.replace(/_/g, ' ')) ||
        condition.toLowerCase().includes(k)
    ) || 'good';
    const condMult = CONDITION_MULTIPLIERS[conditionKey] || 0.6;
    let conditionScore = condMult * 2;

    // Total score (1-10)
    const rawScore = priceScore + brandScore + popularityScore + conditionScore;
    const score = Math.max(1, Math.min(10, Math.round(rawScore * 10) / 10));

    // Calculate potential resale value
    const resaleMultiplier = (brandTier === 'luxury' ? 1.3 : brandTier === 'premium' ? 1.1 : 0.9);
    const estimatedResalePrice = Math.round(medianPrice * condMult * resaleMultiplier * 100) / 100;

    // Calculate potential profit
    const costs = calculateTotalCost(price);
    const potentialProfit = Math.round((estimatedResalePrice - costs.totalCost) * 100) / 100;
    const profitMargin = estimatedResalePrice > 0
        ? Math.round((potentialProfit / costs.totalCost) * 100)
        : 0;

    // SCAM DETECTION
    const scamRisk = detectScamRisk(item, medianPrice);

    return {
        score,
        priceScore,
        brandScore,
        popularityScore,
        conditionScore,
        costs,
        medianPrice: Math.round(medianPrice * 100) / 100,
        estimatedResalePrice,
        potentialProfit,
        profitMargin,
        brandTier,
        condition: conditionKey,
        favourites,
        scamRisk,
        isProfitable: score >= 5 && scamRisk.level !== 'high',
        verdict: scamRisk.level === 'high' ? 'PODEJRZANA (SCAM?)' :
            score >= 8 ? 'ŚWIETNA OKAZJA' :
                score >= 6 ? 'OPŁACALNE' :
                    score >= 5 ? 'NEUTRALNE' :
                        score >= 3 ? 'RYZYKOWNE' : 'NIEOPŁACALNE'
    };
}

/**
 * Detect potential scam risk based on price, brand and user reputation
 */
function detectScamRisk(item, median) {
    const price = parseFloat(item.price || item.total_item_price || 0);
    const brandName = (item.brand_title || item.brand || '').toLowerCase();
    const feedback = item.user?.feedback_reputation || item.feedback_reputation || 0;
    const brandTier = getBrandTier(brandName);
    const description = (item.description || '').toLowerCase();

    const reasons = [];
    let riskLevel = 'none'; // none, low, medium, high

    // 1. Price too good to be true
    if (median > 0 && price > 0) {
        const ratio = price / median;
        if (brandTier === 'luxury' && ratio < 0.35) {
            reasons.push('Cena nierealnie niska dla marki luksusowej');
            riskLevel = 'high';
        } else if (brandTier === 'premium' && ratio < 0.3) {
            reasons.push('Cena znacznie poniżej wartości rynkowej');
            riskLevel = 'medium';
        }
    }

    // 2. No feedback + high value
    if (feedback === 0 && price > 150) {
        reasons.push('Nowy sprzedawca (0 opinii) przy drogim przedmiocie');
        riskLevel = riskLevel === 'high' ? 'high' : 'medium';
    }

    // 3. Suspicious keywords in description
    const scamKeywords = ['blik', 'priv', 'wiadomość prywatna', 'whatsapp', 'zewnętrzny', 'poza vinted', 'przelew', 'kontakt'];
    const foundKeywords = scamKeywords.filter(kw => description.includes(kw));
    if (foundKeywords.length >= 2 && feedback < 5) {
        reasons.push('Opis sugeruje płatność/kontakt poza systemem Vinted');
        riskLevel = 'high';
    }

    // 4. Designer items for very low price
    if (LUXURY_BRANDS.some(l => brandName.includes(l)) && price < 100) {
        reasons.push('Marka luksusowa w podejrzanie niskiej cenie');
        riskLevel = 'high';
    }

    return {
        level: riskLevel,
        reasons,
        isSuspicious: riskLevel !== 'none'
    };
}

/**
 * Calculate median from array of prices
 */
function calculateMedian(prices) {
    if (!prices || prices.length === 0) return 0;
    const sorted = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Filter unprofitable items from favorites
 * @param {Array} items - Array of items with profitability analysis
 * @param {number} threshold - Minimum score to keep (default 5)
 * @returns {Object} { keep: [], remove: [] }
 */
function filterUnprofitable(items, threshold = 5) {
    const keep = [];
    const remove = [];

    for (const item of items) {
        if (item.analysis && item.analysis.score >= threshold) {
            keep.push(item);
        } else {
            remove.push(item);
        }
    }

    return { keep, remove };
}

module.exports = {
    analyzeProfitability,
    calculateTotalCost,
    calculateMedian,
    filterUnprofitable,
    getBrandTier,
    detectScamRisk,
    PREMIUM_BRANDS,
    LUXURY_BRANDS
};
