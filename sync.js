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

  async downloadFile(fileId, fileName) {
    try {
      console.log(`⬇️ Downloading: ${fileName}`);
      
      const response = await this.drive.files.get({
        fileId: fileId,
        alt: 'media'
      });

      console.log(`✅ Downloaded: ${fileName} (${response.data.length} bytes)`);
      
      return {
        content: response.data,
        fileName: fileName
      };
    } catch (error) {
      console.error(`❌ Error downloading ${fileName}:`, error.message);
      return null;
    }
  }

  async uploadToVoiceflow(fileData, originalFile) {
    try {
      console.log(`📤 Uploading to Voiceflow: ${fileData.fileName}`);
      
      const formData = new FormData();
      const buffer = Buffer.from(fileData.content);
      
      formData.append('file', buffer, {
        filename: fileData.fileName,
        contentType: this.getMimeType(originalFile.mimeType)
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

  getMimeType(googleMimeType) {
    const mimeTypeMap = {
      'application/vnd.google-apps.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.google-apps.spreadsheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.google-apps.presentation': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain': 'text/plain',
      'application/pdf': 'application/pdf',
      'application/msword': 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
    
    return mimeTypeMap[googleMimeType] || 'application/octet-stream';
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
      
      // Get files from Drive
      const files = await this.getFilesFromDrive();
      
      if (files.length === 0) {
        console.log('📭 No files found in the specified folder');
        return;
      }

      let processedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      // Process each file
      for (const file of files) {
        console.log(`\n🔄 Processing: ${file.name}`);
        
        // Check if file type is supported
        if (!this.isFileSupported(file.mimeType)) {
          console.log(`⚠️  Skipping unsupported file type: ${file.mimeType}`);
          skippedCount++;
          continue;
        }

        // Download file from Drive
        const fileData = await this.downloadFile(file.id, file.name);
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
      console.log(`   ⚠️  Skipped: ${skippedCount} files`);
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
