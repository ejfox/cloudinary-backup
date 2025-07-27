# Database System Documentation

## Overview

The Cloudinary Backup tool now includes a comprehensive SQLite database system that stores all photo metadata locally. This enables complete independence from Cloudinary and provides advanced photo management capabilities.

## Database Schema

### Core Tables

#### `photos` - Main photo metadata
- `id` - Auto-incrementing primary key
- `public_id` - Cloudinary public ID (unique)
- `format` - File format (jpg, png, etc.)
- `version` - Cloudinary version number
- `resource_type` - Type of resource (image, video, etc.)
- `resource_kind` - Kind of resource (upload, fetch, etc.)
- `created_at` - Upload timestamp
- `bytes` - File size in bytes
- `width/height` - Image dimensions
- `secure_url` - Cloudinary HTTPS URL
- `local_path` - Path to downloaded file
- `backup_date` - When backed up locally
- `checksum` - File integrity hash
- `is_downloaded` - Download status
- `download_failed` - Failure flag
- `failure_reason` - Error details

#### `backup_sessions` - Track backup operations
- Session type (scan/download)
- Start/completion timestamps
- Cloudinary cloud name
- Photo counts and statistics
- Notes and metadata

#### `failed_downloads` - Retry tracking
- Failed photo references
- Error messages and retry counts
- Last attempt timestamps

### Photography Features

#### `exif_data` - Camera metadata
- Camera make/model and lens info
- Shooting parameters (ISO, aperture, shutter speed)
- GPS coordinates
- Date taken

#### `photo_shoots` - Organize by sessions
- Shoot name, date, location
- Client information
- Descriptions

#### `collections` - Album organization
- Collection names and descriptions
- Many-to-many relationships with photos

#### `original_filenames` - Preserve upload names
- Original filename tracking
- Upload dates and path hints

### Data Integrity

#### `file_integrity` - Verify downloads
- Original vs downloaded checksums
- Verification status and dates
- File size validation

## Database Views

### `photos_with_tags` - Photos with tag aggregation
### `download_statistics` - Progress tracking
### `duplicate_candidates` - Find potential duplicates
### `photos_by_shoot` - Organize by photo sessions
### `folder_structure` - Extract organization from public_ids

## API Integration

### Rust Backend (`src-tauri/src/lib.rs`)

#### Database Operations
```rust
init_database(db_path: String) -> Result<(), String>
create_backup_session(db_path: String, session: BackupSession) -> Result<i64, String>
insert_photo_batch(db_path: String, photos: Vec<DatabasePhoto>) -> Result<(), String>
update_photo_download_status(db_path: String, public_id: String, ...) -> Result<(), String>
```

#### Async Handling
- Uses `tokio::spawn_blocking` for SQLite operations
- Proper error handling and type safety
- Batch operations for performance

### TypeScript Frontend (`src/database.ts`)

#### PhotoDatabase Class
```typescript
class PhotoDatabase {
  async init(dbPath: string): Promise<void>
  async insertPhotoBatch(photos: DatabasePhoto[]): Promise<void>
  async updatePhotoDownloadStatus(publicId: string, ...): Promise<void>
  async getDownloadStatistics(): Promise<DownloadStatistics>
}
```

## Usage Workflow

1. **Initialization**: Database created when folder selected
2. **Scanning**: All Cloudinary metadata stored during scan
3. **Download Tracking**: Status updated as files download
4. **Session Management**: Each operation tracked with timestamps
5. **Integrity Verification**: File hashes validated after download

## Performance Features

- **Indexed columns** for fast queries
- **Batch operations** for large photo collections
- **Views** for common query patterns
- **Triggers** for automatic data maintenance

## Future Enhancements

- Advanced duplicate detection algorithms
- Automatic EXIF extraction from downloaded files
- Photo shoot auto-detection from timestamps
- Export to other photo management systems
- Advanced search and filtering capabilities

## Schema Location

The complete database schema is in `schema.sql` at the project root.