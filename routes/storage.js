const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get user storage statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    // Get user's current storage quota and usage
    const userResult = await pool.query(
      'SELECT storage_quota, storage_used FROM users WHERE id = $1',
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { storage_quota, storage_used } = userResult.rows[0];

    // Calculate actual storage used by summing file sizes
    const actualUsageResult = await pool.query(
      'SELECT COALESCE(SUM(size), 0) as actual_used FROM files WHERE user_id = $1',
      [req.user.id]
    );

    const actualUsed = parseInt(actualUsageResult.rows[0].actual_used);

    // Update user's storage_used if it's different (sync with actual usage)
    if (actualUsed !== parseInt(storage_used)) {
      await pool.query(
        'UPDATE users SET storage_used = $1 WHERE id = $2',
        [actualUsed, req.user.id]
      );
    }

    // Get file count and breakdown by type
    const fileStatsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_files,
        SUM(CASE WHEN mime_type LIKE 'image/%' THEN size ELSE 0 END) as images_size,
        SUM(CASE WHEN mime_type LIKE 'video/%' THEN size ELSE 0 END) as videos_size,
        SUM(CASE WHEN mime_type LIKE 'audio/%' THEN size ELSE 0 END) as audio_size,
        SUM(CASE WHEN mime_type = 'application/pdf' OR mime_type LIKE '%document%' OR mime_type LIKE '%sheet%' OR mime_type LIKE '%presentation%' THEN size ELSE 0 END) as documents_size,
        SUM(CASE WHEN mime_type LIKE 'application/zip%' OR mime_type LIKE 'application/x-%' THEN size ELSE 0 END) as archives_size,
        COUNT(CASE WHEN mime_type LIKE 'image/%' THEN 1 END) as images_count,
        COUNT(CASE WHEN mime_type LIKE 'video/%' THEN 1 END) as videos_count,
        COUNT(CASE WHEN mime_type LIKE 'audio/%' THEN 1 END) as audio_count,
        COUNT(CASE WHEN mime_type = 'application/pdf' OR mime_type LIKE '%document%' OR mime_type LIKE '%sheet%' OR mime_type LIKE '%presentation%' THEN 1 END) as documents_count,
        COUNT(CASE WHEN mime_type LIKE 'application/zip%' OR mime_type LIKE 'application/x-%' THEN 1 END) as archives_count
      FROM files 
      WHERE user_id = $1
    `, [req.user.id]);

    const fileStats = fileStatsResult.rows[0];

    // Calculate other files (not in main categories)
    const otherSize = actualUsed - (
      parseInt(fileStats.images_size || 0) +
      parseInt(fileStats.videos_size || 0) +
      parseInt(fileStats.audio_size || 0) +
      parseInt(fileStats.documents_size || 0) +
      parseInt(fileStats.archives_size || 0)
    );

    const otherCount = parseInt(fileStats.total_files) - (
      parseInt(fileStats.images_count || 0) +
      parseInt(fileStats.videos_count || 0) +
      parseInt(fileStats.audio_count || 0) +
      parseInt(fileStats.documents_count || 0) +
      parseInt(fileStats.archives_count || 0)
    );

    // Get recent coupon redemptions
    const couponsResult = await pool.query(`
      SELECT c.code, c.name, cr.storage_granted, cr.redeemed_at 
      FROM coupon_redemptions cr
      JOIN coupons c ON cr.coupon_id = c.id
      WHERE cr.user_id = $1
      ORDER BY cr.redeemed_at DESC
      LIMIT 5
    `, [req.user.id]);

    res.json({
      storage: {
        quota: parseInt(storage_quota),
        used: actualUsed,
        available: parseInt(storage_quota) - actualUsed,
        percentage: Math.round((actualUsed / parseInt(storage_quota)) * 100)
      },
      files: {
        total: parseInt(fileStats.total_files),
        breakdown: {
          images: {
            count: parseInt(fileStats.images_count || 0),
            size: parseInt(fileStats.images_size || 0)
          },
          videos: {
            count: parseInt(fileStats.videos_count || 0),
            size: parseInt(fileStats.videos_size || 0)
          },
          audio: {
            count: parseInt(fileStats.audio_count || 0),
            size: parseInt(fileStats.audio_size || 0)
          },
          documents: {
            count: parseInt(fileStats.documents_count || 0),
            size: parseInt(fileStats.documents_size || 0)
          },
          archives: {
            count: parseInt(fileStats.archives_count || 0),
            size: parseInt(fileStats.archives_size || 0)
          },
          other: {
            count: Math.max(0, otherCount),
            size: Math.max(0, otherSize)
          }
        }
      },
      coupons: couponsResult.rows.map(row => ({
        code: row.code,
        name: row.name,
        storageGranted: parseInt(row.storage_granted),
        redeemedAt: row.redeemed_at
      }))
    });

  } catch (error) {
    console.error('Storage stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Redeem a coupon
router.post('/redeem-coupon', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Coupon code is required' });
    }

    // Start transaction
    await pool.query('BEGIN');

    try {
      // Check if coupon exists and is valid
      const couponResult = await pool.query(`
        SELECT * FROM coupons 
        WHERE code = $1 
          AND is_active = TRUE 
          AND (expires_at IS NULL OR expires_at > NOW())
          AND current_uses < max_uses
      `, [code.toUpperCase()]);

      if (couponResult.rows.length === 0) {
        await pool.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid or expired coupon code' });
      }

      const coupon = couponResult.rows[0];

      // Check if user has already redeemed this coupon
      const redemptionCheck = await pool.query(
        'SELECT id FROM coupon_redemptions WHERE user_id = $1 AND coupon_id = $2',
        [req.user.id, coupon.id]
      );

      if (redemptionCheck.rows.length > 0) {
        await pool.query('ROLLBACK');
        return res.status(400).json({ error: 'You have already redeemed this coupon' });
      }

      // Update user's storage quota
      await pool.query(
        'UPDATE users SET storage_quota = storage_quota + $1 WHERE id = $2',
        [coupon.storage_bonus, req.user.id]
      );

      // Record the redemption
      await pool.query(
        'INSERT INTO coupon_redemptions (user_id, coupon_id, storage_granted) VALUES ($1, $2, $3)',
        [req.user.id, coupon.id, coupon.storage_bonus]
      );

      // Update coupon usage count
      await pool.query(
        'UPDATE coupons SET current_uses = current_uses + 1 WHERE id = $1',
        [coupon.id]
      );

      await pool.query('COMMIT');

      // Format storage bonus for response
      const formatBytes = (bytes) => {
        const gb = bytes / (1024 * 1024 * 1024);
        return gb >= 1 ? `${Math.round(gb)}GB` : `${Math.round(bytes / (1024 * 1024))}MB`;
      };

      res.json({
        message: 'Coupon redeemed successfully!',
        storageGranted: coupon.storage_bonus,
        storageGrantedFormatted: formatBytes(coupon.storage_bonus),
        couponCode: coupon.code,
        couponName: coupon.name
      });

    } catch (innerError) {
      await pool.query('ROLLBACK');
      throw innerError;
    }

  } catch (error) {
    console.error('Coupon redemption error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Note: Removed public coupon listing endpoint to keep coupons private

module.exports = router;