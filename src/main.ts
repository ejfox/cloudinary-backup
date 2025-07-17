import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { join, documentDir } from "@tauri-apps/api/path";

interface CloudinaryResource {
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
  tags?: string[];
  context?: Record<string, string>;
}

interface CloudinaryResponse {
  resources: CloudinaryResource[];
  next_cursor?: string;
  rate_limit_allowed?: number;
  rate_limit_remaining?: number;
  rate_limit_reset_at?: string;
}

interface DownloadProgress {
  total: number;
  downloaded: number;
  current_file: string;
  status: string;
}

let allResources: CloudinaryResource[] = [];
let downloadPath: string = "";
let totalBytes: number = 0;
let downloadedBytes: number = 0;
let downloadStartTime: number = 0;

// Download state management
interface DownloadState {
  downloadedFiles: string[];
  failedFiles: { resource: CloudinaryResource; error: string; retryCount: number }[];
  totalFiles: number;
  startTime: number;
  lastSaveTime: number;
}

// Scan state management
interface ScanState {
  resources: CloudinaryResource[];
  totalBytes: number;
  scanTime: number;
  cloudName: string;
  apiKey: string; // Store hash for validation
  validatedResourceCount: number;
  invalidatedResourceCount: number;
}

let scanState: ScanState = {
  resources: [],
  totalBytes: 0,
  scanTime: 0,
  cloudName: '',
  apiKey: '',
  validatedResourceCount: 0,
  invalidatedResourceCount: 0
};

// Simple hash function for API key validation
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString();
}

// Save scan state to localStorage
function saveScanState(validCount: number = 0, invalidCount: number = 0) {
  const cloudName = (document.getElementById("cloud-name") as HTMLInputElement).value;
  const apiKey = (document.getElementById("api-key") as HTMLInputElement).value;
  
  const stateToSave: ScanState = {
    resources: allResources,
    totalBytes,
    scanTime: Date.now(),
    cloudName,
    apiKey: hashString(apiKey), // Store hash for validation
    validatedResourceCount: validCount || allResources.length,
    invalidatedResourceCount: invalidCount
  };
  
  localStorage.setItem('cloudinary-scan-state', JSON.stringify(stateToSave));
}

// Load scan state from localStorage
function loadScanState(): boolean {
  const saved = localStorage.getItem('cloudinary-scan-state');
  if (!saved) return false;
  
  try {
    const parsed: ScanState = JSON.parse(saved);
    const currentCloudName = (document.getElementById("cloud-name") as HTMLInputElement).value;
    const currentApiKey = (document.getElementById("api-key") as HTMLInputElement).value;
    
    // Validate that credentials match
    if (parsed.cloudName !== currentCloudName || parsed.apiKey !== hashString(currentApiKey)) {
      localStorage.removeItem('cloudinary-scan-state');
      return false;
    }
    
    // Check if scan is recent (within 1 hour)
    const hoursSinceScan = (Date.now() - parsed.scanTime) / (1000 * 60 * 60);
    if (hoursSinceScan > 1) {
      // Scan is old, ask user if they want to use it
      const useOldScan = confirm(`Found a previous scan from ${formatTimeAgo(parsed.scanTime)} with ${parsed.resources.length} photos. Use this scan or scan again?`);
      if (!useOldScan) {
        localStorage.removeItem('cloudinary-scan-state');
        return false;
      }
    }
    
    // Load the saved scan
    allResources = parsed.resources;
    totalBytes = parsed.totalBytes;
    scanState = parsed;
    
    const invalidCount = parsed.invalidatedResourceCount || 0;
    logMessage(`Loaded previous scan: ${allResources.length} accessible resources (${formatBytes(totalBytes)})`);
    if (invalidCount > 0) {
      logMessage(`Previous scan filtered out ${invalidCount} deleted/inaccessible files`);
      showToast(`Loaded previous scan (${allResources.length} accessible photos, ${invalidCount} deleted files filtered)`, 'info');
    } else {
      showToast(`Loaded previous scan (${allResources.length} photos)`, 'info');
    }
    
    return true;
  } catch (error) {
    console.error("Error loading scan state:", error);
    localStorage.removeItem('cloudinary-scan-state');
    return false;
  }
}

// Clear scan state (utility function for potential future use)
const clearScanState = () => {
  localStorage.removeItem('cloudinary-scan-state');
  scanState = {
    resources: [],
    totalBytes: 0,
    scanTime: 0,
    cloudName: '',
    apiKey: '',
    validatedResourceCount: 0,
    invalidatedResourceCount: 0
  };
};

// Export to window for debugging (only in development)
if (typeof window !== 'undefined') {
  (window as any).clearScanState = clearScanState;
}

// Utility function for clearing scan state (kept for potential future use)

// Format time ago helper
function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 60) {
    return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }
}

let downloadState: DownloadState = {
  downloadedFiles: [],
  failedFiles: [],
  totalFiles: 0,
  startTime: 0,
  lastSaveTime: 0
};

