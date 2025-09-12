const WebSocket = require('ws');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const PORT = 3001;
const wss = new WebSocket.Server({ port: PORT });

const BUILDS_DIR = path.join(__dirname, 'builds');

if (!fs.existsSync(BUILDS_DIR)) {
    fs.mkdirSync(BUILDS_DIR);
}

console.log(`WebSocket server started on ws://localhost:${PORT}`);
console.log('Waiting for connection from the Websim client...');

wss.on('connection', ws => {
    console.log('✓ Client connected from browser.');

    ws.on('message', message => {
        try {
            const request = JSON.parse(message);
            console.log('📨 Received build request:', {
                type: request.type,
                appName: request.appName,
                platform: request.platform,
                url: request.url?.substring(0, 50) + '...'
            });
            handleBuildRequest(ws, request);
        } catch (error) {
            console.error('❌ Failed to parse message:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid request format.' }));
        }
    });

    ws.on('close', () => {
        console.log('✗ Client disconnected.');
    });

    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
    });
});

async function handleBuildRequest(ws, request) {
    const { url, platform, appName, fromClientId } = request;
    const sanitizedAppName = appName.replace(/[^a-zA-Z0-9\-]/g, '');
    // Use a unique directory for each build to prevent conflicts
    const outputDir = path.join(BUILDS_DIR, `${sanitizedAppName}-${platform}-${Date.now()}`);

    const sendStatus = (message, level = 'info') => {
        const logMessage = `[${level.toUpperCase()}] ${message}`;
        console.log(logMessage);
        // Ensure ws is still open before sending
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'status', message, level, originalRequest: request }));
        } else {
            console.warn('⚠️ WebSocket closed, cannot send status update');
        }
    };
    
    sendStatus(`🔨 Starting build for ${appName} on ${platform}...`);
    console.log(`🎯 Target URL: ${url}`);

    // Let the frontend know we've received the command and are starting the process.
    // This helps the frontend pair the final binary blob with the original request.
    ws.send(JSON.stringify({ type: 'build-command-response', originalRequest: request }));

    const nativefierCommand = `npx nativefier "${url}" "${outputDir}" --name "${appName}" --platform "${platform}" --arch "x64" --fast-quit`;

    sendStatus(`Executing: ${nativefierCommand}`);

    exec(nativefierCommand, (error, stdout, stderr) => {
        if (error) {
            sendStatus(`Nativefier execution failed: ${error.message}`, 'error');
            console.error(`Nativefier stderr: ${stderr}`);
            return;
        }

        console.log(`Nativefier stdout: ${stdout}`);
        sendStatus('Nativefier build successful. Zipping output...', 'success');

        const finalZipPath = path.join(BUILDS_DIR, `${sanitizedAppName}-${platform}.zip`);
        const output = fs.createWriteStream(finalZipPath);
        const archive = archiver('zip', {
            zlib: { level: 9 } // Sets the compression level.
        });

        output.on('close', () => {
            const totalBytes = archive.pointer();
            sendStatus(`Zipping complete. Sending ${totalBytes} bytes.`, 'success');
            
            fs.readFile(finalZipPath, (err, data) => {
                if (err) {
                    sendStatus(`Failed to read zip file: ${err.message}`, 'error');
                    return;
                }

                // Create a JSON payload with metadata
                const metadata = JSON.stringify({
                    fromClientId: request.fromClientId,
                    appName: request.appName,
                    platform: request.platform
                });
                
                // Create a separator to distinguish metadata from file data
                const separator = Buffer.from('\n---\n');

                // Combine metadata, separator, and zip data into a single buffer
                const combinedBuffer = Buffer.concat([Buffer.from(metadata), separator, data]);

                // Send the combined buffer as a binary message
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(combinedBuffer, { binary: true });
                }
                
                // Cleanup build artifacts
                fs.rm(outputDir, { recursive: true, force: true }, (rmErr) => {
                    if(rmErr) console.error(`Failed to delete build directory: ${outputDir}`, rmErr);
                });
                fs.rm(finalZipPath, { force: true }, (rmErr) => {
                    if(rmErr) console.error(`Failed to delete zip file: ${finalZipPath}`, rmErr);
                });
            });
        });

        archive.on('warning', (err) => {
            if (err.code === 'ENOENT') {
                console.warn('Archiver warning:', err);
            } else {
                sendStatus(`Archiver warning: ${err.message}`, 'warn');
                throw err;
            }
        });

        archive.on('error', (err) => {
            sendStatus(`Archiving failed: ${err.message}`, 'error');
            throw err;
        });

        archive.pipe(output);

        // Nativefier creates the app in a sub-directory inside the outputDir. We need to find it.
        try {
            const buildSubDirs = fs.readdirSync(outputDir, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            if (buildSubDirs.length === 0) {
                 sendStatus(`Could not find app directory in ${outputDir}`, 'error');
                 return;
            }
            // Usually there is only one directory, which contains the built app.
            const appDirName = buildSubDirs[0];
            console.log(`Found app directory to zip: ${appDirName}`);
            // Add the directory to the zip archive, placing its contents at the root of the zip.
            archive.directory(path.join(outputDir, appDirName), false);
            archive.finalize();
        } catch (dirError) {
            sendStatus(`Error reading build output directory: ${dirError.message}`, 'error');
        }
    });
}