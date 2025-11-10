export function getBufferedTotal(video) {
    if (!video || video.buffered.length === 0) return 0;

    let total = 0;
    for (let i = 0; i < video.buffered.length; i++) {
        total += video.buffered.end(i) - video.buffered.start(i);
    }
    return total;
}

export function getBufferedAhead(video) {
    if (!video || video.buffered.length === 0) return 0;

    const currentTime = video.currentTime;

    for (let i = 0; i < video.buffered.length; i++) {
        const start = video.buffered.start(i);
        const end = video.buffered.end(i);

        if (currentTime >= start && currentTime <= end) {
            return end - currentTime;
        }
    }

    if (currentTime < video.buffered.start(0)) {
        return video.buffered.end(0) - video.buffered.start(0);
    }

    return 0;
}

export function getBufferedBehind(video) {
    if (!video || video.buffered.length === 0) return 0;

    const currentTime = video.currentTime;

    for (let i = 0; i < video.buffered.length; i++) {
        const start = video.buffered.start(i);
        const end = video.buffered.end(i);

        if (currentTime >= start && currentTime <= end) {
            return currentTime - start;
        }
    }

    const lastIndex = video.buffered.length - 1;
    if (currentTime > video.buffered.end(lastIndex)) {
        return video.buffered.end(lastIndex) - video.buffered.start(lastIndex);
    }

    return 0;
}
