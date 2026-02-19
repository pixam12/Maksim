/**
 * Vinted Profitability Analyzer - Server
 * Backend Express proksujący do API Vinted z analizą opłacalności
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { analyzeProfitability, calculateMedian, filterUnprofitable, calculateTotalCost } = require('./profitability');

const app = express();
const PORT = process.env.PORT || 3000;

console.log(`[Startup] Serwer startuje na porcie: ${PORT}`);
console.log(`[Startup] Katalog roboczy: ${process.cwd()}`);
console.log(`[Startup] __dirname: ${__dirname}`);

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/health', (req, res) => {
    console.log('[Health] Request odebrany');
    res.send('OK - Server is UP');
});

app.get('/debug', (req, res) => {
    console.log('[Debug] Request odebrany');
    const structure = {
        cwd: process.cwd(),
        dirname: __dirname,
        publicExists: fs.existsSync(path.join(__dirname, 'public')),
        files: fs.readdirSync(__dirname),
        env: {
            PORT: process.env.PORT,
            VINTED_DOMAIN: process.env.VINTED_DOMAIN,
            HAS_COOKIE: !!process.env.VINTED_COOKIE
        }
    };
    res.json(structure);
});

app.get('/', (req, res) => {
    console.log('[Root] Request odebrany');
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        console.error(`[Root] ❌ Nie znaleziono index.html w: ${indexPath}`);
        res.status(404).send(`<h1>Błąd 404</h1><p>Nie znaleziono pliku index.html. Skontaktuj się z administratorem.</p><p>Ścieżka: ${indexPath}</p>`);
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// ========== STATE ==========
let vintedCookie = '';
let vintedDomain = 'www.vinted.pl'; // domyślnie polska wersja
let csrfToken = '';
let sessionCookies = '';

const CONFIG_FILE = path.join(__dirname, 'config.json');

// Load saved config on startup
function loadConfig() {
    // Prioritize environment variables for cloud hosting
    if (process.env.VINTED_COOKIE) {
        vintedCookie = process.env.VINTED_COOKIE;
        console.log('[Config] ☁️ Załadowano cookie ze zmiennych środowiskowych');
    }
    if (process.env.VINTED_DOMAIN) {
        vintedDomain = process.env.VINTED_DOMAIN;
        console.log(`[Config] ☁️ Załadowano domenę: ${vintedDomain} ze zmiennych środowiskowych`);
    }

    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (!vintedCookie && data.cookie) {
                vintedCookie = data.cookie;
                console.log('[Config] 📂 Załadowano cookie z config.json');
            }
            if (data.domain && !process.env.VINTED_DOMAIN) {
                vintedDomain = data.domain;
            }
            console.log(`[Config] ✅ Załadowano zapisaną konfigurację (domain: ${vintedDomain})`);
            return true;
        }
    } catch (e) {
        console.log('[Config] Brak pliku konfiguracji lub błąd odczytu');
    }
    return !!vintedCookie;
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({
            cookie: vintedCookie,
            domain: vintedDomain,
            savedAt: new Date().toISOString()
        }, null, 2));
        console.log('[Config] 💾 Konfiguracja zapisana do config.json');
    } catch (e) {
        console.error('[Config] Błąd zapisu:', e.message);
    }
}

// ========== BACKGROUND TASKS ==========

/**
 * Periodically refresh Vinted session to prevent cookie expiration
 */
async function startSessionKeepAlive() {
    console.log('[Keep-Alive] 🚀 Uruchomiono mechanizm podtrzymywania sesji');
    setInterval(async () => {
        if (vintedCookie) {
            console.log('[Keep-Alive] 🔄 Odświeżanie sesji Vinted...');
            await refreshSession();
        }
    }, 1000 * 60 * 60); // Repet every hour
}

/**
 * Periodically scan favorites for profitability (Cloud background active)
 */
