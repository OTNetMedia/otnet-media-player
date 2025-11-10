// Player Icons: https://materialui.co/icon/picture-in-picture-alt
import BIFParser from '../parsers/BIFParser.js';
import { Icons } from '../helpers/icons.js';
import LanguageHelper from '../helpers/languageHelper.js';
import { createButton, clearMenu } from '../helpers/domHelpers.js';
import { formatTime } from '../helpers/formatHelpers.js';
import OtnetDebugOverlay from './OtnetDebug.js';
import OtnetDrm from './OtnetDrm.js';

import shaka from 'shaka-player';

class OtnetVideoPlayer extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.video = null;
        this.player = null;
        this.metadata = null;
        this.options = {};
        this.src = '';
        this.bif = '';
        this.poster = '';
        this.drm = null;
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
        this.bif = chosen.resources?.bif || '';
        this.waveform = chosen.resources?.waveform || '';
        this.metadata = config.metadata || {};
        this.baseUrl = chosen.base_path || '';
    }

    async setup(config) {
        const options = config.options;
        const playlist = config.playlist;

        this.options = {
            timeFormat: 'hh:mm:ss',
            autoplay: false,
            muted: false,
            openPlaylist: false,
            ...options,
        };

        this.playlist = playlist;

        this.playlist = playlist.map((track) => ({
            ...track,
            metadata: track.metadata && typeof track.metadata === 'object' ? track.metadata : {},
        }));

        this.currentIndex = this.options.startIndex || 0;

        this.applyConfig(this.playlist[this.currentIndex]);

        this.shadowRoot.innerHTML = this.getTemplate();

        this.video = this.shadowRoot.querySelector('video');
        if (!this.src) {
            return console.error('[Otnet]No video source provided.');
        }

        this.setupControls();

        await this.initPlayer();

        this.video.muted = this.options.muted;
        if (this.options.autoplay) this.video.play().catch(() => {});

        if (this.options.openPlaylist && this.playlist.length > 1) {
            this.isPlaylistOpen = true;
            this.shadowRoot.getElementById('otnet-playlistPanel').removeAttribute('hidden');
            this.setupPlaylistPanel();
        }

        this.debugOverlay = new OtnetDebugOverlay(
            this.video,
            this.player,
            'shaka',
            this.shadowRoot,
            {
                debugEnabled: this.options.showDebug ?? false,
                fontSize: '12px',
                basic: true,
            }
        );
    }

    async initPlayer() {
        if (this.player) {
            try {
                this.player.unload?.();
            } catch {}
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

    async switchTrack(nextIndex) {
        if (nextIndex === this.currentIndex) {
            this.video.currentTime = 0;
            this.video.play();
            return;
        }

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

        this._highlightCurrent();
    }

    async loadBIF(url) {
        try {
            if (typeof url !== 'string' || !url) {
                console.warn('No BIF URL provided.');
                return null;
            }
            const res = await fetch(url);
            if (!res.ok) {
                console.warn(`[Otnet] Failed to fetch BIF: ${res.status} ${res.statusText}`);
                return null;
            }
            const arrayBuffer = await res.arrayBuffer();
            this.bifParser = new BIFParser(arrayBuffer);
            return this.bifParser;
        } catch (err) {
            console.warn('[Otnet] BIF loading error:');
            return null;
        }
    }

    async loadMetadata(input) {
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
                console.warn('[Otnet] Metadata loading error:');
                return {};
            }
        } catch (err) {
            console.warn('[Otnet] Metadata loading error:');
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
                label: `${track.width}x${track.height} ${Math.round(track.bandwidth / 1000)} kbps`,
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

    setupControls() {
        const shadow = this.shadowRoot;

        this.overlay = shadow.getElementById('otnet-overlay');
        const playerWrapper = shadow.getElementById('otnet-player-wrapper');

        if (this.playlist.length > 1) {
            const btn = this.shadowRoot.getElementById('otnet-playlistBtn');
            btn.innerHTML = `${Icons.playlist} ${this.playlist.length}`;
            btn.removeAttribute('hidden');
            btn.onclick = () => {
                this.isPlaylistOpen = !this.isPlaylistOpen;
                const pnl = this.shadowRoot.getElementById('otnet-playlistPanel');
                if (this.isPlaylistOpen) {
                    pnl.removeAttribute('hidden');
                    this.setupPlaylistPanel();
                } else {
                    pnl.setAttribute('hidden', '');
                }
            };
        }

        this.playPauseBtn = shadow.getElementById('otnet-playPause');
        this.playPauseBtn.innerHTML = Icons.play;
        this.playPauseBtn.addEventListener('click', () => {
            if (this.video.paused) {
                this.showOverlay();
                this.playPauseBtn.innerHTML = Icons.pause;
                this.video.play();
            } else {
                this.hideOverlay();
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
        const progressContainer = shadow.getElementById('otnet-progressContainer');
        const bufferBar = shadow.getElementById('otnet-bufferBar');
        const previewContainer = shadow.getElementById('otnet-bif-preview');
        const previewImage = shadow.getElementById('otnet-bifImage');
        const previewTime = shadow.getElementById('otnet-bif-time');
        const timeContainer = shadow.getElementById('otnet-timeContainer');
        const currentTimeEl = shadow.getElementById('otnet-currentTime');
        const controlBar = shadow.getElementById('otnet-custom-controls');
        const audioIcon = shadow.getElementById('otnet-audio-icon');
        const subtitleIcon = shadow.getElementById('otnet-subtitle-icon');

        const hideOverlay = false;
        if (hideOverlay) {
            this.overlay.style.display = 'none';
        }

        //audioIcon.innerHTML = Icons.audio;
        //subtitleIcon.innerHTML = Icons.subtitles;

        const staticBif = false;
        seekBar.addEventListener('mousemove', (e) => {
            if (!this.bifParser) return;

            const wrapperRect = playerWrapper.getBoundingClientRect();
            const rect = progressContainer.getBoundingClientRect();
            const offsetX = e.clientX - rect.left;
            const offsetFromWrapper = e.clientX - wrapperRect.left;

            const percent = offsetX / rect.width;
            const time = this.video.duration * percent;

            if (time < 0 || isNaN(time)) return;

            const imageData = this.bifParser.getImageDataAtSecond(time);

            if (imageData) {
                previewImage.src = imageData;

                const thumbnailWidth = this.calculateThumbnailWidth();
                previewContainer.style.width = `${thumbnailWidth}px`;
                previewTime.textContent = formatTime(time);

                if (staticBif) {
                    previewContainer.classList.remove('otnet-bif-move');
                    previewContainer.classList.add('otnet-bif-show-static');
                    previewContainer.style.top = `30px`;
                    previewContainer.style.left = `30px`;
                } else {
                    const positionX = offsetFromWrapper - thumbnailWidth / 2;
                    previewContainer.style.left = positionX < 20 ? `20px` : `${positionX}px`;
                    previewContainer.classList.add('otnet-bif-show-move');
                }
            }
        });

        seekBar.addEventListener('mouseleave', () => {
            if (staticBif) {
                previewContainer.classList.remove('otnet-bif-show-static');
            } else {
                previewContainer.classList.remove('otnet-bif-show-move');
            }
        });

        seekBar.addEventListener('input', () => {
            this.video.currentTime = (seekBar.value / 100) * this.video.duration;
        });

        this.overlay.addEventListener('click', () => {
            if (this.video.paused) {
                this.showOverlay();
                this.playPauseBtn.innerHTML = Icons.pause;
                this.video.play();
            } else {
                this.hideOverlay();
                this.playPauseBtn.innerHTML = Icons.play;
                this.video.pause();
            }
        });

        let hideTimeout;
        const reelOverlay = this.shadowRoot.getElementById('otnet-reel-overlay');

        const showControls = () => {
            controlBar.classList.remove('hide');
            if (this.reelOverlayEnabled) {
                reelOverlay.classList.remove('hide');
            }
            this.shadowRoot.host.style.setProperty('--cue-position', '120px');
            resetHideTimeout();
        };

        const hideControls = () => {
            if (!this.video.paused) {
                controlBar.classList.add('hide');
                if (this.reelOverlayEnabled) {
                    reelOverlay.classList.add('hide');
                }
                this.shadowRoot.host.style.setProperty('--cue-position', '50px');
            }
        };

        const resetHideTimeout = () => {
            clearTimeout(hideTimeout);
            hideTimeout = setTimeout(hideControls, 5000);
        };

        this.shadowRoot.host.addEventListener('mousemove', showControls);

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

            if (this.options.timeFormat === 'ss') {
                currentTimeEl.textContent = Math.round(this.video.currentTime);
            } else {
                currentTimeEl.textContent = current;
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
            this.showOverlay();
            showControls();
        });

        this.video.addEventListener('play', () => {
            this.hideOverlay();
            resetHideTimeout();
        });

        this.video.addEventListener('loadedmetadata', async () => {
            if (this.bif) this.loadBIF(this.bif);

            const meta = await this.loadMetadata(this.metadata.src);

            const title = this.metadata.title || meta?.title || '';
            const description = this.metadata.description || meta?.description || '';
            const sections = this.metadata.sections || meta?.sections || [];

            const overlayTitleEl = this.shadowRoot.querySelector('.otnet__overlay__title');
            const overlayDescriptionEl = this.shadowRoot.querySelector(
                '.otnet__overlay__description'
            );
            if (overlayTitleEl) overlayTitleEl.textContent = title;
            if (overlayDescriptionEl) overlayDescriptionEl.textContent = description;

            this.reelOverlayEnabled = false;
            this.activeHighlight = null;
            this.buildMenus();
            //this.buildOverlayTracks();
            const current = formatTime(this.video.currentTime);
            const total = formatTime(this.video.duration);
            timeContainer.setAttribute('data-tooltip', `${current} / ${total}`);

            if (sections) {
                this.buildCustomOverlay(sections);
            }
        });
    }

    setupPlaylistPanel() {
        const panel = this.shadowRoot.getElementById('otnet-playlistPanel');
        panel.innerHTML = '';

        this.playlist.forEach((track, i) => {
            const { source, poster, metadata } = track;
            const { title, artist = '', album = '', duration = 0 } = metadata;

            // fallback to filename (no extension)
            const displayTitle =
                title || decodeURIComponent(source.split('/').pop()).replace(/\.[^/.]+$/, '');

            // build "Artist / Album" line, if either exists
            const infoLine = [artist, album].filter(Boolean).join(' / ');

            // only show duration if positive
            const durationHtml =
                duration > 0
                    ? `<div class="playlist-detail"><span>Duration:</span> ${formatTime(
                          duration
                      )}</div>`
                    : '';

            const item = document.createElement('div');
            item.classList.add('playlist-item');
            if (i === this.currentIndex) item.classList.add('playing');

            item.innerHTML = `
      ${poster ? `<img src="${poster}" class="playlist-thumb" />` : ''}
      <div class="playlist-info">
        <strong>${displayTitle}</strong>
        ${infoLine ? `<p class="playlist-info-line">${infoLine}</p>` : ''}
      </div>
      <div class="playlist-details">
        ${durationHtml}
      </div>
    `;

            item.addEventListener('click', () => this.switchTrack(i));
            panel.appendChild(item);
        });
    }

    _highlightCurrent() {
        const items = this.shadowRoot.querySelectorAll('.playlist-item');
        items.forEach((el, idx) => {
            el.classList.toggle('playing', idx === this.currentIndex);
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

    buildOverlayTracks() {
        const audioGroup = this.shadowRoot.querySelector('.otnet-overlay__audio-group');
        const captionsGroup = this.shadowRoot.querySelector('.otnet-overlay__captions-group');

        audioGroup.querySelectorAll('.otnet-overlay__track-button').forEach((el) => el.remove());
        captionsGroup.querySelectorAll('.otnet-overlay__track-button').forEach((el) => el.remove());

        const audioTracks = this.player
            .getVariantTracks()
            .filter(
                (track, index, self) =>
                    index === self.findIndex((t) => t.language === track.language)
            );

        if (audioTracks.length > 1) {
            audioGroup.style.display = 'flex';
            audioTracks.forEach((track) => {
                const button = document.createElement('button');
                button.textContent = LanguageHelper.getLanguageLabel(track.language);
                button.classList.add('otnet-overlay__track-button');
                button.addEventListener('click', () => {
                    const selectedTrack = audioTracks.find((t) => t.language === track.language);
                    if (selectedTrack) {
                        this.player.selectVariantTrack(selectedTrack, true);
                    }
                });
                audioGroup.appendChild(button);
            });
        } else {
            audioGroup.style.display = 'none';
        }

        const captionTracks = this.player.getTextTracks();
        if (captionTracks.length > 1) {
            captionsGroup.style.display = 'flex';
            captionTracks.forEach((track) => {
                const button = document.createElement('button');
                button.textContent = LanguageHelper.getLanguageLabel(track.language);
                button.classList.add('otnet-overlay__track-button');
                button.addEventListener('click', async () => {
                    this.player.setTextTrackVisibility(true);
                    this.player.selectTextTrack(track);
                });
                captionsGroup.appendChild(button);
            });
        } else {
            captionsGroup.style.display = 'none';
        }
    }

    buildCustomOverlay(overlayMeta) {
        const customGroup = this.shadowRoot.querySelector('.otnet-overlay__custom-group');
        customGroup.innerHTML = '';

        overlayMeta.forEach((item) => {
            const button = document.createElement('button');
            button.textContent = item.title;
            button.classList.add('otnet-overlay__track-button');

            if (item.time !== undefined) {
                button.addEventListener('click', () => {
                    this.activeHighlight = null;
                    this.video.currentTime = item.time;
                    this.hideOverlay();
                });
            } else if (item.items && Array.isArray(item.items)) {
                button.addEventListener('click', () => {
                    this.showHighlightOverlay(item.items);
                });
            }

            customGroup.appendChild(button);
        });
    }

    showHighlightOverlay(items) {
        this.reelOverlayEnabled = true;

        const reelOverlay = this.shadowRoot.getElementById('otnet-reel-overlay');
        const reelList = this.shadowRoot.getElementById('otnet-reel-list');
        const closeButton = this.shadowRoot.getElementById('otnet-reel-close');

        reelList.innerHTML = '';
        reelOverlay.classList.remove('hide');

        closeButton.onclick = () => {
            this.activeHighlight = null;
            this.reelOverlayEnabled = false;
            reelOverlay.classList.add('hide');
            if (this.highlightProgressInterval) {
                clearInterval(this.highlightProgressInterval);
                this.highlightProgressInterval = null;
            }
        };

        this.highlightButtons = [];

        items.forEach((item, index) => {
            const button = document.createElement('button');
            button.classList.add('otnet-overlay__reel-button');
            button.setAttribute('data-index', index);

            const progressBar = document.createElement('span');
            progressBar.classList.add('otnet-overlay__reel-progress');

            const timeBadge = document.createElement('span');
            timeBadge.classList.add('otnet-overlay__reel-time-badge');
            timeBadge.textContent = formatTime(item.time);

            const buttonText = document.createElement('span');
            buttonText.textContent = item.title;

            button.appendChild(progressBar);
            button.appendChild(timeBadge);
            button.appendChild(buttonText);

            button.addEventListener('click', () => {
                if (this.highlightProgressInterval) clearInterval(this.highlightProgressInterval);
                this.highlightButtons.forEach((h) => (h.progressBar.style.width = '0%'));

                this.video.currentTime = item.time;
                this.video.play();
                this.activeHighlight = {
                    start: parseInt(item.time),
                    end: parseInt(item.time) + parseInt(item.duration),
                    progressBar,
                    duration: parseInt(item.duration),
                    index,
                };

                this.startHighlightProgressUpdater();
            });

            reelList.appendChild(button);
            this.highlightButtons.push({ button, progressBar });
        });
    }

    startHighlightProgressUpdater() {
        if (this.highlightProgressInterval) clearInterval(this.highlightProgressInterval);

        console.log('Starting highlight progress updater for', this.activeHighlight);
        this.highlightProgressInterval = setInterval(() => {
            if (!this.activeHighlight) return;

            const { start, end, progressBar, duration } = this.activeHighlight;
            const currentTime = this.video.currentTime;

            if (currentTime >= end) {
                this.video.currentTime = start;
                this.video.play();
            }

            const progress = Math.min(((currentTime - start) / duration) * 100, 100);
            if (progressBar) progressBar.style.width = `${progress}%`;
        }, 100);
    }

    hideOverlay() {
        this.overlay.classList.remove('show');
        this.overlay.classList.add('hide');
    }

    showOverlay() {
        this.overlay.classList.remove('hide');
        this.overlay.classList.add('show');
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
        const settingsBtn = shadow.getElementById('otnet-settingsBtn');
        const settingsMenu = shadow.getElementById('otnet-settings');

        shadow.querySelectorAll('#otnet-settings > div').forEach((menu) => (menu.hidden = true));
        shadow.getElementById('otnet-settings-home').hidden = false;

        settingsBtn.setAttribute('aria-expanded', 'false');
        settingsMenu.hidden = true;
    }

    getTemplate() {
        return `
<style>
:host {
    --brand-color: #FFD700;
    display: block;
    outline: none !important;
    position: relative;
    height: 100%;
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
    height: 100%;
    display: flex;
    justify-content: center;
}

video {
    max-width: 100%;
    max-height: 100vh;
    height: auto;
    display: block;
    margin: 0 auto;
    object-fit: contain;
}

::slotted(.shaka-text-container) {
    bottom: 50px !important;
    position: absolute !important;
    width: 100%;
    text-align: center;
    pointer-events: none;
    z-index: 4;
}

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
    display: flex;
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

.otnet__volume-slider input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    background: white;
    border-radius: 50%;
    width: 13px;
    height: 13px;
    cursor: pointer;
    transition: background 0.3s ease;
}

.otnet__volume-slider input[type="range"]::-webkit-slider-thumb:hover {
    background: var(--brand-color);
}

.otnet__volume-slider input[type="range"]::-moz-range-thumb {
    background: white;
    border-radius: 50%;
    width: 13px;
    height: 13px;
    cursor: pointer;
    border: none;
}

.otnet__volume-slider input[type="range"]:focus {
    outline: none;
}

#otnet-bif-preview {
    position: absolute;
    pointer-events: none;
    width: 240px;
    opacity: 0;
    z-index: 5;
}

#otnet-bif-preview.otnet-bif-show-static {
    opacity: 1;
    transition: opacity 0.3s ease, transform 0.3s ease;
}

#otnet-bif-preview.otnet-bif-move {
    bottom: 50px;
    opacity: 0;
    transform: scale(0.9);
    transition: opacity 0.3s ease, transform 0.3s ease;
}

#otnet-bif-preview.otnet-bif-show-move {
    opacity: 1;
    transform: scale(1);
}

#otnet-bif-preview-wrapper {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    border-radius: 5px;
    overflow: hidden;
}

#otnet-bif-preview #otnet-bifImage {
    width: 100%;
    height: auto;
    border-radius: 4px;
    margin: 0;
    padding: 0;
}

#otnet-bif-preview #otnet-bif-time {
    text-align: center;
    color: white;
    background: rgba(0, 0, 0, 0.7);
    border-radius: 4px;
    margin-top: 5px;
    padding: 2px 5px;
    font-size: 12px;
    position: absolute;
    bottom: 0;
    width: 100%;
}

.otnet__overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 1;
    transition: opacity 0.3s ease;
    z-index: 4;
}

.otnet__overlay.hide {
    opacity: 0;
    pointer-events: auto;
}

.otnet__overlay.show {
    opacity: 1;
    pointer-events: auto;
}

.otnet__overlay__content {
    text-align: center;
    color: white;
    padding: 1rem;
    max-width: 90%;
    margin: 0 auto;
    font-family: 'Segoe UI', Roboto, sans-serif;
}

.otnet__overlay__title {
    font-size: clamp(1.5rem, 2vw, 2.5rem);
    font-weight: bold;
    margin-bottom: 1rem;
}

.otnet__overlay__description {
    font-size: clamp(1rem, 1.5vw, 1.25rem);
    line-height: 1.6;
    margin: 0 auto 1.5rem auto;
    max-width: 960px;
    word-wrap: break-word;
    padding: 0 1rem;
    opacity: 0.9;
}

.otnet__overlay__meta {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 10px;
    font-size: 14px;
}

.otnet__overlay__now {
    background: #00E5B0;
    color: black;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: bold;
}

.otnet__overlay__age-badge {
    background: var(--brand-color);
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: bold;
}

.otnet__overlay__time {
    color: #ccc;
}

.otnet-overlay__track-group {
    margin: 15px 0;
    overflow-x: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 5px;
}

.otnet-overlay__track-header {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    color: white;
    font-size: 16px;
    font-weight: bold;
    user-select: none;
    pointer-events: none;
}

.otnet-overlay__track-icon {
    font-size: 18px;
}

.otnet-overlay__track-button {
    white-space: nowrap;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: white;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    flex: 0 0 auto;
    transition: background 0.3s ease;
}

.otnet-overlay__track-button:hover {
    background: rgba(255, 255, 255, 0.3);
}

.otnet-overlay__track-group::-webkit-scrollbar {
    height: 5px;
}

.otnet-overlay__track-group::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.3);
    border-radius: 5px;
}

.otnet-overlay__custom-group {
    margin: 15px 0;
    overflow-x: auto;
    align-items: center;
    gap: 10px;
    padding-bottom: 5px;
    justify-content: center;
    align-items: center;
}

.otnet__reel-overlay {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 250px;
    max-height: 80%;
    overflow-y: auto;
    background: rgba(0, 0, 0, 0.9);
    padding: 10px;
    border-radius: 5px;
    z-index: 6;
    opacity: 1;
    transition: opacity 0.3s ease;
}

.otnet__reel-overlay.hide {
    opacity: 0;
    pointer-events: none;
}

.otnet__reel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: white;
    margin-bottom: 10px;
}

.otnet__reel-close-button {
    background: transparent;
    border: 1px solid white;
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
}

.otnet__reel-list {
    display: flex;
    flex-direction: column;
}

.otnet__reel-list::-webkit-scrollbar {
    height: 5px;
}

.otnet__reel-list::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.3);
    border-radius: 5px;
}

.otnet__reel-list button {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    width: 100%;
    margin-bottom: 8px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: white;
    padding: 8px 12px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.3s ease;
    gap: 10px;
    overflow: hidden;
}

.otnet__reel-list button:hover {
    background: rgba(255, 255, 255, 0.3);
}

.otnet-overlay__reel-progress {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    width: 0%;
    background-color: rgba(0, 178, 255, 0.5);
    transition: width 0.1s linear;
    z-index: 1;
}

.otnet-overlay__reel-time-badge {
    background: var(--brand-color);
    color: black;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 12px;
    font-weight: bold;
    flex-shrink: 0;
    z-index: 2;
    position: relative;
}

.otnet__reel-list button span:not(.otnet-overlay__reel-progress):not(.otnet-overlay__reel-time-badge) {
    z-index: 2;
    position: relative;
}

#otnet-debug-overlay {
    position: absolute;
    top: 0;
    left: 0;
    color: white;
    font-family: monospace;
    padding: 0.5rem;
    pointer-events: none;
}

.otnet-debug-inner {
    background: rgba(0, 0, 0, 0.7);
    padding: 1rem;
    border-radius: 8px;
    max-height: 100%;
    overflow-y: auto;
}


.otnet__playlist-panel {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 30%;
  max-height: 80%;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.9);
  padding: 10px;
  border-radius: 5px;
  z-index: 6;
  opacity: 1;
  transition: opacity 0.3s ease;
}

/* hide when closed */
.otnet__playlist-panel.hide {
  opacity: 0;
  pointer-events: none;
}


.otnet__playlist-panel::-webkit-scrollbar {
  width: 5px;
}
.otnet__playlist-panel::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.3);
  border-radius: 5px;
}


.otnet__playlist-panel .playlist-item {
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.1);
  color: white;
  padding: 8px 12px;
  margin-bottom: 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.3s ease;
  gap: 4px;
  overflow: hidden;
}


.otnet__playlist-panel .playlist-item:hover {
  background: rgba(255, 255, 255, 0.3);
}

.otnet__playlist-panel .playlist-thumb {
  display: none !important;
}


.otnet__playlist-panel .playlist-info strong {
  font-size: 14px;
  font-weight: bold;
  color: #fff;
}


.otnet__playlist-panel .playlist-info-line {
  font-size: 12px;
  color: #ccc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.otnet__playlist-panel .playlist-details {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  font-size: 12px;
  color: #ccc;
}
.otnet__playlist-panel .playlist-details span {
  font-weight: 600;
  color: #fff;
  margin-right: 4px;
}


.otnet__menu__container {
  background: #ffffffee;
  color: #4a5464;
  padding: 10px;
  border-radius: 8px;
  position: absolute;
  bottom: 45px;
  right: 10px;
  z-index: 10;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  min-width: 150px;
}

.otnet__menu__item,
.otnet__menu__back {
  display: block;
  background: #f4f4f4;
  color: #4a5464;
  border: none;
  padding: 7px 10px;
  margin: 5px 0;
  cursor: pointer;
  border-radius: 4px;
  white-space: nowrap;
  width: 100%;
  text-align: left;
}

.otnet__menu__item:hover,
.otnet__menu__back:hover,
.otnet__menu__item.active {
  background: #ddd;
}

.otnet__controls {
    opacity: 1;
    pointer-events: auto;
    transition: opacity 0.3s ease;
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0));
    padding: 5px;
    color: white;
    border-radius: 0 0 5px 5px;
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
    <div id="otnet-debug-overlay"></div>
    <div id="otnet-reel-overlay" class="otnet__reel-overlay hide">
        <div class="otnet__reel-header">
            <span>Highlights</span>
            <button id="otnet-reel-close" class="otnet__reel-close-button">×</button>
        </div>
        <div id="otnet-reel-list" class="otnet__reel-list"></div>
    </div>
    <div class="otnet__playlist-panel" id="otnet-playlistPanel" hidden></div>
    <div id="otnet-overlay" class="otnet__overlay">
        <div class="otnet__overlay__content">
            <div class="otnet__overlay__title"></div>
            <div class="otnet__overlay__description"></div>
            <div class="otnet-overlay__track-group otnet-overlay__custom-group"></div>
        </div>
    </div>
    <video autoplay></video>
    <div id="otnet-subtitle-wrapper" class="otnet__subtitle-wrapper"></div>
    <div id="otnet-native-subtitle-wrapper"></div>
    <div id="otnet-bif-preview" class="otnet-bif-move">
        <div id="otnet-bif-preview-wrapper">
            <img id="otnet-bifImage" src="" />
            <div id="otnet-bif-time">0:00</div>
        </div>
    </div>
    <div class="otnet__controls" id="otnet-custom-controls">
       <button class="otnet__controls__item otnet__button" id="otnet-playPause" type="button" aria-pressed="false" aria-label="Play"></button>

        <div id="otnet-progressContainer" class="otnet__controls__item otnet__progress__container">
        <progress id="otnet-bufferBar" value="0" max="100"></progress>
        <input id="otnet-seekBar" type="range" min="0" max="100" step="0.01" value="0" autocomplete="off" aria-label="Seek" />
      </div>
        <div class="otnet__controls__item otnet__time" id="otnet-timeContainer" data-tooltip="0:00 / 0:00">
            <span id="otnet-currentTime">00:00</span>
        </div>
        <div class="otnet__controls__item otnet__volume">
            <button id="otnet-volumeButton" class="otnet__button">🔊</button>
            <div class="otnet__volume-slider" hidden style="display: none;">
                <input id="otnet-volumeSlider" type="range" min="0" max="1" step="0.05" value="1" autocomplete="off" aria-label="Volume" />
            </div>
        </div>
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

        <button class="otnet__controls__item otnet__button" id="otnet-fullscreen" type="button" aria-pressed="false"></button>
    </div>
</div>
        `;
    }
}

customElements.define('otnet-video-player', OtnetVideoPlayer);
