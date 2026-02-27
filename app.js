const SB_URL = "https://brgubymkaqzaaiwafivo.supabase.co";
const SB_KEY = "sb_publishable_P07pP1pQUSjKxH7opu4knQ_pr4WPi9D";
const supabase = window.supabase.createClient(SB_URL, SB_KEY);

let user = null;
let household = null;
let inventory = [];
let categories = [];
let html5QrCode = null;

// --- INITIALIZATION ---
async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        showScreen('auth-screen');
        return;
    }
    user = session.user;
    
    // Check Profile
    const { data: profile } = await supabase.from('profiles').select('*, households(*)').eq('id', user.id).single();
    
    if (!profile || !profile.household_id) {
        showScreen('onboarding-screen');
    } else {
        household = profile.households;
        showScreen('main-app');
        document.getElementById('display-invite-code').innerText = household.invite_code;
        syncData();
    }
}

// --- AUTHENTICATION ---
async function handleAuth(type) {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const { error } = type === 'signup' ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
    else init();
}

async function handleLogout() {
    await supabase.auth.signOut();
    location.reload();
}

// --- HOUSEHOLD SETUP ---
async function setupHousehold(action) {
    if (action === 'create') {
        const name = prompt("Household Name:");
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const { data: h } = await supabase.from('households').insert([{ name, invite_code: code }]).select().single();
        await supabase.from('profiles').upsert({ id: user.id, household_id: h.id });
        await supabase.from('categories').insert([{ household_id: h.id, name: 'Pantry' }, { household_id: h.id, name: 'Fridge' }]);
    } else {
        const code = prompt("Enter Invite Code:").toUpperCase();
        const { data: h } = await supabase.from('households').select('id').eq('invite_code', code).single();
        if (h) await supabase.from('profiles').upsert({ id: user.id, household_id: h.id });
        else return alert("Invalid Code");
    }
    init();
}

// --- DATA & UI ---
function syncData() {
    // Realtime Listener
    supabase.channel('pantry').on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => fetchData()).subscribe();
    fetchData();
}

async function fetchData() {
    const [inv, cats, recs] = await Promise.all([
        supabase.from('inventory').select('*').eq('household_id', household.id),
        supabase.from('categories').select('*').eq('household_id', household.id),
        supabase.from('recipes').select('*, recipe_items(*)')
    ]);
    inventory = inv.data || [];
    categories = cats.data || [];
    renderDashboard();
    renderShopping();
    renderRecipes(recs.data || []);
}

function renderDashboard() {
    const container = document.getElementById('inventory-list');
    let html = '';
    
    const totalValue = inventory.reduce((sum, i) => sum + (i.price * i.qty), 0);
    document.getElementById('stat-value').innerText = `$${totalValue.toFixed(2)}`;
    document.getElementById('stat-low').innerText = inventory.filter(i => i.qty <= i.min).length;

    categories.forEach(cat => {
        const items = inventory.filter(i => i.category === cat.name);
        if (items.length > 0) {
            html += `<div class="mb-6"><h3 class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">${cat.name}</h3>`;
            items.forEach(item => {
                html += `
                    <div class="bg-white dark:bg-gray-800 p-4 rounded-3xl border dark:border-gray-700 flex items-center justify-between mb-3 ${item.qty <= item.min ? 'low-stock' : ''}">
                        <div onclick="openItemModal('${item.id}')">
                            <p class="font-black text-sm">${item.name}</p>
                            <p class="text-[10px] text-gray-400 font-bold">$${item.price} • ${item.calories || 0} cal</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <button onclick="updateQty('${item.id}', -1)" class="w-10 h-10 rounded-xl bg-gray-50 dark:bg-gray-700 font-black">-</button>
                            <span class="font-black text-lg">${item.qty}</span>
                            <button onclick="updateQty('${item.id}', 1)" class="w-10 h-10 rounded-xl bg-pink-50 dark:bg-pink-900/30 text-pink-600 font-black">+</button>
                        </div>
                    </div>`;
            });
            html += `</div>`;
        }
    });
    container.innerHTML = html || `<p class="text-center text-gray-400 py-20">Your pantry is empty.</p>`;
}

