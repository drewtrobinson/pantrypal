// 1. Configuration - USE YOUR ACTUAL CREDENTIALS HERE
const SB_URL = "https://brgubymkaqzaaiwafivo.supabase.co";
const SB_KEY = "sb_publishable_P07pP1pQUSjKxH7opu4knQ_pr4WPi9D";

// Using 'pantryDb' to avoid naming conflicts with the global Supabase library
const pantryDb = window.supabase.createClient(SB_URL, SB_KEY);

// 2. GLOBAL STATE
let user = null;
let household = null;
let inventory = [];
let categories = [];
let recipes = [];
let html5QrCode = null;
let lastScanData = null;
let isSelectionMode = false;
let selectedItems = [];
let currentViewingId = null;

// 3. CORE ENGINE: SCREEN & TAB MANAGEMENT
function showScreen(id) {
    const screens = ['auth-screen', 'onboarding-screen', 'main-app'];
    screens.forEach(s => document.getElementById(s)?.classList.add('hidden'));
    document.getElementById(id)?.classList.remove('hidden');
}

window.switchTab = (id, btn) => {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active-tab'));
    document.getElementById(id).classList.add('active-tab');
    document.querySelectorAll('nav button').forEach(b => b.classList.replace('text-pink-600', 'text-gray-400'));
    btn.classList.replace('text-gray-400', 'text-pink-600');
    if (isSelectionMode) window.toggleSelectionMode(); // Exit selection mode when switching tabs
};

