/**
 * Discover Controller
 *
 * Handles requests for the personalized news/discover feed,
 * returning trending, upcoming, and recent content from the news_items cache.
 */

const { query } = require('../database/pg');
const { markNewsItemDismissed } = require('../database/queries/newsDismissed');

/**
 * GET /api/discover
 *
 * Returns personalized news/trending items based on user's collection.
 *
 * Query params:
 *   - category: 'movies' | 'tv' | 'games' | 'books' | 'all' (default: 'all')
 *   - item_type: 'trending' | 'upcoming' | 'now_playing' | 'recent' | 'all' (default: 'all')
 *   - limit: number (default: 50, max: 100)
 *   - offset: number (default: 0)
 */
async function getDiscover(req, res) {
  try {
    const userId = req.user?.id;
    const {
      category = 'all',
      item_type = 'all',
      limit = 50,
      offset = 0
    } = req.query;

    const safeLimit = Math.min(Math.max(1, parseInt(limit) || 50), 100);
    const safeOffset = Math.max(0, parseInt(offset) || 0);

    // Get user's shelf types and top creators for personalization
    let userInterests = { categories: [], creators: [], genres: [] };

    if (userId) {
      const interestsResult = await query(`
        SELECT DISTINCT
          s.type as category,
          c.primary_creator,
          unnest(c.tags) as genre
        FROM user_collections uc
        JOIN shelves s ON s.id = uc.shelf_id
        LEFT JOIN collectables c ON c.id = uc.collectable_id
        WHERE uc.user_id = $1
          AND c.id IS NOT NULL
      `, [userId]);

      // Extract unique values
      const categories = new Set();
      const creators = new Set();
      const genres = new Set();

      for (const row of interestsResult.rows) {
        if (row.category) categories.add(row.category);
        if (row.primary_creator) creators.add(row.primary_creator);
        if (row.genre) genres.add(row.genre);
      }

      userInterests = {
        categories: Array.from(categories),
        creators: Array.from(creators).slice(0, 50), // Limit to top 50
        genres: Array.from(genres).slice(0, 30) // Limit to top 30
      };
    }

    // Build query with optional filtering
    const conditions = ['expires_at > NOW()'];
    const params = [];
    let paramIndex = 1;

    if (category !== 'all') {
      conditions.push(`category = $${paramIndex++}`);
      params.push(category);
    }

    if (item_type !== 'all') {
      conditions.push(`item_type = $${paramIndex++}`);
      params.push(item_type);
    }
    if (userId) {
      conditions.push(`news_items.id NOT IN (SELECT news_item_id FROM user_news_dismissed WHERE user_id = $${paramIndex++})`);
      params.push(userId);
    }

    // When fetching all categories, use window function to get balanced results per category/type
    // This ensures each category+item_type combination gets represented
    const isAllCategories = category === 'all';
    // With ~9 category+item_type combinations (3 categories * ~3 types), divide limit accordingly
    // Cap at 15 items per group for reasonable mobile performance
    const itemsPerGroup = isAllCategories ? Math.min(15, Math.ceil(safeLimit / 9)) : safeLimit;

    let sql;
    if (isAllCategories && item_type === 'all') {
      // Balanced query: get top N items per category+item_type combination
      // This ensures each category gets fair representation in the results
      const p1 = paramIndex++;     // categories for SELECT
      const p2 = paramIndex++;     // creators for SELECT
      const p3 = paramIndex++;     // genres for SELECT
      const p4 = paramIndex++;     // categories for OVER clause
      const p5 = paramIndex++;     // creators for OVER clause
      const p6 = paramIndex++;     // genres for OVER clause
      const p7 = paramIndex++;     // itemsPerGroup limit

      sql = `
        WITH ranked AS (
          SELECT
            id, category, item_type, title, description, cover_image_url,
            release_date, physical_release_date, creators, genres, external_id, source_api, source_url,
            payload, fetched_at,
            -- Personalization score
            CASE WHEN category = ANY($${p1}) THEN 2 ELSE 0 END +
            CASE WHEN creators && $${p2} THEN 3 ELSE 0 END +
            CASE WHEN genres && $${p3} THEN 1 ELSE 0 END +
            COALESCE(votes, 0)
            AS relevance_score,
            ROW_NUMBER() OVER (
              PARTITION BY category, item_type
              ORDER BY
                CASE WHEN category = ANY($${p4}) THEN 2 ELSE 0 END +
                CASE WHEN creators && $${p5} THEN 3 ELSE 0 END +
                CASE WHEN genres && $${p6} THEN 1 ELSE 0 END +
                COALESCE(votes, 0) DESC,
                (payload->>'popularity')::float DESC NULLS LAST,
                release_date DESC NULLS LAST
            ) as rn
          FROM news_items
          WHERE ${conditions.join(' AND ')}
        )
        SELECT * FROM ranked
        WHERE rn <= $${p7}
        ORDER BY
          category,
          CASE item_type
            WHEN 'trending' THEN 1
            WHEN 'upcoming' THEN 2
            WHEN 'now_playing' THEN 3
            WHEN 'recent' THEN 4
            ELSE 5
          END,
          relevance_score DESC,
          (payload->>'popularity')::float DESC NULLS LAST
      `;
      // Push parameters: 3 for SELECT, 3 for OVER clause, 1 for limit
      params.push(
        userInterests.categories,
        userInterests.creators,
        userInterests.genres,
        userInterests.categories,  // Duplicate for OVER clause
        userInterests.creators,    // Duplicate for OVER clause
        userInterests.genres,      // Duplicate for OVER clause
        itemsPerGroup
      );
    } else {
      // Standard query for single category or single item_type
      sql = `
        SELECT
          id, category, item_type, title, description, cover_image_url,
          release_date, physical_release_date, creators, genres, external_id, source_api, source_url,
          payload, fetched_at,
          -- Personalization score
          CASE WHEN category = ANY($${paramIndex++}) THEN 2 ELSE 0 END +
          CASE WHEN creators && $${paramIndex++} THEN 3 ELSE 0 END +
          CASE WHEN genres && $${paramIndex++} THEN 1 ELSE 0 END +
          COALESCE(votes, 0)
          AS relevance_score
        FROM news_items
        WHERE ${conditions.join(' AND ')}
        ORDER BY
          relevance_score DESC,
          CASE item_type
            WHEN 'trending' THEN 1
            WHEN 'upcoming' THEN 2
            WHEN 'now_playing' THEN 3
            WHEN 'recent' THEN 4
            ELSE 5
          END,
          (payload->>'popularity')::float DESC NULLS LAST,
          release_date DESC NULLS LAST
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;
      params.push(
        userInterests.categories,
        userInterests.creators,
        userInterests.genres,
        safeLimit,
        safeOffset
      );
    }

    const result = await query(sql, params);

    // Group items by category and type for frontend convenience
    const grouped = {};
    for (const row of result.rows) {
      if (!grouped[row.category]) {
        grouped[row.category] = {};
      }
      if (!grouped[row.category][row.item_type]) {
        grouped[row.category][row.item_type] = [];
      }
      grouped[row.category][row.item_type].push({
        id: row.id,
        title: row.title,
        description: row.description,
        coverImageUrl: row.cover_image_url,
        releaseDate: row.release_date,
        physicalReleaseDate: row.physical_release_date,
        creators: row.creators,
        genres: row.genres,
        externalId: row.external_id,
        sourceApi: row.source_api,
        sourceUrl: row.source_url,
        payload: row.payload,
        relevanceScore: row.relevance_score
      });
    }

    // Also return flat list for simple rendering
    const items = result.rows.map(row => ({
      id: row.id,
      category: row.category,
      itemType: row.item_type,
      title: row.title,
      description: row.description,
      coverImageUrl: row.cover_image_url,
      releaseDate: row.release_date,
      physicalReleaseDate: row.physical_release_date,
      creators: row.creators,
      genres: row.genres,
      externalId: row.external_id,
      sourceApi: row.source_api,
      sourceUrl: row.source_url,
      payload: row.payload,
      relevanceScore: row.relevance_score
    }));

    res.json({
      success: true,
      data: {
        items,
        grouped,
        userInterests: userId ? {
          categoriesCount: userInterests.categories.length,
          creatorsCount: userInterests.creators.length,
          genresCount: userInterests.genres.length
        } : null,
        pagination: {
          limit: safeLimit,
          offset: safeOffset,
          count: result.rows.length,
          hasMore: result.rows.length === safeLimit
        }
      }
    });

  } catch (err) {
    console.error('[Discover] Error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch discover items'
    });
  }
}

/**
 * GET /api/discover/stats
 *
 * Returns statistics about the news cache.
 */
async function getDiscoverStats(req, res) {
  try {
    const result = await query(`
      SELECT
        category,
        item_type,
        COUNT(*) as count,
        MIN(fetched_at) as oldest_fetch,
        MAX(fetched_at) as newest_fetch
      FROM news_items
      WHERE expires_at > NOW()
      GROUP BY category, item_type
      ORDER BY category, item_type
    `);

    const totalResult = await query(`
      SELECT COUNT(*) as total FROM news_items WHERE expires_at > NOW()
    `);

    res.json({
      success: true,
      data: {
        total: parseInt(totalResult.rows[0]?.total || 0),
        byCategory: result.rows.map(row => ({
          category: row.category,
          itemType: row.item_type,
          count: parseInt(row.count),
          oldestFetch: row.oldest_fetch,
          newestFetch: row.newest_fetch
        }))
      }
    });

  } catch (err) {
    console.error('[Discover] Stats error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch discover stats'
    });
  }
}

/**
 * POST /api/discover/dismiss
 *
 * Marks a discover item as dismissed and applies a negative vote.
 */
async function dismissDiscoverItem(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const rawId = req.body?.newsItemId ?? req.body?.id;
    const newsItemId = Number.parseInt(rawId, 10);
    if (!Number.isFinite(newsItemId)) {
      return res.status(400).json({ success: false, error: 'Invalid news item id' });
    }

    const result = await query(
      `UPDATE news_items
       SET votes = COALESCE(votes, 0) - 1,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, votes`,
      [newsItemId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: 'News item not found' });
    }

    try {
      await markNewsItemDismissed(userId, newsItemId);
    } catch (err) {
      console.warn('[Discover] Failed to mark news item dismissed:', err.message);
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Discover] Dismiss error:', err);
    return res.status(500).json({ success: false, error: 'Failed to dismiss discover item' });
  }
}

module.exports = {
  getDiscover,
  getDiscoverStats,
  dismissDiscoverItem
};
