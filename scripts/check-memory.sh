#!/bin/bash

# Script to monitor chatshell-desktop memory usage
# Usage: ./scripts/check-memory.sh

echo "=== ChatShell Desktop Memory Monitor ==="
echo ""

# Find the process
PROCESS_NAME="chatshell-desktop"

while true; do
    # Get memory usage on macOS
    MEMORY=$(ps aux | grep "$PROCESS_NAME" | grep -v grep | awk '{sum+=$6} END {print sum/1024}')
    
    if [ -z "$MEMORY" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') - Process not running"
    else
        # Format memory to 2 decimal places
        MEMORY_MB=$(printf "%.2f" $MEMORY)
        echo "$(date '+%Y-%m-%d %H:%M:%S') - Memory Usage: ${MEMORY_MB} MB"
        
        # Warning if memory exceeds 1GB
        if (( $(echo "$MEMORY_MB > 1000" | bc -l) )); then
            echo "⚠️  WARNING: Memory usage exceeds 1GB!"
        fi
    fi
    
    sleep 5
done

