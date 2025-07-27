-- SQLite schema for Cloudinary photo metadata backup
-- This enables full photo hosting service functionality

-- Main photos table - stores core image metadata
CREATE TABLE photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT UNIQUE NOT NULL,
    format TEXT NOT NULL,
    version INTEGER NOT NULL,
    resource_type TEXT NOT NULL,
    resource_kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    secure_url TEXT NOT NULL,
    local_path TEXT, -- path to downloaded file
    backup_date TEXT DEFAULT CURRENT_TIMESTAMP,
    checksum TEXT, -- file hash for integrity verification
    is_downloaded BOOLEAN DEFAULT FALSE,
    download_failed BOOLEAN DEFAULT FALSE,
    failure_reason TEXT
);

-- Tags table for many-to-many relationship
CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);

-- Photo tags junction table
CREATE TABLE photo_tags (
    photo_id INTEGER,
    tag_id INTEGER,
    PRIMARY KEY (photo_id, tag_id),
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Context metadata (key-value pairs)
CREATE TABLE photo_context (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id INTEGER,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
);

-- Collections/albums for organizing photos
CREATE TABLE collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Photo collections junction table
CREATE TABLE photo_collections (
    photo_id INTEGER,
    collection_id INTEGER,
    added_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (photo_id, collection_id),
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
    FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
);

-- Backup sessions to track when scans/downloads happened
CREATE TABLE backup_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_type TEXT NOT NULL, -- 'scan' or 'download'
    started_at TEXT NOT NULL,
    completed_at TEXT,
    cloudinary_cloud_name TEXT NOT NULL,
    total_photos INTEGER DEFAULT 0,
    successful_photos INTEGER DEFAULT 0,
    failed_photos INTEGER DEFAULT 0,
    total_bytes INTEGER DEFAULT 0,
    notes TEXT
);

-- Failed downloads for retry tracking
CREATE TABLE failed_downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id INTEGER,
    session_id INTEGER,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    last_attempt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES backup_sessions(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX idx_photos_public_id ON photos(public_id);
CREATE INDEX idx_photos_created_at ON photos(created_at);
CREATE INDEX idx_photos_format ON photos(format);
CREATE INDEX idx_photos_resource_type ON photos(resource_type);
CREATE INDEX idx_photos_is_downloaded ON photos(is_downloaded);
CREATE INDEX idx_photos_local_path ON photos(local_path);
CREATE INDEX idx_backup_sessions_type ON backup_sessions(session_type);
CREATE INDEX idx_backup_sessions_started ON backup_sessions(started_at);
CREATE INDEX idx_tags_name ON tags(name);

-- Views for common queries
CREATE VIEW photos_with_tags AS
SELECT 
    p.id,
    p.public_id,
    p.format,
    p.created_at,
    p.bytes,
    p.width,
    p.height,
    p.local_path,
    p.is_downloaded,
    GROUP_CONCAT(t.name, ',') as tags
FROM photos p
LEFT JOIN photo_tags pt ON p.id = pt.photo_id
LEFT JOIN tags t ON pt.tag_id = t.id
GROUP BY p.id;

CREATE VIEW download_statistics AS
SELECT 
    COUNT(*) as total_photos,
    SUM(CASE WHEN is_downloaded = 1 THEN 1 ELSE 0 END) as downloaded_photos,
    SUM(CASE WHEN download_failed = 1 THEN 1 ELSE 0 END) as failed_photos,
    SUM(bytes) as total_bytes,
    SUM(CASE WHEN is_downloaded = 1 THEN bytes ELSE 0 END) as downloaded_bytes,
    ROUND(SUM(CASE WHEN is_downloaded = 1 THEN 1.0 ELSE 0 END) * 100 / COUNT(*), 2) as download_percentage
FROM photos;

-- EXIF data preservation table
CREATE TABLE exif_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id INTEGER,
    camera_make TEXT,
    camera_model TEXT,
    lens TEXT,
    focal_length INTEGER,
    aperture TEXT,
    shutter_speed TEXT,
    iso INTEGER,
    date_taken TEXT,
    gps_latitude REAL,
    gps_longitude REAL,
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
);

