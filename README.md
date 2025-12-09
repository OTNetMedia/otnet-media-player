# OTNet Player

![OTNet Player Screenshot](https://s3.us-east-1.amazonaws.com/s3b-delivery-bucket/screenshot_2025_11_04_at_21.20.47.png)

The **OTNet Player** is a high-performance, DRM-enabled video and audio player designed for modern streaming workflows. Built on cutting-edge web technologies, OTNet brings the robustness of enterprise media platforms to developers, enabling secure playback of encrypted DASH and HLS content across browsers, Smart TVs, and Electron-based environments.

Visit [otnet.io](https://otnet.io) to learn more about the OTNet ecosystem, including the desktop encoding app, remote streaming tools, and integrated analytics.

---

## Encode Your Own DRM Streams

🚀 **Use the OTNet Desktop Encoder to create, package, and encrypt your own media for EZDRM, Widevine, and PlayReady playback.**

👉 [Download OTNet Desktop Encoder](https://github.com/OTNetMedia/otnet-desktop-app-releases)

The desktop encoder supports generating DRM-enabled DASH and HLS manifests, with options for Widevine, PlayReady, and FairPlay licensing integration. It’s perfect for quickly testing encrypted content with the OTNet Player.

🔒 Official DRM Partners

OTNet integrates directly with [EZDRM](https://www.ezdrm.com/) and [Amazon Web Services (AWS)](https://aws.amazon.com/) for secure, production-grade content protection. These platforms are essential for handling DRM licensing and encryption, ensuring your media is delivered securely and compliant across all browsers and devices.

The desktop encoder supports generating DRM-enabled DASH and HLS manifests, with options for Widevine, PlayReady, and FairPlay licensing integration. It’s perfect for quickly testing encrypted content with the OTNet Player or deploying production-ready OTT pipelines through AWS Media Services.

-   [EZDRM](https://www.ezdrm.com/)
-   [Amazon Web Services (AWS)](https://aws.amazon.com/)

---

## Features

-   **DRM Support** – Widevine, PlayReady, and FairPlay (through compatible wrappers).
-   **Multi-Stream Handling** – Supports both video and audio stream switching in real time.
-   **Adaptive Bitrate Streaming** – Optimized for DASH and HLS manifests.
-   **Telemetry Integration** – Built-in metrics and analytics with custom VST tracking.
-   **Serverless-Ready** – Lightweight architecture for edge or local deployments.
-   **Cross-Platform** – Works seamlessly across web browsers, TVs, and Electron apps.

---

## DRM Provider Compatibility

| DRM Provider  | Key System                              | Browser / Platform Support                                            | Protocol   | Notes                                               |
| ------------- | --------------------------------------- | --------------------------------------------------------------------- | ---------- | --------------------------------------------------- |
| **Widevine**  | `com.widevine.alpha`                    | Chrome, Firefox, Edge (Chromium), Android                             | DASH       | Most widely supported DRM system on web.            |
| **PlayReady** | `com.microsoft.playready`               | Edge (Legacy + Chromium), Internet Explorer, Smart TVs (Tizen, webOS) | DASH       | Required for Windows Store and Smart TV apps.       |
| **FairPlay**  | `com.apple.fps.1_0`                     | Safari (macOS, iOS, iPadOS), Apple TV                                 | HLS        | Apple’s DRM system used exclusively in Safari.      |
| **EZDRM**     | Multi (Widevine / PlayReady / FairPlay) | Cross-platform (via configuration)                                    | DASH / HLS | Cloud-based license provider, used in demo configs. |

## Local Development

1. Clone the repository:

    ```bash
    git clone https://github.com/sobytes/otnet-player.git
    cd otnet-player
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

3. Start the development server:

    ```bash
    npm run dev
    ```

    This runs a local Vite server and serves the OTNet Player UI.

---

## Build

To generate a production build:

```bash
npm run build
```

The build output will be available in the `dist/` directory and can be served statically or deployed within OTNet environments.

---

## Usage Examples

## DRM Example (EZDRM)

```html
<otnet-video-player id="videoDrmEl"></otnet-video-player>

<script>
    window.addEventListener('DOMContentLoaded', () => {
        customElements.whenDefined('otnet-video-player').then(() => {
            const el = document.getElementById('videoDrmEl');
            if (!el) return;

            el.setup({
                options: {
                    autoplay: true,
                    muted: false,
                    showDebug: false,
                    openPlaylist: false,
                    normalize: true,
                    waveformHeight: 96,
                },
                playlist: [
                    {
                        id: 'nina',
                        humanRef: 'Nina',
                        metadata: {
                            title: 'dfb',
                            description: '',
                            artist: '',
                            label: '',
                            album: '',
                            genre: '',
                        },
                        variants: [
                            {
                                protocol: 'dash',
                                drm: {
                                    provider: 'ezdrm',
                                    widevine: {
                                        serverURL:
                                            'https://widevine-dash.ezdrm.com/widevine-php/widevine-foreignkey.php?pX=000000',
                                    },
                                    playready: {
                                        serverURL:
                                            'https://playready.ezdrm.com/cency/preauth.aspx?pX=000000',
                                    },
                                },
                                entrypoint: 'https://aws-cdn.cloudfront.net/dash/master.mpd',
                                duration: 137,
                                resources: {
                                    poster: 'https://aws-cdn.cloudfront.net/dash/master.jpg',
                                    bif: 'https://aws-cdn.cloudfront.net/dash/master.bif',
                                    waveform: 'https://aws-cdn.cloudfront.net/dash/waveform.json',
                                    metadata: 'https://aws-cdn.cloudfront.net/dash/metadata.json',
                                },
                            },
                            {
                                protocol: 'hls',
                                drm: {
                                    provider: 'ezdrm',
                                    fairplay: {
                                        serverURL:
                                            'https://fps.ezdrm.com/api/licenses/your-key-here',
                                        certificateUrl: 'https://your.cdn/fairplay.cer',
                                    },
                                },
                                entrypoint: 'https://aws-cdn.cloudfront.net/hls/master.m3u8',
                                duration: 137,
                                resources: {
                                    poster: 'https://aws-cdn.cloudfront.net/hls/master.jpg',
                                    bif: 'https://aws-cdn.cloudfront.net/hls/master.bif',
                                    waveform: 'https://aws-cdn.cloudfront.net/hls/waveform.json',
                                    metadata: 'https://aws-cdn.cloudfront.net/hls/metadata.json',
                                },
                            },
                        ],
                    },
                ],
            });
        });
    });
</script>
```

---

### Audio Player Example

```html
<otnet-audio-player id="audioDrmEl"></otnet-audio-player>

<script>
    window.addEventListener('DOMContentLoaded', () => {
        customElements.whenDefined('otnet-audio-player').then(() => {
            const el = document.getElementById('audioDrmEl');
            if (!el) return;

            const config = {
                options: {
                    autoplay: true,
                    muted: false,
                    showDebug: true,
                    openPlaylist: true,
                    showVideo: false,
                    normalize: true,
                    waveformHeight: 96,
                },
                playlist: [
                    {
                        metadata: {
                            title: "Something Good '08 - Radio Edit",
                            artists: 'Utah Saints',
                            album: "Something Good '08 (Remixes)",
                            bpm: 128,
                            key: 'G#m',
                        },
                        variants: [
                            {
                                id: '1',
                                protocol: 'audio',
                                entrypoint:
                                    'http://localhost:62253/Something%20Good%20%2708%20-%20Radio%20Edit.mp3',
                                duration: 155,
                                resources: {
                                    poster: 'http://localhost:62253/.covers/Something%20Good%20%2708%20-%20Radio%20Edit.jpeg',
                                },
                            },
                        ],
                    },
                ],
            };

            el.setup(config);

            el.onPlaylistItemDrag = ({ index, track, entry }) => {
                console.log('Track dragged from playlist:', index, entry);
            };
        });
    });
</script>
```

### Video Player Example

```html
<otnet-video-player id="videoDrmEl"></otnet-video-player>

<script>
    window.addEventListener('DOMContentLoaded', () => {
        customElements.whenDefined('otnet-video-player').then(() => {
            const el = document.getElementById('videoDrmEl');
            if (!el) return;

            el.setup(
                {
                    autoplay: true,
                    muted: false,
                    showDebug: false,
                    openPlaylist: false,
                },
                [
                    {
                        metadata: {
                            title: 'Can You Feel It (Audio DRM demo)',
                            description: 'Replace with your audio only DRM stream.',
                            artist: 'DJ Metz',
                            label: 'label',
                            album: 'album',
                            genre: 'DnB',
                        },
                        variants: [
                            {
                                protocol: 'hls',
                                entrypoint: 'https://aws-cdn.cloudfront.net/hls/master.m3u8',
                                duration: 137,
                                resources: {
                                    poster: 'https://aws-cdn.cloudfront.net/hls/master.jpg',
                                    bif: 'https://aws-cdn.cloudfront.net/hls/master.bif',
                                    waveform: 'https://aws-cdn.cloudfront.net/hls/waveform.json',
                                    metadata: 'https://aws-cdn.cloudfront.net/hls/metadata.json',
                                },
                            },
                            {
                                protocol: 'dash',
                                entrypoint: 'https://aws-cdn.cloudfront.net/dash/master.mpd',
                                duration: 137,
                                resources: {
                                    poster: 'https://aws-cdn.cloudfront.net/dash/master.jpg',
                                    bif: 'https://aws-cdn.cloudfront.net/dash/master.bif',
                                    waveform: 'https://aws-cdn.cloudfront.net/dash/waveform.json',
                                    metadata: 'https://aws-cdn.cloudfront.net/dash/metadata.json',
                                },
                            },
                        ],
                    },
                ]
            );
        });
    });
</script>
```

---

## Integrations

-   **Electron** – Embed OTNet Player for secure desktop playback.
-   **Smart TVs** – Optimized configurations for LG webOS and Samsung Tizen.
-   **Custom Dash Pipelines** – Integrate with OTNet's encoder or AWS MediaTailor channels.

---

## Learn More

-   Website: [https://otnet.io](https://otnet.io)
-   Docs: [https://otnet.io/docs](https://otnet.io/docs)
-   Contact: [contact@otnet.io](mailto:contact@otnet.io)

---

> The OTNet Player is part of the **SoBytes Media Stack**, a unified suite for encoding, packaging, and playback across all devices.