async function startBackgroundMonitor() {
    console.log('[Monitor] 🚀 Uruchomiono monitorowanie ofert w tle');
    setInterval(async () => {
        if (!vintedCookie) return;

        console.log('[Monitor] 🔍 Automatyczny skan ulubionych...');
        try {
            const data = await fetchVinted('/users/current/items/favourites?per_page=50');
            if (data.error) return;

            const items = data.items || [];
            const prices = items.map(i => parseFloat(i.total_item_price || i.price || 0)).filter(p => p > 0);
            const medianPrice = calculateMedian(prices);

            const profitable = items
                .map(item => ({ ...item, analysis: analyzeProfitability(item, medianPrice) }))
                .filter(item => item.analysis.score >= 5);

            if (profitable.length > 0) {
                console.log(`[Monitor] 🔥 Znaleziono ${profitable.length} opłacalnych ofert w ulubionych!`);
                profitable.forEach(p => {
                    console.log(` - [${p.analysis.score}/10] ${p.title} (${p.price} zł) -> Zysk: ~${p.analysis.potentialProfit} zł`);
                });
            } else {
                console.log('[Monitor] ✅ Brak nowych okazji w ulubionych.');
            }
        } catch (err) {
            console.error('[Monitor] Błąd podczas skanowania:', err.message);
        }
    }, 1000 * 60 * 30); // Repeat every 30 minutes
}

// Auto-load on startup
loadConfig();
if (vintedCookie) {
    startSessionKeepAlive();
    startBackgroundMonitor();
}

// Rate limiting
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1200; // 1.2s between requests

async function waitForRateLimit() {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_REQUEST_INTERVAL) {
        await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - elapsed));
    }
    lastRequestTime = Date.now();
}

// ========== VINTED API HELPERS ==========

/**
 * Fetch CSRF token and session cookies from Vinted
 */
async function refreshSession() {
    try {
        console.log('[Session] Pobieranie tokena sesji z Vinted...');

        // First, get the main page to get session cookies
        const mainRes = await fetch(`https://${vintedDomain}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cookie': vintedCookie
            },
            redirect: 'follow'
        });

        // Collect cookies from response
        const setCookies = mainRes.headers.getSetCookie?.() || [];
        if (setCookies.length > 0) {
            const newCookies = setCookies
                .map(c => c.split(';')[0])
                .join('; ');
            sessionCookies = vintedCookie ? `${vintedCookie}; ${newCookies}` : newCookies;
            console.log(`[Session] Pobrano ${setCookies.length} nowych cookies`);
        } else {
            sessionCookies = vintedCookie;
        }

        // Try to get CSRF token from the OAuth token endpoint
        const tokenRes = await fetch(`https://${vintedDomain}/oauth/token`, {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': sessionCookies,
                'Referer': `https://${vintedDomain}/`,
                'Origin': `https://${vintedDomain}`
            },
            body: 'grant_type=client_credentials&client_id=web&scope=public',
            redirect: 'follow'
        });

        if (tokenRes.ok) {
            const tokenData = await tokenRes.json();
            if (tokenData.access_token) {
                csrfToken = tokenData.access_token;
                console.log(`[Session] ✅ Token uzyskany: ${csrfToken.substring(0, 20)}...`);
            }
        } else {
            console.log(`[Session] Token endpoint: ${tokenRes.status} - próbuję alternatywnie...`);
            // Try parsing CSRF from the HTML page
            const html = await mainRes.text().catch(() => '');
            const csrfMatch = html.match(/csrf[_-]token['"]\s*(?:content|value)=['"]([^'"]+)/i)
                || html.match(/"access_token"\s*:\s*"([^"]+)"/);
            if (csrfMatch) {
                csrfToken = csrfMatch[1];
                console.log(`[Session] ✅ Token z HTML: ${csrfToken.substring(0, 20)}...`);
            }
        }

        // Also grab cookies from token response
        const tokenCookies = tokenRes.headers.getSetCookie?.() || [];
        if (tokenCookies.length > 0) {
            const extra = tokenCookies.map(c => c.split(';')[0]).join('; ');
            sessionCookies = `${sessionCookies}; ${extra}`;
        }

        return !!csrfToken;
    } catch (err) {
        console.error('[Session] Błąd:', err.message);
        return false;
    }
}

