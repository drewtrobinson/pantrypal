// 1. Configuration - USE YOUR ACTUAL CREDENTIALS HERE
const SB_URL = "https://brgubymkaqzaaiwafivo.supabase.co";
const SB_KEY = "sb_publishable_P07pP1pQUSjKxH7opu4knQ_pr4WPi9D";

// 2. Initialize the client using a unique name 'pantryDb'
// This avoids the "already been declared" error.
const pantryDb = window.supabase.createClient(SB_URL, SB_KEY);

let user = null;
let household = null;
let inventory = [];
let categories = [];
let html5QrCode = null;

console.log("PantryPal: Script loaded and initializing...");

// --- INITIALIZATION ---
async function init() {
    const { data: { session }, error: authError } = await pantryDb.auth.getSession();
    
    if (authError) {
        console.error("Auth Error:", authError);
        return;
    }

    if (!session) {
        console.log("No session found, showing auth screen.");
        showScreen('auth-screen');
        return;
    }

    user = session.user;
    console.log("Logged in as:", user.email);
    
    // Check Profile
    const { data: profile, error: profileError } = await pantryDb
        .from('profiles')
        .select('*, households(*)')
        .eq('id', user.id)
        .single();
    
    if (profileError || !profile || !profile.household_id) {
        console.log("No household found for user, showing onboarding.");
        showScreen('onboarding-screen');
    } else {
        household = profile.households;
        console.log("Household loaded:", household.name);
        showScreen('main-app');
        document.getElementById('display-invite-code').innerText = household.invite_code;
        syncData();
    }
}

// --- NAVIGATION & SCREENS ---
function showScreen(id) {
    const screens = ['auth-screen', 'onboarding-screen', 'main-app'];
    screens.forEach(s => {
        const el = document.getElementById(s);
        if (el) el.classList.add('hidden');
    });
    const target = document.getElementById(id);
    if (target) target.classList.remove('hidden');
    else console.error("Could not find screen element:", id);
}

window.switchTab = (id, btn) => {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active-tab'));
    const targetTab = document.getElementById(id);
    if (targetTab) targetTab.classList.add('active-tab');
    
    document.querySelectorAll('nav button').forEach(b => {
        b.classList.remove('text-pink-600');
        b.classList.add('text-gray-400');
    });
    btn.classList.remove('text-gray-400');
    btn.classList.add('text-pink-600');
};

// --- AUTHENTICATION ---
window.handleAuth = async (type) => {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    
    const { data, error } = type === 'signup' 
        ? await pantryDb.auth.signUp({ email, password }) 
        : await pantryDb.auth.signInWithPassword({ email, password });

    if (error) alert(error.message);
    else {
        if (type === 'signup') alert("Check your email for a confirmation link!");
        init();
    }
};

window.handleLogout = async () => {
    await pantryDb.auth.signOut();
    location.reload();
};

// --- HOUSEHOLD SETUP ---
window.setupHousehold = async (action) => {
    if (action === 'create') {
        const name = prompt("Enter a name for your Household (e.g., Smith Family):");
        if (!name) return;
        
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        const { data: h, error: hErr } = await pantryDb.from('households')
            .insert([{ name, invite_code: code }])
            .select().single();
            
        if (hErr) return alert("Error creating household: " + hErr.message);

        await pantryDb.from('profiles').upsert({ id: user.id, household_id: h.id });
        await pantryDb.from('categories').insert([
            { household_id: h.id, name: 'Pantry' }, 
            { household_id: h.id, name: 'Fridge' },
            { household_id: h.id, name: 'Freezer' }
        ]);
    } else {
        const code = prompt("Enter the 6-digit Invite Code:").toUpperCase();
        const { data: h, error: hErr } = await pantryDb.from('households').select('id').eq('invite_code', code).single();
        
        if (h) {
            await pantryDb.from('profiles').upsert({ id: user.id, household_id: h.id });
        } else {
            return alert("Invalid Code or Household not found.");
        }
    }
    init();
};