-- Original filename tracking (many uploads lose original names)
CREATE TABLE original_filenames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id INTEGER,
    original_filename TEXT,
    upload_date TEXT,
    file_path_hint TEXT, -- hints from public_id structure
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
);

-- Photo shoots/sessions organization
CREATE TABLE photo_shoots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    shoot_date TEXT,
    location TEXT,
    client TEXT,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Link photos to shoots/sessions
CREATE TABLE photo_shoot_assignments (
    photo_id INTEGER,
    shoot_id INTEGER,
    assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (photo_id, shoot_id),
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
    FOREIGN KEY (shoot_id) REFERENCES photo_shoots(id) ON DELETE CASCADE
);

-- File integrity tracking
CREATE TABLE file_integrity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id INTEGER,
    original_checksum TEXT, -- from Cloudinary if available
    downloaded_checksum TEXT, -- computed after download
    checksum_verified BOOLEAN DEFAULT FALSE,
    verification_date TEXT,
    file_size_matches BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
);

-- Views for photographers
CREATE VIEW duplicate_candidates AS
SELECT 
    bytes,
    width,
    height,
    COUNT(*) as duplicate_count,
    GROUP_CONCAT(public_id, '; ') as public_ids
FROM photos 
GROUP BY bytes, width, height 
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

CREATE VIEW photos_by_shoot AS
SELECT 
    s.name as shoot_name,
    s.shoot_date,
    s.client,
    COUNT(p.id) as photo_count,
    SUM(p.bytes) as total_size,
    MIN(p.created_at) as earliest_photo,
    MAX(p.created_at) as latest_photo
FROM photo_shoots s
LEFT JOIN photo_shoot_assignments psa ON s.id = psa.shoot_id
LEFT JOIN photos p ON psa.photo_id = p.id
GROUP BY s.id, s.name, s.shoot_date, s.client
ORDER BY s.shoot_date DESC;

CREATE VIEW photos_missing_metadata AS
SELECT 
    p.id,
    p.public_id,
    p.created_at,
    CASE WHEN e.id IS NULL THEN 'No EXIF' ELSE NULL END as missing_exif,
    CASE WHEN o.id IS NULL THEN 'No original filename' ELSE NULL END as missing_filename,
    CASE WHEN psa.shoot_id IS NULL THEN 'Not assigned to shoot' ELSE NULL END as missing_shoot
FROM photos p
LEFT JOIN exif_data e ON p.id = e.photo_id
LEFT JOIN original_filenames o ON p.id = o.photo_id
LEFT JOIN photo_shoot_assignments psa ON p.id = psa.photo_id
WHERE e.id IS NULL OR o.id IS NULL OR psa.shoot_id IS NULL;

-- Folder structure extraction from public_ids
CREATE VIEW folder_structure AS
SELECT 
    CASE 
        WHEN public_id LIKE '%/%' THEN 
            SUBSTR(public_id, 1, INSTR(public_id, '/') - 1)
        ELSE 'root'
    END as folder_path,
    COUNT(*) as photo_count,
    SUM(bytes) as total_size
FROM photos
GROUP BY folder_path
ORDER BY photo_count DESC;

-- Sample triggers for data integrity
CREATE TRIGGER update_backup_session_stats 
AFTER UPDATE OF is_downloaded ON photos
BEGIN
    UPDATE backup_sessions 
    SET successful_photos = (
        SELECT COUNT(*) FROM photos WHERE is_downloaded = 1
    )
    WHERE id = (SELECT MAX(id) FROM backup_sessions WHERE session_type = 'download');
END;

-- Trigger to extract folder hints from public_id
CREATE TRIGGER extract_folder_hints
AFTER INSERT ON photos
BEGIN
    INSERT INTO original_filenames (photo_id, file_path_hint)
    VALUES (
        NEW.id,
        CASE 
            WHEN NEW.public_id LIKE '%/%' THEN NEW.public_id
            ELSE NULL
        END
    );
END;