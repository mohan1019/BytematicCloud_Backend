const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/folder/:folderId', authenticateToken, async (req, res) => {
  try {
    const { folderId } = req.params;
    const { email, permission_type } = req.body;

    if (!email || !permission_type) {
      return res.status(400).json({ error: 'Email and permission type are required' });
    }

    if (!['view', 'create', 'edit'].includes(permission_type)) {
      return res.status(400).json({ error: 'Invalid permission type' });
    }

    const folderResult = await pool.query(
      'SELECT user_id FROM folders WHERE id = $1',
      [folderId]
    );

    if (folderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    if (folderResult.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Only folder owners can share folders' });
    }

    const userResult = await pool.query(
      'SELECT id, name, email FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found with this email' });
    }

    const sharedWithUser = userResult.rows[0];

    if (sharedWithUser.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot share folder with yourself' });
    }

    const existingPermission = await pool.query(
      'SELECT * FROM permissions WHERE folder_id = $1 AND shared_with_user_id = $2',
      [folderId, sharedWithUser.id]
    );

    if (existingPermission.rows.length > 0) {
      const result = await pool.query(`
        UPDATE permissions 
        SET permission_type = $1, granted_by_user_id = $2
        WHERE folder_id = $3 AND shared_with_user_id = $4
        RETURNING *
      `, [permission_type, req.user.id, folderId, sharedWithUser.id]);

      return res.json({
        message: 'Folder permission updated successfully',
        permission: result.rows[0],
        shared_with: {
          id: sharedWithUser.id,
          name: sharedWithUser.name,
          email: sharedWithUser.email
        }
      });
    }

    const result = await pool.query(`
      INSERT INTO permissions (folder_id, shared_with_user_id, permission_type, granted_by_user_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [folderId, sharedWithUser.id, permission_type, req.user.id]);

    res.status(201).json({
      message: 'Folder shared successfully',
      permission: result.rows[0],
      shared_with: {
        id: sharedWithUser.id,
        name: sharedWithUser.name,
        email: sharedWithUser.email
      }
    });
  } catch (error) {
    console.error('Share folder error:', error);
    res.status(500).json({ error: 'Failed to share folder' });
  }
});

router.get('/folder/:folderId', authenticateToken, async (req, res) => {
  try {
    const { folderId } = req.params;

    const folderResult = await pool.query(
      'SELECT user_id FROM folders WHERE id = $1',
      [folderId]
    );

    if (folderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    if (folderResult.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Only folder owners can view sharing settings' });
    }

    const result = await pool.query(`
      SELECT p.*, u.name, u.email, granter.name as granted_by_name
      FROM permissions p
      JOIN users u ON p.shared_with_user_id = u.id
      JOIN users granter ON p.granted_by_user_id = granter.id
      WHERE p.folder_id = $1
      ORDER BY p.created_at DESC
    `, [folderId]);

    res.json({
      permissions: result.rows
    });
  } catch (error) {
    console.error('Get folder permissions error:', error);
    res.status(500).json({ error: 'Failed to retrieve folder permissions' });
  }
});

router.delete('/folder/:folderId/user/:userId', authenticateToken, async (req, res) => {
  try {
    const { folderId, userId } = req.params;

    const folderResult = await pool.query(
      'SELECT user_id FROM folders WHERE id = $1',
      [folderId]
    );

    if (folderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    if (folderResult.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Only folder owners can revoke permissions' });
    }

    const deleteResult = await pool.query(
      'DELETE FROM permissions WHERE folder_id = $1 AND shared_with_user_id = $2',
      [folderId, userId]
    );

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ error: 'Permission not found' });
    }

    res.json({ message: 'Folder access revoked successfully' });
  } catch (error) {
    console.error('Revoke folder access error:', error);
    res.status(500).json({ error: 'Failed to revoke folder access' });
  }
});

router.get('/shared-with-me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT f.*, p.permission_type, p.created_at as shared_at, u.name as owner_name, u.email as owner_email
      FROM folders f
      JOIN permissions p ON f.id = p.folder_id
      JOIN users u ON f.user_id = u.id
      WHERE p.shared_with_user_id = $1
      ORDER BY p.created_at DESC
    `, [req.user.id]);

    res.json({
      shared_folders: result.rows
    });
  } catch (error) {
    console.error('Get shared folders error:', error);
    res.status(500).json({ error: 'Failed to retrieve shared folders' });
  }
});

module.exports = router;