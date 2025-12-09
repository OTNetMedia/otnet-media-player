// Player Icons: https://materialui.co/icon/picture-in-picture-alt
import { Icons } from '../helpers/icons.js';
import LanguageHelper from '../helpers/languageHelper.js';
import { createButton, clearMenu } from '../helpers/domHelpers.js';
import { formatTime, getFallbackTitle } from '../helpers/formatHelpers.js';
import WaveSurfer from 'wavesurfer.js';
import OtnetDrm from './OtnetDrm.js';

import shaka from 'shaka-player';

const FALLBACK_THUMB =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='90' viewBox='0 0 160 90'>
       <rect width='100%' height='100%' fill='#1f2937'/>
       <text x='50%' y='50%' fill='#9ca3af' font-family='system-ui' font-size='12'
             dominant-baseline='middle' text-anchor='middle'>No artwork</text>
     </svg>`
    )
        .replace(/'/g, '%27')
        .replace(/"/g, '%22');

const FALLBACK_POSTER =
    'data:image/svg+xml,' +
    encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='266' height='266' viewBox='0 0 266 266'>
       <rect width='100%' height='100%' fill='#1f2937'/>
       <text x='50%' y='50%' fill='#9ca3af' font-family='system-ui' font-size='12'
             dominant-baseline='middle' text-anchor='middle'>No artwork</text>
     </svg>`)
        .replace(/'/g, '%27')
        .replace(/"/g, '%22');

class OtnetAudioPlayer extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.video = null;
        this.player = null;
        this.src = '';
        this.poster = '';
        this.activeSectionButton = null;
        this.isPlaylistOpen = false;
        this.drmHelper = new OtnetDrm();
    }

    connectedCallback() {
        shaka.polyfill.installAll();
    }

    applyConfig(config) {
        console.log('[Otnet]', config);

        const isSafari = () => {
            const ua = navigator.userAgent;
            return /Safari/.test(ua) && !/Chrome|CriOS|Chromium|Edg/.test(ua);
        };

        let chosen = null;
        if (Array.isArray(config.variants) && config.variants.length) {
            if (isSafari()) {
                chosen = config.variants.find((v) => v.protocol === 'hls') || config.variants[0];
            } else {
                chosen = config.variants.find((v) => v.protocol === 'dash') || config.variants[0];
            }
        }

        if (!chosen) {
            console.warn('No playable variant found, using first entry');
            chosen = config.variants ? config.variants[0] : null;
        }

        if (!chosen) {
            console.error('applyConfig: No variants available in config');
            return;
        }

        this.src = chosen.entrypoint;
        this.drm = chosen.drm || null;
        this.duration = chosen.duration || 0;
        this.poster = chosen.resources?.poster || '';
        this.waveform = chosen.resources?.waveform || '';
        this.metadata = config.metadata || {};
        this.baseUrl = chosen.base_path || '';
    }

    async setup(config) {
        const options = config.options;
        const playlist = config.playlist;

        this.options = {
            timeFormat: 'mm:ss',
            autoplay: false,
            muted: false,
            showDebug: false,
            showVideo: false,
            waveformHeight: 60,
            normalize: false,
            barWidth: 0,
            barRadius: 0,
            barGap: 0,
            backgroundColor: '#0a0a0a',
            waveBackgroundColor: '#1a1a1a',
            waveColor: '#ff007f',
            openPlaylist: false,
            ...options,
        };

        this.playlist = playlist;

        this.currentIndex = this.options.startIndex || 0;

        if (this.playlist.length) {
            this.applyConfig(this.playlist[this.currentIndex]);
        }

        this.shadowRoot.innerHTML = this.getTemplate();

        this.video = this.shadowRoot.querySelector('video');
        if (!this.src) {
            return console.error('No video source provided.');
        }

        // Must be done before initPlayer for Safari to work correctly
        this.setupControls();

        await this.initPlayer();

        this.video.muted = this.options.muted;
        if (this.options.autoplay) {
            this.video.play().catch(() => {});
        }

        if (this.options.openPlaylist) {
            this.isPlaylistOpen = true;
            const panel = this.shadowRoot.getElementById('otnet-playlistPanel');
            panel.removeAttribute('hidden');
            this.setupPlaylistPanel();
        }
    }

    async initPlayer() {
        if (this.player) {
            try {
                this.player.unload?.();
            } catch {
                // ignore
            }
        }

        this.player = new shaka.Player();

        this.drmHelper.setPlayer(this.player);
        try {
            await this.drmHelper.apply(this.drm);
        } catch (e) {
            console.warn('DRM apply failed, continuing without DRM config:', e?.message || e);
        }

        this.player.configure({
            streaming: {
                preferNativeHls: true,
                useNativeHlsForFairPlay: true,
                lowLatencyMode: false,
                rebufferingGoal: 2,
                bufferingGoal: 10,
            },
        });

        try {
            await this.player.attach(this.video);
            await this.player.load(this.src);
        } catch (e) {
            console.error('[Otnet] Shaka load error', e);
        }
    }

    updatePlaylistHighlight() {
        const items = this.shadowRoot.querySelectorAll('.playlist-item');
        items.forEach((el, idx) => {
            el.classList.toggle('active', idx === this.currentIndex);
        });
    }

    async switchTrack(nextIndex) {
        if (nextIndex === this.currentIndex) {
            this.video.currentTime = 0;
            this.video.play();
            return;
        }

        this.chaptersPanel.setAttribute('hidden', '');

        this.currentIndex = nextIndex;
        const track = this.playlist[nextIndex];

        this.applyConfig(track);

        this.video.pause();

        try {
            await this.drmHelper.apply(this.drm);
            await this.player.unload();
            await this.player.load(this.src);
        } catch (e) {
            console.error('[Otnet] Shaka load error', e);
        }

        this.updatePlaylistHighlight();
    }

    async teardownPlayer(type) {
        if (!this.player && type !== 'native') return;

        switch (type) {
            case 'shaka':
                try {
                    await this.player.detach();
                } catch {}
                try {
                    await this.player.unload();
                } catch {}
                break;
            case 'hls':
                this.player.stopLoad();
                this.player.detachMedia();
                this.player.destroy();
                break;
            case 'native':
                this.video.pause();
                this.video.removeAttribute('src');
                this.video.load();
                break;
        }
        this.player = null;
    }

    setupControls() {
        const shadow = this.shadowRoot;

        this.playerWrapper = shadow.getElementById('otnet-player-wrapper');

        if (this.playlist.length > 1) {
            this.playlistBackward = shadow.getElementById('otnet-playlist-backward');
            this.playlistBackward.innerHTML = Icons.back;
            this.playlistBackward.addEventListener('click', () => {
                this.switchTrack(
                    (this.currentIndex - 1 + this.playlist.length) % this.playlist.length
                );
            });
            this.playlistBackward.removeAttribute('hidden');

            this.playlistForward = shadow.getElementById('otnet-playlist-forward');
            this.playlistForward.innerHTML = Icons.forward;
            this.playlistForward.addEventListener('click', () => {
                this.switchTrack((this.currentIndex + 1) % this.playlist.length);
            });
            this.playlistForward.removeAttribute('hidden');
        }

        this.playPauseBtn = shadow.getElementById('otnet-playPause');
        this.playPauseBtn.innerHTML = Icons.play;
        this.playPauseBtn.addEventListener('click', () => {
            if (this._sectionInterval) {
                clearInterval(this._sectionInterval);
                this._sectionInterval = null;
                this.activeSectionButton = null;
            }

            if (this.video.paused) {
                this.playPauseBtn.innerHTML = Icons.pause;
                this.video.play();
            } else {
                this.playPauseBtn.innerHTML = Icons.play;
                this.video.pause();
            }
        });

        this.volumeButton = shadow.getElementById('otnet-volumeButton');
        this.volumeButton.innerHTML = Icons.volume;
        this.volumeSlider = shadow.getElementById('otnet-volumeSlider');
        const volumeSliderContainer = shadow.querySelector('.otnet__volume-slider');
        this.volumeButton.addEventListener('click', () => {
            const isHidden = volumeSliderContainer.hasAttribute('hidden');
            volumeSliderContainer.hidden = !isHidden;
            volumeSliderContainer.style.display = isHidden ? 'flex' : 'none';
        });
        this.volumeSlider.addEventListener('input', () => {
            this.video.volume = this.volumeSlider.value;
            if (this.video.volume === 0) {
                this.video.muted = true;
            } else {
                this.video.muted = false;
            }
            this.volumeButton.innerHTML =
                parseFloat(this.volumeSlider.value) === 0 ? Icons.mute : Icons.volume;
            this.volumeSlider.style.setProperty(
                '--volume-value',
                `${this.volumeSlider.value * 100}% `
            );
        });

        // ===== Settings Menu =====
        this.settingsBtn = shadow.getElementById('otnet-settingsBtn');
        this.settingsBtn.innerHTML = Icons.settings;
        this.settingsMenu = shadow.getElementById('otnet-settings');
        this.settingsBtn.addEventListener('click', () => {
            const expanded = this.settingsBtn.getAttribute('aria-expanded') === 'true';
            this.settingsBtn.setAttribute('aria-expanded', !expanded);
            this.settingsMenu.hidden = expanded;
        });
        shadow.querySelectorAll('.otnet__menu__item[data-target]').forEach((button) => {
            button.addEventListener('click', () => {
                const target = button.getAttribute('data-target');
                shadow
                    .querySelectorAll('#otnet-settings > div')
                    .forEach((menu) => (menu.hidden = true));
                shadow.getElementById(`otnet-settings-${target}`).hidden = false;
            });
        });
        shadow.querySelectorAll('.otnet__menu__back').forEach((button) => {
            button.addEventListener('click', () => {
                shadow
                    .querySelectorAll('#otnet-settings > div')
                    .forEach((menu) => (menu.hidden = true));
                shadow.getElementById('otnet-settings-home').hidden = false;
            });
        });
        shadow.querySelectorAll('.otnet__menu__item[data-speed]').forEach((button) => {
            button.addEventListener('click', () => {
                const speed = parseFloat(button.getAttribute('data-speed'));
                this.video.playbackRate = speed;
                const speedMenu = shadow.getElementById('otnet-settings-speed');
                speedMenu
                    .querySelectorAll('.otnet__menu__item')
                    .forEach((btn) => btn.classList.remove('active'));
                button.classList.add('active');
                this.closeSettingsMenu();
            });
        });
        shadow.querySelectorAll('.otnet__menu__item[data-click]').forEach((button) => {
            button.addEventListener('click', () => {
                const target = button.getAttribute('data-click');

                if (target === 'pip') {
                    if (document.pictureInPictureElement) {
                        document
                            .exitPictureInPicture()
                            .catch((error) => console.error('Error exiting PiP:', error));
                    } else {
                        this.video
                            .requestPictureInPicture()
                            .catch((error) => console.error('Error entering PiP:', error));
                    }
                }
                this.closeSettingsMenu();
            });
        });

        const fullscreenBtn = shadow.getElementById('otnet-fullscreen');
        fullscreenBtn.innerHTML = Icons.fullscreen;
        fullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                fullscreenBtn.innerHTML = Icons.exitFullscreen;
                this.shadowRoot.host.requestFullscreen();
            } else {
                fullscreenBtn.innerHTML = Icons.fullscreen;
                document.exitFullscreen();
            }
        });

        const seekBar = shadow.getElementById('otnet-seekBar');
        seekBar.addEventListener('input', () => {
            this.video.currentTime = (seekBar.value / 100) * this.video.duration;
        });
        const bufferBar = shadow.getElementById('otnet-bufferBar');

        const timeContainer = shadow.getElementById('otnet-timeContainer');
        const currentTimeEl = shadow.getElementById('otnet-currentTime');

        this.audioWaveformContainer = shadow.getElementById('otnet-audio-waveform');
        this.audioWaveformContainer.addEventListener('click', (e) => {
            if (this._sectionInterval) {
                clearInterval(this._sectionInterval);
                this._sectionInterval = null;
                this.activeSectionButton = null;
            }

            let posX, width;
            if (e.touches) {
                const touch = e.touches[0];
                posX = Math.floor(
                    touch.clientX - this.audioWaveformContainer.getBoundingClientRect().x
                );
                width = Math.round(this.audioWaveformContainer.clientWidth);
            } else {
                posX = Math.round(e.offsetX);
                width = Math.round(e.target.clientWidth);
            }

            const newTime = (this.video.duration / width) * posX;
            this.video.currentTime = newTime;
            this.video.play();
        });

        if (this.playlist.length > 1) {
            this.playlistBtn = this.shadowRoot.getElementById('otnet-playlistBtn');
            this.playlistBtn.innerHTML = `${Icons.playlist} ${this.playlist.length}`;
            this.playlistBtn.addEventListener('click', () => {
                this.isPlaylistOpen = !this.isPlaylistOpen;
                const panel = this.shadowRoot.getElementById('otnet-playlistPanel');
                if (this.isPlaylistOpen) {
                    panel.removeAttribute('hidden');
                    this.setupPlaylistPanel();
                } else {
                    panel.setAttribute('hidden', '');
                }
            });
            this.playlistBtn.removeAttribute('hidden');
        }

        this.chaptersBtn = this.shadowRoot.querySelector('#otnet-chaptersBtn');
        this.chaptersBtn.innerHTML = Icons.sections;
        this.chaptersPanel = this.shadowRoot.querySelector('#otnet-chaptersPanel');
        this.chaptersBtn.addEventListener('click', () => {
            const isOpen = !this.chaptersPanel.hasAttribute('hidden');
            if (isOpen) {
                this.chaptersPanel.setAttribute('hidden', '');
            } else {
                this.chaptersPanel.removeAttribute('hidden');
            }
        });

        document.addEventListener('keydown', (e) => {
            const isInputFocused = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
            if (isInputFocused) return;

            if (e.code === 'Space' || e.key === ' ') {
                e.preventDefault();
                if (this.video.paused) {
                    this.video.play();
                } else {
                    this.video.pause();
                }
            }
        });

        this.video.addEventListener('playing', () => {
            this.playPauseBtn.innerHTML = Icons.pause;

            if (this.video.muted) {
                this.volumeSlider.value = 0;
                this.volumeSlider.style.setProperty('--volume-value', '0%');
                this.volumeButton.innerHTML = Icons.mute;
            }
        });

        this.video.addEventListener('paused', () => {
            this.playPauseBtn.innerHTML = Icons.play;
        });

        this.video.addEventListener('timeupdate', () => {
            const percent = (this.video.currentTime / this.video.duration) * 100 || 0;
            seekBar.value = percent;
            seekBar.style.setProperty('--value', `${percent}% `);

            const current = formatTime(this.video.currentTime);
            const total = formatTime(this.video.duration);
            timeContainer.setAttribute('data-tooltip', `${current} / ${total}`);
            if (this.activeHighlight) {
                if (this.video.currentTime >= this.activeHighlight.end) {
                    this.video.currentTime = this.activeHighlight.start;
                    this.video.play();
                }
            }

            if (this.options.timeFormat === 'ss') {
                currentTimeEl.textContent = Math.round(this.video.currentTime);
            } else {
                currentTimeEl.textContent = current;
            }

            if (this.wavesurfer && typeof this.video.currentTime === 'number') {
                this.wavesurfer.setTime(this.video.currentTime);
                this.updateWaveformTooltip(this.video.currentTime);
            }
        });

        this.video.addEventListener('progress', () => {
            if (this.video.buffered.length) {
                const bufferedEnd = this.video.buffered.end(this.video.buffered.length - 1);
                const bufferPercent = (bufferedEnd / this.video.duration) * 100;
                bufferBar.value = bufferPercent;
            }
        });

        this.video.addEventListener('pause', () => {
            this.playPauseBtn.innerHTML = Icons.play;

            if (this.activeSectionButton) {
                this.activeSectionButton.innerHTML = Icons.play;
            }
        });

        this.video.addEventListener('play', () => {
            this.playPauseBtn.innerHTML = Icons.pause;

            if (this.activeSectionButton) {
                this.activeSectionButton.innerHTML = Icons.pause;
            }
        });

        this.video.addEventListener('loadedmetadata', async () => {
            this.buildMenus();

            this.initPoster();
            this.initWavesurfer();
            this.initSections();
            this.activeHighlight = null;
            const current = formatTime(this.video.currentTime);
            const total = formatTime(this.video.duration);
            timeContainer.setAttribute('data-tooltip', `${current} / ${total}`);
        });

        this.video.addEventListener('ended', () => {
            if (this._sectionInterval) {
                clearInterval(this._sectionInterval);
                this._sectionInterval = null;
                this.activeSectionButton = null;
            }
            this.activeHighlight = null;

            if (!Array.isArray(this.playlist) || this.playlist.length <= 1) {
                this.playPauseBtn.innerHTML = Icons.play;
                return;
            }

            const next = this.currentIndex + 1;

            if (next < this.playlist.length) {
                (async () => {
                    await this.switchTrack(next);
                    this.video.play().catch(() => {});
                })();
            } else {
                // reached last track
                // Uncomment to loop back to first item:
                // (async () => {
                //   await this.switchTrack(0);
                //   this.video.play().catch(() => {});
                // })();

                this.playPauseBtn.innerHTML = Icons.play;
            }
        });
    }

    async loadResource(input) {
        try {
            if (typeof input === 'string' && input.startsWith('http')) {
                const res = await fetch(input);
                if (!res.ok) {
                    console.warn(`Failed to fetch metadata: ${res.status} ${res.statusText}`);
                    return {};
                }

                try {
                    return await res.json();
                } catch (jsonErr) {
                    console.warn('Failed to parse metadata JSON:', jsonErr);
                    return {};
                }
            } else if (typeof input === 'object' && input !== null) {
                return input;
            } else {
                console.warn('Invalid metadata format (must be object or URL)');
                return {};
            }
        } catch (err) {
            console.warn('Unexpected error loading metadata:', err);
            return {};
        }
    }

    buildMenus() {
        this.buildBitrateMenu();
        this.buildAudioMenu();
        this.buildCaptionsMenu();
    }

    buildBitrateMenu() {
        const shadow = this.shadowRoot;
        const qualityMenu = shadow.getElementById('otnet-settings-quality');
        clearMenu(qualityMenu, '.otnet__menu__item[data-quality]');

        const tracks = this.player.getVariantTracks();

        tracks.forEach((track) => {
            const button = createButton({
                label: `${Math.round(track.bandwidth / 1000)} kbps`,
                dataset: { quality: `${track.bandwidth}` },
                onClick: () => {
                    this.player.configure({ abr: { enabled: false } });
                    this.player.selectVariantTrack(track, true);

                    qualityMenu
                        .querySelectorAll('.otnet__menu__item')
                        .forEach((btn) => btn.classList.remove('active'));
                    button.classList.add('active');

                    this.closeSettingsMenu();
                },
            });

            qualityMenu.appendChild(button);
        });
    }

    buildAudioMenu() {
        const shadow = this.shadowRoot;
        const audioMenu = shadow.getElementById('otnet-settings-audio');
        clearMenu(audioMenu, '.otnet__menu__item[data-audio]');

        const tracks = this.player
            .getVariantTracks()
            .filter(
                (track, index, self) =>
                    index === self.findIndex((t) => t.language === track.language)
            );

        tracks.forEach((track) => {
            const button = createButton({
                label: track.language.toUpperCase(),
                dataset: { audio: track.language },
                onClick: () => {
                    const selectedTrack = this.player
                        .getVariantTracks()
                        .find((t) => t.language === track.language);

                    if (selectedTrack) {
                        this.player.selectVariantTrack(selectedTrack, true);
                    }
                    this.closeSettingsMenu();
                },
            });
            audioMenu.appendChild(button);
        });
    }

    buildCaptionsMenu() {
        const shadow = this.shadowRoot;
        const captionsMenu = shadow.getElementById('otnet-settings-captions');
        clearMenu(captionsMenu, '.otnet__menu__item[data-captions]');

        const subtitleWrapper = this.shadowRoot.getElementById('otnet-subtitle-wrapper');

        const disableButton = createButton({
            label: 'Disabled',
            dataset: { captions: 'disabled' },
            onClick: () => {
                subtitleWrapper.classList.remove('active');
                this.cues = null;
                this.closeSettingsMenu();
            },
        });
        captionsMenu.appendChild(disableButton);

        const textTracks = this.player.getTextTracks();
        textTracks.forEach((track) => {
            const button = createButton({
                label: LanguageHelper.getLanguageLabel(track.language),
                dataset: { captions: track.language },
                onClick: async () => {
                    this.player.setTextTrackVisibility(true);
                    this.player.selectTextTrack(track);
                    this.closeSettingsMenu();
                },
            });
            captionsMenu.appendChild(button);
        });
    }

    async initPoster() {
        const poster = this.metadata.poster || this.poster || '';

        const wrapper = this.shadowRoot.querySelector('#otnet-player-wrapper');
        const posterWrapper = wrapper.querySelector('.poster-wrapper');
        const videoWrapper = wrapper.querySelector('.video-wrapper');

        posterWrapper.style.height = `${this.options.waveformHeight + 66}px`;
        posterWrapper.style.width = `${this.options.waveformHeight + 66}px`;

        if (this.options.showVideo) {
            this.playerWrapper.style.display = '';

            posterWrapper.style.display = 'none';
            videoWrapper.style.display = 'flex';
            videoWrapper.style.backgroundImage = `url('${FALLBACK_POSTER}')`;
        } else {
            this.playerWrapper.style.display = 'flex';

            videoWrapper.style.display = 'none';
            posterWrapper.style.display = 'flex';
            posterWrapper.style.backgroundImage = `url(${FALLBACK_POSTER})`;

            this.pickPosterUrl(poster).then((url) => {
                posterWrapper.style.backgroundImage = `url('${url}')`;
            });
        }
    }

    async initWavesurfer() {
        this.audioWaveformContainer.innerHTML = '';
        if (this.wavesurfer) {
            this.wavesurfer.destroy();
            this.wavesurfer = null;
        }

        let waveformData = {};
        if (this.waveform) {
            waveformData = (await this.loadResource(this.waveform)) || {};
        }

        let wavesurferConfig = {
            container: this.audioWaveformContainer,
            height: this.options.waveformHeight,
            fillParent: true,
            scrollParent: false,
            responsive: true,
            waveColor: this.options.waveBackgroundColor,
            progressColor: this.options.waveColor,
            barWidth: this.options.barWidth,
            barRadius: this.options.barRadius,
            barGap: this.options.barGap,
            normalize: this.options.normalize,
            interact: true,
            dragToSeek: true,
            pixelRatio: 1,
        };

        if (Object.keys(waveformData).length === 0) {
            wavesurferConfig.url = this.src;
        } else {
            wavesurferConfig.peaks = waveformData;
            wavesurferConfig.duration = this.video.duration;
        }

        this.wavesurfer = WaveSurfer.create(wavesurferConfig);

        const tooltip = document.createElement('div');
        tooltip.className = 'waveform-time-tooltip';
        Object.assign(tooltip.style, {
            position: 'absolute',
            pointerEvents: 'none',
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: '12px',
            zIndex: 3,
            transform: 'translate(-50%, -50%)',
            whiteSpace: 'nowrap',
            visibility: 'hidden',
        });

        tooltip.style.top = '50%';
        tooltip.style.left = '50%';

        tooltip.style.visibility = 'visible';

        this.audioWaveformContainer.appendChild(tooltip);

        this.wavesurfer.on('interaction', (newTime) => {
            if (this.video && typeof newTime === 'number') {
                this.video.currentTime = newTime;
            }
            this.updateWaveformTooltip(newTime);
        });

        const endLabel = document.createElement('div');
        endLabel.className = 'waveform-end-label';
        Object.assign(endLabel.style, {
            position: 'absolute',
            pointerEvents: 'none',
            right: '4px',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'rgba(0,0,0,0.6)',
            color: '#fff',
            zIndex: 2,
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: '12px',
            whiteSpace: 'nowrap',
        });
        this.audioWaveformContainer.appendChild(endLabel);

        endLabel.textContent = formatTime(this.video.duration);
    }

    async initSections() {
        let metadata = {};
        if (this.metadata) {
            metadata = (await this.loadResource(this.metadata)) || {};
        }

        const sections = metadata.sections || [];

        if (sections.length > 0) {
            this.chaptersBtn.removeAttribute('hidden');
            this.setupSectionPlayback(sections);
        } else {
            this.chaptersBtn.setAttribute('hidden', '');
        }
    }

    preloadImage(url) {
        return new Promise((resolve) => {
            if (!url) return resolve(null);
            const img = new Image();
            img.referrerPolicy = 'no-referrer';
            img.onload = () => resolve(url);
            img.onerror = () => resolve(null);
            img.src = url;
        });
    }

    async pickPosterUrl(poster) {
        const candidates = [poster, FALLBACK_POSTER].filter(Boolean);

        for (const url of candidates) {
            const ok = await this.preloadImage(url);
            if (ok) return ok;
        }
        return FALLBACK_POSTER;
    }

    esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    joinSlash(parts) {
        return parts.filter(Boolean).join(' / ');
    }

    getDescriptionValue(desc) {
        if (!desc) return null;

        if (typeof desc === 'string') {
            return desc.trim() || null;
        }

        if (typeof desc === 'object' && desc.text) {
            return String(desc.text).trim() || null;
        }

        return null;
    }

    hasDescription(desc) {
        return !!this.getDescriptionValue(desc);
    }

    async setupPlaylistPanel() {
        const panel = this.shadowRoot.getElementById('otnet-playlistPanel');
        panel.textContent = '';

        for (let i = 0; i < this.playlist.length; i++) {
            const track = this.playlist[i];
            const d = track.metadata || {};

            const variantWithDuration = track.variants.find((v) => v?.duration);
            const variantWithMetadata = track.variants.find((v) => v.resources?.metadata);
            const variantWithPoster = track.variants.find((v) => v.resources?.poster);

            let duration = variantWithDuration?.duration || null;
            const metadataUrl = variantWithMetadata?.resources.metadata || null;
            const poster = variantWithPoster?.resources.poster || null;

            let metadata = {};
            const needsMetadata = (!d.title || !d.description) && metadataUrl;

            if (needsMetadata) {
                try {
                    metadata = (await this.loadResource(metadataUrl)) || {};
                } catch (err) {
                    console.warn('Metadata load failed:', err);
                }
            }

            const fallbacks = metadata?.metadata?.tags || {};

            const title = d.title || fallbacks.title || 'Untitled';
            const artist = d.artist || fallbacks.artist || '';
            const label = d.label || fallbacks.label || '';
            const album = d.album || fallbacks.album || '';
            const genre = d.genre || fallbacks.genre || '';
            const bpm = d.bpm || fallbacks.bpm || '';
            const key = d.key || fallbacks.key || '';

            if (!duration) duration = metadata.duration || null;

            const metaParts = [
                artist && `<span class="playlist-info-label">Artist:</span> ${this.esc(artist)}`,
                label && `<span class="playlist-info-label">Label:</span> ${this.esc(label)}`,
                album && `<span class="playlist-info-label">Album:</span> ${this.esc(album)}`,
                genre && `<span class="playlist-info-label">Genre:</span> ${this.esc(genre)}`,
            ].filter(Boolean);

            const metaLine = metaParts.length
                ? `<p class="playlist-meta">${metaParts.join(' / ')}</p>`
                : '';

            const details = [
                duration &&
                    `<div class="playlist-detail"><span>Duration:</span> ${formatTime(
                        duration
                    )}</div>`,
                bpm && `<div class="playlist-detail"><span>BPM:</span> ${this.esc(bpm)}</div>`,
                key && `<div class="playlist-detail"><span>KEY:</span> ${this.esc(key)}</div>`,
            ]
                .filter(Boolean)
                .join('');

            let descText = null;
            if (typeof d.description === 'string') {
                descText = d.description;
            } else if (typeof d.description === 'object' && d.description?.text) {
                descText = d.description.text;
            } else if (!d.description && metadata?.metadata?.description) {
                descText = metadata.metadata.description;
            }

            const descLine = descText
                ? `<p class="playlist-desc"><span class="playlist-info-label">Description:</span> ${this.esc(
                      descText
                  )}</p>`
                : '';

            const item = document.createElement('div');
            item.className = 'playlist-item';
            item.setAttribute('draggable', 'true');

            item.addEventListener('dragstart', (event) => {
                event.preventDefault();
                const index = i;
                const track = this.playlist[index];
                const entry = track?.variants?.[0]?.entrypoint || null;
                if (typeof this.onPlaylistItemDrag === 'function') {
                    this.onPlaylistItemDrag({ index, track, entry });
                }
            });

            if (i === this.currentIndex) item.classList.add('active');

            item.innerHTML = `
      <img class="playlist-thumb" alt="${this.esc(title)}"
           loading="lazy" decoding="async"
           src="${poster || FALLBACK_THUMB}" />
      <div class="playlist-info">
        <strong>${this.esc(title)}</strong>
        ${descLine}
        ${metaLine}
      </div>
      <div class="playlist-details">${details}</div>
    `;

            const img = item.querySelector('.playlist-thumb');
            img.addEventListener('error', () => {
                if (img.src !== FALLBACK_THUMB) img.src = FALLBACK_THUMB;
            });

            item.addEventListener('click', () => this.switchTrack(i));

            panel.appendChild(item);
        }
    }

    updateWaveformTooltip(time) {
        const tooltip = this.shadowRoot.querySelector('.waveform-time-tooltip');
        if (!tooltip || !this.video || !this.audioWaveformContainer) return;

        const w = this.audioWaveformContainer.clientWidth;
        const pct = time / this.video.duration;
        const x = Math.min(Math.max(pct * w, 0), w);

        tooltip.textContent = formatTime(time);
        tooltip.style.left = `${x}px`;
    }

    setupSectionPlayback(sections) {
        const player = this.video;
        const sectionPanel = this.shadowRoot.getElementById('otnet-chaptersPanel');

        if (!sectionPanel) return;

        sectionPanel.innerHTML = '';

        sections.forEach((section) => {
            const sectionTitle = document.createElement('h4');
            sectionTitle.textContent = section.title;
            sectionPanel.appendChild(sectionTitle);

            if (section.items && Array.isArray(section.items)) {
                section.items.forEach((item) => {
                    const div = document.createElement('div');
                    div.className = 'section-item';
                    div.dataset.time = item.time;

                    div.innerHTML = `
                <button class="section-play" aria-label="Play Section">${Icons.play}</button>
                <div class="chapter-text">
                    <strong>${item.title}</strong> — ${item.description}
                    ${
                        item.duration
                            ? `<em>(${item.time}s - ${
                                  parseFloat(item.time) + parseFloat(item.duration)
                              }s)</em>`
                            : `<em>(${item.time}s)</em>`
                    }
                    <div class="item-progress" style="height: 4px; background: var(--brand-color); width: 0%; margin-top: 4px;"></div>
                </div>
            `;

                    const playBtn = div.querySelector('.section-play');
                    const progressEl = div.querySelector('.item-progress');

                    playBtn.addEventListener('click', () => {
                        // Cancel any previous section playback
                        if (this._sectionInterval) clearInterval(this._sectionInterval);

                        const start = parseFloat(item.time);
                        const end = start + (parseFloat(item.duration) || 0);

                        player.currentTime = start;
                        player.play();
                        playBtn.innerHTML = Icons.pause;
                        this.activeSectionButton = playBtn;

                        this._sectionInterval = setInterval(() => {
                            const current = player.currentTime;
                            const elapsed = current - start;

                            if (item.duration) {
                                if (current >= end) {
                                    player.currentTime = start;
                                } else if (progressEl) {
                                    const percent = (elapsed / item.duration) * 100;
                                    progressEl.style.width = `${percent}%`;
                                }
                            } else {
                                if (progressEl) progressEl.style.width = '0%';
                                clearInterval(this._sectionInterval);
                                this.activeSectionButton = null;
                            }
                        }, 100);

                        sectionPanel.querySelectorAll('.section-play').forEach((btn) => {
                            if (btn !== playBtn) btn.innerHTML = Icons.play;
                        });
                    });

                    sectionPanel.appendChild(div);
                });
            }
        });
    }

    restart() {
        if (!this.video || !this.src) return;

        this.video.pause();

        this.player
            .unload()
            .then(() => this.player.load(this.src))
            .then(() => {
                this.buildMenus();
            })
            .catch((err) => {
                console.error('[Otnet] restart error:', err);
            });
    }

    calculateThumbnailWidth() {
        const playerWidth = this.shadowRoot.host.clientWidth;

        if (playerWidth >= 1200) return 240;
        if (playerWidth >= 800) return 200;
        if (playerWidth >= 600) return 160;

        return 120;
    }

    closeSettingsMenu() {
        const shadow = this.shadowRoot;
        shadow.querySelectorAll('#otnet-settings > div').forEach((menu) => (menu.hidden = true));
        shadow.getElementById('otnet-settings-home').hidden = false;
        this.settingsBtn.setAttribute('aria-expanded', 'false');
        this.settingsMenu.hidden = true;
    }

    getTemplate() {
        return `
<style>
:host {
  --brand-color: ${this.options.waveColor};
  background-color: ${this.options.backgroundColor};
  outline: none !important;
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;      
  min-height: 0;  
}

video:focus,
button:focus {
  outline: none;
}

:focus-visible {
  outline: 2px dashed var(--brand-color);
  outline-offset: 2px;
}

#otnet-player-wrapper {
  position: relative;
}

.video-wrapper {
background-size: cover;
    background-position: center center;
    background-repeat: no-repeat;
    aspect-ratio: 16 / 9;
}

.video-wrapper video {
    object-fit: cover;
    width: 100%;
    height: 100%;
}

.poster-wrapper {
    height: 246px;
    width: 246px;
    background-size: cover;
    background-position: center center;
    background-repeat: no-repeat;
    float: left;
}

.player-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
}

.meta-header {
  display:          flex;
  flex-direction:   column;     
  justify-content:  center;     
  gap:              4px;         
  height:           70px;     
  padding:          0 1%;      
  box-sizing:       border-box;  
}

.meta-header .waveform-title {
  margin: 0;
}

.waveform-title {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
  max-width: 80%;    
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

#otnet-audio-waveform {
  position: relative;
    float: left;
    width: 100%;
    display: block;
    margin: 10px 0px;
}

/* Native subtitle wrapper */
#otnet-native-subtitle-wrapper {
  position: absolute;
  bottom: 0;
  left: 0;
  top: 0;
  right: 0;
}

#otnet-native-subtitle-wrapper .shaka-text-container div {
  display: block;
  position: absolute;
  bottom: 50px;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  color: white;
  background: rgba(0, 0, 0, 0.7);
  padding: 5px;
  border-radius: 5px;
  font-size: 24px;
  max-width: 90%;
  word-wrap: break-word;
  opacity: 0;
  transition: opacity 0.5s ease, transform 0.5s ease;
  pointer-events: none;
}

.otnet__progress__container {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  position: relative;
  opacity: 0;
}

progress {
  width: 100%;
  height: 8px;
  appearance: none;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  border-radius: 3px;
  background-color: rgb(0 0 0 / 30%);
  z-index: 1;
}

progress::-webkit-progress-bar {
  background-color: rgba(255, 255, 255, 0.3);
  border-radius: 3px;
}

progress::-webkit-progress-value {
  background-color: rgba(255, 255, 255, 0.5);
  border-radius: 3px;
}

input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 8px;
  background: linear-gradient(to right, var(--brand-color) var(--value, 0%), rgba(255, 255, 255, 0.3) var(--value, 0%));
  border-radius: 3px;
  cursor: pointer;
  outline: none;
  position: relative;
  z-index: 2;
  padding: 0;
  margin: 0;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  background: white;
  border-radius: 50%;
  width: 13px;
  height: 13px;
  cursor: pointer;
  transition: background 0.3s ease;
  position: relative;
}

input[type="range"]::-webkit-slider-thumb:hover {
  background: var(--brand-color);
}

input[type="range"]::-moz-range-progress {
  background: var(--brand-color);
}

input[type="range"]::-moz-range-track {
  background: rgba(255, 255, 255, 0.3);
}

.otnet__time {
  position: relative;
  font-size: 12px;
  min-width: 40px;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.otnet__time::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: 150%;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
  z-index: 10;
}

.otnet__time:hover::after {
  opacity: 1;
}

.otnet__volume {
  position: relative;
  display: flex;
  align-items: center;
}

.otnet__volume-slider {
  position: absolute;
  bottom: 35px;
  left: 50%;
  transform: translateX(-50%);
  background: #333;
  padding: 5px;
  border-radius: 5px;
  z-index: 10;
  width: 30px;
  height: 100px;
  align-items: center;
  justify-content: center;
}

.otnet__volume-slider input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  width: 80px;
  height: 5px;
  transform: rotate(-90deg);
  background: linear-gradient(to right, var(--brand-color) var(--volume-value, 100%), rgba(255, 255, 255, 0.3) var(--volume-value, 100%));
  border-radius: 3px;
  cursor: pointer;
  outline: none;
}

.otnet__volume-slider input[type="range"]::-webkit-slider-thumb,
.otnet__volume-slider input[type="range"]::-moz-range-thumb {
  background: white;
  border-radius: 50%;
  width: 13px;
  height: 13px;
  cursor: pointer;
  border: none;
  transition: background 0.3s ease;
}

.otnet__volume-slider input[type="range"]::-webkit-slider-thumb:hover {
  background: var(--brand-color);
}

.otnet__volume-slider input[type="range"]:focus {
  outline: none;
}

/* Chapters Panel Styling max-height: 250px; */
.otnet__chapters-panel {
  color: #fff;
  padding: 10px 15px;
  font-size: 14px;
  line-height: 1.5;
  
  overflow-y: auto;
  transition: max-height 0.3s ease;
  border-top: 1px solid #333;
}

.otnet__chapters-panel h4 {
  font-size: 16px;
  font-weight: 600;
   color: #fff;
  margin: 10px 0 5px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 4px;
}

.section-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.section-item:last-child {
  border-bottom: none;
}

.section-play {
  background: none;
  border: none;
  color: #fff;
  font-size: 16px;
  cursor: pointer;
  padding: 4px;
  flex-shrink: 0;
  margin-top: 2px;
}

.section-play:hover {
  transform: scale(1.1);
}

.chapter-text {
  flex: 1;
  font-size: 13px;
}

.chapter-text strong {
  font-weight: 600;
  color: #fff;
}

.chapter-text em {
  font-style: normal;
  color: #ccc;
  margin-left: 5px;
  font-size: 12px;
}

.item-progress {
  height: 4px;
  width: 0%;
  background-color: var(--brand-color, #FFD700);
  margin-top: 4px;
  border-radius: 2px;
  transition: width 0.1s linear;
}

.otnet__playlist-panel {
  color: #fff;
  font-size: 14px;
  line-height: 1.5;
  overflow-y: auto;
  transition: max-height 0.3s ease;
}

.playlist-item {
  display: flex;
  align-items: center;
  grid-template-columns: 56px 1fr auto;   /* thumb | info | details */
  gap: 12px;
  padding: 10px 12px;
  background: rgba(255,255,255,0.04);
  transition: background 0.15s ease;
  cursor: pointer;
}
.playlist-item:hover { background: rgba(255,255,255,0.07); }


.playlist-thumb {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 8px;
  background: #1a1f29;
}

.playlist-info {
  display: flex;
  flex-direction: column;
  gap: 4px;                  /* space between title/desc/meta */
  min-width: 0;              /* allow ellipsis to work */
  font-size: 13px;
  line-height: 1.35;
  width: 100%;
}
.playlist-info strong {
  display: block;
  font-weight: 600;
  color: #fff;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.playlist-desc {
  margin: 0;
  color: #cfcfcf;
  font-size: 12px;
  line-height: 1.4;
}

.playlist-desc:empty { display: none; }

.playlist-meta {
  margin: 0;
  color: #ccc;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.playlist-meta:empty { display: none; }

.playlist-info-label {
  font-weight: 600;
  color: #fff;
  margin-right: 4px;
}

.playlist-details {
  display: flex;
  flex-direction: column;
  align-items: end;
  gap: 2px;
  min-width: 96px;          
  font-size: 12px;
  color: #ccc;
  text-align: right;
}
.playlist-details:empty { display: none; }

.playlist-detail {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin: 0;
  white-space: nowrap;
}
.playlist-detail span {
  font-weight: 600;
  color: #fff;
}

@media (max-width: 520px) {
  .playlist-item {
    grid-template-columns: 48px 1fr;      /* hide details to keep tidy */
  }
  .playlist-details { display: none; }
  .playlist-thumb {
    width: 48px;
    height: 48px;
  }
}

.playlist-item.active {
  background: rgba(255, 0, 128, 0.08);
  border-left: 4px solid #ff007f;
  box-shadow: inset 0 0 8px rgba(255, 0, 128, 0.25);
  transition: all 0.2s ease;
}

.playlist-info > *:first-child { margin-top: 0; }
.playlist-info > *:last-child  { margin-bottom: 0; }

.otnet__menu {
  position: relative;
}

/* Container */
.otnet__menu__container {
  background: #222;
  color: #fff;
  padding: 8px 0;
  border-radius: 6px;
  position: absolute;
  bottom: 45px;
  right: 10px;
  z-index: 10;
  min-width: 160px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.4);
}

/* Items */
.otnet__menu__item,
.otnet__menu__back {
  display: block;
  background: transparent;
  color: #eee;
  border: none;
  padding: 10px 14px;
  margin: 0;
  width: 100%;
  text-align: left;
  cursor: pointer;
  font-size: 14px;
}

.otnet__menu__item:hover,
.otnet__menu__back:hover {
  background: #333;
}

.otnet__menu__item.active {
  background: #444;
  color: #ffd700;
}

/* Back button */
.otnet__menu__back {
  border-bottom: 1px solid #333;
}

/* Subsections */
#otnet-settings > div {
  padding: 0;
}

.otnet__controls {
  opacity: 1;
  pointer-events: auto;
  transition: opacity 0.3s ease;
  float: left;
  width: 100%;
  display: flex;
  height:46px;
  align-items: center;
  gap: 10px;
  padding: 5px;
  color: white;
  z-index: 5;
  box-sizing: border-box;
}

.otnet__controls.hide {
  opacity: 0;
  pointer-events: none;
}

.otnet__button {
  background: transparent;
  all: unset;
  padding: 5px 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.otnet__button svg {
  width: 24px;
  height: 24px;
  display: block;
}

.otnet__controls__item[hidden],
.otnet__button[hidden] {
  display: none !important;
}
</style>
<div id="otnet-player-wrapper">

    <div class="video-wrapper" hidden>
        <video muted playsinline preload="auto" autoplay></video>
    </div>

    <div class="poster-wrapper" hidden></div>

    <div class="player-content">

    <div id="otnet-audio-waveform"></div>

    <div class="otnet__controls" id="otnet-custom-controls">
      <button class="otnet__controls__item otnet__button" id="otnet-playlist-backward" type="button" aria-pressed="false" aria-label="Skip Back Track" hidden></button>
      <button class="otnet__controls__item otnet__button" id="otnet-playPause" type="button" aria-pressed="false" aria-label="Play"></button>

      <div id="otnet-progressContainer" class="otnet__controls__item otnet__progress__container">
        <progress id="otnet-bufferBar" value="0" max="100"></progress>
        <input id="otnet-seekBar" type="range" min="0" max="100" step="0.01" value="0" autocomplete="off" aria-label="Seek" />
      </div>

      <div class="otnet__controls__item otnet__time" id="otnet-timeContainer" data-tooltip="0:00 / 0:00">
        <span id="otnet-currentTime">00:00</span>
      </div>

      <div class="otnet__controls__item otnet__volume">
        <button id="otnet-volumeButton" class="otnet__button" aria-label="Volume">🔊</button>
        <div class="otnet__volume-slider" hidden>
          <input id="otnet-volumeSlider" type="range" min="0" max="1" step="0.05" value="1" autocomplete="off" aria-label="Volume" />
        </div>
      </div>


      <button class="otnet__controls__item otnet__button" id="otnet-chaptersBtn" type="button" aria-label="Chapters" hidden>📂</button>
      <button class="otnet__controls__item otnet__button" id="otnet-playlistBtn" aria-label="Playlist" hidden></button>

      <div class="otnet__menu">
        <button id="otnet-settingsBtn" class="otnet__button" aria-haspopup="true" aria-expanded="false" aria-label="Settings">⚙️</button>
        <div class="otnet__menu__container" id="otnet-settings" hidden>
          <div id="otnet-settings-home">
            <button class="otnet__menu__item" data-target="captions">Captions</button>
            <button class="otnet__menu__item" data-target="audio">Audio</button>
            <button class="otnet__menu__item" data-target="quality">Resolution</button>
            <button class="otnet__menu__item" data-target="speed">Speed</button>
            <button class="otnet__menu__item" data-click="pip">Picture in Picture</button>
          </div>

          <div id="otnet-settings-captions" hidden>
            <button class="otnet__menu__back" data-back>Back</button>
          </div>
          <div id="otnet-settings-audio" hidden>
            <button class="otnet__menu__back" data-back>Back</button>
          </div>
          <div id="otnet-settings-quality" hidden>
            <button class="otnet__menu__back" data-back>Back</button>
          </div>
          <div id="otnet-settings-speed" hidden>
            <button class="otnet__menu__back" data-back>Back</button>
            <button class="otnet__menu__item" data-speed="0.25">0.25x</button>
            <button class="otnet__menu__item" data-speed="0.5">0.5x</button>
            <button class="otnet__menu__item" data-speed="0.75">0.75x</button>
            <button class="otnet__menu__item" data-speed="1">Normal</button>
            <button class="otnet__menu__item" data-speed="1.25">1.25x</button>
            <button class="otnet__menu__item" data-speed="1.5">1.5x</button>
            <button class="otnet__menu__item" data-speed="1.75">1.75x</button>
            <button class="otnet__menu__item" data-speed="2">2x</button>
          </div>
        </div>
      </div>

      <button class="otnet__controls__item otnet__button" id="otnet-fullscreen" type="button" aria-pressed="false" aria-label="Fullscreen"></button>
      
      <button class="otnet__controls__item otnet__button" id="otnet-playlist-forward" type="button" aria-pressed="false" aria-label="Skip Forward Track" hidden></button>
    </div>
  </div>
</div>
<div class="otnet__chapters-panel" id="otnet-chaptersPanel" hidden></div>
<div class="otnet__playlist-panel" id="otnet-playlistPanel" hidden></div>`;
    }
}

customElements.define('otnet-audio-player', OtnetAudioPlayer);