function renderShopping() {
    const list = inventory.filter(i => i.qty <= i.min).sort((a,b) => a.checked - b.checked);
    document.getElementById('shop-badge').innerText = list.length;
    document.getElementById('shop-badge').classList.toggle('hidden', list.length === 0);
    
    document.getElementById('shopping-list').innerHTML = list.map(i => `
        <div class="flex items-center gap-4 p-5 bg-white dark:bg-gray-800 rounded-3xl border dark:border-gray-700 ${i.checked ? 'opacity-40' : ''}">
            <input type="checkbox" ${i.checked ? 'checked' : ''} onchange="toggleShopCheck('${i.id}', this.checked)" class="w-6 h-6 rounded-lg accent-pink-600">
            <div class="flex-1">
                <p class="font-black ${i.checked ? 'line-through' : ''}">${i.name}</p>
                <p class="text-[9px] text-gray-400 font-black uppercase">${i.category} • Need ${i.min}</p>
            </div>
        </div>
    `).join('');
}

function renderRecipes(recs) {
    document.getElementById('recipe-list').innerHTML = recs.map(r => `
        <div class="bg-white dark:bg-gray-800 p-6 rounded-[2.5rem] border dark:border-gray-700">
            <h4 class="font-black text-lg mb-4">${r.name}</h4>
            <button onclick="cookRecipe('${r.id}')" class="w-full py-3 bg-pink-600 text-white rounded-xl font-black text-[10px] uppercase">Add ingredients to Shopping List</button>
        </div>
    `).join('');
}

// --- BARCODE SCANNER ---
function startScanner() {
    document.getElementById('scanner-overlay').classList.remove('hidden');
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, async (barcode) => {
        stopScanner();
        fetchBarcodeData(barcode);
    });
}

function stopScanner() {
    if (html5QrCode) html5QrCode.stop();
    document.getElementById('scanner-overlay').classList.add('hidden');
}

async function fetchBarcodeData(barcode) {
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    const data = await res.json();
    if (data.status === 1) {
        const p = data.product;
        // Open modal with pre-filled info
        openItemModal(null, {
            name: p.product_name,
            calories: p.nutriments['energy-kcal_100g'],
            barcode: barcode
        });
    } else {
        alert("Product not in database.");
    }
}

// --- UTILITIES ---
function showScreen(id) {
    ['auth-screen', 'onboarding-screen', 'main-app'].forEach(s => document.getElementById(s).classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

function switchTab(id, btn) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active-tab'));
    document.getElementById(id).classList.add('active-tab');
    document.querySelectorAll('nav button').forEach(b => b.classList.replace('text-pink-600', 'text-gray-400'));
    btn.classList.replace('text-gray-400', 'text-pink-600');
}

async function updateQty(id, delta) {
    const item = inventory.find(i => i.id === id);
    const newQty = Math.max(0, item.qty + delta);
    await supabase.from('inventory').update({ qty: newQty, checked: newQty > item.min ? false : item.checked }).eq('id', id);
}

async function toggleShopCheck(id, checked) {
    await supabase.from('inventory').update({ checked }).eq('id', id);
}

function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
}

// Modal helper (Simplified for this workspace)
window.openItemModal = (id = null, prefill = null) => {
    const name = prefill ? prefill.name : (id ? inventory.find(i => i.id === id).name : "");
    const itemName = prompt("Item Name:", name);
    if (!itemName) return;
    const cat = prompt("Category:", categories[0].name);
    const price = prompt("Price:", "0.00");
    
    const data = { 
        household_id: household.id, 
        name: itemName, 
        category: cat, 
        price: parseFloat(price),
        calories: prefill ? prefill.calories : 0
    };
    
    if (id) supabase.from('inventory').update(data).eq('id', id).then(() => fetchData());
    else supabase.from('inventory').insert([data]).then(() => fetchData());
};

init();
