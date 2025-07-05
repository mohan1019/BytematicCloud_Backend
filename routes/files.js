const express = require('express');
const multer = require('multer');
const { pool } = require('../config/database');
const { authenticateToken, checkFolderPermission } = require('../middleware/auth');
const backblazeService = require('../config/backblaze');
const redisService = require('../config/redis');
const thumbnailService = require('../services/thumbnailService');
const crypto = require('crypto');
const path = require('path');

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB limit
  },
  fileFilter: (req, file, cb) => {
    // More comprehensive file type support
    const allowedExtensions = /jpeg|jpg|png|gif|bmp|tiff|webp|svg|ico|mp4|mov|avi|mkv|wmv|flv|webm|m4v|3gp|mp3|wav|flac|aac|ogg|wma|m4a|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf|csv|zip|rar|7z|tar|gz|json|xml|html|css|js|ts|py|java|cpp|c|php|rb|go|sql|md|log/;
    
    const allowedMimeTypes = [
      // Images
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff', 'image/webp', 'image/svg+xml', 'image/x-icon',
      // Videos
      'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/x-ms-wmv', 'video/x-flv', 'video/webm', 'video/3gpp',
      // Audio
      'audio/mpeg', 'audio/wav', 'audio/flac', 'audio/aac', 'audio/ogg', 'audio/x-ms-wma', 'audio/mp4',
      // Documents
      'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain', 'application/rtf', 'text/csv',
      // Archives
      'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed', 'application/x-tar', 'application/gzip',
      // Code/Data
      'application/json', 'application/xml', 'text/html', 'text/css', 'application/javascript', 'text/javascript',
      'application/x-python-code', 'text/x-java-source', 'text/x-c', 'text/x-php', 'text/x-ruby', 'application/x-sql', 'text/markdown'
    ];

    const extname = allowedExtensions.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedMimeTypes.includes(file.mimetype) || file.mimetype.startsWith('text/') || file.mimetype.startsWith('application/');

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      // More permissive approach - allow most files but log unknown types
      console.log(`Allowing file with mimetype: ${file.mimetype}, extension: ${path.extname(file.originalname)}`);
      return cb(null, true);
    }
  }
});

// Multiple file upload
const uploadMultiple = multer({
  storage: storage,
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB limit per file
    files: 20 // Maximum 20 files at once
  },
  fileFilter: (req, file, cb) => {
    // Use the same file filter as single upload
    const allowedExtensions = /jpeg|jpg|png|gif|bmp|tiff|webp|svg|ico|mp4|mov|avi|mkv|wmv|flv|webm|m4v|3gp|mp3|wav|flac|aac|ogg|wma|m4a|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf|csv|zip|rar|7z|tar|gz|json|xml|html|css|js|ts|py|java|cpp|c|php|rb|go|sql|md|log/;
    
    const allowedMimeTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff', 'image/webp', 'image/svg+xml', 'image/x-icon',
      'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/x-ms-wmv', 'video/x-flv', 'video/webm', 'video/3gpp',
      'audio/mpeg', 'audio/wav', 'audio/flac', 'audio/aac', 'audio/ogg', 'audio/x-ms-wma', 'audio/mp4',
      'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain', 'application/rtf', 'text/csv',
      'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed', 'application/x-tar', 'application/gzip',
      'application/json', 'application/xml', 'text/html', 'text/css', 'application/javascript', 'text/javascript',
      'application/x-python-code', 'text/x-java-source', 'text/x-c', 'text/x-php', 'text/x-ruby', 'application/x-sql', 'text/markdown'
    ];

    const extname = allowedExtensions.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedMimeTypes.includes(file.mimetype) || file.mimetype.startsWith('text/') || file.mimetype.startsWith('application/');

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      console.log(`Allowing file with mimetype: ${file.mimetype}, extension: ${path.extname(file.originalname)}`);
      return cb(null, true);
    }
  }
});

