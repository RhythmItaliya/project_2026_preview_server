const { spawn, exec } = require('child_process');
const path = require('path');
const chalk = require('chalk');
const argv = require('minimist')(process.argv.slice(2));
const express = require('express');
const cors = require('cors');

// --- Configuration ---
const PROJECT_DIR = argv.project ? path.resolve(argv.project) : path.resolve(__dirname, '../server/demo');
const METRO_PORT = 19000;
const API_PORT = 3002;

console.log(chalk.cyan(`Starting Preview Server for project: ${PROJECT_DIR}`));

// --- State Management ---
let activeSession = null;
let activeProcess = null;

// --- Express API Server ---
const app = express();
app.use(cors());
app.use(express.json());

// Start tunnel endpoint
app.post('/start', async (req, res) => {
    try {
        // Return existing session if active
        if (activeSession && activeSession.status === 'active') {
            return res.json({ success: true, session: activeSession });
        }

        // Stop any zombie process
        if (activeProcess) {
            activeProcess.kill();
        }

        console.log(chalk.yellow(`Starting Metro Bundler with Expo Tunnel on port ${METRO_PORT}...`));

        const child = spawn('npx', ['expo', 'start', '--tunnel', '--port', METRO_PORT.toString(), '--clear'], {
            cwd: PROJECT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true,
        });

        activeProcess = child;
        let tunnelUrl = '';

        child.stdout.on('data', (data) => {
            const output = data.toString();
            console.log(chalk.gray('[Expo]:'), output);

            // Match tunnel URL from output
            const match = output.match(/exp:\/\/[a-z0-9-.]+(:d+)?/);
            if (match && !tunnelUrl) {
                tunnelUrl = match[0];
                console.log(chalk.green('Tunnel URL found:'), tunnelUrl);
            }
        });

        child.stderr.on('data', (data) => {
            console.error(chalk.red('[Expo Error]:'), data.toString());
        });

        // Poll for URL with 60 second timeout
        let attempts = 0;
        const checkUrl = setInterval(() => {
            attempts++;
            if (tunnelUrl) {
                clearInterval(checkUrl);

                activeSession = {
                    id: Date.now().toString(),
                    url: tunnelUrl,
                    platform: 'android',
                    status: 'active',
                    pid: child.pid,
                };

                res.json({ success: true, session: activeSession });
            } else if (attempts > 120) {
                clearInterval(checkUrl);
                child.kill();
                res.status(500).json({ error: 'Timeout waiting for Tunnel URL. Check server logs.' });
            }
        }, 500);
    } catch (error) {
        console.error(chalk.red('Error starting tunnel:'), error);
        if (activeProcess) activeProcess.kill();
        res.status(500).json({ error: 'Failed to start tunnel' });
    }
});

// Stop tunnel endpoint
app.post('/stop', async (req, res) => {
    try {
        if (activeProcess) {
            activeProcess.kill();
            activeProcess = null;
        }

        if (activeSession) {
            activeSession.status = 'inactive';
        }

        console.log(chalk.yellow('Tunnel stopped'));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to stop tunnel' });
    }
});

// Get status endpoint
app.get('/status', async (req, res) => {
    try {
        const isActive = activeSession?.status === 'active';
        res.json({ active: isActive, session: isActive ? activeSession : null });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get status' });
    }
});

// --- Pre-flight Cleanup ---
const cleanZombies = async () => {
    console.log(chalk.gray('Cleaning up zombie processes...'));
    try {
        await new Promise(r => exec('pkill -f ngrok', r));
        await new Promise(r => exec(`lsof -t -i:${METRO_PORT} | xargs kill -9`, r));
    } catch (e) { }
};

// --- Main ---
(async function () {
    await cleanZombies();

    // Start API server
    app.listen(API_PORT, () => {
        console.log(chalk.green(`Preview Server API running on http://localhost:${API_PORT}`));
        console.log(chalk.cyan(`Ready to start Expo tunnel for: ${PROJECT_DIR}`));
    });

    // Handle exit
    process.on('SIGINT', () => {
        console.log(chalk.yellow('\nStopping server...'));
        if (activeProcess) activeProcess.kill();
        process.exit();
    });

})();