function getHeaders() {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cookie': sessionCookies || vintedCookie,
        'Referer': `https://${vintedDomain}/`,
        'Origin': `https://${vintedDomain}`,
        'X-Requested-With': 'XMLHttpRequest'
    };

    if (csrfToken) {
        headers['Authorization'] = `Bearer ${csrfToken}`;
    }

    return headers;
}

async function fetchVinted(endpoint) {
    await waitForRateLimit();

    // If no token yet, try to get one
    if (!csrfToken && vintedCookie) {
        await refreshSession();
    }

    const url = `https://${vintedDomain}/api/v2${endpoint}`;
    console.log(`[Vinted API] ${url}`);

    try {
        let response = await fetch(url, {
            headers: getHeaders(),
            redirect: 'follow'
        });

        // If 401, try refreshing the session and retry once
        if (response.status === 401 && vintedCookie) {
            console.log('[Vinted API] 401 - odświeżam sesję...');
            await refreshSession();
            response = await fetch(url, {
                headers: getHeaders(),
                redirect: 'follow'
            });
        }

        if (!response.ok) {
            const errorText = response.statusText;
            console.error(`[Vinted API] Error ${response.status} at ${url}: ${errorText}`);
            return {
                error: true,
                status: response.status,
                message: `Vinted Error: ${errorText} (${response.status}) for ${endpoint}`,
                endpoint: endpoint,
                domain: vintedDomain
            };
        }

        return await response.json();
    } catch (err) {
        console.error(`[Vinted API] Fetch error:`, err.message);
        return { error: true, message: err.message };
    }
}

// ========== PRICE HELPER ==========

/**
 * Extract numeric price from Vinted item (handles object and string formats)
 */
function extractPrice(item) {
    // Try total_item_price first (includes fees)
    let raw = item.total_item_price;
    if (raw && typeof raw === 'object') raw = raw.amount;
    if (raw) {
        const val = parseFloat(String(raw).replace(',', '.'));
        if (!isNaN(val) && val > 0) return val;
    }

    // Try price field
    raw = item.price;
    if (raw && typeof raw === 'object') raw = raw.amount;
    if (raw) {
        const val = parseFloat(String(raw).replace(',', '.'));
        if (!isNaN(val) && val > 0) return val;
    }

    // Try service_fee or total
    raw = item.service_fee || item.total;
    if (raw && typeof raw === 'object') raw = raw.amount;
    if (raw) {
        const val = parseFloat(String(raw).replace(',', '.'));
        if (!isNaN(val) && val > 0) return val;
    }

    return 0;
}

// ========== API ENDPOINTS ==========

// Configure session cookie
app.post('/api/config', (req, res) => {
    const { cookie, domain } = req.body;
    if (cookie) vintedCookie = cookie;
    if (domain) vintedDomain = domain;
    // Reset tokens so they refresh with new cookie
    csrfToken = '';
    sessionCookies = '';
    // Auto-save to file
    saveConfig();
    res.json({
        success: true,
        configured: !!vintedCookie,
        domain: vintedDomain
    });
});

// Check config status
app.get('/api/config/status', (req, res) => {
    res.json({
        configured: !!vintedCookie,
        domain: vintedDomain
    });
});

// ========== AI SEARCH ASSISTANT ==========

const CATEGORY_KEYWORDS = {
    'buty': '1231', 'sneakersy': '1231', 'trampki': '1231', 'adidasy': '1231', 'jordany': '1231',
    'kurtka': '1206', 'kurtki': '1206', 'puchówka': '1206',
    'bluza': '1209', 'bluzy': '1209', 'hoodie': '1209',
    'spodnie': '1213', 'jeansy': '1213', 'dżinsy': '1213',
    'koszulka': '1207', 't-shirt': '1207', 'tshirt': '1207',
    'sukienka': '1225', 'sukienki': '1225',
    'torebka': '1247', 'torba': '1247', 'plecak': '1247',
    'zegarek': '1262', 'zegarki': '1262',
    'czapka': '1271', 'czapki': '1271',
    'szalik': '1274', 'szaliki': '1274',
};

