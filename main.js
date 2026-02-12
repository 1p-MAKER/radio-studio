const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// .envファイルを読み込む
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        const value = valueParts.join('='); // APIキーに=が含まれる場合対応
        if (key && value) {
            process.env[key.trim()] = value.trim();
        }
    });
}

// 出力先ディレクトリ
const OUTPUT_DIR = '/Volumes/1peiHDD_2TB/DaVinciResolve_material_HDD/RADIO/';
// Gemini APIエンドポイント
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com';

let mainWindow;
let transcriptionAborted = false;

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
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ========== MIMEタイプ判定 ==========
function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.m4a': 'audio/mp4',
        '.aac': 'audio/aac',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac'
    };
    return mimeMap[ext] || 'audio/mpeg';
}

// ========== Gemini File API: ファイルアップロード ==========
async function uploadFileToGemini(filePath, apiKey) {
    const mimeType = getMimeType(filePath);
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const fileSize = fileBuffer.length;

    // リジューマブルアップロードを開始
    const initRes = await fetch(
        `${GEMINI_API_BASE}/upload/v1beta/files?key=${apiKey}`,
        {
            method: 'POST',
            headers: {
                'X-Goog-Upload-Protocol': 'resumable',
                'X-Goog-Upload-Command': 'start',
                'X-Goog-Upload-Header-Content-Length': fileSize.toString(),
                'X-Goog-Upload-Header-Content-Type': mimeType,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                file: { displayName: fileName }
            })
        }
    );

    if (!initRes.ok) {
        const err = await initRes.text();
        throw new Error(`ファイルアップロード初期化エラー: ${err}`);
    }

    const uploadUrl = initRes.headers.get('X-Goog-Upload-URL');

    // ファイルデータをアップロード
    const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            'X-Goog-Upload-Offset': '0',
            'X-Goog-Upload-Command': 'upload, finalize',
            'Content-Length': fileSize.toString()
        },
        body: fileBuffer
    });

    if (!uploadRes.ok) {
        const err = await uploadRes.text();
        throw new Error(`ファイルアップロードエラー: ${err}`);
    }

    const result = await uploadRes.json();
    return result.file;
}

