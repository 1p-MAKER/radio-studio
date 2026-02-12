const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// .envファイルを読み込む
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
            process.env[key.trim()] = value.trim();
        }
    });
}

// Python実行パス
const PYTHON_PATH = '/opt/homebrew/Caskroom/miniconda/base/bin/python3';
// 出力先ディレクトリ
const OUTPUT_DIR = '/Volumes/1peiHDD_2TB/DaVinciResolve_material_HDD/RADIO/';

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 950,
        height: 900,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        backgroundColor: '#0f0f1a',
        titleBarStyle: 'hiddenInset'
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// ========== 音声ファイル選択 ==========
ipcMain.handle('select-audio-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });

    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }

    return result.filePaths[0];
});

// ========== SRTファイル選択（既存SRT読み込み用） ==========
ipcMain.handle('select-srt-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'SRT Files', extensions: ['srt'] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }

    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf-8');
    return { path: filePath, content };
});

// ========== 字幕生成（Python子プロセス） ==========
let transcribeProcess = null;

ipcMain.handle('start-transcription', async (event, audioPath) => {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, 'transcriber.py');

        // Pythonが存在するか確認
        if (!fs.existsSync(PYTHON_PATH)) {
            reject(new Error(`Python が見つかりません: ${PYTHON_PATH}`));
            return;
        }

        transcribeProcess = spawn(PYTHON_PATH, [scriptPath, audioPath, OUTPUT_DIR], {
            cwd: __dirname
        });

        let lastError = '';

        transcribeProcess.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            for (const line of lines) {
                try {
                    const msg = JSON.parse(line);
                    if (msg.type === 'progress') {
                        mainWindow.webContents.send('transcription-progress', msg);
                    } else if (msg.type === 'done') {
                        resolve(msg);
                    } else if (msg.type === 'error') {
                        reject(new Error(msg.message));
                    }
                } catch (e) {
                    // JSON以外の出力は無視
                    console.log('[Python]', line);
                }
            }
        });

        transcribeProcess.stderr.on('data', (data) => {
            lastError = data.toString();
            console.error('[Python stderr]', lastError);
        });

        transcribeProcess.on('close', (code) => {
            transcribeProcess = null;
            if (code !== 0) {
                reject(new Error(`字幕生成が失敗しました (code ${code}): ${lastError}`));
            }
        });

        transcribeProcess.on('error', (err) => {
            transcribeProcess = null;
            reject(new Error(`プロセス起動に失敗: ${err.message}`));
        });
    });
});

// 字幕生成キャンセル
ipcMain.handle('cancel-transcription', () => {
    if (transcribeProcess) {
        transcribeProcess.kill('SIGTERM');
        transcribeProcess = null;
        return true;
    }
    return false;
});

// ========== SRTファイル読み込み（生成済みSRT） ==========
ipcMain.handle('read-srt-file', async (event, srtPath) => {
    if (!fs.existsSync(srtPath)) {
        return null;
    }
    const content = fs.readFileSync(srtPath, 'utf-8');
    return { path: srtPath, content };
});

// ========== ファイル保存ダイアログ ==========
ipcMain.handle('save-srt-file', async (event, { content, defaultName }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: defaultName,
        filters: [{ name: 'SRT Files', extensions: ['srt'] }]
    });

    if (result.canceled) return false;
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return true;
});

ipcMain.handle('save-txt-file', async (event, { content, defaultName }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: defaultName,
        filters: [{ name: 'Text Files', extensions: ['txt'] }]
    });

    if (result.canceled) return false;
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return true;
});

// ========== Gemini APIキー ==========
ipcMain.handle('get-api-key', () => {
    return process.env.GEMINI_API_KEY || '';
});

ipcMain.handle('save-api-key', (event, apiKey) => {
    process.env.GEMINI_API_KEY = apiKey;
    fs.writeFileSync(envPath, `GEMINI_API_KEY=${apiKey}\n`, 'utf-8');
    return true;
});
