/**
 * SkillOra - High-Performance Education Intelligence & Instant Search Engine
 * Colleges and jobs are loaded from the SkillOra cloud database
 */

// Supabase Cloud Backend Configuration
const SUPABASE_CONFIG = {
  url: (window.SKILLORA_CONFIG || {}).SUPABASE_URL,
  anonKey: (window.SKILLORA_CONFIG || {}).SUPABASE_PUBLISHABLE_KEY   // publishable key only (see data/config.js)
};

// Application State
let ALL_COLLEGES = [];
let CURRENT_FILTERED = [];
let CURRENT_PAGE = 1;
const ITEMS_PER_PAGE = 6;
let CURRENT_CATEGORY = "All";
let SELECTED_COLLEGE = null;
let SELECTED_JOB = null;

// Place Photography mappings (High-Res Realistic Campus & Workplace Photos)
const CAMPUS_PHOTOS = {
  nursing: [
    "assets/places/campus_nursing_1.jpg",
    "assets/places/campus_nursing_2.jpg",
    "assets/places/campus_nursing_3.jpg",
    "assets/places/campus_nursing_4.jpg",
    "assets/places/campus_nursing_5.jpg",
    "assets/places/campus_nursing_6.jpg"
  ],
  hospitality: [
    "assets/places/campus_hotel_1.jpg",
    "assets/places/campus_hotel_2.jpg",
    "assets/places/campus_hotel_3.jpg",
    "assets/places/campus_hotel_4.jpg",
    "assets/places/campus_hotel_5.jpg",
    "assets/places/campus_hotel_6.jpg"
  ],
  sales: [
    "assets/places/campus_sales_1.jpg",
    "assets/places/campus_sales_2.jpg",
    "assets/places/campus_sales_3.jpg",
    "assets/places/campus_sales_4.jpg"
  ],
  language: [
    "assets/places/campus_language_1.jpg",
    "assets/places/campus_language_2.jpg",
    "assets/places/campus_language_3.jpg",
    "assets/places/campus_language_4.jpg"
  ]
};

function getCollegeImage(college) {
  if (!college) return CAMPUS_PHOTOS.nursing[0];
  const cat = (college.category || "").toLowerCase();
  const id = Math.abs(Number(college.id) || 1);
  let pool = CAMPUS_PHOTOS.nursing;
  if (cat.includes("hotel") || cat.includes("hospitality")) {
    pool = CAMPUS_PHOTOS.hospitality;
  } else if (cat.includes("sales") || cat.includes("marketing")) {
    pool = CAMPUS_PHOTOS.sales;
  } else if (cat.includes("language") || cat.includes("grooming")) {
    pool = CAMPUS_PHOTOS.language;
  }
  return pool[id % pool.length];
}

let LAST_SUBMITTED_APPLICATION = null;
const SUPPORT_PHONE_TXT = ((window.SKILLORA_CONFIG || {}).SUPPORT_PHONE) || 'via the Contact page';


document.addEventListener('DOMContentLoaded', async () => {
  await window.COLLEGES_READY;     // verified colleges from the database
  initDatabase();
  initLiveHome();
  initSearchEngine();
  initCategoryListeners();
  initSidebarFilters();
  initStateDirectory();
  initCarousel();
  initTickerAnimation();
  initKeyboardListeners();
});

/* ==========================================================================
   1. DATABASE INITIALIZATION & IN-MEMORY ENGINE
   ========================================================================== */
function initDatabase() {
  ALL_COLLEGES = Array.isArray(window.COLLEGES_DB) ? window.COLLEGES_DB : [];

  CURRENT_FILTERED = [...ALL_COLLEGES];
  CURRENT_PAGE = 1;

  // Render initial page
  renderCatalogPage();
  updateCityOptions();
}

/* ==========================================================================
   2. INSTANT SEARCH AUTOCOMPLETE (< 1ms Latency)
   ========================================================================== */
