// Dashboard State Management
let currentData = null;
let lastServerMtime = null;
let casualtyChartInstance = null;
let leafletMapInstance = null;
let mapMarkers = {};
let activeGovFilter = 'all';
let expandedGovIds = new Set(); // Track expanded accordions across live refreshes

// Convert English numbers to Devanagari Nepali digits
function toNepaliDigits(number) {
  if (number === undefined || number === null) return '-';
  const nepaliDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
  return number.toString().replace(/\d/g, (digit) => nepaliDigits[parseInt(digit, 10)]);
}

// Show toast notification when live JSON updates occur
function showLiveToast() {
  const toast = document.getElementById('live-toast');
  if (toast) {
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
  }
}

// Main Fetch function to pull live JSON data from API
async function fetchDashboardData(isManual = false) {
  try {
    // Bust browser HTTP cache with timestamp query param
    const response = await fetch('/api/data?t=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) throw new Error('API fetch failed');
    
    const data = await response.json();
    
    // Check if data changed via server mtime
    if (lastServerMtime !== null && data._server_mtime !== lastServerMtime) {
      showLiveToast();
    }
    lastServerMtime = data._server_mtime;
    currentData = data;

    // Update Header metadata
    if (data.disaster_info) {
      document.getElementById('dashboard-title').innerText = data.disaster_info.title_np || 'भोटेकोशी बाढी विपद् सूचना ड्यासबोर्ड';
      document.getElementById('dashboard-sub').innerText = `${data.disaster_info.district_np || 'सिन्धुपाल्चोक'}, ${data.disaster_info.province_np || 'बागमती प्रदेश'} | सूचना तथा राहत व्यवस्थापन`;
      document.getElementById('last-updated-time').innerText = data.disaster_info.last_updated || 'भर्खरै';
      document.getElementById('alert-text').innerText = data.disaster_info.alert_level_np || 'अत्यधिक जोखिम क्षेत्र';
    }

    // Render navigation tabs, chart, map, road, shelter
    renderGovTabs(data.local_governments);
    renderCasualtyChart(data.local_governments);
    renderMap(data.local_governments);
    renderRoadConditions(data.road_conditions);
    renderShelterCamps(data.shelter_camps);

    // Apply active filter to sync stats, accordion table, and map focus
    filterLocalGov(activeGovFilter);

  } catch (err) {
    console.error('Error fetching dashboard data:', err);
  }
}

// 1. Render Top Summary Stat Cards (Overall or Filtered)
function renderFilteredStats(govId) {
  if (!currentData) return;

  let deaths = 0, missing = 0, injured = 0, displaced = 0, destroyed = 0, rescued = 0;

  if (govId === 'all') {
    const summary = currentData.overall_summary || {};
    deaths = summary.total_deaths || 0;
    missing = summary.total_missing || 0;
    injured = summary.total_injured || 0;
    displaced = summary.displaced_families || 0;
    destroyed = summary.destroyed_houses || 0;
    rescued = summary.rescued_people || 0;
  } else {
    const gov = (currentData.local_governments || []).find(g => g.id === govId);
    if (gov) {
      deaths = gov.casualties?.deaths || 0;
      missing = gov.casualties?.missing || 0;
      injured = gov.casualties?.injured || 0;
      displaced = gov.displaced_families || 0;
      destroyed = gov.destroyed_houses || 0;
      // Sum rescued across wards if present, or proportion
      rescued = (gov.wards || []).reduce((acc, w) => acc + (w.rescued || 0), 0) || Math.round((currentData.overall_summary?.rescued_people || 0) / (currentData.local_governments?.length || 1));
    }
  }

  document.getElementById('stat-deaths').innerText = toNepaliDigits(deaths);
  document.getElementById('stat-missing').innerText = toNepaliDigits(missing);
  document.getElementById('stat-injured').innerText = toNepaliDigits(injured);
  document.getElementById('stat-displaced').innerText = toNepaliDigits(displaced);
  document.getElementById('stat-destroyed').innerText = toNepaliDigits(destroyed);
  document.getElementById('stat-rescued').innerText = toNepaliDigits(rescued);
}

// 2. Render Navigation Tabs for Local Governments
function renderGovTabs(localGovs) {
  const container = document.getElementById('gov-tabs');
  if (!container || !localGovs) return;

  let html = `<button class="tab-btn ${activeGovFilter === 'all' ? 'active' : ''}" data-gov="all" onclick="filterLocalGov('all', this)">सबै स्थानीय तह (${toNepaliDigits(localGovs.length)})</button>`;
  
  localGovs.forEach((gov) => {
    const isActive = activeGovFilter === gov.id ? 'active' : '';
    html += `<button class="tab-btn ${isActive}" data-gov="${gov.id}" onclick="filterLocalGov('${gov.id}', this)">${gov.name_np}</button>`;
  });

  container.innerHTML = html;
}

// Filter Local Government tabs
function filterLocalGov(govId, btnElement) {
  activeGovFilter = govId;
  
  // Highlight active tab button
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-gov') === govId);
  });

  if (!currentData) return;

  // Update Summary Stats
  renderFilteredStats(govId);

  // Filter Accordion cards
  const searchInput = document.getElementById('search-input');
  const searchTerm = searchInput ? searchInput.value.trim() : '';
  if (searchTerm) {
    searchWards(searchTerm);
  } else {
    renderLocalGovernments(currentData.local_governments, activeGovFilter);
  }

  // Focus Map view & open popup
  focusMapGov(govId);

  // Highlight Chart bar
  highlightChartGov(govId);
}

