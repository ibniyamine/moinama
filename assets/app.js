// Basic SPA routing + UI logic
const App = (() => {
  let state = Store.load();
  let contribChart;

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('moinama.theme', theme);
    $('#darkModeSwitch').checked = theme === 'dark';
  }

  function renderRoundsHistory(t) {
    const wrap = document.getElementById('tonRoundsHistory');
    if (!wrap) return;
    const hist = t.history || [];
    if (!hist.length) { wrap.innerHTML = ''; return; }
    const accId = `acc-${t.id}`;
    wrap.innerHTML = hist.map((h, idx) => {
      const collapseId = `${accId}-item-${idx}`;
      const taking = h.taking?.name || '—';
      const date = new Date(h.date).toLocaleString('fr-FR');
      const header = `Tour ${h.round} – Prenant : ${taking} – ${date} <span class=\"badge bg-success ms-2\">Validé</span>`;
      const isFirst = idx === 0;
      const btnCls = `accordion-button${isFirst ? '' : ' collapsed'}`;
      const colCls = `accordion-collapse collapse${isFirst ? ' show' : ''}`;
      const rows = (h.members||[]).map(m => `
        <tr>
          <td>${m.name}</td>
          <td>${m.contact||''}</td>
          <td>${statusBadge(m.status||'waiting')}</td>
        </tr>
      `).join('');
      return `
        <div class="accordion-item">
          <h2 class="accordion-header">
            <button class="${btnCls}" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
              ${header}
            </button>
          </h2>
          <div id="${collapseId}" class="${colCls}" data-bs-parent="#${accId}">
            <div class="accordion-body p-0">
              <div class="table-responsive">
                <table class="table table-sm mb-0">
                  <thead><tr><th>Nom</th><th>Contact</th><th>État</th></tr></thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>
            </div>
          </div>
        </div>`;
    }).join('');
    // Ensure the container has the ID referenced by data-bs-parent
    wrap.id = accId;
  }

  function validateCurrentRound(t) {
    const roundInfo = computeRoundInfo(t);
    const takingName = roundInfo.member ? roundInfo.member.name : '—';
    if (!confirm(`Valider le tour ${roundInfo.round} (Prenant: ${takingName}) ?`)) return;
    // Snapshot current state to history
    const snapshotMembers = (t.members||[]).map(m => ({ id: m.id, name: m.name, contact: m.contact, status: m.status }));
    t.history = t.history || [];
    t.history.unshift({
      round: roundInfo.round,
      taking: roundInfo.member ? { id: roundInfo.member.id, name: roundInfo.member.name } : null,
      date: new Date().toISOString(),
      members: snapshotMembers
    });
    // Visual feedback on button (turn green)
    const btn = document.getElementById('validateRoundBtn');
    if (btn) {
      btn.classList.remove('btn-outline-primary');
      btn.classList.add('btn-success');
      btn.disabled = true;
    }
    // Advance to next cycle and reset statuses immediately
    t.cycleIndex = (typeof t.cycleIndex === 'number' ? t.cycleIndex : 0) + 1;
    t.lastReset = new Date().toISOString();
    t.members.forEach(m => { m.status = 'waiting'; });
    save();
    // Re-render detail to show next round and update history
    renderTontineDetail(t.id);
    notify('Tour validé', `Le tour ${roundInfo.round} a été validé. Nouveau prenant: ${computeRoundInfo(t).member?.name || '—'}`);
  }

  function computeRoundInfo(t) {
    const start = new Date(t.startDate || Date.now());
    const stepDays = t.frequency === 'hebdo' ? 7 : 30;
    const now = new Date();
    const diffDays = Math.max(0, Math.floor((now - start) / (1000*60*60*24)));
    let cyclesPassed = Math.floor(diffDays / stepDays);
    if (typeof t.cycleIndex === 'number') {
      cyclesPassed = t.cycleIndex;
    } else {
      // initialize cycleIndex so repeated validations can advance immediately
      t.cycleIndex = cyclesPassed;
      save();
    }
    const totalRounds = Math.max(1, t.rounds || t.members.length || 1);
    const round = (cyclesPassed % totalRounds) + 1;
    const members = t.members || [];
    const memberIdx = members.length ? (cyclesPassed % members.length) : -1;
    const member = memberIdx >= 0 ? members[memberIdx] : null;
    return { round, member };
  }

  function initTheme() {
    const saved = localStorage.getItem('moinama.theme') || 'light';
    setTheme(saved);
    $('#darkModeSwitch').addEventListener('change', (e) => setTheme(e.target.checked ? 'dark' : 'light'));
  }

  function formatCurrency(n) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(n).replace('XOF', 'FCFA');
  }

  function routeTo(hash) {
    const raw = (hash || location.hash || '#/dashboard');
    // Special route for tontine detail: #/tontine/<id>
    if (raw.startsWith('#/tontine/')) {
      const tonId = raw.split('#/tontine/')[1];
      $$('.route').forEach(s => s.classList.remove('active'));
      document.querySelector('[data-route="tontine-detail"]').classList.add('active');
      $$('#navLinks .nav-link').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#/tontines'));
      $('.page-title').textContent = 'Détails de la tontine';
      renderTontineDetail(tonId);
      return;
    }

    const target = raw.replace('#/','');
    $$('.route').forEach(s => s.classList.remove('active'));
    const el = document.querySelector(`[data-route="${target}"]`);
    if (el) el.classList.add('active');
    $$('#navLinks .nav-link').forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#/${target}`));
    $('.page-title').textContent = {
      dashboard:'Dashboard global', me:'Mon dashboard', tontines:'Tontines', transactions:'Transactions', messaging:'Messagerie', login:'Se connecter', register:'Créer un compte'
    }[target] || 'Moinama';

    if (target === 'dashboard') renderDashboard();
    if (target === 'me') renderMyDashboard();
    if (target === 'tontines') renderTontines();
    if (target === 'transactions') renderTransactions();
  }

  function renderDashboard() {
    const totalContrib = state.transactions.filter(t=>t.type==='contribution').reduce((a,b)=>a+b.amount,0);
    const totalWithdraw = state.transactions.filter(t=>t.type==='withdrawal').reduce((a,b)=>a+b.amount,0);
    $('#kpiTotalContrib').textContent = `${formatCurrency(totalContrib)}`;
    $('#kpiWithdrawals').textContent = `${formatCurrency(totalWithdraw)}`;
    $('#kpiMembers').textContent = `${Array.isArray(state.members) ? state.members.length : 0}`;
    $('#kpiActiveGroups').textContent = `${state.tontines.filter(t=>t.active).length}`;

    // Upcoming payments (simple mock based on startDate + frequency)
    const list = $('#upcomingPayments');
    list.innerHTML = '';
    state.tontines.forEach(t => {
      const li = document.createElement('a');
      li.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center';
      const nextDate = nextDueDate(new Date(t.startDate), t.frequency);
      li.innerHTML = `<span><strong>${t.name}</strong><br/><small class="text-muted">${t.frequency} · prochain: ${nextDate.toLocaleDateString('fr-FR')}</small></span><span class="badge bg-primary">${formatCurrency(t.amount)}</span>`;
      list.appendChild(li);
    });

    renderContribChart();
  }

  function nextDueDate(startDate, freq) {
    const now = new Date();
    const step = (freq === 'hebdo') ? 7 : 30;
    let d = new Date(startDate);
    while (d < now) d.setDate(d.getDate() + step);
    return d;
  }

  function renderContribChart() {
    const ctx = $('#contribChart');
    const byDay = {};
    state.transactions.filter(t=>t.type==='contribution').forEach(t => {
      const d = new Date(t.date).toISOString().slice(0,10);
      byDay[d] = (byDay[d]||0) + t.amount;
    });
    const labels = Object.keys(byDay).sort();
    const data = labels.map(d=>byDay[d]);
    if (contribChart) contribChart.destroy();
    contribChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{ label: 'Contributions', data, borderColor: '#0d6efd', tension: .3, fill: true, backgroundColor: 'rgba(13,110,253,.1)'}]},
      options: { plugins: { legend: { display: false }}, scales: { x: { display: false }}}
    });
  }

  function renderMyDashboard() {
    const u = state.user?.name || 'Moi';
    const myContrib = state.transactions.filter(t=>t.type==='contribution' && t.member === u);
    const myWithdraw = state.transactions.filter(t=>t.type==='withdrawal' && t.member === u);
    const ul1 = $('#myContribList');
    const ul2 = $('#myWithdrawList');
    ul1.innerHTML = myContrib.map(t=>`<li class="list-group-item d-flex justify-content-between"><span>${new Date(t.date).toLocaleDateString('fr-FR')}</span><strong>${formatCurrency(t.amount)}</strong></li>`).join('') || '<li class="list-group-item text-muted">Aucune contribution</li>';
    ul2.innerHTML = myWithdraw.map(t=>`<li class="list-group-item d-flex justify-content-between"><span>${new Date(t.date).toLocaleDateString('fr-FR')}</span><strong>${formatCurrency(t.amount)}</strong></li>`).join('') || '<li class="list-group-item text-muted">Aucun retrait</li>';
  }

  function renderTontines() {
    const wrap = $('#tontineCards');
    wrap.innerHTML = '';
    state.tontines.forEach(t => {
      const col = document.createElement('div');
      col.className = 'col-12 col-md-6 col-xl-4';
      col.innerHTML = `
        <div class="card h-100">
          <div class="card-body d-flex flex-column">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <h3 class="h6 m-0">${t.name}</h3>
              <span class="badge ${t.active?'bg-success':'bg-secondary'}">${t.active?'Active':'Inactif'}</span>
            </div>
            <div class="small text-muted mb-2">Montant: <strong>${formatCurrency(t.amount)}</strong> · ${t.frequency} · Tours: ${t.rounds}</div>
            <div class="small mb-2">Membres: ${t.members.map(m=>`<span class=\"badge text-bg-light me-1\">${m.name}</span>`).join('')}</div>
            <div class="mt-auto d-flex gap-2">
              <button class="btn btn-sm btn-outline-primary" data-action="contribute" data-id="${t.id}"><i class="bi bi-plus-circle"></i> Cotiser</button>
              <button class="btn btn-sm btn-outline-success" data-action="withdraw" data-id="${t.id}"><i class="bi bi-cash-coin"></i> Retrait</button>
              <button class="btn btn-sm btn-outline-info" data-action="view" data-id="${t.id}"><i class="bi bi-eye"></i> Voir plus</button>
              <button class="btn btn-sm btn-outline-secondary ms-auto" data-action="toggle" data-id="${t.id}">${t.active?'Désactiver':'Activer'}</button>
            </div>
          </div>
        </div>`;
      wrap.appendChild(col);
    });

    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      const t = state.tontines.find(x=>x.id===id);
      if (!t) return;
      if (action === 'toggle') { t.active = !t.active; notify('Succès', `Tontine "${t.name}" ${t.active?'activée':'désactivée'}`); save(); renderTontines(); renderDashboard(); return; }
      if (action === 'contribute') { addTransaction('contribution', t); }
      if (action === 'withdraw') { addTransaction('withdrawal', t); }
      if (action === 'view') { location.hash = `#/tontine/${id}`; }
    });
  }

  function addTransaction(type, tontine) {
    const member = state.user?.name || (state.members && state.members[0]?.name) || 'Membre';
    const amount = tontine.amount;
    state.transactions.unshift({ id: crypto.randomUUID(), date: new Date().toISOString(), type, member, tontine: tontine.name, amount });
    notify('Opération enregistrée', `${type==='contribution'?'Contribution':'Retrait'} de ${formatCurrency(amount)} (${tontine.name})`);
    save();
    renderDashboard();
    renderTransactions();
    if (location.hash === '#/me') renderMyDashboard();
  }

  function statusLabel(s) {
    return s === 'paid' ? 'A cotisé' : s === 'not_paid' ? 'Non cotisé' : 'En attente';
  }
  function statusBadge(s) {
    const cls = s === 'paid' ? 'bg-success' : s === 'not_paid' ? 'bg-danger' : 'bg-secondary';
    return `<span class="badge ${cls}">${statusLabel(s)}</span>`;
  }

  function renderTontineDetail(id) {
    const t = state.tontines.find(x => x.id === id);
    if (!t) { notify('Erreur', "Tontine introuvable"); location.hash = '#/tontines'; return; }
    // Auto reset statuses if a new cycle started
    resetTontineCycle(t);
    $('#tonDetailTitle').textContent = `${t.name}`;
    $('#backToTontines').onclick = () => { location.hash = '#/tontines'; };
    $('#editTontineBtn').onclick = () => editTontine(t);
    $('#deleteTontineBtn').onclick = () => deleteTontine(t);
    $('#addMemberBtn').onclick = () => addMemberToTontine(t);

    // Round banner
    const roundInfo = computeRoundInfo(t);
    const banner = document.getElementById('tonRoundBanner');
    if (banner) {
      const takingName = roundInfo.member ? roundInfo.member.name : '—';
      banner.innerHTML = `<strong>Tour ${roundInfo.round} – Prenant : ${takingName}</strong> <span class="badge bg-primary ms-2">Tour en cours</span>`;
    }
    const validateBtn = document.getElementById('validateRoundBtn');
    if (validateBtn) {
      validateBtn.classList.remove('btn-success');
      validateBtn.classList.add('btn-outline-primary');
      validateBtn.disabled = false;
      validateBtn.onclick = () => validateCurrentRound(t);
    }

    // Render rounds history
    renderRoundsHistory(t);

    // KPIs
    const totalMembers = t.members.length;
    const paidCount = t.members.filter(m => m.status === 'paid').length;
    const waitingCount = t.members.filter(m => m.status === 'waiting').length;
    const notPaidCount = t.members.filter(m => m.status === 'not_paid').length;
    const participation = totalMembers ? Math.round((paidCount/totalMembers)*100) : 0;
    const totalAmount = paidCount * t.amount;
    $('#kpiTonMembers').textContent = `${totalMembers}`;
    $('#kpiTonTotal').textContent = `${formatCurrency(totalAmount)}`;
    $('#kpiTonRate').textContent = `${participation}%`;
    $('#kpiTonLate').textContent = `${notPaidCount + waitingCount}`;

    // Members table
    const tbody = $('#tonMembersTable tbody');
    tbody.innerHTML = t.members.map(m => {
      const myTx = state.transactions.filter(tx => tx.tontine === t.name && tx.member === m.name && tx.type === 'contribution');
      const count = myTx.length;
      return `
      <tr data-member-id="${m.id}">
        <td>${m.name}</td>
        <td><button class="btn btn-link btn-sm p-0" data-edit-contact title="Modifier le contact">${m.contact || ''}</button></td>
        <td>${statusBadge(m.status || 'waiting')} ${count?`<span class="badge text-bg-light ms-1" title="Contributions enregistrées">${count}</span>`:''}</td>
        <td class="text-end">
          <div class="btn-group btn-group-sm" role="group">
            <button class="btn btn-outline-success" data-status="paid">Marquer payé</button>
            <button class="btn btn-outline-secondary" data-status="waiting">En attente</button>
            <button class="btn btn-outline-danger" data-status="not_paid">Non payé</button>
            <button class="btn btn-outline-danger" data-remove-member title="Retirer le membre"><i class="bi bi-person-dash"></i></button>
          </div>
        </td>
      </tr>
    `}).join('');

    // Delegate actions
    tbody.onclick = (e) => {
      const btn = e.target.closest('button[data-status]');
      const tr = e.target.closest('tr');
      const memberId = tr?.getAttribute('data-member-id');
      const member = t.members.find(m => m.id === memberId);
      if (btn) {
        const status = btn.getAttribute('data-status');
        if (!member) return;
        member.status = status;
        save();
        renderTontineDetail(id);
        notify('Mise à jour', `${member.name}: ${statusLabel(status)}`);
        return;
      }
      const editBtn = e.target.closest('button[data-edit-contact]');
      if (editBtn && member) {
        const newContact = prompt('Contact du membre:', member.contact || '');
        if (newContact !== null) {
          member.contact = newContact.trim();
          // also reflect in directory
          const dir = (state.members||[]).find(x => x.id === member.id);
          if (dir) dir.contact = member.contact;
          save();
          renderTontineDetail(id);
          notify('Mis à jour', `Contact de ${member.name} modifié.`);
        }
        return;
      }
      const removeBtn = e.target.closest('button[data-remove-member]');
      if (removeBtn && member) {
        if (confirm(`Retirer ${member.name} de la tontine ?`)) {
          t.members = t.members.filter(m => m.id !== member.id);
          save();
          renderTontineDetail(id);
          notify('Membre retiré', `${member.name} a été retiré.`);
        }
      }
    };
  }

  function editTontine(t) {
    const name = prompt('Nom de la tontine:', t.name);
    if (name === null) return;
    const amount = parseInt(prompt('Montant par contribution:', t.amount), 10);
    if (Number.isNaN(amount)) { notify('Erreur', 'Montant invalide'); return; }
    const frequency = prompt('Fréquence (hebdo/mensuel):', t.frequency) || t.frequency;
    const rounds = parseInt(prompt('Durée (tours):', t.rounds), 10);
    if (Number.isNaN(rounds)) { notify('Erreur', 'Tours invalide'); return; }
    const startDateStr = prompt('Date de début (YYYY-MM-DD):', t.startDate.slice(0,10));
    if (!startDateStr) return;
    t.name = name.trim() || t.name;
    t.amount = amount;
    t.frequency = (frequency === 'hebdo' || frequency === 'mensuel') ? frequency : t.frequency;
    t.rounds = rounds;
    t.startDate = new Date(startDateStr).toISOString();
    save();
    notify('Tontine mise à jour', `"${t.name}" modifiée.`);
    // refresh current detail route
    renderTontineDetail(t.id);
    renderTontines();
    renderDashboard();
  }

  function deleteTontine(t) {
    if (!confirm(`Supprimer la tontine "${t.name}" ? Cette action est irréversible.`)) return;
    state.tontines = state.tontines.filter(x => x.id !== t.id);
    save();
    notify('Tontine supprimée', `"${t.name}" a été supprimée.`);
    location.hash = '#/tontines';
    renderDashboard();
  }

  function addMemberToTontine(t) {
    const name = prompt('Nom du membre à ajouter:');
    if (!name) return;
    const contact = prompt('Contact du membre:') || '';
    // ensure directory record
    let dir = (state.members||[]).find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!dir) { dir = { id: crypto.randomUUID(), name: name.trim(), contact: contact.trim() }; (state.members = state.members || []).push(dir); }
    // avoid duplicates in tontine
    if (t.members.find(m => m.id === dir.id)) { notify('Info', `${dir.name} est déjà membre.`); return; }
    t.members.push({ id: dir.id, name: dir.name, contact: dir.contact, status: 'waiting' });
    save();
    renderTontineDetail(t.id);
    notify('Membre ajouté', `${dir.name} a été ajouté à ${t.name}.`);
  }

  function resetTontineCycle(t) {
    try {
      const stepDays = t.frequency === 'hebdo' ? 7 : 30;
      const last = t.lastReset ? new Date(t.lastReset) : new Date(t.startDate || Date.now());
      const now = new Date();
      const diffDays = Math.floor((now - last) / (1000*60*60*24));
      if (diffDays >= stepDays) {
        // New cycle – reset member statuses to waiting
        t.members.forEach(m => { m.status = 'waiting'; });
        t.lastReset = now.toISOString();
        save();
      }
    } catch {}
  }

  function renderTransactions() {
    const tbody = $('#transactionsTable tbody');
    const type = $('#txTypeFilter').value;
    const days = parseInt($('#txPeriodFilter').value, 10);
    const since = new Date(); since.setDate(since.getDate() - days);
    const rows = state.transactions
      .filter(t => (type==='all' || t.type===type) && new Date(t.date) >= since)
      .map(t => `
        <tr>
          <td>${new Date(t.date).toLocaleDateString('fr-FR')}</td>
          <td>${t.type==='contribution'?'<span class="badge bg-primary">Contribution</span>':'<span class="badge bg-success">Retrait</span>'}</td>
          <td>${t.member}</td>
          <td>${t.tontine}</td>
          <td class="text-end fw-bold">${formatCurrency(t.amount)}</td>
        </tr>`)
      .join('');
    tbody.innerHTML = rows || `<tr><td colspan="5" class="text-center text-muted">Aucune transaction</td></tr>`;
  }

  function exportCsv() {
    const headers = ['date','type','member','tontine','amount'];
    const rows = [headers].concat(state.transactions.map(t => [t.date, t.type, t.member, t.tontine, t.amount]));
    const csv = rows.map(r => r.map(v => typeof v === 'string' && v.includes(',') ? `"${v}"` : v).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'transactions.csv'; a.click();
    URL.revokeObjectURL(url);
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
    const t = new bootstrap.Toast(el, { delay: 2500 });
    t.show();
    el.addEventListener('hidden.bs.toast', () => el.remove());
  }

  function save() { Store.save(state); }

  function bind() {
    // Sidebar toggle (mobile)
    $('#sidebarToggle').addEventListener('click', () => $('#sidebar').classList.toggle('show'));

    // Filters
    $('#txTypeFilter').addEventListener('change', renderTransactions);
    $('#txPeriodFilter').addEventListener('change', renderTransactions);
    $('#exportCsvBtn').addEventListener('click', exportCsv);

    // New tontine modal save
    $('#saveTontineBtn').addEventListener('click', () => {
      const m = $('#newTontineModal');
      const name = $('#tonName').value.trim();
      const amount = parseInt($('#tonAmount').value,10)||0;
      const frequency = $('#tonFrequency').value;
      const rounds = parseInt($('#tonRounds').value,10)||1;
      const startDate = $('#tonStartDate').value;
      const inputMembers = $('#tonMembers').value.split(',').map(s=>s.trim()).filter(Boolean);
      if (!name || !amount || !startDate) { notify('Erreur', 'Veuillez remplir les champs requis.'); return; }
      // ensure directory entries and create tontine member objects
      const tonMembers = inputMembers.map(n => {
        let dir = (state.members||[]).find(x => x.name.toLowerCase() === n.toLowerCase());
        if (!dir) { dir = { id: crypto.randomUUID(), name: n, contact: Store.fakePhone() }; (state.members = state.members || []).push(dir); }
        return { id: dir.id, name: dir.name, contact: dir.contact, status: 'waiting' };
      });
      state.tontines.push({ id: crypto.randomUUID(), name, amount, frequency, rounds, startDate: new Date(startDate).toISOString(), members: tonMembers, active: true });
      save();
      notify('Tontine créée', `"${name}" a été ajoutée.`);
      renderTontines();
      const modal = bootstrap.Modal.getOrCreateInstance(m);
      modal.hide();
      $('#tontineForm').reset();
    });

    // Auth
    $('#loginForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const id = $('#loginIdentifier').value.trim();
      const name = id.split('@')[0] || 'Utilisateur';
      state.user = { name, id };
      save();
      $('#currentUserName').textContent = name;
      notify('Bienvenue', `${name}, vous êtes connecté.`);
      location.hash = '#/dashboard';
    });

    $('#registerForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('#regName').value.trim();
      const email = $('#regEmail').value.trim();
      const phone = $('#regPhone').value.trim();
      state.user = { name, email, phone };
      save();
      $('#currentUserName').textContent = name;
      notify('Compte créé', 'Votre compte a été créé et vous êtes connecté.');
      location.hash = '#/dashboard';
    });

    $('#logoutBtn').addEventListener('click', () => {
      state.user = null; save();
      $('#currentUserName').textContent = 'Invité';
      notify('Déconnexion', 'Vous êtes déconnecté.');
    });

    // Simple search (filters tontines by name)
    $('#quickSearch').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      $$('#tontineCards .card').forEach(card => {
        const name = card.querySelector('.h6').textContent.toLowerCase();
        card.parentElement.style.display = name.includes(q) ? '' : 'none';
      });
    });

    // Hash routing
    window.addEventListener('hashchange', () => routeTo());
  }

  function init() {
    initTheme();
    bind();
    // restore user
    if (state.user) $('#currentUserName').textContent = state.user.name;
    routeTo();
    // initial renders
    renderDashboard();
    renderTransactions();
    renderTontines();
  }

  return { init };
})();

window.addEventListener('DOMContentLoaded', App.init);
