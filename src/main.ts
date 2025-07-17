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
  tags: string[];
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

// Step management
let currentStep = 1;

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

function saveCredentials() {
  const cloudName = (document.getElementById('cloud-name') as HTMLInputElement)?.value || '';
  const apiKey = (document.getElementById('api-key') as HTMLInputElement)?.value || '';
  const apiSecret = (document.getElementById('api-secret') as HTMLInputElement)?.value || '';
  const path = (document.getElementById('download-path') as HTMLInputElement)?.value || '';
  
  localStorage.setItem('cloudinary-backup-credentials', JSON.stringify({
    cloudName,
    apiKey,
    apiSecret,
    path
  }));
}

function loadCredentials() {
  try {
    const saved = localStorage.getItem('cloudinary-backup-credentials');
    if (saved) {
      const creds = JSON.parse(saved);
      
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
    }
  } catch (error) {
    console.log('Error loading saved credentials:', error);
  }
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
    return;
  }

  allResources = [];
  let cursor: string | undefined;
  let totalFetched = 0;

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
      
      document.getElementById("resources-count")!.textContent = 
        `Found ${totalFetched} resources`;
        
    } while (cursor);
    
    logMessage(`Finished fetching! Total resources: ${totalFetched}`);
    
    // Show the resources section now that we have data
    const resourcesSection = document.querySelector(".resources-section") as HTMLElement;
    resourcesSection.style.display = "block";
    
    // Calculate total size and show stats
    totalBytes = allResources.reduce((sum, resource) => sum + resource.bytes, 0);
    document.getElementById("total-size")!.textContent = formatBytes(totalBytes);
    
    // Estimate time based on average download speed (assuming ~1MB/s with delays)
    const estimatedSpeed = 1024 * 1024; // 1 MB/s conservative estimate
    const estimatedSeconds = totalBytes / estimatedSpeed;
    document.getElementById("estimated-time")!.textContent = formatTime(estimatedSeconds);
    
    document.getElementById("resources-stats")!.style.display = "block";
    
    updateUI();
    
  } catch (error) {
    logMessage(`Error fetching resources: ${error}`);
  }
}

async function startDownload() {
  if (!downloadPath || allResources.length === 0) {
    logMessage("No download path selected or no resources to download");
    return;
  }

  const progressSection = document.querySelector(".progress-section") as HTMLElement;
  progressSection.style.display = "block";
  
  // Disable download button during download
  const downloadButton = document.getElementById("start-download") as HTMLButtonElement;
  downloadButton.disabled = true;

  try {
    await invoke("reset_download_progress", { total: allResources.length });
    
    logMessage(`Starting download of ${allResources.length} files (${formatBytes(totalBytes)})...`);
    downloadedBytes = 0;
    downloadStartTime = Date.now();
    
    let failedDownloads = 0;

    for (let i = 0; i < allResources.length; i++) {
      const resource = allResources[i];
      // Sanitize filename
      const fileName = `${resource.public_id.replace(/[\/\\]/g, '_')}.${resource.format}`;
      const filePath = await join(downloadPath, fileName);
      
      try {
        await invoke("download_resource", {
          url: resource.secure_url,
          filePath,
        });
        
        downloadedBytes += resource.bytes;
        
        const progress: DownloadProgress = await invoke("get_download_progress");
        updateProgressUI(progress);
        updateDownloadStats();
        
      } catch (error) {
        failedDownloads++;
        logMessage(`Error downloading ${fileName}: ${error}`);
      }
    }
    
    if (failedDownloads > 0) {
      logMessage(`Download completed with ${failedDownloads} errors!`);
    } else {
      logMessage("Download completed successfully!");
    }
    
  } catch (error) {
    logMessage(`Error during download: ${error}`);
  } finally {
    downloadButton.disabled = false;
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
