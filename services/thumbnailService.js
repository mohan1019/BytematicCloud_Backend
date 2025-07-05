const sharp = require('sharp');
const crypto = require('crypto');
const path = require('path');
const backblazeService = require('../config/backblaze');

class ThumbnailService {
  constructor() {
    this.thumbnailSizes = {
      small: { width: 150, height: 150 },
      medium: { width: 300, height: 300 },
      large: { width: 600, height: 600 }
    };
  }

  async generateImageThumbnail(fileBuffer, originalName, size = 'medium') {
    try {
      const dimensions = this.thumbnailSizes[size];
      
      const thumbnailBuffer = await sharp(fileBuffer)
        .resize(dimensions.width, dimensions.height, {
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 80 })
        .toBuffer();

      return {
        buffer: thumbnailBuffer,
        mimeType: 'image/jpeg',
        size: thumbnailBuffer.length
      };
    } catch (error) {
      console.error('Error generating image thumbnail:', error);
      throw new Error('Failed to generate image thumbnail');
    }
  }

  async generateVideoThumbnail(fileBuffer, originalName, size = 'medium') {
    try {
      // For now, return a placeholder until we install ffmpeg
      // This will be implemented when ffmpeg packages are available
      return this.generatePlaceholderThumbnail('video', size);
    } catch (error) {
      console.error('Error generating video thumbnail:', error);
      throw new Error('Failed to generate video thumbnail');
    }
  }

  async generatePDFThumbnail(fileBuffer, originalName, size = 'medium') {
    try {
      // For now, return a placeholder until we install pdf-poppler
      // This will be implemented when pdf-poppler package is available
      return this.generatePlaceholderThumbnail('pdf', size);
    } catch (error) {
      console.error('Error generating PDF thumbnail:', error);
      throw new Error('Failed to generate PDF thumbnail');
    }
  }

  async generateDocumentThumbnail(fileBuffer, originalName, mimeType, size = 'medium') {
    try {
      // Generate placeholder for document types
      let docType = 'document';
      if (mimeType.includes('word')) docType = 'word';
      else if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) docType = 'excel';
      else if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) docType = 'powerpoint';
      
      return this.generatePlaceholderThumbnail(docType, size);
    } catch (error) {
      console.error('Error generating document thumbnail:', error);
      throw new Error('Failed to generate document thumbnail');
    }
  }

  generatePlaceholderThumbnail(type, size = 'medium') {
    const dimensions = this.thumbnailSizes[size];
    
    // Create a colored placeholder based on file type
    const colors = {
      video: { r: 255, g: 107, b: 107 }, // Red
      audio: { r: 156, g: 39, b: 176 }, // Purple
      pdf: { r: 255, g: 193, b: 7 }, // Yellow
      word: { r: 33, g: 150, b: 243 }, // Blue
      excel: { r: 76, g: 175, b: 80 }, // Green
      powerpoint: { r: 255, g: 152, b: 0 }, // Orange
      zip: { r: 121, g: 85, b: 72 }, // Brown
      code: { r: 96, g: 125, b: 139 }, // Blue-gray
      document: { r: 158, g: 158, b: 158 } // Gray
    };

    const color = colors[type] || colors.document;
    
    return sharp({
      create: {
        width: dimensions.width,
        height: dimensions.height,
        channels: 3,
        background: color
      }
    })
    .png()
    .toBuffer()
    .then(buffer => ({
      buffer,
      mimeType: 'image/png',
      size: buffer.length
    }));
  }

  async generateThumbnail(fileBuffer, originalName, mimeType, size = 'medium') {
    try {
      if (mimeType.startsWith('image/')) {
        return await this.generateImageThumbnail(fileBuffer, originalName, size);
      } else if (mimeType.startsWith('video/')) {
        return await this.generateVideoThumbnail(fileBuffer, originalName, size);
      } else if (mimeType.startsWith('audio/')) {
        return await this.generatePlaceholderThumbnail('audio', size);
      } else if (mimeType === 'application/pdf') {
        return await this.generatePDFThumbnail(fileBuffer, originalName, size);
      } else if (this.isDocumentType(mimeType)) {
        return await this.generateDocumentThumbnail(fileBuffer, originalName, mimeType, size);
      } else if (this.isArchiveType(mimeType)) {
        return await this.generatePlaceholderThumbnail('zip', size);
      } else if (this.isCodeType(mimeType)) {
        return await this.generatePlaceholderThumbnail('code', size);
      } else {
        return await this.generatePlaceholderThumbnail('document', size);
      }
    } catch (error) {
      console.error('Error generating thumbnail:', error);
      throw error;
    }
  }

  isDocumentType(mimeType) {
    const documentTypes = [
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'application/rtf',
      'text/csv'
    ];
    return documentTypes.includes(mimeType);
  }

  isArchiveType(mimeType) {
    const archiveTypes = [
      'application/zip',
      'application/x-rar-compressed',
      'application/x-7z-compressed',
      'application/x-tar',
      'application/gzip'
    ];
    return archiveTypes.includes(mimeType);
  }

  isCodeType(mimeType) {
    const codeTypes = [
      'text/html',
      'text/css',
      'application/javascript',
      'text/javascript',
      'application/json',
      'application/xml',
      'application/x-python-code',
      'text/x-java-source',
      'text/x-c',
      'text/x-php',
      'text/x-ruby',
      'application/x-sql',
      'text/markdown'
    ];
    return codeTypes.includes(mimeType) || mimeType.startsWith('text/');
  }

  async uploadThumbnail(thumbnailBuffer, originalFileName, mimeType) {
    try {
      const thumbnailExtension = mimeType === 'image/png' ? '.png' : '.jpg';
      const thumbnailName = `thumb_${crypto.randomUUID()}${thumbnailExtension}`;
      
      const uploadResult = await backblazeService.uploadFile(
        thumbnailBuffer,
        thumbnailName,
        mimeType
      );

      return {
        thumbnailName,
        thumbnailFileId: uploadResult.fileId,
        thumbnailUrl: uploadResult.downloadUrl
      };
    } catch (error) {
      console.error('Error uploading thumbnail:', error);
      throw new Error('Failed to upload thumbnail');
    }
  }

  async processAndUploadThumbnail(fileBuffer, originalName, mimeType, size = 'medium') {
    try {
      // Generate thumbnail
      const thumbnail = await this.generateThumbnail(fileBuffer, originalName, mimeType, size);
      
      // Upload thumbnail to Backblaze
      const uploadResult = await this.uploadThumbnail(thumbnail.buffer, originalName, thumbnail.mimeType);
      
      return {
        ...uploadResult,
        thumbnailSize: thumbnail.size
      };
    } catch (error) {
      console.error('Error processing and uploading thumbnail:', error);
      throw error;
    }
  }

  shouldGenerateThumbnail(mimeType) {
    const supportedTypes = [
      'image/',
      'video/',
      'audio/',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip',
      'application/x-rar-compressed',
      'application/x-7z-compressed',
      'text/plain',
      'text/html',
      'text/css',
      'application/javascript',
      'application/json',
      'application/xml'
    ];
    
    return supportedTypes.some(type => mimeType.startsWith(type) || mimeType === type);
  }
}

module.exports = new ThumbnailService();