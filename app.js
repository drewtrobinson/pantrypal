// 1. Configuration - USE YOUR ACTUAL CREDENTIALS HERE
const SB_URL = "https://brgubymkaqzaaiwafivo.supabase.co";
const SB_KEY = "sb_publishable_P07pP1pQUSjKxH7opu4knQ_pr4WPi9D";

const pantryDb = window.supabase.createClient(SB_URL, SB_KEY);

let user, household, inventory = [], categories = [], recipes = [], html5QrCode = null;

// --- INIT ---
async function init() {
    const { data: { session } } = await pantryDb.auth.getSession();
    if (!session) return showScreen('auth-screen');
    user = session.user;

    const { data: profile } = await pantryDb.from('profiles').select('*, households(*)').eq('id', user.id).single();
    if (!profile || !profile.household_id) return showScreen('onboarding-screen');

    household = profile.households;
    document.getElementById('display-invite-code').innerText = household.invite_code;
    showScreen('main-app');
    fetchData();
    pantryDb.channel('pantry').on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => fetchData()).subscribe();
}

async function fetchData() {
    const [inv, cats, recs] = await Promise.all([
        pantryDb.from('inventory').select('*').eq('household_id', household.id),
        pantryDb.from('categories').select('*').eq('household_id', household.id),
        pantryDb.from('recipes').select('*, recipe_items(*)').eq('household_id', household.id)
    ]);
    inventory = inv.data || [];
    categories = cats.data || [];
    recipes = recs.data || [];
    renderDashboard();
    renderShopping();
    renderRecipes();
    renderCategoryManager();
}

// --- CATEGORY MANAGEMENT ---
window.addCategory = async () => {
    const input = document.getElementById('new-cat-input');
    if (!input.value) return;
    await pantryDb.from('categories').insert([{ household_id: household.id, name: input.value }]);
    input.value = "";
    fetchData();
};

window.deleteCategory = async (id) => {
    if (confirm("Delete this location? Items will remain in inventory but you should update them.")) {
        await pantryDb.from('categories').delete().eq('id', id);
        fetchData();
    }
};

function renderCategoryManager() {
    const list = document.getElementById('category-manager-list');
    list.innerHTML = categories.map(c => `
        <div class="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-900 rounded-xl">
            <span class="text-sm font-bold">${c.name}</span>
            <button onclick="window.deleteCategory('${c.id}')" class="text-red-400 text-xs px-2"><i class="fas fa-trash"></i></button>
        </div>
    `).join('');
}

// --- RECIPE KITS MODAL ---
window.openRecipeModal = () => {
    document.getElementById('recipe-name-input').value = "";
    document.getElementById('recipe-ingredients-list').innerHTML = "";
    window.addIngredientRow(); // Add first row
    document.getElementById('recipe-modal-overlay').classList.remove('hidden');
};

window.closeRecipeModal = () => document.getElementById('recipe-modal-overlay').classList.add('hidden');

window.addIngredientRow = () => {
    const container = document.getElementById('recipe-ingredients-list');
    const div = document.createElement('div');
    div.className = "flex gap-2";
    div.innerHTML = `
        <input type="text" placeholder="Ingredient Name" class="ingredient-item flex-1 p-3 bg-gray-50 dark:bg-gray-900 rounded-xl text-xs font-bold outline-none">
        <button onclick="this.parentElement.remove()" class="text-gray-300 px-2">&times;</button>
    `;
    container.appendChild(div);
};

window.saveRecipe = async () => {
    const name = document.getElementById('recipe-name-input').value;
    const items = Array.from(document.querySelectorAll('.ingredient-item')).map(i => i.value).filter(v => v);
    if (!name || items.length === 0) return alert("Add a name and at least one ingredient.");

    const { data: rec } = await pantryDb.from('recipes').insert([{ household_id: household.id, name }]).select().single();
    for (const item of items) {
        await pantryDb.from('recipe_items').insert([{ recipe_id: rec.id, item_name: item }]);
    }
    window.closeRecipeModal();
    fetchData();
};

