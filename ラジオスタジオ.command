#!/bin/bash
# ラジオスタジオ ランチャー

PROJECT_DIR="/Users/the1/.gemini/antigravity/scratch/radio-studio"

if [ ! -d "$PROJECT_DIR" ]; then
    echo "エラー: プロジェクトディレクトリが見つかりません ($PROJECT_DIR)"
    read -p "Press Enter to exit..."
    exit 1
fi

cd "$PROJECT_DIR"

echo "ラジオスタジオを起動します..."
npm start > /dev/null 2>&1 &

exit 0
