
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
              const msgArray = Array.isArray(messages) ? messages : [messages];
              return `${field}: ${msgArray.join(' ')}`;
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
    createContribution: (data) => request('/api/transactions/contributions/', 'POST', data),
    getTontineContributionStatus: (tontineId) => request(`/api/transactions/tontines/${tontineId}/status/`),
    getContributions: (params = {}) => {
      const query = new URLSearchParams(params).toString();
      return request(`/api/transactions/contributions/${query ? `?${query}` : ''}`);
    },
    getWithdrawals: (params = {}) => {
      const query = new URLSearchParams(params).toString();
      return request(`/api/transactions/withdrawals/${query ? `?${query}` : ''}`);
    },
    getDashboardStats: () => request('/api/transactions/dashboard-stats/'),
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
    if (target === 'transactions') renderTransactions();
    if (target === 'me') renderMyDashboard();
    if (target === 'dashboard') renderDashboardGlobal();
  }

  let contribChartInstance = null;

  async function renderDashboardGlobal() {
    try {
      const stats = await Api.getDashboardStats();

      // Update KPIs
      $('#kpiTotalContrib').textContent = formatCurrency(stats.total_contributions);
      $('#kpiWithdrawals').textContent = formatCurrency(stats.total_withdrawals);
      $('#kpiMembers').textContent = stats.total_members;
      $('#kpiActiveGroups').textContent = stats.total_active_tontines;

      // Render Contribution Chart
      const ctx = $('#contribChart').getContext('2d');
      if (contribChartInstance) {
        contribChartInstance.destroy();
      }
      contribChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: stats.contribution_chart_data.labels,
          datasets: [{
            label: 'Contributions',
            data: stats.contribution_chart_data.data,
            borderColor: 'rgb(75, 192, 192)',
            tension: 0.1,
            fill: false
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true
            }
          }
        }
      });

      // Render Upcoming Payments (currently a placeholder)
      const upcomingPaymentsList = $('#upcomingPayments');
      if (stats.upcoming_payments.length === 0) {
        upcomingPaymentsList.innerHTML = '<div class="list-group-item text-center text-muted">Aucun paiement à venir.</div>';
      } else {
        upcomingPaymentsList.innerHTML = stats.upcoming_payments.map(payment => `
          <div class="list-group-item">
            ${payment.description} - ${formatCurrency(payment.amount)}
          </div>
        `).join('');
      }

    } catch (error) {
      console.error('Erreur lors du chargement du tableau de bord global:', error);
      notify('Erreur', `Impossible de charger les données du tableau de bord: ${error.message}`);
    }
  }

  async function renderMyDashboard() {
    const myContribList = $('#myContribList');
    const myWithdrawList = $('#myWithdrawList');

    myContribList.innerHTML = '<li class="list-group-item text-center text-muted">Chargement de vos contributions...</li>';
    myWithdrawList.innerHTML = '<li class="list-group-item text-center text-muted">Chargement de vos retraits...</li>';

    try {
      if (!state.user) {
        myContribList.innerHTML = '<li class="list-group-item text-center text-muted">Veuillez vous connecter pour voir vos contributions.</li>';
        myWithdrawList.innerHTML = '<li class="list-group-item text-center text-muted">Veuillez vous connecter pour voir vos retraits.</li>';
        return;
      }

      // Ensure state.tontines is populated for displaying tontine names
      if (!state.tontines || state.tontines.length === 0) {
        state.tontines = await Api.getTontines();
      }

      const allContributions = await Api.getContributions();
      const myContributions = allContributions.filter(tx => tx.member.id === state.user.id); // Assuming tx.member exists and matches user.id

      if (!myContributions.length) {
        myContribList.innerHTML = '<li class="list-group-item text-center text-muted">Aucune contribution trouvée.</li>';
      } else {
        myContribList.innerHTML = myContributions.map(tx => {
          const date = new Date(tx.date).toLocaleDateString('fr-FR');
          const tontineName = state.tontines.find(t => t.id === tx.tontine)?.name || 'N/A';
          return `
            <li class="list-group-item d-flex justify-content-between align-items-center">
              <div>
                Contribution à <strong>${tontineName}</strong>
                <div class="small text-muted">${date}</div>
              </div>
              <span class="text-success">+ ${formatCurrency(tx.amount)}</span>
            </li>
          `;
        }).join('');
      }

      // Placeholder for withdrawals - no API for it yet
      myWithdrawList.innerHTML = '<li class="list-group-item text-center text-muted">Aucun retrait trouvé ou fonctionnalité non implémentée.</li>';

    } catch (error) {
      console.error('Erreur lors du chargement du tableau de bord personnel:', error);
      myContribList.innerHTML = `<li class="list-group-item text-center text-danger">Erreur: ${error.message}</li>`;
      myWithdrawList.innerHTML = `<li class="list-group-item text-center text-danger">Erreur: ${error.message}</li>`;
    }
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

        let contributeButtonHtml = '';
        if (t.has_contributed_this_period) {
          contributeButtonHtml = '<button class="btn btn-sm btn-outline-primary" disabled><i class="bi bi-check-circle"></i> Déjà cotisé</button>';
        } else {
          contributeButtonHtml = `<button class="btn btn-sm btn-outline-primary" data-action="contribute" data-id="${t.id}"><i class="bi bi-plus-circle"></i> Cotiser</button>`;
        }

        col.innerHTML = `
          <div class="card h-100">
            <div class="card-body d-flex flex-column">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <h3 class="h6 m-0">${t.name}</h3>
                <span class="badge bg-success">Active</span>
              </div>
              <div class="small text-muted mb-2">Montant: <strong>${formatCurrency(t.amount)}</strong> · ${translateFrequency(t.frequency)}</div>
              <div class="mt-auto d-flex gap-2">
                ${contributeButtonHtml}
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
      const [tontine, members, contributionStatus] = await Promise.all([
        Api.getTontineDetail(id),
        Api.getTontineMembers(id),
        Api.getTontineContributionStatus(id)
      ]);

      $('#tonDetailTitle').textContent = tontine.name;
      $('#backToTontines').onclick = () => { location.hash = '#/tontines'; };
      $('#addMemberBtn').onclick = () => handleAddMember(tontine);
      $('#editTontineBtn').onclick = () => handleEditTontine(tontine); // Bind edit button
      $('#deleteTontineBtn').onclick = () => handleDeleteTontine(tontine); // Bind delete button

      // Handle Contribute button state
      const contributeButton = $('button[data-action="contribute"]'); // This button is in the tontine list, not detail
      const contributeModalButton = $('#confirmContributeBtn'); // This is the button inside the modal

      if (contributionStatus.current_user_has_contributed_this_period) {
        // If the current user has contributed, disable the button in the modal
        if (contributeModalButton) {
          contributeModalButton.disabled = true;
          contributeModalButton.textContent = 'Déjà cotisé ce mois/semaine';
        }
        // Also disable the contribute button in the tontine list if it's visible
        // (though this function is for detail view, good to be safe)
        if (contributeButton) {
          contributeButton.disabled = true;
          contributeButton.textContent = 'Déjà cotisé';
        }
      } else {
        if (contributeModalButton) {
          contributeModalButton.disabled = false;
          contributeModalButton.textContent = 'Confirmer la contribution';
        }
        if (contributeButton) {
          contributeButton.disabled = false;
          contributeButton.innerHTML = '<i class="bi bi-plus-circle"></i> Cotiser';
        }
      }

      // KPIs
      const totalContributed = contributionStatus.members_status.reduce((sum, m) => sum + (m.last_contribution_amount || 0), 0);
      const lateMembersCount = contributionStatus.members_status.filter(m => m.is_late).length;
      const participatingMembersCount = contributionStatus.members_status.filter(m => m.last_contribution_date !== null).length;
      const participationRate = members.length > 0 ? (participatingMembersCount / members.length * 100).toFixed(0) : 0;

      $('#kpiTonMembers').textContent = members.length;
      $('#kpiTonTotal').textContent = formatCurrency(totalContributed);
      $('#kpiTonRate').textContent = `${participationRate}%`;
      $('#kpiTonLate').textContent = lateMembersCount;

      // Members table
      const tbody = $('#tonMembersTable tbody');
      tbody.innerHTML = contributionStatus.members_status.map(mStatus => {
        const member = members.find(mem => mem.user === mStatus.member_id);
        if (!member) return ''; // Should not happen if data is consistent

        const fullName = `${member.user_first_name || ''} ${member.user_last_name || ''}`.trim();
        const displayName = fullName || member.user_email;
        const contactInfo = member.user_phone || member.user_email;

        let statusHtml = '';
        if (mStatus.is_late) {
          statusHtml = '<span class="badge bg-danger">En retard</span>';
        } else if (mStatus.is_confirmed) {
          statusHtml = '<span class="badge bg-success">Confirmé</span>';
        } else if (mStatus.last_contribution_date) {
          statusHtml = '<span class="badge bg-warning">En attente</span>';
        } else {
          statusHtml = '<span class="badge bg-info">Pas encore cotisé</span>';
        }

        const isOwner = state.user && tontine.owner === state.user.id;
        const confirmButton = isOwner && mStatus.last_contribution_date && !mStatus.is_confirmed ?
          `<button class="btn btn-sm btn-success" data-action="confirm-contribution" data-contribution-id="${mStatus.last_contribution_id}"><i class="bi bi-check-circle"></i> Confirmer</button>` : '';

        return `
        <tr>
          <td>${displayName}</td>
          <td>${contactInfo}</td>
          <td>
            ${statusHtml}
            ${mStatus.last_contribution_amount ? `<br><small class="text-muted">${formatCurrency(mStatus.last_contribution_amount)} le ${mStatus.last_contribution_date}</small>` : ''}
          </td>
          <td class="text-end">
            ${confirmButton}
          </td>
        </tr>
      `;
      }).join('');

      // Add event listener for confirm contribution buttons
      tbody.querySelectorAll('button[data-action="confirm-contribution"]').forEach(button => {
        button.addEventListener('click', async (e) => {
          const contributionId = e.target.getAttribute('data-contribution-id');
          if (contributionId) {
            try {
              await Api.patch(`/api/transactions/contributions/${contributionId}/`, { is_confirmed: true });
              notify('Succès', 'Contribution confirmée.');
              renderTontineDetail(tontine.id); // Refresh view
            } catch (error) {
              console.error('Erreur lors de la confirmation:', error);
              notify('Erreur', `Impossible de confirmer la contribution: ${error.message}`);
            }
          }
        });
      });

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

  async function handleContribute(tontine) {
    const contributeModal = new bootstrap.Modal($('#contributeModal'));
    $('#contributeTontineName').value = tontine.name;
    $('#contributeTontineId').value = tontine.id;
    $('#contributeAmount').value = tontine.amount;
    $('#contributeNote').value = ''; // Clear previous note

    const confirmBtn = $('#confirmContributeBtn');
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

    newConfirmBtn.onclick = async () => {
      const data = {
        tontine: tontine.id,
        amount: parseFloat($('#contributeAmount').value),
        note: $('#contributeNote').value.trim(),
      };

      try {
        await Api.createContribution(data);
        notify('Succès', `Contribution de ${formatCurrency(data.amount)} à ${tontine.name} enregistrée.`);
        contributeModal.hide();
        // Optionally refresh the tontine detail view if we are on it
        if (location.hash === `#/tontine/${tontine.id}`) {
          renderTontineDetail(tontine.id);
        }
      } catch (error) {
        console.error('Erreur lors de la contribution:', error);
        notify('Erreur', `Impossible d'enregistrer la contribution: ${error.message}`);
      }
    };
    contributeModal.show();
  }

  async function renderTransactions() {
    const tbody = $('#transactionsTable tbody');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Chargement...</td></tr>';

    const typeFilter = $('#txTypeFilter').value;
    const periodFilter = $('#txPeriodFilter').value;

    let startDate = null;
    const endDate = new Date().toISOString().split('T')[0]; // Today

    if (periodFilter !== 'all') {
      const days = parseInt(periodFilter);
      const d = new Date();
      d.setDate(d.getDate() - days);
      startDate = d.toISOString().split('T')[0];
    }

    const params = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;

    try {
      // Ensure state.tontines is populated
      if (!state.tontines || state.tontines.length === 0) {
        state.tontines = await Api.getTontines();
      }

      let allTransactions = [];

      if (typeFilter === 'all' || typeFilter === 'contribution') {
        const contributions = await Api.getContributions(params);
        allTransactions.push(...contributions.map(tx => {
          const tontineName = state.tontines.find(t => t.id === tx.tontine)?.name || 'N/A';
          const fullName = `${tx.member.first_name || ''} ${tx.member.last_name || ''}`.trim();
          const displayName = fullName || tx.member.email;
          const contactInfo = tx.member.phone || tx.member.email;
          return { ...tx, type: 'Contribution', member_name: displayName, member_contact: contactInfo, tontine_name: tontineName };
        }));
      }

      if (typeFilter === 'all' || typeFilter === 'withdrawal') {
        const withdrawals = await Api.getWithdrawals(params);
        allTransactions.push(...withdrawals.map(tx => {
          const tontineName = state.tontines.find(t => t.id === tx.tontine)?.name || 'N/A';
          const fullName = `${tx.beneficiary.first_name || ''} ${tx.beneficiary.last_name || ''}`.trim();
          const displayName = fullName || tx.beneficiary.email;
          const contactInfo = tx.beneficiary.phone || tx.beneficiary.email;
          return { ...tx, type: 'Retrait', member_name: displayName, member_contact: contactInfo, tontine_name: tontineName };
        }));
      }

      if (!allTransactions.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Aucune transaction trouvée.</td></tr>';
        return;
      }

      // Sort by date descending
      allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

      tbody.innerHTML = allTransactions.map(tx => {
        const date = new Date(tx.date).toLocaleDateString('fr-FR');
        const amountClass = tx.type === 'Contribution' ? 'text-success' : 'text-danger';
        const sign = tx.type === 'Contribution' ? '+' : '-';

        return `
          <tr>
            <td>${date}</td>
            <td>${tx.type}</td>
            <td>${tx.member_name} <small class="text-muted">(${tx.member_contact})</small></td>
            <td>${tx.tontine_name}</td>
            <td class="text-end ${amountClass}">${sign} ${formatCurrency(tx.amount)}</td>
          </tr>
        `;
      }).join('');

    } catch (error) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Erreur: ${error.message}</td></tr>`;
    }
  }

  function bind() {
    $('#sidebarToggle').addEventListener('click', () => $('#sidebar').classList.toggle('show'));

    $('#txTypeFilter').addEventListener('change', renderTransactions);
    $('#txPeriodFilter').addEventListener('change', renderTransactions);

    $('#tontineCards').addEventListener('click', (e) => {
      const viewBtn = e.target.closest('button[data-action="view"]');
      if (viewBtn) {
        const id = viewBtn.getAttribute('data-id');
        if (id) {
          location.hash = `#/tontine/${id}`;
        }
      }

      const contributeBtn = e.target.closest('button[data-action="contribute"]');
      if (contributeBtn) {
        const id = contributeBtn.getAttribute('data-id');
        const tontine = state.tontines.find(t => t.id == id);
        if (tontine && !tontine.has_contributed_this_period) {
          handleContribute(tontine);
        } else if (tontine && tontine.has_contributed_this_period) {
          notify('Information', 'Vous avez déjà cotisé à cette tontine pour la période actuelle.');
        }
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
    
    // The logout button is now inside a dynamically managed <li>, so we attach the event listener directly.
    // The <li>'s visibility is handled by updateAuthUI.
    const logoutBtnElement = $('#logoutBtn');
    if (logoutBtnElement) {
        logoutBtnElement.addEventListener('click', () => {
            // Perform logout action, e.g., clear token and redirect
            localStorage.removeItem('moinama.auth.access');
            localStorage.removeItem('moinama.auth.refresh');
            location.href = '/'; // Redirect to home or login page
        });
    }

    window.addEventListener('hashchange', () => routeTo());
  }

  function updateAuthUI() {
    const loginItem = $('#loginMenuItem');
    const registerItem = $('#registerMenuItem');
    const authDivider = $('#authDivider');
    const logoutItem = $('#logoutMenuItem');
    const currentUserNameSpan = $('#currentUserName');

    if (state.user) { // User is logged in
      if (loginItem) loginItem.classList.add('d-none');
      if (registerItem) registerItem.classList.add('d-none');
      if (authDivider) authDivider.classList.remove('d-none');
      if (logoutItem) logoutItem.classList.remove('d-none');
      if (currentUserNameSpan) currentUserNameSpan.textContent = state.user.first_name || state.user.username;
    } else { // User is not logged in
      if (loginItem) loginItem.classList.remove('d-none');
      if (registerItem) registerItem.classList.remove('d-none');
      if (authDivider) authDivider.classList.add('d-none');
      if (logoutItem) logoutItem.classList.add('d-none');
      if (currentUserNameSpan) currentUserNameSpan.textContent = 'Invité';
    }
  }

  async function init() {
    initTheme();
    bind();
    
    try {
      state.user = await Api.getMe();
      // $('#currentUserName').textContent = state.user.first_name || state.user.username; // Handled by updateAuthUI
    } catch (e) {
      state.user = null; // Ensure state.user is null if API call fails
      // $('#currentUserName').textContent = 'Invité'; // Handled by updateAuthUI
    }
    
    updateAuthUI(); // Call after state.user is determined
    routeTo();
  }

  return { init };
})();

window.addEventListener('DOMContentLoaded', App.init);
