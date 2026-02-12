"""
字幕生成スクリプト（Electronから子プロセスとして呼び出される）
音声ファイルからfaster-whisperで文字起こしし、SRTファイルを生成する。
進捗はJSON形式でstdoutに出力し、Electron側でリアルタイム表示する。
"""

import os
import sys
import subprocess
import shutil
import json
from pathlib import Path

# faster-whisperのインポート
from faster_whisper import WhisperModel

# --- 設定 ---
MODEL_SIZE = "large-v3"
LANGUAGE = "ja"


def send_message(msg_type, **kwargs):
    """Electronにメッセージを送信（JSON形式でstdoutに出力）"""
    msg = {"type": msg_type, **kwargs}
    print(json.dumps(msg, ensure_ascii=False), flush=True)


def format_timestamp(seconds):
    """秒をSRTタイムスタンプ形式（HH:MM:SS,mmm）に変換"""
    whole_seconds = int(seconds)
    milliseconds = int((seconds - whole_seconds) * 1000)
    hours = whole_seconds // 3600
    minutes = (whole_seconds % 3600) // 60
    secs = whole_seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"


def write_srt(segments, output_file):
    """セグメントをSRTファイルに書き込む（20文字で折り返し）"""
    with open(output_file, "w", encoding="utf-8") as f:
        for i, segment in enumerate(segments, start=1):
            start_time = format_timestamp(segment.start)
            end_time = format_timestamp(segment.end)
            text = segment.text.strip()

            # 20文字で折り返し
            formatted_text = ""
            current_line_len = 0
            for char in text:
                formatted_text += char
                current_line_len += 1
                if current_line_len >= 20 and char not in ["、", "。", "」", "』"]:
                    formatted_text += "\n"
                    current_line_len = 0

            f.write(f"{i}\n")
            f.write(f"{start_time} --> {end_time}\n")
            f.write(f"{formatted_text}\n\n")


def convert_to_wav(audio_path, wav_path):
    """音声ファイルをWhisper用WAV（16kHz, mono）に変換"""
    send_message("progress", status="音声フォーマットを変換しています...", percentage=10)

    cmd = [
        "ffmpeg", "-y",
        "-i", audio_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        wav_path
    ]
    try:
        subprocess.run(cmd, check=True, stderr=subprocess.PIPE, stdout=subprocess.PIPE)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"音声変換エラー: {e.stderr.decode() if e.stderr else str(e)}")

    send_message("progress", status="音声変換完了", percentage=20)


def run(audio_path, output_dir):
    """メイン処理"""
    if not os.path.exists(audio_path):
        send_message("error", message=f"ファイルが見つかりません: {audio_path}")
        return

    # ffmpegの確認
    if not shutil.which("ffmpeg"):
        send_message("error", message="ffmpegが見つかりません。brew install ffmpeg でインストールしてください。")
        return

    file_name = Path(audio_path).stem
    output_path = Path(output_dir)

    # 出力ディレクトリの確認・作成
    try:
        output_path.mkdir(parents=True, exist_ok=True)
        if not os.access(output_path, os.W_OK):
            raise PermissionError(f"書き込み権限がありません: {output_path}")
    except Exception as e:
        send_message("error", message=f"出力ディレクトリにアクセスできません: {output_path} ({e})")
        return

    srt_output_path = output_path / f"{file_name}.srt"
    temp_wav_path = Path("temp_audio.wav")

    try:
        # 1. 音声フォーマット変換（WAVに統一）
        ext = Path(audio_path).suffix.lower()
        if ext == ".wav":
            # WAVファイルの場合もサンプルレート統一のため変換
            convert_to_wav(audio_path, str(temp_wav_path))
            transcribe_path = str(temp_wav_path)
        else:
            convert_to_wav(audio_path, str(temp_wav_path))
            transcribe_path = str(temp_wav_path)

        # 2. AIモデル読み込み
        send_message("progress", status="AIモデルを読み込んでいます...", percentage=30)

        device = "cpu"
        compute_type = "int8"

        try:
            model = WhisperModel(MODEL_SIZE, device=device, compute_type=compute_type)
        except Exception as e:
            send_message("progress", status="モデル読み込み再試行中...", percentage=30)
            model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")

        # 3. 文字起こし
        send_message("progress", status="文字起こしを実行中...", percentage=40)

        segments_generator, info = model.transcribe(transcribe_path, beam_size=5, language=LANGUAGE)
        total_duration = info.duration

        segments = []
        for segment in segments_generator:
            segments.append(segment)
            if total_duration > 0:
                percent = 40 + int((segment.end / total_duration) * 50)
                send_message("progress",
                    status=f"文字起こし中... ({int(segment.end)}秒/{int(total_duration)}秒)",
                    percentage=min(percent, 90)
                )

        # 4. SRTファイル生成
        send_message("progress", status="SRTファイルを生成中...", percentage=95)
        write_srt(segments, srt_output_path)

        # 5. 完了
        send_message("done", srt_path=str(srt_output_path))

    except Exception as e:
        send_message("error", message=str(e))
    finally:
        if temp_wav_path.exists():
            os.remove(temp_wav_path)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        send_message("error", message="Usage: python transcriber.py <audio_file_path> <output_dir>")
        sys.exit(1)

    audio_path = sys.argv[1]
    output_dir = sys.argv[2]
    run(audio_path, output_dir)
