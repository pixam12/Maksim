/**
 * Vinted Profitability Analyzer - Frontend
 */

// ========== STATE ==========
let currentTab = 'search';
let favoritedIds = new Set();
let currentPage = 1;
let currentSearchQuery = '';
let currentPriceFrom = '';
let currentPriceTo = '';
let currentSortOrder = 'relevance';
let itemsCache = {}; // Global cache for all loaded items

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', () => {
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Search
    document.getElementById('btnSearch').addEventListener('click', startSmartSearch);
    document.getElementById('searchInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') startSmartSearch();
    });

    // Filters Toggle
    document.getElementById('btnToggleFilters').addEventListener('click', toggleFilterSection);

    // Favorites

    // Settings
    document.getElementById('btnSettings').addEventListener('click', () => openModal('settingsModal'));
    document.getElementById('btnSaveConfig').addEventListener('click', saveConfig);

    // Favorites
    document.getElementById('btnRefreshFavs').addEventListener('click', loadFavorites);
    document.getElementById('btnCleanup').addEventListener('click', showCleanupConfirm);
    document.getElementById('thresholdSlider').addEventListener('input', e => {
        document.getElementById('thresholdValue').textContent = e.target.value;
    });

    // Load More
    document.getElementById('btnLoadMore').addEventListener('click', loadNextPage);

    // Apply Filters
    document.getElementById('btnApplyFilters').addEventListener('click', () => {
        toggleFilterSection(true); // Close panel
        performSearch(false); // FRESH SEARCH with new filters
    });

    // Initialize Chips and Auto-Search
    initChips();
    initAutoSearch();

    // Global Shortcuts
    window.addEventListener('keydown', e => {
        if (e.key === 'F3') {
            e.preventDefault();
            switchTab('search');
            const searchInput = document.getElementById('searchInput');
            searchInput.focus();
            searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            showToast('✨ Smart Search gotowy!', 'success');
        }
    });

    // Check config status
    checkConfigStatus();
});

// ========== TABS ==========
function switchTab(tabName) {
    currentTab = tabName;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(tabName === 'search' ? 'searchTab' : 'favoritesTab').classList.add('active');

    if (tabName === 'search') {
        document.getElementById('searchInput').focus();
    } else if (tabName === 'favorites') {
        loadFavorites();
    }
}

// ========== CONFIG ==========
async function checkConfigStatus() {
    try {
        const res = await fetch('/api/config/status');
        const data = await res.json();
        updateStatusDot(data.configured);
        if (data.domain) {
            document.getElementById('vintedDomain').value = data.domain;
        }
    } catch (e) {
        updateStatusDot(false);
    }
}

function updateStatusDot(connected) {
    const dot = document.getElementById('statusDot');
    dot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
    dot.title = connected ? 'Połączono z Vinted' : 'Nie połączono - skonfiguruj cookie';
}

async function saveConfig() {
    const cookie = document.getElementById('cookieInput').value.trim();
    const domain = document.getElementById('vintedDomain').value;

    if (!cookie) {
        showToast('Wklej cookie sesji z przeglądarki', 'warning');
        return;
    }

    try {
        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cookie, domain })
        });
        const data = await res.json();

        if (data.success) {
            updateStatusDot(true);
            closeModal('settingsModal');
            showToast('✅ Konfiguracja zapisana! Możesz teraz wyszukiwać.', 'success');
        }
    } catch (e) {
        showToast('❌ Błąd zapisu konfiguracji', 'error');
    }
}

