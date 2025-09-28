const Api = (() => {
  async function request(url, method = 'GET', data = null) {
    const csrftoken = document.querySelector('[name=csrfmiddlewaretoken]').value;
    const headers = {
      'Content-Type': 'application/json',
      'X-CSRFToken': csrftoken,
    };
    const config = {
      method,
      headers,
    };
    if (data) {
      config.body = JSON.stringify(data);
    }

    const response = await fetch(url, config);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      let errorMessage = errorData.detail;
      if (!errorMessage) {
          const fieldErrors = Object.entries(errorData).map(([field, messages]) => {
              return `${field}: ${messages.join(' ')}`;
          });
          errorMessage = fieldErrors.join('; ');
      }
      if (!errorMessage) {
          errorMessage = `Request failed with status ${response.status}`;
      }
      throw new Error(errorMessage);
    }
    if (response.status === 204) {
        return null;
    }
    return response.json();
  }

  return {
    get: (url) => request(url, 'GET'),
    post: (url, data) => request(url, 'POST', data),
    put: (url, data) => request(url, 'PUT', data),
    patch: (url, data) => request(url, 'PATCH', data),
    delete: (url) => request(url, 'DELETE'),
    getMe: () => request('/api/accounts/me/'),
    getTontines: () => request('/api/tontines/'),
    createTontine: (data) => request('/api/tontines/', 'POST', data),
    getTontineDetail: (id) => request(`/api/tontines/${id}/`),
    getTontineMembers: (id) => request(`/api/tontines/${id}/members/`),
  };
})();