// ========== Gemini File API: 処理状態を確認 ==========
async function waitForFileProcessing(fileUri, apiKey) {
    const fileName = fileUri.replace('https://generativelanguage.googleapis.com/v1beta/', '');

    for (let i = 0; i < 60; i++) { // 最大5分待機
        const res = await fetch(
            `${GEMINI_API_BASE}/v1beta/${fileName}?key=${apiKey}`
        );
        const data = await res.json();

        if (data.state === 'ACTIVE') {
            return data;
        } else if (data.state === 'FAILED') {
            throw new Error('ファイル処理に失敗しました');
        }

        // 5秒待機
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    throw new Error('ファイル処理がタイムアウトしました');
}

// ========== Gemini で文字起こし ==========
async function transcribeWithGemini(filePath, apiKey) {
    // 1. ファイルをアップロード
    mainWindow.webContents.send('transcription-progress', {
        status: '音声ファイルをアップロード中...',
        percentage: 10
    });

    const uploadedFile = await uploadFileToGemini(filePath, apiKey);

    if (transcriptionAborted) throw new Error('キャンセルされました');

    // 2. 処理完了を待機
    mainWindow.webContents.send('transcription-progress', {
        status: 'AIが音声を解析中...',
        percentage: 30
    });

    const activeFile = await waitForFileProcessing(uploadedFile.uri, apiKey);

    if (transcriptionAborted) throw new Error('キャンセルされました');

    // 3. Geminiに文字起こしリクエスト
    mainWindow.webContents.send('transcription-progress', {
        status: '文字起こしを実行中...',
        percentage: 50
    });

    const prompt = `あなたはプロの日本語音声文字起こしスペシャリストです。
この音声ファイルを聞いて、正確にSRT字幕形式で文字起こししてください。

【絶対ルール】
1. 出力はSRT形式のテキストのみ。前後に説明文やマークダウンは一切付けない
2. 音声に含まれるすべての発話を漏れなく書き起こす（省略・要約は厳禁）
3. タイムスタンプは音声の実際の発話タイミングに正確に合わせる
4. 1エントリは1〜2文程度、長くても3秒〜8秒の区間にする
5. 句読点（、。！？）を適切に入れる
6. 聞き取れない部分は（聞き取り不明）と表記する（推測で埋めない）
7. 話者が複数いる場合は、できれば発話者を区別する
8. 「えっと」「あの」「まあ」など口語表現はそのまま残す
9. 固有名詞・人名・地名は文脈から正しく判別する
10. SRTの番号は1から連番

【SRTフォーマット】
1
00:00:00,000 --> 00:00:03,500
こんにちは、今日も
ラジオを始めていきます

2
00:00:03,800 --> 00:00:07,200
今回のテーマはこちらです`;

    const generateRes = await fetch(
        `${GEMINI_API_BASE}/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { fileData: { mimeType: activeFile.mimeType, fileUri: activeFile.uri } },
                        { text: prompt }
                    ]
                }],
                generationConfig: {
                    temperature: 0.0,
                    maxOutputTokens: 131072
                }
            })
        }
    );

    if (!generateRes.ok) {
        const err = await generateRes.text();
        throw new Error(`Gemini API エラー: ${err}`);
    }

    mainWindow.webContents.send('transcription-progress', {
        status: 'SRTを生成中...',
        percentage: 90
    });

    const generateData = await generateRes.json();

    if (!generateData.candidates || generateData.candidates.length === 0) {
        throw new Error('Geminiからの応答が空です');
    }

    let srtContent = generateData.candidates[0].content.parts[0].text;

    // コードブロックのマークダウンを除去
    srtContent = srtContent.replace(/^```srt\n?/m, '').replace(/^```\n?/m, '').trim();

    return srtContent;
}

// ========== 音声ファイル選択 ==========
ipcMain.handle('select-audio-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
});

// ========== SRTファイル選択（既存SRT読み込み用） ==========
ipcMain.handle('select-srt-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'SRT Files', extensions: ['srt'] }]
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf-8');
    return { path: filePath, content };
});

// ========== 字幕生成（Gemini音声直接入力） ==========
ipcMain.handle('start-transcription', async (event, audioPath) => {
    transcriptionAborted = false;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_api_key_here') {
        throw new Error('Gemini APIキーが設定されていません。画面上部で設定してください。');
    }

    if (!fs.existsSync(audioPath)) {
        throw new Error(`ファイルが見つかりません: ${audioPath}`);
    }

    try {
        const srtContent = await transcribeWithGemini(audioPath, apiKey);

        // SRTファイルを保存
        const fileName = path.basename(audioPath, path.extname(audioPath));
        const outputDir = OUTPUT_DIR;

        // 出力ディレクトリが存在するか確認（なければカレントに保存）
        let srtPath;
        if (fs.existsSync(outputDir)) {
            srtPath = path.join(outputDir, `${fileName}.srt`);
        } else {
            srtPath = path.join(__dirname, `${fileName}.srt`);
        }

        fs.writeFileSync(srtPath, srtContent, 'utf-8');

        mainWindow.webContents.send('transcription-progress', {
            status: '完了！',
            percentage: 100
        });

        return { type: 'done', srt_path: srtPath };

    } catch (error) {
        if (transcriptionAborted) {
            throw new Error('キャンセルされました');
        }
        throw error;
    }
});

// 字幕生成キャンセル
ipcMain.handle('cancel-transcription', () => {
    transcriptionAborted = true;
    return true;
});

// ========== SRTファイル読み込み ==========
ipcMain.handle('read-srt-file', async (event, srtPath) => {
    if (!fs.existsSync(srtPath)) return null;
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
