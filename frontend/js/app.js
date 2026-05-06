/* ─── LeadScraper Pro — Frontend Application ─────────────── */

const API = '';
let currentPage = 1;
let currentSort = 'created_at';
let currentSortOrder = 'desc';
let debounceTimer = null;

// ─── Navigation ──────────────────────────────────────────────

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => showPage(item.dataset.page));
});

function showPage(pageName) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`page-${pageName}`).classList.add('active');
    document.querySelector(`.nav-item[data-page="${pageName}"]`).classList.add('active');

    if (pageName === 'dashboard') loadDashboard();
    if (pageName === 'leads') { loadFilters(); loadLeads(); }
    if (pageName === 'history') loadHistory();
}

// ─── Toast ───────────────────────────────────────────────────

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// ─── Dashboard ───────────────────────────────────────────────

async function loadDashboard() {
    try {
        const [stats, leadsResp] = await Promise.all([
            fetch(`${API}/api/stats`).then(r => r.json()),
            fetch(`${API}/api/leads?per_page=10&sort_by=created_at&sort_order=desc`).then(r => r.json()),
        ]);

        document.getElementById('stat-total').textContent = stats.total_leads;
        document.getElementById('stat-hot').textContent = stats.hot_leads;
        document.getElementById('stat-warm').textContent = stats.warm_leads;
        document.getElementById('stat-no-website').textContent = stats.without_website;
        document.getElementById('stat-contacted').textContent = stats.contacted;
        document.getElementById('stat-converted').textContent = stats.converted;

        const tbody = document.getElementById('recent-leads-body');
        tbody.innerHTML = leadsResp.leads.map(l => `
            <tr style="cursor:pointer" onclick="openLead(${l.id})">
                <td><strong>${esc(l.business_name)}</strong></td>
                <td>${esc(l.category || '—')}</td>
                <td>${esc(l.area || '—')}</td>
                <td>${scoreBar(l.overall_score)}</td>
                <td>${typeBadge(l.lead_type)}</td>
                <td>${statusBadge(l.approach_status)}</td>
            </tr>
        `).join('') || '<tr><td colspan="6" class="empty-state"><p>No leads yet. Start scraping!</p></td></tr>';
    } catch (e) {
        console.error('Dashboard load error:', e);
    }
}

// ─── Scraper ─────────────────────────────────────────────────

async function startScrape(e) {
    e.preventDefault();
    const btn = document.getElementById('scrape-btn');
    btn.disabled = true;

    const payload = {
        niche: document.getElementById('scrape-niche').value.trim(),
        area: document.getElementById('scrape-area').value.trim(),
        module: document.getElementById('scrape-module').value,
        max_results: parseInt(document.getElementById('scrape-max').value) || 50,
        find_owners: true,
    };

    try {
        const resp = await fetch(`${API}/api/scrape/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await resp.json();

        if (!resp.ok) {
            showToast(data.detail || 'Failed to start scrape', 'error');
            btn.disabled = false;
            return;
        }

        showToast('Scraping started!', 'success');
        showProgress(data.session_id);
    } catch (e) {
        showToast('Error starting scrape', 'error');
        btn.disabled = false;
    }
}

async function scrapeGmbLink(e) {
    e.preventDefault();
    const btn = document.getElementById('gmb-btn');
    btn.disabled = true;

    const link = document.getElementById('gmb-link').value.trim();

    try {
        const resp = await fetch(`${API}/api/scrape/gmb-link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gmb_link: link }),
        });
        const data = await resp.json();

        if (!resp.ok) {
            showToast(data.detail || 'Failed to scrape GMB link', 'error');
        } else {
            showToast('Lead added successfully!', 'success');
            document.getElementById('gmb-link').value = '';
        }
    } catch (e) {
        showToast('Error scraping GMB link', 'error');
    }

    btn.disabled = false;
}

// ─── Progress Tracking ──────────────────────────────────────

