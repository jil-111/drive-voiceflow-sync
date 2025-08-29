# 🔄 Google Drive to Voiceflow Sync

Automatically syncs new files from a Google Drive folder to Voiceflow Knowledge Base using GitHub Actions.

## 🚀 Features

- ✅ **Automated Sync**: Runs every 6 hours automatically
- ✅ **Multiple File Types**: Supports PDFs, Docs, Sheets, Text files
- ✅ **Error Handling**: Robust error handling with detailed logging
- ✅ **Manual Trigger**: Can be run manually from GitHub Actions
- ✅ **Zero Cost**: Completely free using GitHub Actions

## 📊 Supported File Types

- PDF documents (`.pdf`)
- Plain text files (`.txt`)
- Google Docs
- Google Sheets  
- Google Slides
- Microsoft Word documents (`.docx`)
- Microsoft Excel files (`.xlsx`)

## ⚙️ Setup

1. **Google Drive API**: Service account configured
2. **Voiceflow API**: API key configured
3. **GitHub Secrets**: All credentials stored securely
4. **Automation**: Scheduled to run every 6 hours

## 🔧 Manual Run

To run the sync manually:
1. Go to "Actions" tab in this repository
2. Click "🔄 Sync Drive to Voiceflow"
3. Click "Run workflow"

## 📈 Monitoring

Check the "Actions" tab to see:
- ✅ Successful sync runs
- ❌ Failed runs with error logs
- 📊 Number of files processed

## 🕐 Schedule

Currently runs **every 6 hours**. To change the frequency, edit the cron expression in `.github/workflows/sync.yml`.

---

*Last updated: $(date)*