// Multiple file upload endpoint
router.post('/upload/multiple', authenticateToken, uploadMultiple.array('files', 20), async (req, res) => {
  try {
    const { folder_id } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Check folder permissions once
    if (folder_id) {
      const folderResult = await pool.query(
        'SELECT user_id FROM folders WHERE id = $1',
        [folder_id]
      );

      if (folderResult.rows.length === 0) {
        return res.status(404).json({ error: 'Folder not found' });
      }

      if (folderResult.rows[0].user_id !== req.user.id) {
        const permissionResult = await pool.query(
          'SELECT permission_type FROM permissions WHERE folder_id = $1 AND shared_with_user_id = $2',
          [folder_id, req.user.id]
        );

        if (permissionResult.rows.length === 0 || 
            !['create', 'edit'].includes(permissionResult.rows[0].permission_type)) {
          return res.status(403).json({ error: 'Insufficient permissions to upload to this folder' });
        }
      }
    }

    // Check storage quota before uploading
    const userStorageResult = await pool.query(
      'SELECT storage_quota, storage_used FROM users WHERE id = $1',
      [req.user.id]
    );

    if (userStorageResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { storage_quota, storage_used } = userStorageResult.rows[0];
    const totalUploadSize = files.reduce((sum, file) => sum + file.size, 0);

    if (parseInt(storage_used) + totalUploadSize > parseInt(storage_quota)) {
      const availableSpace = parseInt(storage_quota) - parseInt(storage_used);
      const formatBytes = (bytes) => {
        const gb = bytes / (1024 * 1024 * 1024);
        return gb >= 1 ? `${gb.toFixed(2)}GB` : `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
      };

      return res.status(413).json({ 
        error: 'Insufficient storage space',
        details: {
          totalUploadSize: formatBytes(totalUploadSize),
          availableSpace: formatBytes(availableSpace),
          quotaLimit: formatBytes(parseInt(storage_quota))
        }
      });
    }

    const results = {
      successful: [],
      failed: []
    };

    // Process each file
    for (const file of files) {
      try {
        const fileExtension = path.extname(file.originalname);
        const uniqueFileName = `${crypto.randomUUID()}${fileExtension}`;

        // Upload to Backblaze
        const uploadResult = await backblazeService.uploadFile(
          file.buffer,
          uniqueFileName,
          file.mimetype
        );

        // Generate thumbnail if applicable
        let thumbnailData = null;
        if (thumbnailService.shouldGenerateThumbnail(file.mimetype)) {
          try {
            thumbnailData = await thumbnailService.processAndUploadThumbnail(
              file.buffer,
              file.originalname,
              file.mimetype
            );
          } catch (thumbnailError) {
            console.error('Thumbnail generation failed for', file.originalname, ':', thumbnailError);
          }
        }

        // Save to database
        const dbResult = await pool.query(`
          INSERT INTO files (user_id, folder_id, name, original_name, mime_type, size, backblaze_file_id, backblaze_url, thumbnail_path, thumbnail_backblaze_file_id, has_thumbnail)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *
        `, [
          req.user.id,
          folder_id || null,
          uniqueFileName,
          file.originalname,
          file.mimetype,
          file.size,
          uploadResult.fileId,
          uploadResult.downloadUrl,
          thumbnailData ? thumbnailData.thumbnailName : null,
          thumbnailData ? thumbnailData.thumbnailFileId : null,
          !!thumbnailData
        ]);

        // Update user's storage usage
        await pool.query(
          'UPDATE users SET storage_used = storage_used + $1 WHERE id = $2',
          [file.size, req.user.id]
        );

        results.successful.push({
          file: dbResult.rows[0],
          originalName: file.originalname
        });

      } catch (error) {
        console.error('Failed to upload file:', file.originalname, error);
        results.failed.push({
          originalName: file.originalname,
          error: error.message
        });
      }
    }

    res.status(201).json({
      message: `Upload completed. ${results.successful.length} files uploaded successfully, ${results.failed.length} failed.`,
      results
    });

  } catch (error) {
    console.error('Multiple file upload error:', error);
    res.status(500).json({ error: 'Multiple file upload failed' });
  }
});

// Single file upload (keeping for backward compatibility)
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { folder_id } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (folder_id) {
      const folderResult = await pool.query(
        'SELECT user_id FROM folders WHERE id = $1',
        [folder_id]
      );

      if (folderResult.rows.length === 0) {
        return res.status(404).json({ error: 'Folder not found' });
      }

      if (folderResult.rows[0].user_id !== req.user.id) {
        const permissionResult = await pool.query(
          'SELECT permission_type FROM permissions WHERE folder_id = $1 AND shared_with_user_id = $2',
          [folder_id, req.user.id]
        );

        if (permissionResult.rows.length === 0 || 
            !['create', 'edit'].includes(permissionResult.rows[0].permission_type)) {
          return res.status(403).json({ error: 'Insufficient permissions to upload to this folder' });
        }
      }
    }

    // Check storage quota before uploading
    const userStorageResult = await pool.query(
      'SELECT storage_quota, storage_used FROM users WHERE id = $1',
      [req.user.id]
    );

    if (userStorageResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { storage_quota, storage_used } = userStorageResult.rows[0];

    if (parseInt(storage_used) + file.size > parseInt(storage_quota)) {
      const availableSpace = parseInt(storage_quota) - parseInt(storage_used);
      const formatBytes = (bytes) => {
        const gb = bytes / (1024 * 1024 * 1024);
        return gb >= 1 ? `${gb.toFixed(2)}GB` : `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
      };

      return res.status(413).json({ 
        error: 'Insufficient storage space',
        details: {
          fileSize: formatBytes(file.size),
          availableSpace: formatBytes(availableSpace),
          quotaLimit: formatBytes(parseInt(storage_quota))
        }
      });
    }

    const fileExtension = path.extname(file.originalname);
    const uniqueFileName = `${crypto.randomUUID()}${fileExtension}`;

    const uploadResult = await backblazeService.uploadFile(
      file.buffer,
      uniqueFileName,
      file.mimetype
    );

    let thumbnailData = null;
    if (thumbnailService.shouldGenerateThumbnail(file.mimetype)) {
      try {
        thumbnailData = await thumbnailService.processAndUploadThumbnail(
          file.buffer,
          file.originalname,
          file.mimetype
        );
      } catch (thumbnailError) {
        console.error('Thumbnail generation failed:', thumbnailError);
      }
    }

    const dbResult = await pool.query(`
      INSERT INTO files (user_id, folder_id, name, original_name, mime_type, size, backblaze_file_id, backblaze_url, thumbnail_path, thumbnail_backblaze_file_id, has_thumbnail)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      req.user.id,
      folder_id || null,
      uniqueFileName,
      file.originalname,
      file.mimetype,
      file.size,
      uploadResult.fileId,
      uploadResult.downloadUrl,
      thumbnailData ? thumbnailData.thumbnailName : null,
      thumbnailData ? thumbnailData.thumbnailFileId : null,
      !!thumbnailData
    ]);

    // Update user's storage usage
    await pool.query(
      'UPDATE users SET storage_used = storage_used + $1 WHERE id = $2',
      [file.size, req.user.id]
    );

    res.status(201).json({
      message: 'File uploaded successfully',
      file: dbResult.rows[0]
    });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'File upload failed' });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { folder_id } = req.query;

    let query = `
      SELECT f.*, 
             CASE WHEN f.user_id = $1 THEN 'owner' ELSE p.permission_type END as access_level
      FROM files f
      LEFT JOIN permissions p ON f.folder_id = p.folder_id AND p.shared_with_user_id = $1
      WHERE (f.user_id = $1 OR p.shared_with_user_id = $1)
    `;
    let params = [req.user.id];

    if (folder_id) {
      query += ' AND f.folder_id = $2';
      params.push(folder_id);
    } else {
      query += ' AND f.folder_id IS NULL';
    }

    query += ' ORDER BY f.created_at DESC';

    const result = await pool.query(query, params);

    res.json({
      files: result.rows
    });
  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({ error: 'Failed to retrieve files' });
  }
});

router.get('/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;

    const result = await pool.query(`
      SELECT f.*, 
             CASE WHEN f.user_id = $1 THEN 'owner' ELSE p.permission_type END as access_level
      FROM files f
      LEFT JOIN permissions p ON f.folder_id = p.folder_id AND p.shared_with_user_id = $1
      WHERE f.id = $2 AND (f.user_id = $1 OR p.shared_with_user_id = $1)
    `, [req.user.id, fileId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }

    res.json({
      file: result.rows[0]
    });
  } catch (error) {
    console.error('Get file error:', error);
    res.status(500).json({ error: 'Failed to retrieve file' });
  }
});

router.delete('/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;

    const fileResult = await pool.query(`
      SELECT f.*, 
             CASE WHEN f.user_id = $1 THEN 'owner' ELSE p.permission_type END as access_level
      FROM files f
      LEFT JOIN permissions p ON f.folder_id = p.folder_id AND p.shared_with_user_id = $1
      WHERE f.id = $2 AND (f.user_id = $1 OR p.shared_with_user_id = $1)
    `, [req.user.id, fileId]);

    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }

    const file = fileResult.rows[0];

    if (file.access_level !== 'owner' && file.access_level !== 'edit') {
      return res.status(403).json({ error: 'Insufficient permissions to delete this file' });
    }

    try {
      await backblazeService.deleteFile(file.backblaze_file_id, file.name);
    } catch (b2Error) {
      console.error('Backblaze deletion error:', b2Error);
    }

    await pool.query('DELETE FROM files WHERE id = $1', [fileId]);

    // Update user's storage usage (decrease by file size)
    await pool.query(
      'UPDATE users SET storage_used = storage_used - $1 WHERE id = $2',
      [file.size, file.user_id]
    );

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Bulk delete files
router.delete('/bulk', authenticateToken, async (req, res) => {
  try {
    const { fileIds } = req.body;

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds must be a non-empty array' });
    }

    const placeholders = fileIds.map((_, index) => `$${index + 2}`).join(',');
    const fileResults = await pool.query(`
      SELECT f.*, 
             CASE WHEN f.user_id = $1 THEN 'owner' ELSE p.permission_type END as access_level
      FROM files f
      LEFT JOIN permissions p ON f.folder_id = p.folder_id AND p.shared_with_user_id = $1
      WHERE f.id IN (${placeholders}) AND (f.user_id = $1 OR p.shared_with_user_id = $1)
    `, [req.user.id, ...fileIds]);

    const foundFiles = fileResults.rows;
    const notFoundIds = fileIds.filter(id => !foundFiles.find(f => f.id === parseInt(id)));
    const unauthorizedFiles = foundFiles.filter(f => f.access_level !== 'owner' && f.access_level !== 'edit');
    const deletableFiles = foundFiles.filter(f => f.access_level === 'owner' || f.access_level === 'edit');

    if (unauthorizedFiles.length > 0) {
      return res.status(403).json({ 
        error: 'Insufficient permissions for some files',
        unauthorizedFiles: unauthorizedFiles.map(f => ({ id: f.id, name: f.original_name }))
      });
    }

    const results = {
      deleted: [],
      failed: [],
      notFound: notFoundIds
    };

    for (const file of deletableFiles) {
      try {
        try {
          await backblazeService.deleteFile(file.backblaze_file_id, file.name);
        } catch (b2Error) {
          console.error(`Backblaze deletion error for file ${file.id}:`, b2Error);
        }

        await pool.query('DELETE FROM files WHERE id = $1', [file.id]);
        
        // Update user's storage usage (decrease by file size)
        await pool.query(
          'UPDATE users SET storage_used = storage_used - $1 WHERE id = $2',
          [file.size, file.user_id]
        );
        
        results.deleted.push({ id: file.id, name: file.original_name });
      } catch (error) {
        console.error(`Failed to delete file ${file.id}:`, error);
        results.failed.push({ id: file.id, name: file.original_name, error: error.message });
      }
    }

    res.json({
      message: `Bulk delete completed. ${results.deleted.length} files deleted.`,
      results
    });
  } catch (error) {
    console.error('Bulk delete files error:', error);
    res.status(500).json({ error: 'Failed to bulk delete files' });
  }
});

// Download file with caching
router.get('/:fileId/download', async (req, res) => {
  try {
    const { fileId } = req.params;
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1] || req.query.token;

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Verify token
    const jwt = require('jsonwebtoken');
    let userId;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch (error) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    const result = await pool.query(`
      SELECT f.*, 
             CASE WHEN f.user_id = $1 THEN 'owner' ELSE p.permission_type END as access_level
      FROM files f
      LEFT JOIN permissions p ON f.folder_id = p.folder_id AND p.shared_with_user_id = $1
      WHERE f.id = $2 AND (f.user_id = $1 OR p.shared_with_user_id = $1)
    `, [userId, fileId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }

    const file = result.rows[0];
    
    // Update download count
    await pool.query('UPDATE files SET download_count = download_count + 1 WHERE id = $1', [fileId]);

    // Get fresh authorized download URL
    const downloadUrl = await backblazeService.getDownloadUrl(file.name);
    
    // Set download headers
    res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Length', file.size);
    
    // Proxy the file content instead of redirecting with better error handling
    const https = require('https');
    const http = require('http');
    const url = require('url');
    
    const parsedUrl = url.parse(downloadUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const proxyReq = httpModule.get(downloadUrl, {
      timeout: 60000, // 60 second timeout for downloads
      headers: {
        'User-Agent': 'ByteCloud-Proxy/1.0'
      }
    }, (proxyRes) => {
      // Handle client disconnect
      req.on('close', () => {
        if (proxyRes && !proxyRes.destroyed) {
          proxyRes.destroy();
        }
      });
      
      req.on('aborted', () => {
        if (proxyRes && !proxyRes.destroyed) {
          proxyRes.destroy();
        }
      });
      
      // Forward headers from Backblaze
      if (proxyRes.headers['content-length']) {
        res.setHeader('Content-Length', proxyRes.headers['content-length']);
      }
      
      // Error handling
      proxyRes.on('error', (error) => {
        console.error('Proxy download response error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Download stream error' });
        }
      });
      
      res.on('error', (error) => {
        console.error('Download response stream error:', error);
        if (proxyRes && !proxyRes.destroyed) {
          proxyRes.destroy();
        }
      });
      
      // Forward the content
      proxyRes.pipe(res);
    });
    
    proxyReq.on('timeout', () => {
      console.error('Download proxy request timeout');
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ error: 'Download timeout' });
      }
    });
    
    proxyReq.on('error', (error) => {
      console.error('Proxy download error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to download file' });
      }
    });
    
    proxyReq.setTimeout(60000);
    
  } catch (error) {
    console.error('Download file error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Get thumbnail for a file
router.get('/:fileId/thumbnail', async (req, res) => {
  try {
    const { fileId } = req.params;
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Verify token
    const jwt = require('jsonwebtoken');
    let userId;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch (error) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    const result = await pool.query(`
      SELECT f.*, 
             CASE WHEN f.user_id = $1 THEN 'owner' ELSE p.permission_type END as access_level
      FROM files f
      LEFT JOIN permissions p ON f.folder_id = p.folder_id AND p.shared_with_user_id = $1
      WHERE f.id = $2 AND (f.user_id = $1 OR p.shared_with_user_id = $1)
    `, [userId, fileId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }

    const file = result.rows[0];

    if (!file.has_thumbnail || !file.thumbnail_path) {
      return res.status(404).json({ error: 'Thumbnail not available' });
    }

    // Get thumbnail download URL
    const thumbnailUrl = await backblazeService.getDownloadUrl(file.thumbnail_path);
    
    // Set appropriate headers for thumbnail
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Proxy the thumbnail
    const https = require('https');
    const http = require('http');
    const url = require('url');
    
    const parsedUrl = url.parse(thumbnailUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    const proxyReq = protocol.request(thumbnailUrl, (proxyRes) => {
      if (proxyRes.headers['content-length']) {
        res.setHeader('Content-Length', proxyRes.headers['content-length']);
      }
      
      proxyRes.on('error', (error) => {
        console.error('Thumbnail proxy error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to load thumbnail' });
        }
      });
      
      proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (error) => {
      console.error('Thumbnail request error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to load thumbnail' });
      }
    });
    
    proxyReq.end();
    
  } catch (error) {
    console.error('Get thumbnail error:', error);
    res.status(500).json({ error: 'Failed to get thumbnail' });
  }
});

// View file with caching (for inline display) - Support for images, videos, and PDFs
router.get('/:fileId/view', async (req, res) => {
  try {
    const { fileId } = req.params;
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1] || req.query.token;

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Verify token
    const jwt = require('jsonwebtoken');
    let userId;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch (error) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    const result = await pool.query(`
      SELECT f.*, 
             CASE WHEN f.user_id = $1 THEN 'owner' ELSE p.permission_type END as access_level
      FROM files f
      LEFT JOIN permissions p ON f.folder_id = p.folder_id AND p.shared_with_user_id = $1
      WHERE f.id = $2 AND (f.user_id = $1 OR p.shared_with_user_id = $1)
    `, [userId, fileId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }

    const file = result.rows[0];

    // Support images, videos, and PDFs for inline viewing
    const supportedTypes = ['image/', 'video/', 'application/pdf'];
    const isSupported = supportedTypes.some(type => file.mime_type.startsWith(type) || file.mime_type === type);
    
    if (!isSupported) {
      return res.status(400).json({ error: 'File type not supported for inline viewing' });
    }

    // Cache file metadata
    await redisService.cacheFileMetadata(fileId, file, 3600);

    // Get fresh authorized download URL
    const viewUrl = await backblazeService.getDownloadUrl(file.name);
    
    // Proxy the image instead of redirecting to avoid CORS issues
    const https = require('https');
    const http = require('http');
    const url = require('url');
    
    const parsedUrl = url.parse(viewUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    const proxyReq = protocol.request(viewUrl, (proxyRes) => {
      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      // Set proper headers for file display
      res.setHeader('Content-Type', file.mime_type);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      if (proxyRes.headers['content-length']) {
        res.setHeader('Content-Length', proxyRes.headers['content-length']);
      }
      
      // Set disposition based on file type
      if (file.mime_type.startsWith('image/') || file.mime_type.startsWith('video/') || file.mime_type === 'application/pdf') {
        res.setHeader('Content-Disposition', `inline; filename="${file.original_name}"`);
      }
      
      // Pipe the response
      proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (error) => {
      console.error('Proxy request error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to load file' });
      }
    });
    
    proxyReq.end();
    
  } catch (error) {
    console.error('View file error:', error);
    res.status(500).json({ error: 'Failed to view file' });
  }
});

// Handle CORS preflight for file view
router.options('/:fileId/view', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.status(200).end();
});

// Create public share link
router.post('/:fileId/share', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const { expiresIn = 24 } = req.body; // hours

    const fileResult = await pool.query(`
      SELECT f.*, 
             CASE WHEN f.user_id = $1 THEN 'owner' ELSE p.permission_type END as access_level
      FROM files f
      LEFT JOIN permissions p ON f.folder_id = p.folder_id AND p.shared_with_user_id = $1
      WHERE f.id = $2 AND (f.user_id = $1 OR p.shared_with_user_id = $1)
    `, [req.user.id, fileId]);

    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }

    const file = fileResult.rows[0];

    if (file.access_level !== 'owner' && file.access_level !== 'edit') {
      return res.status(403).json({ error: 'Insufficient permissions to share this file' });
    }

    // Generate unique share token
    const shareToken = crypto.randomUUID();
    
    // Update file with public share token
    await pool.query(
      'UPDATE files SET public_share_token = $1, is_public = TRUE WHERE id = $2',
      [shareToken, fileId]
    );

    // Cache public share data
    const shareData = {
      fileId: file.id,
      fileName: file.original_name,
      mimeType: file.mime_type,
      size: file.size,
      backblazeUrl: file.backblaze_url,
      ownerId: file.user_id
    };
    
    await redisService.cachePublicShare(shareToken, shareData, expiresIn * 3600);

    res.json({
      message: 'Public share link created successfully',
      shareToken,
      shareUrl: `${req.protocol}://${req.get('host')}/api/files/public/${shareToken}`,
      expiresIn: `${expiresIn} hours`
    });
  } catch (error) {
    console.error('Create share link error:', error);
    res.status(500).json({ error: 'Failed to create share link' });
  }
});

