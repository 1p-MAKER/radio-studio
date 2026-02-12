/**
 * SRTファイルのパース・生成・分割処理
 */

class SrtParser {
    /**
     * SRTファイルをパースしてエントリの配列に変換
     * @param {string} content - SRTファイルの内容
     * @returns {Array} パースされたエントリ配列
     */
    static parse(content) {
        const entries = [];
        const blocks = content.trim().split(/\n\n+/);

        for (const block of blocks) {
            const lines = block.split('\n');
            if (lines.length < 2) continue;

            // インデックス番号
            const index = parseInt(lines[0], 10);
            if (isNaN(index)) continue;

            // タイムスタンプ
            const timeMatch = lines[1].match(
                /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/
            );
            if (!timeMatch) continue;

            // テキスト（3行目以降）
            const text = lines.slice(2).join('\n');

            entries.push({
                index,
                startTime: timeMatch[1],
                endTime: timeMatch[2],
                startMs: this.timeToMs(timeMatch[1]),
                endMs: this.timeToMs(timeMatch[2]),
                text
            });
        }

        return entries;
    }

    /**
     * タイムスタンプをミリ秒に変換
     */
    static timeToMs(time) {
        const [hms, ms] = time.split(',');
        const [h, m, s] = hms.split(':').map(Number);
        return (h * 3600000) + (m * 60000) + (s * 1000) + parseInt(ms, 10);
    }

    /**
     * ミリ秒をタイムスタンプ形式に変換
     */
    static msToTime(ms) {
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        const millis = ms % 1000;

        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
    }

    /**
     * ミリ秒をYouTubeチャプター形式に変換（HH:MM:SS）
     */
    static msToChapterTime(ms) {
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);

        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    /**
     * 時間文字列（MM:SS）をミリ秒に変換
     */
    static parseTimeInput(timeStr) {
        const parts = timeStr.split(':');
        if (parts.length === 2) {
            const [m, s] = parts.map(Number);
            return (m * 60000) + (s * 1000);
        } else if (parts.length === 3) {
            const [h, m, s] = parts.map(Number);
            return (h * 3600000) + (m * 60000) + (s * 1000);
        }
        return 0;
    }

    /**
     * SRTエントリを時間で分割
     * @param {Array} entries - エントリ配列
     * @param {number} splitMs - 分割する時間（ミリ秒）
     * @returns {Object} { part1: [], part2: [], splitMs: number }
     */
    static splitByTime(entries, splitMs) {
        const part1 = entries.filter(e => e.startMs < splitMs);
        const part2 = entries.filter(e => e.startMs >= splitMs);
        return { part1, part2, splitMs };
    }

    /**
     * SRTエントリを2等分
     */
    static splitInHalf(entries) {
        if (entries.length === 0) return { part1: [], part2: [], splitMs: 0 };

        const totalDuration = entries[entries.length - 1].endMs;
        const halfPoint = totalDuration / 2;

        return this.splitByTime(entries, halfPoint);
    }

    /**
     * テキストだけを抽出して連結（タイムスタンプ情報付き）
     * Gemini APIが話題の開始時間を推定できるようにタイムスタンプも含める
     */
    static extractTextWithTimestamp(entries) {
        return entries.map(e => {
            const time = this.msToChapterTime(e.startMs);
            return `[${time}] ${e.text}`;
        }).join('\n');
    }

    /**
     * テキストだけを抽出（従来版、互換性のため残す）
     */
    static extractText(entries) {
        return entries.map(e => e.text).join('\n');
    }

    /**
     * タイムスタンプ付き話題リストからSRT形式の文字列を生成
     * @param {Array} topics - 話題の配列 [{time: "00:05:30", topic: "話題名"}, ...]
     * @param {string} title - タイトル（任意）
     * @returns {string} SRT形式の文字列
     */
    static generateChapterSrt(topics, title = '【今回の話題】') {
        let srt = '';
        let index = 1;
        let currentMs = 0;
        const displayDuration = 5000; // 各話題5秒表示

        // タイトル
        srt += `${index}\n`;
        srt += `${this.msToTime(currentMs)} --> ${this.msToTime(currentMs + displayDuration)}\n`;
        srt += `${title}\n\n`;
        index++;
        currentMs += displayDuration;

        // 各話題（タイムスタンプ付き）
        for (const item of topics) {
            const topicText = typeof item === 'string'
                ? `・${item}`
                : `${item.time} ${item.topic}`;

            srt += `${index}\n`;
            srt += `${this.msToTime(currentMs)} --> ${this.msToTime(currentMs + displayDuration)}\n`;
            srt += `${topicText}\n\n`;
            index++;
            currentMs += displayDuration;
        }

        return srt;
    }

    /**
     * 分割された話題リストからSRT形式を生成
     */
    static generateSplitChapterSrt(part1Topics, part2Topics) {
        let srt = '';
        let index = 1;
        let currentMs = 0;
        const displayDuration = 5000;

        // 前半
        srt += `${index}\n`;
        srt += `${this.msToTime(currentMs)} --> ${this.msToTime(currentMs + displayDuration)}\n`;
        srt += `【前半の話題】\n\n`;
        index++;
        currentMs += displayDuration;

        const p1Topics = Array.isArray(part1Topics) ? part1Topics : (part1Topics.topics || []);
        for (const item of p1Topics) {
            const topicText = typeof item === 'string'
                ? `・${item}`
                : `${item.time} ${item.topic}`;

            srt += `${index}\n`;
            srt += `${this.msToTime(currentMs)} --> ${this.msToTime(currentMs + displayDuration)}\n`;
            srt += `${topicText}\n\n`;
            index++;
            currentMs += displayDuration;
        }

        // 区切り
        currentMs += displayDuration;

        // 後半
        srt += `${index}\n`;
        srt += `${this.msToTime(currentMs)} --> ${this.msToTime(currentMs + displayDuration)}\n`;
        srt += `【後半の話題】\n\n`;
        index++;
        currentMs += displayDuration;

        const p2Topics = Array.isArray(part2Topics) ? part2Topics : (part2Topics.topics || []);
        for (const item of p2Topics) {
            const topicText = typeof item === 'string'
                ? `・${item}`
                : `${item.time} ${item.topic}`;

            srt += `${index}\n`;
            srt += `${this.msToTime(currentMs)} --> ${this.msToTime(currentMs + displayDuration)}\n`;
            srt += `${topicText}\n\n`;
            index++;
            currentMs += displayDuration;
        }

        return srt;
    }
}

// グローバルに公開
window.SrtParser = SrtParser;