const BRAND_KEYWORDS = {
    'nike': '53', 'adidas': '14', 'puma': '73', 'new balance': '2319',
    'jordan': '7948', 'the north face': '2319', 'tnf': '2319',
    'carhartt': '362', 'stussy': '3903', 'supreme': '3632',
    'ralph lauren': '88', 'tommy hilfiger': '94', 'calvin klein': '27',
    'levis': '60', "levi's": '60', 'converse': '30', 'vans': '99',
    'dr martens': '34', 'timberland': '92', 'lacoste': '57',
    'gucci': '45', 'louis vuitton': '63', 'balenciaga': '319',
    'prada': '72', 'burberry': '23', 'versace': '101',
    'zara': '104', 'h&m': '47', 'reserved': '4535', 'bershka': '20',
    'moncler': '454', 'stone island': '3271', 'off-white': '19067',
    'patagonia': '2105', 'arcteryx': '14188', 'dickies': '257',
    'hugo boss': '207', 'armani': '64', 'diesel': '33',
};

const CONDITION_KEYWORDS = {
    'nowy': '6', 'nowe': '6', 'nowa': '6', 'z metkami': '6', 'nówka': '6', 'nówki': '6',
    'bardzo dobry': '1', 'idealny': '1', 'idealna': '1', 'perfekcyjny': '1',
    'dobry': '2', 'dobra': '2', 'używany': '2', 'używane': '2',
};

const MATERIAL_KEYWORDS = {
    'bawełn': '1', 'cotton': '1',
    'skór': '2', 'skor': '2', 'leather': '2',
    'jedwab': '3', 'silk': '3',
    'wełn': '4', 'wool': '4',
    'jeans': '5', 'dżins': '5', 'denim': '5',
    'lnian': '6', 'len': '6', 'linen': '6',
    'zamsz': '12', 'suede': '12',
    'kaszmir': '19', 'cashmere': '19',
};

const GENDER_KEYWORDS = {
    'męsk': '5', 'mężcz': '5', 'facet': '5', 'dla chłopa': '5',
    'damsk': '1904', 'kobiec': '1904', 'dziewczy': '1904',
    'dziecięc': '1195', 'dzieci': '1195', 'chłopięc': '1195', 'dziewczęc': '1195',
};

const SIZE_KEYWORDS = {
    'xs': 'xs', ' s ': 's', ' m ': 'm', ' l ': 'l', 'xl': 'xl', 'xxl': 'xxl',
    'rozmiar 36': '36', '36': '36', '37': '37', '38': '38', '39': '39', '40': '40',
    '41': '41', '42': '42', '43': '43', '44': '44', '45': '45',
};

