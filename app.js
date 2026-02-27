// 1. Configuration - USE YOUR ACTUAL CREDENTIALS HERE
const SB_URL = "https://brgubymkaqzaaiwafivo.supabase.co";
const SB_KEY = "sb_publishable_P07pP1pQUSjKxH7opu4knQ_pr4WPi9D";

const pantryDb = window.supabase.createClient(SB_URL, SB_KEY);

let user, household, inventory = [], categories = [], recipes = [], html5QrCode = null;
let lastScanData = null, isSelectionMode = false, selectedItems = [], currentViewingId = null;

// Essential Screen Logic
function showScreen(id) {
    ['auth-screen', 'onboarding-screen', 'main-app'].forEach(s => document.getElementById(s).classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

async function init() {
    const { data: { session } } = await pantryDb.auth.getSession();
    if (!session) return showScreen('auth-screen');
    user = session.user;
    const { data: profile } = await pantryDb.from('profiles').select('*, households(*)').eq('id', user.id).single();
    if (!profile?.household_id) return showScreen('onboarding-screen');
    household = profile.households;
    document.getElementById('display-invite-code').innerText = household.invite_code;
    showScreen('main-app');
    fetchData();
}

async function fetchData() {
    const [inv, cats, recs] = await Promise.all([
        pantryDb.from('inventory').select('*').eq('household_id', household.id),
        pantryDb.from('categories').select('*').eq('household_id', household.id),
        pantryDb.from('recipes').select('*, recipe_items(*)').eq('household_id', household.id)
    ]);
    inventory = inv.data || []; categories = cats.data || []; recipes = recs.data || [];
    renderDashboard(); renderShopping(); renderRecipes();
}

// BULK MODE
window.toggleSelectionMode = () => {
    isSelectionMode = !isSelectionMode; selectedItems = [];
    const btn = document.getElementById('bulk-toggle-btn');
    const bar = document.getElementById('bulk-bar');
    btn.innerText = isSelectionMode ? "Cancel" : "Select";
    bar.classList.toggle('bulk-bar-hidden', !isSelectionMode);
    bar.classList.toggle('bulk-bar-visible', isSelectionMode);
    renderDashboard();
};

window.toggleItemSelection = (id) => {
    selectedItems.includes(id) ? selectedItems = selectedItems.filter(i => i !== id) : selectedItems.push(id);
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
    window.toggleSelectionMode(); fetchData();
};

// DASHBOARD RENDER
function renderDashboard() {
    let html = '';
    categories.forEach(cat => {
        const items = inventory.filter(i => i.category === cat.name);
        if (items.length) {
            html += `<div class="mb-8"><h3 class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 px-2">${cat.name}</h3>`;
            items.forEach(i => {
                const isSelected = selectedItems.includes(i.id);
                html += `
                    <div class="bg-white dark:bg-gray-800 p-4 rounded-3xl border border-gray-100 dark:border-gray-700 flex items-center gap-3 mb-3 shadow-sm ${i.qty <= i.min ? 'low-stock' : ''} ${isSelected ? 'ring-2 ring-pink-600' : ''}">
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

// NUTRITION & EDIT
window.showNutrition = (id) => {
    if (isSelectionMode) return window.toggleItemSelection(id);
    currentViewingId = id; const i = inventory.find(x => x.id === id);
    document.getElementById('nutri-name').innerText = i.name;
    document.getElementById('nutri-img').querySelector('img').src = i.image_url || "";
    document.getElementById('nutri-cal').innerText = `${i.calories || 0} kcal`;
    document.getElementById('nutri-pro').innerText = `${i.protein || 0}g`;
    document.getElementById('nutrition-overlay').classList.remove('hidden');
};
window.closeNutrition = () => document.getElementById('nutrition-overlay').classList.add('hidden');
window.editFromNutrition = () => { window.closeNutrition(); window.openItemModal(currentViewingId); };

// ITEM MODAL
window.openItemModal = (id = null, scanData = null) => {
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
    document.getElementById('modal-overlay').classList.remove('hidden');
};
window.closeItemModal = () => document.getElementById('modal-overlay').classList.add('hidden');

// (Include the rest of the handleAuth, switchTab, and recipe logic from the previous stable app.js here)
// Make sure every function you call in HTML starts with "window.functionName = ..." 

init();