// Public file access (no authentication required)
router.get('/public/:shareToken', async (req, res) => {
  try {
    const { shareToken } = req.params;

    // Check cache first
    let shareData = await redisService.getPublicShare(shareToken);
    
    if (!shareData) {
      // Check database if not in cache
      const result = await pool.query(
        'SELECT * FROM files WHERE public_share_token = $1 AND is_public = TRUE',
        [shareToken]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'File not found or share link expired' });
      }

      const file = result.rows[0];
      shareData = {
        fileId: file.id,
        fileName: file.original_name,
        mimeType: file.mime_type,
        size: file.size,
        backblazeUrl: file.backblaze_url,
        ownerId: file.user_id
      };

      // Re-cache for 1 hour
      await redisService.cachePublicShare(shareToken, shareData, 3600);
    }

    // Update download count
    await pool.query('UPDATE files SET download_count = download_count + 1 WHERE id = $1', [shareData.fileId]);

    // Get file name from database
    const fileResult = await pool.query('SELECT name FROM files WHERE id = $1', [shareData.fileId]);
    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const fileName = fileResult.rows[0].name;
    
    // Get fresh authorized download URL
    const downloadUrl = await backblazeService.getDownloadUrl(fileName);
    
    // Set appropriate headers for the file
    res.setHeader('Content-Type', shareData.mimeType);
    res.setHeader('Content-Length', shareData.size);
    
    // For images, videos, and PDFs show inline; for others, trigger download
    if (shareData.mimeType.startsWith('image/') || 
        shareData.mimeType.startsWith('video/') || 
        shareData.mimeType === 'application/pdf') {
      res.setHeader('Content-Disposition', `inline; filename="${shareData.fileName}"`);
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${shareData.fileName}"`);
    }
    
    // Proxy the file content instead of redirecting with better error handling
    const https = require('https');
    const http = require('http');
    const url = require('url');
    
    const parsedUrl = url.parse(downloadUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const proxyReq = httpModule.get(downloadUrl, {
      timeout: 60000, // 60 second timeout
      headers: {
        'User-Agent': 'ByteCloud-Proxy/1.0'
      }
    }, (proxyRes) => {
      // Handle client disconnect
      req.on('close', () => {
        if (proxyRes && !proxyRes.destroyed) {
          proxyRes.destroy();
        }
      });
      
      req.on('aborted', () => {
        if (proxyRes && !proxyRes.destroyed) {
          proxyRes.destroy();
        }
      });
      
      // Forward headers from Backblaze
      if (proxyRes.headers['content-length']) {
        res.setHeader('Content-Length', proxyRes.headers['content-length']);
      }
      
      // Error handling
      proxyRes.on('error', (error) => {
        console.error('Proxy public file response error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Public file stream error' });
        }
      });
      
      res.on('error', (error) => {
        console.error('Public file response stream error:', error);
        if (proxyRes && !proxyRes.destroyed) {
          proxyRes.destroy();
        }
      });
      
      // Forward the content
      proxyRes.pipe(res);
    });
    
    proxyReq.on('timeout', () => {
      console.error('Public file proxy request timeout');
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ error: 'Request timeout' });
      }
    });
    
    proxyReq.on('error', (error) => {
      console.error('Proxy public file error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to access file' });
      }
    });
    
    proxyReq.setTimeout(60000);
  } catch (error) {
    console.error('Public file access error:', error);
    res.status(500).json({ error: 'Failed to access file' });
  }
});

