const { google } = require('googleapis');
const axios = require('axios');
const FormData = require('form-data');

class DriveToVoiceflowSync {
  constructor() {
    // Get configuration from environment variables
    this.config = {
      googleCredentials: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
      googleDriveFolderId: process.env.DRIVE_FOLDER_ID,
      voiceflowApiKey: process.env.VOICEFLOW_API_KEY,
      voiceflowApiUrl: 'https://api.voiceflow.com'
    };
    
    console.log('🔧 Configuration loaded');
    console.log(`📁 Monitoring folder: ${this.config.googleDriveFolderId}`);
  }

  async initializeDrive() {
    try {
      const auth = new google.auth.GoogleAuth({
        credentials: this.config.googleCredentials,
        scopes: ['https://www.googleapis.com/auth/drive.readonly']
      });

      this.drive = google.drive({ version: 'v3', auth });
      console.log('✅ Google Drive API initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Google Drive API:', error.message);
      throw error;
    }
  }

  async getFilesFromDrive() {
    try {
      console.log('📁 Fetching all supported files from Google Drive...');
      
      let allFiles = [];
      let pageToken = null;
      let pageCount = 0;
      
      do {
        const params = {
          q: `'${this.config.googleDriveFolderId}' in parents and trashed=false`,
          fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
          orderBy: 'modifiedTime desc',
          pageSize: 100
        };
        
        if (pageToken) {
          params.pageToken = pageToken;
        }
        
        const response = await this.drive.files.list(params);
        const files = response.data.files || [];
        
        allFiles = allFiles.concat(files);
        pageToken = response.data.nextPageToken;
        pageCount++;
        
        console.log(`📄 Page ${pageCount}: Found ${files.length} files (Total so far: ${allFiles.length})`);
        
      } while (pageToken);

      console.log(`📁 Total files found in Google Drive folder: ${allFiles.length}`);
      
      // Filter only supported file types
      const supportedFiles = allFiles.filter(file => this.isFileSupported(file.mimeType));
      console.log(`📋 Supported files: ${supportedFiles.length} of ${allFiles.length}`);
      
      return supportedFiles;
    } catch (error) {
      console.error('❌ Error fetching files from Google Drive:', error.message);
      return [];
    }
  }