// 3. Render Chart.js Casualty Bar Chart
function renderCasualtyChart(localGovs) {
  if (!localGovs || !Array.isArray(localGovs)) return;
  const ctx = document.getElementById('casualtyChart');
  if (!ctx) return;

  const labels = localGovs.map(g => g.name_np);
  const deathsData = localGovs.map(g => g.casualties?.deaths || 0);
  const missingData = localGovs.map(g => g.casualties?.missing || 0);
  const injuredData = localGovs.map(g => g.casualties?.injured || 0);

  if (casualtyChartInstance) {
    casualtyChartInstance.destroy();
  }

  casualtyChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'मृत्यु (Deaths)',
          data: deathsData,
          backgroundColor: localGovs.map(g => activeGovFilter === 'all' || activeGovFilter === g.id ? 'rgba(239, 68, 68, 0.9)' : 'rgba(239, 68, 68, 0.25)'),
          borderColor: '#ef4444',
          borderWidth: 1,
          borderRadius: 6
        },
        {
          label: 'बेपत्ता (Missing)',
          data: missingData,
          backgroundColor: localGovs.map(g => activeGovFilter === 'all' || activeGovFilter === g.id ? 'rgba(249, 115, 22, 0.9)' : 'rgba(249, 115, 22, 0.25)'),
          borderColor: '#f97316',
          borderWidth: 1,
          borderRadius: 6
        },
        {
          label: 'घाइते (Injured)',
          data: injuredData,
          backgroundColor: localGovs.map(g => activeGovFilter === 'all' || activeGovFilter === g.id ? 'rgba(234, 179, 8, 0.9)' : 'rgba(234, 179, 8, 0.25)'),
          borderColor: '#eab308',
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#cbd5e1',
            font: { family: 'Mukta', size: 13 }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return `${context.dataset.label}: ${toNepaliDigits(context.raw)}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#94a3b8', font: { family: 'Mukta', size: 12 } },
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        },
        y: {
          ticks: { 
            color: '#94a3b8', 
            font: { family: 'Mukta', size: 12 },
            callback: function(val) { return toNepaliDigits(val); }
          },
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        }
      }
    }
  });
}

function highlightChartGov(govId) {
  if (!casualtyChartInstance || !currentData) return;
  const localGovs = currentData.local_governments || [];
  
  casualtyChartInstance.data.datasets.forEach(ds => {
    let baseColor = 'rgba(239, 68, 68,';
    if (ds.label.includes('Missing') || ds.label.includes('बेपत्ता')) baseColor = 'rgba(249, 115, 22,';
    if (ds.label.includes('Injured') || ds.label.includes('घाइते')) baseColor = 'rgba(234, 179, 8,';

    ds.backgroundColor = localGovs.map(g => (govId === 'all' || govId === g.id) ? `${baseColor} 0.9)` : `${baseColor} 0.2)`);
  });
  casualtyChartInstance.update();
}

// 4. Render Leaflet Interactive Map
function renderMap(localGovs) {
  if (!localGovs) return;
  const mapElement = document.getElementById('map');
  if (!mapElement) return;

  if (!leafletMapInstance) {
    // Centered around Sindhupalchok Bhotekoshi region (27.85, 85.90)
    leafletMapInstance = L.map('map').setView([27.85, 85.90], 10);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 16
    }).addTo(leafletMapInstance);
  }

  // Clear existing markers
  Object.values(mapMarkers).forEach(m => leafletMapInstance.removeLayer(m));
  mapMarkers = {};

  localGovs.forEach(gov => {
    if (gov.latitude && gov.longitude) {
      const isHighRisk = gov.severity_code === 'danger';
      const markerColor = isHighRisk ? '#ef4444' : (gov.severity_code === 'warning' ? '#f97316' : '#3b82f6');
      
      const customIcon = L.divIcon({
        className: 'custom-map-icon',
        html: `<div style="background-color: ${markerColor}; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 12px ${markerColor}; cursor: pointer;"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });

      const popupContent = `
        <div style="font-family: 'Mukta', sans-serif; color: #0f172a; min-width: 180px;">
          <h4 style="margin: 0 0 4px; color: #b91c1c; font-size: 1.1rem;">${gov.name_np}</h4>
          <p style="margin: 0; font-size: 0.85rem; color: #475569;">${gov.type} | ${gov.severity}</p>
          <hr style="margin: 6px 0; border: none; border-top: 1px solid #e2e8f0;">
          <div style="font-size: 0.85rem; line-height: 1.4;">
            <strong>मृत्यु:</strong> ${toNepaliDigits(gov.casualties?.deaths || 0)} जना<br>
            <strong>बेपत्ता:</strong> ${toNepaliDigits(gov.casualties?.missing || 0)} जना<br>
            <strong>विस्थापित:</strong> ${toNepaliDigits(gov.displaced_families || 0)} परिवार<br>
            <strong>भत्किएका घर:</strong> ${toNepaliDigits(gov.destroyed_houses || 0)}
          </div>
        </div>
      `;

      const marker = L.marker([gov.latitude, gov.longitude], { icon: customIcon })
        .addTo(leafletMapInstance)
        .bindPopup(popupContent);

      marker.on('click', () => {
        filterLocalGov(gov.id);
      });

      mapMarkers[gov.id] = marker;
    }
  });
}