function showProgress(sessionId) {
    const overlay = document.getElementById('progress-overlay');
    overlay.classList.add('active');
    const startTime = Date.now();
    const INIT_TIMEOUT_MS = 90000; // 90 seconds timeout for initialization
    let pollErrors = 0;

    const pollInterval = setInterval(async () => {
        try {
            const resp = await fetch(`${API}/api/scrape/progress/${sessionId}`);
            const data = await resp.json();
            pollErrors = 0;

            const titleEl = document.getElementById('progress-title');
            const textEl = document.getElementById('progress-text');
            const barEl = document.getElementById('progress-bar');
            const detailEl = document.getElementById('progress-detail');

            if (data.stage === 'starting') {
                textEl.textContent = 'Initializing browser...';
                if (Date.now() - startTime > INIT_TIMEOUT_MS) {
                    titleEl.textContent = 'Initialization Timeout';
                    textEl.textContent = 'Browser failed to start. Check server logs for details.';
                    detailEl.textContent = '';
                    clearInterval(pollInterval);
                    setTimeout(() => {
                        overlay.classList.remove('active');
                        document.getElementById('scrape-btn').disabled = false;
                    }, 4000);
                }
            } else if (data.stage === 'found_listings') {
                textEl.textContent = `Found ${data.total} listings. Starting extraction...`;
            } else if (data.stage === 'scraping') {
                const pct = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
                textEl.textContent = `Scraping: ${data.current} / ${data.total}`;
                barEl.style.width = pct + '%';
                detailEl.textContent = `Scraped: ${data.scraped} | Skipped: ${data.skipped}`;
            } else if (data.stage === 'analyzing') {
                titleEl.textContent = 'Analyzing Businesses...';
                const pct = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
                textEl.textContent = `Analyzing: ${data.current || 0} / ${data.total}`;
                barEl.style.width = pct + '%';
                detailEl.textContent = `Saved: ${data.scraped} | Skipped: ${data.skipped}`;
            } else if (data.stage === 'completed') {
                titleEl.textContent = 'Scraping Complete!';
                textEl.textContent = `Total scraped: ${data.scraped} | Skipped: ${data.skipped}`;
                barEl.style.width = '100%';
                detailEl.textContent = '';
                clearInterval(pollInterval);
                setTimeout(() => {
                    overlay.classList.remove('active');
                    document.getElementById('scrape-btn').disabled = false;
                    showPage('leads');
                }, 2000);
            } else if (data.stage === 'failed') {
                titleEl.textContent = 'Scraping Failed';
                textEl.textContent = data.error || 'An error occurred';
                detailEl.textContent = '';
                clearInterval(pollInterval);
                setTimeout(() => {
                    overlay.classList.remove('active');
                    document.getElementById('scrape-btn').disabled = false;
                }, 3000);
            } else if (data.stage === 'unknown') {
                titleEl.textContent = 'Scraping Failed';
                textEl.textContent = 'Session not found. The scraper may have crashed.';
                detailEl.textContent = '';
                clearInterval(pollInterval);
                setTimeout(() => {
                    overlay.classList.remove('active');
                    document.getElementById('scrape-btn').disabled = false;
                }, 3000);
            }
        } catch (e) {
            console.error('Progress poll error:', e);
            pollErrors++;
            if (pollErrors >= 5) {
                const titleEl = document.getElementById('progress-title');
                const textEl = document.getElementById('progress-text');
                titleEl.textContent = 'Connection Lost';
                textEl.textContent = 'Cannot reach the server. Please check the server is running.';
                clearInterval(pollInterval);
                setTimeout(() => {
                    document.getElementById('progress-overlay').classList.remove('active');
                    document.getElementById('scrape-btn').disabled = false;
                }, 3000);
            }
        }
    }, 2000);
}

// ─── Leads ───────────────────────────────────────────────────

async function loadFilters() {
    try {
        const resp = await fetch(`${API}/api/filters`);
        const data = await resp.json();

        const nicheSelect = document.getElementById('filter-niche');
        const areaSelect = document.getElementById('filter-area');

        // Preserve current value
        const curNiche = nicheSelect.value;
        const curArea = areaSelect.value;

        nicheSelect.innerHTML = '<option value="">All Niches</option>' +
            data.niches.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
        areaSelect.innerHTML = '<option value="">All Areas</option>' +
            data.areas.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');

        nicheSelect.value = curNiche;
        areaSelect.value = curArea;
    } catch (e) {
        console.error('Load filters error:', e);
    }
}

