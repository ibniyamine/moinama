
const Api = (() => {
  async function request(url, method = 'GET', data = null) {
    const token = localStorage.getItem('moinama.auth.access'); // Get token from localStorage
    const headers = {
      'Content-Type': 'application/json',
    };

    // Add Authorization header if token exists
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Add X-CSRFToken for non-GET requests
    if (method !== 'GET') {
      const csrftoken = document.querySelector('[name=csrfmiddlewaretoken]').value;
      if (csrftoken) {
        headers['X-CSRFToken'] = csrftoken;
      }
    }
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
    login: (data) => request('/api/auth/token/', 'POST', data), // Added login function
    getMe: () => request('/api/accounts/me/'),
    getUsers: () => request('/api/accounts/users/'),
    getTontines: () => request('/api/tontines/'),
    createTontine: (data) => request('/api/tontines/', 'POST', data),
    getTontineDetail: (id) => request(`/api/tontines/${id}/`),
    getTontineMembers: (id) => request(`/api/tontines/${id}/members/`),
    // Corrected URL and data format
    addTontineMember: (tontineId, userId) => request(`/api/tontines/${tontineId}/add-member/`, 'POST', { user_id: userId }),
    deleteTontine: (id) => request(`/api/tontines/${id}/`, 'DELETE'),
    updateTontine: (id, data) => request(`/api/tontines/${id}/`, 'PATCH', data),
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

  async function handleAddMember(tontine) {
    try {
        // Récupérer la liste des utilisateurs et des membres actuels en parallèle
        const [allUsers, currentMembers] = await Promise.all([
            Api.getUsers(),
            Api.getTontineMembers(tontine.id)
        ]);
        
        // Filtrer les utilisateurs qui ne sont pas déjà membres
        const currentMemberIds = new Set(currentMembers.map(m => m.user));
        const availableUsers = allUsers.filter(u => !currentMemberIds.has(u.id) && u.id !== state.user?.id);
  
        // Mettre à jour la liste déroulante
        const select = $('#userSelect');
        select.innerHTML = '<option value="">Sélectionnez un utilisateur</option>' +
            availableUsers.map(u => {
                const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim();
                const display = fullName ? `${fullName} (${u.phone || u.email})` : (u.phone || u.email);
                return `<option value="${u.id}">${display}</option>`;
            }).join('');
  
        // Afficher la modale
        const addMemberModal = new bootstrap.Modal($('#addMemberModal'));
        
        // Nettoyer les anciens gestionnaires d'événements
        const confirmBtn = $('#confirmAddMemberBtn');
        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
  
        // Ajouter le gestionnaire d'événement au nouveau bouton
        newConfirmBtn.onclick = async () => {
            const userId = parseInt(select.value);
            if (!userId) {
                notify('Erreur', 'Veuillez sélectionner un utilisateur');
                return;
            }
  
            try {
                // 4. Appel Corrigé
                await Api.addTontineMember(tontine.id, userId);
                
                notify('Succès', 'Membre ajouté à la tontine avec succès.');
                addMemberModal.hide();
                
                // Rafraîchir la vue détaillée
                renderTontineDetail(tontine.id);
            } catch (error) {
                console.error('Erreur lors de l\'ajout du membre:', error);
                notify('Erreur', `Impossible d'ajouter le membre: ${error.message}`);
            }
        };
  
        // Afficher la modale
        addMemberModal.show();
    } catch (error) {
        console.error('Erreur lors du chargement des utilisateurs:', error);
        notify('Erreur', `Impossible de charger la liste des utilisateurs: ${error.message}`);
    }
  }

  async function renderTontineDetail(id) {
    try {
      const tontine = await Api.getTontineDetail(id);
      const members = await Api.getTontineMembers(id);

      $('#tonDetailTitle').textContent = tontine.name;
      $('#backToTontines').onclick = () => { location.hash = '#/tontines'; };
      $('#addMemberBtn').onclick = () => handleAddMember(tontine);
      $('#editTontineBtn').onclick = () => handleEditTontine(tontine); // Bind edit button
      $('#deleteTontineBtn').onclick = () => handleDeleteTontine(tontine); // Bind delete button

      // KPIs (simplified for now)
      $('#kpiTonMembers').textContent = members.length;
      $('#kpiTonTotal').textContent = formatCurrency(parseFloat(tontine.amount) * members.length);
      $('#kpiTonRate').textContent = `n/a`;
      $('#kpiTonLate').textContent = `n/a`;

      // Members table
      const tbody = $('#tonMembersTable tbody');
      tbody.innerHTML = members.map(m => {
        const fullName = `${m.user_first_name || ''} ${m.user_last_name || ''}`.trim();
        const displayName = fullName || m.user_email;
        const contactInfo = m.user_phone || m.user_email; // Prioritize phone if available

        return `
        <tr>
          <td>${displayName}</td>
          <td>${contactInfo}</td>
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

  async function handleEditTontine(tontine) {
    const editModal = new bootstrap.Modal($('#editTontineModal'));
    $('#editTonName').value = tontine.name;
    $('#editTonAmount').value = tontine.amount;
    $('#editTonFrequency').value = tontine.frequency;
    $('#editTonStartDate').value = tontine.start_date;
    $('#editTonDescription').value = tontine.description || '';

    const saveBtn = $('#saveEditTontineBtn');
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

    newSaveBtn.onclick = async () => {
      const updatedData = {
        name: $('#editTonName').value.trim(),
        amount: parseFloat($('#editTonAmount').value),
        frequency: $('#editTonFrequency').value,
        start_date: $('#editTonStartDate').value,
        description: $('#editTonDescription').value.trim(),
      };

      try {
        await Api.updateTontine(tontine.id, updatedData);
        notify('Succès', 'Tontine modifiée avec succès.');
        editModal.hide();
        renderTontineDetail(tontine.id); // Refresh detail view
      } catch (error) {
        console.error('Erreur lors de la modification de la tontine:', error);
        notify('Erreur', `Impossible de modifier la tontine: ${error.message}`);
      }
    };
    editModal.show();
  }

  async function handleDeleteTontine(tontine) {
    const deleteModal = new bootstrap.Modal($('#deleteTontineModal'));
    const confirmBtn = $('#confirmDeleteTontineBtn');
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

    newConfirmBtn.onclick = async () => {
      try {
        await Api.deleteTontine(tontine.id);
        notify('Succès', 'Tontine supprimée avec succès.');
        deleteModal.hide();
        location.hash = '#/tontines'; // Go back to tontines list
      } catch (error) {
        console.error('Erreur lors de la suppression de la tontine:', error);
        notify('Erreur', `Impossible de supprimer la tontine: ${error.message}`);
      }
    };
    deleteModal.show();
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
      const description = $('#tonDescription').value.trim(); // Get description

      if (!name || !amount || !startDate) {
        notify('Erreur', 'Veuillez remplir les champs requis.');
        return;
      }

      try {
        const newTontine = await Api.createTontine({ name, amount, frequency, start_date: startDate, description: description }); // Include description
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
