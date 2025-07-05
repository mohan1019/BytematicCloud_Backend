const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const result = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

const checkFolderPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      const folderId = req.params.folderId || req.body.folder_id;
      const userId = req.user.id;

      const folderResult = await pool.query(
        'SELECT user_id FROM folders WHERE id = $1',
        [folderId]
      );

      if (folderResult.rows.length === 0) {
        return res.status(404).json({ error: 'Folder not found' });
      }

      if (folderResult.rows[0].user_id === userId) {
        return next();
      }

      const permissionResult = await pool.query(
        'SELECT permission_type FROM permissions WHERE folder_id = $1 AND shared_with_user_id = $2',
        [folderId, userId]
      );

      if (permissionResult.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const userPermission = permissionResult.rows[0].permission_type;
      const permissionLevels = { view: 1, create: 2, edit: 3 };

      if (permissionLevels[userPermission] < permissionLevels[requiredPermission]) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
};

module.exports = { authenticateToken, checkFolderPermission };