app.post('/api/ai-search', (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.json({ error: 'Brak promptu' });

    const lower = prompt.toLowerCase().trim();

    // Extract search parameters from natural language
    let query = lower;
    let params = {};

    // Detect brand
    for (const [keyword, id] of Object.entries(BRAND_KEYWORDS)) {
        if (lower.includes(keyword)) {
            params.brand_ids = id;
            // Remove brand from query to clean it up
            query = query.replace(keyword, '').trim();
            break;
        }
    }

    // Detect category
    for (const [keyword, id] of Object.entries(CATEGORY_KEYWORDS)) {
        if (lower.includes(keyword)) {
            params.catalog_id = id;
            query = query.replace(keyword, '').trim();
            break;
        }
    }

    // Detect condition
    const detectedStatuses = [];
    for (const [keyword, id] of Object.entries(CONDITION_KEYWORDS)) {
        if (lower.includes(keyword)) {
            detectedStatuses.push(id);
            query = query.replace(keyword, '').trim();
        }
    }
    if (detectedStatuses.length > 0) {
        params.status = [...new Set(detectedStatuses)].join(',');
    }

    // Detect material
    const detectedMaterials = [];
    for (const [keyword, id] of Object.entries(MATERIAL_KEYWORDS)) {
        if (lower.includes(keyword)) {
            detectedMaterials.push(id);
            query = query.replace(keyword, '').trim();
        }
    }
    if (detectedMaterials.length > 0) {
        params.material_ids = [...new Set(detectedMaterials)].join(',');
    }

    // Detect gender/base catalog
    for (const [keyword, id] of Object.entries(GENDER_KEYWORDS)) {
        if (lower.includes(keyword)) {
            params.catalog_id = id;
            query = query.replace(keyword, '').trim();
            break;
        }
    }

    // Detect specific categories
    for (const [keyword, id] of Object.entries(CATEGORY_KEYWORDS)) {
        if (lower.includes(keyword)) {
            params.catalog_id = id;
            query = query.replace(keyword, '').trim();
            break;
        }
    }

    // Detect size
    const detectedSizes = [];
    for (const [keyword, id] of Object.entries(SIZE_KEYWORDS)) {
        if (lower.includes(keyword)) {
            detectedSizes.push(id);
            // Don't replace small keywords like ' s ' to avoid mangling query
            if (keyword.length > 2) query = query.replace(keyword, '').trim();
        }
    }
    if (detectedSizes.length > 0) {
        params.size_ids = [...new Set(detectedSizes)].join(',');
    }

    // Detect price range
    const priceMatch = lower.match(/(?:do|max|maks|poniżej|pod)\s*(\d+)\s*(?:zł|pln|złotych)?/);
    if (priceMatch) {
        params.price_to = priceMatch[1];
        query = query.replace(priceMatch[0], '').trim();
    }
    const priceFromMatch = lower.match(/(?:od|min|powyżej|nad)\s*(\d+)\s*(?:zł|pln|złotych)?/);
    if (priceFromMatch) {
        params.price_from = priceFromMatch[1];
        query = query.replace(priceFromMatch[0], '').trim();
    }
    const priceRangeMatch = lower.match(/(\d+)\s*-\s*(\d+)\s*(?:zł|pln|złotych)?/);
    if (priceRangeMatch) {
        params.price_from = priceRangeMatch[1];
        params.price_to = priceRangeMatch[2];
        query = query.replace(priceRangeMatch[0], '').trim();
    }

    // Detect sorting intent
    if (lower.includes('najtańsz') || lower.includes('najniższa cena') || lower.includes('tanio')) {
        params.order = 'price_low_to_high';
        query = query.replace(/najtańsz\w*|najniższa cena|tanio/g, '').trim();
    } else if (lower.includes('najnowsz') || lower.includes('świeże') || lower.includes('ostatnio')) {
        params.order = 'newest_first';
        query = query.replace(/najnowsz\w*|świeże|ostatnio/g, '').trim();
    } else if (lower.includes('najdroższe') || lower.includes('premium')) {
        params.order = 'price_high_to_low';
    }

    // Detect profitability intent
    let wantsProfitable = false;
    if (lower.includes('opłacaln') || lower.includes('okazj') || lower.includes('deal') ||
        lower.includes('zysk') || lower.includes('flip') || lower.includes('resell')) {
        wantsProfitable = true;
        query = query.replace(/opłacaln\w*|okazj\w*|deal\w*|zysk\w*|flip\w*|resell\w*/g, '').trim();
    }

    // Clean up leftover filler words and common attributes already in params
    const commonWords = [
        'szukaj', 'znajdź', 'pokaż', 'chcę', 'daj', 'mi', 'na', 'w', 'z', 'i', 'do', 'od', 'za', 'po',
        'jakieś', 'jakiś', 'jakąś', 'fajne', 'fajną', 'dobr[yae]', 'stan', 'idealny', 'idealna',
        'nowy', 'nowa', 'skóra', 'skórzana', 'bawełna', 'bawełniana'
    ];
    const regex = new RegExp(`\\b(${commonWords.join('|')})\\b`, 'gi');
    query = query.replace(regex, ' ').replace(/\s+/g, ' ').trim();

    // Build human-readable interpretation
    const parts = [];
    if (params.brand_ids) {
        const brandName = Object.keys(BRAND_KEYWORDS).find(k => BRAND_KEYWORDS[k] === params.brand_ids);
        parts.push(`Marka: ${brandName}`);
    }
    if (params.catalog_id) {
        const catName = Object.keys(CATEGORY_KEYWORDS).find(k => CATEGORY_KEYWORDS[k] === params.catalog_id);
        parts.push(`Kategoria: ${catName}`);
    }
    if (params.material_ids) {
        const matMap = { '1': 'Bawełna', '2': 'Skóra', '3': 'Jedwab', '4': 'Wełna', '5': 'Jeans', '6': 'Len', '12': 'Zamsz', '19': 'Kaszmir' };
        const matNames = params.material_ids.split(',').map(id => matMap[id] || id).join(', ');
        parts.push(`Materiał: ${matNames}`);
    }
    if (params.status) {
        const condMap = { '6': 'Nowy', '1': 'Bardzo dobry', '2': 'Dobry', '3': 'Zadowalający' };
        const condNames = params.status.split(',').map(id => condMap[id] || id).join(', ');
        parts.push(`Stan: ${condNames}`);
    }
    if (params.size_ids) {
        parts.push(`Rozmiar: ${params.size_ids}`);
    }
    if (params.price_from || params.price_to) {
        parts.push(`Cena: ${params.price_from || '0'}-${params.price_to || '∞'} zł`);
    }
    if (params.order) parts.push(`Sortowanie: ${params.order}`);
    if (wantsProfitable) parts.push(`🎯 Szukam najlepszych okazji`);
    if (query) parts.push(`Zapytanie: "${query}"`);

    res.json({
        query: query || Object.keys(BRAND_KEYWORDS).find(k => BRAND_KEYWORDS[k] === params.brand_ids) || '',
        params,
        wantsProfitable,
        interpretation: parts.join(' • '),
        originalPrompt: prompt
    });
});

