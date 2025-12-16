# IntroHater

<div align="center">
  <img src="docs/icon32.png" alt="IntroHater Logo" width="128" height="128">
  
  **Skip intros on Stremio automatically.**
</div>

## Overview
IntroHater is a Stremio addon designed to automatically skip the first 10 seconds of videos. It supports various stream types including direct HTTP streams, YouTube, and torrents/magnet links via Real-Debrid.

## Features
*   **Auto-Skip**: Automatically skips the initial segment (default: 10 seconds) of supported streams.
*   **Wide Compatibility**: Works with:
    *   Direct MP4/WebM streams
    *   YouTube content
    *   Torrents & Magnet links
*   **Real-Debrid Integration**: Optimized for use with Real-Debrid for high-speed streaming.
*   **Visual Indicators**:
    *   ⏭️✅ - Skipping supported (Direct/Verified)
    *   ⏭️🎬 - YouTube skip enabled
    *   ⏭️❓ - Skipping attempt (Best effort for complex formats)

## Installation

### Prerequisites
*   Node.js (v18 or higher)
*   A Real-Debrid account (optional but recommended for torrents)

### Setup
1.  **Clone the repository**:
    ```bash
    git clone https://github.com/Rico-Rodriguez/IntroHater.git
    cd IntroHater
    ```
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Start the server**:
    ```bash
    npm start
    ```
    The server will start at `http://127.0.0.1:7000`.

### Stremio Configuration
1.  Open `http://localhost:7000/docs/configure.html` in your browser.
2.  Enter your **Real-Debrid API Key** (Get it from [real-debrid.com/apitoken](https://real-debrid.com/apitoken)).
3.  Click **Generate Link**.
4.  Click **Install on Stremio** or copy the link into the Stremio search bar.

## How It Works
IntroHater intercepts stream requests and modifies them to include time-seek parameters:
*   **Direct Streams**: Appends `#t=10` to the URL.
*   **YouTube**: Adds `youtubeStartTime` to behavior hints.
*   **Torrents**: Adds `startTime` hints for the player.

## Known Limitations
Stremio's streaming engine and various player implementations handle time seeking differently.
*   **Working**: Direct streams (MP4/WebM) and YouTube usually work perfectly.
*   **Inconsistent**: HLS streams and local proxy streams (127.0.0.1:11470) ignore many standard time parameters.
*   **Not Supported**: Some AVI/MKV files that require on-the-fly transcoding may reset the timestamp.

> **Note**: This project is for educational purposes.

## License
MIT
