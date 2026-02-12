/**
 * レンダラープロセス - 統合UIロジック
 * STEP 1: 音声ファイル選択 → STEP 2: 字幕生成 → STEP 3: チャプター生成
 */

// ========== 状態管理 ==========
let currentAudioPath = null;
let currentSrtData = null; // { path, content }
let srtEntries = [];
let generatedTopics = null;
let generatedSrt = '';
let currentSplitMs = 0;
let isTranscribing = false;

// ========== DOM要素 ==========
// APIキー
const apiKeyInput = document.getElementById('apiKeyInput');
const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
const apiStatus = document.getElementById('apiStatus');

// STEP 1
const selectAudioBtn = document.getElementById('selectAudioBtn');
const audioInfo = document.getElementById('audioInfo');
const audioFileName = document.getElementById('audioFileName');
const selectSrtBtn = document.getElementById('selectSrtBtn');
const existingSrtInfo = document.getElementById('existingSrtInfo');
const existingSrtName = document.getElementById('existingSrtName');
const existingSrtMeta = document.getElementById('existingSrtMeta');

// STEP 2
const step2Section = document.getElementById('step2Section');
const transcriptionStatusText = document.getElementById('transcriptionStatusText');
const transcriptionProgress = document.getElementById('transcriptionProgress');
const transcriptionPercent = document.getElementById('transcriptionPercent');
const startTranscriptionBtn = document.getElementById('startTranscriptionBtn');
const cancelTranscriptionBtn = document.getElementById('cancelTranscriptionBtn');
const srtResult = document.getElementById('srtResult');
const srtResultPath = document.getElementById('srtResultPath');

// STEP 3
const step3Section = document.getElementById('step3Section');
const srtFileName = document.getElementById('srtFileName');
const srtFileMeta = document.getElementById('srtFileMeta');
const splitTimeInput = document.getElementById('splitTime');
const generateBtn = document.getElementById('generateBtn');
const loading = document.getElementById('loading');
const splitModeRadios = document.querySelectorAll('input[name="splitMode"]');

// 結果
const resultSection = document.getElementById('resultSection');
const resultContent = document.getElementById('resultContent');
const saveBtn = document.getElementById('saveBtn');
const saveTxtBtn = document.getElementById('saveTxtBtn');
const copyBtn = document.getElementById('copyBtn');

// サムネイル
const thumbSection1 = document.getElementById('thumbSection1');
const thumbSection2 = document.getElementById('thumbSection2');
const dropZone1 = document.getElementById('dropZone1');
const dropZone2 = document.getElementById('dropZone2');
const bgInput1 = document.getElementById('bgInput1');
const bgInput2 = document.getElementById('bgInput2');
const thumbCanvas1 = document.getElementById('thumbCanvas1');
const thumbCanvas2 = document.getElementById('thumbCanvas2');
const downloadThumb1 = document.getElementById('downloadThumb1');
const downloadThumb2 = document.getElementById('downloadThumb2');
const textPattern1 = document.getElementById('textPattern1');
const textPattern2 = document.getElementById('textPattern2');
const thumbMain1 = document.getElementById('thumbMain1');
const thumbSub1 = document.getElementById('thumbSub1');
const thumbMain2 = document.getElementById('thumbMain2');
const thumbSub2 = document.getElementById('thumbSub2');

let thumbImg1 = null;
let thumbImg2 = null;

// ========== 初期化 ==========
async function init() {
    const apiKey = await window.electronAPI.getApiKey();
    if (apiKey && apiKey !== 'your_api_key_here') {
        apiKeyInput.value = apiKey;
        apiStatus.textContent = '✓ APIキー設定済み';
        apiStatus.classList.add('success');
    }

    setupEventListeners();

    // 字幕生成の進捗を受信
    window.electronAPI.onTranscriptionProgress((data) => {
        updateTranscriptionProgress(data.status, data.percentage);
    });
}

