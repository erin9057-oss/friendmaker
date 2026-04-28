# Setup on Windows

This guide covers the current **manual setup** flow for Windows users.

## What works today

- install dependencies
- flash ESP32 firmware with PlatformIO
- start the local web UI
- select a `COM` serial port and draw

## What is not included yet

- no one-click Windows launcher yet
- no automatic dependency installer yet

## Requirements

- Windows 10 or Windows 11
- `Node.js 20+`
- `npm 10+`
- `Python 3.10+`
- `PlatformIO Core 6+`
- `ESP32-WROOM-32 / ESP-32S`

## Install PlatformIO

Open **PowerShell** and run:

```powershell
python -m pip install --user --upgrade platformio
```

If `pio` is already in your `PATH`, you can use `pio ...` directly.

If not, use the full path form:

```powershell
$env:USERPROFILE\.platformio\penv\Scripts\pio.exe
```

## Install project dependencies

```powershell
cd C:\path\to\friendmaker
npm install
npm run check
```

## Flash firmware

Typical Windows serial ports look like:

- `COM3`
- `COM5`
- `COM7`

Flash the recommended firmware environment:

```powershell
cd C:\path\to\friendmaker\firmware\esp32
$env:USERPROFILE\.platformio\penv\Scripts\pio.exe run -e esp32dev_wireless -t upload --upload-port COM3
```

If `pio` is already in `PATH`, you can also run:

```powershell
pio run -e esp32dev_wireless -t upload --upload-port COM3
```

## Start the web UI

```powershell
cd C:\path\to\friendmaker
npm run ui:dev
```

When you see:

```text
Switch Auto Draw UI running at http://127.0.0.1:4307
```

open:

```text
http://127.0.0.1:4307
```

## First-use checklist

Before drawing:

1. make sure the Switch brush size matches the web UI brush size
2. make sure the cursor/brush is parked at the canvas center
3. if you use `官方色绘制`, manually set all 9 palette slots to the top-left white color first

