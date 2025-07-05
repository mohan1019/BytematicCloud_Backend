const B2 = require('backblaze-b2');

class BackblazeService {
  constructor() {
    this.b2 = new B2({
      applicationKeyId: process.env.B2_APPLICATION_KEY_ID,
      applicationKey: process.env.B2_APPLICATION_KEY,
    });
    this.bucketId = process.env.B2_BUCKET_ID;
    this.bucketName = process.env.B2_BUCKET_NAME;
    this.authorized = false;
  }

  async authorize() {
    if (this.authorized) return;
    
    try {
      await this.b2.authorize();
      this.authorized = true;
      console.log('✅ Backblaze B2 authorized successfully');
    } catch (error) {
      console.error('❌ Backblaze B2 authorization failed:', error);
      throw error;
    }
  }

  async uploadFile(fileBuffer, fileName, contentType) {
    try {
      await this.authorize();

      const uploadUrl = await this.b2.getUploadUrl({
        bucketId: this.bucketId,
      });

      const response = await this.b2.uploadFile({
        uploadUrl: uploadUrl.data.uploadUrl,
        uploadAuthToken: uploadUrl.data.authorizationToken,
        fileName: fileName,
        data: fileBuffer,
        info: {
          'src_last_modified_millis': Date.now().toString()
        },
        mime: contentType,
      });

      // Get the correct download URL from the authorization response
      const downloadUrl = this.b2.downloadUrl ? 
        `${this.b2.downloadUrl}/file/${this.bucketName}/${fileName}` :
        `https://f003.backblazeb2.com/file/${this.bucketName}/${fileName}`;

      return {
        fileId: response.data.fileId,
        fileName: response.data.fileName,
        downloadUrl: downloadUrl,
        contentType: response.data.contentType,
        size: response.data.contentLength
      };
    } catch (error) {
      console.error('Error uploading file to Backblaze:', error);
      throw error;
    }
  }

  async deleteFile(fileId, fileName) {
    try {
      await this.authorize();

      await this.b2.deleteFileVersion({
        fileId: fileId,
        fileName: fileName,
      });

      return true;
    } catch (error) {
      console.error('Error deleting file from Backblaze:', error);
      throw error;
    }
  }

  async getDownloadUrl(fileName) {
    try {
      await this.authorize();
      
      // For private buckets, we need to get a download authorization
      const downloadAuth = await this.b2.getDownloadAuthorization({
        bucketId: this.bucketId,
        fileNamePrefix: fileName,
        validDurationInSeconds: 3600 // 1 hour
      });
      
      const downloadUrl = this.b2.downloadUrl || 'https://f003.backblazeb2.com';
      return `${downloadUrl}/file/${this.bucketName}/${fileName}?Authorization=${downloadAuth.data.authorizationToken}`;
    } catch (error) {
      console.error('Error getting download URL:', error);
      // Fallback to simple URL for public buckets
      const downloadUrl = this.b2.downloadUrl || 'https://f003.backblazeb2.com';
      return `${downloadUrl}/file/${this.bucketName}/${fileName}`;
    }
  }

  async getFileInfo(fileName) {
    try {
      await this.authorize();
      
      const response = await this.b2.listFileNames({
        bucketId: this.bucketId,
        prefix: fileName,
        maxFileCount: 1
      });

      if (response.data.files.length > 0) {
        return response.data.files[0];
      }
      
      return null;
    } catch (error) {
      console.error('Error getting file info:', error);
      throw error;
    }
  }
}

module.exports = new BackblazeService();