// ========== イベントリスナー ==========
function setupEventListeners() {
    // APIキー保存
    saveApiKeyBtn.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            apiStatus.textContent = 'APIキーを入力してください';
            return;
        }
        await window.electronAPI.saveApiKey(apiKey);
        apiStatus.textContent = '✓ APIキーを保存しました';
        apiStatus.classList.add('success');
    });

    // STEP 1: 音声ファイル選択
    selectAudioBtn.addEventListener('click', async () => {
        const filePath = await window.electronAPI.selectAudioFile();
        if (filePath) {
            currentAudioPath = filePath;
            currentSrtData = null;

            // 表示更新
            const pathParts = filePath.split('/');
            audioFileName.textContent = pathParts[pathParts.length - 1];
            audioInfo.classList.remove('hidden');
            existingSrtInfo.classList.add('hidden');

            // STEP 2を表示、STEP 3を非表示
            step2Section.classList.remove('hidden');
            step3Section.classList.add('hidden');
            resultSection.classList.add('hidden');
            resetTranscriptionUI();
        }
    });

    // STEP 1: 既存SRT読み込み
    selectSrtBtn.addEventListener('click', async () => {
        const result = await window.electronAPI.selectSrtFile();
        if (result) {
            currentAudioPath = null;
            currentSrtData = result;
            srtEntries = SrtParser.parse(result.content);

            // 表示更新
            const pathParts = result.path.split('/');
            existingSrtName.textContent = pathParts[pathParts.length - 1];
            const totalDuration = srtEntries.length > 0 ? srtEntries[srtEntries.length - 1].endMs : 0;
            existingSrtMeta.textContent = `${srtEntries.length}件のエントリ / 約${formatDuration(totalDuration)}`;
            existingSrtInfo.classList.remove('hidden');
            audioInfo.classList.add('hidden');

            // STEP 2をスキップしてSTEP 3を直接表示
            step2Section.classList.add('hidden');
            showStep3(result.path, srtEntries);
        }
    });

    // STEP 2: 字幕生成開始
    startTranscriptionBtn.addEventListener('click', startTranscription);

    // STEP 2: キャンセル
    cancelTranscriptionBtn.addEventListener('click', async () => {
        await window.electronAPI.cancelTranscription();
        isTranscribing = false;
        resetTranscriptionUI();
        transcriptionStatusText.textContent = 'キャンセルされました';
    });

    // STEP 3: 分割モード切り替え
    splitModeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            splitTimeInput.disabled = e.target.value !== 'time';
        });
    });

    // STEP 3: チャプター生成
    generateBtn.addEventListener('click', generateChapters);

    // 結果: SRT保存
    saveBtn.addEventListener('click', async () => {
        if (!generatedSrt) return;
        const defaultName = currentSrtData
            ? currentSrtData.path.replace('.srt', '_chapters.srt')
            : 'chapters.srt';
        const pathParts = defaultName.split('/');
        const success = await window.electronAPI.saveSrtFile(generatedSrt, pathParts[pathParts.length - 1]);
        if (success) alert('SRTファイルを保存しました！');
    });

    // 結果: テキスト保存
    saveTxtBtn.addEventListener('click', async () => {
        if (!generatedTopics) return;
        const textContent = generateTextContent();
        const defaultName = currentSrtData
            ? currentSrtData.path.replace('.srt', '_chapters.txt')
            : 'chapters.txt';
        const pathParts = defaultName.split('/');
        const success = await window.electronAPI.saveTxtFile(textContent, pathParts[pathParts.length - 1]);
        if (success) alert('テキストファイルを保存しました！');
    });

    // 結果: コピー
    copyBtn.addEventListener('click', () => {
        if (!generatedTopics) return;
        const textToCopy = generateTextContent();
        navigator.clipboard.writeText(textToCopy).then(() => {
            const original = copyBtn.textContent;
            copyBtn.textContent = '✓ コピーしました';
            setTimeout(() => { copyBtn.textContent = original; }, 2000);
        });
    });

    // サムネイル
    setupThumbnailListeners(1);
    setupThumbnailListeners(2);
}

// ========== STEP 2: 字幕生成 ==========
async function startTranscription() {
    if (isTranscribing || !currentAudioPath) return;

    isTranscribing = true;
    startTranscriptionBtn.classList.add('hidden');
    cancelTranscriptionBtn.classList.remove('hidden');
    srtResult.classList.add('hidden');

    try {
        const result = await window.electronAPI.startTranscription(currentAudioPath);

        // 成功: SRTファイルが生成された
        updateTranscriptionProgress('完了！', 100);
        playCompletionSound();
        srtResultPath.textContent = `保存先: ${result.srt_path}`;
        srtResult.classList.remove('hidden');

        // 生成されたSRTを読み込んでSTEP 3へ
        const srtData = await window.electronAPI.readSrtFile(result.srt_path);
        if (srtData) {
            currentSrtData = srtData;
            srtEntries = SrtParser.parse(srtData.content);
            showStep3(srtData.path, srtEntries);
        }
    } catch (error) {
        alert(`字幕生成エラー: ${error.message}`);
        updateTranscriptionProgress('エラーが発生しました', 0);
    } finally {
        isTranscribing = false;
        startTranscriptionBtn.classList.remove('hidden');
        cancelTranscriptionBtn.classList.add('hidden');
    }
}

