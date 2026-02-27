// 1. Configuration - USE YOUR ACTUAL CREDENTIALS HERE
const SB_URL = "https://brgubymkaqzaaiwafivo.supabase.co";
const SB_KEY = "sb_publishable_P07pP1pQUSjKxH7opu4knQ_pr4WPi9D";

// Use unique name to avoid declaration error
const pantryDb = window.supabase.createClient(SB_URL, SB_KEY);

let user = null;
let household = null;
let inventory = [];
let categories = [];

// --- INITIALIZATION ---
async function init() {
    const { data: { session } } = await pantryDb.auth.getSession();
    
    if (!session) {
        showScreen('auth-screen');
        return;
    }
    user = session.user;
    
    const { data: profile } = await pantryDb.from('profiles')
        .select('*, households(*)')
        .eq('id', user.id)
        .single();
    
    if (!profile || !profile.household_id) {
        showScreen('onboarding-screen');
    } else {
        household = profile.households;
        document.getElementById('display-invite-code').innerText = household.invite_code;
        showScreen('main-app');
        setupRealtime();
        fetchData();
    }
}

// --- NAVIGATION ---
function showScreen(id) {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('onboarding-screen').classList.add('hidden');
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById(id).classList.remove('hidden');
}

window.switchTab = (id, btn) => {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active-tab'));
    document.getElementById(id).classList.add('active-tab');
    document.querySelectorAll('nav button').forEach(b => b.classList.replace('text-pink-600', 'text-gray-400'));
    btn.classList.replace('text-gray-400', 'text-pink-600');
};

// --- AUTH & SETUP ---
window.handleAuth = async (type) => {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const { error } = type === 'signup' 
        ? await pantryDb.auth.signUp({ email, password }) 
        : await pantryDb.auth.signInWithPassword({ email, password });
    
    if (error) alert(error.message);
    else init();
};

window.handleLogout = async () => {
    await pantryDb.auth.signOut();
    location.reload();
};

window.setupHousehold = async (action) => {
    if (action === 'create') {
        const name = prompt("Enter Household Name:");
        if (!name) return;
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        const { data: h } = await pantryDb.from('households').insert([{ name, invite_code: code }]).select().single();
        await pantryDb.from('profiles').upsert({ id: user.id, household_id: h.id });
        await pantryDb.from('categories').insert([{ household_id: h.id, name: 'Pantry' }, { household_id: h.id, name: 'Fridge' }]);
    } else {
        const code = prompt("Enter 6-Digit Code:").toUpperCase();
        const { data: h } = await pantryDb.from('households').select('id').eq('invite_code', code).single();
        if (h) await pantryDb.from('profiles').upsert({ id: user.id, household_id: h.id });
        else return alert("Invalid Code");
    }
    init();
};

// --- DATA LOGIC ---
function setupRealtime() {
    pantryDb.channel('pantry').on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => fetchData()).subscribe();
}

async function fetchData() {
    const [inv, cats] = await Promise.all([
        pantryDb.from('inventory').select('*').eq('household_id', household.id),
        pantryDb.from('categories').select('*').eq('household_id', household.id)
    ]);
    inventory = inv.data || [];
    categories = cats.data || [];
    renderDashboard();
    renderShopping();
}