function focusMapGov(govId) {
  if (!leafletMapInstance) return;

  if (govId === 'all') {
    leafletMapInstance.setView([27.85, 85.90], 10);
    Object.values(mapMarkers).forEach(m => m.closePopup());
  } else if (mapMarkers[govId]) {
    const marker = mapMarkers[govId];
    const latLng = marker.getLatLng();
    leafletMapInstance.setView([latLng.lat, latLng.lng], 12, { animate: true });
    marker.openPopup();
  }
}

// 5. Render Local Government Breakdown & Ward Table Accordion
function renderLocalGovernments(localGovs, filterId = 'all') {
  const container = document.getElementById('local-gov-list');
  if (!container || !localGovs) return;

  const filteredGovs = filterId === 'all' 
    ? localGovs 
    : localGovs.filter(g => g.id === filterId);

  if (filteredGovs.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 2rem;">कुनै स्थानीय तह फेला परेन।</p>';
    return;
  }

  let html = '';
  filteredGovs.forEach((gov, index) => {
    // Accordion is open if it's explicitly expanded or if filtered to a single gov or first gov by default
    const isExpanded = expandedGovIds.has(gov.id) || filterId === gov.id || (filterId === 'all' && index === 0 && expandedGovIds.size === 0);
    if (isExpanded) expandedGovIds.add(gov.id);

    const severityBadgeClass = gov.severity_code === 'danger' ? 'status-danger' : (gov.severity_code === 'warning' ? 'status-warning' : 'status-info');

    html += `
      <div class="gov-card" id="gov-card-${gov.id}">
        <div class="gov-header" onclick="toggleGovAccordion('${gov.id}')">
          <div class="gov-info">
            <span style="font-size: 1.4rem;">🏛️</span>
            <div>
              <span class="gov-name">${gov.name_np}</span>
              <span class="gov-type">${gov.type}</span>
              <span class="status-tag ${severityBadgeClass}" style="margin-left: 0.5rem;">${gov.severity}</span>
            </div>
          </div>
          <div class="gov-stats">
            <div class="gov-stat-item">
              <span>मृत्यु</span>
              <span style="color: var(--primary-red);">${toNepaliDigits(gov.casualties?.deaths || 0)}</span>
            </div>
            <div class="gov-stat-item">
              <span>बेपत्ता</span>
              <span style="color: var(--accent-orange);">${toNepaliDigits(gov.casualties?.missing || 0)}</span>
            </div>
            <div class="gov-stat-item">
              <span>विस्थापित</span>
              <span style="color: var(--accent-purple);">${toNepaliDigits(gov.displaced_families || 0)}</span>
            </div>
            <div class="gov-stat-item">
              <span>अन्तरगत वडा</span>
              <span>${toNepaliDigits(gov.total_wards)}</span>
            </div>
            <span style="font-size: 1.2rem; transform: ${isExpanded ? 'rotate(180deg)' : 'rotate(0)'}; transition: transform 0.2s;" id="arrow-${gov.id}">▼</span>
          </div>
        </div>

        <div class="gov-body" id="body-${gov.id}" style="display: ${isExpanded ? 'block' : 'none'};">
          <div class="gov-meta">
            <div>📞 <strong>हेल्पलाइन:</strong> ${gov.helpline || 'उपलब्ध छैन'}</div>
            <div>👤 <strong>सम्पर्क व्यक्ति:</strong> ${gov.contact_person || 'उपलब्ध छैन'}</div>
            <div>🏚️ <strong>पूर्ण क्षति घर:</strong> ${toNepaliDigits(gov.destroyed_houses)} धुरी | <strong>आंशिक क्षति:</strong> ${toNepaliDigits(gov.partially_damaged_houses)} धुरी</div>
          </div>

          <h5 style="margin-bottom: 0.75rem; color: var(--text-main); font-size: 0.95rem;">📍 वडागत क्षति र राहत विवरण (Ward Breakdown):</h5>
          
          <div class="ward-table-wrapper">
            <table class="ward-table">
              <thead>
                <tr>
                  <th>वडा नं.</th>
                  <th>स्थान / क्षेत्र</th>
                  <th>मृत्यु</th>
                  <th>बेपत्ता</th>
                  <th>घाइते</th>
                  <th>विस्थापित</th>
                  <th>भत्किएका घर</th>
                  <th>राहत स्थिति</th>
                  <th>तत्काल आवश्यक सामाग्री</th>
                </tr>
              </thead>
              <tbody>
                ${(gov.wards || []).map(ward => `
                  <tr>
                    <td><strong>वडा नं. ${toNepaliDigits(ward.ward_no)}</strong></td>
                    <td><strong>${ward.name_np}</strong></td>
                    <td style="color: var(--primary-red); font-weight: 700;">${toNepaliDigits(ward.deaths)}</td>
                    <td style="color: var(--accent-orange); font-weight: 700;">${toNepaliDigits(ward.missing)}</td>
                    <td>${toNepaliDigits(ward.injured)}</td>
                    <td>${toNepaliDigits(ward.displaced_families)} परिवार</td>
                    <td>${toNepaliDigits(ward.destroyed_houses)} घर</td>
                    <td>
                      <div class="progress-bar-bg">
                        <div class="progress-bar-fill" style="width: ${ward.relief_pct || 0}%;"></div>
                      </div>
                      <span style="font-size: 0.8rem; font-weight: 700;">${toNepaliDigits(ward.relief_pct || 0)}%</span>
                      <div style="font-size: 0.75rem; color: var(--text-muted);">${ward.status || ''}</div>
                    </td>
                    <td style="font-size: 0.82rem; color: #fdba74;">${ward.urgent_needs || 'सामान्य'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// Toggle Accordion visibility and preserve state
function toggleGovAccordion(govId) {
  const body = document.getElementById(`body-${govId}`);
  const arrow = document.getElementById(`arrow-${govId}`);
  if (body) {
    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? 'block' : 'none';
    if (arrow) arrow.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0)';

    if (isHidden) {
      expandedGovIds.add(govId);
    } else {
      expandedGovIds.delete(govId);
    }
  }
}

// 6. Render Road & Highway Conditions
function renderRoadConditions(roads) {
  const container = document.getElementById('road-conditions-list');
  if (!container || !roads) return;

  container.innerHTML = roads.map(r => `
    <div class="card-item">
      <div class="card-item-title">
        <span>📍 ${r.section_np}</span>
        <span class="status-tag ${r.status_code === 'blocked' ? 'status-danger' : 'status-warning'}">${r.status_np}</span>
      </div>
      <div class="card-item-sub">${r.highway}</div>
      <div style="font-size: 0.88rem; color: var(--text-muted);">⚠️ ${r.impact_np}</div>
    </div>
  `).join('');
}

// 7. Render Relief Camps & Needs
function renderShelterCamps(camps) {
  const container = document.getElementById('shelter-camps-list');
  if (!container || !camps) return;

  container.innerHTML = camps.map(c => `
    <div class="card-item">
      <div class="card-item-title">
        <span>⛺ ${c.camp_name_np}</span>
        <span class="status-tag status-success">${c.status}</span>
      </div>
      <div class="card-item-sub">स्थान: ${c.location_np} | व्यवस्थापक: ${c.managing_agency}</div>
      <div style="font-size: 0.9rem; color: var(--text-main); margin-top: 0.4rem;">
        <strong>आश्रय परिवार:</strong> ${toNepaliDigits(c.current_families)} / ${toNepaliDigits(c.capacity_families)} (क्षमता)
      </div>
    </div>
  `).join('');
}

// Real-time search filter for wards & municipalities
function searchWards(query) {
  const term = query.toLowerCase().trim();
  if (!currentData || !currentData.local_governments) return;

  if (!term) {
    renderLocalGovernments(currentData.local_governments, activeGovFilter);
    return;
  }

  // Filter local governments matching search term in gov name or ward name
  const filtered = currentData.local_governments.filter(gov => {
    const govNameMatch = gov.name_np.toLowerCase().includes(term) || gov.name_en.toLowerCase().includes(term);
    const wardMatch = (gov.wards || []).some(w => 
      w.name_np.toLowerCase().includes(term) || 
      w.urgent_needs.toLowerCase().includes(term) ||
      `वडा ${w.ward_no}`.includes(term) ||
      `${w.ward_no}` === term
    );
    return govNameMatch || wardMatch;
  });

  renderLocalGovernments(filtered, 'all');
}

// Light / Dark Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeButtonText(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  updateThemeButtonText(newTheme);
}

function updateThemeButtonText(theme) {
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) {
    btn.innerHTML = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
  }
}

// Initial Load & Auto-polling every 8 seconds for live JSON updates
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  fetchDashboardData();
  
  // Auto-poll API for live edits in data/disaster_data.json
  setInterval(() => {
    fetchDashboardData();
  }, 8000);
});