function initSearchEngine() {
  const searchInput = document.getElementById('hero-search-input');
  const dropdown = document.getElementById('search-autocomplete-dropdown');
  const clearBtn = document.getElementById('clear-search-btn');
  const submitBtn = document.getElementById('hero-search-submit');
  const headerSearchBtn = document.getElementById('header-search-btn');

  if (!searchInput || !dropdown) return;

  const executeSearch = () => {
    const term = searchInput.value.trim();
    if (!term) return;
    dropdown.style.display = 'none';

    const lower = term.toLowerCase();
    const jobKeywords = ['job', 'vacancy', 'hiring', 'work', 'salary', 'nurse vacancy', 'icu nurse', 'staff nurse', 'receptionist', 'executive', 'technician', 'fresher job', 'walk in'];
    const isJobRelated = jobKeywords.some(k => lower.includes(k));

    if (isJobRelated) {
      window.location.href = `jobs.html?search=${encodeURIComponent(term)}`;
    } else {
      window.location.href = `colleges.html?search=${encodeURIComponent(term)}`;
    }
  };

  searchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim().toLowerCase();

    if (clearBtn) {
      clearBtn.style.display = val.length > 0 ? 'block' : 'none';
    }

    if (val.length < 2) {
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
      return;
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
    }

    const collegeMatches = [];
    const courseMatches = [];
    const jobMatches = [];

    // 1. Search the colleges loaded from the database
    for (let i = 0; i < ALL_COLLEGES.length; i++) {
      const c = ALL_COLLEGES[i];
      const nameMatch = c.name.toLowerCase().includes(val);
      const cityMatch = c.city.toLowerCase().includes(val);
      const stateMatch = c.state.toLowerCase().includes(val);
      const catMatch = (c.category || '').toLowerCase().includes(val);

      if ((nameMatch || cityMatch || stateMatch || catMatch) && collegeMatches.length < 4) {
        collegeMatches.push({
          title: c.name,
          sub: `${c.category} • ${c.city}, ${c.state}`,
          tag: '🎓 College',
          url: `colleges.html?collegeId=${c.id}`
        });
      }

      // Check inner courses
      if (c.courses && courseMatches.length < 4) {
        for (let j = 0; j < c.courses.length; j++) {
          const crs = c.courses[j];
          if (crs.name.toLowerCase().includes(val)) {
            if (!courseMatches.some(m => m.title === crs.name)) {
              courseMatches.push({
                title: crs.name,
                sub: `Offered at ${c.cleanName || c.name} • Fee: ${crs.feeDisplay}`,
                tag: '📚 Course',
                url: `colleges.html?search=${encodeURIComponent(crs.name)}`
              });
            }
          }
        }
      }

      if (collegeMatches.length >= 4 && courseMatches.length >= 4) break;
    }

    // 2. Search Verified Jobs Database
    let ALL_VERIFIED_JOBS = [];   // filled from the database by initLiveHome()

    for (let k = 0; k < ALL_VERIFIED_JOBS.length; k++) {
      const j = ALL_VERIFIED_JOBS[k];
      const titleMatch = j.title.toLowerCase().includes(val);
      const compMatch = j.company.toLowerCase().includes(val);
      const locMatch = j.location.toLowerCase().includes(val);
      const secMatch = (j.sector || '').toLowerCase().includes(val);

      if ((titleMatch || compMatch || locMatch || secMatch) && jobMatches.length < 4) {
        jobMatches.push({
          title: j.title,
          sub: `${j.company} • ${j.location} • ${j.salary}`,
          tag: '💼 Job Vacancy',
          url: `jobs.html?jobId=${j.id}`
        });
      }
    }

    const totalMatches = collegeMatches.length + courseMatches.length + jobMatches.length;

    if (totalMatches === 0) {
      dropdown.innerHTML = `
        <div class="ac-top-summary" style="background:#FFF9F0; border-bottom:1px solid #FFE4CC;">
          <div class="ac-top-summary-text">
            <span>⚠️ No immediate match for &ldquo;<strong>${escapeHtml(val)}</strong>&rdquo;</span>
          </div>
          <span class="ac-top-count-badge" style="color:#FF922A; border-color:#FFD2A8;">0 Found</span>
        </div>
        <div class="autocomplete-item" onclick="window.location.href='colleges.html?search=${encodeURIComponent(val)}'">
          <div class="ac-main-col">
            <div class="ac-title">Search complete database for &ldquo;${escapeHtml(val)}&rdquo;</div>
            <div class="ac-sub">Press Enter to explore colleges, courses, and hospital/hotel jobs</div>
          </div>
          <span class="ac-tag ac-tag-college">Search All →</span>
        </div>
      `;
      dropdown.style.display = 'block';
      return;
    }

    let html = `
      <div class="ac-top-summary">
        <div class="ac-top-summary-text">
          <span class="ac-summary-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="#0A68DC" stroke-width="2.5"/><path d="M21 21L16.65 16.65" stroke="#0A68DC" stroke-width="2.5" stroke-linecap="round"/></svg>
          </span>
          <span>Found <strong>${totalMatches}</strong> results for &ldquo;<strong>${escapeHtml(val)}</strong>&rdquo;</span>
        </div>
        <span class="ac-top-count-badge">${totalMatches} Matches</span>
      </div>
    `;

    if (collegeMatches.length > 0) {
      html += `<div class="ac-group-header">Colleges & institutes (${collegeMatches.length})</div>`;
      html += collegeMatches.map(m => `
        <a class="autocomplete-item" href="${m.url}">
          <div class="ac-main-col">
            <div class="ac-title">${escapeHtml(m.title)}</div>
            <div class="ac-sub">${escapeHtml(m.sub)}</div>
          </div>
          <span class="ac-tag ac-tag-college">${m.tag}</span>
        </a>
      `).join('');
    }

    if (courseMatches.length > 0) {
      html += `<div class="ac-group-header">📚 Courses & Degrees (${courseMatches.length})</div>`;
      html += courseMatches.map(m => `
        <a class="autocomplete-item" href="${m.url}">
          <div class="ac-main-col">
            <div class="ac-title">${escapeHtml(m.title)}</div>
            <div class="ac-sub">${escapeHtml(m.sub)}</div>
          </div>
          <span class="ac-tag ac-tag-course">${m.tag}</span>
        </a>
      `).join('');
    }

    if (jobMatches.length > 0) {
      html += `<div class="ac-group-header">Verified jobs & openings (${jobMatches.length})</div>`;
      html += jobMatches.map(m => `
        <a class="autocomplete-item" href="${m.url}">
          <div class="ac-main-col">
            <div class="ac-title">${escapeHtml(m.title)}</div>
            <div class="ac-sub">${escapeHtml(m.sub)}</div>
          </div>
          <span class="ac-tag ac-tag-job">${m.tag}</span>
        </a>
      `).join('');
    }

    html += `
      <div class="ac-footer-action" onclick="executeHeroSearchSubmit()">
        <span>🔎 Press <kbd style="background:#FFFFFF;border:1px solid #C7D8E8;padding:2px 6px;border-radius:4px;font-family:inherit;font-size:11px;font-weight:800;color:#0A2540;">Enter</kbd> to explore full results for &ldquo;${escapeHtml(val)}&rdquo; in dedicated tab →</span>
      </div>
    `;

    dropdown.innerHTML = html;
    dropdown.style.display = 'block';
  });

  window.executeHeroSearchSubmit = executeSearch;

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearBtn.style.display = 'none';
      dropdown.style.display = 'none';
    });
  }

  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') executeSearch();
  });

  if (submitBtn) submitBtn.addEventListener('click', executeSearch);

  if (headerSearchBtn) {
    headerSearchBtn.addEventListener('click', () => {
      searchInput.focus();
      document.getElementById('home').scrollIntoView({ behavior: 'smooth' });
    });
  }

  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

function handleSearchSelect(collegeId) {
  const dropdown = document.getElementById('search-autocomplete-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  window.location.href = `colleges.html?collegeId=${collegeId}`;
}

function runGlobalSearch(term) {
  window.location.href = `colleges.html?search=${encodeURIComponent(term)}`;
}

/* ==========================================================================
   3. CATEGORY FILTER SYSTEM
   ========================================================================== */
function initCategoryListeners() {
  document.querySelectorAll('.cat-card').forEach(card => {
    card.addEventListener('click', () => {
      const cat = card.getAttribute('data-category');
      filterByCategory(cat);
      document.getElementById('courses').scrollIntoView({ behavior: 'smooth' });
    });
  });

  document.querySelectorAll('.dropdown-item[data-category]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const cat = link.getAttribute('data-category');
      filterByCategory(cat);
      document.getElementById('courses').scrollIntoView({ behavior: 'smooth' });
    });
  });
}

function filterByCategory(category) {
  CURRENT_CATEGORY = category;

  document.querySelectorAll('.pill-btn').forEach(btn => {
    const cat = btn.getAttribute('data-cat');
    if (cat === category) {
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
    } else {
      btn.classList.remove('active');
      btn.setAttribute('aria-selected', 'false');
    }
  });

  if (category === 'All') {
    CURRENT_FILTERED = [...ALL_COLLEGES];
  } else {
    // Exact or loose match category
    CURRENT_FILTERED = ALL_COLLEGES.filter(c => {
      if (category === 'Nursing') return c.category.includes('Nursing');
      if (category === 'Hospitality') return c.category.includes('Hospitality');
      if (category === 'Sales & Marketing') return c.category.includes('Sales');
      if (category === 'Language') return c.category.includes('Language');
      return c.category === category;
    });
  }

  CURRENT_PAGE = 1;
  renderCatalogPage();

  const catSelect = document.getElementById('filter-category');
  if (catSelect) catSelect.value = category === 'All' ? '' : category;
}

/* ==========================================================================
   4. SIDEBAR FILTERS & DYNAMIC CASCADING
   ========================================================================== */
function initSidebarFilters() {
  const feeSlider = document.getElementById('filter-fee');
  if (feeSlider) {
    updateFeeDisplay(feeSlider.value);
  }
}

function updateCityOptions() {
  const stateSelect = document.getElementById('filter-state');
  const citySelect = document.getElementById('filter-city');
  if (!stateSelect || !citySelect) return;

  const state = stateSelect.value;
  citySelect.innerHTML = '<option value="">All Cities</option>';

  let cities = new Set();
  ALL_COLLEGES.forEach(c => {
    if (!state || c.state === state) {
      cities.add(c.city);
    }
  });

  Array.from(cities).sort().forEach(city => {
    const opt = document.createElement('option');
    opt.value = city;
    opt.textContent = city;
    citySelect.appendChild(opt);
  });
}

function updateFeeDisplay(val) {
  const display = document.getElementById('fee-current-val');
  if (display) {
    const formatted = Number(val).toLocaleString('en-IN');
    display.textContent = `Up to ₹${formatted}`;
  }
}