// Search items
app.get('/api/search', async (req, res) => {
    if (!vintedCookie) {
        return res.status(401).json({ error: 'Brak skonfigurowanego cookie sesji. Przejdź do ustawień.' });
    }

    const {
        query = '',
        catalog_id = '',
        catalog_ids = '', // Handle plural
        brand_ids = '',
        price_from = '',
        price_to = '',
        order = 'relevance',
        per_page = '20',
        page = '1',
        status = '' // condition filter
    } = req.query;

    const finalCatalogIds = catalog_ids || catalog_id;
    let endpoint = `/catalog/items?per_page=${per_page}&page=${page}&order=${order}`;

    if (query) endpoint += `&search_text=${encodeURIComponent(query)}`;
    if (finalCatalogIds) endpoint += `&catalog_ids=${finalCatalogIds}`;
    if (brand_ids) endpoint += `&brand_ids=${brand_ids}`;
    if (price_from) endpoint += `&price_from=${price_from}`;
    if (price_to) endpoint += `&price_to=${price_to}`;
    if (status) endpoint += `&status_ids=${status}`;
    if (req.query.material_ids) endpoint += `&material_ids=${req.query.material_ids}`;
    if (req.query.size_ids) endpoint += `&size_ids=${req.query.size_ids}`;

    const data = await fetchVinted(endpoint);

    if (data.error) {
        return res.status(data.status || 500).json(data);
    }

    // Extract items and calculate median
    const items = data.items || [];

    // Debug: log first item's raw structure
    if (items.length > 0) {
        const first = items[0];
        console.log('[DEBUG] First item raw data:', JSON.stringify({
            price: first.price,
            total_item_price: first.total_item_price,
            service_fee: first.service_fee,
            brand_title: first.brand_title,
            brand_dto: first.brand_dto?.title,
            photo: first.photo?.url ? 'has url' : first.photo,
            favourite_count: first.favourite_count,
            title: first.title
        }, null, 2));
    }
    const prices = items.map(i => extractPrice(i)).filter(p => p > 0);
    const median = calculateMedian(prices);

    // Analyze each item
    const analyzedItems = items.map(item => {
        const price = extractPrice(item);
        return {
            id: item.id,
            id_v2: item.id_v2,
            title: item.title || '',
            price: price,
            currency: item.currency || (item.price?.currency_code) || 'PLN',
            brand: item.brand_title || (item.brand_dto?.title) || '',
            size: item.size_title || '',
            condition: item.status || '',
            photo: item.photo?.url || item.photo?.thumbnails?.[0]?.url || item.photos?.[0]?.url || '',
            url: item.url || item.path ? `https://${vintedDomain}${item.path || '/items/' + item.id}` : `https://${vintedDomain}/items/${item.id}`,
            favourites: item.favourite_count || 0,
            views: item.view_count || 0,
            user: item.user,
            description: item.description || '',
            created: item.created_at_ts,
            analysis: analyzeProfitability({ ...item, price: price, total_item_price: price }, median)
        };
    });

    res.json({
        items: analyzedItems,
        total: data.pagination?.total_entries || items.length,
        page: parseInt(page),
        medianPrice: median,
        searchQuery: query
    });
});