function updateTranscriptionProgress(status, percentage) {
    transcriptionStatusText.textContent = status;
    transcriptionProgress.style.width = `${percentage}%`;
    transcriptionPercent.textContent = `${percentage}%`;
}

function resetTranscriptionUI() {
    updateTranscriptionProgress('待機中', 0);
    startTranscriptionBtn.classList.remove('hidden');
    cancelTranscriptionBtn.classList.add('hidden');
    srtResult.classList.add('hidden');
}

// ========== STEP 3表示 ==========
function showStep3(srtPath, entries) {
    step3Section.classList.remove('hidden');

    const pathParts = srtPath.split('/');
    srtFileName.textContent = pathParts[pathParts.length - 1];

    const totalDuration = entries.length > 0 ? entries[entries.length - 1].endMs : 0;
    srtFileMeta.textContent = `${entries.length}件のエントリ / 約${formatDuration(totalDuration)}`;
}

// ========== STEP 3: チャプター生成 ==========
async function generateChapters() {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey || !currentSrtData) return;

    const splitMode = document.querySelector('input[name="splitMode"]:checked').value;

    generateBtn.disabled = true;
    loading.classList.remove('hidden');
    resultSection.classList.add('hidden');

    try {
        const gemini = new GeminiAPI(apiKey);

        if (splitMode === 'none') {
            const text = SrtParser.extractTextWithTimestamp(srtEntries);
            const result = await gemini.analyzeTopics(text);
            generatedTopics = result;
            generatedSrt = SrtParser.generateChapterSrt(result.topics || result);

            displayResults(result);

            thumbSection1.classList.remove('hidden');
            thumbSection2.classList.add('hidden');
            document.getElementById('thumbTitle1').textContent = 'サムネイル画像';
            updateThumbnailInputs(1, result.thumbnails);
        } else {
            let splitResult;
            if (splitMode === 'half') {
                splitResult = SrtParser.splitInHalf(srtEntries);
            } else {
                const splitMs = SrtParser.parseTimeInput(splitTimeInput.value);
                splitResult = SrtParser.splitByTime(srtEntries, splitMs);
            }

            currentSplitMs = splitResult.splitMs;

            const text1 = SrtParser.extractTextWithTimestamp(splitResult.part1);
            const text2 = SrtParser.extractTextWithTimestamp(splitResult.part2);

            const result = await gemini.analyzeSplitTopics(text1, text2, currentSplitMs);
            generatedTopics = result;
            generatedSrt = SrtParser.generateSplitChapterSrt(result.part1, result.part2);

            displaySplitResults(result.part1, result.part2);

            thumbSection1.classList.remove('hidden');
            thumbSection2.classList.remove('hidden');
            document.getElementById('thumbTitle1').textContent = '前半用サムネイル画像';
            updateThumbnailInputs(1, result.part1.thumbnails);
            updateThumbnailInputs(2, result.part2.thumbnails);
        }

        resultSection.classList.remove('hidden');
        playCompletionSound();
    } catch (error) {
        alert(`エラー: ${error.message}`);
        console.error(error);
    } finally {
        generateBtn.disabled = false;
        loading.classList.add('hidden');
    }
}

// ========== 結果表示 ==========
function displayResults(data) {
    const topics = data.topics || data;
    const titles = data.titles || (data.title ? [data.title] : ['（タイトルなし）']);

    resultContent.innerHTML = `
    <div class="video-title-section">
      <div class="part-title">📺 動画タイトル案（ABテスト用）</div>
      ${titles.map((t, i) => `<div class="video-title-item"><span class="title-label">案${i + 1}:</span> ${escapeHtml(t)}</div>`).join('')}
    </div>
    <div class="part-title">【今回の話題】</div>
    ${topics.map(t => {
        const text = typeof t === 'string' ? `・${t}` : `${t.time} ${escapeHtml(t.topic)}`;
        return `<div class="topic-item">${text}</div>`;
    }).join('')}
  `;
}