// View public shared file (inline display for images, videos, PDFs)
router.get('/public/:shareToken/view', async (req, res) => {
  try {
    const { shareToken } = req.params;

    let shareData = await redisService.getPublicShare(shareToken);
    
    if (!shareData) {
      const result = await pool.query(
        'SELECT * FROM files WHERE public_share_token = $1 AND is_public = TRUE',
        [shareToken]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'File not found or share link expired' });
      }

      const file = result.rows[0];
      shareData = {
        fileId: file.id,
        fileName: file.original_name,
        mimeType: file.mime_type,
        size: file.size,
        backblazeUrl: file.backblaze_url,
        ownerId: file.user_id
      };

      // Re-cache for 1 hour
      await redisService.cachePublicShare(shareToken, shareData, 3600);
    }

    // Only allow viewing of images, videos, and PDFs
    if (!shareData.mimeType.startsWith('image/') && 
        !shareData.mimeType.startsWith('video/') && 
        shareData.mimeType !== 'application/pdf') {
      return res.status(400).json({ error: 'File is not viewable inline' });
    }

    // Get file name from database
    const fileResult = await pool.query('SELECT name FROM files WHERE id = $1', [shareData.fileId]);
    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const fileName = fileResult.rows[0].name;
    
    // Get fresh authorized download URL
    const downloadUrl = await backblazeService.getDownloadUrl(fileName);
    
    // Set headers for inline file viewing
    res.setHeader('Content-Type', shareData.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${shareData.fileName}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Connection', 'keep-alive');
    
    // Proxy the image content with better error handling
    const https = require('https');
    const http = require('http');
    const url = require('url');
    
    const parsedUrl = url.parse(downloadUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const proxyReq = httpModule.get(downloadUrl, {
      timeout: 30000, // 30 second timeout
      headers: {
        'User-Agent': 'ByteCloud-Proxy/1.0'
      }
    }, (proxyRes) => {
      // Handle client disconnect
      req.on('close', () => {
        if (proxyRes && !proxyRes.destroyed) {
          proxyRes.destroy();
        }
      });
      
      req.on('aborted', () => {
        if (proxyRes && !proxyRes.destroyed) {
          proxyRes.destroy();
        }
      });
      
      // Forward headers from Backblaze
      if (proxyRes.headers['content-length']) {
        res.setHeader('Content-Length', proxyRes.headers['content-length']);
      }
      
      // Pipe with error handling
      proxyRes.on('error', (error) => {
        console.error('Proxy response error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream error' });
        }
      });
      
      res.on('error', (error) => {
        console.error('Response stream error:', error);
        if (proxyRes && !proxyRes.destroyed) {
          proxyRes.destroy();
        }
      });
      
      // Forward the content
      proxyRes.pipe(res);
    });
    
    proxyReq.on('timeout', () => {
      console.error('Proxy request timeout');
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ error: 'Request timeout' });
      }
    });
    
    proxyReq.on('error', (error) => {
      console.error('Proxy public image view error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to view image' });
      }
    });
    
    proxyReq.setTimeout(30000);
    
  } catch (error) {
    console.error('Public image view error:', error);
    res.status(500).json({ error: 'Failed to view image' });
  }
});

