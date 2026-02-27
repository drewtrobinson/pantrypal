// 1. Configuration - USE YOUR ACTUAL CREDENTIALS HERE
const SB_URL = "https://brgubymkaqzaaiwafivo.supabase.co";
const SB_KEY = "sb_publishable_P07pP1pQUSjKxH7opu4knQ_pr4WPi9D";

const pantryDb = window.supabase.createClient(SB_URL, SB_KEY);

let user, household, inventory = [], categories = [], recipes = [], html5QrCode = null;
let lastScanData = null; // Important: This holds the barcode info temporarily

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
}

// --- SCANNER FIX ---
window.startScanner = () => {
    document.getElementById('scanner-overlay').classList.remove('hidden');
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, async (code) => {
        window.stopScanner();
        
        // Show a temporary "Loading" modal so they know it's working
        window.openItemModal(null); 
        document.getElementById('modal-item-name').value = "Searching Database...";

        const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`);
        const data = await res.json();
        
        if (data.status === 1) {
            const p = data.product;
            lastScanData = {
                barcode: code,
                image_url: p.image_url,
                calories: p.nutriments['energy-kcal_100g'] || 0,
                protein: p.nutriments.proteins_100g || 0,
                carbs: p.nutriments.carbohydrates_100g || 0,
                fat: p.nutriments.fat_100g || 0,
                sugars: p.nutriments.sugars_100g || 0
            };
            document.getElementById('modal-item-name').value = p.product_name || "";
        } else {
            document.getElementById('modal-item-name').value = "";
            alert("Product not found. Please enter the name manually.");
        }
    });
};

window.stopScanner = () => {
    if (html5QrCode) html5QrCode.stop();
    document.getElementById('scanner-overlay').classList.add('hidden');
};

// --- RECIPE KITS FIX ---
window.openRecipeModal = () => {
    document.getElementById('recipe-name-input').value = "";
    document.getElementById('recipe-ingredients-list').innerHTML = "";
    window.addIngredientRow(); // Add first blank row
    document.getElementById('recipe-modal-overlay').classList.remove('hidden');
};

window.closeRecipeModal = () => document.getElementById('recipe-modal-overlay').classList.add('hidden');

window.addIngredientRow = () => {
    const list = document.getElementById('recipe-ingredients-list');
    const row = document.createElement('div');
    row.className = "flex gap-2";
    row.innerHTML = `
        <input type="text" placeholder="Item Name" class="recipe-ing-input flex-1 p-3 bg-gray-50 dark:bg-gray-900 rounded-xl text-xs font-bold outline-none">
        <button onclick="this.parentElement.remove()" class="text-gray-300 px-2">&times;</button>
    `;
    list.appendChild(row);
};

window.saveRecipe = async () => {
    const name = document.getElementById('recipe-name-input').value;
    const inputs = document.querySelectorAll('.recipe-ing-input');
    const items = Array.from(inputs).map(i => i.value).filter(v => v !== "");

    if (!name || items.length === 0) return alert("Please add a name and ingredients.");

    const { data: r } = await pantryDb.from('recipes').insert([{ household_id: household.id, name }]).select().single();
    
    for (const item of items) {
        await pantryDb.from('recipe_items').insert([{ recipe_id: r.id, item_name: item }]);
    }

    window.closeRecipeModal();
    fetchData();
};

window.renderRecipes = () => {
    document.getElementById('recipe-list').innerHTML = recipes.map(r => `
        <div class="bg-white dark:bg-gray-800 p-6 rounded-[2.5rem] border dark:border-gray-700 shadow-sm relative">
            <h4 class="font-black mb-1">${r.name}</h4>
            <p class="text-[10px] text-gray-400 font-bold uppercase mb-4">${r.recipe_items.length} Ingredients</p>
            <button onclick="window.addRecipeToShop('${r.id}')" class="w-full py-3 bg-pink-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest">Add to Shop List</button>
            <button onclick="window.deleteRecipe('${r.id}')" class="absolute top-6 right-6 text-gray-300"><i class="fas fa-trash text-xs"></i></button>
        </div>
    `).join('');
};

window.addRecipeToShop = async (id) => {
    const r = recipes.find(x => x.id === id);
    for (const item of r.recipe_items) {
        const existing = inventory.find(i => i.name.toLowerCase() === item.item_name.toLowerCase());
        if (existing) {
            await pantryDb.from('inventory').update({ qty: 0, checked: false }).eq('id', existing.id);
        } else {
            await pantryDb.from('inventory').insert([{ 
                household_id: household.id, 
                name: item.item_name, 
                qty: 0, 
                min: 1, 
                category: categories[0]?.name || 'Pantry' 
            }]);
        }
    }
    alert("Ingredients added to shopping list!");
    fetchData();
};

window.deleteRecipe = async (id) => {
    if (confirm("Delete this recipe kit?")) {
        await pantryDb.from('recipes').delete().eq('id', id);
        fetchData();
    }
};

// --- ITEM FORM SAVE FIX ---
document.getElementById('item-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('modal-item-id').value;
    
    let itemData = {
        household_id: household.id,
        name: document.getElementById('modal-item-name').value,
        price: parseFloat(document.getElementById('modal-item-price').value) || 0,
        qty: parseInt(document.getElementById('modal-item-qty').value) || 0,
        min: parseInt(document.getElementById('modal-item-min').value) || 1,
        category: document.getElementById('modal-item-category').value
    };

    // Merge in Barcode/Nutrition data if this was a fresh scan
    if (!id && lastScanData) {
        itemData = { ...itemData, ...lastScanData };
    }

    if (id) {
        await pantryDb.from('inventory').update(itemData).eq('id', id);
    } else {
        await pantryDb.from('inventory').insert([itemData]);
    }

    lastScanData = null; // Clear scan memory
    window.closeItemModal();
    fetchData();
};

// ... Rest of the stable UI rendering logic ...
init();
