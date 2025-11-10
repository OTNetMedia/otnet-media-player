export default class OtnetDebugOverlay {
    constructor(video, player, playerType, shadowRoot, options = {}) {
        this.video = video;
        this.player = player;
        this.playerType = playerType;

        this.options = {
            debugEnabled: options.debugEnabled ?? true,
            fontSize: options.fontSize ?? '12px',
            basic: options.basic ?? false,
        };

        this.debugEl = shadowRoot.getElementById('otnet-debug-overlay');

        if (!this.debugEl) {
            console.warn('[OtnetDebugOverlay] Debug container not found');
        }

        if (this.options.debugEnabled) {
            this.start();
        }
    }

    safeNumber(value) {
        return typeof value === 'number' && !isNaN(value) ? value.toFixed(2) : '...';
    }

    getBufferedTotal() {
        return this.video.buffered.length
            ? this.video.buffered.end(this.video.buffered.length - 1)
            : 0;
    }

    getBufferedAhead() {
        return this.getBufferedTotal() - this.video.currentTime;
    }

    getBufferedBehind() {
        return (
            this.video.currentTime - (this.video.buffered.length ? this.video.buffered.start(0) : 0)
        );
    }

    start() {
        if (this.interval) return;
        this.interval = setInterval(() => this.render(), 1000);
        this.render();
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    destroy() {
        this.stop();
        if (this.debugEl) {
            this.debugEl.innerHTML = '';
        }
    }

    render() {
        if (!this.options.debugEnabled || !this.debugEl || !this.video) return;

        const style = `
            font-family: monospace;
            font-size: ${this.options.fontSize};
            color: #0f0;
            background: rgba(0, 0, 0, 0.6);
            padding: 4px 8px;
            border-radius: 4px;
            line-height: 1.4;
        `;

        if (this.options.basic && this.playerType === 'shaka' && this.player?.getStats) {
            const stats = this.player.getStats();
            const bandwidth = `${this.safeNumber(stats.streamBandwidth / 1_000_000)} Mbps`;
            const resolution = `${stats.width ?? '...'} × ${stats.height ?? '...'}`;

            this.debugEl.innerHTML = `
                <div class="otnet-debug-inner" style="${style}">
                    <div>Bandwidth: ${bandwidth}</div>
                    <div>Resolution: ${resolution}</div>
                </div>
            `;
            return;
        }

        const totalBuffered = this.safeNumber(this.getBufferedTotal());
        const bufferedAhead = this.safeNumber(this.getBufferedAhead());
        const bufferedBehind = this.safeNumber(this.getBufferedBehind());

        this.debugEl.innerHTML = `
            <div class="otnet-debug-inner" style="${style}">
                <div>Total Buffered: ${totalBuffered}s</div>
                <div>Buffered Ahead: ${bufferedAhead}s</div>
                <div>Buffered Behind: ${bufferedBehind}s</div>
            </div>
        `;

        const inner = this.debugEl.querySelector('.otnet-debug-inner');
        const addDiv = (label, value) => {
            const div = document.createElement('div');
            div.textContent = `${label}: ${value}`;
            inner.appendChild(div);
        };

        if (this.playerType === 'shaka' && this.player?.getStats) {
            const stats = this.player.getStats();

            const statsItems = [
                ['Buffering Time', `${this.safeNumber(stats.bufferingTime)}s`],
                ['Completion Percent', `${this.safeNumber(stats.completionPercent)}%`],
                ['Corrupted Frames', this.safeNumber(stats.corruptedFrames)],
                ['Decoded Frames', this.safeNumber(stats.decodedFrames)],
                ['Dropped Frames', this.safeNumber(stats.droppedFrames)],
                [
                    'Estimated Bandwidth',
                    `${this.safeNumber(stats.estimatedBandwidth / 1_000_000)} Mbps`,
                ],
                ['Height', `${this.safeNumber(stats.height)}px`],
                ['Live Latency', `${this.safeNumber(stats.liveLatency)}s`],
                ['Load Latency', `${this.safeNumber(stats.loadLatency)}s`],
                ['Pause Time', `${this.safeNumber(stats.pauseTime)}s`],
                ['Play Time', `${this.safeNumber(stats.playTime)}s`],
                ['Stalls Detected', this.safeNumber(stats.stallsDetected)],
                ['Stream Bandwidth', `${this.safeNumber(stats.streamBandwidth / 1_000_000)} Mbps`],
                ['Width', `${this.safeNumber(stats.width)}px`],
            ];

            statsItems.forEach(([label, value]) => addDiv(label, value));
        }
    }
}