// Save download state to localStorage
function saveDownloadState() {
  const stateToSave = {
    ...downloadState,
    downloadPath,
    totalBytes,
    downloadedBytes,
    lastSaveTime: Date.now()
  };
  localStorage.setItem('cloudinary-download-state', JSON.stringify(stateToSave));
}

// Load download state from localStorage
function loadDownloadState(): boolean {
  const saved = localStorage.getItem('cloudinary-download-state');
  if (!saved) return false;
  
  try {
    const parsed = JSON.parse(saved);
    
    // Check if state is recent (within 24 hours)
    const hoursSinceLastSave = (Date.now() - parsed.lastSaveTime) / (1000 * 60 * 60);
    if (hoursSinceLastSave > 24) {
      localStorage.removeItem('cloudinary-download-state');
      return false;
    }
    
    downloadState = {
      downloadedFiles: parsed.downloadedFiles || [],
      failedFiles: parsed.failedFiles || [],
      totalFiles: parsed.totalFiles || 0,
      startTime: parsed.startTime || 0,
      lastSaveTime: parsed.lastSaveTime || 0
    };
    
    downloadPath = parsed.downloadPath || "";
    totalBytes = parsed.totalBytes || 0;
    downloadedBytes = parsed.downloadedBytes || 0;
    
    return true;
  } catch (error) {
    console.error("Error loading download state:", error);
    localStorage.removeItem('cloudinary-download-state');
    return false;
  }
}

// Clear download state
function clearDownloadState() {
  localStorage.removeItem('cloudinary-download-state');
  downloadState = {
    downloadedFiles: [],
    failedFiles: [],
    totalFiles: 0,
    startTime: 0,
    lastSaveTime: 0
  };
}

// Extract filename from Cloudinary URL
function getFilenameFromUrl(resource: CloudinaryResource): string {
  try {
    // For download filename, use public_id as the base since that's what Cloudinary uses
    const publicId = resource.public_id.replace(/[\/\\]/g, '_');
    return `${publicId}.${resource.format}`;
  } catch (error) {
    // Fallback to public_id + format
    return `${resource.public_id.replace(/[\/\\]/g, '_')}.${resource.format}`;
  }
}

// Create a proper download URL based on the resource (utility function for potential future use)
const getDownloadUrl = (resource: CloudinaryResource): string => {
  // Use the secure_url as provided by the API
  return resource.secure_url;
};

// Export to window for debugging (only in development)
if (typeof window !== 'undefined') {
  (window as any).getDownloadUrl = getDownloadUrl;
}

// Utility function for creating download URLs (kept for potential future use)

// Check if a resource URL is valid before attempting download
async function isResourceUrlValid(resource: CloudinaryResource): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(resource.secure_url, { 
      method: 'HEAD',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    return false;
  }
}

// Validate multiple resources in batches
async function validateResourcesBatch(resources: CloudinaryResource[], batchSize: number = 10): Promise<{
  valid: CloudinaryResource[];
  invalid: CloudinaryResource[];
}> {
  const valid: CloudinaryResource[] = [];
  const invalid: CloudinaryResource[] = [];
  
  for (let i = 0; i < resources.length; i += batchSize) {
    const batch = resources.slice(i, i + batchSize);
    
    const validationPromises = batch.map(async (resource) => {
      const isValid = await isResourceUrlValid(resource);
      return { resource, isValid };
    });
    
    const results = await Promise.all(validationPromises);
    
    results.forEach(({ resource, isValid }) => {
      if (isValid) {
        valid.push(resource);
      } else {
        invalid.push(resource);
      }
    });
    
    // Update progress
    const progress = Math.min(i + batchSize, resources.length);
    updateScanningMessage(`validating files...`, `${progress}/${resources.length} checked`);
    
    // Small delay to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return { valid, invalid };
}

// Retry logic with exponential backoff
async function downloadWithRetry(resource: CloudinaryResource, maxRetries: number = 3): Promise<boolean> {
  const fileName = getFilenameFromUrl(resource);
  const filePath = `${downloadPath}/${fileName}`;
  
  // Check if file already exists and has correct size
  try {
    const exists = await invoke("file_exists", { path: filePath });
    if (exists) {
      const fileSize = await invoke("get_file_size", { path: filePath });
      if (fileSize === resource.bytes) {
        logMessage(`Skipping ${fileName} (already exists with correct size)`);
        // Still count as downloaded and add to state
        if (!downloadState.downloadedFiles.includes(fileName)) {
          downloadState.downloadedFiles.push(fileName);
          downloadedBytes += resource.bytes;
        }
        return true;
      } else {
        logMessage(`Re-downloading ${fileName} (size mismatch: ${fileSize} vs ${resource.bytes})`);
      }
    }
  } catch (error) {
    // File doesn't exist, continue with download
  }
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Check if download was cancelled
    if (downloadCancelled) {
      return false;
    }
    
    try {
      await invoke("download_resource", {
        url: resource.secure_url,
        filePath: filePath,
      });
      
      downloadedBytes += resource.bytes;
      downloadState.downloadedFiles.push(fileName);
      
      // Save state every 10 downloads
      if (downloadState.downloadedFiles.length % 10 === 0) {
        saveDownloadState();
      }
      
      return true;
    } catch (error) {
      const errorStr = String(error);
      
      // Don't retry 404 errors - file doesn't exist on Cloudinary
      if (errorStr.includes('404')) {
        logMessage(`File not found on Cloudinary: ${fileName} (deleted from Cloudinary)`);
        downloadState.failedFiles.push({
          resource,
          error: "File deleted from Cloudinary (404)",
          retryCount: attempt + 1
        });
        return false;
      }
      
      // Exponential backoff for other errors
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
      logMessage(`Attempt ${attempt + 1} failed for ${fileName}: ${error}. Retrying in ${delay}ms...`);
      
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        downloadState.failedFiles.push({
          resource,
          error: errorStr,
          retryCount: attempt + 1
        });
        logMessage(`Error downloading ${fileName}: ${error}`);
        return false;
      }
    }
  }
  
  return false;
}