function applySidebarFilters() {
  const state = document.getElementById('filter-state')?.value || '';
  const city = document.getElementById('filter-city')?.value || '';
  const category = document.getElementById('filter-category')?.value || '';
  const maxFee = Number(document.getElementById('filter-fee')?.value || 200000);

  const selectedModes = [];
  document.querySelectorAll('input[name="mode"]:checked').forEach(cb => {
    selectedModes.push(cb.value);
  });

  CURRENT_FILTERED = ALL_COLLEGES.filter(c => {
    if (category) {
      if (category === 'Nursing' && !c.category.includes('Nursing')) return false;
      if (category === 'Hospitality' && !c.category.includes('Hospitality')) return false;
      if (category === 'IT & Coding' && !c.category.includes('IT & Coding')) return false;
      if (category === 'Designing' && !c.category.includes('Designing')) return false;
      if (category === 'Sales & Marketing' && !c.category.includes('Sales')) return false;
      if (category === 'Language' && !c.category.includes('Language')) return false;
      if (category === 'Material Science' && !c.category.includes('Material')) return false;
    }

    if (c.minFee > maxFee) return false;
    if (state && c.state !== state) return false;
    if (city && c.city !== city) return false;

    if (selectedModes.length > 0) {
      const matchesMode = c.courses.some(crs => 
        selectedModes.includes(crs.mode) || crs.mode === "Both"
      );
      if (!matchesMode) return false;
    }

    return true;
  });

  CURRENT_PAGE = 1;
  renderCatalogPage();
  showToast(`Filters applied: ${CURRENT_FILTERED.length} colleges matching!`);
  document.getElementById('courses').scrollIntoView({ behavior: 'smooth' });
}

function resetSidebarFilters() {
  const form = document.getElementById('filter-form');
  if (form) form.reset();

  const feeSlider = document.getElementById('filter-fee');
  if (feeSlider) {
    feeSlider.value = 200000;
    updateFeeDisplay(200000);
  }

  updateCityOptions();
  filterByCategory('All');
  showToast('All filters reset. Displaying full directory.');
}

function filterByState(state) {
  closeModal('state-modal');
  const stateSelect = document.getElementById('filter-state');
  if (stateSelect) {
    stateSelect.value = state;
    updateCityOptions();
    applySidebarFilters();
  }
}

/* ==========================================================================
   5. CATALOG RENDERING & PAGINATION (Zero Lag)
   ========================================================================== */