// --- DATA FETCHING & RENDERING ---
function syncData() {
    pantryDb.channel('pantry-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => fetchData())
        .subscribe();
    fetchData();
}

async function fetchData() {
    const [inv, cats, recs] = await Promise.all([
        pantryDb.from('inventory').select('*').eq('household_id', household.id),
        pantryDb.from('categories').select('*').eq('household_id', household.id),
        pantryDb.from('recipes').select('*, recipe_items(*)')
    ]);
    
    inventory = inv.data || [];
    categories = cats.data || [];
    
    renderDashboard();
    renderShopping();
    renderRecipes(recs.data || []);
}

function renderDashboard() {
    const container = document.getElementById('inventory-list');
    if (!container) return;
    
    let html = '';
    const totalValue = inventory.reduce((sum, i) => sum + (i.price * i.qty), 0);
    const lowStockCount = inventory.filter(i => i.qty <= i.min).length;
    
    document.getElementById('stat-value').innerText = `$${totalValue.toFixed(2)}`;
    document.getElementById('stat-low').innerText = lowStockCount;

    categories.forEach(cat => {
        const items = inventory.filter(i => i.category === cat.name);
        if (items.length > 0) {
            html += `<div class="mb-6"><h3 class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">${cat.name}</h3>`;
            items.forEach(item => {
                html += `
                    <div class="bg-white dark:bg-gray-800 p-4 rounded-3xl border dark:border-gray-700 flex items-center justify-between mb-3 ${item.qty <= item.min ? 'low-stock' : ''}">
                        <div onclick="window.openItemModal('${item.id}')">
                            <p class="font-black text-sm">${item.name}</p>
                            <p class="text-[10px] text-gray-400 font-bold">$${item.price.toFixed(2)} • ${item.calories || 0} cal</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <button onclick="window.updateQty('${item.id}', -1)" class="w-10 h-10 rounded-xl bg-gray-50 dark:bg-gray-700 font-black">-</button>
                            <span class="font-black text-lg">${item.qty}</span>
                            <button onclick="window.updateQty('${item.id}', 1)" class="w-10 h-10 rounded-xl bg-pink-50 dark:bg-pink-900/30 text-pink-600 font-black">+</button>
                        </div>
                    </div>`;
            });
            html += `</div>`;
        }
    });
    container.innerHTML = html || `<div class="text-center py-20 text-gray-400 font-medium">Your pantry is empty.<br>Tap "Add Item" to start.</div>`;
}

function renderShopping() {
    const list = inventory.filter(i => i.qty <= i.min).sort((a,b) => a.checked - b.checked);
    const badge = document.getElementById('shop-badge');
    badge.innerText = list.length;
    badge.classList.toggle('hidden', list.length === 0);
    
    document.getElementById('shopping-list').innerHTML = list.map(i => `
        <div class="flex items-center gap-4 p-5 bg-white dark:bg-gray-800 rounded-3xl border dark:border-gray-700 ${i.checked ? 'opacity-40' : ''}">
            <input type="checkbox" ${i.checked ? 'checked' : ''} onchange="window.toggleShopCheck('${i.id}', this.checked)" class="w-6 h-6 rounded-lg accent-pink-600">
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
            <button onclick="window.cookRecipe('${r.id}')" class="w-full py-3 bg-pink-600 text-white rounded-xl font-black text-[10px] uppercase">Add ingredients to Shopping List</button>
        </div>
    `).join('');
}

// --- GLOBAL UTILITIES ---
window.updateQty = async (id, delta) => {
    const item = inventory.find(i => i.id === id);
    const newQty = Math.max(0, item.qty + delta);
    await pantryDb.from('inventory').update({ 
        qty: newQty, 
        checked: newQty > item.min ? false : item.checked 
    }).eq('id', id);
    fetchData();
};

window.toggleShopCheck = async (id, checked) => {
    await pantryDb.from('inventory').update({ checked }).eq('id', id);
    fetchData();
};

window.openItemModal = async (id = null) => {
    const name = id ? inventory.find(i => i.id === id).name : "";
    const itemName = prompt("Item Name:", name);
    if (!itemName) return;
    
    const cat = prompt("Category (Pantry, Fridge, etc):", categories[0]?.name || "Pantry");
    const price = prompt("Price (0.00):", "0.00");
    
    const data = { 
        household_id: household.id, 
        name: itemName, 
        category: cat, 
        price: parseFloat(price) || 0
    };
    
    if (id) await pantryDb.from('inventory').update(data).eq('id', id);
    else await pantryDb.from('inventory').insert([data]);
    fetchData();
};

window.toggleDarkMode = () => {
    document.documentElement.classList.toggle('dark');
};

// Start the app on load
init();