function renderDashboard() {
    const container = document.getElementById('inventory-list');
    let html = '';
    
    const totalVal = inventory.reduce((s, i) => s + (i.price * i.qty), 0);
    document.getElementById('stat-value').innerText = `$${totalVal.toFixed(2)}`;
    document.getElementById('stat-low').innerText = inventory.filter(i => i.qty <= i.min).length;

    categories.forEach(cat => {
        const items = inventory.filter(i => i.category === cat.name);
        if (items.length > 0) {
            html += `<div class="mb-6"><h3 class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">${cat.name}</h3>`;
            items.forEach(item => {
                html += `
                    <div class="bg-white dark:bg-gray-800 p-4 rounded-3xl border dark:border-gray-700 flex items-center justify-between mb-3 ${item.qty <= item.min ? 'low-stock' : ''}">
                        <div onclick="window.openItemModal('${item.id}')" class="flex-1">
                            <p class="font-black text-sm">${item.name}</p>
                            <p class="text-[9px] text-gray-400 font-bold uppercase tracking-tight">$${item.price.toFixed(2)}</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <button onclick="window.updateQty('${item.id}', -1)" class="w-10 h-10 rounded-xl bg-gray-50 dark:bg-gray-700 font-black">-</button>
                            <span class="font-black text-lg w-6 text-center">${item.qty}</span>
                            <button onclick="window.updateQty('${item.id}', 1)" class="w-10 h-10 rounded-xl bg-pink-50 dark:bg-pink-900/40 text-pink-600 font-black">+</button>
                        </div>
                    </div>`;
            });
            html += `</div>`;
        }
    });
    container.innerHTML = html || `<p class="text-center text-gray-400 py-20 font-bold uppercase text-xs">Pantry is empty</p>`;
}

function renderShopping() {
    const list = inventory.filter(i => i.qty <= i.min).sort((a,b) => a.checked - b.checked);
    document.getElementById('shop-badge').innerText = list.length;
    document.getElementById('shop-badge').classList.toggle('hidden', list.length === 0);
    
    document.getElementById('shopping-list').innerHTML = list.map(i => `
        <div class="flex items-center gap-4 p-5 bg-white dark:bg-gray-800 rounded-3xl border dark:border-gray-700 ${i.checked ? 'opacity-40' : ''}">
            <input type="checkbox" ${i.checked ? 'checked' : ''} onchange="window.toggleShopCheck('${i.id}', this.checked)" class="w-6 h-6 rounded-lg accent-pink-600">
            <div class="flex-1">
                <p class="font-black ${i.checked ? 'line-through' : ''}">${i.name}</p>
                <p class="text-[9px] text-gray-400 font-black uppercase tracking-widest">${i.category}</p>
            </div>
        </div>
    `).join('');
}

// --- MODAL & ACTIONS ---
window.openItemModal = (id = null) => {
    const modal = document.getElementById('modal-overlay');
    const form = document.getElementById('item-form');
    form.reset();
    
    document.getElementById('modal-item-id').value = id || '';
    document.getElementById('modal-delete-btn').classList.toggle('hidden', !id);
    
    const catSelect = document.getElementById('modal-item-category');
    catSelect.innerHTML = categories.map(c => `<option>${c.name}</option>`).join('');

    if (id) {
        const item = inventory.find(i => i.id === id);
        document.getElementById('modal-item-name').value = item.name;
        document.getElementById('modal-item-price').value = item.price;
        document.getElementById('modal-item-qty').value = item.qty;
        catSelect.value = item.category;
    }
    modal.classList.remove('hidden');
};

window.closeItemModal = () => document.getElementById('modal-overlay').classList.add('hidden');

document.getElementById('item-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('modal-item-id').value;
    const data = {
        household_id: household.id,
        name: document.getElementById('modal-item-name').value,
        price: parseFloat(document.getElementById('modal-item-price').value) || 0,
        qty: parseInt(document.getElementById('modal-item-qty').value) || 0,
        category: document.getElementById('modal-item-category').value
    };
    if (id) await pantryDb.from('inventory').update(data).eq('id', id);
    else await pantryDb.from('inventory').insert([data]);
    window.closeItemModal();
    fetchData();
};

window.deleteItem = async () => {
    if(confirm("Delete Permanently?")) {
        await pantryDb.from('inventory').delete().eq('id', document.getElementById('modal-item-id').value);
        window.closeItemModal();
        fetchData();
    }
};

window.updateQty = async (id, delta) => {
    const i = inventory.find(x => x.id === id);
    const n = Math.max(0, i.qty + delta);
    await pantryDb.from('inventory').update({ qty: n, checked: n > i.min ? false : i.checked }).eq('id', id);
    fetchData();
};

window.toggleShopCheck = async (id, checked) => {
    await pantryDb.from('inventory').update({ checked }).eq('id', id);
    fetchData();
};

window.toggleDarkMode = () => document.documentElement.classList.toggle('dark');

init();
