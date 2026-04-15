// ==UserScript==
// @name         ITS.NY.GOV Policies - All at Once Viewer
// @namespace    http://tampermonkey.net/
// @version      11.0
// @description  View all NY State IT policies at once with simplified UI and no pagination
// @author       silentsteel875
// @match        https://its.ny.gov/policies*
// @grant        GM_addStyle
// @run-at       document-idle
// @updateURL    https://github.com/silentsteel875/special-eureka-happyness/raw/refs/heads/main/ItsPoliciesViewer.user.js
// @downloadURL  https://github.com/silentsteel875/special-eureka-happyness/raw/refs/heads/main/ItsPoliciesViewer.user.js
// ==/UserScript==

(async function() {
    'use strict';

    // Add comprehensive styles - COMPACT VERSION
    GM_addStyle(`
        /* Hide original pagination */
        .pager { display: none !important; }

        /* Simplify the layout */
        .view-webny-search {
            max-width: 100% !important;
        }

        /* Results header with view toggle */
        .results-total-wrapper {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin: 12px;
            font-size: 13px;
            color: #666;
            font-weight: 600;
        }

        .view-toggle-icons {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .view-toggle-icon {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            border: 1px solid #d1d9e0;
            border-radius: 4px;
            background: #fff;
            transition: all 0.2s;
            font-size: 16px;
        }

        .view-toggle-icon:hover {
            background: #f3f5f7;
            border-color: #0366d6;
        }

        .view-toggle-icon.active {
            background: #0366d6;
            border-color: #0366d6;
            color: white;
        }

        /* Style for simplified grid - MORE COLUMNS */
        .policies-grid-container {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 12px;
            padding: 12px;
            margin: 12px 0;
        }

        .policies-grid-container.table-view {
            display: none;
        }

        .policies-table-container {
            display: none;
            padding: 12px;
            margin: 12px 0;
        }

        .policies-table-container.table-view {
            display: block;
        }

        .policies-table {
            width: 100%;
            border-collapse: collapse;
            border: 1px solid #d1d9e0;
            border-radius: 6px;
            overflow: hidden;
        }

        .policies-table thead {
            background: #f6f8fa;
            border-bottom: 1px solid #d1d9e0;
        }

        .policies-table th {
            padding: 12px;
            text-align: left;
            font-weight: 600;
            font-size: 12px;
            color: #24292e;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .policies-table td {
            padding: 10px 12px;
            border-bottom: 1px solid #e8ebf0;
            font-size: 12px;
            color: #555;
        }

        .policies-table tbody tr:hover {
            background: #f9f9f9;
        }

        .policies-table .policy-name {
            font-weight: 600;
            color: #0366d6;
        }

        .policies-table .policy-name a {
            color: #0366d6;
            text-decoration: none;
        }

        .policies-table .policy-name a:hover {
            text-decoration: underline;
        }

        .policies-table .policy-categories {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
        }

        .policies-table .policy-category-tag {
            display: inline-block;
            background: #f3f5f7;
            color: #586069;
            padding: 3px 8px;
            border-radius: 3px;
            font-size: 11px;
        }

        .policies-table .policy-actions {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .policies-table .policy-actions a {
            color: #0366d6;
            text-decoration: none;
            transition: color 0.2s;
        }

        .policies-table .policy-actions a:hover {
            color: #0256c7;
        }

        .policies-table .policy-download-icon {
            cursor: pointer;
            font-size: 14px;
        }

        .policy-grid-card {
            border: 1px solid #d1d9e0;
            border-radius: 6px;
            padding: 12px;
            background: #ffffff;
            transition: all 0.3s ease;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
            display: flex;
            flex-direction: column;
        }

        .policy-grid-card:hover {
            box-shadow: 0 8px 24px rgba(0,0,0,0.15);
            border-color: #0366d6;
            transform: translateY(-2px);
        }

        .policy-card-title {
            font-size: 15px;
            font-weight: 600;
            margin: 0 0 6px 0;
            color: #0366d6;
            line-height: 1.3;
        }

        .policy-card-title a {
            color: #0366d6;
            text-decoration: none;
        }

        .policy-card-title a:hover {
            text-decoration: underline;
        }

        .policy-card-categories {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-bottom: 8px;
        }

        .policy-category-tag {
            display: inline-block;
            background: #f3f5f7;
            color: #586069;
            padding: 3px 8px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: 500;
        }

        .policy-card-meta {
            font-size: 12px;
            color: #555;
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid #e8ebf0;
            flex-grow: 1;
        }

        .policy-card-meta-item {
            margin: 4px 0;
            line-height: 1.3;
            display: flex;
            align-items: flex-start;
            word-break: break-word;
        }

        .policy-card-meta-item strong {
            color: #24292e;
            font-weight: 600;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            min-width: 50px;
            flex-shrink: 0;
        }

        .policy-card-meta-item-value {
            color: #555;
            font-size: 12px;
            margin-left: 6px;
        }

        .policy-download-link {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid #e8ebf0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .policy-download-link a {
            display: inline-flex;
            align-items: center;
            color: #0366d6;
            text-decoration: none;
            font-weight: 500;
            font-size: 12px;
            transition: color 0.2s;
        }

        .policy-download-link a:hover {
            color: #0256c7;
            text-decoration: underline;
        }

        .policy-download-link a i {
            margin-right: 4px;
        }

        .policy-download-icon {
            color: #0366d6;
            cursor: pointer;
            font-size: 16px;
            transition: color 0.2s;
            flex-shrink: 0;
        }

        .policy-download-icon:hover {
            color: #0256c7;
        }

        /* Results counter */
        .results-total {
            margin: 12px;
            font-size: 13px;
            color: #666;
            font-weight: 600;
        }

        .loading-status {
            text-align: center;
            padding: 15px;
            background: #f0f5fa;
            border-radius: 6px;
            margin: 12px;
            font-size: 12px;
            color: #586069;
            border-left: 4px solid #0366d6;
        }

        .status-success {
            background: #d4edda;
            border-left-color: #28a745;
            color: #155724;
        }

        .status-error {
            background: #f8d7da;
            border-left-color: #dc3545;
            color: #721c24;
        }

        /* Policies extraction actions wrapper */
        .policies-actions-wrapper {
            margin-bottom: 16px;
        }

        .policies-actions-wrapper .form-actions {
            display: flex;
            gap: 8px;
        }

        .policies-actions-wrapper .button {
            flex: 1;
        }
    `);

    let isExtracting = false;
    let allPoliciesData = [];

    // Get the expected total from the page
    function getExpectedTotal() {
        const totalEl = document.querySelector('.results-total-number');
        const total = parseInt(totalEl?.textContent || '0');
        console.log(`Expected total policies: ${total}`);
        return total;
    }

    // Get current view mode from localStorage
    function getViewMode() {
        return localStorage.getItem('policiesViewMode') || 'cards';
    }

    // Save view mode to localStorage
    function setViewMode(mode) {
        localStorage.setItem('policiesViewMode', mode);
    }

    // Clean metadata values
    function cleanMetadataValue(text) {
        if (!text) return '';
        text = text.replace(/^[^:]*:\s*/, '').trim();
        text = text.split(/Last Modified Date:|Document Number:|Published:/i)[0].trim();
        text = text.replace(/\s*\(.*\)$/, '').trim();
        return text;
    }

    // Extract policy data from parsed HTML
    function extractPoliciesFromHTML(html) {
        const policies = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const viewRows = doc.querySelectorAll('.view-content .views-row');
        console.log(`  Extracting from HTML: found ${viewRows.length} rows`);

        viewRows.forEach((row) => {
            try {
                const article = row.querySelector('article.webny-teaser');
                if (!article) return;

                const titleEl = article.querySelector('.webny-teaser-title a');
                const title = titleEl?.textContent?.trim() || '';
                const link = titleEl?.href || '';

                const categoriesEl = article.querySelector('.webny-teaser-filter-terms');
                const categories = categoriesEl?.textContent
                    ?.split(',')
                    .map(c => c.trim())
                    .filter(c => c) || [];

                const descEl = article.querySelector('.description');
                let pubDate = '', modDate = '', docNumber = '';

                if (descEl) {
                    const pElements = descEl.querySelectorAll('p');
                    let allText = '';
                    pElements.forEach(p => {
                        allText += p.textContent + ' ';
                    });

                    const pubMatch = allText.match(/Original Publication Date:?\s*([^<\n]+?)(?:\s*Last Modified|$)/i);
                    pubDate = pubMatch ? cleanMetadataValue(pubMatch[1]) : '';

                    const modMatch = allText.match(/Last Modified Date:?\s*([^<\n]+?)(?:\s*Document Number|$)/i);
                    modDate = modMatch ? cleanMetadataValue(modMatch[1]) : '';

                    const docMatch = allText.match(/Document Number:?\s*([^<\n]+?)$/i);
                    docNumber = docMatch ? cleanMetadataValue(docMatch[1]) : '';
                }

                if (title) {
                    policies.push({
                        title,
                        link,
                        categories,
                        pubDate,
                        modDate,
                        docNumber
                    });
                }
            } catch (e) {
                console.error('Error extracting policy:', e);
            }
        });

        return policies;
    }

    // Load all policies from all pages with exponential backoff
    async function loadAllPolicies(expectedTotal) {
        const allPolicies = [];
        const baseUrl = window.location.href.split('?')[0];
        let page = 0;
        let lastPagePolicies = [];
        let retryCount = 0;
        const maxRetries = 10;

        console.log(`Starting to load all pages (expecting ${expectedTotal} total)...`);

        updateLoadingStatus(0, expectedTotal, 'Scanning pages...');

        do {
            try {
                const url = `${baseUrl}?page=${page}`;
                console.log(`Loading page ${page} from: ${url}`);

                const response = await fetch(url);

                if (response.status === 429) {
                    retryCount++;
                    const waitTime = Math.min(30000, 5000 * retryCount);
                    console.warn(`Rate limited on page ${page}. Retry ${retryCount}/${maxRetries}. Waiting ${waitTime}ms...`);
                    updateLoadingStatus(allPolicies.length, expectedTotal, `Rate limited - waiting ${waitTime/1000}s... (retry ${retryCount})`);

                    if (retryCount >= maxRetries) {
                        console.log(`Max retries reached (${maxRetries}). Stopping at page ${page}`);
                        break;
                    }

                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const html = await response.text();
                const pagePolicies = extractPoliciesFromHTML(html);

                if (pagePolicies.length === 0) {
                    console.log(`Page ${page} returned 0 policies, stopping.`);
                    break;
                }

                retryCount = 0;
                console.log(`Page ${page}: extracted ${pagePolicies.length} policies (total so far: ${allPolicies.length + pagePolicies.length}/${expectedTotal})`);

                allPolicies.push(...pagePolicies);
                lastPagePolicies = pagePolicies;

                updateLoadingStatus(allPolicies.length, expectedTotal, `Loaded page ${page}...`);

                page++;

                if (allPolicies.length >= expectedTotal) {
                    console.log('Reached expected total, stopping.');
                    break;
                }

                if (page > 20) {
                    console.log('Safety limit reached (20 pages)');
                    break;
                }

                let delayMs;
                if (page < 3) {
                    delayMs = 2000 + Math.random() * 1000;
                } else {
                    delayMs = 4000 + Math.random() * 2000;
                }

                console.log(`Waiting ${delayMs}ms before next page...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));

            } catch (e) {
                console.error(`Error loading page ${page}:`, e);
                retryCount++;

                if (retryCount >= maxRetries) {
                    console.log(`Stopping after ${maxRetries} retry attempts`);
                    break;
                }

                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        } while (lastPagePolicies.length > 0);

        console.log(`Finished loading. Total policies: ${allPolicies.length}/${expectedTotal}`);

        if (allPolicies.length === expectedTotal) {
            console.log('✅ SUCCESS: Loaded all expected policies!');
        } else {
            console.warn(`⚠️ WARNING: Only loaded ${allPolicies.length} of ${expectedTotal} policies`);
        }

        return allPolicies;
    }

    // Update loading status
    function updateLoadingStatus(current, total, message) {
        const mainContent = document.querySelector('.view-main-content');
        const statusEl = mainContent?.querySelector('.loading-status');

        if (statusEl) {
            statusEl.textContent = `${message} (${current}/${total})`;
        }
    }

    // Render grid view
    function renderGridView(policies) {
        const mainContent = document.querySelector('.view-main-content');
        const existingGrid = mainContent.querySelector('.policies-grid-container');
        const existingTable = mainContent.querySelector('.policies-table-container');

        if (existingTable) existingTable.classList.remove('table-view');
        if (existingGrid) {
            existingGrid.classList.add('table-view');
        }

        if (!existingGrid) {
            const gridContainer = document.createElement('div');
            gridContainer.className = 'policies-grid-container';
            mainContent.appendChild(gridContainer);
        }

        const gridContainer = mainContent.querySelector('.policies-grid-container');
        gridContainer.innerHTML = '';
        gridContainer.classList.remove('table-view');

        const sortedPolicies = [...policies].sort((a, b) => {
            const catA = a.categories[0] || '';
            const catB = b.categories[0] || '';
            return catA.localeCompare(catB);
        });

        sortedPolicies.forEach(policy => {
            const card = document.createElement('div');
            card.className = 'policy-grid-card';

            let categoriesHTML = '';
            if (policy.categories.length > 0) {
                categoriesHTML = `
                    <div class="policy-card-categories">
                        ${policy.categories.map(cat =>
                            `<span class="policy-category-tag">${cat}</span>`
                        ).join('')}
                    </div>
                `;
            }

            let metaHTML = '';
            if (policy.docNumber) {
                metaHTML += `
                    <div class="policy-card-meta-item">
                        <strong>📋 Doc #</strong>
                        <div class="policy-card-meta-item-value">${policy.docNumber}</div>
                    </div>
                `;
            }
            if (policy.pubDate) {
                metaHTML += `
                    <div class="policy-card-meta-item">
                        <strong>📅 Pub</strong>
                        <div class="policy-card-meta-item-value">${policy.pubDate}</div>
                    </div>
                `;
            }
            if (policy.modDate) {
                metaHTML += `
                    <div class="policy-card-meta-item">
                        <strong>🔄 Mod</strong>
                        <div class="policy-card-meta-item-value">${policy.modDate}</div>
                    </div>
                `;
            }

            card.innerHTML = `
                <h3 class="policy-card-title">
                    <a href="${policy.link}" target="_blank" rel="noopener noreferrer">
                        ${policy.title}
                    </a>
                </h3>
                ${categoriesHTML}
                <div class="policy-card-meta">
                    ${metaHTML}
                </div>
                <div class="policy-download-link">
                    <a href="${policy.link}" target="_blank" rel="noopener noreferrer">
                        ➜ View
                    </a>
                    <span class="policy-download-icon" title="Download" onclick="window.open('${policy.link}', '_blank')">⬇️</span>
                </div>
            `;

            gridContainer.appendChild(card);
        });
    }

    // Render table view
    function renderTableView(policies) {
        const mainContent = document.querySelector('.view-main-content');
        let tableContainer = mainContent.querySelector('.policies-table-container');
        const existingGrid = mainContent.querySelector('.policies-grid-container');

        if (existingGrid) existingGrid.classList.add('table-view');

        if (!tableContainer) {
            tableContainer = document.createElement('div');
            tableContainer.className = 'policies-table-container';
            mainContent.appendChild(tableContainer);
        }

        tableContainer.innerHTML = '';
        tableContainer.classList.add('table-view');

        const table = document.createElement('table');
        table.className = 'policies-table';

        // Create header
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th style="width: 30%;">Policy Name</th>
                <th style="width: 20%;">Categories</th>
                <th style="width: 12%;">Document #</th>
                <th style="width: 12%;">Published</th>
                <th style="width: 12%;">Modified</th>
                <th style="width: 14%;">Actions</th>
            </tr>
        `;
        table.appendChild(thead);

        // Create body
        const tbody = document.createElement('tbody');
        const sortedPolicies = [...policies].sort((a, b) => {
            const catA = a.categories[0] || '';
            const catB = b.categories[0] || '';
            return catA.localeCompare(catB);
        });

        sortedPolicies.forEach(policy => {
            const row = document.createElement('tr');

            const categoriesHTML = policy.categories.map(cat =>
                `<span class="policy-category-tag">${cat}</span>`
            ).join('');

            row.innerHTML = `
                <td class="policy-name">
                    <a href="${policy.link}" target="_blank" rel="noopener noreferrer">
                        ${policy.title}
                    </a>
                </td>
                <td class="policy-categories">${categoriesHTML}</td>
                <td>${policy.docNumber || '-'}</td>
                <td>${policy.pubDate || '-'}</td>
                <td>${policy.modDate || '-'}</td>
                <td class="policy-actions">
                    <a href="${policy.link}" target="_blank" rel="noopener noreferrer">View</a>
                    <span class="policy-download-icon" title="Download" onclick="window.open('${policy.link}', '_blank')">⬇️</span>
                </td>
            `;

            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        tableContainer.appendChild(table);
    }

    // Toggle view mode
    function toggleViewMode(mode) {
        setViewMode(mode);

        // Update button states
        const cardsBtn = document.querySelector('.view-toggle-cards');
        const tableBtn = document.querySelector('.view-toggle-table');

        if (mode === 'cards') {
            cardsBtn?.classList.add('active');
            tableBtn?.classList.remove('active');
            renderGridView(allPoliciesData);
        } else {
            cardsBtn?.classList.remove('active');
            tableBtn?.classList.add('active');
            renderTableView(allPoliciesData);
        }
    }

    // Render policies in grid
    function renderPoliciesGrid(policies, expectedTotal) {
        const mainContent = document.querySelector('.view-main-content');
        if (!mainContent) {
            console.error('Cannot find main content container');
            return;
        }

        const viewContent = mainContent.querySelector('.view-content');
        if (viewContent) viewContent.style.display = 'none';

        const pagers = mainContent.querySelectorAll('.pager');
        pagers.forEach(p => p.style.display = 'none');

        const existingGrid = mainContent.querySelector('.policies-grid-container');
        if (existingGrid) existingGrid.remove();

        const existingTable = mainContent.querySelector('.policies-table-container');
        if (existingTable) existingTable.remove();

        const existingStatus = mainContent.querySelector('.loading-status');
        if (existingStatus) existingStatus.remove();

        // Store policies for view switching
        allPoliciesData = policies;

        // Get saved view mode
        const viewMode = getViewMode();

        // Render appropriate view
        if (viewMode === 'table') {
            renderTableView(policies);
        } else {
            renderGridView(policies);
        }

        // Update or create results total with view toggle
        let resultsWrapper = mainContent.querySelector('.results-total-wrapper');
        if (!resultsWrapper) {
            resultsWrapper = document.createElement('div');
            resultsWrapper.className = 'results-total-wrapper';
            const existingResults = mainContent.querySelector('.results-total');
            if (existingResults) {
                existingResults.replaceWith(resultsWrapper);
            } else {
                mainContent.insertBefore(resultsWrapper, mainContent.firstChild);
            }
        }

        const isComplete = policies.length === expectedTotal;
        const icon = isComplete ? '✅' : '⚠️';

        resultsWrapper.innerHTML = `
            <span><strong>${icon} Showing ${policies.length} of ${expectedTotal} policies</strong></span>
            <div class="view-toggle-icons">
                <span class="view-toggle-icon view-toggle-cards ${viewMode === 'cards' ? 'active' : ''}" title="Cards view" onclick="window.policiesToggleView('cards')">📇</span>
                <span class="view-toggle-icon view-toggle-table ${viewMode === 'table' ? 'active' : ''}" title="Table view" onclick="window.policiesToggleView('table')">📋</span>
            </div>
        `;

        // Re-enable start button
        const startBtn = document.querySelector('.policies-start-btn');
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.textContent = 'Load All Policies';
        }

        isExtracting = false;
    }

    // Initialize extraction
    async function startExtraction() {
        if (isExtracting) return;

        isExtracting = true;
        const startBtn = document.querySelector('.policies-start-btn');
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.textContent = 'Loading...';
        }

        console.log('ITS.NY.GOV Policies Viewer v11 - Starting Extraction...');

        try {
            const expectedTotal = getExpectedTotal();

            const mainContent = document.querySelector('.view-main-content');

            // Remove old results wrapper if exists
            const oldWrapper = mainContent.querySelector('.results-total-wrapper');
            if (oldWrapper) oldWrapper.remove();

            const resultsTotal = mainContent.querySelector('.results-total');
            if (resultsTotal) {
                const statusDiv = document.createElement('div');
                statusDiv.className = 'loading-status';
                statusDiv.textContent = `Scanning pages... (0/${expectedTotal})`;
                resultsTotal.parentNode.insertBefore(statusDiv, resultsTotal.nextSibling);
            }

            const allPolicies = await loadAllPolicies(expectedTotal);

            renderPoliciesGrid(allPolicies, expectedTotal);
            console.log('✅ Policies rendered successfully');

        } catch (e) {
            console.error('Error during extraction:', e);
            const startBtn = document.querySelector('.policies-start-btn');
            if (startBtn) {
                startBtn.disabled = false;
                startBtn.textContent = 'Load All Policies';
            }
            isExtracting = false;
        }
    }

    // Add start button to sidebar
    function addStartButton() {
        const filterSidebarContent = document.querySelector('.filter-sidebar-content');
        if (!filterSidebarContent) {
            console.log('Filter sidebar not found, retrying...');
            setTimeout(addStartButton, 500);
            return;
        }

        // Check if button already exists
        if (document.querySelector('.policies-start-btn')) {
            return;
        }

        // Create wrapper div matching Drupal form-actions structure
        const wrapper = document.createElement('div');
        wrapper.className = 'policies-actions-wrapper';

        // Create form-actions div to match the Apply button style
        const formActions = document.createElement('div');
        formActions.className = 'form-actions js-form-wrapper form-wrapper';

        // Create button matching the Apply button style
        const button = document.createElement('input');
        button.type = 'submit';
        button.className = 'button js-form-submit form-submit policies-start-btn';
        button.value = 'Load All Policies';
        button.onclick = (e) => {
            e.preventDefault();
            startExtraction();
        };

        formActions.appendChild(button);
        wrapper.appendChild(formActions);

        // Insert before filter-sidebar-content
        filterSidebarContent.parentNode.insertBefore(wrapper, filterSidebarContent);
        console.log('Start button added to sidebar');
    }

    // Make toggle function globally available
    window.policiesToggleView = toggleViewMode;

    // Initialize
    function init() {
        console.log('ITS.NY.GOV Policies Viewer v11 - Ready');
        addStartButton();
    }

    // Run after page loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
    } else {
        setTimeout(init, 1000);
    }
})();
