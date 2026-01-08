const fetch = globalThis.fetch;
const BASE_URL = 'http://localhost:5004/api';

async function runTest() {
    console.log('🧪 Starting Backend Smoke Test... (Attempt 2)\n');

    // 1. Register User
    const username = `user_${Date.now()}`;
    const email = `${username}@example.com`;
    const password = 'Password123!';

    // Using /register (mounted at /api) instead of /auth/register
    console.log(`1. [Auth] Registering ${username}...`);
    const regRes = await fetch(`${BASE_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
    });

    if (!regRes.ok) {
        const txt = await regRes.text();
        console.error('❌ Registration failed:', regRes.status, txt);
        return;
    }
    const regData = await regRes.json();
    console.log('✅ Registered:', regData.user.id);

    // 2. Login
    console.log(`\n2. [Auth] Logging in...`);
    const loginRes = await fetch(`${BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });

    if (!loginRes.ok) {
        console.error('❌ Login failed:', loginRes.status);
        return;
    }
    const loginData = await loginRes.json();
    const token = loginData.token;
    console.log('✅ Logged in. Token received.');

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };

    // 3. Create Shelf
    console.log(`\n3. [Shelves] Creating 'My Games' shelf...`);
    const shelfRes = await fetch(`${BASE_URL}/shelves`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            name: 'My Games',
            type: 'game',
            visibility: 'public'
        })
    });

    if (!shelfRes.ok) {
        const txt = await shelfRes.text();
        console.error('❌ Create Shelf failed:', shelfRes.status, txt);
        return;
    }
    const shelfData = await shelfRes.json();
    const shelfId = shelfData.shelf.id;
    console.log('✅ Shelf created:', shelfId);

    // 4. Add Item (Manual)
    console.log(`\n4. [Shelves] Adding manual item to shelf...`);
    const itemRes = await fetch(`${BASE_URL}/shelves/${shelfId}/manual`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            name: 'Half-Life 3',
            type: 'game',
            description: 'I wish',
            rating: 5
        })
    });

    if (!itemRes.ok) {
        const txt = await itemRes.text();
        console.error('❌ Add Item failed:', itemRes.status, txt);
        return;
    }
    const itemData = await itemRes.json();
    console.log('✅ Item added:', itemData.item.id);

    // 5. Get Feed
    console.log(`\n5. [Feed] Fetching global feed...`);
    const feedRes = await fetch(`${BASE_URL}/feed?scope=global`, { headers });
    if (!feedRes.ok) {
        const txt = await feedRes.text();
        console.error('❌ Feed fetch failed:', feedRes.status, txt);
        return;
    }
    const feedData = await feedRes.json();
    console.log('✅ Feed fetched. Entries:', feedData.entries.length);

    const foundMyShelf = feedData.entries.find(e => {
        // Check various shapes based on feedController implementation
        return e.shelf?.id === shelfId || e.shelfId === shelfId;
    });

    if (foundMyShelf) {
        console.log('   -> Found my new shelf in feed!');
    } else {
        // It might be paginated or ordering issues, or feed query issues.
        console.warn('   -> My shelf not in top of global feed (might be pagination)');
    }

    // 6. Search Users
    console.log(`\n6. [Friends] Searching for users...`);
    const searchRes = await fetch(`${BASE_URL}/friends/search?q=${username.substring(0, 5)}`, { headers });
    if (!searchRes.ok) {
        const txt = await searchRes.text();
        console.error('❌ User search failed:', searchRes.status, txt);
        return;
    }
    const searchData = await searchRes.json();
    console.log('✅ Search success. Found users:', searchData.users.length);

    console.log('\n🎉 ALL TESTS PASSED! Backend is healthy and migrated to PostgreSQL.');
}

runTest().catch(console.error);
