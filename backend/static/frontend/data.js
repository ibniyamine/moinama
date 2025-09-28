// Simulated local data + persistence via localStorage with migration support
const Store = {
  get key() { return 'moinama.v1'; },
  load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return this.seed();
      const data = JSON.parse(raw);
      return this.migrate(data);
    } catch (e) { return this.seed(); }
  },
  save(data) { localStorage.setItem(this.key, JSON.stringify(data)); },
  seed() {
    const now = new Date();
    const memberDirectory = ['Alice','Bob','Carla','David'].map(name => ({
      id: crypto.randomUUID(),
      name,
      contact: this.fakePhone(),
    }));
    const tontineMembers = memberDirectory.map(m => ({ id: m.id, name: m.name, contact: m.contact, status: 'waiting' }));
    const data = {
      user: null,
      members: memberDirectory,
      tontines: [
        {
          id: crypto.randomUUID(),
          name: 'Solidarité A',
          amount: 5000,
          frequency: 'mensuel',
          rounds: 6,
          startDate: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
          members: tontineMembers,
          active: true
        }
      ],
      transactions: []
    };
    // add some transactions
    for (let i=0;i<24;i++) {
      const d = new Date();
      d.setDate(d.getDate() - Math.floor(Math.random()*90));
      const m = memberDirectory[Math.floor(Math.random()*memberDirectory.length)];
      data.transactions.push({
        id: crypto.randomUUID(),
        date: d.toISOString(),
        type: Math.random() > 0.8 ? 'withdrawal' : 'contribution',
        member: m.name,
        tontine: data.tontines[0].name,
        amount: (Math.floor(Math.random()*6)+1)*1000
      });
    }
    this.save(data);
    return data;
  },
  migrate(data) {
    // Ensure member directory objects
    if (Array.isArray(data.members) && typeof data.members[0] === 'string') {
      data.members = data.members.map(name => ({ id: crypto.randomUUID(), name, contact: this.fakePhone() }));
    }
    // Ensure tontine members are objects with status
    if (Array.isArray(data.tontines)) {
      data.tontines.forEach(t => {
        if (Array.isArray(t.members)) {
          t.members = t.members.map(m => {
            if (typeof m === 'string') {
              const dir = (data.members||[]).find(x => x.name === m);
              return { id: dir?.id || crypto.randomUUID(), name: m, contact: dir?.contact || this.fakePhone(), status: 'waiting' };
            }
            // ensure fields
            return { id: m.id || crypto.randomUUID(), name: m.name, contact: m.contact || this.fakePhone(), status: m.status || 'waiting' };
          });
        } else {
          t.members = [];
        }
      });
    }
    return data;
  },
  fakePhone() {
    const n = Math.floor(1000000 + Math.random()*9000000);
    return `+225 07 ${String(n).slice(0,3)} ${String(n).slice(3,5)} ${String(n).slice(5)}`;
  }
};
