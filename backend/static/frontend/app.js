
const Api = (() => {
  async function request(url, method = 'GET', data = null) {
    const token = localStorage.getItem('moinama.auth.access'); // Get token from localStorage
    console.log('Token from localStorage:', token ? 'Token found' : 'No token found');
    
    const headers = {
      'Content-Type': 'application/json',
    };
    
    // Add Authorization header if token exists
    if (token) {
      console.log('Adding Authorization header with token');
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      console.warn('No authentication token found in localStorage');
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
    addTontineMember: (tontineId, userId) => request(`/api/tontines/${tontineId}/add-member/`, 'POST', { user_id: userId }),
    deleteTontine: (id) => request(`/api/tontines/${id}/`, 'DELETE'),
    designateRecipient: (tontineId, userId) => request(`/api/tontines/${tontineId}/designate-recipient/`, 'POST', { user_id: userId }),
    processPayout: (tontineId) => request(`/api/tontines/${tontineId}/process-payout/`, 'POST'),
    validateRound: (tontineId) => request(`/api/tontines/${tontineId}/validate-round/`, 'POST'),
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

    myContribList.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Chargement...</td></tr>';
    myWithdrawList.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Chargement...</td></tr>';

    try {
      if (!state.user) {
        myContribList.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Veuillez vous connecter</td></tr>';
        myWithdrawList.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Veuillez vous connecter</td></tr>';
        return;
      }

      // Ensure state.tontines is populated for displaying tontine names
      if (!state.tontines || state.tontines.length === 0) {
        state.tontines = await Api.getTontines();
      }

      const allContributions = await Api.getContributions({ status: 'paid' });
      const myContributions = allContributions.filter(tx => tx.member.id === state.user.id);

      const allWithdrawals = await Api.getWithdrawals();
      const myWithdrawals = allWithdrawals.filter(tx => tx.beneficiary.id === state.user.id);

      // Update KPIs
      const totalContribAmount = myContributions.reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0);
      const totalWithdrawAmount = myWithdrawals.reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0);

      $('#myKpiContribCount').textContent = myContributions.length;
      $('#myKpiContribTotal').textContent = formatCurrency(totalContribAmount);
      $('#myKpiWithdrawCount').textContent = myWithdrawals.length;
      $('#myKpiWithdrawTotal').textContent = formatCurrency(totalWithdrawAmount);
      $('#myContribBadge').textContent = myContributions.length;
      $('#myWithdrawBadge').textContent = myWithdrawals.length;

      // Render contributions table
      if (!myContributions.length) {
        myContribList.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Aucune contribution</td></tr>';
      } else {
        myContribList.innerHTML = myContributions.map(tx => {
          const date = new Date(tx.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
          const tontineName = state.tontines.find(t => t.id === tx.tontine)?.name || 'N/A';
          return `
            <tr>
              <td>${tontineName}</td>
              <td class="text-end">${formatCurrency(tx.amount)}</td>
              <td class="text-end"><small class="text-muted">${date}</small></td>
            </tr>
          `;
        }).join('');
      }

      // Render withdrawals table
      if (!myWithdrawals.length) {
        myWithdrawList.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Aucun retrait</td></tr>';
      } else {
        myWithdrawList.innerHTML = myWithdrawals.map(tx => {
          const date = new Date(tx.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
          const tontineName = state.tontines.find(t => t.id === tx.tontine)?.name || 'N/A';
          return `
            <tr>
              <td>${tontineName}</td>
              <td class="text-end">${formatCurrency(tx.amount)}</td>
              <td class="text-end"><small class="text-muted">${date}</small></td>
            </tr>
          `;
        }).join('');
      }

    } catch (error) {
      console.error('Erreur lors du chargement du tableau de bord personnel:', error);
      myContribList.innerHTML = `<tr><td colspan="3" class="text-center text-danger">Erreur: ${error.message}</td></tr>`;
      myWithdrawList.innerHTML = `<tr><td colspan="3" class="text-center text-danger">Erreur: ${error.message}</td></tr>`;
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

        col.innerHTML = `
          <div class="card h-100">
            <div class="card-body d-flex flex-column">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <h3 class="h6 m-0">${t.name}</h3>
                <span class="badge bg-success">Active</span>
              </div>
              <div class="small text-muted mb-2">Montant: <strong>${formatCurrency(t.amount)}</strong> · ${translateFrequency(t.frequency)}</div>
              <div class="mt-auto d-flex gap-2">
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
  
        // Créer la liste de checkboxes
        const checkboxList = $('#userCheckboxList');
        const searchInput = $('#userSearchInput');
        
        // Mettre à jour le compteur de sélection
        const updateSelectedCount = () => {
            const checked = $$('.user-checkbox:checked', checkboxList);
            const count = checked.length;
            $('#selectedCount').textContent = count > 0 ? `(${count})` : '';
        };
        
        const renderUserList = (users) => {
            if (users.length === 0) {
                checkboxList.innerHTML = '<div class="text-center text-muted py-3">Aucun utilisateur disponible</div>';
                return;
            }
            
            checkboxList.innerHTML = users.map(u => {
                const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim();
                const display = fullName || u.email || u.phone;
                const subtitle = fullName ? (u.phone || u.email) : '';
                
                return `
                    <div class="form-check border-bottom py-2">
                        <input class="form-check-input user-checkbox" type="checkbox" value="${u.id}" id="user-${u.id}">
                        <label class="form-check-label w-100" for="user-${u.id}">
                            <div class="fw-medium">${display}</div>
                            ${subtitle ? `<small class="text-muted">${subtitle}</small>` : ''}
                        </label>
                    </div>
                `;
            }).join('');
            
            // Ajouter les événements de changement pour mettre à jour le compteur
            $$('.user-checkbox', checkboxList).forEach(cb => {
                cb.addEventListener('change', updateSelectedCount);
            });
        };
        
        renderUserList(availableUsers);
  
        // Fonction de recherche
        searchInput.value = '';
        searchInput.oninput = (e) => {
            const query = e.target.value.toLowerCase();
            const filtered = availableUsers.filter(u => {
                const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim().toLowerCase();
                const email = (u.email || '').toLowerCase();
                const phone = (u.phone || '').toLowerCase();
                return fullName.includes(query) || email.includes(query) || phone.includes(query);
            });
            renderUserList(filtered);
        };
        
        // Afficher la modale
        const addMemberModal = new bootstrap.Modal($('#addMemberModal'));
        
        updateSelectedCount();
        
        // Nettoyer les anciens gestionnaires d'événements
        const confirmBtn = $('#confirmAddMemberBtn');
        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
  
        // Ajouter le gestionnaire d'événement au nouveau bouton
        newConfirmBtn.onclick = async () => {
            const checkedBoxes = $$('.user-checkbox:checked', checkboxList);
            const userIds = checkedBoxes.map(cb => parseInt(cb.value));
            
            if (userIds.length === 0) {
                notify('Erreur', 'Veuillez sélectionner au moins un utilisateur');
                return;
            }
  
            try {
                // Désactiver le bouton pendant le traitement
                newConfirmBtn.disabled = true;
                newConfirmBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Ajout en cours...';
                
                // Ajouter tous les membres sélectionnés
                let successCount = 0;
                let errorCount = 0;
                
                for (const userId of userIds) {
                    try {
                        await Api.addTontineMember(tontine.id, userId);
                        successCount++;
                    } catch (error) {
                        console.error(`Erreur lors de l'ajout du membre ${userId}:`, error);
                        errorCount++;
                    }
                }
                
                // Afficher le résultat
                if (successCount > 0) {
                    notify('Succès', `${successCount} membre(s) ajouté(s) avec succès${errorCount > 0 ? ` (${errorCount} échec(s))` : ''}.`);
                } else {
                    notify('Erreur', 'Impossible d\'ajouter les membres sélectionnés.');
                }
                
                addMemberModal.hide();
                
                // Rafraîchir la vue détaillée
                renderTontineDetail(tontine.id);
            } catch (error) {
                console.error('Erreur lors de l\'ajout des membres:', error);
                notify('Erreur', `Impossible d'ajouter les membres: ${error.message}`);
            } finally {
                newConfirmBtn.disabled = false;
                newConfirmBtn.innerHTML = '<i class="bi bi-person-plus"></i> Ajouter <span id="selectedCount"></span>';
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
      const [tontine, members, contributionStatus, withdrawalsData] = await Promise.all([
        Api.getTontineDetail(id),
        Api.getTontineMembers(id),
        Api.getTontineContributionStatus(id),
        Api.getWithdrawals({ tontine_id: id })
      ]);

      $('#tonDetailTitle').textContent = tontine.name;
      $('#backToTontines').onclick = () => { location.hash = '#/tontines'; };
      $('#addMemberBtn').onclick = () => handleAddMember(tontine);
      $('#editTontineBtn').onclick = () => handleEditTontine(tontine); // Bind edit button
      $('#deleteTontineBtn').onclick = () => handleDeleteTontine(tontine); // Bind delete button

      // Handle Contribute button state
      const contributeButton = $('button[data-action="contribute"]'); // This button is in the tontine list, not detail
      const contributeModalButton = $('#confirmContributeBtn'); // This is the button inside the modal

      if (contributionStatus.current_user_has_contributed_this_round) {
        // If the current user has contributed, disable the button in the modal
        if (contributeModalButton) {
          contributeModalButton.disabled = true;
          contributeModalButton.textContent = 'Déjà cotisé pour ce tour';
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
      const totalContributed = contributionStatus.members_status.reduce((sum, m) => m.status === 'paid' ? sum + (m.last_contribution_amount || 0) : sum, 0);
      const lateMembersCount = contributionStatus.members_status.filter(m => m.status === 'pending' || m.status === 'unpaid').length;
      const participatingMembersCount = contributionStatus.members_status.filter(m => m.status === 'paid').length;

      $('#kpiTonMembers').textContent = members.length;
      $('#kpiTonTotal').textContent = formatCurrency(totalContributed);
      $('#kpiTonLate').textContent = lateMembersCount;

      // Build withdrawals map (prefer detail payload, fall back to list endpoint)
      const withdrawalsMap = new Map();
      const mergedWithdrawals = [
        ...(Array.isArray(tontine.withdrawals) ? tontine.withdrawals : []),
        ...(Array.isArray(withdrawalsData) ? withdrawalsData : [])
      ];
      mergedWithdrawals.forEach(withdrawal => {
        if (!withdrawal) return;
        const roundKey = String(withdrawal.round ?? withdrawal.round_number ?? '');
        if (!roundKey) return;
        if (!withdrawalsMap.has(roundKey)) {
          withdrawalsMap.set(roundKey, withdrawal);
        }
      });

      // Populate Rounds History
      const tonRoundsHistory = $('#tonRoundsHistory');
      tonRoundsHistory.innerHTML = ''; // Clear previous content

      // Récupérer les données des contributions par tour
      const contributionsByRound = await Api.getContributions({ tontine_id: id });
      
      // Récupérer les membres pour afficher les non-contributeurs
      const allMembers = await Api.getTontineMembers(id);
      
      // Trier les tours par ordre décroissant
      const rounds = Object.keys(contributionsByRound).sort((a, b) => b - a);

      if (rounds.length > 0) {
        rounds.forEach(roundNumber => {
          const contributions = contributionsByRound[roundNumber];
          const paidContributions = contributions.filter(c => c.status === 'paid');
          const totalCollected = paidContributions.reduce((sum, c) => sum + parseFloat(c.amount), 0);
          const totalMembers = allMembers.length;
          const paidCount = paidContributions.length;
          const pendingCount = contributions.filter(c => c.status === 'pending').length;
          const unpaidCount = totalMembers - paidCount - pendingCount;

          const accordionItem = document.createElement('div');
          accordionItem.className = 'accordion-item';

          // Retrieve withdrawal information for the round if available
          const withdrawal = withdrawalsMap.get(String(roundNumber)) || null;
          let withdrawalHtml = '';
          let withdrawalSummary = '';
          if (withdrawal && withdrawal.beneficiary) {
            const withdrawalDate = withdrawal.date
              ? new Date(withdrawal.date).toLocaleDateString('fr-FR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric'
                })
              : '-';
            const beneficiaryName = `${withdrawal.beneficiary.first_name || ''} ${withdrawal.beneficiary.last_name || ''}`.trim() ||
              withdrawal.beneficiary.email ||
              `Membre #${withdrawal.beneficiary.id}`;

            withdrawalSummary = `- ${beneficiaryName}`;
            withdrawalHtml = `
              <div class="p-3 border-bottom bg-light">
                <h6 class="text-muted mb-2">Bénéficiaire du tour ${roundNumber}</h6>
                <ul class="list-unstyled mb-0 small">
                  <li><strong>Bénéficiaire :</strong> ${beneficiaryName}</li>
                  <li><strong>Montant :</strong> ${formatCurrency(withdrawal.amount || 0)}</li>
                  <li><strong>Date :</strong> ${withdrawalDate}</li>
                  ${withdrawal.note ? `<li><strong>Note :</strong> ${withdrawal.note}</li>` : ''}
                </ul>
              </div>
            `;
          }

          // Build contributions table (Refactored to prevent duplicates)
          const contributionsMap = new Map();
          contributions.forEach(c => {
            const memberId = c?.member?.id ?? c?.member_id;
            if (memberId !== undefined && memberId !== null) {
              contributionsMap.set(String(memberId), c);
            }
          });

          let contributionsHtml = `
            <div class="d-flex justify-content-between flex-wrap gap-2 mb-3">
              <span class="badge rounded-pill border border-success text-success bg-transparent">Payés: ${paidCount}</span>
              <span class="badge rounded-pill border border-warning text-warning bg-transparent">En attente: ${pendingCount}</span>
              <span class="badge rounded-pill border border-danger text-danger bg-transparent">Non payés: ${unpaidCount}</span>
              <span class="badge rounded-pill border border-primary text-primary bg-transparent">Total cotisé: ${formatCurrency(totalCollected)}</span>
            </div>
            <table class="table table-sm table-hover">
              <thead class="table-light">
                <tr>
                  <th>Membre</th>
                  <th class="text-end">Montant</th>
                  <th class="text-end">Statut</th>
                  <th class="text-end">Date</th>
                </tr>
              </thead>
              <tbody>`;

          allMembers.forEach(member => {
            const contribution = contributionsMap.get(String(member.user));
            
            let displayName;
            // Prioritize name from contribution record if it exists
            if (contribution && contribution.member_name) {
                displayName = contribution.member_name;
            } else {
                // Otherwise, try to build from the member record
                displayName = (member.user_first_name && member.user_last_name)
                    ? `${member.user_first_name} ${member.user_last_name}`.trim()
                    : null; // Set to null if no name
            }

            // If no name could be found, use a generic placeholder. Never show the email.
            if (!displayName) {
                displayName = `Membre #${member.user}`;
            }

            let statusBadge = '<span class="badge rounded-pill border border-danger text-danger bg-transparent">Non payé</span>';
            let paymentDate = '-';
            let amount = '-';
            let rowClass = 'table-light';

            if (contribution) {
                amount = contribution.amount ? formatCurrency(parseFloat(contribution.amount)) : '-';
                const contributionDate = contribution.date || contribution.payment_date;
                if (contributionDate) {
                    paymentDate = new Date(contributionDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                }
                switch (contribution.status) {
                    case 'paid':
                        statusBadge = '<span class="badge rounded-pill border border-success text-success bg-transparent">Payé</span>';
                        rowClass = '';
                        break;
                    case 'pending':
                        statusBadge = '<span class="badge rounded-pill border border-warning text-warning bg-transparent">En attente</span>';
                        rowClass = 'table-warning';
                        break;
                    case 'unpaid':
                        statusBadge = '<span class="badge rounded-pill border border-danger text-danger bg-transparent">Impayé</span>';
                        rowClass = 'table-danger';
                        break;
                    default:
                        statusBadge = '<span class="badge rounded-pill border border-secondary text-secondary bg-transparent">Inconnu</span>';
                }
            }
            
            contributionsHtml += `
              <tr class="${rowClass}">
                <td>${displayName}</td>
                <td class="text-end">${amount}</td>
                <td class="text-end">${statusBadge}</td>
                <td class="text-end"><small class="text-muted">${paymentDate}</small></td>
              </tr>`;
          });

          contributionsHtml += '</tbody></table>';

          // 3. Assemble the accordion item
          accordionItem.innerHTML = `
            <h2 class="accordion-header" id="headingRound${roundNumber}">
              <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseRound${roundNumber}" aria-expanded="false" aria-controls="collapseRound${roundNumber}">
                <div class="d-flex flex-column w-100">
                  <div class="d-flex justify-content-between w-100">
                    <span>Tour ${roundNumber} ${withdrawalSummary}</span>
                    <span class="badge bg-primary">${paidCount}/${totalMembers} membres</span>
                  </div>
                  <div class="progress mt-1" style="height: 5px;">
                    <div class="progress-bar bg-success" role="progressbar" style="width: ${(paidCount / totalMembers) * 100}%" aria-valuenow="${paidCount}" aria-valuemin="0" aria-valuemax="${totalMembers}"></div>
                  </div>
                </div>
              </button>
            </h2>
            <div id="collapseRound${roundNumber}" class="accordion-collapse collapse" aria-labelledby="headingRound${roundNumber}" data-bs-parent="#tonRoundsHistory">
              <div class="accordion-body p-0">
                ${withdrawalHtml}
                <div class="p-3">
                  <h6 class="text-muted mb-2">Détail des cotisations</h6>
                  ${contributionsHtml}
                </div>
              </div>
            </div>
          `;
          tonRoundsHistory.appendChild(accordionItem);
        });
      } else {
        console.log('--- DEBUG: Aucune donnée de tour à afficher. ---');
        tonRoundsHistory.innerHTML = '<div class="text-muted text-center p-3">Aucun historique de contributions disponible.</div>';
      }

      // Members table
      const tbody = $('#tonMembersTable tbody');
      tbody.innerHTML = contributionStatus.members_status.map(mStatus => {
        const member = members.find(mem => mem.user === mStatus.member_id);
        if (!member) return ''; // Should not happen if data is consistent

        const fullName = `${member.user_first_name || ''} ${member.user_last_name || ''}`.trim();
        const displayName = fullName || member.user_email;
        const contactInfo = member.user_phone || member.user_email;

        let statusHtml = '';
        // The backend now sends status: 'pending', 'paid', or 'unpaid'.
        // 'unpaid' is also used when no contribution has been made for the period.
        switch (mStatus.status) {
            case 'paid':
                statusHtml = '<span class="badge bg-success">Payé</span>';
                break;
            case 'pending':
                statusHtml = '<span class="badge bg-warning">En attente</span>';
                break;
            case 'unpaid':
                statusHtml = '<span class="badge bg-danger">Non payé</span>';
                break;
            default:
                statusHtml = '<span class="badge bg-secondary">Inconnu</span>';
        }

        if (mStatus.is_late && mStatus.status !== 'paid') {
            statusHtml += ' <span class="badge bg-danger">En retard</span>';
        }

        const isOwner = state.user && tontine.owner === state.user.id;
        let actionButtons = '';
        if (isOwner && mStatus.status === 'pending' && mStatus.last_contribution_id) {
            actionButtons = `
                <div class="btn-group btn-group-sm" role="group">
                    <button class="btn btn-outline-success" data-action="mark-paid" data-contribution-id="${mStatus.last_contribution_id}">
                        <i class="bi bi-check-circle"></i> Payer
                    </button>
                    <button class="btn btn-outline-danger" data-action="mark-unpaid" data-contribution-id="${mStatus.last_contribution_id}">
                        <i class="bi bi-x-circle"></i> Non payé
                    </button>
                </div>
            `;
        }

        return `
        <tr>
          <td>${displayName}</td>
          <td>${contactInfo}</td>
          <td>
            ${statusHtml}
            ${mStatus.last_contribution_amount ? `<br><small class="text-muted">${formatCurrency(mStatus.last_contribution_amount)} le ${mStatus.last_contribution_date}</small>` : ''}
          </td>
          <td class="text-end">
            ${actionButtons}
          </td>
        </tr>
      `;
      }).join('');

      // --- Event Listeners for new status buttons ---
      const updateContributionStatus = async (contributionId, newStatus) => {
        try {
            await Api.patch(`/api/transactions/contributions/${contributionId}/`, { status: newStatus });
            notify('Succès', `Contribution mise à jour: ${newStatus}.`);
            renderTontineDetail(tontine.id); // Refresh view
        } catch (error) {
            console.error('Erreur lors de la mise à jour du statut:', error);
            notify('Erreur', `Impossible de mettre à jour: ${error.message}`);
        }
      };

      tbody.querySelectorAll('button[data-action="mark-paid"]').forEach(button => {
        button.addEventListener('click', (e) => {
          const contributionId = e.currentTarget.getAttribute('data-contribution-id');
          if (contributionId) updateContributionStatus(contributionId, 'paid');
        });
      });

      tbody.querySelectorAll('button[data-action="mark-unpaid"]').forEach(button => {
        button.addEventListener('click', (e) => {
          const contributionId = e.currentTarget.getAttribute('data-contribution-id');
          if (contributionId) updateContributionStatus(contributionId, 'unpaid');
        });
      });

      const isOwner = state.user && tontine.owner === state.user.id;

      // --- Owner Actions State Machine ---
      const editTontineBtn = $('#editTontineBtn');
      const deleteTontineBtn = $('#deleteTontineBtn');
      const addMemberBtn = $('#addMemberBtn');
      const designateSection = $('#designateWinnerSection');
      const payoutBtn = $('#processPayoutBtn');
      const validateBtn = $('#validateRoundBtn');
      const tonRoundBanner = $('#tonRoundBanner');

      // Hide all owner controls by default
      [editTontineBtn, deleteTontineBtn, addMemberBtn, designateSection, payoutBtn, validateBtn].forEach(el => el.classList.add('d-none'));
      tonRoundBanner.classList.add('d-none');

      if (isOwner) {
        // Basic controls are always visible for owner
        [editTontineBtn, deleteTontineBtn, addMemberBtn].forEach(el => el.classList.remove('d-none'));
        editTontineBtn.onclick = () => handleEditTontine(tontine);
        deleteTontineBtn.onclick = () => handleDeleteTontine(tontine);
        addMemberBtn.onclick = () => handleAddMember(tontine);

        const roundsLeft = contributionStatus.completed_rounds < contributionStatus.total_rounds;
        const payoutDoneForCurrentRound = contributionStatus.withdrawals_for_current_round > 0;

        tonRoundBanner.classList.remove('d-none');
        tonRoundBanner.textContent = `Tour Actuel : ${tontine.current_round} / ${contributionStatus.total_rounds}`;

        if (tontine.designated_recipient) {
            // STATE: READY FOR PAYOUT
            payoutBtn.classList.remove('d-none');
            const recipientName = tontine.designated_recipient_details?.name || 'le bénéficiaire désigné';
            payoutBtn.innerHTML = `<i class="bi bi-check2-circle"></i> Payer ${recipientName} pour le tour ${tontine.current_round}`;
            payoutBtn.disabled = false;
            payoutBtn.onclick = async () => {
                payoutBtn.disabled = true;
                try {
                    const result = await Api.processPayout(tontine.id);
                    notify('Succès', result.message || 'Paiement effectué avec succès.');
                    renderTontineDetail(tontine.id);
                } catch (error) {
                    notify('Erreur', `Impossible d'effectuer le paiement: ${error.message}`);
                    payoutBtn.disabled = false;
                }
            };

        } else if (payoutDoneForCurrentRound) {
            // STATE: READY TO VALIDATE
            if (roundsLeft) {
                validateBtn.classList.remove('d-none');
                validateBtn.disabled = false;
                validateBtn.onclick = async () => {
                    validateBtn.disabled = true;
                    try {
                        const result = await Api.validateRound(tontine.id);
                        notify('Succès', result.message || 'Tour validé.');
                        renderTontineDetail(tontine.id);
                    } catch (error) {
                        notify('Erreur', `Impossible de valider le tour: ${error.message}`);
                        validateBtn.disabled = false;
                    }
                };
            } else {
                // STATE: TONTINE FINISHED
                tonRoundBanner.textContent = 'Tontine terminée !';
                tonRoundBanner.classList.remove('alert-info');
                tonRoundBanner.classList.add('alert-success');
            }
        } else {
            // STATE: READY TO DESIGNATE
            if (roundsLeft) {
                designateSection.classList.remove('d-none');
                const previousWinnerIds = new Set(tontine.withdrawals.map(w => w.beneficiary.id));
                const eligibleMembers = members.filter(m => !previousWinnerIds.has(m.user));

                if (eligibleMembers.length > 0) {
                    $('#eligibleMembersSelect').innerHTML = '<option value="">-- Sélectionnez un bénéficiaire --</option>' +
                        eligibleMembers.map(m => `<option value="${m.user}">${m.user_first_name || ''} ${m.user_last_name || ''} (${m.user_email})</option>`).join('');
                    
                    $('#designateWinnerBtn').disabled = false;
                    $('#designateWinnerBtn').onclick = async () => {
                        const selectedUserId = $('#eligibleMembersSelect').value;
                        if (!selectedUserId) {
                            notify('Erreur', 'Veuillez sélectionner un membre.');
                            return;
                        }
                        try {
                            const result = await Api.designateRecipient(tontine.id, selectedUserId);
                            notify('Succès', result.message || 'Bénéficiaire désigné.');
                            renderTontineDetail(tontine.id);
                        } catch (error) {
                            notify('Erreur', `Impossible de désigner le bénéficiaire: ${error.message}`);
                        }
                    };
                } else {
                    $('#eligibleMembersSelect').innerHTML = '<option value="">Aucun membre éligible</option>';
                    $('#designateWinnerBtn').disabled = true;
                }
            } else {
                // STATE: TONTINE FINISHED
                tonRoundBanner.textContent = 'Tontine terminée !';
                tonRoundBanner.classList.remove('alert-info');
                tonRoundBanner.classList.add('alert-success');
            }
        }
      }

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
        const contributions = await Api.getContributions({ ...params, status: 'paid' });
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
        if (tontine && !tontine.has_contributed_this_round) {
          handleContribute(tontine);
        } else if (tontine && tontine.has_contributed_this_round) {
          notify('Information', 'Vous avez déjà cotisé à cette tontine pour le tour actuel.');
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