function displaySplitResults(part1, part2) {
    const p1Topics = part1.topics || part1;
    const p1Titles = part1.titles || (part1.title ? [part1.title] : ['（タイトルなし）']);
    const p2Topics = part2.topics || part2;
    const p2Titles = part2.titles || (part2.title ? [part2.title] : ['（タイトルなし）']);

    resultContent.innerHTML = `
    <div class="video-title-section">
      <div class="part-title">📺 前半動画タイトル案</div>
      ${p1Titles.map((t, i) => `<div class="video-title-item"><span class="title-label">案${i + 1}:</span> ${escapeHtml(t)}</div>`).join('')}
    </div>
    <div class="part-title">【前半の話題】</div>
    ${p1Topics.map(t => {
        const text = typeof t === 'string' ? `・${t}` : `${t.time} ${escapeHtml(t.topic)}`;
        return `<div class="topic-item">${text}</div>`;
    }).join('')}

    <hr class="divider">

    <div class="video-title-section">
      <div class="part-title">📺 後半動画タイトル案</div>
      ${p2Titles.map((t, i) => `<div class="video-title-item"><span class="title-label">案${i + 1}:</span> ${escapeHtml(t)}</div>`).join('')}
    </div>
    <div class="part-title">【後半の話題】</div>
    ${p2Topics.map(t => {
        const text = typeof t === 'string' ? `・${t}` : `${t.time} ${escapeHtml(t.topic)}`;
        return `<div class="topic-item">${text}</div>`;
    }).join('')}
  `;
}

// ========== テキスト生成 ==========
function generateTextContent() {
    let text = '';

    if (generatedTopics.part1 && generatedTopics.part2) {
        const p1 = generatedTopics.part1;
        const p2 = generatedTopics.part2;
        const p1Titles = p1.titles || (p1.title ? [p1.title] : ['（タイトルなし）']);
        const p2Titles = p2.titles || (p2.title ? [p2.title] : ['（タイトルなし）']);
        const p1Thumbs = p1.thumbnails || [];
        const p2Thumbs = p2.thumbnails || [];
        const p1Topics = p1.topics || p1;
        const p2Topics = p2.topics || p2;

        text += '【前半タイトル案】\n';
        p1Titles.forEach((t, i) => text += `案${i + 1}: ${t}\n`);
        text += '\n【前半サムネ文言案】\n';
        p1Thumbs.forEach((tm, i) => text += `案${i + 1}: メイン「${tm.main}」 サブ「${tm.sub}」\n`);
        text += '\n【前半の話題】\n';
        text += p1Topics.map(t => typeof t === 'string' ? `・${t}` : `${t.time} ${t.topic}`).join('\n');

        text += '\n\n-------------------\n\n';

        text += '【後半タイトル案】\n';
        p2Titles.forEach((t, i) => text += `案${i + 1}: ${t}\n`);
        text += '\n【後半サムネ文言案】\n';
        p2Thumbs.forEach((tm, i) => text += `案${i + 1}: メイン「${tm.main}」 サブ「${tm.sub}」\n`);
        text += '\n【後半の話題】\n';
        text += p2Topics.map(t => typeof t === 'string' ? `・${t}` : `${t.time} ${t.topic}`).join('\n');
    } else {
        const topics = generatedTopics.topics || generatedTopics;
        const titles = generatedTopics.titles || (generatedTopics.title ? [generatedTopics.title] : ['（タイトルなし）']);
        const thumbs = generatedTopics.thumbnails || [];

        text = '【動画タイトル案】\n';
        titles.forEach((t, i) => text += `案${i + 1}: ${t}\n`);
        text += '\n【サムネ文言案】\n';
        thumbs.forEach((tm, i) => text += `案${i + 1}: メイン「${tm.main}」 サブ「${tm.sub}」\n`);
        text += '\n【今回の話題】\n';
        text += topics.map(t => typeof t === 'string' ? `・${t}` : `${t.time} ${t.topic}`).join('\n');
    }
    return text;
}

// ========== ユーティリティ ==========
function playCompletionSound() {
    try {
        const audio = new Audio('/System/Library/Sounds/Glass.aiff');
        audio.play().catch(() => {
            // サウンド再生失敗時はビープ音で代替
            new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdnd3d3d3d3d3d3Z2dXV0c3JxcG9ubWxramloZ2ZlZGNiYWBfXl1cW1pZWFdWVVRTUlFQT05NTExLSkpJSEdHRkVFREREQ0NDQ0NDQ0NDQ0NDRERDREVFR0dISUpLTE1OT1BRUlRVVldZWltcXV9gYWJkZWdoaWtsbW9wcXJ0dXZ3eHl6e3x8fX1+fn5+fn5+fn5+fn19fHx7enl4d3Z1dHNycXBvbm1sa2ppZ2ZlZGNiYWBfXl1cW1o=').play().catch(() => { });
        });
    } catch (e) {
        // 無視
    }
}

