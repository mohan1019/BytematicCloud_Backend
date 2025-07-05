const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'bytecloud',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

const initializeDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS folders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        parent_folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS files (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100),
        size BIGINT,
        backblaze_file_id VARCHAR(255),
        backblaze_url TEXT,
        public_share_token VARCHAR(255) UNIQUE,
        is_public BOOLEAN DEFAULT FALSE,
        download_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id SERIAL PRIMARY KEY,
        folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
        shared_with_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        permission_type VARCHAR(20) CHECK (permission_type IN ('view', 'create', 'edit')) NOT NULL,
        granted_by_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(folder_id, shared_with_user_id)
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
      CREATE INDEX IF NOT EXISTS idx_files_folder_id ON files(folder_id);
      CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);
      CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_folder_id);
      CREATE INDEX IF NOT EXISTS idx_permissions_folder_id ON permissions(folder_id);
      CREATE INDEX IF NOT EXISTS idx_permissions_user_id ON permissions(shared_with_user_id);
    `);

    // Add thumbnail columns if they don't exist (for existing databases)
    try {
      await pool.query(`
        ALTER TABLE files 
        ADD COLUMN IF NOT EXISTS thumbnail_path VARCHAR(255),
        ADD COLUMN IF NOT EXISTS thumbnail_backblaze_file_id VARCHAR(255),
        ADD COLUMN IF NOT EXISTS has_thumbnail BOOLEAN DEFAULT FALSE;
      `);
      console.log('✅ Thumbnail columns added successfully');
    } catch (error) {
      // If columns already exist, that's fine
      if (error.code !== '42701') { // 42701 is "column already exists" error
        console.error('⚠️ Error adding thumbnail columns:', error);
      }
    }

    // Add phone number column to users table if it doesn't exist
    try {
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
      `);
      console.log('✅ Phone column added to users table successfully');
    } catch (error) {
      if (error.code !== '42701') {
        console.error('⚠️ Error adding phone column:', error);
      }
    }

    // Create password reset tokens table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
    `);

    console.log('✅ Password reset tokens table created successfully');

    // Add storage quota columns to users table if they don't exist
    try {
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS storage_quota BIGINT DEFAULT 5368709120,
        ADD COLUMN IF NOT EXISTS storage_used BIGINT DEFAULT 0;
      `);
      console.log('✅ Storage quota columns added to users table successfully');
    } catch (error) {
      if (error.code !== '42701') {
        console.error('⚠️ Error adding storage quota columns:', error);
      }
    }

    // Create coupons table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        storage_bonus BIGINT NOT NULL,
        max_uses INTEGER DEFAULT 1,
        current_uses INTEGER DEFAULT 0,
        expires_at TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create coupon redemptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coupon_redemptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        coupon_id INTEGER REFERENCES coupons(id) ON DELETE CASCADE,
        storage_granted BIGINT NOT NULL,
        redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, coupon_id)
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
      CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_user_id ON coupon_redemptions(user_id);
    `);

    console.log('✅ Coupons and redemptions tables created successfully');

    // Add name column to existing coupons table if it doesn't exist
    try {
      await pool.query(`
        ALTER TABLE coupons 
        ADD COLUMN IF NOT EXISTS name VARCHAR(255);
      `);
      console.log('✅ Name column added to coupons table successfully');
    } catch (error) {
      if (error.code !== '42701') {
        console.error('⚠️ Error adding name column to coupons:', error);
      }
    }

    // Insert some default coupons for testing
    try {
      await pool.query(`
        INSERT INTO coupons (code, name, storage_bonus, max_uses, expires_at) 
        VALUES 
          ('WELCOME200', 'Welcome Bonus - 200GB', 214748364800, 1000, NOW() + INTERVAL '1 year'),
          ('PREMIUM500', 'Premium Package - 500GB', 536870912000, 100, NOW() + INTERVAL '6 months'),
          ('BETA50', 'Beta Tester Bonus - 50GB', 53687091200, 500, NOW() + INTERVAL '3 months'),
          ('STUDENT100', 'Student Discount - 100GB', 107374182400, 200, NOW() + INTERVAL '1 year'),
          ('LAUNCH1TB', 'Launch Special - 1TB', 1099511627776, 50, NOW() + INTERVAL '3 months')
        ON CONFLICT (code) DO UPDATE SET 
          name = EXCLUDED.name,
          storage_bonus = EXCLUDED.storage_bonus;
      `);
      console.log('✅ Default coupons inserted successfully');
    } catch (error) {
      console.log('⚠️ Error inserting default coupons:', error.message);
    }

    // Add 2FA columns to users table if they don't exist
    try {
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS two_factor_secret VARCHAR(255);
      `);
      console.log('✅ 2FA columns added to users table successfully');
    } catch (error) {
      if (error.code !== '42701') {
        console.error('⚠️ Error adding 2FA columns:', error);
      }
    }

    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  }
};

module.exports = { pool, initializeDatabase };