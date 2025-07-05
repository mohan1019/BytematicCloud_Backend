const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, parent_folder_id } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    if (parent_folder_id) {
      const parentResult = await pool.query(
        'SELECT user_id FROM folders WHERE id = $1',
        [parent_folder_id]
      );

      if (parentResult.rows.length === 0) {
        return res.status(404).json({ error: 'Parent folder not found' });
      }

      if (parentResult.rows[0].user_id !== req.user.id) {
        const permissionResult = await pool.query(
          'SELECT permission_type FROM permissions WHERE folder_id = $1 AND shared_with_user_id = $2',
          [parent_folder_id, req.user.id]
        );

        if (permissionResult.rows.length === 0 || 
            !['create', 'edit'].includes(permissionResult.rows[0].permission_type)) {
          return res.status(403).json({ error: 'Insufficient permissions to create folder here' });
        }
      }
    }

    const existingFolder = await pool.query(
      'SELECT id FROM folders WHERE name = $1 AND user_id = $2 AND parent_folder_id = $3',
      [name.trim(), req.user.id, parent_folder_id || null]
    );

    if (existingFolder.rows.length > 0) {
      return res.status(400).json({ error: 'Folder with this name already exists' });
    }

    const result = await pool.query(`
      INSERT INTO folders (user_id, name, parent_folder_id)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [req.user.id, name.trim(), parent_folder_id || null]);

    res.status(201).json({
      message: 'Folder created successfully',
      folder: result.rows[0]
    });
  } catch (error) {
    console.error('Create folder error:', error);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { parent_folder_id } = req.query;

    let query = `
      SELECT f.*, 
             CASE WHEN f.user_id = $1 THEN 'owner' ELSE p.permission_type END as access_level,
             COUNT(sub.id) as subfolder_count,
             COUNT(files.id) as file_count
      FROM folders f
      LEFT JOIN permissions p ON f.id = p.folder_id AND p.shared_with_user_id = $1
      LEFT JOIN folders sub ON f.id = sub.parent_folder_id
      LEFT JOIN files ON f.id = files.folder_id
      WHERE (f.user_id = $1 OR p.shared_with_user_id = $1)
    `;
    let params = [req.user.id];

    if (parent_folder_id) {
      query += ' AND f.parent_folder_id = $2';
      params.push(parent_folder_id);
    } else {
      query += ' AND f.parent_folder_id IS NULL';
    }

    query += ' GROUP BY f.id, p.permission_type ORDER BY f.created_at DESC';

    const result = await pool.query(query, params);

    res.json({
      folders: result.rows
    });
  } catch (error) {
    console.error('Get folders error:', error);
    res.status(500).json({ error: 'Failed to retrieve folders' });
  }
});

router.get('/:folderId', authenticateToken, async (req, res) => {
  try {
    const { folderId } = req.params;

    const result = await pool.query(`
      SELECT f.*, 
             CASE WHEN f.user_id = $1 THEN 'owner' ELSE p.permission_type END as access_level,
             COUNT(sub.id) as subfolder_count,
             COUNT(files.id) as file_count
      FROM folders f
      LEFT JOIN permissions p ON f.id = p.folder_id AND p.shared_with_user_id = $1
      LEFT JOIN folders sub ON f.id = sub.parent_folder_id
      LEFT JOIN files ON f.id = files.folder_id
      WHERE f.id = $2 AND (f.user_id = $1 OR p.shared_with_user_id = $1)
      GROUP BY f.id, p.permission_type
    `, [req.user.id, folderId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Folder not found or access denied' });
    }

    res.json({
      folder: result.rows[0]
    });
  } catch (error) {
    console.error('Get folder error:', error);
    res.status(500).json({ error: 'Failed to retrieve folder' });
  }
});

router.put('/:folderId', authenticateToken, async (req, res) => {
  try {
    const { folderId } = req.params;
    const { name } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    const folderResult = await pool.query(`
      SELECT f.*, 
             CASE WHEN f.user_id = $1 THEN 'owner' ELSE p.permission_type END as access_level
      FROM folders f
      LEFT JOIN permissions p ON f.id = p.folder_id AND p.shared_with_user_id = $1
      WHERE f.id = $2 AND (f.user_id = $1 OR p.shared_with_user_id = $1)
    `, [req.user.id, folderId]);

    if (folderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Folder not found or access denied' });
    }

    const folder = folderResult.rows[0];

    if (folder.access_level !== 'owner' && folder.access_level !== 'edit') {
      return res.status(403).json({ error: 'Insufficient permissions to rename this folder' });
    }

    const result = await pool.query(
      'UPDATE folders SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [name.trim(), folderId]
    );

    res.json({
      message: 'Folder updated successfully',
      folder: result.rows[0]
    });
  } catch (error) {
    console.error('Update folder error:', error);
    res.status(500).json({ error: 'Failed to update folder' });
  }
});

router.delete('/:folderId', authenticateToken, async (req, res) => {
  try {
    const { folderId } = req.params;

    const folderResult = await pool.query(`
      SELECT f.*, 
             CASE WHEN f.user_id = $1 THEN 'owner' ELSE p.permission_type END as access_level
      FROM folders f
      LEFT JOIN permissions p ON f.id = p.folder_id AND p.shared_with_user_id = $1
      WHERE f.id = $2 AND (f.user_id = $1 OR p.shared_with_user_id = $1)
    `, [req.user.id, folderId]);

    if (folderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Folder not found or access denied' });
    }

    const folder = folderResult.rows[0];

    if (folder.access_level !== 'owner') {
      return res.status(403).json({ error: 'Only folder owners can delete folders' });
    }

    const subfolderCount = await pool.query(
      'SELECT COUNT(*) as count FROM folders WHERE parent_folder_id = $1',
      [folderId]
    );

    const fileCount = await pool.query(
      'SELECT COUNT(*) as count FROM files WHERE folder_id = $1',
      [folderId]
    );

    if (parseInt(subfolderCount.rows[0].count) > 0 || parseInt(fileCount.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete folder that contains files or subfolders' });
    }

    await pool.query('DELETE FROM permissions WHERE folder_id = $1', [folderId]);
    await pool.query('DELETE FROM folders WHERE id = $1', [folderId]);

    res.json({ message: 'Folder deleted successfully' });
  } catch (error) {
    console.error('Delete folder error:', error);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// Bulk delete folders
router.delete('/bulk', authenticateToken, async (req, res) => {
  try {
    const { folderIds } = req.body;

    if (!Array.isArray(folderIds) || folderIds.length === 0) {
      return res.status(400).json({ error: 'folderIds must be a non-empty array' });
    }

    const placeholders = folderIds.map((_, index) => `$${index + 2}`).join(',');
    const folderResults = await pool.query(`
      SELECT f.*, 
             CASE WHEN f.user_id = $1 THEN 'owner' ELSE p.permission_type END as access_level
      FROM folders f
      LEFT JOIN permissions p ON f.id = p.folder_id AND p.shared_with_user_id = $1
      WHERE f.id IN (${placeholders}) AND (f.user_id = $1 OR p.shared_with_user_id = $1)
    `, [req.user.id, ...folderIds]);

    const foundFolders = folderResults.rows;
    const notFoundIds = folderIds.filter(id => !foundFolders.find(f => f.id === parseInt(id)));
    const unauthorizedFolders = foundFolders.filter(f => f.access_level !== 'owner');
    const deletableFolders = foundFolders.filter(f => f.access_level === 'owner');

    if (unauthorizedFolders.length > 0) {
      return res.status(403).json({ 
        error: 'Only folder owners can delete folders',
        unauthorizedFolders: unauthorizedFolders.map(f => ({ id: f.id, name: f.name }))
      });
    }

    const results = {
      deleted: [],
      failed: [],
      notFound: notFoundIds,
      nonEmpty: []
    };

    for (const folder of deletableFolders) {
      try {
        const subfolderCount = await pool.query(
          'SELECT COUNT(*) as count FROM folders WHERE parent_folder_id = $1',
          [folder.id]
        );

        const fileCount = await pool.query(
          'SELECT COUNT(*) as count FROM files WHERE folder_id = $1',
          [folder.id]
        );

        if (parseInt(subfolderCount.rows[0].count) > 0 || parseInt(fileCount.rows[0].count) > 0) {
          results.nonEmpty.push({ id: folder.id, name: folder.name });
          continue;
        }

        await pool.query('DELETE FROM permissions WHERE folder_id = $1', [folder.id]);
        await pool.query('DELETE FROM folders WHERE id = $1', [folder.id]);
        results.deleted.push({ id: folder.id, name: folder.name });
      } catch (error) {
        console.error(`Failed to delete folder ${folder.id}:`, error);
        results.failed.push({ id: folder.id, name: folder.name, error: error.message });
      }
    }

    res.json({
      message: `Bulk delete completed. ${results.deleted.length} folders deleted.`,
      results
    });
  } catch (error) {
    console.error('Bulk delete folders error:', error);
    res.status(500).json({ error: 'Failed to bulk delete folders' });
  }
});

// Mixed bulk delete (files and folders)
router.delete('/bulk/mixed', authenticateToken, async (req, res) => {
  try {
    const { fileIds = [], folderIds = [] } = req.body;

    if ((!Array.isArray(fileIds) && !Array.isArray(folderIds)) || 
        (fileIds.length === 0 && folderIds.length === 0)) {
      return res.status(400).json({ error: 'At least one of fileIds or folderIds must be a non-empty array' });
    }

    const results = {
      files: { deleted: [], failed: [], notFound: [], unauthorized: [] },
      folders: { deleted: [], failed: [], notFound: [], unauthorized: [], nonEmpty: [] }
    };

    // Process files if provided
    if (fileIds.length > 0) {
      const filePlaceholders = fileIds.map((_, index) => `$${index + 2}`).join(',');
      const fileResults = await pool.query(`
        SELECT f.*, 
               CASE WHEN f.user_id = $1 THEN 'owner' ELSE p.permission_type END as access_level
        FROM files f
        LEFT JOIN permissions p ON f.folder_id = p.folder_id AND p.shared_with_user_id = $1
        WHERE f.id IN (${filePlaceholders}) AND (f.user_id = $1 OR p.shared_with_user_id = $1)
      `, [req.user.id, ...fileIds]);

      const foundFiles = fileResults.rows;
      results.files.notFound = fileIds.filter(id => !foundFiles.find(f => f.id === parseInt(id)));
      const unauthorizedFiles = foundFiles.filter(f => f.access_level !== 'owner' && f.access_level !== 'edit');
      const deletableFiles = foundFiles.filter(f => f.access_level === 'owner' || f.access_level === 'edit');

      results.files.unauthorized = unauthorizedFiles.map(f => ({ id: f.id, name: f.original_name }));

      for (const file of deletableFiles) {
        try {
          const backblazeService = require('../services/backblaze');
          try {
            await backblazeService.deleteFile(file.backblaze_file_id, file.name);
          } catch (b2Error) {
            console.error(`Backblaze deletion error for file ${file.id}:`, b2Error);
          }

          await pool.query('DELETE FROM files WHERE id = $1', [file.id]);
          results.files.deleted.push({ id: file.id, name: file.original_name });
        } catch (error) {
          console.error(`Failed to delete file ${file.id}:`, error);
          results.files.failed.push({ id: file.id, name: file.original_name, error: error.message });
        }
      }
    }

    // Process folders if provided
    if (folderIds.length > 0) {
      const folderPlaceholders = folderIds.map((_, index) => `$${index + 2}`).join(',');
      const folderResults = await pool.query(`
        SELECT f.*, 
               CASE WHEN f.user_id = $1 THEN 'owner' ELSE p.permission_type END as access_level
        FROM folders f
        LEFT JOIN permissions p ON f.id = p.folder_id AND p.shared_with_user_id = $1
        WHERE f.id IN (${folderPlaceholders}) AND (f.user_id = $1 OR p.shared_with_user_id = $1)
      `, [req.user.id, ...folderIds]);

      const foundFolders = folderResults.rows;
      results.folders.notFound = folderIds.filter(id => !foundFolders.find(f => f.id === parseInt(id)));
      const unauthorizedFolders = foundFolders.filter(f => f.access_level !== 'owner');
      const deletableFolders = foundFolders.filter(f => f.access_level === 'owner');

      results.folders.unauthorized = unauthorizedFolders.map(f => ({ id: f.id, name: f.name }));

      for (const folder of deletableFolders) {
        try {
          const subfolderCount = await pool.query(
            'SELECT COUNT(*) as count FROM folders WHERE parent_folder_id = $1',
            [folder.id]
          );

          const fileCount = await pool.query(
            'SELECT COUNT(*) as count FROM files WHERE folder_id = $1',
            [folder.id]
          );

          if (parseInt(subfolderCount.rows[0].count) > 0 || parseInt(fileCount.rows[0].count) > 0) {
            results.folders.nonEmpty.push({ id: folder.id, name: folder.name });
            continue;
          }

          await pool.query('DELETE FROM permissions WHERE folder_id = $1', [folder.id]);
          await pool.query('DELETE FROM folders WHERE id = $1', [folder.id]);
          results.folders.deleted.push({ id: folder.id, name: folder.name });
        } catch (error) {
          console.error(`Failed to delete folder ${folder.id}:`, error);
          results.folders.failed.push({ id: folder.id, name: folder.name, error: error.message });
        }
      }
    }

    const totalDeleted = results.files.deleted.length + results.folders.deleted.length;
    const hasUnauthorized = results.files.unauthorized.length > 0 || results.folders.unauthorized.length > 0;

    if (hasUnauthorized) {
      return res.status(403).json({
        error: 'Insufficient permissions for some items',
        results
      });
    }

    res.json({
      message: `Bulk delete completed. ${totalDeleted} items deleted.`,
      results
    });
  } catch (error) {
    console.error('Mixed bulk delete error:', error);
    res.status(500).json({ error: 'Failed to bulk delete items' });
  }
});

module.exports = router;