const express = require('express');
const cors = require('cors');
const { spawn, exec } = require('child_process');
const path = require('path');
const chalk = require('chalk');
const argv = require('minimist')(process.argv.slice(2));

// --- Configuration ---
const PORT = 3002; // API Port
const PROJECT_DIR = argv.project ? path.resolve(argv.project) : path.resolve(__dirname, '../server/demo');
const METRO_PORT = 8081;

// --- App State ---
let metroProcess = null;
let currentSession = {
    url: null,
    platform: 'expo',
    status: 'inactive'
};
let logs = []; // In-memory log buffer

const app = express();
app.use(cors());
app.use(express.json());

// --- Helper Functions ---

const addLog = (type, message) => {
    const timestamp = new Date().toISOString();
    // Keep last 1000 logs to avoid memory issues
    if (logs.length > 1000) logs.shift();
    logs.push({ type, message, timestamp });

    // Also print to server console for debugging
    if (type === 'error' || type === 'stderr') {
        console.error(chalk.red(`[${type}] ${message}`));
    } else {
        console.log(chalk.blue(`[${type}] ${message}`));
    }
};

const cleanZombies = async () => {
    addLog('info', 'Cleaning up zombie processes...');
    try {
        await new Promise(r => exec('pkill -f ngrok', r));
        await new Promise(r => exec(`lsof -t -i:${METRO_PORT} | xargs kill -9`, r));
    } catch (e) { }
};

// --- Routes ---

app.get('/status', (req, res) => {
    res.json({
        active: !!metroProcess,
        session: currentSession
    });
});

app.get('/logs', (req, res) => {
    res.json({ logs });
});

app.post('/start', async (req, res) => {
    if (metroProcess) {
        return res.json({ success: true, message: 'Already running', session: currentSession });
    }

    try {
        await cleanZombies();
        logs = []; // Clear old logs
        currentSession = { url: null, platform: 'expo', status: 'active' };

        console.log(chalk.yellow(`Starting Metro Bundler with Expo Tunnel on port ${METRO_PORT}...`));
        addLog('info', `Starting Metro Bundler with Expo Tunnel on port ${METRO_PORT}...`);

        // Spawn Metro using 'script' to fake a TTY (force color + QR code)
        // Linux: script -q -c "command" /dev/null
        metroProcess = spawn('script', ['-q', '-c', `npx expo start --tunnel --port ${METRO_PORT} --clear`, '/dev/null'], {
            cwd: PROJECT_DIR,
            env: { ...process.env, FORCE_COLOR: '1' },
            shell: false // using script binary directly
        });

        // Pipe to real terminal so user sees QR code nicely
        metroProcess.stdout.pipe(process.stdout);
        metroProcess.stderr.pipe(process.stderr);

        metroProcess.stdout.on('data', (data) => {
            const str = data.toString();

            // Clean ANSI codes for UI LOGS only
            const lines = str.split('\n');
            lines.forEach(line => {
                if (!line.trim()) return;
                // aggressive ANSI strip for logs
                const cleanLine = line.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

                // Filter out ASCII QR code blocks (▄, █, ▀) from UI logs to keep it clean
                // These will still show in the terminal because of the .pipe() above
                if (cleanLine.match(/[▄█▀]/)) return;

                addLog('info', cleanLine);

                // Detect Expo URL (exp://u7t5ysk-anonymous-8081.exp.direct)
                if (cleanLine.includes('exp://')) {
                    const match = cleanLine.match(/(exp:\/\/[a-zA-Z0-9-.]+(:\d+)?(\/[^\s]*)?)/);
                    if (match && match[1]) {
                        // Avoid duplicates or partial captures
                        if (currentSession.url !== match[1]) {
                            currentSession.url = match[1];
                            console.log(chalk.green(`\n[API] Captured QR URL: ${currentSession.url}\n`));
                            addLog('success', `Captured QR URL: ${currentSession.url}`);
                        }
                    }
                }
            });
        });

        metroProcess.stderr.on('data', (data) => {
            const str = data.toString();
            const lines = str.split('\n');
            lines.forEach(line => {
                if (line.trim()) {
                    const cleanLine = line.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
                    addLog('stderr', cleanLine);
                }
            });
        });

        metroProcess.on('close', (code) => {
            console.log(chalk.yellow(`\nMetro process exited with code ${code}`));
            addLog('warning', `Metro process exited with code ${code}`);
            metroProcess = null;
            currentSession.status = 'inactive';
            currentSession.url = null;
        });

        res.json({ success: true, session: currentSession });

    } catch (error) {
        console.error(chalk.red(`Failed to start: ${error.message}`));
        addLog('error', `Failed to start: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/stop', async (req, res) => {
    if (metroProcess) {
        // Kill the process tree (since we used shell: true, metroProcess.pid is the shell, not node)
        // A simple kill might not work for spawned shells, but let's try standard kill + cleanup
        metroProcess.kill();
        metroProcess = null;

        // Force cleanup to be sure
        await cleanZombies();

        currentSession.status = 'inactive';
        currentSession.url = null;
        addLog('info', 'Metro server stopped by user');

        res.json({ success: true });
    } else {
        res.json({ success: true, message: 'Not running' });
    }
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(chalk.green(`\nPreview API Server listening on port ${PORT}`));
    console.log(chalk.gray(`Waiting for frontend to trigger /start...`));
});
