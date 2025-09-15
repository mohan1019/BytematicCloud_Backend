const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const emailService = require('../services/emailService');

const router = express.Router();

// Handle preflight requests for all auth routes
router.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.status(204).end();
});

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }

    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, phone) VALUES ($1, $2, $3, $4) RETURNING id, name, email, phone, created_at',
      [name, email.toLowerCase(), passwordHash, phone || null]
    );

    const user = result.rows[0];

    // Send welcome email (non-blocking)
    emailService.sendWelcomeEmail(user.email, user.name).catch(error => {
      console.error('Failed to send welcome email:', error);
    });

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        created_at: user.created_at
      },
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password, twoFactorCode } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await pool.query(
      'SELECT id, name, email, phone, password_hash, two_factor_enabled, two_factor_secret FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if 2FA is enabled
    if (user.two_factor_enabled) {
      if (!twoFactorCode) {
        return res.status(200).json({ 
          requires2FA: true,
          message: 'Two-factor authentication code required'
        });
      }

      // Verify 2FA code
      const verified = speakeasy.totp.verify({
        secret: user.two_factor_secret,
        encoding: 'base32',
        token: twoFactorCode,
        window: 2
      });

      if (!verified) {
        return res.status(401).json({ error: 'Invalid two-factor authentication code' });
      }
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        two_factor_enabled: user.two_factor_enabled
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    res.json({
      user: req.user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', authenticateToken, (req, res) => {
  res.json({ message: 'Logout successful' });
});

// Forgot password endpoint
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user exists
    const userResult = await pool.query(
      'SELECT id, name, email FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (userResult.rows.length === 0) {
      // Don't reveal if email exists or not for security
      return res.json({ 
        message: 'If the email exists in our system, a password reset link has been sent.' 
      });
    }

    const user = userResult.rows[0];

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // Token expires in 1 hour

    // Store token in database
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, resetToken, expiresAt]
    );

    // Send reset email
    await emailService.sendPasswordResetEmail(user.email, user.name, resetToken);

    res.json({ 
      message: 'If the email exists in our system, a password reset link has been sent.' 
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset password endpoint
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    // Find valid token
    const tokenResult = await pool.query(`
      SELECT prt.user_id, prt.id as token_id, u.email, u.name 
      FROM password_reset_tokens prt
      JOIN users u ON prt.user_id = u.id
      WHERE prt.token = $1 
        AND prt.expires_at > NOW() 
        AND prt.used = FALSE
    `, [token]);

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const { user_id, token_id } = tokenResult.rows[0];

    // Hash new password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password and mark token as used
    await pool.query('BEGIN');
    
    try {
      await pool.query(
        'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [passwordHash, user_id]
      );

      await pool.query(
        'UPDATE password_reset_tokens SET used = TRUE WHERE id = $1',
        [token_id]
      );

      await pool.query('COMMIT');

      res.json({ message: 'Password reset successful' });

    } catch (updateError) {
      await pool.query('ROLLBACK');
      throw updateError;
    }

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify reset token endpoint (optional - for frontend validation)
router.post('/verify-reset-token', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const tokenResult = await pool.query(`
      SELECT prt.user_id, u.email, u.name 
      FROM password_reset_tokens prt
      JOIN users u ON prt.user_id = u.id
      WHERE prt.token = $1 
        AND prt.expires_at > NOW() 
        AND prt.used = FALSE
    `, [token]);

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const { email, name } = tokenResult.rows[0];

    res.json({ 
      valid: true, 
      user: { email, name }
    });

  } catch (error) {
    console.error('Verify reset token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2FA Setup - Generate QR code
router.post('/2fa/setup', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;

    // Check if 2FA is already enabled
    const userResult = await pool.query(
      'SELECT two_factor_enabled, two_factor_secret FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows[0].two_factor_enabled) {
      return res.status(400).json({ error: 'Two-factor authentication is already enabled' });
    }

    let secret;
    let qrCodeUrl;

    // Check if user already has a secret (from previous setup)
    if (userResult.rows[0].two_factor_secret) {
      // Reuse existing secret
      secret = {
        base32: userResult.rows[0].two_factor_secret,
        otpauth_url: speakeasy.otpauthURL({
          secret: userResult.rows[0].two_factor_secret,
          encoding: 'base32',
          label: `ByteCloud (${userEmail})`,
          issuer: 'ByteCloud'
        })
      };
    } else {
      // Generate new secret
      secret = speakeasy.generateSecret({
        name: `ByteCloud (${userEmail})`,
        issuer: 'ByteCloud'
      });

      // Store the new secret
      await pool.query(
        'UPDATE users SET two_factor_secret = $1 WHERE id = $2',
        [secret.base32, userId]
      );
    }

    // Generate QR code
    qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

    res.json({
      secret: secret.base32,
      qrCode: qrCodeUrl,
      manualEntryKey: secret.base32
    });
  } catch (error) {
    console.error('2FA setup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2FA Enable - Verify code and enable 2FA
router.post('/2fa/enable', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user.id;

    if (!code) {
      return res.status(400).json({ error: 'Verification code is required' });
    }

    // Get user's secret
    const userResult = await pool.query(
      'SELECT two_factor_secret, two_factor_enabled FROM users WHERE id = $1',
      [userId]
    );

    if (!userResult.rows[0].two_factor_secret) {
      return res.status(400).json({ error: 'Please setup 2FA first' });
    }

    if (userResult.rows[0].two_factor_enabled) {
      return res.status(400).json({ error: 'Two-factor authentication is already enabled' });
    }

    // Verify the code
    const verified = speakeasy.totp.verify({
      secret: userResult.rows[0].two_factor_secret,
      encoding: 'base32',
      token: code,
      window: 2
    });

    if (!verified) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // Enable 2FA
    await pool.query(
      'UPDATE users SET two_factor_enabled = true WHERE id = $1',
      [userId]
    );

    res.json({ message: 'Two-factor authentication enabled successfully' });
  } catch (error) {
    console.error('2FA enable error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2FA Disable - Disable 2FA with password verification
router.post('/2fa/disable', authenticateToken, async (req, res) => {
  try {
    const { password } = req.body;
    const userId = req.user.id;

    if (!password) {
      return res.status(400).json({ error: 'Password is required to disable 2FA' });
    }

    // Get user's password hash
    const userResult = await pool.query(
      'SELECT password_hash, two_factor_enabled FROM users WHERE id = $1',
      [userId]
    );

    if (!userResult.rows[0].two_factor_enabled) {
      return res.status(400).json({ error: 'Two-factor authentication is not enabled' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, userResult.rows[0].password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Disable 2FA but keep secret for easy re-enabling
    await pool.query(
      'UPDATE users SET two_factor_enabled = false WHERE id = $1',
      [userId]
    );

    res.json({ message: 'Two-factor authentication disabled successfully' });
  } catch (error) {
    console.error('2FA disable error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2FA Status - Check if 2FA is enabled
router.get('/2fa/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const userResult = await pool.query(
      'SELECT two_factor_enabled FROM users WHERE id = $1',
      [userId]
    );

    res.json({
      enabled: userResult.rows[0].two_factor_enabled || false
    });
  } catch (error) {
    console.error('2FA status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2FA Remove - Completely remove 2FA setup (delete secret)
router.post('/2fa/remove', authenticateToken, async (req, res) => {
  try {
    const { password } = req.body;
    const userId = req.user.id;

    if (!password) {
      return res.status(400).json({ error: 'Password is required to completely remove 2FA setup' });
    }

    // Get user's password hash
    const userResult = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    // Verify password
    const isValidPassword = await bcrypt.compare(password, userResult.rows[0].password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Completely remove 2FA setup
    await pool.query(
      'UPDATE users SET two_factor_enabled = false, two_factor_secret = null WHERE id = $1',
      [userId]
    );

    res.json({ message: 'Two-factor authentication completely removed. You will need to set up fresh when re-enabling.' });
  } catch (error) {
    console.error('2FA remove error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;