// Check if download can be resumed
function canResumeDownload(): boolean {
  return downloadState.downloadedFiles.length > 0 && 
         downloadState.totalFiles > 0 && 
         downloadPath !== "";
}

// Analyze download folder for existing files
async function analyzeDownloadFolder(): Promise<{
  totalFiles: number;
  existingFiles: number;
  missingFiles: number;
  percentage: number;
  existingFileNames: string[];
  missingFileNames: string[];
}> {
  if (!downloadPath || allResources.length === 0) {
    return {
      totalFiles: 0,
      existingFiles: 0,
      missingFiles: 0,
      percentage: 0,
      existingFileNames: [],
      missingFileNames: []
    };
  }

  const totalFiles = allResources.length;
  const existingFileNames: string[] = [];
  const missingFileNames: string[] = [];

  for (const resource of allResources) {
    const fileName = getFilenameFromUrl(resource);
    const filePath = `${downloadPath}/${fileName}`;
    
    try {
      const exists = await invoke("file_exists", { path: filePath });
      if (exists) {
        const fileSize = await invoke("get_file_size", { path: filePath });
        if (fileSize === resource.bytes) {
          existingFileNames.push(fileName);
        } else {
          missingFileNames.push(fileName);
        }
      } else {
        missingFileNames.push(fileName);
      }
    } catch (error) {
      missingFileNames.push(fileName);
    }
  }

  const existingFiles = existingFileNames.length;
  const missingFiles = missingFileNames.length;
  const percentage = totalFiles > 0 ? (existingFiles / totalFiles) * 100 : 0;

  return {
    totalFiles,
    existingFiles,
    missingFiles,
    percentage,
    existingFileNames,
    missingFileNames
  };
}

// Step management
let currentStep = 1;
let isScanning = false;
let downloadCancelled = false;

// Toast notifications
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  
  container.appendChild(toast);
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 3000);
}

// Scanning status
function showScanningStatus() {
  const scanningStatus = document.getElementById('scanning-status');
  if (scanningStatus) {
    scanningStatus.style.display = 'block';
  }
}

function hideScanningStatus() {
  const scanningStatus = document.getElementById('scanning-status');
  if (scanningStatus) {
    scanningStatus.style.display = 'none';
  }
}

function updateScanningMessage(message: string, count?: string) {
  const scanningMessage = document.getElementById('scanning-message');
  const scanningCount = document.getElementById('scanning-count');
  
  if (scanningMessage) {
    scanningMessage.textContent = message;
  }
  
  if (scanningCount && count) {
    scanningCount.textContent = count;
  }
}

// Button loading states
function setButtonLoading(buttonId: string, loading: boolean) {
  const button = document.getElementById(buttonId) as HTMLButtonElement;
  if (button) {
    if (loading) {
      button.classList.add('loading');
      button.disabled = true;
    } else {
      button.classList.remove('loading');
      button.disabled = false;
    }
  }
}

// Cancel download
function cancelDownload() {
  downloadCancelled = true;
  downloadCancelled = false;
  
  logMessage("Download cancelled by user");
  showToast("Download cancelled", 'info');
  
  // Reset UI
  const downloadButton = document.getElementById("start-download") as HTMLButtonElement;
  const cancelButton = document.getElementById("cancel-download") as HTMLButtonElement;
  
  downloadButton.disabled = false;
  cancelButton.style.display = 'none';
  setButtonLoading('start-download', false);
  
  updateUI();
}