// 4. INITIALIZATION
async function init() {
    console.log("PantryPal Pro: Booting up...");
    const { data: { session } } = await pantryDb.auth.getSession();
    
    if (!session) {
        showScreen('auth-screen');
        return;
    }

    user = session.user;
    
    // Load Profile & Household
    const { data: profile, error } = await pantryDb.from('profiles')
        .select('*, households(*)')
        .eq('id', user.id)
        .single();
    
    if (error || !profile?.household_id) {
        showScreen('onboarding-screen');
    } else {
        household = profile.households;
        document.getElementById('display-invite-code').innerText = household.invite_code;
        showScreen('main-app');
        setupRealtime();
        fetchData();
    }
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

function setupRealtime() {
    pantryDb.channel('pantry-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => fetchData())
        .subscribe();
}

// 5. DASHBOARD & BULK SELECTION
window.toggleSelectionMode = () => {
    isSelectionMode = !isSelectionMode;
    selectedItems = [];
    const btn = document.getElementById('bulk-toggle-btn');
    const bar = document.getElementById('bulk-bar');
    
    btn.innerText = isSelectionMode ? "Cancel" : "Select";
    btn.classList.toggle('bg-gray-900', isSelectionMode);
    bar.classList.toggle('translate-y-40', !isSelectionMode);
    bar.classList.toggle('translate-y-0', isSelectionMode);
    renderDashboard();
};

window.toggleItemSelection = (id) => {
    if (selectedItems.includes(id)) selectedItems = selectedItems.filter(i => i !== id);
    else selectedItems.push(id);
    renderDashboard();
};

window.bulkAction = async (type) => {
    if (!selectedItems.length) return;
    
    if (type === 'delete' && confirm(`Delete ${selectedItems.length} items?`)) {
        await pantryDb.from('inventory').delete().in('id', selectedItems);
    } else if (type === 'restock') {
        for (let id of selectedItems) {
            const item = inventory.find(i => i.id === id);
            await pantryDb.from('inventory').update({ qty: item.qty + 1 }).eq('id', id);
        }
    } else if (type === 'shop') {
        await pantryDb.from('inventory').update({ qty: 0, checked: false }).in('id', selectedItems);
    }
    
    window.toggleSelectionMode();
    fetchData();
};

function renderDashboard() {
    let html = '';
    categories.forEach(cat => {
        const items = inventory.filter(i => i.category === cat.name);
        if (items.length) {
            html += `<div class="mb-8"><h3 class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 px-2">${cat.name}</h3>`;
            items.forEach(i => {
                const isSelected = selectedItems.includes(i.id);
                const isLow = i.qty <= i.min;
                html += `
                    <div class="bg-white dark:bg-gray-800 p-4 rounded-3xl border border-gray-100 dark:border-gray-700 flex items-center gap-3 mb-3 shadow-sm ${isLow ? 'low-stock' : ''} ${isSelected ? 'ring-2 ring-pink-600' : ''}">
                        ${isSelectionMode ? `<input type="checkbox" ${isSelected ? 'checked' : ''} onchange="window.toggleItemSelection('${i.id}')" class="w-5 h-5 accent-pink-600">` : ''}
                        <div onclick="window.showNutrition('${i.id}')" class="flex-1">
                            <h4 class="font-black text-sm">${i.name}</h4>
                            <p class="text-[9px] text-gray-400 font-bold uppercase tracking-widest">$${i.price} • Min: ${i.min}</p>
                        </div>
                        ${!isSelectionMode ? `
                        <div class="flex items-center gap-3">
                            <button onclick="window.updateQty('${i.id}', -1)" class="w-10 h-10 rounded-xl bg-gray-50 dark:bg-gray-700 font-black">-</button>
                            <span class="font-black text-lg w-4 text-center">${i.qty}</span>
                            <button onclick="window.updateQty('${i.id}', 1)" class="w-10 h-10 rounded-xl bg-pink-50 dark:bg-pink-900/30 text-pink-600 font-black">+</button>
                        </div>` : ''}
                    </div>`;
            });
            html += `</div>`;
        }
    });
    document.getElementById('inventory-list').innerHTML = html || `<p class="text-center py-20 opacity-30 font-black text-xs">Pantry Empty</p>`;
}

// 6. BARCODE & NUTRITION
window.startScanner = () => {
    document.getElementById('scanner-overlay').classList.remove('hidden');
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, async (code) => {
        window.stopScanner();
        window.openItemModal(null);
        document.getElementById('modal-item-name').value = "Fetching data...";
        const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`);
        const data = await res.json();
        if (data.status === 1) {
            const p = data.product;
            lastScanData = { barcode: code, image_url: p.image_url, calories: p.nutriments['energy-kcal_100g'], protein: p.nutriments.proteins_100g, carbs: p.nutriments.carbohydrates_100g, fat: p.nutriments.fat_100g, sugars: p.nutriments.sugars_100g };
            document.getElementById('modal-item-name').value = p.product_name || "";
        } else alert("Not found");
    });
};

window.stopScanner = () => { if (html5QrCode) html5QrCode.stop(); document.getElementById('scanner-overlay').classList.add('hidden'); };

window.showNutrition = (id) => {
    if (isSelectionMode) return window.toggleItemSelection(id);
    currentViewingId = id;
    const i = inventory.find(x => x.id === id);
    document.getElementById('nutri-name').innerText = i.name;
    document.getElementById('nutri-img').querySelector('img').src = i.image_url || "";
    document.getElementById('nutri-cal').innerText = `${i.calories || 0} kcal`;
    document.getElementById('nutri-pro').innerText = `${i.protein || 0}g`;
    document.getElementById('nutrition-overlay').classList.remove('hidden');
};

window.editFromNutrition = () => { window.closeNutrition(); window.openItemModal(currentViewingId); };
window.closeNutrition = () => document.getElementById('nutrition-overlay').classList.add('hidden');

// 7. RECIPE KITS
window.openRecipeModal = () => {
    document.getElementById('recipe-name-input').value = "";
    document.getElementById('recipe-ingredients-list').innerHTML = "";
    window.addIngredientRow();
    document.getElementById('recipe-modal-overlay').classList.remove('hidden');
};

window.addIngredientRow = () => {
    const list = document.getElementById('recipe-ingredients-list');
    const row = document.createElement('div');
    row.className = "flex gap-2";
    row.innerHTML = `<input type="text" placeholder="Item Name" class="recipe-ing-input flex-1 p-4 bg-gray-50 dark:bg-gray-900 rounded-2xl text-xs font-bold outline-none"><button onclick="this.parentElement.remove()" class="text-gray-300 px-2">&times;</button>`;
    list.appendChild(row);
};

window.saveRecipe = async () => {
    const name = document.getElementById('recipe-name-input').value;
    const items = Array.from(document.querySelectorAll('.recipe-ing-input')).map(i => i.value).filter(v => v);
    if (!name || !items.length) return alert("Fill all fields");
    const { data: r } = await pantryDb.from('recipes').insert([{ household_id: household.id, name }]).select().single();
    for (const item of items) await pantryDb.from('recipe_items').insert([{ recipe_id: r.id, item_name: item }]);
    window.closeRecipeModal();
    fetchData();
};

window.addRecipeToShop = async (id) => {
    const r = recipes.find(x => x.id === id);
    for (const item of r.recipe_items) {
        const existing = inventory.find(i => i.name.toLowerCase() === item.item_name.toLowerCase());
        if (existing) await pantryDb.from('inventory').update({ qty: 0, checked: false }).eq('id', existing.id);
        else await pantryDb.from('inventory').insert([{ household_id: household.id, name: item.item_name, qty: 0, min: 1, category: categories[0]?.name || 'Pantry' }]);
    }
    alert("Kitted!"); fetchData();
};

function renderRecipes() {
    document.getElementById('recipe-list').innerHTML = recipes.map(r => `
        <div class="bg-white dark:bg-gray-800 p-6 rounded-[2.5rem] border dark:border-gray-700 shadow-sm relative">
            <h4 class="font-black mb-1">${r.name}</h4>
            <p class="text-[10px] text-gray-400 font-bold uppercase mb-4">${r.recipe_items.length} Items</p>
            <button onclick="window.addRecipeToShop('${r.id}')" class="w-full py-3 bg-pink-600 text-white rounded-xl font-black text-[10px] uppercase">Add to Shop List</button>
            <button onclick="window.deleteRecipe('${r.id}')" class="absolute top-6 right-6 text-gray-300"><i class="fas fa-trash text-xs"></i></button>
        </div>`).join('');
}

window.deleteRecipe = async (id) => { if (confirm("Delete Kit?")) { await pantryDb.from('recipes').delete().eq('id', id); fetchData(); } };
window.closeRecipeModal = () => document.getElementById('recipe-modal-overlay').classList.add('hidden');

// 8. ITEM MODAL & ACTIONS
window.openItemModal = (id = null) => {
    const modal = document.getElementById('modal-overlay');
    document.getElementById('item-form').reset();
    document.getElementById('modal-item-id').value = id || '';
    document.getElementById('modal-delete-btn').classList.toggle('hidden', !id);
    document.getElementById('modal-item-category').innerHTML = categories.map(c => `<option>${c.name}</option>`).join('');
    if (id) {
        const i = inventory.find(x => x.id === id);
        document.getElementById('modal-item-name').value = i.name;
        document.getElementById('modal-item-price').value = i.price;
        document.getElementById('modal-item-qty').value = i.qty;
        document.getElementById('modal-item-min').value = i.min;
        document.getElementById('modal-item-category').value = i.category;
    }
    modal.classList.remove('hidden');
};

document.getElementById('item-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('modal-item-id').value;
    let d = {
        household_id: household.id,
        name: document.getElementById('modal-item-name').value,
        price: parseFloat(document.getElementById('modal-item-price').value) || 0,
        qty: parseInt(document.getElementById('modal-item-qty').value) || 0,
        min: parseInt(document.getElementById('modal-item-min').value) || 1,
        category: document.getElementById('modal-item-category').value
    };
    if (!id && lastScanData) d = { ...d, ...lastScanData };
    if (id) await pantryDb.from('inventory').update(d).eq('id', id);
    else await pantryDb.from('inventory').insert([d]);
    lastScanData = null; window.closeItemModal(); fetchData();
};

window.closeItemModal = () => document.getElementById('modal-overlay').classList.add('hidden');
window.updateQty = async (id, delta) => {
    const i = inventory.find(x => x.id === id);
    const n = Math.max(0, i.qty + delta);
    await pantryDb.from('inventory').update({ qty: n, checked: n > i.min ? false : i.checked }).eq('id', id);
    fetchData();
};
window.deleteItem = async () => { if (confirm("Delete Item?")) { await pantryDb.from('inventory').delete().eq('id', document.getElementById('modal-item-id').value); window.closeItemModal(); fetchData(); } };

// 9. SHOPPING & SETTINGS
function renderShopping() {
    const list = inventory.filter(i => i.qty <= i.min).sort((a,b) => a.checked - b.checked);
    const badge = document.getElementById('shop-badge');
    badge.innerText = list.length;
    badge.classList.toggle('hidden', !list.length);
    document.getElementById('shopping-list').innerHTML = list.map(i => `
        <div class="flex items-center gap-4 p-5 bg-white dark:bg-gray-800 rounded-3xl border dark:border-gray-700 ${i.checked ? 'opacity-40' : ''}">
            <input type="checkbox" ${i.checked ? 'checked' : ''} onchange="window.toggleShopCheck('${i.id}', this.checked)" class="w-6 h-6 accent-pink-600">
            <p class="font-black ${i.checked ? 'line-through' : ''}">${i.name}</p>
        </div>`).join('');
}

window.toggleShopCheck = async (id, c) => { await pantryDb.from('inventory').update({ checked: c }).eq('id', id); fetchData(); };

function renderCategoryManager() {
    document.getElementById('category-manager-list').innerHTML = categories.map(c => `
        <div class="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-900 rounded-xl">
            <span class="text-sm font-bold">${c.name}</span>
            <button onclick="window.deleteCategory('${c.id}')" class="text-red-400 text-xs px-2"><i class="fas fa-trash"></i></button>
        </div>`).join('');
}

window.addCategory = async () => {
    const input = document.getElementById('new-cat-input');
    if (input.value) await pantryDb.from('categories').insert([{ household_id: household.id, name: input.value }]);
    input.value = ""; fetchData();
};

window.deleteCategory = async (id) => { if (confirm("Delete Category?")) { await pantryDb.from('categories').delete().eq('id', id); fetchData(); } };

// 10. AUTH & HOUSEHOLD SETUP
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

window.toggleDarkMode = () => document.documentElement.classList.toggle('dark');
window.handleLogout = async () => { await pantryDb.auth.signOut(); location.reload(); };

// INITIALIZE
init();
