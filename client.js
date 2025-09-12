import JSZip from 'jszip';

const CREATOR_PANEL = document.getElementById('creator-panel');
const REQUESTER_PANEL = document.getElementById('requester-panel');
const LOADING_VIEW = document.getElementById('loading-view');

const PROJECT_INPUT = document.getElementById('project-input');
const PROJECT_LIST = document.getElementById('project-list');
const PLATFORM_SELECT = document.getElementById('platform-select');
const APP_NAME_INPUT = document.getElementById('app-name');
const BUILD_FORM = document.getElementById('build-form');
const SUBMIT_BUTTON = document.getElementById('submit-build');

const DOWNLOAD_BRIDGE_BUTTON = document.getElementById('download-bridge-button');
const BRIDGE_STATUS = document.getElementById('bridge-status');
const CREATOR_LOG = document.getElementById('creator-log');
const REQUESTER_LOG = document.getElementById('requester-log');

const BRIDGE_WEBSOCKET_URL = "ws://127.0.0.1:3001";
let bridgeSocket;

let room;
let isCreator = false;
let creatorId = null;
let currentUserId = null;
let userProjects = []; // To store fetched projects

function logTo(element, message, level = 'info') {
    const p = document.createElement('p');
    p.innerHTML = `[${new Date().toLocaleTimeString()}] ${message}`;
    p.classList.add(`log-${level}`);
    element.appendChild(p);
    element.scrollTop = element.scrollHeight;
}

async function main() {
    room = new WebsimSocket();
    await room.initialize();
    
    currentUserId = room.clientId;

    const creator = await window.websim.getCreator();
    creatorId = creator.id;
    isCreator = currentUserId === creatorId;
    
    setupUI();
    
    if (isCreator) {
        setupCreator();
    } else {
        await setupRequester();
    }
    
    room.onmessage = handleRoomMessages;
}

function setupUI() {
    LOADING_VIEW.classList.add('hidden');
    if (isCreator) {
        CREATOR_PANEL.classList.remove('hidden');
        DOWNLOAD_BRIDGE_BUTTON.classList.remove('hidden');
    } else {
        REQUESTER_PANEL.classList.remove('hidden');
    }
}

async function setupRequester() {
    logTo(REQUESTER_LOG, "Welcome! Select a project to build.");
    try {
        const user = await window.websim.getUser();
        if (!user) {
            logTo(REQUESTER_LOG, "Could not identify user. Manual URL entry is still available.", 'warn');
            PROJECT_INPUT.placeholder = "Please enter a valid Websim URL";
        } else {
             const response = await fetch(`https://websim.com/api/v1/users/${user.username}/sites`);
             const body = await response.json();
    
            if (body.data && body.data.length > 0) {
                userProjects = body.data;
                PROJECT_LIST.innerHTML = ''; // Clear previous
                userProjects.forEach(site => {
                    const option = document.createElement('option');
                    // Value is what's shown and put in the input field
                    option.value = site.title || `Untitled (${site.id})`;
                    PROJECT_LIST.appendChild(option);
                });
            } else {
                logTo(REQUESTER_LOG, "No projects found for your account. You can enter a URL manually.", 'info');
            }
        }
    } catch (error) {
        console.error("Failed to fetch projects", error);
        logTo(REQUESTER_LOG, "Failed to load your projects. You can enter a URL manually.", 'warn');
    }

    PROJECT_INPUT.addEventListener('input', (e) => {
        const selectedProject = userProjects.find(p => (p.title || `Untitled (${p.id})`) === e.target.value);
        if (selectedProject) {
            APP_NAME_INPUT.value = (selectedProject.title || "My-App").replace(/\s+/g, '-');
        }
    });

    BUILD_FORM.addEventListener('submit', handleBuildRequest);
}

function setupCreator() {
    logTo(CREATOR_LOG, "Creator panel initialized. Attempting bridge connection...");
    updateBridgeStatus("connecting");
    connectToBridge();
    
    room.subscribePresenceUpdateRequests(handlePresenceUpdateRequest);
}

function updateBridgeStatus(status) {
    switch(status) {
        case "connected":
            BRIDGE_STATUS.textContent = "Connected ✓";
            BRIDGE_STATUS.style.color = 'var(--success-color)';
            BRIDGE_STATUS.style.backgroundColor = '#d4edda';
            BRIDGE_STATUS.style.border = '2px solid var(--success-color)';
            break;
        case "disconnected":
            BRIDGE_STATUS.textContent = "Disconnected ✗";
            BRIDGE_STATUS.style.color = 'var(--error-color)';
            BRIDGE_STATUS.style.backgroundColor = '#f8d7da';
            BRIDGE_STATUS.style.border = '2px solid var(--error-color)';
            break;
        case "connecting":
            BRIDGE_STATUS.textContent = "Connecting...";
            BRIDGE_STATUS.style.color = 'var(--warning-color)';
            BRIDGE_STATUS.style.backgroundColor = '#fff3cd';
            BRIDGE_STATUS.style.border = '2px solid var(--warning-color)';
            break;
    }
}

