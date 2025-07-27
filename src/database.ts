import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";

export interface DatabasePhoto {
  id?: number;
  public_id: string;
  format: string;
  version: number;
  resource_type: string;
  resource_kind: string;
  created_at: string;
  bytes: number;
  width?: number;
  height?: number;
  secure_url: string;
  local_path?: string;
  backup_date?: string;
  checksum?: string;
  is_downloaded: boolean;
  download_failed: boolean;
  failure_reason?: string;
}

export interface BackupSession {
  id?: number;
  session_type: 'scan' | 'download';
  started_at: string;
  completed_at?: string;
  cloudinary_cloud_name: string;
  total_photos: number;
  successful_photos: number;
  failed_photos: number;
  total_bytes: number;
  notes?: string;
}

export interface PhotoTag {
  photo_id: number;
  tag_name: string;
}

export interface PhotoContext {
  photo_id: number;
  key: string;
  value: string;
}

export class PhotoDatabase {
  private dbPath: string = "";
  private isInitialized: boolean = false;

  constructor(private downloadPath: string) {}

  async initialize(): Promise<void> {
    try {
      this.dbPath = await join(this.downloadPath, "photos.db");
      
      // Create database and tables if they don't exist
      await invoke("init_database", { dbPath: this.dbPath });
      
      this.isInitialized = true;
      console.log(`Database initialized at: ${this.dbPath}`);
    } catch (error) {
      console.error("Failed to initialize database:", error);
      throw error;
    }
  }

  async createBackupSession(session: Omit<BackupSession, 'id'>): Promise<number> {
    if (!this.isInitialized) await this.initialize();
    
    return await invoke("create_backup_session", {
      dbPath: this.dbPath,
      session
    });
  }

  async updateBackupSession(sessionId: number, updates: Partial<BackupSession>): Promise<void> {
    if (!this.isInitialized) await this.initialize();
    
    await invoke("update_backup_session", {
      dbPath: this.dbPath,
      sessionId,
      updates
    });
  }

  async insertPhoto(photo: Omit<DatabasePhoto, 'id'>): Promise<number> {
    if (!this.isInitialized) await this.initialize();
    
    return await invoke("insert_photo", {
      dbPath: this.dbPath,
      photo
    });
  }

  async insertPhotoBatch(photos: Omit<DatabasePhoto, 'id'>[]): Promise<void> {
    if (!this.isInitialized) await this.initialize();
    
    return await invoke("insert_photo_batch", {
      dbPath: this.dbPath,
      photos
    });
  }

  async updatePhotoDownloadStatus(
    publicId: string,
    isDownloaded: boolean,
    localPath?: string,
    failureReason?: string
  ): Promise<void> {
    if (!this.isInitialized) await this.initialize();
    
    await invoke("update_photo_download_status", {
      dbPath: this.dbPath,
      publicId,
      isDownloaded,
      localPath,
      failureReason
    });
  }

  async insertTags(photoId: number, tags: string[]): Promise<void> {
    if (!this.isInitialized) await this.initialize();
    
    if (tags && tags.length > 0) {
      await invoke("insert_photo_tags", {
        dbPath: this.dbPath,
        photoId,
        tags
      });
    }
  }

  async insertContext(photoId: number, context: Record<string, string>): Promise<void> {
    if (!this.isInitialized) await this.initialize();
    
    if (context && Object.keys(context).length > 0) {
      await invoke("insert_photo_context", {
        dbPath: this.dbPath,
        photoId,
        context
      });
    }
  }

  async getPhotoByPublicId(publicId: string): Promise<DatabasePhoto | null> {
    if (!this.isInitialized) await this.initialize();
    
    return await invoke("get_photo_by_public_id", {
      dbPath: this.dbPath,
      publicId
    });
  }

  async getAllPhotos(limit?: number, offset?: number): Promise<DatabasePhoto[]> {
    if (!this.isInitialized) await this.initialize();
    
    return await invoke("get_all_photos", {
      dbPath: this.dbPath,
      limit,
      offset
    });
  }

  async getDownloadStatistics(): Promise<{
    total_photos: number;
    downloaded_photos: number;
    failed_photos: number;
    total_bytes: number;
    downloaded_bytes: number;
    download_percentage: number;
  }> {
    if (!this.isInitialized) await this.initialize();
    
    return await invoke("get_download_statistics", {
      dbPath: this.dbPath
    });
  }

  async searchPhotos(query: {
    tags?: string[];
    format?: string;
    dateFrom?: string;
    dateTo?: string;
    minBytes?: number;
    maxBytes?: number;
    isDownloaded?: boolean;
  }): Promise<DatabasePhoto[]> {
    if (!this.isInitialized) await this.initialize();
    
    return await invoke("search_photos", {
      dbPath: this.dbPath,
      query
    });
  }

  async exportToJson(outputPath: string): Promise<void> {
    if (!this.isInitialized) await this.initialize();
    
    await invoke("export_database_to_json", {
      dbPath: this.dbPath,
      outputPath
    });
  }

  async getBackupSessions(): Promise<BackupSession[]> {
    if (!this.isInitialized) await this.initialize();
    
    return await invoke("get_backup_sessions", {
      dbPath: this.dbPath
    });
  }

  async vacuum(): Promise<void> {
    if (!this.isInitialized) await this.initialize();
    
    await invoke("vacuum_database", {
      dbPath: this.dbPath
    });
  }
}

export default PhotoDatabase;