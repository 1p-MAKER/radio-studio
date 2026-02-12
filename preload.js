const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // 音声ファイルを選択
    selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),

    // SRTファイルを選択（既存SRT読み込み用）
    selectSrtFile: () => ipcRenderer.invoke('select-srt-file'),

    // 字幕生成を開始
    startTranscription: (audioPath) => ipcRenderer.invoke('start-transcription', audioPath),

    // 字幕生成をキャンセル
    cancelTranscription: () => ipcRenderer.invoke('cancel-transcription'),

    // 字幕生成の進捗を受信
    onTranscriptionProgress: (callback) => {
        ipcRenderer.on('transcription-progress', (event, data) => callback(data));
    },

    // 生成済みSRTを読み込み
    readSrtFile: (srtPath) => ipcRenderer.invoke('read-srt-file', srtPath),

    // SRTファイルを保存
    saveSrtFile: (content, defaultName) =>
        ipcRenderer.invoke('save-srt-file', { content, defaultName }),

    // テキストファイルを保存
    saveTxtFile: (content, defaultName) =>
        ipcRenderer.invoke('save-txt-file', { content, defaultName }),

    // APIキー取得
    getApiKey: () => ipcRenderer.invoke('get-api-key'),

    // APIキー保存
    saveApiKey: (apiKey) => ipcRenderer.invoke('save-api-key', apiKey)
});