// ========== SEARCH ==========
async function performSearch(append = false) {
    // Current search parameters based on DOM
    const queryInput = document.getElementById('searchInput').value.trim();
    const brand = document.getElementById('filterBrand').value.trim();
    const extraMat = document.getElementById('filterMaterialInput').value.trim();
    const priceFrom = document.getElementById('priceFrom').value;
    const priceTo = document.getElementById('priceTo').value;
    const sortOrder = document.getElementById('sortOrder').value;

    if (!append) {
        currentSearchQuery = queryInput;
        currentPriceFrom = priceFrom;
        currentPriceTo = priceTo;
        currentSortOrder = sortOrder;
        currentPage = 1;
    }

    // Allow search if there is either a query OR at least one filter selected
    const hasFilters = brand || extraMat || priceFrom || priceTo ||
        document.querySelectorAll('.filter-chip.active').length > 0;

    if (!currentSearchQuery && !hasFilters) {
        showToast('Wpisz czego szukasz lub wybierz filtr', 'warning');
        return;
    }

    if (append) {
        const btn = document.getElementById('btnLoadMore');
        btn.disabled = true;
        btn.innerHTML = '<span>⏳</span> Ładowanie...';
    } else {
        showLoading('search', true);
        hideElement('searchEmpty');
        hideElement('loadMoreSection');
        document.getElementById('searchResults').innerHTML = '';
    }

    const params = new URLSearchParams({
        query: currentSearchQuery,
        order: currentSortOrder,
        per_page: '20',
        page: currentPage.toString()
    });
    if (currentPriceFrom) params.set('price_from', currentPriceFrom);
    if (currentPriceTo) params.set('price_to', currentPriceTo);

    // Advanced filters
    const conds = Array.from(document.querySelectorAll('#conditionChips .filter-chip.active')).map(c => c.dataset.value);
    const mats = Array.from(document.querySelectorAll('#materialChips .filter-chip.active')).map(c => c.dataset.value);
    const genders = Array.from(document.querySelectorAll('#genderChips .filter-chip.active')).map(c => c.dataset.value);
    const cats = Array.from(document.querySelectorAll('#categoryChips .filter-chip.active')).map(c => c.dataset.value);
    const sizes = [
        ...Array.from(document.querySelectorAll('#sizeChips .filter-chip.active')).map(c => c.dataset.value),
        ...Array.from(document.querySelectorAll('#shoeSizeChips .filter-chip.active')).map(c => c.dataset.value)
    ];

    let combinedQuery = currentSearchQuery;
    if (brand) combinedQuery += ` ${brand}`;
    if (extraMat) combinedQuery += ` ${extraMat}`;

    params.set('query', combinedQuery.trim());
    if (conds.length > 0) params.set('status_ids', conds.join(','));
    if (mats.length > 0) params.set('material_ids', mats.join(','));
    if (genders.length > 0) params.set('catalog_ids', genders.join(',')); // Simple mapping for now
    if (cats.length > 0) {
        // If gender is selected, category should ideally be a sub-catalog of that gender
        // For now we just combine them or prioritize category
        params.set('catalog_ids', cats.join(','));
    }
    if (sizes.length > 0) params.set('size_ids', sizes.join(','));

    try {
        const res = await fetch(`/api/search?${params}`);

        if (res.status === 401) {
            showLoading('search', false);
            showToast('⚙️ Skonfiguruj cookie sesji w ustawieniach', 'warning');
            openModal('settingsModal');
            return;
        }

        const data = await res.json();

        if (data.error) {
            showLoading('search', false);
            showToast(`❌ Błąd: ${data.message || 'Nieznany błąd'}`, 'error');
            return;
        }

        renderSearchResults(data, append);

        // Show/Hide Load More button
        const totalEntries = data.total || 0;
        const currentCount = document.querySelectorAll('#searchResults .item-card').length;
        if (currentCount < totalEntries && data.items && data.items.length > 0) {
            document.getElementById('loadMoreSection').style.display = 'flex';
        } else {
            document.getElementById('loadMoreSection').style.display = 'none';
        }

    } catch (e) {
        showToast(`❌ Błąd połączenia: ${e.message}`, 'error');
    }

    if (append) {
        const btn = document.getElementById('btnLoadMore');
        btn.disabled = false;
        btn.innerHTML = '<span>➕</span> Załaduj więcej ofert';
    } else {
        showLoading('search', false);
    }
}

async function loadNextPage() {
    currentPage++;
    performSearch(true);
}

// ========== UI HELPERS ==========
function toggleFilterSection(forceClose = false) {
    const section = document.getElementById('filterSection');
    const btn = document.getElementById('btnToggleFilters');

    // Explicitly check for boolean true to avoid Event object confusion
    const shouldBeClosed = (forceClose === true) || (forceClose !== true && section.classList.contains('active'));

    if (shouldBeClosed) {
        section.classList.remove('active');
        btn.classList.remove('active');
        btn.innerHTML = '<span>🔧</span> Filtruj';
    } else {
        section.classList.add('active');
        btn.classList.add('active');
        btn.innerHTML = '<span>❌</span> Zamknij';
    }
}

let searchTimeout;
function debounceSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => performSearch(true), 600);
}

