import os
import io
import requests
from googleapiclient.discovery import build
from google.oauth2.service_account import Credentials
from googleapiclient.http import MediaIoBaseDownload
from googleapiclient.errors import HttpError
import time
import json
import tempfile
import re

# Try different PyPDF2 import methods for compatibility
try:
    from PyPDF2 import PdfReader, PdfWriter
    print("Using PyPDF2 v3+ imports")
except ImportError:
    try:
        from PyPDF2 import PdfFileReader as PdfReader, PdfFileWriter as PdfWriter
        print("Using PyPDF2 v1-2 imports")
    except ImportError:
        print("Warning: No PDF library available, PDF splitting will be disabled")
        PdfReader = None
        PdfWriter = None

# Try docx import
try:
    from docx import Document
    print("python-docx imported successfully")
except ImportError:
    print("Warning: python-docx not available, DOCX splitting will be disabled")
    Document = None

print("Starting Google Drive to Voiceflow sync script...")

class GoogleDriveVoiceflowSync:
    def __init__(self, service_account_file, voiceflow_api_key, drive_folder_id):
        print("Initializing GoogleDriveVoiceflowSync...")
        
        self.SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
        self.credentials = Credentials.from_service_account_file(service_account_file, scopes=self.SCOPES)
        self.drive_service = build('drive', 'v3', credentials=self.credentials)
        
        self.voiceflow_api_key = voiceflow_api_key
        self.drive_folder_id = drive_folder_id
        self.voiceflow_base_url = "https://api.voiceflow.com"
        
        self.supported_types = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword',
            'text/plain',
            'application/vnd.google-apps.document',
            'application/vnd.google-apps.presentation',
            'application/vnd.google-apps.spreadsheet',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'text/csv'
        ]
        
        print("Initialization complete!")
    
    def get_drive_files(self):
        print("Fetching files from Google Drive...")
        try:
            # Get all files from the specific folder
            query = f"'{self.drive_folder_id}' in parents and trashed=false"
            
            all_files = []
            page_token = None
            page_count = 0
            
            while True:
                page_count += 1
                results = self.drive_service.files().list(
                    q=query,
                    fields="nextPageToken, files(id, name, mimeType, modifiedTime)",
                    pageSize=100,
                    pageToken=page_token
                ).execute()
                
                files = results.get('files', [])
                all_files.extend(files)
                
                print(f"Page {page_count}: Found {len(files)} files (Total so far: {len(all_files)})")
                
                page_token = results.get('nextPageToken')
                if not page_token:
                    break
            
            # Filter for supported file types
            supported_files = [f for f in all_files if f['mimeType'] in self.supported_types]
            print(f"Total files: {len(all_files)}, Supported files: {len(supported_files)}")
            
            return supported_files
            
        except Exception as e:
            print(f"Error fetching Drive files: {e}")
            return []
    
    def download_file(self, file_id, file_name):
        print(f"  Downloading: {file_name}")
        try:
            file_info = self.drive_service.files().get(fileId=file_id, fields='mimeType').execute()
            original_mime_type = file_info['mimeType']
            
            export_map = {
                'application/vnd.google-apps.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.google-apps.presentation': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                'application/vnd.google-apps.spreadsheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            }
            
            if original_mime_type in export_map:
                upload_mime_type = export_map[original_mime_type]
                request = self.drive_service.files().export_media(fileId=file_id, mimeType=upload_mime_type)
            else:
                upload_mime_type = original_mime_type
                request = self.drive_service.files().get_media(fileId=file_id)
            
            file_content_io = io.BytesIO()
            downloader = MediaIoBaseDownload(file_content_io, request)
            
            done = False
            while not done:
                status, done = downloader.next_chunk()
            
            return file_content_io.getvalue(), upload_mime_type

        except HttpError as error:
            if error.resp.status == 403 and 'exportSizeLimitExceeded' in error.content.decode():
                print(f"  Export failed due to size limit. Retrying as plain text.")
                try:
                    text_request = self.drive_service.files().export_media(fileId=file_id, mimeType='text/plain')
                    text_content_io = io.BytesIO()
                    text_downloader = MediaIoBaseDownload(text_content_io, text_request)
                    done = False
                    while not done:
                        status, done = text_downloader.next_chunk()
                    return text_content_io.getvalue(), 'text/plain'
                except Exception as text_e:
                    print(f"  Fallback to plain text also failed: {text_e}")
                    return None, None
            else:
                print(f"  An HTTP error occurred: {error}")
                return None, None
        except Exception as e:
            print(f"  An unexpected error occurred: {e}")
            return None, None
    
    def sanitize_filename(self, filename, mime_type):
        extension_map = {
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
            'application/pdf': '.pdf',
            'text/plain': '.txt'
        }
        base_name, _ = os.path.splitext(filename)
        sanitized = re.sub(r'[^\w\s\-_]', '', base_name).strip()[:60]
        extension = extension_map.get(mime_type, '.bin')
        return (sanitized or "document") + extension

    def upload_to_voiceflow(self, file_content, file_name, mime_type):
        clean_filename = self.sanitize_filename(file_name, mime_type)
        print(f"  Uploading to Voiceflow: {clean_filename}")
        
        try:
            url = f"{self.voiceflow_base_url}/v1/knowledge-base/docs/upload"
            headers = {'Authorization': self.voiceflow_api_key}
            files = {'file': (clean_filename, file_content, mime_type)}
            response = requests.post(url, headers=headers, files=files)
            
            if response.status_code in [200, 201, 202]:
                return {"status": "success", "message": f"Successfully uploaded: {clean_filename}"}
            elif response.status_code == 409:
                return {"status": "success", "message": f"File already exists: {clean_filename} (skipping)"}
            else:
                return {"status": "failure", "message": f"Failed to upload {clean_filename}: {response.status_code} - {response.text[:100]}"}
                
        except Exception as e:
            return {"status": "failure", "message": f"Error uploading {clean_filename}: {e}"}
    
    def sync_documents(self):
        print("=" * 50)
        print("Starting Google Drive to Voiceflow sync...")
        print("=" * 50)
        
        files = self.get_drive_files()
        if not files:
            print("No files found to sync.")
            return
        
        print(f"Found {len(files)} files in Google Drive. Starting sync process...")
        
        successful_files = []
        failed_files = []
        
        for i, file in enumerate(files, 1):
            print(f"\n[{i}/{len(files)}] Processing: {file['name']}")
            
            file_content, upload_mime_type = self.download_file(file['id'], file['name'])
            
            if not file_content:
                print(f"  Download failed for {file['name']}. Skipping.")
                failed_files.append({"name": file['name'], "reason": "Download/Export Failed"})
                continue
            
            upload_result = self.upload_to_voiceflow(file_content, file['name'], upload_mime_type)
            print(f"  {upload_result['message']}")

            if upload_result['status'] == 'success':
                successful_files.append(file['name'])
            else:
                failed_files.append({"name": file['name'], "reason": upload_result['message']})
            
            time.sleep(1)  # Rate limiting
        
        # Final Summary Report
        print("\n" + "=" * 50)
        print("Sync Complete!")
        print("=" * 50)
        print(f"Total files processed: {len(files)}")
        print(f"Successful uploads: {len(successful_files)}")
        print(f"Failed uploads: {len(failed_files)}")
        
        if failed_files:
            print("\n--- FAILED FILES REPORT ---")
            print("The following files could not be uploaded:")
            for item in failed_files:
                print(f"- File: {item['name']}")
                print(f"  Reason: {item['reason']}")
        
        print("=" * 50)


def main():
    # Get configuration from environment variables
    SERVICE_ACCOUNT_FILE = 'voiceflow-service-account.json'
    VOICEFLOW_API_KEY = os.getenv('VOICEFLOW_API_KEY')
    DRIVE_FOLDER_ID = os.getenv('DRIVE_FOLDER_ID')

    if not VOICEFLOW_API_KEY:
        print("ERROR: VOICEFLOW_API_KEY environment variable not set")
        return

    if not DRIVE_FOLDER_ID:
        print("ERROR: DRIVE_FOLDER_ID environment variable not set")
        return

    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        print(f"ERROR: Service account file not found: {SERVICE_ACCOUNT_FILE}")
        return
    
    try:
        syncer = GoogleDriveVoiceflowSync(SERVICE_ACCOUNT_FILE, VOICEFLOW_API_KEY, DRIVE_FOLDER_ID)
        syncer.sync_documents()
    except Exception as e:
        print(f"An error occurred in the main execution: {e}")

if __name__ == "__main__":
    main()
