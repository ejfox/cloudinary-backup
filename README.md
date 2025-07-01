# cloudinary-backup

backup your cloudinary photos to an external drive. quick, dirty, effective.

## what it does
- fetches all your photos from cloudinary
- downloads them to your external ssd/drive
- exports metadata as json
- respects api limits (won't get you banned)
- shows progress and time estimates

## quickstart
```bash
git clone https://github.com/ejfox/cloudinary-backup.git
cd cloudinary-backup
npm install
npm run tauri dev
```

## build
```bash
npm run tauri build
```

## usage
1. enter your cloudinary api keys
2. select download folder (external drive)
3. click "fetch resources"
4. start download
5. profit

## features
- rate limited (100ms api, 200ms downloads)
- progress tracking with size estimates
- continues on individual file failures
- metadata export to json
- secure (no credentials saved to disk)

## requirements
- node.js 18+
- rust
- cloudinary account

built with tauri + typescript + rust
