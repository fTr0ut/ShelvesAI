const { query, transaction } = require('../pg');

/**
 * Find user by email
 */
async function findByEmail(email) {
    const result = await query(
        'SELECT * FROM users WHERE email = $1',
        [email.toLowerCase()]
    );
    return result.rows[0] || null;
}

/**
 * Find user by ID
 */
async function findById(id) {
    const result = await query(
        'SELECT * FROM users WHERE id = $1',
        [id]
    );
    return result.rows[0] || null;
}

/**
 * Find user by username
 */
async function findByUsername(username) {
    const result = await query(
        'SELECT * FROM users WHERE username = $1',
        [username.toLowerCase()]
    );
    return result.rows[0] || null;
}

/**
 * Create new user
 */
async function create({ email, passwordHash, username }) {
    const result = await query(
        `INSERT INTO users (email, password_hash, username)
     VALUES ($1, $2, $3)
     RETURNING *`,
        [email.toLowerCase(), passwordHash, username?.toLowerCase() || null]
    );
    return result.rows[0];
}

/**
 * Update user profile
 */
async function updateProfile(id, updates) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    const allowedFields = [
        'username', 'first_name', 'last_name', 'phone_number',
        'picture', 'country', 'state', 'city', 'is_private', 'bio', 'email'
    ];

    for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
            fields.push(`${key} = $${paramIndex}`);
            values.push(value);
            paramIndex++;
        }
    }

    if (fields.length === 0) return findById(id);

    values.push(id);
    const result = await query(
        `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
    );
    return result.rows[0];
}

/**
 * Update onboarding completion flag
 */
async function setOnboardingCompleted(id, value) {
    const result = await query(
        `UPDATE users SET onboarding_completed = $1 WHERE id = $2 RETURNING *`,
        [value, id]
    );
    return result.rows[0] || null;
}

/**
 * Get public profile by username (respects privacy settings)
 * @param {string} username - Username to look up
 * @param {string|null} viewerId - ID of the viewer (null if unauthenticated)
 */
async function getPublicProfile(username, viewerId = null) {
    // First get the user's basic info
    const userResult = await query(
        `SELECT u.id, u.username, u.first_name, u.last_name, u.bio, 
                u.picture, u.city, u.state, u.country, u.is_private, u.created_at,
                pm.local_path as profile_media_path
         FROM users u
         LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
         WHERE LOWER(u.username) = LOWER($1)`,
        [username]
    );

    if (userResult.rows.length === 0) {
        return null;
    }

    const user = userResult.rows[0];

    // Check if viewer is the owner
    const isOwner = viewerId && user.id === viewerId;

    // Check if they're friends
    let isFriend = false;
    let friendshipId = null;
    if (viewerId && !isOwner) {
        const friendResult = await query(
            `SELECT id FROM friendships 
             WHERE status = 'accepted' 
             AND ((requester_id = $1 AND addressee_id = $2)
                  OR (requester_id = $2 AND addressee_id = $1))`,
            [user.id, viewerId]
        );
        if (friendResult.rows.length > 0) {
            isFriend = true;
            friendshipId = friendResult.rows[0].id;
        }
    }

    // Get shelf count (visible shelves only)
    let shelfCountQuery;
    if (isOwner) {
        shelfCountQuery = await query(
            `SELECT COUNT(*) as count FROM shelves WHERE owner_id = $1`,
            [user.id]
        );
    } else if (isFriend) {
        shelfCountQuery = await query(
            `SELECT COUNT(*) as count FROM shelves 
             WHERE owner_id = $1 AND visibility IN ('public', 'friends')`,
            [user.id]
        );
    } else {
        shelfCountQuery = await query(
            `SELECT COUNT(*) as count FROM shelves 
             WHERE owner_id = $1 AND visibility = 'public'`,
            [user.id]
        );
    }

    const shelfCount = parseInt(shelfCountQuery.rows[0]?.count || 0);

    // If private and not owner/friend, return limited info
    if (user.is_private && !isOwner && !isFriend) {
        return {
            id: user.id,
            username: user.username,
            picture: user.picture,
            profileMediaPath: user.profile_media_path,
            isPrivate: true,
            isOwner: false,
            isFriend: false,
            friendshipId: null,
            shelfCount: 0,
        };
    }

    return {
        id: user.id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        bio: user.bio,
        picture: user.picture,
        profileMediaPath: user.profile_media_path,
        city: user.city,
        state: user.state,
        country: user.country,
        isPrivate: user.is_private,
        createdAt: user.created_at,
        isOwner,
        isFriend,
        friendshipId,
        shelfCount,
    };
}

/**
 * Get full profile for owner
 */
async function getFullProfile(userId) {
    const result = await query(
        `SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.phone_number,
                u.picture, u.country, u.state, u.city, u.is_private, u.bio,
                u.onboarding_completed, u.created_at, u.updated_at,
                pm.local_path as profile_media_path
         FROM users u
         LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
         WHERE u.id = $1`,
        [userId]
    );
    return result.rows[0] || null;
}

module.exports = {
    findByEmail,
    findById,
    findByUsername,
    create,
    updateProfile,
    setOnboardingCompleted,
    getPublicProfile,
    getFullProfile,
};
