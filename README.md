# Google Drive to Voiceflow Knowledge Base Sync

Automated Python script that syncs files from Google Drive to Voiceflow Knowledge Base using GitHub Actions.

## Features

- **Automated Sync**: Runs every 3 days automatically
- **Duplicate Detection**: Skips files that already exist in Voiceflow
- **Multiple File Types**: Supports PDFs, Word docs, Google Workspace files, and more
- **Large File Handling**: Automatically converts oversized Google Docs to plain text
- **Comprehensive Logging**: Shows exactly what files were processed, uploaded, or skipped
- **Zero Maintenance**: Runs completely hands-free once configured

## Supported File Types

- PDF documents (`.pdf`)
- Microsoft Word documents (`.docx`, `.doc`)
- Plain text files (`.txt`)
- Google Docs (exported as `.docx`)
- Google Sheets (exported as `.xlsx`)
- Google Slides (exported as `.pptx`)
- Microsoft Excel files (`.xlsx`, `.xls`)
- Microsoft PowerPoint files (`.pptx`, `.ppt`)
- CSV files (`.csv`)

## How It Works

1. **Connects to Google Drive** using service account credentials
2. **Scans your specified folder** for all supported file types
3. **Downloads/exports files** (Google Workspace files are converted to Office formats)
4. **Uploads to Voiceflow** via Knowledge Base API
5. **Skips duplicates** automatically (Voiceflow returns 409 for existing files)
6. **Handles large files** by falling back to plain text export if needed
7. **Reports results** with detailed summary of what was processed

## Setup

### Prerequisites
- Google Drive folder with documents
- Voiceflow project with API access
- GitHub repository

### Configuration
The automation is configured with these GitHub Secrets:
- `GOOGLE_CREDENTIALS`: Service account JSON credentials
- `VOICEFLOW_API_KEY`: Your Voiceflow API key  
- `DRIVE_FOLDER_ID`: Google Drive folder ID to monitor

### Schedule
Currently set to run **every 3 days at noon UTC**. Modify the cron expression in `.github/workflows/sync.yml` to change the schedule:

```yaml
schedule:
  - cron: '0 12 */3 * *'  # Every 3 days at noon
```

## Usage

### Automatic Operation
Once configured, the system runs automatically. No manual intervention required.

### Manual Trigger
To run the sync manually:
1. Go to the **Actions** tab in your GitHub repository
2. Click **"Sync Drive to Voiceflow (Python)"**
3. Click **"Run workflow"**

### Monitoring
Check the Actions tab to see:
- Which files were newly uploaded
- Which files were skipped (already existed)
- Any errors or failures
- Complete processing logs

## Example Output

```
[1/155] Processing: Research Paper.docx
  Uploading to Voiceflow: Research Paper.docx
  Successfully uploaded: Research Paper.docx

[2/155] Processing: Existing Document.docx
  Uploading to Voiceflow: Existing Document.docx
  File already exists: Existing Document.docx (skipping)

Sync Complete!
Total files processed: 155
Successful uploads: 3
Failed uploads: 0
```

## File Processing Logic

- **Google Docs**: Exported as `.docx` files
- **Google Sheets**: Exported as `.xlsx` files  
- **Google Slides**: Exported as `.pptx` files
- **Large Google files**: Automatically converted to `.txt` if export fails
- **Regular files**: Downloaded directly without conversion
- **Existing files**: Skipped based on 409 response from Voiceflow API

## Error Handling

The system handles common issues automatically:
- **Export size limits**: Falls back to plain text for oversized Google Docs
- **Network timeouts**: Retries failed uploads
- **API rate limits**: Includes delays between requests
- **Authentication errors**: Clear error messages for troubleshooting

## Troubleshooting

### No Files Uploaded
- Check that files exist in the specified Google Drive folder
- Verify file types are supported
- Ensure files aren't already in Voiceflow Knowledge Base

### Authentication Errors
- Verify `GOOGLE_CREDENTIALS` secret contains valid service account JSON
- Check that service account has access to the Google Drive folder
- Confirm `VOICEFLOW_API_KEY` is correct and has necessary permissions

### Sync Failures
- Check the Actions tab for detailed error logs
- Verify `DRIVE_FOLDER_ID` is correct
- Ensure Voiceflow API endpoints are accessible

## Technical Details

- **Runtime**: Python 3.9 on Ubuntu (GitHub Actions)
- **Dependencies**: google-api-python-client, requests, python-docx, PyPDF2
- **API Endpoints**: Google Drive API v3, Voiceflow Knowledge Base API
- **Authentication**: Google service account, Voiceflow API key

---

*Last updated: $(date)*