// Analyze download folder and update UI
async function analyzeFolder() {
  if (!downloadPath || allResources.length === 0) {
    showToast("Please scan for photos and select a download folder first", 'error');
    return;
  }

  setButtonLoading('analyze-folder', true);
  showToast("Analyzing download folder...", 'info');
  
  try {
    const analysis = await analyzeDownloadFolder();
    
    // Update UI with analysis results
    document.getElementById("analysis-folder-path")!.textContent = downloadPath;
    document.getElementById("analysis-existing-count")!.textContent = 
      `${analysis.existingFiles} of ${analysis.totalFiles} files`;
    document.getElementById("analysis-missing-count")!.textContent = 
      `${analysis.missingFiles} files`;
    document.getElementById("analysis-percentage")!.textContent = 
      `${analysis.percentage.toFixed(1)}%`;
    
    // Show download missing button if there are missing files
    const downloadMissingButton = document.getElementById("download-missing") as HTMLButtonElement;
    if (analysis.missingFiles > 0) {
      downloadMissingButton.style.display = 'block';
      downloadMissingButton.textContent = `download ${analysis.missingFiles} missing files`;
    } else {
      downloadMissingButton.style.display = 'none';
    }
    
    // Show the analysis section
    const analysisSection = document.getElementById("download-folder-status") as HTMLElement;
    analysisSection.style.display = 'block';
    
    // Log detailed analysis
    logMessage(`Folder analysis complete:`);
    logMessage(`- Total files expected: ${analysis.totalFiles}`);
    logMessage(`- Files already downloaded: ${analysis.existingFiles} (${analysis.percentage.toFixed(1)}%)`);
    logMessage(`- Missing files: ${analysis.missingFiles}`);
    
    if (analysis.missingFiles > 0) {
      logMessage(`Missing files breakdown:`);
      const missingByCloudinary = analysis.missingFileNames.filter(name => {
        const resource = allResources.find(r => getFilenameFromUrl(r) === name);
        return resource && resource.secure_url;
      });
      
      logMessage(`- Expected to download: ${missingByCloudinary.length} files`);
      logMessage(`- May be deleted from Cloudinary: ${analysis.missingFiles - missingByCloudinary.length} files`);
    }
    
    showToast(`Analysis complete: ${analysis.percentage.toFixed(1)}% downloaded`, 'success');
    
  } catch (error) {
    logMessage(`Error analyzing folder: ${error}`);
    showToast(`Error analyzing folder: ${error}`, 'error');
  } finally {
    setButtonLoading('analyze-folder', false);
  }
}

// Download only missing files
async function downloadMissingFiles() {
  if (!downloadPath || allResources.length === 0) {
    showToast("Please scan for photos and select a download folder first", 'error');
    return;
  }

  const analysis = await analyzeDownloadFolder();
  if (analysis.missingFiles === 0) {
    showToast("No missing files to download!", 'info');
    return;
  }

  // Filter resources to only missing files
  const missingResources = allResources.filter(resource => {
    const fileName = getFilenameFromUrl(resource);
    return analysis.missingFileNames.includes(fileName);
  });

  logMessage(`Starting download of ${missingResources.length} missing files...`);
  logMessage(`Math: Expected ${analysis.totalFiles} total, have ${analysis.existingFiles}, downloading ${missingResources.length} missing`);
  
  // Set allResources temporarily to only missing files for download
  const originalResources = allResources;
  allResources = missingResources;
  
  try {
    await startDownload();
  } finally {
    // Restore original resources
    allResources = originalResources;
  }
}

function showStep(stepNumber: number) {
  // Hide all steps
  document.querySelectorAll('.setup-step').forEach(step => {
    step.classList.remove('active');
    step.classList.add('hidden');
  });
  
  // Show current step
  const currentStepEl = document.getElementById(`step-${stepNumber}`);
  if (currentStepEl) {
    currentStepEl.classList.remove('hidden');
    currentStepEl.classList.add('active');
  }
  
  currentStep = stepNumber;
  updateButtons();
}

