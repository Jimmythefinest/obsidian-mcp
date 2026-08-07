# Desktop Analytics Architecture

## Purpose
Track desktop usage events and create usage analytics.

## Components
- Python monitoring daemon
- psutil process tracking
- xdotool window detection
- JSONL event storage
- systemd user service

## Events
- BOOT
- WINDOW_FOCUS
- TITLE
- LOCK
- UNLOCK
- IDLE
- STOP_IDLE