function renderCatalogPage() {
  const container = document.getElementById('courses-grid');
  const countBadge = document.getElementById('catalog-count-badge');
  const pageIndicator = document.getElementById('page-indicator');
  const prevBtn = document.getElementById('page-prev-btn');
  const nextBtn = document.getElementById('page-next-btn');

  if (!container) return;

  const total = CURRENT_FILTERED.length;
  const totalPages = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));

  if (CURRENT_PAGE > totalPages) CURRENT_PAGE = totalPages;
  if (CURRENT_PAGE < 1) CURRENT_PAGE = 1;

  const startIndex = (CURRENT_PAGE - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, total);
  const pageItems = CURRENT_FILTERED.slice(startIndex, endIndex);

  // Update badge and controls
  if (countBadge) {
    countBadge.textContent = total > 0 
      ? `Showing ${startIndex + 1}–${endIndex} of ${total} Verified Colleges`
      : `0 Colleges Found`;
  }

  if (pageIndicator) pageIndicator.textContent = `Page ${CURRENT_PAGE} of ${totalPages}`;
  if (prevBtn) prevBtn.disabled = CURRENT_PAGE <= 1;
  if (nextBtn) nextBtn.disabled = CURRENT_PAGE >= totalPages;

  if (total === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 40px 20px; text-align: center; background: #F8FCFF; border: 1px dashed #CCDEF5; border-radius: 8px;">
        <h4 style="font-size: 15px; color: #173C62; margin-bottom: 6px;">No colleges found for this specific filter</h4>
        <p style="font-size: 12px; color: #728DA9; margin-bottom: 14px;">Try expanding your fee budget or checking All States.</p>
        <button class="btn btn-apply-filters" onclick="resetSidebarFilters()">Reset All Filters</button>
      </div>
    `;
    return;
  }

  container.innerHTML = pageItems.map(c => {
    const thumb = getCollegeImage(c);
    const primaryCourse = c.courses[0] || { name: c.category, duration: "1 Year", feeDisplay: c.minFeeDisplay, mode: "Both" };

    return `
      <article class="course-card" onclick="window.location.href='colleges.html?collegeId=' + ${c.id}" style="cursor:pointer;">
        <div class="course-img-wrap">
          <img src="${thumb}" alt="${c.cleanName || c.name} Campus Facility" class="course-thumb" loading="lazy">
          <span class="verified-inst-badge" title="${c.approval || 'Verified Institute'}">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M5 13L9 17L19 7" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>${c.approval || 'Verified Institute'}</span>
          </span>
          <span class="campus-photo-tag"><i class="ic ic-pin"></i> Verified Campus</span>
        </div>
        <div class="course-body">
          <h3 class="course-title" title="${primaryCourse.name}">${primaryCourse.name}</h3>
          
          <div class="course-meta-tags-row">
            <span class="course-duration-tag">
              <span class="meta-icon"><i class="ic ic-clock"></i></span> ${primaryCourse.duration}
            </span>
            <span class="course-fee-tag">
              ${c.minFeeDisplay}
            </span>
          </div>

          <div class="course-location-row" title="${c.city}, ${c.state}">
            <span class="loc-pin"><i class="ic ic-pin"></i></span>
            <span class="loc-text">${c.city}, ${c.state}</span>
          </div>

          <div class="course-provider" title="${c.name}">
            <span class="inst-icon"><i class="ic ic-building"></i></span>
            <span class="inst-name">${c.cleanName || c.name}</span>
          </div>
          
          <button class="btn btn-view-course" onclick="event.stopPropagation(); window.location.href='colleges.html?collegeId=' + ${c.id}">
            <span>View College & Fees</span>
            <span class="btn-arrow">→</span>
          </button>
        </div>
      </article>
    `;
  }).join('');
}

function changeCatalogPage(delta) {
  CURRENT_PAGE += delta;
  renderCatalogPage();
  document.getElementById('courses').scrollIntoView({ behavior: 'smooth' });
}

function slideCourses(direction) {
  changeCatalogPage(direction);
}

/* ==========================================================================
   6. COLLEGE INTELLIGENCE MULTI-TAB MODAL (Collegedunia-style)
   ========================================================================== */
function openCollegeModal(collegeId) {
  window.location.href = `colleges.html?collegeId=${collegeId}`;
  return;
  const college = ALL_COLLEGES.find(c => c.id === Number(collegeId));
  if (!college) return;

  SELECTED_COLLEGE = college;

  // Set Campus Place Photo Hero Banner
  const campusImg = document.getElementById('modal-campus-img');
  const campusBadge = document.getElementById('modal-campus-badge-text');
  if (campusImg) {
    campusImg.src = getCollegeImage(college);
  }
  if (campusBadge) {
    const cat = (college.category || "").toLowerCase();
    if (cat.includes('nurse') || cat.includes('health')) {
      campusBadge.textContent = "📍 Verified Medical Campus & Teaching Hospital";
    } else if (cat.includes('hotel') || cat.includes('hospit')) {
      campusBadge.textContent = "📍 Verified Luxury Hotel & Culinary Campus";
    } else if (cat.includes('sales')) {
      campusBadge.textContent = "📍 Verified Corporate Business Campus";
    } else {
      campusBadge.textContent = "📍 Verified Academic Learning Campus";
    }
  }

  // Header info
  document.getElementById('modal-course-cat').textContent = college.category;
  document.getElementById('modal-rating-pill').textContent = (college.rating ? `★ ${college.rating} / 5` : '');
  document.getElementById('modal-approval-badge').textContent = college.approval || 'Verified Institute';
  document.getElementById('modal-course-title').textContent = college.name;
  document.getElementById('modal-course-institute').textContent = `${college.city}, ${college.state}${college.established ? ' • Est. ' + college.established : ''}`;

  // Tab 1: Overview
  const pCourse = college.courses[0] || { duration: "3 Years", feeDisplay: college.minFeeDisplay, mode: "Offline" };
  document.getElementById('modal-course-duration').textContent = pCourse.duration;
  document.getElementById('modal-course-fee').textContent = college.minFeeDisplay;
  document.getElementById('modal-course-mode').textContent = pCourse.mode;
  document.getElementById('modal-course-appr').textContent = college.approval || 'Government Approved';
  document.getElementById('modal-course-desc').textContent = college.overview || 'Accredited institution offering top-tier clinical and industrial training with guaranteed campus placement support.';

  // Tab 2: Courses & Fees Table
  document.getElementById('modal-tab-courses-count').textContent = college.courses.length;
  const tableBody = document.getElementById('modal-courses-table-body');
  if (tableBody) {
    tableBody.innerHTML = college.courses.map((crs, idx) => `
      <tr id="course-row-${idx}">
        <td style="font-weight:700;">${crs.name}</td>
        <td>${crs.duration}</td>
        <td class="table-fee-highlight">${crs.feeDisplay}</td>
        <td>${crs.mode}</td>
        <td style="color:#728DA9;">${crs.eligibility || '10+2 Any Stream'}</td>
        <td>
          <button class="table-apply-btn" onclick="applyDirectCourse('${crs.name}')">Apply</button>
        </td>
      </tr>
    `).join('');
  }

  // Dynamic Course Dropdown Selector inside Admission Form
  const courseSelect = document.getElementById('lead-course-select');
  if (courseSelect) {
    courseSelect.innerHTML = college.courses.map(crs => `
      <option value="${crs.name}" data-duration="${crs.duration}" data-fee="${crs.feeDisplay}">
        ${crs.name} (${crs.feeDisplay} / yr)
      </option>
    `).join('');
  }

  // Initialize selected course highlight with primary course
  updateFormCourseHighlight(pCourse);

  // Tab 3: Placements
  const highestPkg = `₹ ${(4.5 + (college.id % 4) * 1.5).toFixed(1)} LPA`;
  const avgPkg = `₹ ${(2.8 + (college.id % 3) * 0.6).toFixed(1)} LPA`;
  document.getElementById('modal-highest-pkg').textContent = highestPkg;
  document.getElementById('modal-avg-pkg').textContent = avgPkg;

  const recList = document.getElementById('modal-recruiters-list');
  if (recList) {
    const recruiters = Array.isArray(college.recruiters) ? college.recruiters : [];
    recList.innerHTML = recruiters.map(r => `<span class="recruiter-tag">🏢 ${r}</span>`).join('');
  }

  // Tab 4: Campus & Hostel
  document.getElementById('modal-hostel-info').textContent = `Living Accommodation: ${college.hostel || 'Hostel facility available on campus with Wi-Fi, 24/7 security, and hygienic food.'}`;

  // Reset form and success box state
  const form = document.getElementById('admission-enquiry-form');
  const successBox = document.getElementById('admission-success-box');
  if (form) form.style.display = 'block';
  if (successBox) successBox.style.display = 'none';

  // Auto-fill student profile if authenticated
  const _su = window.SkillOraAuth.getCurrentUser('student'); const userStr = _su ? JSON.stringify(_su) : null;
  if (userStr) {
    try {
      const u = JSON.parse(userStr);
      const nameInput = document.getElementById('lead-student-name');
      const phoneInput = document.getElementById('lead-student-phone');
      const emailInput = document.getElementById('lead-student-email');
      if (nameInput && u.name) nameInput.value = u.name;
      if (phoneInput && u.phone) phoneInput.value = u.phone;
      if (emailInput && u.email) emailInput.value = u.email;
    } catch (e) {}
  }

  // Default to overview tab
  const firstTab = document.querySelector('.c-tab-btn');
  if (firstTab) switchCollegeTab(firstTab, 'c-tab-overview');

  openModal('course-modal');
}

// Compatibility alias
function openCourseModal(id) {
  openCollegeModal(id);
}

function switchCollegeTab(btn, paneId) {
  document.querySelectorAll('.c-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.college-tab-pane').forEach(p => p.classList.remove('active'));

  if (btn) btn.classList.add('active');
  const pane = document.getElementById(paneId);
  if (pane) pane.classList.add('active');
}

function onCourseDropdownChange() {
  const select = document.getElementById('lead-course-select');
  if (!select || !SELECTED_COLLEGE) return;
  const courseName = select.value;
  const course = (SELECTED_COLLEGE.courses || []).find(c => c.name === courseName) || {
    name: courseName,
    duration: "Flexible",
    feeDisplay: SELECTED_COLLEGE.minFeeDisplay
  };
  updateFormCourseHighlight(course);
}

function updateFormCourseHighlight(course) {
  const nameEl = document.getElementById('highlight-course-name');
  const durEl = document.getElementById('highlight-course-duration');
  const feeEl = document.getElementById('highlight-course-fee');
  if (nameEl) nameEl.textContent = course.name;
  if (durEl) durEl.textContent = course.duration || 'Flexible';
  if (feeEl) feeEl.textContent = (course.feeDisplay || (course.fee ? '₹ ' + Number(course.fee).toLocaleString('en-IN') : 'Fee on request')) + ' / year';
}

function applyDirectCourse(courseName) {
  const select = document.getElementById('lead-course-select');
  if (select) {
    select.value = courseName;
    onCourseDropdownChange();
  }
  showToast(`Selected "${courseName}". Fill the quick form below to submit!`);
  const formContainer = document.querySelector('.modal-admission-container');
  if (formContainer) {
    formContainer.scrollIntoView({ behavior: 'smooth' });
    const nameInput = document.getElementById('lead-student-name');
    if (nameInput) setTimeout(() => nameInput.focus(), 300);
  }
}

async function submitEnrollment() {
  const nameInput = document.getElementById('lead-student-name');
  const phoneInput = document.getElementById('lead-student-phone');
  const emailInput = document.getElementById('lead-student-email');
  const batchInput = document.getElementById('lead-student-batch');
  const courseSelect = document.getElementById('lead-course-select');
  const submitBtn = document.getElementById('btn-submit-lead');

  const batch = batchInput ? batchInput.value : '2026 Regular Batch';
  const selectedCourseName = courseSelect ? courseSelect.value : (
    (SELECTED_COLLEGE && SELECTED_COLLEGE.courses && SELECTED_COLLEGE.courses[0]) 
      ? SELECTED_COLLEGE.courses[0].name 
      : (SELECTED_COLLEGE ? SELECTED_COLLEGE.category : 'General Admission')
  );
  const collegeName = SELECTED_COLLEGE ? (SELECTED_COLLEGE.cleanName || SELECTED_COLLEGE.name) : "the institute";
  const collegeId = SELECTED_COLLEGE ? SELECTED_COLLEGE.id : null;

  // 1. Mandatory Student Authentication Check
  const userObj = window.SkillOraAuth.getCurrentUser('student');
  const userStr = userObj ? JSON.stringify(userObj) : null;
  if (!userStr) {
    sessionStorage.setItem('SKILLORA_PENDING_APPLY', JSON.stringify({
      type: 'course',
      collegeId: collegeId,
      courseName: selectedCourseName,
      collegeName: collegeName
    }));
    alert(`To apply for "${selectedCourseName}" at ${collegeName}, please Sign In or create your free Student Account.`);
    window.location.href = `auth.html?redirect=apply&type=course&title=${encodeURIComponent(selectedCourseName)}`;
    return;
  }

  const user = JSON.parse(userStr);
  const studentName = (nameInput && nameInput.value.trim()) || user.name;
  const phone = (phoneInput && phoneInput.value.trim()) || user.phone;
  const email = (emailInput && emailInput.value.trim()) || user.email;

  if (!studentName || !phone) {
    showToast('Please enter your Name and Mobile Number.');
    return;
  }

  const courseObj = (SELECTED_COLLEGE && SELECTED_COLLEGE.courses) 
    ? SELECTED_COLLEGE.courses.find(c => c.name === selectedCourseName) 
    : null;
  const courseFee = courseObj ? courseObj.feeDisplay : (SELECTED_COLLEGE ? SELECTED_COLLEGE.minFeeDisplay : "Standard Fee");

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Submitting...</span>';
  }

  const refId = `SKL-2026-${Math.floor(1000 + Math.random() * 9000)}`;

  LAST_SUBMITTED_APPLICATION = {
    refId,
    studentName,
    phone,
    email: email || 'Not provided',
    courseName: selectedCourseName,
    collegeName,
    collegeState: SELECTED_COLLEGE ? SELECTED_COLLEGE.state : '',
    collegeCity: SELECTED_COLLEGE ? SELECTED_COLLEGE.city : '',
    batch,
    fee: courseFee,
    date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
    timestamp: new Date().toISOString()
  };

  // Cloud database is the single source of truth (no browser-only copies of applicant data).
  let cloudOk = false;
  try {
    cloudOk = await window.SkillOraAuth.submitAdmissionToCloud({
      collegeId: collegeId, studentName: studentName, phone: phone, email: email || null,
      courseName: `${selectedCourseName} (${batch})`,
      collegeState: SELECTED_COLLEGE ? SELECTED_COLLEGE.state : null,
      collegeCity: SELECTED_COLLEGE ? SELECTED_COLLEGE.city : null,
      source: 'Direct Website Form', refId: refId
    });
  } catch (err) {
    console.warn('Admission lead submission failed:', err);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Confirm & Submit Direct Application</span><span style="font-size:14px;">→</span>';
    }
    if (!cloudOk) {
      alert('We could not submit your application right now. Please check your connection and try again.');
      return;
    }

    // Display professional in-modal success card
    const form = document.getElementById('admission-enquiry-form');
    const successBox = document.getElementById('admission-success-box');
    if (form) form.style.display = 'none';
    if (successBox) {
      const refEl = document.getElementById('receipt-ref-id');
      const nameEl = document.getElementById('receipt-student-name');
      const courseEl = document.getElementById('receipt-course-name');
      const collEl = document.getElementById('receipt-college-name');
      const feeEl = document.getElementById('receipt-course-fee');
      if (refEl) refEl.textContent = refId;
      if (nameEl) nameEl.textContent = studentName;
      if (courseEl) courseEl.textContent = selectedCourseName;
      if (collEl) collEl.textContent = collegeName;
      if (feeEl) feeEl.textContent = `${courseFee} / Year`;
      successBox.style.display = 'block';
      successBox.scrollIntoView({ behavior: 'smooth' });
    }
    showToast(`Application successfully registered! Ref ID: ${refId}`, true);
  }
}

function downloadApplicationSlip() {
  if (!LAST_SUBMITTED_APPLICATION) {
    showToast('No active application slip available.');
    return;
  }
  const app = LAST_SUBMITTED_APPLICATION;
  const printWindow = window.open('', '_blank', 'width=750,height=600');
  if (!printWindow) {
    showToast(`Application Reference: ${app.refId}. Receipt confirmed!`, true);
    return;
  }
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>SkillOra - Official Admission Application Slip (${app.refId})</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 30px; color: #173C62; line-height: 1.5; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0A68DC; padding-bottom: 15px; margin-bottom: 20px; }
        .logo { font-size: 24px; font-weight: 800; color: #173C62; }
        .logo span { color: #FF922A; }
        .badge { background: #EDF8FF; color: #0A68DC; padding: 4px 10px; border-radius: 4px; font-weight: 700; font-size: 12px; }
        .table { width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 20px; }
        .table td { padding: 10px 12px; border-bottom: 1px solid #E5F0F9; font-size: 14px; }
        .table td:first-child { font-weight: 600; color: #728DA9; width: 35%; }
        .table td:last-child { font-weight: 700; color: #173C62; }
        .footer { font-size: 11px; color: #728DA9; border-top: 1px dashed #CCDEF5; padding-top: 12px; margin-top: 30px; text-align: center; }
        .stamp { display: inline-block; border: 2px solid #0FA66D; color: #0FA66D; font-weight: 800; font-size: 13px; padding: 6px 14px; border-radius: 6px; text-transform: uppercase; margin-top: 10px; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo">Skill<span>Ora</span> <div style="font-size:11px;color:#728DA9;font-weight:600;">Verified Admissions Portal</div></div>
        <div class="badge">PROVISIONAL ADMISSION SLIP 2026</div>
      </div>
      <h3>Direct Admission Registration Acknowledgment</h3>
      <table class="table">
        <tr><td>Reference ID</td><td style="color:#0A68DC;">${app.refId}</td></tr>
        <tr><td>Registration Date</td><td>${app.date}</td></tr>
        <tr><td>Student Full Name</td><td>${app.studentName}</td></tr>
        <tr><td>Mobile Number</td><td>${app.phone}</td></tr>
        <tr><td>Email Address</td><td>${app.email}</td></tr>
        <tr><td>Target Institution</td><td>${app.collegeName} (${app.collegeCity}, ${app.collegeState})</td></tr>
        <tr><td>Enrolled Program</td><td>${app.courseName}</td></tr>
        <tr><td>Academic Batch</td><td>${app.batch}</td></tr>
        <tr><td>Annual Tuition Fee</td><td style="color:#0FA66D;">${app.fee}</td></tr>
      </table>
      <div style="text-align:center;">
        <div class="stamp">✔ DIRECT SEAT APPLICATION REGISTERED</div>
      </div>
      <div class="footer">
        SkillOra Institutional Admissions Network • V3S Mall, Nirman Vihar, Delhi • ${SUPPORT_PHONE_TXT} • support@skillora.in
      </div>
      <script>
        window.onload = function() { window.print(); }
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

/* ==========================================================================
   7. STATE DIRECTORY MODAL
   ========================================================================== */
function initStateDirectory() {
  const container = document.querySelector('.state-grid-list');
  if (!container) return;

  // Aggregate real college counts by state
  const stateCounts = {};
  ALL_COLLEGES.forEach(c => {
    stateCounts[c.state] = (stateCounts[c.state] || 0) + 1;
  });

  const sortedStates = Object.keys(stateCounts).sort();

  container.innerHTML = sortedStates.map(state => `
    <div class="state-item" onclick="filterByState('${state}')">
      <strong class="state-name">${state}</strong>
      <span class="state-count">${stateCounts[state]} Verified Institutes • ${stateCounts[state] * 3}+ Courses</span>
    </div>
  `).join('');
}

/* ==========================================================================
   8. JOBS & PARTNER MODALS
   ========================================================================== */
const JOBS_DATA = [];   // jobs are loaded from the database on jobs.html

const JOB_PLACE_PHOTOS = {
  1: { img: "assets/places/job_hospital_1.jpg", badge: "🏥 Verified Hospital Facility • Lucknow" },
  2: { img: "assets/places/job_hospital_2.jpg", badge: "🏥 Verified Multispecialty Hospital • Delhi" },
  3: { img: "assets/places/job_hotel_1.jpg", badge: "🏨 Verified Resort & Hotel • Jaipur" },
  4: { img: "assets/places/job_hotel_2.jpg", badge: "🏨 Verified Luxury Hotel • Bengaluru" }
};

function openJobModal(jobId) {
  window.location.href = `jobs.html?jobId=${jobId}`;
  return;
  const job = JOBS_DATA.find(j => j.id === Number(jobId)) || JOBS_DATA[0];
  SELECTED_JOB = job;

  const photoInfo = JOB_PLACE_PHOTOS[job.id] || JOB_PLACE_PHOTOS[1];
  const jobImg = document.getElementById('modal-job-img');
  const jobBadge = document.getElementById('modal-job-badge-text');
  if (jobImg) jobImg.src = photoInfo.img;
  if (jobBadge) jobBadge.textContent = photoInfo.badge;

  document.getElementById('modal-job-title').textContent = job.title;
  document.getElementById('modal-job-company').textContent = `${job.company} • ${job.location}`;
  document.getElementById('modal-job-salary').textContent = job.salary;
  document.getElementById('modal-job-loc').textContent = job.location;

  // Reset form / success state
  const form = document.getElementById('job-application-form');
  const successBox = document.getElementById('job-success-box');
  if (form) form.style.display = 'block';
  if (successBox) successBox.style.display = 'none';

  // Auto-fill student profile if authenticated
  const _su = window.SkillOraAuth.getCurrentUser('student'); const userStr = _su ? JSON.stringify(_su) : null;
  if (userStr) {
    try {
      const u = JSON.parse(userStr);
      const nameInput = document.getElementById('job-candidate-name');
      const phoneInput = document.getElementById('job-candidate-phone');
      const emailInput = document.getElementById('job-candidate-email');
      if (nameInput && u.name) nameInput.value = u.name;
      if (phoneInput && u.phone) phoneInput.value = u.phone;
      if (emailInput && u.email) emailInput.value = u.email;
    } catch (e) {}
  }

  openModal('job-modal');
}

async function submitJobApplication() {
  const nameInput = document.getElementById('job-candidate-name');
  const phoneInput = document.getElementById('job-candidate-phone');
  const emailInput = document.getElementById('job-candidate-email');
  const expInput = document.getElementById('job-candidate-exp');
  const submitBtn = document.getElementById('btn-submit-job');

  const jobTitle = SELECTED_JOB ? SELECTED_JOB.title : 'Healthcare / Hospitality Opening';
  const companyName = SELECTED_JOB ? SELECTED_JOB.company : 'Verified Employer';
  const jobId = SELECTED_JOB ? SELECTED_JOB.id : 1;

  // 1. Mandatory Student Authentication Check
  const userObj = window.SkillOraAuth.getCurrentUser('student');
  const userStr = userObj ? JSON.stringify(userObj) : null;
  if (!userStr) {
    sessionStorage.setItem('SKILLORA_PENDING_APPLY', JSON.stringify({
      type: 'job',
      jobId: jobId,
      role: jobTitle,
      company: companyName
    }));
    alert(`To apply for "${jobTitle}" at ${companyName}, please Sign In or create your free Student Account.`);
    window.location.href = `auth.html?redirect=apply&type=job&title=${encodeURIComponent(jobTitle)}`;
    return;
  }

  const user = JSON.parse(userStr);
  const candidateName = (nameInput && nameInput.value.trim()) || user.name;
  const phone = (phoneInput && phoneInput.value.trim()) || user.phone;
  const email = (emailInput && emailInput.value.trim()) || user.email;
  const exp = expInput ? expInput.value.trim() : '';

  if (!candidateName || !phone) {
    showToast('Please enter your Full Name and Mobile Number.');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting Application...';
  }

  const refId = `SKL-JOB-2026-${Math.floor(1000 + Math.random() * 9000)}`;

  const jobAppRecord = {
    refId,
    candidateName,
    phone,
    email: email || 'Not provided',
    role: jobTitle,
    company: companyName,
    location: SELECTED_JOB ? SELECTED_JOB.location : 'Pan-India',
    salary: SELECTED_JOB ? SELECTED_JOB.salary : '₹ 20,000 - 35,000/mo',
    exp: exp || 'Fresher',
    date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
    timestamp: new Date().toISOString(),
    status: 'Applied',
    statusClass: 'status-applied'
  };

  let cloudOk = false;
  try {
    cloudOk = await window.SkillOraAuth.submitJobApplicationToCloud({
      jobId: jobId, candidateName: candidateName, phone: phone, email: email || null,
      experience: exp || 'Fresher', refId: refId, jobTitle: jobTitle
    });
  } catch (err) {
    console.warn('Job application failed:', err);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Confirm & Apply Now';
    }
    if (!cloudOk) {
      alert('We could not submit your application. Please make sure you are signed in, then try again.');
      return;
    }

    const form = document.getElementById('job-application-form');
    const successBox = document.getElementById('job-success-box');
    if (form) form.style.display = 'none';
    if (successBox) {
      const refEl = document.getElementById('job-receipt-ref-id');
      const nameEl = document.getElementById('job-receipt-name');
      const roleEl = document.getElementById('job-receipt-role');
      const compEl = document.getElementById('job-receipt-company');
      if (refEl) refEl.textContent = refId;
      if (nameEl) nameEl.textContent = candidateName;
      if (roleEl) roleEl.textContent = jobTitle;
      if (compEl) compEl.textContent = companyName;
      successBox.style.display = 'block';
    }
    showToast(`Application for "${jobTitle}" submitted to HR! Ref: ${refId}`, true);
  }
}

function openPartnerModal(type = 'general') {
  openModal('partner-modal');
  const orgInput = document.getElementById('partner-org-name');
  if (!orgInput) return;
  if (type === 'employer') orgInput.placeholder = "Hospital / Hotel / Company Name *";
  else if (type === 'trainer') orgInput.placeholder = "Trainer Name / Academy *";
  else orgInput.placeholder = "College / Institute Name *";
}

function setPartnerTab(btn, type) {
  document.querySelectorAll('#partner-modal .ptab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const orgInput = document.getElementById('partner-org-name');
  if (type === 'employer') orgInput.placeholder = "Hospital / Hotel / Company Name *";
  else if (type === 'trainer') orgInput.placeholder = "Trainer Name / Academy *";
  else orgInput.placeholder = "College / Institute Name *";
}

async function submitPartnerForm() {
  const val = (id) => (document.getElementById(id) || {}).value || '';
  const org = val('partner-org-name').trim(), person = val('partner-contact-name').trim(), phone = val('partner-phone').trim();
  const email = val('partner-email').trim(), city = val('partner-city').trim(), details = val('partner-details').trim();
  if (!org || !person || !phone) { showToast('Please fill in organisation, contact person and phone.', false); return; }
  const ok = await window.SkillOraAuth.submitContactInquiry({
    name: person, email: email || null, phone: phone, subject: 'Partner enquiry: ' + org,
    message: `Organisation: ${org}\nCity: ${city || '-'}\n${details || '(no extra details)'}`
  });
  if (!ok) { showToast('Could not send your request. Please try again.', false); return; }
  closeModal('partner-modal');
  const form = document.getElementById('partner-registration-form');
  if (form) form.reset();
  showToast('Partner request received. Our team will contact you.', true);
}

/* ==========================================================================
   9. AUTHENTICATION & MODAL UTILS
   ========================================================================== */
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function openStateModal() { openModal('state-modal'); }
function openVerifiedModal() { openModal('verified-modal'); }

const loginBtn = document.getElementById('login-btn');
const joinPartnerBtn = document.getElementById('join-partner-btn');

function checkAuthStatus() {
  const _s = window.SkillOraAuth.getCurrentUser('student'); const student = _s ? JSON.stringify(_s) : null;
  const _c = window.SkillOraAuth.getCurrentUser('college'); const college = _c ? JSON.stringify(_c) : null;
  const _e = window.SkillOraAuth.getCurrentUser('employer'); const employer = _e ? JSON.stringify(_e) : null;

  const setLoginLabel = (long, short) => {
    // keeps the long (desktop) and short (mobile) labels so the header never overflows on phones
    loginBtn.innerHTML = '<span class="desktop-auth-text"></span><span class="mobile-auth-text"></span>';
    loginBtn.querySelector('.desktop-auth-text').textContent = long;
    loginBtn.querySelector('.mobile-auth-text').textContent = short;
  };
  if (loginBtn) {
    if (student) {
      try {
        const u = JSON.parse(student);
        setLoginLabel(`Student (${u.name ? u.name.split(' ')[0] : 'Profile'})`, 'My account');
        loginBtn.href = 'dashboard.html';
        loginBtn.style.color = '#0FA66D';
        loginBtn.style.borderColor = '#0FA66D';
      } catch (e) {
        loginBtn.href = 'dashboard.html';
      }
    } else {
      setLoginLabel('Student Login / Sign Up', 'Login');
      loginBtn.href = 'auth.html?role=student';
      loginBtn.style.color = '#0A68DC';
      loginBtn.style.borderColor = '#0A68DC';
    }
  }

  if (joinPartnerBtn) {
    joinPartnerBtn.onclick = function(e) {
      window.location.href = 'auth.html?role=institute';
    };
  }

  // Handle return redirect from authentication
  try {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('openApply') === 'true' && urlParams.get('collegeId')) {
      const colId = Number(urlParams.get('collegeId'));
      const crs = urlParams.get('courseName');
      setTimeout(() => {
        openCollegeModal(colId);
        if (crs) applyDirectCourse(decodeURIComponent(crs));
      }, 500);
    }
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', checkAuthStatus);
checkAuthStatus();

function openInfoModal(type) {
  const title = document.getElementById('info-modal-title');
  const content = document.getElementById('info-modal-content');
  if (!title || !content) return;

  const infoData = {
    about: {
      title: "About SkillOra",
      html: `
        <p style="margin-bottom:10px;"><strong>SkillOra</strong> is India’s premier unified career readiness ecosystem, bringing high-quality vocational education, verified healthcare & hospitality colleges, and genuine employment opportunities into one trusted digital hub.</p>
        <p style="margin-bottom:10px;">Founded with the mission to bridge the skill gap between aspiring learners and top-tier healthcare facilities, luxury hotels, and modern tech enterprises, SkillOra empowers over 50,000 students annually across 23 states in India.</p>
        <p><strong>Corporate Office:</strong> V3S Mall, Nirman Vihar, Delhi - 110092</p>
      `
    },
    contact: {
      title: "Contact SkillOra Support & Corporate Office",
      html: `
        <p style="margin-bottom:12px;color:var(--text-dark);">We are here to assist learners, educational institutes, and corporate employers 7 days a week.</p>
        <div style="background:#F3F9FE;padding:12px 14px;border-radius:8px;font-size:12.5px;display:flex;flex-direction:column;gap:8px;border:1px solid #D5E8FA;margin-bottom:14px;">
          <div><i class="ic ic-pin"></i> <strong>Corporate Office:</strong> V3S Mall, Nirman Vihar, Delhi - 110092</div>
          <div><i class="ic ic-phone"></i> <strong>Student Helpline:</strong> ${SUPPORT_PHONE_TXT} (Toll Free, 9 AM - 8 PM IST)</div>
          <div>✉️ <strong>General Inquiries:</strong> support@skilloraindia.com</div>
          <div>🏫 <strong>Institute Partnerships:</strong> admissions@skilloraindia.com</div>
          <div>💬 <strong>WhatsApp Helpline:</strong> ${SUPPORT_PHONE_TXT}</div>
        </div>
        <div>
          <div style="font-size:12.5px;font-weight:700;color:var(--text-dark);margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
            <span>🗺️ Location Map (V3S Mall, Nirman Vihar, Delhi)</span>
            <a href="https://maps.google.com/?q=V3S+Mall+Nirman+Vihar+Delhi" target="_blank" rel="noopener" style="font-size:11.5px;color:#0A68DC;text-decoration:none;font-weight:600;">Open Map ↗</a>
          </div>
          <div style="border-radius:8px;overflow:hidden;border:1px solid #DCE6F1;background:#EBF2F7;">
            <iframe 
              src="https://maps.google.com/maps?q=V3S+Mall+Nirman+Vihar+Delhi&t=&z=15&ie=UTF8&iwloc=&output=embed" 
              width="100%" 
              height="220" 
              style="border:0;display:block;" 
              allowfullscreen="" 
              loading="lazy" 
              referrerpolicy="no-referrer-when-downgrade">
            </iframe>
          </div>
        </div>
      `
    },
    terms: {
      title: "Terms & Conditions",
      html: `
        <p style="margin-bottom:10px;">By using the SkillOra portal, you agree to comply with our institutional guidelines, fair recruitment policies, and transparent fee disclosures.</p>
        <ul style="font-size:12px;color:#728DA9;display:flex;flex-direction:column;gap:6px;padding-left:18px;">
          <li>All student applications are free from hidden admission processing charges.</li>
          <li>Institutes listed on SkillOra must maintain statutory accreditation and physical lab standards.</li>
          <li>Verified job opportunities are monitored to prevent fraudulent employment fees.</li>
        </ul>
      `
    },
    privacy: {
      title: "Privacy Policy",
      html: `
        <p style="margin-bottom:10px;">SkillOra is committed to protecting your personal data in accordance with the Digital Personal Data Protection Act (DPDP).</p>
        <p style="font-size:12px;color:#728DA9;">We never sell your contact details or resume data to third-party telemarketers. Information is shared strictly with the educational institutes or employers you explicitly apply to.</p>
      `
    },
    support: {
      title: "Student Support & Career Assistance",
      html: `
        <p style="margin-bottom:10px;">Our dedicated student welfare desk assists with:</p>
        <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
          <div>✔ Education loan facilitation with 0% interest partner banks</div>
          <div>✔ Hostel accommodation and mess guidance in major study hubs</div>
          <div>✔ Scholarship guidance for reserved and merit-based aspirants</div>
          <div>✔ Post-course placement grievance escalation and redressal</div>
        </div>
      `
    }
  };

  const selected = infoData[type] || infoData.about;
  title.textContent = selected.title;
  content.innerHTML = selected.html;

  openModal('info-modal');
}

/* ==========================================================================
   10. LIVE WHATSAPP CHAT SIMULATOR
   ========================================================================== */
function openWhatsAppChat(initialMsg) {
  const drawer = document.getElementById('whatsapp-drawer');
  if (drawer) {
    drawer.classList.add('active');
    if (initialMsg) {
      setTimeout(() => sendQuickWAMsg(initialMsg), 300);
    }
  }
}

function closeWhatsAppDrawer() {
  const drawer = document.getElementById('whatsapp-drawer');
  if (drawer) drawer.classList.remove('active');
}

function sendWAMessage() {
  const input = document.getElementById('wa-chat-input');
  const text = input.value.trim();
  if (!text) return;

  appendWAMessage(text, 'outgoing');
  input.value = '';

  setTimeout(() => {
    let reply = "Thank you for reaching out! A verified SkillOra academic counselor is reviewing your profile. Would you like to check admission cutoffs or fee financing options?";
    if (text.toLowerCase().includes('nursing')) {
      reply = "Admissions for GNM and B.Sc Nursing are currently open across 122+ colleges in India. Would you like us to check fee structures for your city?";
    } else if (text.toLowerCase().includes('job')) {
      reply = "We have verified job openings across Lucknow, Delhi, and Bengaluru with starting salaries from ₹18,000 to ₹40,000/month. What role are you looking for?";
    }
    appendWAMessage(reply, 'incoming');
  }, 900);
}

function sendQuickWAMsg(text) {
  appendWAMessage(text, 'outgoing');
  setTimeout(() => {
    let reply = "Great! Connecting you with our Senior Counselor. Please share your WhatsApp number or city so we can send the prospectus directly.";
    appendWAMessage(reply, 'incoming');
  }, 800);
}

function appendWAMessage(text, type) {
  const body = document.getElementById('wa-chat-body');
  if (!body) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `wa-msg wa-${type}`;
  msgDiv.innerHTML = `
    <span>${text}</span>
    <div class="wa-time">Just now</div>
  `;
  body.appendChild(msgDiv);
  body.scrollTop = body.scrollHeight;
}

/* ==========================================================================
   11. TICKER & KEYBOARD LISTENERS
   ========================================================================== */
function initTickerAnimation() {
  // Intentionally empty: ticker content comes from the database (see initLiveHome). No sample headlines.
}

function showToast(message, isSuccess = false) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${isSuccess ? 'toast-success' : ''}`;
  toast.innerHTML = `
    <span><i class="ic ${isSuccess ? 'ic-check' : 'ic-info'}"></i></span>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function initCarousel() {
  // Handled via page pagination
}

function initKeyboardListeners() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop.active').forEach(m => {
        closeModal(m.id);
      });
      closeWhatsAppDrawer();
    }
  });

  const mobileToggle = document.getElementById('mobile-toggle');
  const mobileDrawer = document.getElementById('mobile-drawer');
  const mobileBackdrop = document.getElementById('mobile-backdrop');
  const mobileClose = document.getElementById('mobile-drawer-close');

  if (mobileToggle && mobileDrawer) {
    mobileToggle.addEventListener('click', () => {
      mobileDrawer.classList.add('open');
      document.body.style.overflow = 'hidden';
    });
  }
  if (mobileBackdrop && mobileDrawer) {
    mobileBackdrop.addEventListener('click', () => {
      mobileDrawer.classList.remove('open');
      document.body.style.overflow = '';
    });
  }
  if (mobileClose && mobileDrawer) {
    mobileClose.addEventListener('click', () => {
      mobileDrawer.classList.remove('open');
      document.body.style.overflow = '';
    });
  }
}


/* ==========================================================================
   LIVE HOMEPAGE - everything below comes from the database (no sample content)
   ========================================================================== */
async function initLiveHome() {
  const esc = window.SkillOraAuth.escapeHtml;
  const colleges = window.COLLEGES_DB || [];
  let jobs = [];
  try { jobs = await window.SkillOraAuth.loadPublicJobs(); } catch (e) {}

  ALL_VERIFIED_JOBS = jobs.map(j => ({ id: j.id, title: j.title, company: j.company, location: j.location, salary: j.salary, sector: j.sector }));

  // headline numbers (real counts)
  const courseTotal = colleges.reduce((n, c) => n + (c.coursesCount || 0), 0);
  document.querySelectorAll('[data-live-college-count]').forEach(el => el.textContent = colleges.length);
  document.querySelectorAll('[data-live-course-count]').forEach(el => el.textContent = courseTotal);
  document.querySelectorAll('[data-live-job-count]').forEach(el => el.textContent = jobs.length);

  // Latest verified jobs
  const stack = document.getElementById('job-items-stack');
  if (stack) {
    const img = (sector) => /health/i.test(sector) ? 'assets/places/job_hospital_1.jpg' : /hosp/i.test(sector) ? 'assets/places/job_hotel_1.jpg' : 'assets/places/campus_sales_1.jpg';
    stack.innerHTML = jobs.length === 0
      ? '<div style="padding:28px 16px;text-align:center;color:#55708E;font-size:13px;">No job openings are published yet. New hospital and hotel vacancies will appear here.</div>'
      : jobs.slice(0, 4).map(j => `
        <article class="job-item">
          <div class="job-logo-col"><div class="job-logo-box"><img src="${img(j.sector)}" alt="${j.company}" class="job-logo-img"></div></div>
          <div class="job-info-col">
            <h3 class="job-title">${j.title}</h3>
            <div class="job-company">${j.company}</div>
            ${j.location ? `<div class="job-location">${j.location}</div>` : ''}
            <div class="job-salary-row">
              ${j.salary ? `<span class="job-salary">${j.salary}</span>` : ''}
              <span class="job-type-badge">${j.type}</span>
            </div>
          </div>
          <div class="job-action-col"><button class="btn btn-apply-job" onclick="window.location.href='jobs.html?jobId=${Number(j.id)}'">Apply now</button></div>
        </article>`).join('');
  }

  // Latest updates (built from real data only)
  const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const items = [
    ...jobs.slice(0, 3).map(j => ({ tag: 'Hiring', cls: 'cat-hospital', title: `${j.title} - ${j.company}`, sub: [j.location, j.salary].filter(Boolean).join(' • '), date: j.postedAt, href: `jobs.html?jobId=${Number(j.id)}`, cta: 'View vacancy' })),
    ...colleges.filter(c => c.createdAt).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 3)
      .map(c => ({ tag: 'New college', cls: 'cat-nursing', title: c.name, sub: [c.city, c.state].filter(Boolean).join(', '), date: c.createdAt, href: `colleges.html?collegeId=${Number(c.id)}`, cta: 'View college' }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 4);

  const list = document.getElementById('bulletin-list');
  if (list) {
    list.innerHTML = items.length === 0
      ? '<div style="padding:22px 14px;text-align:center;color:#55708E;font-size:13px;">Nothing new yet. Fresh jobs and colleges will show up here.</div>'
      : items.map(i => `
        <div class="bulletin-item" onclick="window.location.href='${i.href}'" role="button" tabindex="0">
          <div class="bulletin-item-top"><span class="b-cat-pill ${i.cls}">${i.tag}</span><span class="b-date">${fmt(i.date)}</span></div>
          <h4 class="b-title">${i.title}</h4>
          ${i.sub ? `<p class="b-snippet">${i.sub}</p>` : ''}
          <span class="b-link">${i.cta}</span>
        </div>`).join('');
  }
  // Tickers: show only when there is something real to show
  const topBar = document.getElementById('live-updates-bar');
  const track = document.getElementById('top-ticker-track');
  if (track) {
    track.innerHTML = items.map(i => `
      <div class="top-ticker-item" onclick="window.location.href='${i.href}'" role="button" tabindex="0">
        <span class="t-tag t-tag-green">${i.tag}</span><span class="t-text">${i.title}</span>
        <span class="t-date">${fmt(i.date)}</span><span class="t-arrow">${i.cta}</span>
      </div>`).join('');
  }
  if (topBar) topBar.style.display = items.length ? '' : 'none';
  const tc = document.getElementById('ticker-content');
  if (tc) {
    tc.innerHTML = items.map(i => `<span class="ticker-item">• ${i.title}</span>`).join('');
    const card = tc.closest('.updates-ticker-card'); if (card) card.style.display = items.length ? '' : 'none';
  }
}
