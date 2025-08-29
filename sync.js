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
      console.log('🔍 Fetching files from Google Drive...');
      
      const response = await this.drive.files.list({
        q: `'${this.config.googleDriveFolderId}' in parents and trashed=false`,
        fields: 'files(id, name, mimeType, modifiedTime, size)',
        orderBy: 'modifiedTime desc'
      });

      const files = response.data.files || [];
      console.log(`📁 Found ${files.length} files in Google Drive folder`);
      
      // Log each file for debugging
      files.forEach(file => {
        console.log(`  📄 ${file.name} (${file.mimeType})`);
      });
      
      return files;
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
        });
        
      } else {
        // Regular file download
        response = await this.drive.files.get({
          fileId: fileId,
          alt: 'media'
        });
      }

      console.log(`✅ Downloaded: ${exportedFileName} (${response.data.length || 'unknown'} bytes)`);
      
      return {
        content: response.data,
        fileName: exportedFileName,
        originalMimeType: mimeType
      };
    } catch (error) {
      console.error(`❌ Error downloading ${fileName}:`, error.message);
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
    const normalizedFileName = fileName.toLowerCase();
    const existingFile = existingFiles.get(normalizedFileName);
    
    if (!existingFile) {
      console.log(`✨ New file: ${fileName}`);
      return true;
    }
    
    // Check if Drive file is newer than Voiceflow file
    const driveTime = new Date(driveModifiedTime);
    const voiceflowTime = new Date(existingFile.updatedAt);
    
    if (driveTime > voiceflowTime) {
      console.log(`🔄 File updated since last sync: ${fileName}`);
      console.log(`   Drive: ${driveTime.toISOString()}`);
      console.log(`   Voiceflow: ${voiceflowTime.toISOString()}`);
      return true;
    }
    
    console.log(`⏭️ File already up-to-date: ${fileName}`);
    return false;
  }

  async uploadToVoiceflow(fileData, originalFile) {
    try {
      console.log(`📤 Uploading to Voiceflow: ${fileData.fileName}`);
      
      const formData = new FormData();
      const buffer = Buffer.from(fileData.content);
      
      formData.append('file', buffer, {
        filename: fileData.fileName,
        contentType: this.getVoiceflowMimeType(fileData.fileName, fileData.originalMimeType)
      });

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
          timeout: 60000 // 60 second timeout
        }
      );

      console.log(`✅ Successfully uploaded to Voiceflow: ${fileData.fileName}`);
      console.log(`   Document ID: ${response.data.documentID || 'N/A'}`);
      
      return response.data;
    } catch (error) {
      console.error(`❌ Error uploading ${fileData.fileName} to Voiceflow:`);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Message: ${JSON.stringify(error.response.data)}`);
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
    console.log('🚀 Starting Google Drive to Voiceflow sync...');
    console.log(`📅 Sync started at: ${new Date().toISOString()}`);
    
    try {
      // Initialize Google Drive
      await this.initializeDrive();
      
      // Get existing files from Voiceflow (for duplicate checking)
      const existingFiles = await this.getExistingVoiceflowFiles();
      
      // Get files from Drive
      const files = await this.getFilesFromDrive();
      
      if (files.length === 0) {
        console.log('📭 No files found in the specified folder');
        return;
      }

      let processedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      let duplicateCount = 0;

      // Process each file
      for (const file of files) {
        console.log(`\n🔄 Processing: ${file.name}`);
        
        // Check if file type is supported
        if (!this.isFileSupported(file.mimeType)) {
          console.log(`⚠️  Skipping unsupported file type: ${file.mimeType}`);
          skippedCount++;
          continue;
        }

        // Determine the final filename (after export if needed)
        let finalFileName = file.name;
        if (this.isGoogleWorkspaceFile(file.mimeType)) {
          const exportFormat = this.getExportFormat(file.mimeType);
          finalFileName = `${file.name}.${exportFormat.extension}`;
        }

        // Check if we need to upload this file
        if (!this.shouldUploadFile(finalFileName, file.modifiedTime, existingFiles)) {
          duplicateCount++;
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
          processedCount++;
        } else {
          errorCount++;
        }
        
        // Add small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Final summary
      console.log('\n🎉 Sync completed!');
      console.log(`📊 Summary:`);
      console.log(`   ✅ Processed: ${processedCount} files`);
      console.log(`   ⏭️ Already up-to-date: ${duplicateCount} files`);
      console.log(`   ⚠️  Skipped (unsupported): ${skippedCount} files`);
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