function connectToBridge() {
    try {
        logTo(CREATOR_LOG, `Attempting to connect to bridge at ${BRIDGE_WEBSOCKET_URL}...`);
        
        // Close existing connection if any
        if (bridgeSocket) {
            bridgeSocket.close();
        }
        
        bridgeSocket = new WebSocket(BRIDGE_WEBSOCKET_URL);

        bridgeSocket.onopen = () => {
            updateBridgeStatus("connected");
            logTo(CREATOR_LOG, "✓ Node.js bridge connected successfully!", 'success');
        };

        bridgeSocket.onclose = (event) => {
            updateBridgeStatus("disconnected");
            logTo(CREATOR_LOG, `✗ Bridge disconnected (code: ${event.code}). Retrying in 5 seconds...`, 'warn');
            setTimeout(() => {
                updateBridgeStatus("connecting");
                connectToBridge();
            }, 5000);
        };
        
        bridgeSocket.onerror = (err) => {
            console.error("Bridge WebSocket error:", err);
            updateBridgeStatus("disconnected");
            logTo(CREATOR_LOG, "✗ Bridge connection error. Make sure the Node.js bridge is running on localhost:3001", 'error');
        };

        bridgeSocket.onmessage = handleBridgeMessage;
    } catch (error) {
        logTo(CREATOR_LOG, `Failed to create WebSocket connection: ${error.message}`, 'error');
        updateBridgeStatus("disconnected");
    }
}

// Creator receives request from another user
function handlePresenceUpdateRequest(updateRequest, fromClientId) {
    if (updateRequest.type === 'build-request') {
        const { url, platform, appName } = updateRequest;
        logTo(CREATOR_LOG, `📨 Received build request from ${fromClientId.substring(0,8)}... for '${appName}' on ${platform}`);

        if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
            const payload = { ...updateRequest, fromClientId };
            logTo(CREATOR_LOG, `⏩ Forwarding request to Node.js bridge...`);
            bridgeSocket.send(JSON.stringify(payload));
            
            // Notify clients that build has started
            room.send({
                type: 'status-update',
                requesterId: fromClientId,
                message: `🔨 Build for '${appName}' on ${platform} has started...`,
                level: 'info'
            });

        } else {
            const errorMsg = `❌ Bridge not connected. Cannot process request. Current state: ${bridgeSocket ? bridgeSocket.readyState : 'null'}`;
            logTo(CREATOR_LOG, errorMsg, 'error');
             room.send({
                type: 'status-update',
                requesterId: fromClientId,
                message: `❌ Build failed: Creator's bridge is not connected.`,
                level: 'error'
            });
        }
    }
}

// Creator receives message from local bridge
async function handleBridgeMessage(event) {
    // Check if data is binary (the zip file)
    if (event.data instanceof Blob) {
        // The first part of the blob is our JSON metadata.
        const blob = event.data;
        
        // Find the separator to distinguish JSON from the zip data
        const separator = new TextEncoder().encode('\n---\n');
        const dataArray = await blob.arrayBuffer();
        
        let separatorIndex = -1;
        // Search for the separator in the ArrayBuffer
        for (let i = 0; i < dataArray.byteLength - separator.byteLength + 1; i++) {
            const subArray = new Uint8Array(dataArray, i, separator.byteLength);
            if (subArray.every((val, index) => val === separator[index])) {
                separatorIndex = i;
                break;
            }
        }
        
        if (separatorIndex === -1) {
            logTo(CREATOR_LOG, 'Could not parse build data from bridge.', 'error');
            console.error('Separator not found in binary message from bridge.');
            return;
        }

        const jsonPart = new TextDecoder().decode(new Uint8Array(dataArray, 0, separatorIndex));
        const zipPart = new Blob([dataArray.slice(separatorIndex + separator.byteLength)], { type: 'application/zip' });

        try {
            const { fromClientId, appName } = JSON.parse(jsonPart);
            const fileName = `${appName.replace(/[^a-zA-Z0-9\-]/g, '')}.zip`;
            const file = new File([zipPart], fileName, { type: "application/zip" });

            logTo(CREATOR_LOG, `Received ${fileName} from bridge. Uploading...`, 'info');
            room.send({ type: 'status-update', requesterId: fromClientId, message: `Build for '${appName}' complete! Uploading file...` });

            const url = await window.websim.upload(file);
            logTo(CREATOR_LOG, `Upload complete! URL: ${url}`, 'success');
            
            // Send final link to user
            room.send({ 
                type: 'build-complete',
                requesterId: fromClientId,
                downloadUrl: url,
                appName: appName
            });

        } catch (error) {
            console.error("Upload or processing failed", error);
            const errorMessage = `File processing/upload failed: ${error.message}`;
            logTo(CREATOR_LOG, errorMessage, 'error');
            try {
                const { fromClientId, appName } = JSON.parse(jsonPart);
                room.send({ type: 'status-update', requesterId: fromClientId, message: `Build for '${appName}' failed during upload.`, level: 'error' });
            } catch(e) {
                 // ignore if we can't even parse json
            }
        }
    } else {
        // Assume JSON for status updates
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'status') {
                 logTo(CREATOR_LOG, `Bridge: ${data.message}`, data.level);
                // Relay status to the requester
                if (data.originalRequest && data.originalRequest.fromClientId) {
                    room.send({
                        type: 'status-update',
                        requesterId: data.originalRequest.fromClientId,
                        message: data.message,
                        level: data.level
                    });
                }
            }
        } catch (e) {
            console.error('Invalid JSON from bridge:', event.data);
        }
    }
}