// Get item details
app.get('/api/item/:id', async (req, res) => {
    if (!vintedCookie) {
        return res.status(401).json({ error: 'Brak cookie sesji' });
    }

    const data = await fetchVinted(`/items/${req.params.id}`);

    if (data.error) {
        return res.status(data.status || 500).json(data);
    }

    const item = data.item || data;
    res.json({
        id: item.id,
        title: item.title,
        description: item.description,
        price: parseFloat(item.total_item_price || item.price || 0),
        currency: item.currency || 'EUR',
        brand: item.brand_title || '',
        size: item.size_title || '',
        condition: item.status || '',
        photos: (item.photos || []).map(p => p.url || p.full_size_url),
        url: item.url,
        favourites: item.favourite_count || 0,
        views: item.view_count || 0,
        user: {
            login: item.user?.login,
            feedback_reputation: item.user?.feedback_reputation
        }
    });
});

// Analyze item with search context (find median from similar)
app.get('/api/analyze/:id', async (req, res) => {
    if (!vintedCookie) {
        return res.status(401).json({ error: 'Brak cookie sesji' });
    }

    // Get item details
    const itemData = await fetchVinted(`/items/${req.params.id}`);
    if (itemData.error) return res.status(500).json(itemData);

    const item = itemData.item || itemData;

    // Search for similar items to get median price
    const searchQuery = `${item.brand_title || ''} ${item.catalog_id ? '' : item.title}`.trim();
    let searchEndpoint = `/catalog/items?search_text=${encodeURIComponent(searchQuery)}&per_page=30`;
    if (item.catalog_id) searchEndpoint += `&catalog_ids=${item.catalog_id}`;

    const searchData = await fetchVinted(searchEndpoint);
    const similarItems = searchData.items || [];
    const prices = similarItems
        .map(i => parseFloat(i.total_item_price || i.price || 0))
        .filter(p => p > 0);
    const median = calculateMedian(prices);

    const analysis = analyzeProfitability(item, median);
    const costs = calculateTotalCost(parseFloat(item.total_item_price || item.price || 0));

    res.json({
        item: {
            id: item.id,
            title: item.title,
            price: parseFloat(item.total_item_price || item.price || 0),
            brand: item.brand_title || '',
            condition: item.status || '',
            favourites: item.favourite_count || 0,
            photo: item.photos?.[0]?.url || ''
        },
        analysis,
        costs,
        similarCount: similarItems.length
    });
});

// ========== FAVORITES MANAGEMENT ==========