async function loadLeads() {
    const params = new URLSearchParams({
        page: currentPage,
        per_page: 25,
        sort_by: currentSort,
        sort_order: currentSortOrder,
    });

    const search = document.getElementById('lead-search').value.trim();
    const niche = document.getElementById('filter-niche').value;
    const area = document.getElementById('filter-area').value;
    const type = document.getElementById('filter-type').value;
    const status = document.getElementById('filter-status').value;
    const website = document.getElementById('filter-website').value;

    if (search) params.set('search', search);
    if (niche) params.set('niche', niche);
    if (area) params.set('area', area);
    if (type) params.set('lead_type', type);
    if (status) params.set('approach_status', status);
    if (website) params.set('has_website', website);

    try {
        const resp = await fetch(`${API}/api/leads?${params}`);
        const data = await resp.json();

        const tbody = document.getElementById('leads-body');
        tbody.innerHTML = data.leads.map(l => `
            <tr>
                <td>
                    <strong class="link" onclick="openLead(${l.id})">${esc(l.business_name)}</strong>
                    ${l.area ? `<br><small style="color:var(--text-muted)">${esc(l.area)}</small>` : ''}
                </td>
                <td>${esc(l.category || '—')}</td>
                <td>${l.phone ? `<a href="tel:${esc(l.phone)}" class="link">${esc(l.phone)}</a>` : '—'}</td>
                <td>${l.email ? `<a href="mailto:${esc(l.email)}" class="link truncate" title="${esc(l.email)}">${esc(l.email)}</a>` : '<span style="color:var(--text-muted)">—</span>'}</td>
                <td>${l.website ? `<a href="${esc(l.website)}" target="_blank" class="link truncate" title="${esc(l.website)}">${truncUrl(l.website)}</a>` : '<span style="color:var(--red)">None</span>'}</td>
                <td>${scoreBar(l.overall_score)}</td>
                <td>${typeBadge(l.lead_type)}</td>
                <td>
                    <select class="form-control" style="padding:4px 8px;font-size:12px;width:auto;"
                            onchange="updateLeadStatus(${l.id}, this.value)">
                        ${statusOptions(l.approach_status)}
                    </select>
                </td>
                <td class="actions-cell">
                    <button class="btn-icon" title="View" onclick="openLead(${l.id})">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    <button class="btn-icon" title="Delete" onclick="deleteLead(${l.id})">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                    </button>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="9" class="empty-state"><p>No leads found</p></td></tr>';

        renderPagination(data);
    } catch (e) {
        console.error('Load leads error:', e);
    }
}

function debounceLoadLeads() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        currentPage = 1;
        loadLeads();
    }, 300);
}

function sortLeads(col) {
    if (currentSort === col) {
        currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
    } else {
        currentSort = col;
        currentSortOrder = 'desc';
    }
    loadLeads();
}

function renderPagination(data) {
    const container = document.getElementById('leads-pagination');
    if (data.pages <= 1) { container.innerHTML = ''; return; }

    let html = `<button ${data.page <= 1 ? 'disabled' : ''} onclick="goToPage(${data.page - 1})">&laquo; Prev</button>`;
    html += `<span>Page ${data.page} of ${data.pages}</span>`;
    html += `<button ${data.page >= data.pages ? 'disabled' : ''} onclick="goToPage(${data.page + 1})">Next &raquo;</button>`;
    container.innerHTML = html;
}

function goToPage(page) {
    currentPage = page;
    loadLeads();
}

async function updateLeadStatus(id, status) {
    try {
        await fetch(`${API}/api/leads/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approach_status: status }),
        });
        showToast('Status updated', 'success');
    } catch (e) {
        showToast('Failed to update status', 'error');
    }
}

async function deleteLead(id) {
    if (!confirm('Delete this lead?')) return;
    try {
        await fetch(`${API}/api/leads/${id}`, { method: 'DELETE' });
        showToast('Lead deleted', 'success');
        loadLeads();
    } catch (e) {
        showToast('Failed to delete lead', 'error');
    }
}

// ─── Lead Detail Modal ──────────────────────────────────────

