const redis = require('redis');

class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.isProduction = process.env.NODE_ENV === 'production';
  }

  async connect() {
    try {
      if (this.isProduction) {
        // Use @upstash/redis for production
        const { Redis } = require('@upstash/redis');
        this.client = Redis.fromEnv()

        
        // Test connection
        await this.client.ping();
        this.isConnected = true;
        console.log('✅ Upstash Redis connected successfully');
      } else {
        // Use regular redis client for local development
        this.client = redis.createClient({
          url: process.env.REDIS_URL || 'redis://localhost:6379',
          password: process.env.REDIS_PASSWORD || undefined,
          socket: {
            connectTimeout: 10000,
            lazyConnect: true,
          },
          retry_strategy: (options) => {
            if (options.error && options.error.code === 'ECONNREFUSED') {
              console.log('Redis server connection refused');
              return new Error('Redis server connection refused');
            }
            if (options.total_retry_time > 1000 * 60 * 60) {
              return new Error('Retry time exhausted');
            }
            if (options.attempt > 10) {
              return undefined;
            }
            return Math.min(options.attempt * 100, 3000);
          }
        });

        this.client.on('error', (err) => {
          console.error('Redis Client Error:', err);
          this.isConnected = false;
        });

        this.client.on('connect', () => {
          console.log('✅ Redis connected successfully');
          this.isConnected = true;
        });

        this.client.on('reconnecting', () => {
          console.log('🔄 Redis reconnecting...');
        });

        await this.client.connect();
      }
    } catch (error) {
      console.warn('⚠️ Redis connection failed. Running without cache:', error.message);
      this.isConnected = false;
    }
  }

  async set(key, value, expireInSeconds = 3600) {
    if (!this.isConnected || !this.client) return false;
    
    try {
      const serializedValue = JSON.stringify(value);
      if (this.isProduction) {
        // Upstash Redis syntax
        await this.client.setex(key, expireInSeconds, serializedValue);
      } else {
        // Regular Redis syntax
        await this.client.setEx(key, expireInSeconds, serializedValue);
      }
      return true;
    } catch (error) {
      console.error('Redis SET error:', error);
      return false;
    }
  }

  async get(key) {
    if (!this.isConnected || !this.client) return null;
    
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('Redis GET error:', error);
      return null;
    }
  }

  async del(key) {
    if (!this.isConnected || !this.client) return false;
    
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error('Redis DEL error:', error);
      return false;
    }
  }

  async exists(key) {
    if (!this.isConnected || !this.client) return false;
    
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      console.error('Redis EXISTS error:', error);
      return false;
    }
  }

  // Cache file metadata
  async cacheFileMetadata(fileId, metadata, expireInSeconds = 3600) {
    return await this.set(`file:${fileId}`, metadata, expireInSeconds);
  }

  async getFileMetadata(fileId) {
    return await this.get(`file:${fileId}`);
  }

  // Cache file download URLs (short expiry to prevent stale URLs)
  async cacheDownloadUrl(fileId, url, expireInSeconds = 300) {
    return await this.set(`download:${fileId}`, url, expireInSeconds);
  }

  async getDownloadUrl(fileId) {
    return await this.get(`download:${fileId}`);
  }

  // Cache public share tokens
  async cachePublicShare(shareToken, fileData, expireInSeconds = 86400) {
    return await this.set(`public:${shareToken}`, fileData, expireInSeconds);
  }

  async getPublicShare(shareToken) {
    return await this.get(`public:${shareToken}`);
  }

  async invalidateFileCache(fileId) {
    await this.del(`file:${fileId}`);
    await this.del(`download:${fileId}`);
  }

  async disconnect() {
    if (this.client && !this.isProduction) {
      await this.client.disconnect();
      this.isConnected = false;
      console.log('📴 Redis disconnected');
    }
    // Note: Upstash Redis doesn't need explicit disconnection
  }
}

module.exports = new RedisService();