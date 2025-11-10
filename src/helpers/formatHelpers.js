import Hls from 'hls.js';

export function formatTime(time) {
    if (isNaN(time)) return '00:00';

    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function getFallbackTitle(src) {
    try {
        const url = new URL(src);
        src = url.pathname;
    } catch (e) {
        // Ignore
    }
    const fileName = src.split('/').pop() || '';
    return fileName.replace(/\.[^/.]+$/, '') || 'Unknown Track';
}

export function detectPlayerType(src) {
    const isHls = /\.m3u8($|\?)/i.test(src);
    const isDash = /\.mpd($|\?)/i.test(src);

    if (isDash) {
        return 'shaka';
    } else if (isHls) {
        return Hls.isSupported() ? 'hls' : 'native';
    } else {
        return 'native';
    }
}

export function stripExtension(urlStr) {
    console.log(urlStr);
    if (!urlStr) return '';
    const url = new URL(urlStr);
    const pathname = url.pathname;
    const strippedPath = pathname.replace(/\.[^/.?#]+$/, '');
    return `${url.origin}${strippedPath}`;
}