async function openLead(id) {
    try {
        const resp = await fetch(`${API}/api/leads/${id}`);
        const lead = await resp.json();
        const audit = lead.audit_report ? JSON.parse(lead.audit_report) : {};

        document.getElementById('modal-title').textContent = lead.business_name;
        const body = document.getElementById('modal-body');

        const wq = audit.website_quality || {};
        const contactEmails = audit.contact_emails || [];
        const ownerSocials = lead.owner_social ? (() => { try { return JSON.parse(lead.owner_social); } catch { return {}; } })() : {};

        body.innerHTML = `
            <div class="tabs">
                <div class="tab active" onclick="switchTab(this, 'tab-details-${id}')">Details</div>
                <div class="tab" onclick="switchTab(this, 'tab-audit-${id}')">Audit Report</div>
                <div class="tab" onclick="switchTab(this, 'tab-website-${id}')">Website Analysis</div>
                <div class="tab" onclick="switchTab(this, 'tab-activity-${id}')">Activity</div>
                <div class="tab" onclick="switchTab(this, 'tab-edit-${id}')">Edit</div>
            </div>

            <!-- Details Tab -->
            <div id="tab-details-${id}" class="tab-content">
                <div class="detail-grid">
                    <div class="detail-item"><label>Business Name</label><span>${esc(lead.business_name)}</span></div>
                    <div class="detail-item"><label>Category</label><span>${esc(lead.category || '—')}</span></div>
                    <div class="detail-item"><label>Phone</label><span>${lead.phone ? `<a href="tel:${esc(lead.phone)}">${esc(lead.phone)}</a>` : '—'}</span></div>
                    <div class="detail-item"><label>Email</label><span>${lead.email ? `<a href="mailto:${esc(lead.email)}">${esc(lead.email)}</a>` : '<span style="color:var(--text-muted)">Not found</span>'}</span></div>
                    <div class="detail-item"><label>Website</label><span>${lead.website ? `<a href="${esc(lead.website)}" target="_blank">${esc(lead.website)}</a>` : '<span style="color:var(--red)">No website</span>'}</span></div>
                    <div class="detail-item"><label>GMB Link</label><span>${lead.gmb_link ? `<a href="${esc(lead.gmb_link)}" target="_blank">View on Google Maps</a>` : '—'}</span></div>
                    <div class="detail-item"><label>Address</label><span>${esc(lead.address || '—')}</span></div>
                    <div class="detail-item"><label>Area</label><span>${esc(lead.area || '—')}</span></div>
                    <div class="detail-item"><label>Rating</label><span>${lead.rating ? `${lead.rating} / 5 (${lead.review_count || 0} reviews)` : '—'}</span></div>
                    <div class="detail-item"><label>Lead Type</label><span>${typeBadge(lead.lead_type)}</span></div>
                </div>

                <!-- Owner / Contact Section -->
                <div style="margin-top:20px;padding:16px;background:var(--bg-primary);border-radius:var(--radius)">
                    <h4 style="font-size:14px;margin-bottom:12px">Owner & Contact Details</h4>
                    <div class="detail-grid">
                        <div class="detail-item"><label>Owner Name</label><span>${esc(lead.owner_name || 'Not found')}</span></div>
                        <div class="detail-item"><label>LinkedIn</label><span>${lead.owner_linkedin ? `<a href="${esc(lead.owner_linkedin)}" target="_blank">View Profile</a>` : 'Not found'}</span></div>
                    </div>
                    ${Object.keys(ownerSocials).length > 0 ? `
                        <div style="margin-top:8px">
                            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Social Profiles</label>
                            <div style="display:flex;gap:8px;flex-wrap:wrap">
                                ${Object.entries(ownerSocials).map(([platform, url]) => `
                                    <a href="${esc(url)}" target="_blank" class="btn btn-secondary btn-sm" style="font-size:11px">${esc(platform.replace('.com',''))}</a>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    ${contactEmails.length > 1 ? `
                        <div style="margin-top:8px">
                            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">All Emails Found</label>
                            <div style="font-size:13px">${contactEmails.map(e => `<a href="mailto:${esc(e)}" style="margin-right:12px">${esc(e)}</a>`).join('')}</div>
                        </div>
                    ` : ''}
                </div>

                <div style="margin-top:16px">
                    <h4 style="font-size:14px;margin-bottom:8px">Scores</h4>
                    <div style="display:flex;gap:24px;">
                        <div>SEO Score: ${scoreBar(lead.seo_score)}</div>
                        <div>GMB Score: ${scoreBar(lead.gmb_score)}</div>
                        <div>Overall: ${scoreBar(lead.overall_score)}</div>
                    </div>
                </div>
                ${lead.notes ? `<div style="margin-top:16px"><h4 style="font-size:14px;margin-bottom:8px">Notes</h4><p style="font-size:13px;color:var(--text-secondary)">${esc(lead.notes)}</p></div>` : ''}
            </div>

            <!-- Audit Tab -->
            <div id="tab-audit-${id}" class="tab-content" style="display:none">
                ${lead.has_website ? `
                    <h4 style="margin-bottom:4px">SEO Analysis — Score: ${lead.seo_score}/100 ${lead.is_seo_optimized ? '<span style="color:var(--green)">(Optimized)</span>' : '<span style="color:var(--red)">(Needs Work)</span>'}</h4>
                    ${lead.has_old_website ? '<p style="color:var(--yellow);font-size:13px;margin-bottom:12px">Warning: Website appears outdated</p>' : ''}
                    ${audit.seo ? `
                        <div class="audit-section">
                            <h4>Issues Found</h4>
                            <ul class="audit-list issues">${(audit.seo.issues || []).map(i => `<li>${esc(i)}</li>`).join('') || '<li style="background:var(--green-bg);color:var(--green);border-left-color:var(--green)">No issues found!</li>'}</ul>
                        </div>
                        <div class="audit-section">
                            <h4>Recommendations</h4>
                            <ul class="audit-list recommendations">${(audit.seo.recommendations || []).map(r => `<li>${esc(r)}</li>`).join('') || '<li>No recommendations</li>'}</ul>
                        </div>
                    ` : ''}
                ` : '<p style="color:var(--text-muted)">No website to analyze. This is a website service pitch opportunity!</p>'}

                <div style="margin-top:20px">
                    <h4 style="margin-bottom:4px">GMB Analysis — Score: ${lead.gmb_score}/100 ${lead.is_gmb_optimized ? '<span style="color:var(--green)">(Optimized)</span>' : '<span style="color:var(--red)">(Needs Work)</span>'}</h4>
                    ${audit.gmb ? `
                        <div class="audit-section">
                            <h4>Issues</h4>
                            <ul class="audit-list issues">${(audit.gmb.issues || []).map(i => `<li>${esc(i)}</li>`).join('') || '<li style="background:var(--green-bg);color:var(--green);border-left-color:var(--green)">No issues!</li>'}</ul>
                        </div>
                        <div class="audit-section">
                            <h4>Recommendations</h4>
                            <ul class="audit-list recommendations">${(audit.gmb.recommendations || []).map(r => `<li>${esc(r)}</li>`).join('') || '<li>No recommendations</li>'}</ul>
                        </div>
                    ` : ''}
                </div>

                <div style="margin-top:20px;padding:16px;background:var(--bg-primary);border-radius:var(--radius)">
                    <h4 style="margin-bottom:8px">Pitch Recommendation</h4>
                    <p style="font-size:13px;color:var(--text-secondary)">
                        ${getPitchRecommendation(lead, audit)}
                    </p>
                </div>
            </div>

            <!-- Website Analysis Tab -->
            <div id="tab-website-${id}" class="tab-content" style="display:none">
                ${lead.has_website ? `
                    <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
                        <div style="padding:8px 16px;border-radius:var(--radius);font-size:13px;font-weight:600;${wq.design_age === 'outdated' ? 'background:var(--red-bg,rgba(239,68,68,0.1));color:var(--red)' : wq.design_age === 'needs_improvement' ? 'background:var(--yellow-bg,rgba(245,158,11,0.1));color:var(--yellow)' : 'background:var(--green-bg,rgba(34,197,94,0.1));color:var(--green)'}">
                            Design: ${wq.design_age === 'outdated' ? 'Outdated' : wq.design_age === 'needs_improvement' ? 'Needs Improvement' : 'Modern'}
                        </div>
                        <div style="padding:8px 16px;border-radius:var(--radius);font-size:13px;font-weight:600;${wq.has_contact_form ? 'background:var(--green-bg,rgba(34,197,94,0.1));color:var(--green)' : 'background:var(--red-bg,rgba(239,68,68,0.1));color:var(--red)'}">
                            Contact Form: ${wq.has_contact_form ? 'Found' : 'Missing'}
                        </div>
                    </div>

                    ${(wq.tech_stack || []).length > 0 ? `
                        <div class="audit-section">
                            <h4>Tech Stack Detected</h4>
                            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
                                ${wq.tech_stack.map(t => `<span style="padding:4px 10px;background:var(--bg-primary);border-radius:12px;font-size:12px;color:var(--text-secondary)">${esc(t)}</span>`).join('')}
                            </div>
                        </div>
                    ` : ''}

                    ${(wq.outdated_indicators || []).length > 0 ? `
                        <div class="audit-section">
                            <h4>Outdated Design Indicators</h4>
                            <ul class="audit-list issues">${wq.outdated_indicators.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
                        </div>
                    ` : ''}

                    ${(wq.ui_ux_issues || []).length > 0 ? `
                        <div class="audit-section">
                            <h4>UI/UX Issues</h4>
                            <ul class="audit-list issues">${wq.ui_ux_issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
                        </div>
                    ` : ''}

                    ${(wq.mobile_issues || []).length > 0 ? `
                        <div class="audit-section">
                            <h4>Mobile Responsiveness Issues</h4>
                            <ul class="audit-list issues">${wq.mobile_issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
                        </div>
                    ` : ''}

                    ${(wq.contact_form_issues || []).length > 0 ? `
                        <div class="audit-section">
                            <h4>Contact Form Issues</h4>
                            <ul class="audit-list issues">${wq.contact_form_issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
                        </div>
                    ` : ''}

                    ${(wq.performance_issues || []).length > 0 ? `
                        <div class="audit-section">
                            <h4>Performance Issues</h4>
                            <ul class="audit-list issues">${wq.performance_issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
                        </div>
                    ` : ''}

                    ${!(wq.outdated_indicators || []).length && !(wq.ui_ux_issues || []).length && !(wq.mobile_issues || []).length && !(wq.performance_issues || []).length ? `
                        <div style="padding:16px;background:var(--green-bg,rgba(34,197,94,0.1));border-radius:var(--radius);color:var(--green);font-size:13px">
                            Website looks good! No major quality issues detected.
                        </div>
                    ` : ''}
                ` : `
                    <div style="padding:24px;text-align:center;color:var(--text-muted)">
                        <p style="font-size:15px;margin-bottom:8px">No Website</p>
                        <p style="font-size:13px">This business doesn't have a website — a great opportunity to pitch website development services.</p>
                    </div>
                `}
            </div>

            <!-- Activity Tab -->
            <div id="tab-activity-${id}" class="tab-content" style="display:none">
                <div style="margin-bottom:16px">
                    <div class="form-row">
                        <select class="form-control" id="activity-type-${id}">
                            <option value="note">Note</option>
                            <option value="email_sent">Email Sent</option>
                            <option value="call_made">Call Made</option>
                            <option value="message_sent">Message Sent</option>
                        </select>
                        <div></div>
                    </div>
                    <textarea class="form-control" id="activity-desc-${id}" placeholder="Add a note or activity..." style="margin-top:8px"></textarea>
                    <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="addActivity(${id})">Add Activity</button>
                </div>
                <div class="timeline" id="timeline-${id}">
                    ${(lead.activities || []).map(a => `
                        <div class="timeline-item">
                            <div class="time">${formatDate(a.created_at)} — ${esc(a.activity_type)}</div>
                            <div class="desc">${esc(a.description)}</div>
                        </div>
                    `).join('') || '<p style="color:var(--text-muted);font-size:13px">No activities yet</p>'}
                </div>
            </div>

            <!-- Edit Tab -->
            <div id="tab-edit-${id}" class="tab-content" style="display:none">
                <div class="form-row">
                    <div class="form-group">
                        <label>Lead Type</label>
                        <select class="form-control" id="edit-type-${id}">
                            <option value="hot" ${lead.lead_type === 'hot' ? 'selected' : ''}>Hot</option>
                            <option value="warm" ${lead.lead_type === 'warm' ? 'selected' : ''}>Warm</option>
                            <option value="cold" ${lead.lead_type === 'cold' ? 'selected' : ''}>Cold</option>
                            <option value="new" ${lead.lead_type === 'new' ? 'selected' : ''}>New</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Approach Status</label>
                        <select class="form-control" id="edit-status-${id}">
                            ${statusOptions(lead.approach_status)}
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Phone</label>
                        <input class="form-control" id="edit-phone-${id}" value="${esc(lead.phone || '')}">
                    </div>
                    <div class="form-group">
                        <label>Email</label>
                        <input class="form-control" id="edit-email-${id}" value="${esc(lead.email || '')}">
                    </div>
                </div>
                <div class="form-group">
                    <label>Owner Name</label>
                    <input class="form-control" id="edit-owner-${id}" value="${esc(lead.owner_name || '')}">
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <textarea class="form-control" id="edit-notes-${id}">${esc(lead.notes || '')}</textarea>
                </div>
                <button class="btn btn-primary" onclick="saveLead(${id})">Save Changes</button>
            </div>
        `;

        document.getElementById('lead-modal').classList.add('active');
    } catch (e) {
        showToast('Failed to load lead details', 'error');
    }
}

function closeModal() {
    document.getElementById('lead-modal').classList.remove('active');
}

function switchTab(el, tabId) {
    const tabs = el.parentElement;
    tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');

    const parent = tabs.parentElement;
    parent.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    document.getElementById(tabId).style.display = 'block';
}

async function saveLead(id) {
    const payload = {
        lead_type: document.getElementById(`edit-type-${id}`).value,
        approach_status: document.getElementById(`edit-status-${id}`).value,
        phone: document.getElementById(`edit-phone-${id}`).value,
        email: document.getElementById(`edit-email-${id}`).value,
        owner_name: document.getElementById(`edit-owner-${id}`).value,
        notes: document.getElementById(`edit-notes-${id}`).value,
    };

    try {
        await fetch(`${API}/api/leads/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        showToast('Lead updated!', 'success');
        loadLeads();
    } catch (e) {
        showToast('Failed to update lead', 'error');
    }
}

async function addActivity(leadId) {
    const type = document.getElementById(`activity-type-${leadId}`).value;
    const desc = document.getElementById(`activity-desc-${leadId}`).value.trim();

    if (!desc) { showToast('Please enter a description', 'error'); return; }

    try {
        await fetch(`${API}/api/leads/${leadId}/activity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activity_type: type, description: desc }),
        });

        // Also update approach status based on activity type
        const statusMap = {
            email_sent: 'emailed',
            call_made: 'called',
            message_sent: 'messaged',
        };
        if (statusMap[type]) {
            await fetch(`${API}/api/leads/${leadId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ approach_status: statusMap[type] }),
            });
        }

        showToast('Activity added!', 'success');
        openLead(leadId); // Refresh modal
    } catch (e) {
        showToast('Failed to add activity', 'error');
    }
}

// ─── History ─────────────────────────────────────────────────

async function loadHistory() {
    try {
        const resp = await fetch(`${API}/api/scrape/sessions`);
        const sessions = await resp.json();

        const tbody = document.getElementById('history-body');
        tbody.innerHTML = sessions.map(s => `
            <tr>
                <td><strong>${esc(s.niche)}</strong></td>
                <td>${esc(s.area)}</td>
                <td>${s.module === 'no_website' ? 'No Website' : 'All Businesses'}</td>
                <td><span class="badge badge-status ${s.status === 'completed' ? 'converted' : s.status === 'failed' ? 'lost' : ''}">${esc(s.status)}</span></td>
                <td>${s.total_found}</td>
                <td>${s.total_scraped}</td>
                <td>${s.total_skipped}</td>
                <td>${formatDate(s.created_at)}</td>
            </tr>
        `).join('') || '<tr><td colspan="8" class="empty-state"><p>No scrape sessions yet</p></td></tr>';
    } catch (e) {
        console.error('Load history error:', e);
    }
}

// ─── Export ──────────────────────────────────────────────────

function exportLeads() {
    const params = new URLSearchParams();
    const niche = document.getElementById('filter-niche').value;
    const area = document.getElementById('filter-area').value;
    const type = document.getElementById('filter-type').value;
    if (niche) params.set('niche', niche);
    if (area) params.set('area', area);
    if (type) params.set('lead_type', type);

    window.open(`${API}/api/leads/export/csv?${params}`, '_blank');
}

// ─── Helper Functions ────────────────────────────────────────

function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function truncUrl(url) {
    try {
        const u = new URL(url);
        return u.hostname.replace('www.', '');
    } catch {
        return url?.substring(0, 30) || '';
    }
}

function scoreBar(score) {
    score = score || 0;
    const cls = score < 40 ? 'low' : score < 70 ? 'mid' : 'high';
    return `<div class="score-bar">
        <div class="score-track"><div class="score-fill ${cls}" style="width:${score}%"></div></div>
        <span class="score-label">${Math.round(score)}</span>
    </div>`;
}

function typeBadge(type) {
    const cls = { hot: 'badge-hot', warm: 'badge-warm', cold: 'badge-cold', new: 'badge-new' };
    return `<span class="badge ${cls[type] || 'badge-new'}">${(type || 'new').toUpperCase()}</span>`;
}

function statusBadge(status) {
    const labels = {
        not_contacted: 'Not Contacted',
        emailed: 'Emailed',
        called: 'Called',
        messaged: 'Messaged',
        follow_up: 'Follow Up',
        converted: 'Converted',
        lost: 'Lost',
    };
    const contacted = ['emailed', 'called', 'messaged', 'follow_up'].includes(status) ? 'contacted' : '';
    const special = status === 'converted' ? 'converted' : status === 'lost' ? 'lost' : '';
    return `<span class="badge badge-status ${contacted} ${special}">${labels[status] || status || 'Not Contacted'}</span>`;
}

function statusOptions(current) {
    const statuses = [
        ['not_contacted', 'Not Contacted'],
        ['emailed', 'Emailed'],
        ['called', 'Called'],
        ['messaged', 'Messaged'],
        ['follow_up', 'Follow Up'],
        ['converted', 'Converted'],
        ['lost', 'Lost'],
    ];
    return statuses.map(([v, l]) =>
        `<option value="${v}" ${v === current ? 'selected' : ''}>${l}</option>`
    ).join('');
}

function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getPitchRecommendation(lead, audit) {
    const recs = [];
    const wq = (audit && audit.website_quality) || {};

    if (!lead.has_website) {
        recs.push('<strong>Website Development:</strong> This business has no website. Pitch a professional website to establish their online presence.');
    }

    if (lead.has_old_website || wq.design_age === 'outdated') {
        const indicators = (wq.outdated_indicators || []).slice(0, 2);
        const details = indicators.length ? ' Issues: ' + indicators.join(', ') + '.' : '';
        recs.push(`<strong>Website Redesign:</strong> Their website uses outdated design/technology.${details} Pitch a modern, mobile-responsive redesign.`);
    }

    if ((wq.mobile_issues || []).length > 0) {
        recs.push(`<strong>Mobile Optimization:</strong> ${wq.mobile_issues.length} mobile issue(s) found. Pitch responsive design services to capture mobile traffic.`);
    }

    if (!wq.has_contact_form && lead.has_website) {
        recs.push('<strong>Contact Form:</strong> No working contact form detected. Pitch a professional contact form with lead capture.');
    } else if ((wq.contact_form_issues || []).length > 0) {
        recs.push(`<strong>Contact Form Fix:</strong> ${wq.contact_form_issues.length} issue(s) with their contact form. Pitch form repair/improvement.`);
    }

    if ((wq.ui_ux_issues || []).length > 0) {
        recs.push(`<strong>UI/UX Improvement:</strong> ${wq.ui_ux_issues.length} UI/UX issue(s) found. Pitch a design audit and improvements.`);
    }

    if ((wq.performance_issues || []).length > 0) {
        recs.push(`<strong>Performance Optimization:</strong> ${wq.performance_issues.length} performance issue(s) detected. Pitch speed optimization services.`);
    }

    if (lead.has_website && !lead.is_seo_optimized) {
        recs.push('<strong>Local SEO:</strong> Their website is not SEO optimized. Pitch local SEO services to improve search visibility.');
    }

    if (!lead.is_gmb_optimized) {
        recs.push('<strong>GMB Optimization:</strong> Their Google My Business profile needs work. Pitch GMB optimization services.');
    }

    if (lead.has_website) {
        recs.push('<strong>AI Chatbot:</strong> Add an AI chatbot to their website to improve customer engagement and capture leads 24/7.');
    }

    if (recs.length === 0) {
        recs.push('This business appears well-optimized. Consider pitching advanced services like PPC management, social media marketing, or advanced analytics.');
    }
    return recs.join('<br><br>');
}

// ─── Initialize ──────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
});

// Close modal on overlay click
document.getElementById('lead-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('lead-modal')) closeModal();
});

// Close modal on Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});