// Get public thumbnail for shared files
router.get('/public/:shareToken/thumbnail', async (req, res) => {
  try {
    const { shareToken } = req.params;

    let shareData = await redisService.getPublicShare(shareToken);
    
    if (!shareData) {
      const result = await pool.query(
        'SELECT * FROM files WHERE public_share_token = $1 AND is_public = TRUE',
        [shareToken]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'File not found or share link expired' });
      }

      const file = result.rows[0];
      shareData = {
        fileId: file.id,
        fileName: file.original_name,
        mimeType: file.mime_type,
        size: file.size,
        hasThumbnail: file.has_thumbnail,
        thumbnailPath: file.thumbnail_path
      };

      // Re-cache for 1 hour
      await redisService.cachePublicShare(shareToken, shareData, 3600);
    }

    if (!shareData.hasThumbnail || !shareData.thumbnailPath) {
      return res.status(404).json({ error: 'Thumbnail not available' });
    }

    // Get thumbnail download URL
    const thumbnailUrl = await backblazeService.getDownloadUrl(shareData.thumbnailPath);
    
    // Set appropriate headers for thumbnail
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Proxy the thumbnail
    const https = require('https');
    const http = require('http');
    const url = require('url');
    
    const parsedUrl = url.parse(thumbnailUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    const proxyReq = protocol.request(thumbnailUrl, (proxyRes) => {
      if (proxyRes.headers['content-length']) {
        res.setHeader('Content-Length', proxyRes.headers['content-length']);
      }
      
      proxyRes.on('error', (error) => {
        console.error('Public thumbnail proxy error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to load thumbnail' });
        }
      });
      
      proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (error) => {
      console.error('Public thumbnail request error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to load thumbnail' });
      }
    });
    
    proxyReq.end();
    
  } catch (error) {
    console.error('Get public thumbnail error:', error);
    res.status(500).json({ error: 'Failed to get thumbnail' });
  }
});