function initAutoSearch() {
    // Text and Number inputs
    const autoInputs = ['filterBrand', 'filterMaterialInput', 'priceFrom', 'priceTo'];
    autoInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', debounceSearch);
            el.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    clearTimeout(searchTimeout);
                    performSearch(true);
                    toggleFilterSection(true); // Close panel on Enter
                }
            });
        }
    });

    // Selects
    const autoSelects = ['sortOrder'];
    autoSelects.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => performSearch(true));
    });
}

function initChips() {
    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            chip.classList.toggle('active');
            performSearch(false); // FRESH SEARCH on click, not append!
        });
    });
}

async function startSmartSearch() {
    const queryInput = document.getElementById('searchInput').value.trim();
    const brand = document.getElementById('filterBrand').value.trim();
    const extraMat = document.getElementById('filterMaterialInput').value.trim();
    const hasFilters = brand || extraMat ||
        document.getElementById('priceFrom').value ||
        document.getElementById('priceTo').value ||
        document.querySelectorAll('.filter-chip.active').length > 0;

    if (!queryInput && !hasFilters) {
        showToast('Wpisz co chcesz znaleźć lub wybierz filtry', 'info');
        return;
    }

    // If query is empty but filters exist, just do a normal search
    if (!queryInput && hasFilters) {
        performSearch(false);
        return;
    }

    const btn = document.getElementById('btnSearch');
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span>✨</span> Analizuję...';

    const interpretationBox = document.getElementById('aiInterpretation');
    interpretationBox.style.display = 'none';

    try {
        // Analiza AI (pobranie filtrów)
        const res = await fetch('/api/ai-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });

        const data = await res.json();

        if (!data.error && data.params) {
            // Aktualizacja filtrów w UI
            if (data.params.price_from) document.getElementById('priceFrom').value = data.params.price_from;
            if (data.params.price_to) document.getElementById('priceTo').value = data.params.price_to;
            if (data.params.order) document.getElementById('sortOrder').value = data.params.order;

            // Sync chips
            if (data.params.status) {
                const statusList = data.params.status.toString().split(',');
                document.querySelectorAll('#conditionChips .filter-chip').forEach(chip => {
                    chip.classList.toggle('active', statusList.includes(chip.dataset.value));
                });
            }
            if (data.params.material_ids) {
                const matList = data.params.material_ids.toString().split(',');
                document.querySelectorAll('#materialChips .filter-chip').forEach(chip => {
                    chip.classList.toggle('active', matList.includes(chip.dataset.value));
                });
            }
            if (data.params.catalog_id || data.params.catalog_ids) {
                const catList = (data.params.catalog_id || data.params.catalog_ids).toString().split(',');
                document.querySelectorAll('#genderChips .filter-chip, #categoryChips .filter-chip').forEach(chip => {
                    chip.classList.toggle('active', catList.includes(chip.dataset.value));
                });
            }
            if (data.params.size_ids) {
                const sizeList = data.params.size_ids.toString().split(',');
                document.querySelectorAll('#sizeChips .filter-chip, #shoeSizeChips .filter-chip').forEach(chip => {
                    chip.classList.toggle('active', sizeList.includes(chip.dataset.value));
                });
            }

            // Czyszczenie zapytania (usuwamy to co wyciągnął asystent jako filtry)
            document.getElementById('searchInput').value = data.query;

            // Pokazujemy interpretację
            interpretationBox.innerHTML = `<strong>Smart Interpretation:</strong> ${data.interpretation}`;
            interpretationBox.style.display = 'block';

            showToast('✨ Smart Search dopasował filtry!', 'success');
        }

        // Faza 2: Faktyczne szukanie
        await performSearch();

    } catch (e) {
        console.error('Smart search error:', e);
        await performSearch();
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}

function renderSearchResults(data, append = false) {
    const container = document.getElementById('searchResults');
    const stats = document.getElementById('searchStats');

    if (!append && (!data.items || data.items.length === 0)) {
        container.innerHTML = '';
        stats.style.display = 'none';
        document.getElementById('searchEmpty').style.display = '';
        document.getElementById('searchEmpty').querySelector('h3').textContent = 'Brak wyników';
        document.getElementById('searchEmpty').querySelector('p').textContent = 'Spróbuj innej frazy lub zmień filtry';
        return;
    }

    // Stats
    stats.style.display = 'flex';
    document.getElementById('resultCount').textContent = `${data.total} wyników`;
    document.getElementById('medianInfo').textContent = `Mediana: ${(data.medianPrice || 0).toFixed(2)} zł`;
    hideElement('searchEmpty');

    // Cards
    const startIdx = append ? container.querySelectorAll('.item-card').length : 0;

    // Add items to cache
    data.items.forEach(item => {
        itemsCache[item.id] = item;
    });

    const cardsHtml = data.items.map((item, i) => createItemCard(item, startIdx + i, 'search')).join('');

    if (append) {
        container.insertAdjacentHTML('beforeend', cardsHtml);
    } else {
        container.innerHTML = cardsHtml;
    }
}

// ========== FAVORITES ==========
async function loadFavorites() {
    showLoading('fav', true);
    hideElement('favEmpty');

    try {
        const res = await fetch('/api/favorites');

        if (res.status === 401) {
            showLoading('fav', false);
            showToast('⚙️ Skonfiguruj cookie sesji', 'warning');
            return;
        }

        const data = await res.json();

        if (data.error) {
            showLoading('fav', false);
            showToast(`❌ ${data.message || 'Błąd ładowania ulubionych'}`, 'error');
            return;
        }

        renderFavorites(data);
    } catch (e) {
        showToast(`❌ Błąd: ${e.message}`, 'error');
    }

    showLoading('fav', false);
}

function renderFavorites(data) {
    const container = document.getElementById('favResults');
    const stats = document.getElementById('favStats');

    if (!data.items || data.items.length === 0) {
        container.innerHTML = '';
        stats.style.display = 'none';
        document.getElementById('favEmpty').style.display = '';
        return;
    }

    // Update badge
    document.getElementById('favCount').textContent = data.items.length;
    favoritedIds = new Set(data.items.map(i => i.id));

    // Stats
    const threshold = parseInt(document.getElementById('thresholdSlider').value);
    const profitable = data.items.filter(i => i.analysis && i.analysis.score >= threshold).length;
    const unprofitable = data.items.length - profitable;

    stats.style.display = 'flex';
    document.getElementById('favTotal').textContent = `${data.items.length} ulubionych`;
    document.getElementById('favProfitable').textContent = `🟢 ${profitable} opłacalnych`;
    document.getElementById('favUnprofitable').textContent = `🔴 ${unprofitable} nieopłacalnych`;
    hideElement('favEmpty');

    // Add items to cache
    data.items.forEach(item => {
        itemsCache[item.id] = item;
    });

    // Cards
    container.innerHTML = data.items.map((item, i) => createItemCard(item, i, 'fav')).join('');
}

// ========== CLEANUP ==========
async function showCleanupConfirm() {
    const threshold = parseInt(document.getElementById('thresholdSlider').value);

    // Get current favorites data
    try {
        const res = await fetch('/api/favorites');
        const data = await res.json();

        if (!data.items || data.items.length === 0) {
            showToast('Brak ulubionych do wyczyszczenia', 'info');
            return;
        }

        const unprofitable = data.items.filter(i => i.analysis && i.analysis.score < threshold);

        if (unprofitable.length === 0) {
            showToast('🎉 Wszystkie ulubione są opłacalne!', 'success');
            return;
        }

        const content = document.getElementById('cleanupContent');
        content.innerHTML = `
      <div class="cleanup-summary">
        Usunąć <strong>${unprofitable.length}</strong> nieopłacalnych ofert (score &lt; ${threshold})?
      </div>
      <div class="cleanup-list">
        ${unprofitable.map(item => `
          <div class="cleanup-item">
            <span class="score ${getVerdictClass(item.analysis.score)}">${item.analysis.score.toFixed(1)}</span>
            <span class="title">${escapeHtml(item.title)}</span>
            <span>${item.price.toFixed(2)} zł</span>
          </div>
        `).join('')}
      </div>
      <div style="display:flex; gap:10px; margin-top:16px">
        <button class="btn btn-ghost" style="flex:1" onclick="closeModal('cleanupModal')">Anuluj</button>
        <button class="btn btn-danger" style="flex:1" onclick="executeCleanup(${threshold})">🗑️ Usuń ${unprofitable.length} ofert</button>
      </div>
    `;

        openModal('cleanupModal');
    } catch (e) {
        showToast(`❌ Błąd: ${e.message}`, 'error');
    }
}

async function executeCleanup(threshold) {
    closeModal('cleanupModal');
    showToast('🧹 Usuwam nieopłacalne oferty...', 'info');

    try {
        const res = await fetch('/api/favorites/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ threshold })
        });

        const data = await res.json();

        if (data.removedCount > 0) {
            showToast(`✅ Usunięto ${data.removedCount} nieopłacalnych ofert!`, 'success');
        } else {
            showToast('Nie udało się usunąć żadnych ofert', 'warning');
        }

        // Refresh favorites
        loadFavorites();
    } catch (e) {
        showToast(`❌ Błąd: ${e.message}`, 'error');
    }
}

// ========== ADD/REMOVE FAVORITE ==========
async function toggleFavorite(itemId, button) {
    const isFav = favoritedIds.has(itemId);

    try {
        if (isFav) {
            const res = await fetch(`/api/favorites/remove/${itemId}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                favoritedIds.delete(itemId);
                button.classList.remove('active');
                button.innerHTML = '🤍';
                showToast('💔 Usunięto z ulubionych', 'info');
            }
        } else {
            const res = await fetch(`/api/favorites/add/${itemId}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                favoritedIds.add(itemId);
                button.classList.add('active');
                button.innerHTML = '❤️';
                showToast('❤️ Dodano do ulubionych!', 'success');
                // Update badge count
                document.getElementById('favCount').textContent = favoritedIds.size;
            } else {
                showToast('❌ Nie udało się dodać', 'error');
            }
        }
    } catch (e) {
        showToast(`❌ Błąd: ${e.message}`, 'error');
    }
}

// ========== ANALYSIS ==========
async function showAnalysis(itemId) {
    const cachedItem = itemsCache[itemId];

    // 1. If we have it in cache, show it instantly
    if (cachedItem && cachedItem.analysis) {
        renderAnalysisModal(cachedItem);
        // We can still fetch in background for "fresh" data if we want, but local is good enough
        return;
    }

    // 2. Otherwise fetch from backend (fallback)
    openModal('analysisModal');
    const content = document.getElementById('analysisContent');
    content.innerHTML = '<div class="spinner"></div><p style="text-align:center; color:var(--text-muted)">Pobieram szczegóły i analizuję rynkowo...</p>';

    try {
        const res = await fetch(`/api/analyze/${itemId}`);
        const data = await res.json();

        if (data.error) {
            content.innerHTML = `
              <div style="text-align:center; padding:20px; animation: fadeIn 0.3s ease">
                <p style="color:var(--score-bad); font-size:16px; margin-bottom:12px">❌ ${data.message || 'Błąd analizy'}</p>
                <div style="color:var(--text-muted); font-size:13px; background:rgba(0,0,0,0.2); padding:12px; border-radius:var(--radius-sm); border:1px solid rgba(255,255,255,0.05)">
                  <p><strong>Częste przyczyny:</strong></p>
                  <ul style="text-align:left; margin-top:8px">
                    <li>Przedmiot został właśnie sprzedany lub usunięty</li>
                    <li>Domena w ustawieniach (${data.domain || '?'}) różni się od domeny oferty</li>
                    <li>Twoja sesja Vinted wygasła (odśwież stronę)</li>
                  </ul>
                </div>
                <button class="btn btn-ghost" style="margin-top:20px" onclick="closeModal('analysisModal')">Zamknij</button>
              </div>
            `;
            return;
        }

        renderAnalysisModal(data);
    } catch (e) {
        content.innerHTML = `<p style="color:var(--score-bad)">❌ Błąd: ${e.message}</p>`;
    }
}

function renderAnalysisModal(data) {
    const a = data.analysis;
    const item = data.item || data;
    const content = document.getElementById('analysisContent');
    openModal('analysisModal');

    content.innerHTML = `
      <div class="analysis-grid">
        <!-- Header -->
        <div class="analysis-item-header">
          ${item.photo || (item.photos?.[0]) ? `<img src="${item.photo || (item.photos?.[0])}" class="analysis-thumb" alt="">` : ''}
          <div class="analysis-info">
            <h3>${escapeHtml(item.title)}</h3>
            <p>${item.brand || item.brand_title || 'Brak marki'} • ${getConditionLabel(item.condition || item.status || '')}</p>
            <p>❤️ ${item.favourites || 0} polubień</p>
          </div>
        </div>

        <!-- Big verdict -->
        <div style="text-align:center; padding: 16px 0">
          <div class="score-badge ${getScoreClass(a.score)}" style="width:72px; height:72px; font-size:24px; margin:0 auto 12px; position:static">
            ${a.score.toFixed(1)}
          </div>
          <div style="display:flex; flex-direction:column; align-items:center; gap:4px">
            <span class="verdict-badge ${a.scamRisk?.level === 'high' ? 'verdict-scam' : getVerdictBadgeClass(a.verdict)}">${a.verdict}</span>
            ${a.scamRisk?.isSuspicious ? `<span style="color:#ff6666; font-size:11px">⚠️ Wykryto ryzyko oszustwa</span>` : ''}
          </div>
        </div>

        <!-- Key metrics -->
        <div class="analysis-scores">
          <div class="score-item">
            <div class="label">Cena zakupu</div>
            <div class="value">${a.costs?.totalCost ? a.costs.totalCost.toFixed(2) : (item.price || 0).toFixed(2)} zł</div>
          </div>
          <div class="score-item">
            <div class="label">Mediana rynkowa</div>
            <div class="value neutral">${a.medianPrice.toFixed(2)} zł</div>
          </div>
          <div class="score-item">
            <div class="label">Szac. odsprzedaż</div>
            <div class="value ${a.estimatedResalePrice > (a.costs?.totalCost || item.price) ? 'positive' : 'negative'}">${a.estimatedResalePrice.toFixed(2)} zł</div>
          </div>
          <div class="score-item">
            <div class="label">Potencjalny zysk</div>
            <div class="value ${a.potentialProfit > 0 ? 'positive' : 'negative'}">${a.potentialProfit > 0 ? '+' : ''}${a.potentialProfit.toFixed(2)} zł</div>
          </div>
        </div>

        <!-- Detailed breakdown -->
        <div class="analysis-breakdown">
          <h4>Rozbicie oceny</h4>
          ${createBreakdownRow('Cena vs mediana', a.priceScore, 4, getBarColor(a.priceScore / 4))}
          ${createBreakdownRow('Wartość marki', a.brandScore, 2, getBarColor(a.brandScore / 2))}
          ${createBreakdownRow('Popularność (❤️)', a.popularityScore, 2, getBarColor(a.popularityScore / 2))}
          ${createBreakdownRow('Stan przedmiotu', a.conditionScore, 2, getBarColor(a.conditionScore / 2))}
        </div>

        <!-- Scam warning explanation -->
        ${a.scamRisk && a.scamRisk.isSuspicious ? `
          <div class="scam-warning">
            <h5>⚠️ Uwaga: Ryzyko oszustwa (${a.scamRisk.level})</h5>
            <ul>
              ${a.scamRisk.reasons.map(r => `<li>${r}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        <!-- Action -->
        <div style="display:flex; gap:10px; margin-top:8px">
          <a href="${item.url || '#'}" target="_blank" class="btn btn-primary" style="flex:1; justify-content:center; text-decoration:none">
            🔗 Otwórz na Vinted
          </a>
        </div>
      </div>
    `;
}

// ========== CARD BUILDER ==========
function createItemCard(item, index, context) {
    const a = item.analysis || {};
    const score = a.score || 0;
    const isFav = favoritedIds.has(item.id);
    const isScam = a.scamRisk && a.scamRisk.level === 'high';

    return `
    <div class="item-card" style="animation-delay:${index * 0.04}s">
      <!-- Score/Scam badge -->
      ${isScam
            ? `<div class="score-badge verdict-scam" title="Podejrzenie oszustwa!">⚠️</div>`
            : `<div class="score-badge ${getScoreClass(score)}">${score.toFixed(1)}</div>`
        }
      
      <!-- Image -->
      ${item.photo
            ? `<img src="${item.photo}" class="card-image" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.outerHTML='<div class=\\'card-image-placeholder\\'>📷</div>'">`
            : '<div class="card-image-placeholder">📷</div>'
        }
      
      <!-- Body -->
      <div class="card-body">
        <div class="card-title">${escapeHtml(item.title)}</div>
        
        <div class="card-meta">
          ${item.brand ? `<span class="meta-tag">🏷️ ${escapeHtml(item.brand)}</span>` : ''}
          ${item.size ? `<span class="meta-tag">📏 ${item.size}</span>` : ''}
          ${item.condition ? `<span class="meta-tag">${getConditionEmoji(item.condition)} ${getConditionLabel(item.condition)}</span>` : ''}
        </div>

        <div class="card-price">
          <span>${(item.price || 0).toFixed(2)} ${item.currency || 'zł'}</span>
          <span class="card-hearts">❤️ ${item.favourites || 0}</span>
        </div>

        ${a.verdict ? `
          <div style="display:flex; align-items:center; gap:8px">
            <span class="verdict-badge ${isScam ? 'verdict-scam' : getVerdictBadgeClass(a.verdict)}">${a.verdict}</span>
            ${a.scamRisk && a.scamRisk.level === 'medium' ? '<span title="Średnie ryzyko oszustwa">⚠️</span>' : ''}
          </div>
        ` : ''}
        
        <div class="card-actions">
          <button class="btn-fav ${isFav ? 'active' : ''}" onclick="toggleFavorite(${item.id}, this)" title="${isFav ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}">
            ${isFav ? '❤️' : '🤍'}
          </button>
          <button class="btn btn-ghost btn-sm" onclick="showAnalysis(${item.id})">
            📊 Analizuj
          </button>
          <a href="${item.url || '#'}" target="_blank" class="btn btn-ghost btn-sm" style="text-decoration:none">
            🔗 Otwórz
          </a>
        </div>
      </div>
    </div>
  `;
}

// ========== HELPERS ==========
function getScoreClass(score) {
    if (score >= 8) return 'score-great';
    if (score >= 6) return 'score-good';
    if (score >= 5) return 'score-neutral';
    if (score >= 3) return 'score-risky';
    return 'score-bad';
}

function getVerdictClass(score) {
    if (score >= 8) return 'score-great';
    if (score >= 6) return 'score-good';
    if (score >= 5) return 'score-neutral';
    if (score >= 3) return 'score-risky';
    return 'score-bad';
}

function getVerdictBadgeClass(verdict) {
    switch (verdict) {
        case 'ŚWIETNA OKAZJA': return 'verdict-great';
        case 'OPŁACALNE': return 'verdict-good';
        case 'NEUTRALNE': return 'verdict-neutral';
        case 'RYZYKOWNE': return 'verdict-risky';
        case 'NIEOPŁACALNE': return 'verdict-bad';
        default: return 'verdict-neutral';
    }
}

function getConditionEmoji(condition) {
    if (!condition) return '📦';
    const c = condition.toLowerCase();
    if (c.includes('new') || c.includes('nowy')) return '✨';
    if (c.includes('very_good') || c.includes('bardzo')) return '👍';
    if (c.includes('good') || c.includes('dobry')) return '👌';
    if (c.includes('satisfactory') || c.includes('zadowal')) return '📦';
    return '📦';
}

function getConditionLabel(condition) {
    if (!condition) return 'N/A';
    const c = condition.toLowerCase();
    if (c.includes('new_with_tags')) return 'Nowy z metkami';
    if (c.includes('new')) return 'Nowy';
    if (c.includes('very_good')) return 'Bardzo dobry';
    if (c.includes('good')) return 'Dobry';
    if (c.includes('satisfactory')) return 'Zadowalający';
    return condition;
}

function getBarColor(ratio) {
    if (ratio >= 0.8) return 'var(--score-great)';
    if (ratio >= 0.6) return 'var(--score-good)';
    if (ratio >= 0.4) return 'var(--score-neutral)';
    if (ratio >= 0.2) return 'var(--score-risky)';
    return 'var(--score-bad)';
}

function createBreakdownRow(label, value, max, color) {
    const pct = Math.round((value / max) * 100);
    return `
    <div class="breakdown-row">
      <span>${label}</span>
      <div style="display:flex; align-items:center; gap:8px">
        <span style="font-weight:600; min-width:40px; text-align:right">${value.toFixed(1)}/${max}</span>
        <div class="breakdown-bar">
          <div class="breakdown-fill" style="width:${pct}%; background:${color}"></div>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========== MODALS ==========
function openModal(id) {
    document.getElementById(id).style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeModal(id) {
    const modal = document.getElementById(id);
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

// Close modal on backdrop click
document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.style.display = 'none';
        document.body.style.overflow = '';
    }
});

// Close modal on Escape
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay').forEach(m => {
            m.style.display = 'none';
        });
        document.body.style.overflow = '';
    }
});

// ========== TOASTS ==========
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ========== UI HELPERS ==========
function showLoading(prefix, show) {
    const loading = document.getElementById(`${prefix}Loading`);
    const results = document.getElementById(`${prefix}Results`);

    if (show) {
        loading.style.display = '';
        results.style.display = 'none';
    } else {
        loading.style.display = 'none';
        results.style.display = '';
    }
}

function hideElement(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}