// Basic encryption for localStorage (better than plaintext)
function simpleEncrypt(text: string): string {
  // Simple XOR encryption with a key - not cryptographically secure but better than plaintext
  const key = 'cloudinary-backup-key-2024';
  let encrypted = '';
  for (let i = 0; i < text.length; i++) {
    encrypted += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return btoa(encrypted); // Base64 encode
}

function simpleDecrypt(encryptedText: string): string {
  try {
    const key = 'cloudinary-backup-key-2024';
    const encrypted = atob(encryptedText); // Base64 decode
    let decrypted = '';
    for (let i = 0; i < encrypted.length; i++) {
      decrypted += String.fromCharCode(encrypted.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return decrypted;
  } catch {
    return '';
  }
}

async function saveCredentials() {
  const cloudName = (document.getElementById('cloud-name') as HTMLInputElement)?.value || '';
  const apiKey = (document.getElementById('api-key') as HTMLInputElement)?.value || '';
  const apiSecret = (document.getElementById('api-secret') as HTMLInputElement)?.value || '';
  const path = (document.getElementById('download-path') as HTMLInputElement)?.value || '';
  
  try {
    // Create credentials object
    const credentials = {
      cloudName,
      apiKey,
      apiSecret
    };
    
    // Encrypt and save credentials
    const encryptedCredentials = simpleEncrypt(JSON.stringify(credentials));
    localStorage.setItem('cloudinary-backup-credentials-encrypted', encryptedCredentials);
    
    // Save path separately (non-sensitive)
    localStorage.setItem('cloudinary-backup-path', path);
    
    logMessage("Credentials saved with encryption");
  } catch (error) {
    logMessage(`Error saving credentials: ${error}`);
    console.error('Failed to save credentials:', error);
  }
}

async function loadCredentials() {
  try {
    // Try to load encrypted credentials first
    const encryptedCredentials = localStorage.getItem('cloudinary-backup-credentials-encrypted');
    if (encryptedCredentials) {
      const decryptedData = simpleDecrypt(encryptedCredentials);
      if (decryptedData) {
        const credentials = JSON.parse(decryptedData);
        
        const cloudNameInput = document.getElementById('cloud-name') as HTMLInputElement;
        const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
        const apiSecretInput = document.getElementById('api-secret') as HTMLInputElement;
        const pathInput = document.getElementById('download-path') as HTMLInputElement;
        
        if (cloudNameInput) cloudNameInput.value = credentials.cloudName || '';
        if (apiKeyInput) apiKeyInput.value = credentials.apiKey || '';
        if (apiSecretInput) apiSecretInput.value = credentials.apiSecret || '';
        
        // Load path from localStorage (non-sensitive)
        const path = localStorage.getItem('cloudinary-backup-path');
        if (path && pathInput) {
          pathInput.value = path;
          downloadPath = path;
        }
        
        return true;
      }
    }
    
    // Fallback: try to load old plaintext credentials and migrate them
    const oldCredentials = localStorage.getItem('cloudinary-backup-credentials');
    if (oldCredentials) {
      const creds = JSON.parse(oldCredentials);
      
      const cloudNameInput = document.getElementById('cloud-name') as HTMLInputElement;
      const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
      const apiSecretInput = document.getElementById('api-secret') as HTMLInputElement;
      const pathInput = document.getElementById('download-path') as HTMLInputElement;
      
      if (cloudNameInput) cloudNameInput.value = creds.cloudName || '';
      if (apiKeyInput) apiKeyInput.value = creds.apiKey || '';
      if (apiSecretInput) apiSecretInput.value = creds.apiSecret || '';
      if (pathInput) pathInput.value = creds.path || '';
      
      if (creds.path) {
        downloadPath = creds.path;
      }
      
      // Migrate to encrypted storage
      await saveCredentials();
      
      // Remove old plaintext credentials
      localStorage.removeItem('cloudinary-backup-credentials');
      
      logMessage("Migrated credentials to encrypted storage");
      return true;
    }
  } catch (error) {
    console.error('Error loading credentials:', error);
    logMessage('Failed to load stored credentials');
    // Clean up corrupted data
    localStorage.removeItem('cloudinary-backup-credentials-encrypted');
    localStorage.removeItem('cloudinary-backup-credentials');
  }
  return false;
}

function updateButtons() {
  const cloudName = (document.getElementById('cloud-name') as HTMLInputElement)?.value || '';
  const apiKey = (document.getElementById('api-key') as HTMLInputElement)?.value || '';
  const apiSecret = (document.getElementById('api-secret') as HTMLInputElement)?.value || '';
  const path = (document.getElementById('download-path') as HTMLInputElement)?.value || '';
  
  // Save credentials whenever they change
  saveCredentials();
  
  const step1Complete = cloudName && apiKey && apiSecret;
  const step2Complete = step1Complete && path;
  
  if (step1Complete && currentStep === 1) {
    showStep(2);
  }
  
  if (step2Complete && currentStep === 2) {
    showStep(3);
  }
  
  // Update button states
  const fetchButton = document.getElementById('fetch-resources') as HTMLButtonElement;
  const downloadButton = document.getElementById('start-download') as HTMLButtonElement;
  
  if (fetchButton) {
    fetchButton.disabled = !step2Complete;
  }
  
  if (downloadButton) {
    downloadButton.disabled = allResources.length === 0;
  }
}

function logMessage(message: string) {
  const logOutput = document.getElementById("log-output");
  if (logOutput) {
    const timestamp = new Date().toLocaleTimeString();
    logOutput.innerHTML += `<div>[${timestamp}] ${message}</div>`;
    logOutput.scrollTop = logOutput.scrollHeight;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function updateUI() {
  const cloudName = (document.getElementById("cloud-name") as HTMLInputElement)?.value;
  const apiKey = (document.getElementById("api-key") as HTMLInputElement)?.value;
  const apiSecret = (document.getElementById("api-secret") as HTMLInputElement)?.value;
  
  const canFetch = cloudName && apiKey && apiSecret;
  const canDownload = canFetch && downloadPath && allResources.length > 0;
  
  (document.getElementById("fetch-resources") as HTMLButtonElement).disabled = !canFetch;
  (document.getElementById("start-download") as HTMLButtonElement).disabled = !canDownload;
  (document.getElementById("export-metadata") as HTMLButtonElement).disabled = !canDownload;
}

async function selectFolder() {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: await documentDir(),
    });
    
    if (selected && typeof selected === "string") {
      downloadPath = selected;
      (document.getElementById("download-path") as HTMLInputElement).value = selected;
      logMessage(`Selected download folder: ${selected}`);
      saveCredentials();
      updateButtons();
      
      // Auto-show folder analysis if we have scanned resources
      if (allResources.length > 0) {
        setTimeout(() => {
          analyzeFolder();
        }, 500);
      }
    }
  } catch (error) {
    logMessage(`Error selecting folder: ${error}`);
  }
}

async function fetchResources() {
  const cloudName = (document.getElementById("cloud-name") as HTMLInputElement).value;
  const apiKey = (document.getElementById("api-key") as HTMLInputElement).value;
  const apiSecret = (document.getElementById("api-secret") as HTMLInputElement).value;
  
  if (!cloudName || !apiKey || !apiSecret) {
    logMessage("Please fill in all configuration fields");
    showToast("Please fill in all configuration fields", 'error');
    return;
  }

  if (isScanning) {
    return;
  }

  // Check for cached scan first
  const hasExistingScan = loadScanState();
  if (hasExistingScan) {
    // Show results from cached scan
    const resourcesSection = document.querySelector(".resources-section") as HTMLElement;
    resourcesSection.style.display = "block";
    
    const invalidCount = scanState.invalidatedResourceCount || 0;
    document.getElementById("resources-count")!.textContent = 
      `Found ${allResources.length} accessible resources${invalidCount > 0 ? ` (${invalidCount} deleted files filtered out)` : ''}`;
    
    document.getElementById("total-size")!.textContent = formatBytes(totalBytes);
    
    // Estimate time based on average download speed
    const estimatedSpeed = 512 * 1024; // 500KB/s conservative estimate
    const estimatedSeconds = totalBytes / estimatedSpeed;
    document.getElementById("estimated-time")!.textContent = formatTime(estimatedSeconds);
    
    document.getElementById("resources-stats")!.style.display = "block";
    
    updateUI();
    return;
  }

  isScanning = true;
  allResources = [];
  let cursor: string | undefined;
  let totalFetched = 0;

  // Show scanning UI
  setButtonLoading('fetch-resources', true);
  showScanningStatus();
  updateScanningMessage('connecting to cloudinary...');
  showToast('Starting scan...', 'info');

  logMessage("Starting to fetch resources from Cloudinary...");
  
  try {
    do {
      const response: CloudinaryResponse = await invoke("fetch_cloudinary_resources", {
        cloudName,
        apiKey,
        apiSecret,
        cursor,
      });
      
      allResources.push(...response.resources);
      totalFetched += response.resources.length;
      cursor = response.next_cursor;
      
      logMessage(`Fetched ${response.resources.length} resources (total: ${totalFetched})`);
      
      // Update scanning UI
      updateScanningMessage('scanning photos...', `found ${totalFetched} photos`);
      
      document.getElementById("resources-count")!.textContent = 
        `Found ${totalFetched} resources`;
        
    } while (cursor);
    
    logMessage(`Finished fetching! Total resources: ${totalFetched}`);
    logMessage(`Now validating URLs to filter out deleted files...`);
    
    // Validate URLs to filter out deleted files
    updateScanningMessage('validating files...', '0 checked');
    showToast('Validating file URLs...', 'info');
    
    const { valid, invalid } = await validateResourcesBatch(allResources);
    
    // Update allResources to only include valid files
    allResources = valid;
    
    // Hide scanning UI and show success
    hideScanningStatus();
    
    const validCount = valid.length;
    const invalidCount = invalid.length;
    
    logMessage(`Validation complete: ${validCount} accessible, ${invalidCount} deleted/inaccessible`);
    
    if (invalidCount > 0) {
      logMessage(`Filtered out ${invalidCount} deleted/inaccessible files from scan results`);
      showToast(`Found ${validCount} accessible photos (${invalidCount} deleted files filtered out)`, 'success');
    } else {
      showToast(`Found ${validCount} accessible photos!`, 'success');
    }
    
    // Calculate total size and show stats (only for valid files)
    totalBytes = allResources.reduce((sum, resource) => sum + resource.bytes, 0);
    
    // Save scan state for future use
    saveScanState(validCount, invalidCount);
    
    // Show the resources section now that we have data
    const resourcesSection = document.querySelector(".resources-section") as HTMLElement;
    resourcesSection.style.display = "block";
    
    // Update resource count to show validated count
    document.getElementById("resources-count")!.textContent = 
      `Found ${validCount} accessible resources${invalidCount > 0 ? ` (${invalidCount} deleted files filtered out)` : ''}`;
    
    document.getElementById("total-size")!.textContent = formatBytes(totalBytes);
    
    // Estimate time based on average download speed (assuming ~500KB/s with delays and retries)
    const estimatedSpeed = 512 * 1024; // 500KB/s conservative estimate including retries
    const estimatedSeconds = totalBytes / estimatedSpeed;
    document.getElementById("estimated-time")!.textContent = formatTime(estimatedSeconds);
    
    document.getElementById("resources-stats")!.style.display = "block";
    
    updateUI();
    
    // Auto-analyze folder if download path is selected
    if (downloadPath) {
      setTimeout(() => {
        analyzeFolder();
      }, 800);
    }
    
  } catch (error) {
    logMessage(`Error fetching resources: ${error}`);
    hideScanningStatus();
    showToast(`Error scanning: ${error}`, 'error');
  } finally {
    isScanning = false;
    setButtonLoading('fetch-resources', false);
  }
}

// Memory-efficient batch processing configuration
const DOWNLOAD_BATCH_SIZE = 50; // Process downloads in batches of 50 (good for most systems)
const LARGE_COLLECTION_BATCH_SIZE = 25; // Smaller batches for collections >5000 photos
const BATCH_DELAY_MS = 100; // Small delay between batches to prevent overwhelming
const LARGE_COLLECTION_THRESHOLD = 5000; // Switch to smaller batches for large collections

// Determine optimal batch size based on collection size
function getOptimalBatchSize(totalResources: number): number {
  if (totalResources > LARGE_COLLECTION_THRESHOLD) {
    logMessage(`Large collection detected (${totalResources} files), using smaller batches for memory efficiency`);
    return LARGE_COLLECTION_BATCH_SIZE;
  }
  return DOWNLOAD_BATCH_SIZE;
}

// Process downloads in batches to maintain predictable memory usage
async function processBatchedDownloads(resourcesToDownload: CloudinaryResource[]) {
  const batchSize = getOptimalBatchSize(resourcesToDownload.length);
  const totalBatches = Math.ceil(resourcesToDownload.length / batchSize);
  let globalSuccessCount = 0;
  let globalSkipCount = 0;
  
  logMessage(`Processing ${resourcesToDownload.length} files in ${totalBatches} batches of ${batchSize}`);
  
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    // Check if download was cancelled
    if (downloadCancelled) {
      logMessage("Download cancelled by user");
      showToast("Download cancelled", 'info');
      break;
    }
    
    // Calculate batch boundaries
    const batchStart = batchIndex * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, resourcesToDownload.length);
    const currentBatch = resourcesToDownload.slice(batchStart, batchEnd);
    
    logMessage(`Processing batch ${batchIndex + 1}/${totalBatches} (${currentBatch.length} files)`);
    
    // Process current batch
    let batchSuccessCount = 0;
    let batchSkipCount = 0;
    
    for (let i = 0; i < currentBatch.length; i++) {
      // Check cancellation again within batch
      if (downloadCancelled) {
        break;
      }
      
      const resource = currentBatch[i];
      const success = await downloadWithRetry(resource);
      
      if (success) {
        const fileName = getFilenameFromUrl(resource);
        if (downloadState.downloadedFiles.includes(fileName)) {
          batchSkipCount++;
          globalSkipCount++;
        } else {
          batchSuccessCount++;
          globalSuccessCount++;
        }
      }
      
      // Update progress UI
      const progress: DownloadProgress = await invoke("get_download_progress");
      updateProgressUI(progress);
      updateDownloadStats();
    }
    
    // Save state after each batch
    saveDownloadState();
    
    logMessage(`Batch ${batchIndex + 1} completed: ${batchSuccessCount} downloaded, ${batchSkipCount} skipped`);
    
    // Memory management: Clear processed batch from memory
    // (The batch slice goes out of scope, eligible for garbage collection)
    
    // Small delay between batches to prevent overwhelming the system
    if (batchIndex < totalBatches - 1) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  
  // Final summary
  const totalDownloaded = downloadState.downloadedFiles.length;
  const totalFailed = downloadState.failedFiles.length;
  
  if (totalFailed > 0) {
    logMessage(`Download completed! Downloaded: ${totalDownloaded}, Failed: ${totalFailed}, Skipped: ${globalSkipCount}`);
    showToast(`Download completed with ${totalFailed} failed files`, 'error');
    
    // Show failed files summary
    const failedBy404 = downloadState.failedFiles.filter(f => f.error.includes('404')).length;
    const failedByOther = totalFailed - failedBy404;
    
    if (failedBy404 > 0) {
      logMessage(`Files deleted from Cloudinary (404 errors): ${failedBy404}`);
      logMessage(`These files are listed in your account but were deleted from Cloudinary storage`);
    }
    if (failedByOther > 0) {
      logMessage(`Network/other errors: ${failedByOther}`);
    }
  } else {
    logMessage("Download completed successfully!");
    showToast("All files downloaded successfully!", 'success');
    clearDownloadState(); // Clear state on successful completion
  }
}

async function startDownload() {
  if (!downloadPath || allResources.length === 0) {
    logMessage("No download path selected or no resources to download");
    return;
  }

  const progressSection = document.querySelector(".progress-section") as HTMLElement;
  progressSection.style.display = "block";
  
  // Set up UI for download
  const downloadButton = document.getElementById("start-download") as HTMLButtonElement;
  const cancelButton = document.getElementById("cancel-download") as HTMLButtonElement;
  
  downloadButton.disabled = true;
  cancelButton.style.display = 'block';
  setButtonLoading('start-download', true);
  
  downloadCancelled = false;

  try {
    // Check if we can resume an existing download
    const hasExistingState = loadDownloadState();
    let resourcesToDownload = [...allResources]; // Create copy to avoid modifying original
    
    if (hasExistingState && canResumeDownload()) {
      const shouldResume = confirm(`Found an incomplete download with ${downloadState.downloadedFiles.length} files already downloaded. Resume download?`);
      if (shouldResume) {
        logMessage(`Resuming download... ${downloadState.downloadedFiles.length} files already completed.`);
        // Filter out already downloaded files
        resourcesToDownload = allResources.filter(resource => {
          const fileName = getFilenameFromUrl(resource);
          return !downloadState.downloadedFiles.includes(fileName);
        });
        downloadStartTime = downloadState.startTime;
        showToast(`Resuming download (${resourcesToDownload.length} files remaining)`, 'info');
      } else {
        clearDownloadState();
        downloadedBytes = 0;
        downloadStartTime = Date.now();
      }
    } else {
      clearDownloadState();
      downloadedBytes = 0;
      downloadStartTime = Date.now();
    }

    // Initialize download state
    downloadState.totalFiles = allResources.length;
    downloadState.startTime = downloadStartTime;
    
    await invoke("reset_download_progress", { total: allResources.length });
    
    const batchSize = getOptimalBatchSize(resourcesToDownload.length);
    logMessage(`Starting batched download of ${resourcesToDownload.length} files (${formatBytes(totalBytes)}) in batches of ${batchSize}...`);
    showToast(`Starting download of ${resourcesToDownload.length} files`, 'info');
    
    // Process downloads in batches for memory efficiency
    await processBatchedDownloads(resourcesToDownload);
    
  } catch (error) {
    logMessage(`Error during download: ${error}`);
    showToast(`Download error: ${error}`, 'error');
  } finally {
    // Reset UI state
    downloadCancelled = false;
    downloadCancelled = false;
    
    downloadButton.disabled = false;
    cancelButton.style.display = 'none';
    setButtonLoading('start-download', false);
    
    updateUI();
  }
}

function updateProgressUI(progress: DownloadProgress) {
  const percentage = progress.total > 0 ? (progress.downloaded / progress.total) * 100 : 0;
  
  const progressFill = document.getElementById("progress-fill") as HTMLElement;
  const progressText = document.getElementById("progress-text") as HTMLElement;
  const currentFile = document.getElementById("current-file") as HTMLElement;
  
  progressFill.style.width = `${percentage}%`;
  progressText.textContent = `${progress.downloaded} / ${progress.total} files`;
  currentFile.textContent = progress.current_file ? `Current: ${progress.current_file}` : "";
}

function updateDownloadStats() {
  // Update downloaded size
  document.getElementById("downloaded-size")!.textContent = formatBytes(downloadedBytes);
  
  // Calculate and update remaining time
  const elapsedTime = (Date.now() - downloadStartTime) / 1000; // seconds
  const downloadSpeed = downloadedBytes / elapsedTime; // bytes per second
  const remainingBytes = totalBytes - downloadedBytes;
  const remainingSeconds = remainingBytes / downloadSpeed;
  
  document.getElementById("remaining-time")!.textContent = formatTime(remainingSeconds);
}

async function exportMetadata() {
  if (allResources.length === 0) {
    logMessage("No resources to export");
    return;
  }

  try {
    const metadataPath = await join(downloadPath, "metadata.json");
    await invoke("save_metadata", {
      resources: allResources,
      filePath: metadataPath,
    });
    
    logMessage(`Metadata exported to: ${metadataPath}`);
    
  } catch (error) {
    logMessage(`Error exporting metadata: ${error}`);
  }
}

function toggleLog() {
  const logSection = document.querySelector(".log-section") as HTMLElement;
  const toggleButton = document.getElementById("toggle-log") as HTMLButtonElement;
  
  if (logSection.style.display === "none") {
    logSection.style.display = "block";
    toggleButton.textContent = "hide log";
  } else {
    logSection.style.display = "none";
    toggleButton.textContent = "show log";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("select-folder")?.addEventListener("click", selectFolder);
  document.getElementById("fetch-resources")?.addEventListener("click", fetchResources);
  document.getElementById("start-download")?.addEventListener("click", startDownload);
  document.getElementById("cancel-download")?.addEventListener("click", cancelDownload);
  document.getElementById("analyze-folder")?.addEventListener("click", analyzeFolder);
  document.getElementById("download-missing")?.addEventListener("click", downloadMissingFiles);
  document.getElementById("export-metadata")?.addEventListener("click", exportMetadata);
  document.getElementById("toggle-log")?.addEventListener("click", toggleLog);
  
  // Add input listeners for step progression
  document.getElementById("cloud-name")?.addEventListener("input", updateButtons);
  document.getElementById("api-key")?.addEventListener("input", updateButtons);
  document.getElementById("api-secret")?.addEventListener("input", updateButtons);
  
  // Load saved credentials first
  loadCredentials();
  
  // Initialize with step 1
  showStep(1);
  updateButtons();
  logMessage("Cloudinary Backup Tool ready");
});