  async downloadFile(fileId, fileName, mimeType) {
    try {
      console.log(`⬇️ Downloading: ${fileName}`);
      
      let response;
      let exportedFileName = fileName;
      let finalMimeType = mimeType;
      
      // Check if it's a Google Workspace file that needs to be exported
      if (this.isGoogleWorkspaceFile(mimeType)) {
        const exportFormat = this.getExportFormat(mimeType);
        finalMimeType = exportFormat.mimeType;
        exportedFileName = `${fileName}.${exportFormat.extension}`;
        
        console.log(`📤 Exporting Google Workspace file: ${fileName} → ${exportedFileName}`);
        
        try {
          response = await this.drive.files.export({
            fileId: fileId,
            mimeType: finalMimeType
          }, { responseType: 'arraybuffer' });
        } catch (exportError) {
          // If export fails due to size limit, try plain text fallback
          if (exportError.message?.includes('exportSizeLimitExceeded') || 
              exportError.response?.status === 403) {
            console.log(`⚠️ Export failed due to size limit. Trying plain text fallback...`);
            
            try {
              response = await this.drive.files.export({
                fileId: fileId,
                mimeType: 'text/plain'
              }, { responseType: 'arraybuffer' });
              
              finalMimeType = 'text/plain';
              exportedFileName = `${fileName}.txt`;
              console.log(`📝 Fallback successful: ${exportedFileName}`);
            } catch (fallbackError) {
              console.error(`❌ Both export and fallback failed: ${fallbackError.message}`);
              return null;
            }
          } else {
            throw exportError;
          }
        }
        
      } else {
        // Regular file download
        response = await this.drive.files.get({
          fileId: fileId,
          alt: 'media'
        }, { responseType: 'arraybuffer' });
        finalMimeType = mimeType;
      }

      // Convert to Buffer
      let fileBuffer;
      if (Buffer.isBuffer(response.data)) {
        fileBuffer = response.data;
      } else if (response.data instanceof ArrayBuffer) {
        fileBuffer = Buffer.from(response.data);
      } else if (response.data instanceof Blob) {
        const arrayBuffer = await response.data.arrayBuffer();
        fileBuffer = Buffer.from(arrayBuffer);
      } else {
        fileBuffer = Buffer.from(response.data);
      }

      console.log(`✅ Downloaded: ${exportedFileName} (${fileBuffer.length} bytes)`);
      
      return {
        content: fileBuffer,
        fileName: exportedFileName,
        originalMimeType: finalMimeType
      };
    } catch (error) {
      console.error(`❌ Error downloading ${fileName}:`, error.message);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
      }
      return null;
    }
  }

  isGoogleWorkspaceFile(mimeType) {
    const googleWorkspaceTypes = [
      'application/vnd.google-apps.document',
      'application/vnd.google-apps.spreadsheet', 
      'application/vnd.google-apps.presentation'
    ];
    return googleWorkspaceTypes.includes(mimeType);
  }

  getExportFormat(mimeType) {
    const exportFormats = {
      'application/vnd.google-apps.document': {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx'
      },
      'application/vnd.google-apps.spreadsheet': {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 
        extension: 'xlsx'
      },
      'application/vnd.google-apps.presentation': {
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        extension: 'pptx'
      }
    };
    
    return exportFormats[mimeType] || { mimeType: 'application/pdf', extension: 'pdf' };
  }

  async getExistingVoiceflowFiles() {
    try {
      console.log('🔍 Fetching existing files from Voiceflow Knowledge Base...');
      
      const response = await axios.get(
        `${this.config.voiceflowApiUrl}/v1/knowledge-base/docs`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.voiceflowApiKey}`
          },
          timeout: 30000
        }
      );

      const existingFiles = response.data?.data || [];
      console.log(`📚 Found ${existingFiles.length} existing files in Voiceflow Knowledge Base`);
      
      // Create a map for quick lookup: filename -> file info
      const fileMap = new Map();
      existingFiles.forEach(file => {
        if (file.name) {
          fileMap.set(file.name.toLowerCase(), {
            id: file.documentID,
            name: file.name,
            updatedAt: file.updatedAt || file.createdAt
          });
        }
      });
      
      return fileMap;
    } catch (error) {
      console.error('⚠️ Error fetching existing Voiceflow files:', error.message);
      console.log('📝 Continuing without duplicate check - all files will be uploaded');
      return new Map(); // Return empty map so all files get uploaded
    }
  }

  shouldUploadFile(fileName, driveModifiedTime, existingFiles) {
    // Try multiple variations of the filename for matching
    const variations = [
      fileName.toLowerCase(),
      this.sanitizeFilename(fileName).toLowerCase(),
      fileName.replace(/['"]/g, '').toLowerCase(), // Remove quotes
      fileName.replace(/\s*\([^)]*\)\s*/g, '').toLowerCase(), // Remove parentheses content
      fileName.replace(/\s*\[[^\]]*\]\s*/g, '').toLowerCase()  // Remove bracket content
    ];
    
    console.log(`🔍 Checking variations for: ${fileName}`);
    variations.forEach((variation, index) => {
      console.log(`   ${index + 1}. "${variation}"`);
    });
    
    // Check if any variation exists in Voiceflow
    let existingFile = null;
    for (const variation of variations) {
      if (existingFiles.has(variation)) {
        existingFile = existingFiles.get(variation);
        console.log(`📝 Found match with variation: "${variation}"`);
        break;
      }
    }
    
    if (!existingFile) {
      console.log(`✨ New file: ${fileName}`);
      return true;
    }
    
    // Check if Drive file is newer than Voiceflow file
    if (driveModifiedTime && existingFile.updatedAt) {
      const driveTime = new Date(driveModifiedTime);
      const voiceflowTime = new Date(existingFile.updatedAt);
      
      if (driveTime > voiceflowTime) {
        console.log(`🔄 File updated since last sync: ${fileName}`);
        console.log(`   Drive: ${driveTime.toISOString()}`);
        console.log(`   Voiceflow: ${voiceflowTime.toISOString()}`);
        return true;
      }
    }
    
    console.log(`⏭️ File already up-to-date: ${fileName}`);
    return false;
  }

  async getExistingVoiceflowFiles() {
    try {
      console.log('🔍 Fetching existing files from Voiceflow Knowledge Base...');
      
      const response = await axios.get(
        `${this.config.voiceflowApiUrl}/v1/knowledge-base/docs`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.voiceflowApiKey}`
          },
          timeout: 30000
        }
      );

      const existingFiles = response.data?.data || [];
      console.log(`📚 Found ${existingFiles.length} existing files in Voiceflow Knowledge Base`);
      
      // Create a Set of existing filenames for quick lookup
      const existingNames = new Set();
      existingFiles.forEach(file => {
        if (file.name) {
          existingNames.add(file.name.toLowerCase());
          // Also add sanitized version
          const sanitized = this.sanitizeFilename(file.name).toLowerCase();
          existingNames.add(sanitized);
        }
      });
      
      console.log(`📋 Example existing files: ${Array.from(existingNames).slice(0, 3).join(', ')}`);
      return existingNames;
    } catch (error) {
      console.error('⚠️ Error fetching existing Voiceflow files:', error.message);
      if (error.response?.status === 401) {
        console.error('❌ Authentication failed - check your Voiceflow API key');
      }
      return new Set(); // Return empty set so all files get uploaded
    }
  }

  fileAlreadyExists(fileName, existingFiles) {
    const variations = [
      fileName.toLowerCase(),
      this.sanitizeFilename(fileName).toLowerCase(),
      fileName.replace(/['"]/g, '').toLowerCase(),
      fileName.replace(/\s*\([^)]*\)\s*/g, '').toLowerCase(),
      fileName.replace(/\s*\[[^\]]*\]\s*/g, '').toLowerCase()
    ];
    
    for (const variation of variations) {
      if (existingFiles.has(variation)) {
        console.log(`⚠️ File already exists (skipping): ${fileName}`);
        return true;
      }
    }
    return false;
  }

  async uploadToVoiceflow(fileData, originalFile) {
    try {
      // Sanitize filename for better compatibility
      const sanitizedFilename = this.sanitizeFilename(fileData.fileName);
      console.log(`Uploading to Voiceflow: ${sanitizedFilename}`);
      
      const formData = new FormData();
      
      // Ensure we have a proper Buffer
      let buffer;
      if (Buffer.isBuffer(fileData.content)) {
        buffer = fileData.content;
      } else {
        buffer = Buffer.from(fileData.content);
      }
      
      // Validate buffer
      if (!buffer || buffer.length === 0) {
        throw new Error('File content is empty or invalid');
      }
      
      // Check file size (Voiceflow might have limits)
      const maxSize = 50 * 1024 * 1024; // 50MB limit
      if (buffer.length > maxSize) {
        console.log(`File too large (${buffer.length} bytes), skipping: ${sanitizedFilename}`);
        return { error: 'File too large', skipped: true };
      }
      
      formData.append('file', buffer, {
        filename: sanitizedFilename,
        contentType: this.getVoiceflowMimeType(sanitizedFilename, fileData.originalMimeType)
      });

      console.log(`File size: ${buffer.length} bytes`);
      console.log(`Content type: ${this.getVoiceflowMimeType(sanitizedFilename, fileData.originalMimeType)}`);

      // Use the same endpoint as your Python script
      const response = await axios.post(
        `${this.config.voiceflowApiUrl}/v1/knowledge-base/docs/upload`,
        formData,
        {
          headers: {
            'Authorization': this.config.voiceflowApiKey, // No Bearer prefix like Python
            ...formData.getHeaders()
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 120000,
          validateStatus: function (status) {
            return status < 500; // Don't throw for 4xx errors, only 5xx
          }
        }
      );

      // Handle different success status codes like your Python script
      if ([200, 201, 202].includes(response.status)) {
        console.log(`Successfully uploaded to Voiceflow: ${sanitizedFilename}`);
        return response.data;
      } else if (response.status === 409) {
        console.log(`File already exists (skipping): ${sanitizedFilename}`);
        return { skipped: true };
      } else {
        console.error(`HTTP ${response.status} error uploading ${sanitizedFilename}`);
        console.error(`Response: ${JSON.stringify(response.data)}`);
        return null;
      }

    } catch (error) {
      console.error(`Error uploading ${fileData.fileName} to Voiceflow:`);
      
      if (error.code === 'ECONNABORTED') {
        console.error('   Error: Request timeout - file may be too large or connection is slow');
      } else if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        
        let errorMessage = 'Unknown error';
        if (typeof error.response.data === 'string') {
          if (error.response.data.includes('Internal Server Error')) {
            errorMessage = 'Voiceflow internal server error - this may be temporary';
          } else {
            errorMessage = error.response.data.substring(0, 200);
          }
        } else if (error.response.data && error.response.data.message) {
          errorMessage = error.response.data.message;
        }
        
        console.error(`   Message: ${errorMessage}`);
      } else {
        console.error(`   Error: ${error.message}`);
      }
      return null;
    }
  }

  getVoiceflowMimeType(fileName, originalMimeType) {
    // Map file extensions to proper MIME types for Voiceflow
    const extension = fileName.split('.').pop()?.toLowerCase();
    
    const mimeTypeMap = {
      'pdf': 'application/pdf',
      'txt': 'text/plain',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'doc': 'application/msword'
    };
    
    return mimeTypeMap[extension] || 'application/octet-stream';
  }

  isFileSupported(mimeType) {
    const supportedTypes = [
      'application/pdf',
      'text/plain',
      'application/vnd.google-apps.document',
      'application/vnd.google-apps.spreadsheet',
      'application/vnd.google-apps.presentation',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    return supportedTypes.includes(mimeType);
  }

  async sync() {
    console.log('Starting Google Drive to Voiceflow sync...');
    console.log(`Sync started at: ${new Date().toISOString()}`);
    
    try {
      // Initialize Google Drive
      await this.initializeDrive();
      
      // Skip duplicate checking for now due to API issues
      console.log('Skipping duplicate check due to API issues - will rely on 409 responses');
      
      // Get all files from Drive
      const files = await this.getFilesFromDrive();
      
      if (files.length === 0) {
        console.log('No files found in the specified folder');
        return;
      }

      let processedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      let alreadyExistsCount = 0;

      // Process each file (limit to first 5 for testing)
      const filesToProcess = files.slice(0, 5);
      console.log(`Testing with first ${filesToProcess.length} files...`);

      for (const file of filesToProcess) {
        console.log(`\nProcessing: ${file.name}`);
        
        // Check if file type is supported
        if (!this.isFileSupported(file.mimeType)) {
          console.log(`Skipping unsupported file type: ${file.mimeType}`);
          skippedCount++;
          continue;
        }

        // Download/Export file from Drive
        const fileData = await this.downloadFile(file.id, file.name, file.mimeType);
        if (!fileData) {
          errorCount++;
          continue;
        }

        // Upload to Voiceflow
        const result = await this.uploadToVoiceflow(fileData, file);
        if (result) {
          if (result.skipped) {
            alreadyExistsCount++;
          } else {
            processedCount++;
          }
        } else {
          errorCount++;
        }
        
        // Add delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Final summary
      console.log('\nSync completed!');
      console.log('Summary:');
      console.log(`   Processed: ${processedCount} files`);
      console.log(`   Already exists: ${alreadyExistsCount} files`);
      console.log(`   Skipped: ${skippedCount} files`);
      console.log(`   Errors: ${errorCount} files`);
      console.log(`Sync finished at: ${new Date().toISOString()}`);
      
    } catch (error) {
      console.error('Sync failed with error:', error.message);
      throw error;
    }
  }

  sanitizeFilename(filename) {
    // Remove or replace problematic characters in filenames
    return filename
      .replace(/[<>:"/\\|?*]/g, '-') // Replace invalid characters with dash
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/^\s+|\s+$/g, '') // Trim spaces from start/end
      .substring(0, 200); // Limit filename length
  }
}

// Main execution
async function main() {
  try {
    const sync = new DriveToVoiceflowSync();
    await sync.sync();
    process.exit(0);
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

// Only run if this file is executed directly (not imported)
if (require.main === module) {
  main();
}

module.exports = DriveToVoiceflowSync;