// --- REST OF UI & LOGIC ---
window.startScanner = () => {
    document.getElementById('scanner-overlay').classList.remove('hidden');
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, async (code) => {
        window.stopScanner();
        const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`);
        const data = await res.json();
        window.openItemModal(null, data.status === 1 ? data.product.product_name : "");
    });
};

window.stopScanner = () => { if (html5QrCode) html5QrCode.stop(); document.getElementById('scanner-overlay').classList.add('hidden'); };

function renderDashboard() {
    let html = '';
    categories.forEach(cat => {
        const items = inventory.filter(i => i.category === cat.name);
        if (items.length) {
            html += `<div class="mb-6"><h3 class="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3 px-1">${cat.name}</h3>`;
            items.forEach(i => {
                html += `
                    <div class="bg-white dark:bg-gray-800 p-4 rounded-3xl border border-gray-100 dark:border-gray-700 flex items-center justify-between mb-3 shadow-sm ${i.qty <= i.min ? 'low-stock' : ''}">
                        <div onclick="window.openItemModal('${i.id}')" class="flex-1 font-black text-sm">${i.name}</div>
                        <div class="flex items-center gap-3">
                            <button onclick="window.updateQty('${i.id}', -1)" class="w-10 h-10 rounded-xl bg-gray-50 dark:bg-gray-700 font-black">-</button>
                            <span class="font-black text-lg w-6 text-center">${i.qty}</span>
                            <button onclick="window.updateQty('${i.id}', 1)" class="w-10 h-10 rounded-xl bg-pink-50 dark:bg-pink-900/30 text-pink-600 font-black">+</button>
                        </div>
                    </div>`;
            });
            html += `</div>`;
        }
    });
    document.getElementById('inventory-list').innerHTML = html || `<p class="text-center text-gray-400 py-20 font-black uppercase text-[10px] tracking-widest">No Items in Pantry</p>`;
}

function renderRecipes() {
    document.getElementById('recipe-list').innerHTML = recipes.map(r => `
        <div class="bg-white dark:bg-gray-800 p-6 rounded-[2.5rem] border border-gray-100 dark:border-gray-700 shadow-sm relative overflow-hidden">
            <h4 class="font-black mb-1">${r.name}</h4>
            <p class="text-[10px] text-gray-400 uppercase font-black mb-4">${r.recipe_items.length} Ingredients</p>
            <button onclick="window.addRecipeToShop('${r.id}')" class="w-full py-3 bg-pink-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest">Add to Shop List</button>
            <button onclick="window.deleteRecipe('${r.id}')" class="absolute top-4 right-4 text-gray-300 p-2"><i class="fas fa-trash"></i></button>
        </div>
    `).join('');
}

window.deleteRecipe = async (id) => { if (confirm("Delete this kit?")) { await pantryDb.from('recipes').delete().eq('id', id); fetchData(); } };

window.addRecipeToShop = async (id) => {
    const r = recipes.find(x => x.id === id);
    for (const item of r.recipe_items) {
        const existing = inventory.find(i => i.name.toLowerCase() === item.item_name.toLowerCase());
        if (existing) await pantryDb.from('inventory').update({ qty: 0, checked: false }).eq('id', existing.id);
        else await pantryDb.from('inventory').insert([{ household_id: household.id, name: item.item_name, qty: 0, min: 1, category: categories[0]?.name || 'Pantry' }]);
    }
    alert("Ingredients added!");
    fetchData();
};

function renderShopping() {
    const list = inventory.filter(i => i.qty <= i.min).sort((a,b) => a.checked - b.checked);
    const badge = document.getElementById('shop-badge');
    badge.innerText = list.length;
    badge.classList.toggle('hidden', !list.length);
    document.getElementById('shopping-list').innerHTML = list.map(i => `
        <div class="flex items-center gap-4 p-5 bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 ${i.checked ? 'opacity-40' : ''}">
            <input type="checkbox" ${i.checked ? 'checked' : ''} onchange="window.toggleShopCheck('${i.id}', this.checked)" class="w-6 h-6 accent-pink-600">
            <p class="font-black ${i.checked ? 'line-through' : ''}">${i.name}</p>
        </div>
    `).join('');
}

// --- UTILS ---
window.handleAuth = async (t) => {
    const e = document.getElementById('auth-email').value, p = document.getElementById('auth-password').value;
    const { error } = t === 'signup' ? await pantryDb.auth.signUp({ email: e, password: p }) : await pantryDb.auth.signInWithPassword({ email: e, password: p });
    if (error) alert(error.message); else init();
};

window.setupHousehold = async (a) => {
    if (a === 'create') {
        const n = prompt("Family Name:"); if (!n) return;
        const c = Math.random().toString(36).substring(2, 8).toUpperCase();
        const { data: h } = await pantryDb.from('households').insert([{ name: n, invite_code: c }]).select().single();
        await pantryDb.from('profiles').upsert({ id: user.id, household_id: h.id });
        await pantryDb.from('categories').insert([{ household_id: h.id, name: 'Pantry' }, { household_id: h.id, name: 'Fridge' }]);
    } else {
        const c = prompt("Code:").toUpperCase();
        const { data: h } = await pantryDb.from('households').select('id').eq('invite_code', c).single();
        if (h) await pantryDb.from('profiles').upsert({ id: user.id, household_id: h.id });
    }
    init();
};

window.switchTab = (id, btn) => {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active-tab'));
    document.getElementById(id).classList.add('active-tab');
    document.querySelectorAll('nav button').forEach(b => b.classList.replace('text-pink-600', 'text-gray-400'));
    btn.classList.replace('text-gray-400', 'text-pink-600');
};

window.openItemModal = (id = null, scanName = null) => {
    document.getElementById('item-form').reset();
    document.getElementById('modal-item-id').value = id || '';
    document.getElementById('modal-delete-btn').classList.toggle('hidden', !id);
    document.getElementById('modal-item-category').innerHTML = categories.map(c => `<option>${c.name}</option>`).join('');
    if (id) {
        const i = inventory.find(x => x.id === id);
        document.getElementById('modal-item-name').value = i.name;
        document.getElementById('modal-item-price').value = i.price;
        document.getElementById('modal-item-qty').value = i.qty;
        document.getElementById('modal-item-category').value = i.category;
    }
    if (scanName) document.getElementById('modal-item-name').value = scanName;
    document.getElementById('modal-overlay').classList.remove('hidden');
};

window.closeItemModal = () => document.getElementById('modal-overlay').classList.add('hidden');

document.getElementById('item-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('modal-item-id').value;
    const d = { 
        household_id: household.id, 
        name: document.getElementById('modal-item-name').value, 
        price: parseFloat(document.getElementById('modal-item-price').value) || 0, 
        qty: parseInt(document.getElementById('modal-item-qty').value) || 0, 
        category: document.getElementById('modal-item-category').value 
    };
    if (id) await pantryDb.from('inventory').update(d).eq('id', id); else await pantryDb.from('inventory').insert([d]);
    window.closeItemModal();
    fetchData();
};

window.updateQty = async (id, d) => {
    const i = inventory.find(x => x.id === id);
    const n = Math.max(0, i.qty + d);
    await pantryDb.from('inventory').update({ qty: n, checked: n > i.min ? false : i.checked }).eq('id', id);
    fetchData();
};

window.toggleShopCheck = async (id, c) => { await pantryDb.from('inventory').update({ checked: c }).eq('id', id); fetchData(); };
window.handleLogout = async () => { await pantryDb.auth.signOut(); location.reload(); };
window.toggleDarkMode = () => document.documentElement.classList.toggle('dark');
function showScreen(id) {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('onboarding-screen').classList.add('hidden');
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById(id).classList.remove('hidden');
}

window.deleteItem = async () => {
    const id = document.getElementById('modal-item-id').value;
    if (confirm("Permanently delete this item?")) {
        await pantryDb.from('inventory').delete().eq('id', id);
        window.closeItemModal();
        fetchData();
    }
};

init();
