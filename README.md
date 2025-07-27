# Cloudinary Backup

A desktop application to backup all your photos from Cloudinary with complete metadata preservation and photo management features.

## Features

- **Complete Backup**: Downloads all images from your Cloudinary account
- **SQLite Database**: Stores all metadata locally for complete independence from Cloudinary
- **Photography Tools**: Organize by shoots, detect duplicates, preserve EXIF data
- **Resume Support**: Automatically resumes interrupted downloads  
- **Progress Tracking**: Real-time progress with file counts and transfer speeds
- **Easy Folder Access**: "Open Photos Folder" button to quickly find your downloads
- **Cross-Platform**: Automated builds for macOS (ARM64/Intel), Windows, and Linux
- **User-Friendly**: Step-by-step guidance with clear instructions and emojis

## Quick Start

1. **Get your Cloudinary credentials**:
   - Go to [console.cloudinary.com](https://console.cloudinary.com) → Account Details
   - Copy your Cloud Name, API Key, and API Secret (click "Reveal" first)

2. **Download the app**:
   - Visit the [Releases page](https://github.com/ejfox/cloudinary-backup/releases)
   - Download the file for your platform

3. **Run the backup**:
   - 🔐 Enter your Cloudinary credentials  
   - 📁 Pick where to save photos
   - 🚀 Scan & download everything

## Installation

### macOS (Apple Silicon)
- Download `cloudinary-backup_aarch64.app.tar.gz`
- Extract and drag to Applications folder

### macOS (Intel)  
- Download `cloudinary-backup_0.2.0_aarch64.dmg`
- Open DMG and drag to Applications

### Windows
- Download `cloudinary-backup_0.2.0_x64-setup.exe`
- Run the installer

### Linux
- Ubuntu support coming soon (dependency issues being resolved)

## Database Features

The app creates a comprehensive SQLite database with:

- **Complete metadata** from all Cloudinary photos
- **Download tracking** and integrity verification
- **Photography organization** (shoots, collections, EXIF data)
- **Duplicate detection** based on file size and dimensions
- **Original filename preservation** 
- **Session tracking** for all backup operations

See [DATABASE.md](DATABASE.md) for full schema documentation.

## Development

Built with:
- [Tauri](https://tauri.app/) - Rust + TypeScript desktop framework
- [Vite](https://vitejs.dev/) - Frontend build tool  
- [SQLite](https://sqlite.org/) + [rusqlite](https://github.com/rusqlite/rusqlite) - Database
- [GitHub Actions](https://github.com/features/actions) - Automated CI/CD

### Setup
```bash
npm install
npm run tauri dev
```

### Build
```bash
npm run tauri build
```

### Release
Push a version tag to trigger automated builds:
```bash
git tag v0.3.0
git push origin v0.3.0
```

## Architecture

- **Frontend**: TypeScript + HTML/CSS with step-by-step UI
- **Backend**: Rust with Tauri for system integration
- **Database**: SQLite with comprehensive photo metadata schema
- **CI/CD**: GitHub Actions with multi-platform builds

## License

MIT License - see LICENSE file for details.