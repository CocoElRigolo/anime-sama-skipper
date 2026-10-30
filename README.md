# [Auto-Next] Anime-Sama Skipper

A Manifest V3 browser extension that automatically **skips** anime openings, endings, and advances to the **next episode** on Anime-Sama.

## What is it?

Anime-Sama Skipper is an MV3 extension designed to enhance your anime watching experience. It:
- Automatically skips anime openings and endings
- Automatically advances to the next episode when the current one ends
- Works seamlessly with compatible video players

This project uses the [AniSkip API](https://github.com/aniskip/aniskip-api) to fetch skip times for openings and endings.

## How to Use

When the extension detects a compatible video player, a **"Watch with Skipper"** button will appear on the page. Simply click it to enable the auto-skip and auto-advance features.

For the full experience, DO NOT press the “full screen” button on the player. Instead, switch to full-screen mode in your browser by pressing the F11 key.

## Supported Players

- **Sibnet**
- **Vidmoly** (including Anime-Sama's `ansembed.net` embeds)

Choose the player matching the currently selected server in the extension popup.
The selected embed opens in a dedicated tab and supports opening skip, auto-next,
and episode synchronization.

## Installation

1. Clone or download this repository
2. Open your browser's extension management page (e.g., `chrome://extensions` for Chrome)
3. Enable **Developer Mode**
4. Click **Load unpacked** and select the extension folder
5. The extension is now ready to use!

## License

Feel free to use and modify this extension as needed.
