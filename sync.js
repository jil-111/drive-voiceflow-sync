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
      console.log('🔍 Fetching recent files from Google Drive...');
      
      // Calculate 6 hours ago
      const sixHoursAgo = new Date();
      sixHoursAgo.setHours(sixHoursAgo.getHours() - 6);
      const isoTime = sixHoursAgo.toISOString();
      
      console.log(`📅 Looking for files modified after: ${isoTime}`);
      
      let allFiles = [];
      let pageToken = null;
      let pageCount = 0;
      
      do {
        const params = {
          q: `'${this.config.googleDriveFolderId}' in parents and trashed=false and modifiedTime > '${isoTime}'`,
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
        
        console.log(`📄 Page ${pageCount}: Found ${files.length} recent files (Total so far: ${allFiles.length})`);
        
      } while (pageToken);

      console.log(`📁 Total recent files found: ${allFiles.length}`);
      
      // Log sample files with modification dates
      if (allFiles.length > 0) {
        console.log(`📋 Recent files:`);
        allFiles.slice(0, 5).forEach((file, index) => {
          const modifiedTime = new Date(file.modifiedTime);
          console.log(`  ${index + 1}. ${file.name} (${modifiedTime.toLocaleString()})`);
        });
        if (allFiles.length > 5) {
          console.log(`  ... and ${allFiles.length - 5} more recent files`);
        }
      } else {
        console.log(`📭 No files have been modified in the last 6 hours`);
      }
      
      return allFiles;
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
      
      // Check if it's a Google Workspace file that needs to be exported
      if (this.isGoogleWorkspaceFile(mimeType)) {
        const exportFormat = this.getExportFormat(mimeType);
        const exportMimeType = exportFormat.mimeType;
        exportedFileName = `${fileName}.${exportFormat.extension}`;
        
        console.log(`📤 Exporting Google Workspace file: ${fileName} → ${exportedFileName}`);
        
        response = await this.drive.files.export({
          fileId: fileId,
          mimeType: exportMimeType
        }, { responseType: 'arraybuffer' }); // Explicitly request arraybuffer
        
      } else {
        // Regular file download
        response = await this.drive.files.get({
          fileId: fileId,
          alt: 'media'
        }, { responseType: 'arraybuffer' }); // Explicitly request arraybuffer
      }

      // Convert to Buffer if needed
      let fileBuffer;
      if (Buffer.isBuffer(response.data)) {
        fileBuffer = response.data;
      } else if (response.data instanceof ArrayBuffer) {
        fileBuffer = Buffer.from(response.data);
      } else if (response.data instanceof Blob) {
        // Handle Blob case
        const arrayBuffer = await response.data.arrayBuffer();
        fileBuffer = Buffer.from(arrayBuffer);
      } else {
        fileBuffer = Buffer.from(response.data);
      }

      console.log(`✅ Downloaded: ${exportedFileName} (${fileBuffer.length} bytes)`);
      
      return {
        content: fileBuffer,
        fileName: exportedFileName,
        originalMimeType: mimeType
      };
    } catch (error) {
      console.error(`❌ Error downloading ${fileName}:`, error.message);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Response type: ${typeof error.response.data}`);
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

  sanitizeFilename(filename) {
    // Remove or replace problematic characters in filenames
    return filename
      .replace(/[<>:"/\\|?*]/g, '-') // Replace invalid characters with dash
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/^\s+|\s+$/g, '') // Trim spaces from start/end
      .substring(0, 200); // Limit filename length
  }

  async uploadToVoiceflow(fileData, originalFile) {
    try {
      // Sanitize filename for better compatibility
      const sanitizedFilename = this.sanitizeFilename(fileData.fileName);
      console.log(`📤 Uploading to Voiceflow: ${sanitizedFilename}`);
      
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
        console.log(`⚠️ File too large (${buffer.length} bytes), skipping: ${sanitizedFilename}`);
        return { error: 'File too large', skipped: true };
      }
      
      formData.append('file', buffer, {
        filename: sanitizedFilename,
        contentType: this.getVoiceflowMimeType(sanitizedFilename, fileData.originalMimeType)
      });

      console.log(`📊 File size: ${buffer.length} bytes`);
      console.log(`📝 Content type: ${this.getVoiceflowMimeType(sanitizedFilename, fileData.originalMimeType)}`);

      const response = await axios.post(
        `${this.config.voiceflowApiUrl}/v1/knowledge-base/docs`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${this.config.voiceflowApiKey}`,
            ...formData.getHeaders()
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 120000, // Increased timeout to 2 minutes
          validateStatus: function (status) {
            return status < 500; // Don't throw for 4xx errors, only 5xx
          }
        }
      );

      if (response.status >= 400) {
        console.error(`❌ HTTP ${response.status} error uploading ${sanitizedFilename}`);
        console.error(`   Response: ${JSON.stringify(response.data)}`);
        return null;
      }

      console.log(`✅ Successfully uploaded to Voiceflow: ${sanitizedFilename}`);
      console.log(`   Document ID: ${response.data.documentID || response.data.id || 'N/A'}`);
      
      return response.data;
    } catch (error) {
      console.error(`❌ Error uploading ${fileData.fileName} to Voiceflow:`);
      
      if (error.code === 'ECONNABORTED') {
        console.error('   Error: Request timeout - file may be too large or connection is slow');
      } else if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        
        // Better error message parsing
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
        
        // Specific handling for 500 errors
        if (error.response.status === 500) {
          console.log(`🔄 Retrying upload for ${fileData.fileName} in 5 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Single retry attempt
          try {
            const retryResponse = await axios.post(
              `${this.config.voiceflowApiUrl}/v1/knowledge-base/docs`,
              formData,
              {
                headers: {
                  'Authorization': `Bearer ${this.config.voiceflowApiKey}`,
                  ...formData.getHeaders()
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                timeout: 120000
              }
            );
            console.log(`✅ Retry successful for: ${fileData.fileName}`);
            return retryResponse.data;
          } catch (retryError) {
            console.error(`❌ Retry also failed for ${fileData.fileName}`);
          }
        }
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
    console.log('🚀 Starting Google Drive to Voiceflow sync (Recent Files Only)...');
    console.log(`📅 Sync started at: ${new Date().toISOString()}`);
    
    try {
      // Initialize Google Drive
      await this.initializeDrive();
      
      // Get recent files from Drive (modified in last 6 hours)
      const files = await this.getFilesFromDrive();
      
      if (files.length === 0) {
        console.log('📭 No recent files found - nothing to sync');
        return;
      }

      let processedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      // Process each recent file
      for (const file of files) {
        console.log(`\n🔄 Processing recent file: ${file.name}`);
        console.log(`📅 Modified: ${new Date(file.modifiedTime).toLocaleString()}`);
        
        // Check if file type is supported
        if (!this.isFileSupported(file.mimeType)) {
          console.log(`⚠️  Skipping unsupported file type: ${file.mimeType}`);
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
            skippedCount++;
          } else {
            processedCount++;
          }
        } else {
          errorCount++;
        }
        
        // Add small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Final summary
      console.log('\n🎉 Recent files sync completed!');
      console.log(`📊 Summary:`);
      console.log(`   ✅ Processed: ${processedCount} files`);
      console.log(`   ⚠️  Skipped (unsupported/too large): ${skippedCount} files`);
      console.log(`   ❌ Errors: ${errorCount} files`);
      console.log(`📅 Sync finished at: ${new Date().toISOString()}`);
      
    } catch (error) {
      console.error('💥 Sync failed with error:', error.message);
      throw error;
    }
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