// Get public file info (for preview/metadata)
router.get('/public/:shareToken/info', async (req, res) => {
  try {
    const { shareToken } = req.params;

    let shareData = await redisService.getPublicShare(shareToken);
    
    if (!shareData) {
      const result = await pool.query(
        'SELECT * FROM files WHERE public_share_token = $1 AND is_public = TRUE',
        [shareToken]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'File not found or share link expired' });
      }

      const file = result.rows[0];
      shareData = {
        fileId: file.id,
        fileName: file.original_name,
        mimeType: file.mime_type,
        size: file.size,
        downloadCount: file.download_count
      };
    }

    res.json({
      fileName: shareData.fileName,
      mimeType: shareData.mimeType,
      size: shareData.size,
      downloadCount: shareData.downloadCount,
      isImage: shareData.mimeType.startsWith('image/'),
      isVideo: shareData.mimeType.startsWith('video/'),
      hasThumbnail: shareData.hasThumbnail || false
    });
  } catch (error) {
    console.error('Get public file info error:', error);
    res.status(500).json({ error: 'Failed to get file info' });
  }
});

// Revoke public share
router.delete('/:fileId/share', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;

    const fileResult = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND user_id = $2',
      [fileId, req.user.id]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }

    const file = fileResult.rows[0];

    // Remove public access
    await pool.query(
      'UPDATE files SET public_share_token = NULL, is_public = FALSE WHERE id = $1',
      [fileId]
    );

    // Remove from cache
    if (file.public_share_token) {
      await redisService.del(`public:${file.public_share_token}`);
    }

    res.json({ message: 'Public share link revoked successfully' });
  } catch (error) {
    console.error('Revoke share link error:', error);
    res.status(500).json({ error: 'Failed to revoke share link' });
  }
});

module.exports = router;