function formatDuration(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return hours > 0 ? `${hours}時間${minutes}分` : `${minutes}分`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========== サムネイル機能（既存流用） ==========
function setupThumbnailListeners(id) {
    const dropZone = id === 1 ? dropZone1 : dropZone2;
    const bgInput = id === 1 ? bgInput1 : bgInput2;
    const mainInput = id === 1 ? thumbMain1 : thumbMain2;
    const subInput = id === 1 ? thumbSub1 : thumbSub2;
    const downloadBtn = id === 1 ? downloadThumb1 : downloadThumb2;
    const canvas = id === 1 ? thumbCanvas1 : thumbCanvas2;
    const patternSelect = id === 1 ? textPattern1 : textPattern2;

    dropZone.addEventListener('click', () => bgInput.click());

    bgInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) loadThumbnailImage(file, id);
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--accent)';
    });
    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--border)';
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--border)';
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            loadThumbnailImage(file, id);
        }
    });

    mainInput.addEventListener('input', () => drawThumbnail(id));
    subInput.addEventListener('input', () => drawThumbnail(id));

    patternSelect.addEventListener('change', (e) => {
        const index = parseInt(e.target.value);
        let thumbs;
        if (generatedTopics && generatedTopics.part1 && generatedTopics.part2) {
            thumbs = id === 1 ? (generatedTopics.part1.thumbnails || []) : (generatedTopics.part2.thumbnails || []);
        } else if (generatedTopics) {
            thumbs = generatedTopics.thumbnails || [];
        } else {
            thumbs = [];
        }
        if (thumbs[index]) {
            mainInput.value = thumbs[index].main;
            subInput.value = thumbs[index].sub;
            drawThumbnail(id);
        }
    });

    downloadBtn.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = `thumbnail_part${id}_${getDateStr()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    });
}

function loadThumbnailImage(file, id) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            if (id === 1) thumbImg1 = img; else thumbImg2 = img;
            drawThumbnail(id);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function drawThumbnail(id) {
    const canvas = id === 1 ? thumbCanvas1 : thumbCanvas2;
    const ctx = canvas.getContext('2d');
    const img = id === 1 ? thumbImg1 : thumbImg2;
    const mainText = id === 1 ? thumbMain1.value : thumbMain2.value;
    const subText = id === 1 ? thumbSub1.value : thumbSub2.value;
    const maxWidth = canvas.width - 80;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (img) {
        const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
        const x = (canvas.width - img.width * scale) / 2;
        const y = (canvas.height - img.height * scale) / 2;
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
    } else {
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#666';
        ctx.font = 'bold 40px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('画像をドロップしてください', canvas.width / 2, canvas.height / 2);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 4;

    if (mainText) {
        let fontSize = 110;
        ctx.font = `900 ${fontSize}px "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif`;
        while (ctx.measureText(mainText).width > maxWidth && fontSize > 40) {
            fontSize -= 5;
            ctx.font = `900 ${fontSize}px "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif`;
        }
        const x = canvas.width / 2;
        const y = canvas.height - 100;
        ctx.lineWidth = 20;
        ctx.strokeStyle = 'black';
        ctx.strokeText(mainText, x, y);
        const gradient = ctx.createLinearGradient(0, y - fontSize / 2, 0, y + fontSize / 2);
        gradient.addColorStop(0, '#FFFFFF');
        gradient.addColorStop(0.5, '#FFFF00');
        gradient.addColorStop(1, '#FFCC00');
        ctx.fillStyle = gradient;
        ctx.fillText(mainText, x, y);
    }

    if (subText) {
        let fontSize = 70;
        ctx.font = `bold ${fontSize}px "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif`;
        while (ctx.measureText(subText).width > maxWidth && fontSize > 30) {
            fontSize -= 4;
            ctx.font = `bold ${fontSize}px "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif`;
        }
        const x = canvas.width / 2;
        const y = 80;
        ctx.lineWidth = 12;
        ctx.strokeStyle = 'black';
        ctx.strokeText(subText, x, y);
        ctx.fillStyle = 'white';
        ctx.fillText(subText, x, y);
    }
}

function getDateStr() {
    const now = new Date();
    return `${now.getMonth() + 1}${now.getDate()}`;
}

function updateThumbnailInputs(id, thumbnails) {
    const mainInput = id === 1 ? thumbMain1 : thumbMain2;
    const subInput = id === 1 ? thumbSub1 : thumbSub2;
    const patternSelect = id === 1 ? textPattern1 : textPattern2;
    patternSelect.value = "0";
    if (thumbnails && thumbnails.length > 0) {
        mainInput.value = thumbnails[0].main || '';
        subInput.value = thumbnails[0].sub || '';
    } else {
        mainInput.value = '';
        subInput.value = '';
    }
    drawThumbnail(id);
}

// ========== 初期化実行 ==========
init();