function convertToNativefierUrl(url) {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname;
        const pathname = urlObj.pathname;

        let username, sitePath;

        if (hostname.endsWith('websim.com') || hostname.endsWith('websim.ai')) {
             // Format: https://websim.com/@username/path
            const match = pathname.match(/^\/@([^/]+)\/(.+)$/);
            if (match) {
                username = match[1];
                sitePath = match[2];
            } else {
                // Format: https://websim.com/sites/site-id
                const siteMatch = pathname.match(/^\/sites\/([^/]+)$/);
                 if (siteMatch) {
                    return url; // It's already in a good format, let nativefier handle it
                 }
                return null;
            }
        } else if(hostname.endsWith('.on.websim.com')) {
            // Already in nativefier format, just return it.
            return url;
        } else {
            return null;
        }

        if (username && sitePath) {
            return `https://` + `${sitePath}--${username}.on.websim.com`;
        }

        return null;
    } catch (e) {
        return null;
    }
}

// User submits the build form
function handleBuildRequest(e) {
    e.preventDefault();
    SUBMIT_BUTTON.disabled = true;
    SUBMIT_BUTTON.textContent = 'Requesting...';

    const inputValue = PROJECT_INPUT.value;
    const platform = PLATFORM_SELECT.value;
    const appName = APP_NAME_INPUT.value;

    if (!inputValue || !platform || !appName) {
        logTo(REQUESTER_LOG, 'Please fill out all fields.', 'error');
        SUBMIT_BUTTON.disabled = false;
        SUBMIT_BUTTON.textContent = 'Request Build';
        return;
    }

    let projectUrl = null;

    // Check if the input value matches a project from the datalist
    const selectedProject = userProjects.find(p => (p.title || `Untitled (${p.id})`) === inputValue);
    if (selectedProject) {
        projectUrl = `https://websim.com/sites/${selectedProject.id}`;
    } else {
        // Otherwise, treat as a manual URL and try to convert it
        projectUrl = convertToNativefierUrl(inputValue);
        if (!projectUrl) {
             projectUrl = `https://websim.com/sites/${inputValue}`; // Fallback for raw site ID
        }
    }
    
    // Final check for a valid URL
    let finalUrl = null;
    try {
        new URL(projectUrl); // test if it's a valid URL string
        finalUrl = projectUrl;
    } catch (error) {
         finalUrl = convertToNativefierUrl(projectUrl);
    }
    
    if (!finalUrl) {
         logTo(REQUESTER_LOG, `Invalid project or URL provided: "${inputValue}"`, 'error');
         SUBMIT_BUTTON.disabled = false;
         SUBMIT_BUTTON.textContent = 'Request Build';
         return;
    }

    logTo(REQUESTER_LOG, `Sending build request for '${appName}' on ${platform}...`);
    
    room.requestPresenceUpdate(creatorId, {
        type: 'build-request',
        url: finalUrl,
        platform,
        appName
    });

    setTimeout(() => {
        SUBMIT_BUTTON.disabled = false;
        SUBMIT_BUTTON.textContent = 'Request Another Build';
    }, 3000);
}

// All clients listen for general room messages
function handleRoomMessages(event) {
    const { data } = event;
    // Only process messages intended for this client
    if (data.requesterId && data.requesterId !== currentUserId) {
        return; 
    }
    
    switch (data.type) {
        case 'status-update':
            logTo(REQUESTER_LOG, data.message, data.level);
            break;
        case 'build-complete':
            const message = `Build for '${data.appName}' is ready! <a href="${data.downloadUrl}" target="_blank" download>Download here</a>.`;
            logTo(REQUESTER_LOG, message, 'success');
            break;
    }
}

// Generate the bridge.zip file on the fly for download
async function createBridgeZip() {
    const zip = new JSZip();
    const folder = zip.folder('websim-nativefier-bridge');
    
    const packageJsonContent = `{
  "name": "websim-nativefier-bridge",
  "version": "1.2.0",
  "description": "Local bridge to run Nativefier for Websim.",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "archiver": "^7.0.1",
    "nativefier": "50.0.1",
    "ws": "^8.17.0"
  }
}`;
    const serverJsContent = await (await fetch('bridge/server.js')).text();
    const readmeContent = await (await fetch('bridge/README.md')).text();

    folder.file('package.json', packageJsonContent);
    folder.file('server.js', serverJsContent);
    folder.file('README.md', readmeContent);

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipUrl = URL.createObjectURL(zipBlob);
    
    const downloadLink = document.querySelector('a[href="bridge.zip"]');
    downloadLink.href = zipUrl;
}

main();

// Run zip creation immediately, it doesn't need to wait for main()
createBridgeZip().catch(err => console.error("Failed to create bridge zip:", err));