const App = (() => {
  let state = { user: null, tontines: [] };
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('moinama.theme', theme);
    $('#darkModeSwitch').checked = theme === 'dark';
  }
  
  function initTheme() {
    const saved = localStorage.getItem('moinama.theme') || 'light';
    setTheme(saved);
    $('#darkModeSwitch').addEventListener('change', (e) => setTheme(e.target.checked ? 'dark' : 'light'));
  }

  function formatCurrency(n) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(n).replace('XOF', 'FCFA');
  }

  function translateFrequency(freq) {
    const map = {
        'daily': 'Quotidienne',
        'weekly': 'Hebdomadaire',
        'monthly': 'Mensuelle'
    };
    return map[freq] || freq;
  }

  function routeTo(hash) {
    const raw = (hash || location.hash || '#/dashboard');
    $$('.route').forEach(s => s.classList.remove('active'));
    
    if (raw.startsWith('#/tontine/')) {
      const tonId = raw.split('#/tontine/')[1];
      $('[data-route="tontine-detail"]').classList.add('active');
      $$('#navLinks .nav-link').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#/tontines'));
      $('.page-title').textContent = 'Détails de la tontine';
      renderTontineDetail(tonId);
      return;
    }

    const target = raw.replace('#/','');
    const el = document.querySelector(`[data-route="${target}"]`);
    if (el) el.classList.add('active');
    
    $$('#navLinks .nav-link').forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#/${target}`));
    $('.page-title').textContent = {
      dashboard:'Dashboard global', me:'Mon dashboard', tontines:'Tontines', transactions:'Transactions', messaging:'Messagerie'
    }[target] || 'Moinama';

    if (target === 'tontines') renderTontines();
  }

  async function renderTontines() {
    const wrap = $('#tontineCards');
    wrap.innerHTML = '<div class="text-center text-muted">Chargement...</div>';
    try {
      state.tontines = await Api.getTontines();
      if (!state.tontines.length) {
        wrap.innerHTML = '<div class="text-center text-muted">Aucune tontine trouvée.</div>';
        return;
      }
      wrap.innerHTML = '';
      state.tontines.forEach(t => {
        const col = document.createElement('div');
        col.className = 'col-12 col-md-6 col-xl-4';
        col.innerHTML = `
          <div class="card h-100">
            <div class="card-body d-flex flex-column">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <h3 class="h6 m-0">${t.name}</h3>
                <span class="badge bg-success">Active</span>
              </div>
              <div class="small text-muted mb-2">Montant: <strong>${formatCurrency(t.amount)}</strong> · ${translateFrequency(t.frequency)}</div>
              <div class="mt-auto d-flex gap-2">
                <button class="btn btn-sm btn-outline-primary" data-action="contribute" data-id="${t.id}"><i class="bi bi-plus-circle"></i> Cotiser</button>
                <button class="btn btn-sm btn-outline-info" data-action="view" data-id="${t.id}"><i class="bi bi-eye"></i> Voir plus</button>
              </div>
            </div>
          </div>`;
        wrap.appendChild(col);
      });
    } catch (error) {
      wrap.innerHTML = `<div class="alert alert-danger">Erreur: ${error.message}</div>`;
    }
  }

  function statusBadge(role) {
    const cls = role === 'admin' ? 'bg-primary' : 'bg-secondary';
    return `<span class="badge ${cls}">${role === 'admin' ? 'Admin' : 'Membre'}</span>`;
  }

  async function renderTontineDetail(id) {
    try {
      const tontine = await Api.getTontineDetail(id);
      const members = await Api.getTontineMembers(id);

      $('#tonDetailTitle').textContent = tontine.name;
      $('#backToTontines').onclick = () => { location.hash = '#/tontines'; };

      // KPIs (simplified for now)
      $('#kpiTonMembers').textContent = members.length;
      $('#kpiTonTotal').textContent = formatCurrency(parseFloat(tontine.amount) * members.length);
      $('#kpiTonRate').textContent = `n/a`;
      $('#kpiTonLate').textContent = `n/a`;

      // Members table
      const tbody = $('#tonMembersTable tbody');
      tbody.innerHTML = members.map(m => {
        return `
        <tr>
          <td>${m.user_email}</td>
          <td>-</td>
          <td>${statusBadge(m.role)}</td>
          <td class="text-end">
            <!-- Actions removed for now -->
          </td>
        </tr>
      `}).join('');

    } catch (error) {
        notify('Erreur', `Impossible de charger les détails: ${error.message}`);
        location.hash = '#/tontines';
    }
  }

  function notify(title, message) {
    const wrap = $('#toastContainer');
    const el = document.createElement('div');
    el.className = 'toast';
    el.role = 'alert';
    el.innerHTML = `
      <div class="toast-header">
        <strong class="me-auto">${title}</strong>
        <small>Maintenant</small>
        <button type="button" class="btn-close" data-bs-dismiss="toast"></button>
      </div>
      <div class="toast-body">${message}</div>`;
    wrap.appendChild(el);
    const t = new bootstrap.Toast(el, { delay: 3000 });
    t.show();
    el.addEventListener('hidden.bs.toast', () => el.remove());
  }

  function bind() {
    $('#sidebarToggle').addEventListener('click', () => $('#sidebar').classList.toggle('show'));

    $('#tontineCards').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action="view"]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      if (id) {
        location.hash = `#/tontine/${id}`;
      }
    });

    $('#saveTontineBtn').addEventListener('click', async () => {
      const m = $('#newTontineModal');
      const name = $('#tonName').value.trim();
      const amount = parseInt($('#tonAmount').value, 10) || 0;
      const frequency = $('#tonFrequency').value;
      const startDate = $('#tonStartDate').value;
      
      if (!name || !amount || !startDate) {
        notify('Erreur', 'Veuillez remplir les champs requis.');
        return;
      }

      try {
        const newTontine = await Api.createTontine({ name, amount, frequency, start_date: startDate });
        notify('Tontine créée', `"${newTontine.name}" a été ajoutée.`);
        renderTontines();
        const modal = bootstrap.Modal.getOrCreateInstance(m);
        modal.hide();
        $('#tontineForm').reset();
      } catch (error) {
        notify('Erreur de création', error.message);
      }
    });
    
    const logoutBtn = $('#logoutBtn');
    if(logoutBtn) {
        const logoutLink = document.createElement('a');
        logoutLink.href = '/logout/';
        logoutLink.className = 'dropdown-item';
        logoutLink.innerHTML = '<i class="bi bi-box-arrow-right me-2"></i>Se déconnecter';
        logoutBtn.replaceWith(logoutLink);
    }

    window.addEventListener('hashchange', () => routeTo());
  }

  async function init() {
    initTheme();
    bind();
    
    try {
      state.user = await Api.getMe();
      $('#currentUserName').textContent = state.user.first_name || state.user.username;
    } catch (e) {
      $('#currentUserName').textContent = 'Invité';
    }
    
    routeTo();
  }

  return { init };
})();

window.addEventListener('DOMContentLoaded', App.init);