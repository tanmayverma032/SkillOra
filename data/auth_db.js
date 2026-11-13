/**
 * SkillOra Auth & Data Layer  (v2 - secure)
 *
 *  - Real Supabase Auth (bcrypt-hashed passwords, JWT sessions, email confirmation).
 *  - Uses ONLY the publishable key from data/config.js. No secret key, no password
 *    hashes and no user database in the browser.
 *  - Every read/write carries the signed-in user's JWT; the database (RLS policies in
 *    db/01_secure_schema.sql) decides what that user may see or change.
 *  - localStorage holds only (a) the session tokens and (b) a display cache of the
 *    user's own profile so pages can render instantly. The cache grants NO access:
 *    editing it in dev-tools cannot read or change anyone's data.
 *
 *  Public API is unchanged so existing pages keep working.
 */
(function (window) {
  'use strict';

  const CFG = window.SKILLORA_CONFIG || {};
  const BASE = CFG.SUPABASE_URL;
  const PUBLISHABLE_KEY = CFG.SUPABASE_PUBLISHABLE_KEY;
  if (!BASE || !PUBLISHABLE_KEY) {
    console.error('SkillOra: data/config.js must be loaded before data/auth_db.js');
  }
  if (/^sb_secret_|service_role/i.test(PUBLISHABLE_KEY || '')) {
    throw new Error('A secret/service key must never be used in the browser.');
  }
  const REST = `${BASE}/rest/v1`, AUTH = `${BASE}/auth/v1`, STORAGE = `${BASE}/storage/v1`;

  const SESSION_KEY = 'SKILLORA_SESSION';
  const KEYS = { student: 'SKILLORA_CURRENT_USER', college: 'SKILLORA_COLLEGE_USER', employer: 'SKILLORA_EMPLOYER_USER' };

  /* ---------------- tiny utilities ---------------- */
  const nowIso = () => new Date().toISOString();
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const isEmail = v => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(v || '') && v.length <= 254;
  function prettySize(bytes) { const kb = Math.round(bytes / 1024); return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`; }
  function prettyDate(iso) { return new Date(iso || Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }

  /* ---------------- session handling ---------------- */
  function readSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } }
  function writeSession(s) {
    if (!s || !s.access_token) return;
    const expires_at = s.expires_at ? s.expires_at * 1000 : Date.now() + (s.expires_in || 3600) * 1000;
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      access_token: s.access_token, refresh_token: s.refresh_token, expires_at, user_id: (s.user && s.user.id) || (readSession() || {}).user_id
    }));
  }
  function clearAllLocal() {
    localStorage.removeItem(SESSION_KEY);
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    localStorage.removeItem('SKILLORA_ACTIVE_ROLE');
  }
  function hasSession() { const s = readSession(); return !!(s && s.refresh_token); }

  let refreshing = null;
  async function getAccessToken() {
    const s = readSession();
    if (!s) return null;
    if (s.expires_at - Date.now() > 60000) return s.access_token;       // still fresh
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const r = await fetch(`${AUTH}/token?grant_type=refresh_token`, {
            method: 'POST', headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: s.refresh_token })
          });
          if (!r.ok) { clearAllLocal(); return null; }
          const j = await r.json(); writeSession(j); return j.access_token;
        } catch (e) { return null; } finally { refreshing = null; }
      })();
    }
    return refreshing;
  }

  /** Authenticated request. Falls back to anonymous (publishable key) when logged out. */
  async function api(url, { method = 'GET', body, headers = {}, raw = false } = {}) {
    const token = await getAccessToken();
    const h = { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token || PUBLISHABLE_KEY}`, ...headers };
    let payload = body;
    if (body && !(body instanceof Blob) && typeof body !== 'string') { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    return fetch(url, { method, headers: h, body: payload });
  }
  async function jsonOrNull(res) { try { return await res.json(); } catch (e) { return null; } }

  /* ---------------- profile <-> session-user mapping ---------------- */
  function profileToUser(p, resumeUrl) {
    const ex = p.extra || {};
    const loc = [p.city, p.state].filter(Boolean).join(', ');
    const u = {
      id: p.id, cloudId: p.id, role: p.role, name: p.full_name || '', email: p.email, phone: p.phone || '',
      qualification: p.qualification || '', sector: p.sector || '', city: p.city || '', state: p.state || '',
      resumeName: p.resume_name || null, resumeUrl: resumeUrl || null, resumePath: p.resume_path || null, resumeSize: p.resume_size || null,
      resumeDate: p.resume_uploaded_at ? prettyDate(p.resume_uploaded_at) : null,
      createdAt: p.created_at, updatedAt: p.updated_at, lastLogin: p.last_login_at || nowIso()
    };
    if (p.role === 'employer') Object.assign(u, ex, {
      orgName: ex.orgName || p.org_name || p.full_name, company: ex.orgName || p.org_name || p.full_name,
      hrName: ex.hrName || '', location: ex.location || loc, orgType: ex.orgType || ''
    });
    if (p.role === 'college') Object.assign(u, ex, {
      collegeName: ex.collegeName || p.org_name || p.full_name, principalName: ex.principalName || '',
      location: ex.location || loc, accreditation: ex.accreditation || ''
    });
    return u;
  }

  async function fetchOwnProfile(uid) {
    const r = await api(`${REST}/profiles?id=eq.${encodeURIComponent(uid)}&select=*`);
    if (!r.ok) return null;
    const rows = await jsonOrNull(r);
    return rows && rows[0] ? rows[0] : null;
  }

  async function signedResumeUrl(path, seconds = 3600) {
    if (!path) return null;
    try {
      const r = await api(`${STORAGE}/object/sign/resumes/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', body: { expiresIn: seconds } });
      if (!r.ok) return null;
      const j = await r.json();
      return j.signedURL ? `${STORAGE}${j.signedURL.startsWith('/') ? '' : '/'}${j.signedURL}` : null;
    } catch (e) { return null; }
  }

  /* ---------------- registration ---------------- */
  async function registerUser(userData) {
    const { role = 'student', name, email, phone, password, qualification = '', sector = '', city = '', state = '', extra = {} } = userData;
    if (!['student', 'college', 'employer'].includes(role)) return { success: false, message: 'Invalid account type.' };
    if (!name || name.trim().length < 2) return { success: false, message: 'Please provide your full name.' };
    const cleanPhone = (phone || '').replace(/[\s-]/g, '');
    if (!/^\+?\d{10,15}$/.test(cleanPhone)) return { success: false, message: 'Please enter a valid mobile number (10 digits).' };
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!isEmail(cleanEmail)) return { success: false, message: 'Please enter a valid email address.' };
    if (!password || password.length < 8) return { success: false, message: 'Password must be at least 8 characters long.' };

    let res, j;
    try {
      res = await fetch(`${AUTH}/signup`, {
        method: 'POST', headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail, password,
          data: {
            name: name.trim(), phone: cleanPhone, role, qualification, sector, city: (city || '').trim(), state: (state || '').trim(),
            org_name: extra.orgName || extra.collegeName || '', extra
          }
        })
      });
      j = await jsonOrNull(res);
    } catch (e) {
      return { success: false, message: 'Could not reach the server. Please check your internet connection and try again.' };
    }
    if (!res.ok) {
      const msg = (j && (j.msg || j.error_description || j.message)) || '';
      if (/already|registered|exists/i.test(msg)) return { success: false, message: 'An account with this email already exists. Please sign in.' };
      if (/password/i.test(msg)) return { success: false, message: msg };
      return { success: false, message: 'We could not create your account right now. Please try again.' };
    }
    const authUser = j && (j.user || j);
    if (authUser && Array.isArray(authUser.identities) && authUser.identities.length === 0) {
      return { success: false, message: 'An account with this email already exists. Please sign in.' };
    }
    const confirmationNeeded = !(j && j.access_token);
    // Do not keep the signup session: the user signs in explicitly (keeps role-checks in one place).
    return {
      success: true, needsEmailConfirmation: confirmationNeeded,
      message: confirmationNeeded
        ? 'Account created! Please check your email and click the confirmation link, then sign in.'
        : 'Account created successfully! Please sign in to continue.',
      user: { id: authUser && authUser.id, role, name: name.trim(), email: cleanEmail, phone: cleanPhone, createdAt: nowIso() }
    };
  }

  /* ---------------- sign-in / sign-out ---------------- */
  async function authenticateUser(identifier, password, role = 'student') {
    const email = (identifier || '').trim().toLowerCase();
    if (!email) return { success: false, message: 'Please enter your registered email address.' };
    if (!isEmail(email)) return { success: false, message: 'Please sign in with your registered email address.' };
    if (!password) return { success: false, message: 'Please enter your account password.' };

    let res, j;
    try {
      res = await fetch(`${AUTH}/token?grant_type=password`, {
        method: 'POST', headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      j = await jsonOrNull(res);
    } catch (e) { return { success: false, message: 'Could not reach the server. Please check your internet connection.' }; }

    if (!res.ok) {
      const msg = (j && (j.error_description || j.msg || '')) || '';
      if (/confirm/i.test(msg)) return { success: false, message: 'Please confirm your email first - check your inbox for the confirmation link.' };
      return { success: false, message: 'Incorrect email or password.' };          // same message either way: no account enumeration
    }
    writeSession(j);

    const profile = await fetchOwnProfile(j.user.id);
    if (!profile) { clearAllLocal(); return { success: false, message: 'Your profile could not be loaded. Please try again.' }; }
    if (profile.role === 'admin' || profile.role !== role) {
      const labels = { student: 'Student', college: 'College Partner', employer: 'Hospital / Hotel Recruiter' };
      clearAllLocal();
      return { success: false, message: profile.role === 'admin'
        ? 'Please use the administrator login page.'
        : `This email is registered as a ${labels[profile.role] || profile.role} account. Please use the correct login tab.` };
    }
    api(`${REST}/rpc/touch_last_login`, { method: 'POST', body: {} }).catch(() => {});
    const url = await signedResumeUrl(profile.resume_path);
    const user = profileToUser(profile, url);
    setExclusiveSession(role, user);
    return { success: true, message: `Welcome back, ${user.name}!`, user };
  }

  function setExclusiveSession(role, userObject) {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    localStorage.setItem('SKILLORA_ACTIVE_ROLE', role);
    if (KEYS[role]) localStorage.setItem(KEYS[role], JSON.stringify(userObject));
  }
  function getActiveRole() {
    if (!hasSession()) return null;
    const active = localStorage.getItem('SKILLORA_ACTIVE_ROLE');
    if (active) return active;
    return Object.keys(KEYS).find(r => localStorage.getItem(KEYS[r])) || null;
  }
  function getCurrentUser(role = 'student') {
    if (!hasSession()) { Object.values(KEYS).forEach(k => localStorage.removeItem(k)); return null; }
    const activeRole = getActiveRole();
    if (activeRole && activeRole !== role) return null;
    try { const raw = localStorage.getItem(KEYS[role] || KEYS.student); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function signOut(role) {
    const s = readSession();
    if (s && s.access_token) {            // revoke server-side too (fire and forget)
      fetch(`${AUTH}/logout`, { method: 'POST', headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${s.access_token}` } }).catch(() => {});
    }
    clearAllLocal();
  }
  function enforceExclusiveRole(requiredRole) {
    const activeRole = getActiveRole();
    const labels = { student: 'Student', college: 'College Partner', employer: 'Hospital / Hotel HR Recruiter' };
    if (activeRole && activeRole !== requiredRole) {
      alert(`You are currently signed in as a ${labels[activeRole] || activeRole}.\n\nTo open the ${labels[requiredRole] || requiredRole} portal, please sign in with a ${labels[requiredRole] || requiredRole} account.`);
      window.location.href = `auth.html?role=${requiredRole}`; return false;
    }
    if (!getCurrentUser(requiredRole)) { window.location.href = `auth.html?role=${requiredRole}`; return false; }
    return true;
  }
  function requireLoginToApply(applyIntent) {
    const student = getCurrentUser('student');
    if (student) return { allowed: true, user: student };
    try { sessionStorage.setItem('SKILLORA_PENDING_APPLY', JSON.stringify(applyIntent)); } catch (e) {}
    const params = new URLSearchParams({ redirect: 'apply', type: applyIntent.type || 'course', title: applyIntent.courseName || applyIntent.role || '' });
    alert('Please sign in or create your free student account to submit your application.');
    window.location.href = `auth.html?${params.toString()}`;
    return { allowed: false, user: null };
  }

  /* ---------------- profile saves (cache updates instantly, DB update follows) ---------------- */
  function saveProfileFor(role, updated) {
    try {
      const current = getCurrentUser(role) || {};
      const merged = { ...current, ...updated, updatedAt: nowIso() };
      localStorage.setItem(KEYS[role], JSON.stringify(merged));
      const patch = {};
      if ('name' in updated) patch.full_name = String(updated.name).slice(0, 120);
      if ('phone' in updated) patch.phone = String(updated.phone).slice(0, 20);
      ['qualification', 'sector', 'city', 'state'].forEach(k => { if (k in updated) patch[k] = String(updated[k]).slice(0, 120); });
      const extraKeys = role === 'employer' ? ['orgName', 'hrName', 'orgType', 'roles', 'location'] : role === 'college' ? ['collegeName', 'principalName', 'accreditation', 'stream', 'location', 'affiliatedUniversity', 'hospitalTieup', 'hostelFacilities'] : [];
      const extra = {}; extraKeys.forEach(k => { if (k in merged) extra[k] = merged[k]; });
      if (extraKeys.length) { patch.extra = extra; if (merged.orgName || merged.collegeName) patch.org_name = merged.orgName || merged.collegeName; }
      if (Object.keys(patch).length && current.id) {
        api(`${REST}/profiles?id=eq.${encodeURIComponent(current.id)}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=minimal' } })
          .then(r => { if (!r.ok) console.warn('Profile could not be saved to the cloud (status ' + r.status + ')'); })
          .catch(() => console.warn('Profile could not be saved to the cloud (offline).'));
      }
      return { success: true, user: merged };
    } catch (e) { return { success: false, message: e.message }; }
  }
  const saveStudentProfile = d => saveProfileFor('student', d);
  const saveCollegeProfile = d => saveProfileFor('college', d);
  const saveEmployerProfile = d => saveProfileFor('employer', d);

  /* ---------------- resume (PRIVATE bucket, per-user folder, signed links) ---------------- */
  const ALLOWED_RESUME = { 'application/pdf': 'pdf', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx' };
  async function uploadResumeFile(file, currentUser) {
    if (!file) return { success: false, message: 'No file selected.' };
    const user = getCurrentUser('student');
    if (!user || !user.id) return { success: false, message: 'Please sign in again to upload your resume.' };
    if (file.size > 5 * 1024 * 1024) return { success: false, message: 'File is larger than 5 MB.' };
    if (!ALLOWED_RESUME[file.type]) return { success: false, message: 'Only PDF, DOC or DOCX files are allowed.' };

    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    const path = `${user.id}/${Date.now()}_${safe}`;
    try {
      const up = await api(`${STORAGE}/object/resumes/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', body: file, headers: { 'Content-Type': file.type, 'x-upsert': 'false' } });
      if (!up.ok) return { success: false, message: 'Upload failed. Please try again.' };      // honest failure - no fake "saved locally" success
      const meta = { resume_path: path, resume_name: file.name.slice(0, 200), resume_size: prettySize(file.size), resume_uploaded_at: nowIso() };
      const pr = await api(`${REST}/profiles?id=eq.${encodeURIComponent(user.id)}`, { method: 'PATCH', body: meta, headers: { Prefer: 'return=minimal' } });
      if (!pr.ok) return { success: false, message: 'File uploaded but profile could not be updated. Please try again.' };
      const url = await signedResumeUrl(path);
      const updated = { ...user, resumePath: path, resumeName: meta.resume_name, resumeUrl: url, resumeSize: meta.resume_size, resumeDate: prettyDate(meta.resume_uploaded_at) };
      localStorage.setItem(KEYS.student, JSON.stringify(updated));
      return { success: true, message: 'Resume uploaded securely.', resumeName: updated.resumeName, resumeUrl: url, resumeSize: updated.resumeSize, resumeDate: updated.resumeDate };
    } catch (e) { return { success: false, message: 'Network error during upload. Please try again.' }; }
  }
  async function refreshResumeLink() {           // call before showing a "view resume" link (links expire after 1 hour)
    const user = getCurrentUser('student'); if (!user) return null;
    const p = await fetchOwnProfile(user.id); if (!p || !p.resume_path) return null;
    const url = await signedResumeUrl(p.resume_path);
    localStorage.setItem(KEYS.student, JSON.stringify({ ...user, resumeUrl: url }));
    return url;
  }

  /* ---------------- direct candidate resumes & applications ---------------- */
  async function uploadDirectCandidateResume(file, optionalUser) {
    if (!file) return { success: false, message: 'No resume file selected.' };
    if (file.size > 5 * 1024 * 1024) return { success: false, message: 'File is larger than 5 MB.' };
    if (!ALLOWED_RESUME[file.type]) return { success: false, message: 'Only PDF, DOC or DOCX files are allowed.' };

    const u = optionalUser || getCurrentUser('student');
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    const folder = u && u.id ? u.id : 'direct_applications';
    const randTag = Math.random().toString(36).slice(2, 8);
    const path = `${folder}/${Date.now()}_${randTag}_${safe}`;

    try {
      const up = await api(`${STORAGE}/object/resumes/${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': file.type, 'x-upsert': 'false' }
      });
      if (!up.ok) {
        return { success: false, message: 'Could not upload resume to secure storage (status ' + up.status + ').' };
      }

      // If user is signed in as student, update their profile resume as well
      if (u && u.id) {
        const meta = { resume_path: path, resume_name: file.name.slice(0, 200), resume_size: prettySize(file.size), resume_uploaded_at: nowIso() };
        api(`${REST}/profiles?id=eq.${encodeURIComponent(u.id)}`, { method: 'PATCH', body: meta, headers: { Prefer: 'return=minimal' } }).catch(() => {});
        const url = await signedResumeUrl(path);
        const updated = { ...u, resumePath: path, resumeName: meta.resume_name, resumeUrl: url, resumeSize: meta.resume_size, resumeDate: prettyDate(meta.resume_uploaded_at) };
        localStorage.setItem(KEYS.student, JSON.stringify(updated));
      }

      return { success: true, path, name: file.name, size: prettySize(file.size) };
    } catch (e) {
      return { success: false, message: 'Network error uploading resume. Please try again.' };
    }
  }

  async function submitDirectJobApplication(d) {
    const user = getCurrentUser('student');
    const candName = String(d.name || d.candidateName || '').trim();
    const phone = String(d.phone || '').trim();
    const email = (d.email || (user && user.email) || '').trim().toLowerCase();
    const currentCity = String(d.currentCity || '').trim();
    const currentState = String(d.currentState || '').trim();
    const workStatus = String(d.workStatus || '').trim();
    const preferredLocation = String(d.preferredLocation || '').trim();
    const sector = String(d.sector || '').trim();
    const targetRole = String(d.targetRole || '').trim();
    const qualification = String(d.qualification || '').trim();
    const experience = String(d.experience || '').trim();
    const refId = d.refId || `SKL-APP-${Math.floor(10000 + Math.random() * 90000)}`;

    if (!candName || candName.length < 2) return { success: false, message: 'Please enter your full name.' };
    if (!/^\+?\d{10,15}$/.test(phone.replace(/[\s-]/g, ''))) return { success: false, message: 'Please enter a valid 10-digit mobile number.' };
    if (!isEmail(email)) return { success: false, message: 'Please enter a valid email address.' };

    let resumePath = d.resumePath || (user && user.resumePath) || null;
    let resumeName = d.resumeName || (user && user.resumeName) || null;

    if (d.resumeFile && d.resumeFile instanceof File) {
      const upRes = await uploadDirectCandidateResume(d.resumeFile, user);
      if (!upRes.success) {
        return { success: false, message: upRes.message || 'Failed to upload resume to secure storage.' };
      }
      resumePath = upRes.path;
      resumeName = upRes.name;
    }

    const structuredNotes = [
      `Ref: ${refId}`,
      `Direct Candidate Application`,
      `Sector: ${sector || 'General'}`,
      targetRole ? `Role: ${targetRole}` : '',
      workStatus ? `Work Status: ${workStatus}` : '',
      (currentCity || currentState) ? `Current Location: ${[currentCity, currentState].filter(Boolean).join(', ')}` : '',
      preferredLocation ? `Preferred Location: ${preferredLocation}` : '',
      qualification ? `Education: ${qualification}` : '',
      experience ? `Exp: ${experience}` : '',
      d.notes ? `Candidate Note: ${d.notes}` : ''
    ].filter(Boolean).join(' | ');

    const payload = {
      job_id: d.jobId ? Number(d.jobId) : null,
      candidate_name: candName,
      phone: phone,
      email: email,
      experience_years: experience || workStatus || null,
      resume_path: resumePath,
      stage: 'Applied',
      recruiter_notes: structuredNotes,
      user_id: user ? user.id : null,
      current_city: currentCity || null,
      current_state: currentState || null,
      work_status: workStatus || null,
      preferred_location: preferredLocation || null,
      sector: sector || null,
      target_role: targetRole || null,
      qualification: qualification || null
    };

    try {
      const res = await api(`${REST}/job_applications`, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: payload
      });

      if (!res.ok) {
        // Fallback: If database table has not yet run v3 migration, retry with base columns
        delete payload.current_city;
        delete payload.current_state;
        delete payload.work_status;
        delete payload.preferred_location;
        delete payload.sector;
        delete payload.target_role;
        delete payload.qualification;

        const res2 = await api(`${REST}/job_applications`, {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: payload
        });

        if (!res2.ok) {
          return { success: false, message: 'Could not record application in database. Please check your network and try again.' };
        }
      }

      // Also cache in local session for student dashboard
      if (user) {
        try {
          const apps = JSON.parse(localStorage.getItem('SKILLORA_ALL_JOB_APPLICATIONS') || '[]');
          apps.unshift({
            refId,
            jobTitle: targetRole || (sector ? sector + ' Placement' : 'Direct Candidate Application'),
            company: 'SkillOra Verified Placement',
            location: preferredLocation || [currentCity, currentState].filter(Boolean).join(', ') || 'Pan-India',
            name: candName,
            phone,
            email,
            date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
            status: 'Applied',
            statusClass: 'status-applied'
          });
          localStorage.setItem('SKILLORA_ALL_JOB_APPLICATIONS', JSON.stringify(apps));
        } catch(e) {}
      }

      return {
        success: true,
        refId,
        message: 'Your job application and resume have been securely received by SkillOra Career Placements.',
        resumePath
      };
    } catch (e) {
      return { success: false, message: 'Network error submitting application. Please try again.' };
    }
  }

  /* ---------------- leads & applications ---------------- */
  async function submitAdmissionToCloud(d) {
    const user = getCurrentUser('student');
    try {
      const res = await api(`${REST}/admission_leads`, {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: {
          college_id: d.collegeId || null, student_name: String(d.studentName || '').trim(), phone: String(d.phone || '').trim(),
          email: d.email ? String(d.email).trim().toLowerCase() : null, course_name: d.courseName || null,
          state: d.collegeState || null, city: d.collegeCity || null, status: 'New',
          source: d.source || 'SkillOra Direct Admissions', counsellor_notes: d.refId ? `Ref: ${d.refId}` : null,
          user_id: user ? user.id : null
        }
      });
      return res.ok;
    } catch (e) { return false; }
  }
  async function submitJobApplicationToCloud(d) {
    const user = getCurrentUser('student');
    if (!user) return false;                       // RLS requires a signed-in applicant
    try {
      const res = await api(`${REST}/job_applications`, {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: {
          job_id: d.jobId || null, candidate_name: String(d.candidateName || '').trim(), phone: String(d.phone || '').trim(),
          email: (d.email || user.email || '').toLowerCase() || null, experience_years: d.experience || null,
          resume_path: user.resumePath || null, stage: 'Applied', recruiter_notes: d.refId ? `Ref: ${d.refId}${d.jobTitle ? ' - ' + d.jobTitle : ''}` : null,
          user_id: user.id
        }
      });
      return res.ok;
    } catch (e) { return false; }
  }
  async function submitContactInquiry(d) {
    try {
      const res = await api(`${REST}/contact_inquiries`, { method: 'POST', headers: { Prefer: 'return=minimal' },
        body: { name: String(d.name || '').trim(), email: d.email || null, phone: d.phone || null, subject: d.subject || null, message: String(d.message || '').trim(), status: 'New' } });
      return res.ok;
    } catch (e) { return false; }
  }

  async function getList(path) { try { const r = await api(`${REST}/${path}`); if (!r.ok) return []; const j = await r.json(); return Array.isArray(j) ? j : []; } catch (e) { return []; } }
  const fetchStudentCloudAdmissions = async () => (getCurrentUser('student') ? getList('admission_leads?select=*&order=created_at.desc') : []);
  const fetchStudentCloudJobs       = async () => (getCurrentUser('student') ? getList('job_applications?select=*&order=applied_at.desc') : []);
  const fetchCollegeCloudLeads = async (collegeId) => getList(`admission_leads?select=*&order=created_at.desc${collegeId ? `&college_id=eq.${encodeURIComponent(collegeId)}` : ''}`);   // RLS limits to colleges you own
  async function fetchEmployerCloudApplications(jobIds = []) {
    const ids = (jobIds || []).map(Number).filter(Number.isFinite);
    return getList(`job_applications?select=*&order=applied_at.desc${ids.length ? `&job_id=in.(${ids.join(',')})` : ''}`);                                     // RLS limits to your own jobs
  }
  async function updateAdmissionLeadStatusInCloud(leadId, status, notes) {
    if (!leadId) return false;
    try { return (await api(`${REST}/admission_leads?id=eq.${encodeURIComponent(leadId)}`, { method: 'PATCH', body: notes === undefined ? { status } : { status, counsellor_notes: notes }, headers: { Prefer: 'return=minimal' } })).ok; } catch (e) { return false; }
  }
  async function updateJobApplicationStageInCloud(appId, stage, notes) {
    if (!appId) return false;
    try { return (await api(`${REST}/job_applications?id=eq.${encodeURIComponent(appId)}`, { method: 'PATCH', body: notes === undefined ? { stage } : { stage, recruiter_notes: notes }, headers: { Prefer: 'return=minimal' } })).ok; } catch (e) { return false; }
  }


  /* ---------------- public catalogue (colleges + jobs) - HTML-escaped once, here ---------------- */
  const E = escapeHtml;
  const lakh = n => (n || n === 0) ? '₹ ' + Number(n).toLocaleString('en-IN') : '';
  function mapCollege(c) {
    const courses = Array.isArray(c.courses) ? c.courses : [];
    return {
      id: c.id, name: E(c.name), cleanName: E(c.clean_name || c.name), category: E(c.category), state: E(c.state), city: E(c.city),
      established: c.established || null, rating: c.rating == null ? null : Number(c.rating), approval: E(c.approval || ''),
      minFee: Number(c.min_fee || 0), minFeeDisplay: E(c.min_fee_display || (c.min_fee ? lakh(c.min_fee) : '')),
      coursesCount: courses.length || c.courses_count || 0,
      courses: courses.map(x => ({ name: E(x.name), duration: E(x.duration || ''), fee: Number(x.fee || 0), feeDisplay: E(x.feeDisplay || (x.fee ? lakh(x.fee) : '')), mode: E(x.mode || ''), eligibility: E(x.eligibility || '') })),
      recruiters: (Array.isArray(c.recruiters) ? c.recruiters : []).map(E), verified: !!c.verified, hostel: E(c.hostel || ''), overview: E(c.overview || ''),
      createdAt: c.created_at, ownerId: c.owner_id || null
    };
  }
  function mapJob(j) {
    return {
      id: j.id, title: E(j.title), company: E(j.employer_name), sector: E(j.sector),
      location: E([j.location_city, j.location_state].filter(Boolean).join(', ')), city: E(j.location_city || ''), state: E(j.location_state || ''),
      salary: E(j.salary_display || ''), exp: E(j.experience || ''), type: E(j.job_type || 'Full Time'),
      description: E(j.description || ''), requirements: E(j.requirements || ''), vacancies: j.vacancies || null,
      perks: (Array.isArray(j.perks) ? j.perks : []).map(E), status: j.status, postedAt: j.created_at, employerId: j.employer_id || null
    };
  }
  async function loadPublicColleges() { const rows = await getList('colleges?select=*&verified=eq.true&order=name.asc&limit=2000'); return rows.map(mapCollege); }
  async function loadPublicJobs()     { const rows = await getList('jobs?select=*&status=eq.Published&order=created_at.desc&limit=500'); return rows.map(mapJob); }

  /* ---------------- employer portal ---------------- */
  async function fetchMyJobs() {
    const u = getCurrentUser('employer'); if (!u) return [];
    return (await getList(`jobs?select=*&employer_id=eq.${encodeURIComponent(u.id)}&order=created_at.desc`)).map(mapJob);
  }
  async function createJob(d) {
    const u = getCurrentUser('employer'); if (!u) return { success: false, message: 'Please sign in again.' };
    const body = {
      title: String(d.title || '').trim(), sector: d.sector, employer_name: String(d.company || u.orgName || '').trim(),
      location_city: d.city || null, location_state: d.state || null, salary_display: d.salary || null, experience: d.exp || null,
      job_type: d.type || 'Full Time', description: d.description || null, requirements: d.requirements || null,
      vacancies: Number(d.vacancies) || null, perks: Array.isArray(d.perks) ? d.perks : [], status: 'Pending', employer_id: u.id
    };
    try {
      const r = await api(`${REST}/jobs`, { method: 'POST', body, headers: { Prefer: 'return=minimal' } });
      return r.ok ? { success: true } : { success: false, message: 'The job could not be saved. Please check the details and try again.' };
    } catch (e) { return { success: false, message: 'Network error. Please try again.' }; }
  }
  async function setMyJobStatus(jobId, status) {
    if (!['Published', 'Paused', 'Closed'].includes(status)) return false;
    try { return (await api(`${REST}/jobs?id=eq.${encodeURIComponent(jobId)}`, { method: 'PATCH', body: { status }, headers: { Prefer: 'return=minimal' } })).ok; } catch (e) { return false; }
  }
  async function fetchMyApplicants() {         // RLS: only applicants of jobs owned by this employer
    const rows = await getList('job_applications?select=*,jobs(title,employer_id)&order=applied_at.desc&limit=500');
    return rows.map(a => ({
      id: a.id, jobId: a.job_id, name: E(a.candidate_name), phone: E(a.phone), email: E(a.email || ''),
      role: E((a.jobs && a.jobs.title) || a.target_role || (a.sector ? a.sector + ' Placement' : 'Direct Placement Candidate')),
      exp: E(a.experience_years || a.work_status || '—'), stage: E(a.stage || 'Applied'), appliedAt: a.applied_at, resumePath: a.resume_path || null
    }));
  }
  async function getApplicantResumeLink(path) { return signedResumeUrl(path, 600); }


  /* ---------------- student dashboard ---------------- */
  async function fetchMyAdmissions() {
    if (!getCurrentUser('student')) return [];
    const rows = await getList('admission_leads?select=*,colleges(name,city,state)&order=created_at.desc&limit=200');
    return rows.map(l => ({
      id: l.id, college: E((l.colleges && l.colleges.name) || ''), city: E((l.colleges && l.colleges.city) || l.city || ''), state: E((l.colleges && l.colleges.state) || l.state || ''),
      course: E(l.course_name || ''), status: E(l.status || 'New'), createdAt: l.created_at, ref: E(String(l.counsellor_notes || '').replace(/^Ref:\s*/, ''))
    }));
  }
  async function fetchMyApplications() {
    if (!getCurrentUser('student')) return [];
    const rows = await getList('job_applications?select=*,jobs(title,employer_name,salary_display,location_city,location_state)&order=applied_at.desc&limit=200');
    return rows.map(x => ({
      id: x.id,
      role: E((x.jobs && x.jobs.title) || x.target_role || (x.sector ? x.sector + ' Placement' : 'Direct Placement Application')),
      company: E((x.jobs && x.jobs.employer_name) || 'SkillOra Placement Network'),
      salary: E((x.jobs && x.jobs.salary_display) || (x.work_status ? 'Status: ' + x.work_status : '—')),
      location: E(x.jobs ? [x.jobs.location_city, x.jobs.location_state].filter(Boolean).join(', ') : (x.preferred_location || [x.current_city, x.current_state].filter(Boolean).join(', ') || 'Pan-India')),
      stage: E(x.stage || 'Applied'),
      appliedAt: x.applied_at,
      ref: E(((x.recruiter_notes || '').match(/Ref:\s*([^\s|]+)/) || [])[1] || '')
    }));
  }

  /* ---------------- college portal ---------------- */
  async function fetchMyCollege() {
    const u = getCurrentUser('college'); if (!u) return null;
    const rows = await getList(`colleges?select=*&owner_id=eq.${encodeURIComponent(u.id)}&limit=1`);
    return rows[0] ? { raw: rows[0], view: mapCollege(rows[0]) } : null;
  }
  async function saveMyCollege(d) {
    const u = getCurrentUser('college'); if (!u) return { success: false, message: 'Please sign in again.' };
    const body = {
      name: String(d.name || '').trim(), clean_name: String(d.name || '').trim(), category: d.category, state: d.state, city: d.city,
      established: d.established ? Number(d.established) : null, approval: d.approval || null, hostel: d.hostel || null,
      overview: d.overview || null, min_fee: Number(d.minFee) || 0, min_fee_display: d.minFee ? lakh(d.minFee) : null,
      courses: Array.isArray(d.courses) ? d.courses : [], courses_count: Array.isArray(d.courses) ? d.courses.length : 0,
      recruiters: Array.isArray(d.recruiters) ? d.recruiters : [], owner_id: u.id
    };
    try {
      const existing = await fetchMyCollege();
      const r = existing
        ? await api(`${REST}/colleges?id=eq.${existing.raw.id}`, { method: 'PATCH', body, headers: { Prefer: 'return=minimal' } })
        : await api(`${REST}/colleges`, { method: 'POST', body, headers: { Prefer: 'return=minimal' } });
      return r.ok ? { success: true, message: existing ? 'College profile updated.' : 'College profile submitted. It will appear publicly after SkillOra verifies it.' }
                  : { success: false, message: 'Could not save the college profile. Please check the details.' };
    } catch (e) { return { success: false, message: 'Network error. Please try again.' }; }
  }
  async function fetchMyLeads() {              // RLS: only leads of colleges you own
    const rows = await getList('admission_leads?select=*&order=created_at.desc&limit=500');
    return rows.map(l => ({ id: l.id, name: E(l.student_name), phone: E(l.phone), email: E(l.email || ''), course: E(l.course_name || ''), status: E(l.status || 'New'), notes: E(l.counsellor_notes || ''), createdAt: l.created_at }));
  }

  /* ---------------- admin (role enforced by the DATABASE, not by this page) ---------------- */
  async function adminSignIn(email, password) {
    email = (email || '').trim().toLowerCase();
    if (!isEmail(email) || !password) return { success: false, message: 'Enter your administrator email and password.' };
    let res, j;
    try {
      res = await fetch(`${AUTH}/token?grant_type=password`, { method: 'POST', headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      j = await jsonOrNull(res);
    } catch (e) { return { success: false, message: 'Could not reach the server.' }; }
    if (!res.ok) return { success: false, message: 'Invalid administrator credentials.' };
    writeSession(j);
    const p = await fetchOwnProfile(j.user.id);
    if (!p || p.role !== 'admin') { clearAllLocal(); return { success: false, message: 'Invalid administrator credentials.' }; }
    api(`${REST}/rpc/touch_last_login`, { method: 'POST', body: {} }).catch(() => {});
    api(`${REST}/admin_login_log`, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { admin_id: p.id, email: p.email, user_agent: navigator.userAgent.slice(0, 250) } }).catch(() => {});
    return { success: true, admin: { id: p.id, email: p.email, name: p.full_name } };
  }
  /** Returns the admin profile ONLY if the current JWT really belongs to an admin (checked server-side). */
  async function getVerifiedAdmin() {
    if (!hasSession()) return null;
    const token = await getAccessToken(); if (!token) return null;
    const r = await api(`${AUTH}/user`); if (!r.ok) return null;
    const u = await r.json(); const p = await fetchOwnProfile(u.id);
    return p && p.role === 'admin' ? { id: p.id, email: p.email, name: p.full_name } : null;
  }
  async function adminList(table, query = 'select=*') { return getList(`${table}?${query}`); }   // returns [] unless caller is a real admin (RLS)
  function adminSignOut() { signOut('all'); }

  window.SkillOraAuth = {
    registerUser, authenticateUser, signOut, getCurrentUser, getActiveRole, setExclusiveSession, enforceExclusiveRole, requireLoginToApply,
    saveStudentProfile, saveCollegeProfile, saveEmployerProfile, uploadResumeFile, uploadDirectCandidateResume, refreshResumeLink, submitDirectJobApplication,
    submitAdmissionToCloud, submitJobApplicationToCloud, submitContactInquiry,
    fetchStudentCloudAdmissions, fetchStudentCloudJobs, fetchCollegeCloudLeads, fetchEmployerCloudApplications,
    updateAdmissionLeadStatusInCloud, updateJobApplicationStageInCloud,
    adminSignIn, getVerifiedAdmin, adminList, adminSignOut,
    loadPublicColleges, loadPublicJobs, fetchMyJobs, createJob, setMyJobStatus, fetchMyApplicants, getApplicantResumeLink,
    fetchMyCollege, saveMyCollege, fetchMyLeads, fetchMyAdmissions, fetchMyApplications,
    api, escapeHtml, hasSession
  };
})(window);
