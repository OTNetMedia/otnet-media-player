import shaka from 'shaka-player';

export default class OtnetDrm {
    constructor() {
        this.player = null;
        this._unregister = null;
    }

    setPlayer(player) {
        this.player = player;
    }

    async apply(drm) {
        if (!this.player) throw new Error('OtnetDrm: player not set');
        this._clearFilters();

        const cfg = await this._buildConfig(drm);
        if (Object.keys(cfg).length) {
            this.player.configure(cfg);
            this._registerLicenseHeaders(drm);
        }
    }

    detach() {
        this._clearFilters();
        this.player = null;
    }

    async _buildConfig(drm) {
        if (!drm) return {};

        const servers = {};
        if (drm.widevine?.serverURL) {
            servers['com.widevine.alpha'] = drm.widevine.serverURL;
        }
        if (drm.playready?.serverURL) {
            servers['com.microsoft.playready'] = drm.playready.serverURL;
        }
        if (drm.fairplay?.serverURL) {
            servers['com.apple.fps.1_0'] = drm.fairplay.serverURL;
        }

        const cfg = { drm: { servers, advanced: {} } };

        if (drm.clearkey?.keys) {
            cfg.drm.clearKeys = drm.clearkey.keys;
        }

        if (drm.fairplay?.certificateUrl) {
            const cert = await fetch(drm.fairplay.certificateUrl).then((r) => r.arrayBuffer());
            cfg.drm.advanced['com.apple.fps.1_0'] = {
                serverCertificate: new Uint8Array(cert),
            };
        }

        // Optional robustness or persistent session settings can go here:
        // cfg.drm.advanced["com.widevine.alpha"] = { videoRobustness: "SW_SECURE_CRYPTO" };
        return cfg;
    }

    _registerLicenseHeaders(drm) {
        const headers = {
            ...(drm?.widevine?.headers || {}),
            ...(drm?.playready?.headers || {}),
            ...(drm?.fairplay?.headers || {}),
        };
        if (!this.player || !Object.keys(headers).length) return;

        const net = this.player.getNetworkingEngine?.();
        if (!net) return;

        const T = shaka.net.NetworkingEngine.RequestType;

        const filter = (type, request) => {
            if (type === T.LICENSE) {
                request.headers = { ...(request.headers || {}), ...headers };
            }
        };

        net.registerRequestFilter(filter);
        this._unregister = () => {
            try {
                net.unregisterRequestFilter(filter);
            } catch {}
            this._unregister = null;
        };
    }

    _clearFilters() {
        if (this._unregister) {
            this._unregister();
            this._unregister = null;
        }
    }
}
