const { spawn, exec } = require('child_process');
const path = require('path');
const chalk = require('chalk');
const argv = require('minimist')(process.argv.slice(2));

// --- Configuration ---
const PROJECT_DIR = argv.project ? path.resolve(argv.project) : path.resolve(__dirname, '../project_2026/demo');
const METRO_PORT = 19000;

console.log(chalk.cyan(`Starting Preview Server for project: ${PROJECT_DIR}`));

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

    console.log(chalk.yellow(`Starting Metro Bundler with Expo Tunnel on port ${METRO_PORT}...\n`));

    const metro = spawn('npx', ['expo', 'start', '--tunnel', '--port', METRO_PORT, '--clear'], {
        cwd: PROJECT_DIR,
        stdio: 'inherit', // Pass through all Expo output and interactivity
        shell: true,
    });

    metro.on('error', (err) => {
        console.error(chalk.red('Failed to start Metro:'), err);
    });

    // Handle exit
    process.on('SIGINT', () => {
        console.log(chalk.yellow('\nStopping server...'));
        metro.kill();
        process.exit();
    });

})();