// Add to Vinted favorites
app.post('/api/favorites/add/:id', async (req, res) => {
    if (!vintedCookie) {
        return res.status(401).json({ error: 'Brak cookie sesji' });
    }

    await waitForRateLimit();

    try {
        const url = `https://${vintedDomain}/api/v2/items/${req.params.id}/favourite`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                ...getHeaders(),
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Nie udało się dodać do ulubionych', status: response.status });
        }

        const data = await response.json().catch(() => ({}));
        res.json({ success: true, message: 'Dodano do ulubionych', data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Remove from Vinted favorites
app.delete('/api/favorites/remove/:id', async (req, res) => {
    if (!vintedCookie) {
        return res.status(401).json({ error: 'Brak cookie sesji' });
    }

    await waitForRateLimit();

    try {
        const url = `https://${vintedDomain}/api/v2/items/${req.params.id}/favourite`;
        const response = await fetch(url, {
            method: 'DELETE',
            headers: getHeaders()
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Nie udało się usunąć z ulubionych', status: response.status });
        }

        res.json({ success: true, message: 'Usunięto z ulubionych' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get favorites list with analysis
app.get('/api/favorites', async (req, res) => {
    if (!vintedCookie) {
        return res.status(401).json({ error: 'Brak cookie sesji' });
    }

    const { page = '1', per_page = '50' } = req.query;

    const data = await fetchVinted(`/users/current/items/favourites?page=${page}&per_page=${per_page}`);

    if (data.error) {
        return res.status(data.status || 500).json(data);
    }

    const items = data.items || [];
    const prices = items.map(i => parseFloat(i.total_item_price || i.price || 0)).filter(p => p > 0);
    const median = calculateMedian(prices);

    const analyzedItems = items.map(item => ({
        id: item.id,
        id_v2: item.id_v2,
        title: item.title,
        price: parseFloat(item.total_item_price || item.price || 0),
        currency: item.currency || 'EUR',
        brand: item.brand_title || '',
        size: item.size_title || '',
        condition: item.status || '',
        photo: item.photo?.url || item.photos?.[0]?.url || '',
        url: item.url || `https://${vintedDomain}/items/${item.id}`,
        favourites: item.favourite_count || 0,
        views: item.view_count || 0,
        analysis: analyzeProfitability(item, median)
    }));

    res.json({
        items: analyzedItems,
        total: data.pagination?.total_entries || items.length,
        medianPrice: median
    });
});

// Cleanup unprofitable favorites
app.post('/api/favorites/cleanup', async (req, res) => {
    if (!vintedCookie) {
        return res.status(401).json({ error: 'Brak cookie sesji' });
    }

    const { threshold = 5 } = req.body;

    // First get all favorites
    const favData = await fetchVinted('/users/current/items/favourites?per_page=100');

    if (favData.error) {
        return res.status(500).json(favData);
    }

    const items = favData.items || [];
    const prices = items.map(i => parseFloat(i.total_item_price || i.price || 0)).filter(p => p > 0);
    const median = calculateMedian(prices);

    // Analyze and categorize
    const analyzed = items.map(item => ({
        id: item.id,
        title: item.title,
        price: parseFloat(item.total_item_price || item.price || 0),
        brand: item.brand_title || '',
        analysis: analyzeProfitability(item, median)
    }));

    const { keep, remove } = filterUnprofitable(analyzed, threshold);

    // Remove unprofitable items from Vinted favorites
    const removed = [];
    const errors = [];

    for (const item of remove) {
        await waitForRateLimit();
        try {
            const url = `https://${vintedDomain}/api/v2/items/${item.id}/favourite`;
            const response = await fetch(url, {
                method: 'DELETE',
                headers: getHeaders()
            });

            if (response.ok) {
                removed.push({ id: item.id, title: item.title, score: item.analysis.score });
            } else {
                errors.push({ id: item.id, title: item.title, error: response.status });
            }
        } catch (err) {
            errors.push({ id: item.id, title: item.title, error: err.message });
        }
    }

    res.json({
        threshold,
        totalFavorites: items.length,
        kept: keep.length,
        removedCount: removed.length,
        removed,
        errors: errors.length > 0 ? errors : undefined
    });
});

// Catch-all route to serve the frontend (must be last)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== START SERVER ==========
app.listen(PORT, () => {
    console.log(`\n🔎 Vinted Profitability Analyzer - ACTIVE`);
    console.log(`📊 Port: ${PORT}`);
    console.log(`⚙️  Katalog: ${__dirname}\n`);
});
