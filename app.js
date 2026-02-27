// 1. Configuration - USE YOUR ACTUAL CREDENTIALS HERE
const SB_URL = "https://brgubymkaqzaaiwafivo.supabase.co";
const SB_KEY = "sb_publishable_P07pP1pQUSjKxH7opu4knQ_pr4WPi9D";

const pantryDb = window.supabase.createClient(SB_URL, SB_KEY);

let user, household, inventory = [], categories = [], recipes = [], html5QrCode = null;

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
}

// --- SCANNER & API ---
window.startScanner = () => {
    document.getElementById('scanner-overlay').classList.remove('hidden');
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, async (code) => {
        window.stopScanner();
        const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`);
        const data = await res.json();
        
        if (data.status === 1) {
            const p = data.product;
            const nutri = {
                name: p.product_name,
                barcode: code,
                price: 0, // Manual price entry
                image: p.image_url,
                calories: p.nutriments['energy-kcal_100g'] || 0,
                protein: p.nutriments.proteins_100g || 0,
                carbs: p.nutriments.carbohydrates_100g || 0,
                fat: p.nutriments.fat_100g || 0,
                sugars: p.nutriments.sugars_100g || 0
            };
            window.openItemModal(null, nutri);
        } else alert("Product not found. Enter manually.");
    });
};

window.stopScanner = () => { if (html5QrCode) html5QrCode.stop(); document.getElementById('scanner-overlay').classList.add('hidden'); };

// --- UI RENDERING ---
function renderDashboard() {
    let html = '';
    categories.forEach(cat => {
        const items = inventory.filter(i => i.category === cat.name);
        if (items.length) {
            html += `<div class="mb-8"><h3 class="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3 px-2">${cat.name}</h3>`;
            items.forEach(i => {
                const isLow = i.qty <= i.min;
                html += `
                    <div class="bg-white dark:bg-gray-800 p-4 rounded-3xl border border-gray-100 dark:border-gray-700 flex items-center justify-between mb-3 shadow-sm ${isLow ? 'low-stock' : ''}">
                        <div onclick="window.showNutrition('${i.id}')" class="flex-1">
                            <h4 class="font-black text-sm">${i.name}</h4>
                            <div class="flex gap-2 text-[9px] font-black uppercase tracking-tight text-gray-400 mt-0.5">
                                <span>$${parseFloat(i.price).toFixed(2)}</span>
                                <span class="${isLow ? 'text-pink-600' : ''}">MIN: ${i.min}</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-4">
                            <button onclick="window.updateQty('${i.id}', -1)" class="w-10 h-10 rounded-xl bg-gray-50 dark:bg-gray-700 font-black">-</button>
                            <span class="font-black text-lg w-6 text-center">${i.qty}</span>
                            <button onclick="window.updateQty('${i.id}', 1)" class="w-10 h-10 rounded-xl bg-pink-50 dark:bg-pink-900/40 text-pink-600 font-black">+</button>
                        </div>
                    </div>`;
            });
            html += `</div>`;
        }
    });
    document.getElementById('inventory-list').innerHTML = html || `<div class="py-20 text-center opacity-30 font-black uppercase text-xs tracking-widest">Pantry Empty</div>`;
}

// --- NUTRITION DRAWER ---
window.showNutrition = (id) => {
    const i = inventory.find(x => x.id === id);
    if (!i.barcode) return window.openItemModal(id); // If no barcode data, just edit

    document.getElementById('nutri-name').innerText = i.name;
    document.getElementById('nutri-barcode').innerText = i.barcode;
    document.getElementById('nutri-img').querySelector('img').src = i.image_url || "";
    document.getElementById('nutri-cal').innerText = `${i.calories || 0} kcal`;
    document.getElementById('nutri-pro').innerText = `${i.protein || 0}g`;
    document.getElementById('nutri-carb').innerText = `${i.carbs || 0}g / ${i.sugars || 0}g`;
    document.getElementById('nutri-fat').innerText = `${i.fat || 0}g`;
    
    document.getElementById('nutrition-overlay').classList.remove('hidden');
};

window.closeNutrition = () => document.getElementById('nutrition-overlay').classList.add('hidden');

// --- ITEM MODAL ---
window.openItemModal = (id = null, scanData = null) => {
    const modal = document.getElementById('modal-overlay');
    const form = document.getElementById('item-form');
    form.reset();
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
    } else if (scanData) {
        document.getElementById('modal-item-name').value = scanData.name;
        // Store scan data in hidden temp attributes or object for form submission
        window.lastScan = scanData;
    }
    modal.classList.remove('hidden');
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
        min: parseInt(document.getElementById('modal-item-min').value) || 1,
        category: document.getElementById('modal-item-category').value
    };

    // If this was a scan, merge nutrition data
    if (!id && window.lastScan) {
        d.barcode = window.lastScan.barcode;
        d.image_url = window.lastScan.image;
        d.calories = window.lastScan.calories;
        d.protein = window.lastScan.protein;
        d.carbs = window.lastScan.carbs;
        d.fat = window.lastScan.fat;
        d.sugars = window.lastScan.sugars;
    }

    if (id) await pantryDb.from('inventory').update(d).eq('id', id);
    else await pantryDb.from('inventory').insert([d]);
    
    window.lastScan = null;
    window.closeItemModal();
    fetchData();
};

// --- REMAINDER OF UTILS (Same as previous stable versions) ---
window.updateQty = async (id, delta) => {
    const i = inventory.find(x => x.id === id);
    const n = Math.max(0, i.qty + delta);
    await pantryDb.from('inventory').update({ qty: n, checked: n > i.min ? false : i.checked }).eq('id', id);
    fetchData();
};

window.renderShopping = () => {
    const list = inventory.filter(i => i.qty <= i.min).sort((a,b) => a.checked - b.checked);
    document.getElementById('shop-badge').innerText = list.length;
    document.getElementById('shop-badge').classList.toggle('hidden', !list.length);
    document.getElementById('shopping-list').innerHTML = list.map(i => `
        <div class="flex items-center gap-4 p-5 bg-white dark:bg-gray-800 rounded-3xl border dark:border-gray-700 ${i.checked ? 'opacity-40' : ''}">
            <input type="checkbox" ${i.checked ? 'checked' : ''} onchange="window.toggleShopCheck('${i.id}', this.checked)" class="w-6 h-6 accent-pink-600">
            <p class="font-black ${i.checked ? 'line-through' : ''}">${i.name}</p>
        </div>
    `).join('');
};

window.toggleShopCheck = async (id, c) => { await pantryDb.from('inventory').update({ checked: c }).eq('id', id); fetchData(); };
window.switchTab = (id, btn) => {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active-tab'));
    document.getElementById(id).classList.add('active-tab');
    document.querySelectorAll('nav button').forEach(b => b.classList.replace('text-pink-600', 'text-gray-400'));
    btn.classList.replace('text-gray-400', 'text-pink-600');
};
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
        await pantryDb.from('categories').insert([{ household_id: h.id, name: 'Fridge' }, { household_id: h.id, name: 'Pantry' }]);
    } else {
        const c = prompt("Code:").toUpperCase();
        const { data: h } = await pantryDb.from('households').select('id').eq('invite_code', c).single();
        if (h) await pantryDb.from('profiles').upsert({ id: user.id, household_id: h.id });
    }
    init();
};
window.toggleDarkMode = () => document.documentElement.classList.toggle('dark');
function showScreen(id) {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('onboarding-screen').classList.add('hidden');
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById(id).classList.remove('hidden');
}

init();
