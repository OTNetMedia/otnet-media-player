export default class VTTParser {
    static parseVTT(vttText) {
        const cues = [];
        const lines = vttText.split('\n').map((line) => line.trim());
        let i = 0;

        while (i < lines.length) {
            if (lines[i].includes('-->')) {
                const timeParts = lines[i].split('-->').map((part) => part.trim());
                const start = VTTParser.parseVTTTime(timeParts[0]);
                const end = VTTParser.parseVTTTime(timeParts[1]);

                let text = '';
                i++;

                while (i < lines.length && lines[i] !== '') {
                    text += lines[i] + '\n';
                    i++;
                }

                cues.push({ startTime: start, endTime: end, text: text.trim() });
            }
            i++;
        }

        return cues;
    }

    static parseVTTTime(timeString) {
        const parts = timeString.split(':');
        let seconds = 0;

        if (parts.length === 3) {
            seconds += parseFloat(parts[0]) * 3600;
            seconds += parseFloat(parts[1]) * 60;
            seconds += parseFloat(parts[2]);
        } else if (parts.length === 2) {
            seconds += parseFloat(parts[0]) * 60;
            seconds += parseFloat(parts[1]);
        }

        return seconds;
    }

    static async getSubtitleTracks(mpdUrl) {
        const response = await fetch(mpdUrl);
        const mpdText = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(mpdText, 'application/xml');

        const adaptationSets = Array.from(
            xmlDoc.querySelectorAll('AdaptationSet[mimeType="text/vtt"]')
        );

        return adaptationSets.map((adaptation) => {
            const lang = adaptation.getAttribute('lang');
            const label = adaptation.getAttribute('label') || lang.toUpperCase();
            const baseUrl = adaptation.querySelector('BaseURL')?.textContent;

            return { lang, label, url: VTTParser.resolveSubtitleUrl(mpdUrl, baseUrl) };
        });
    }

    static resolveSubtitleUrl(mpdUrl, subtitleRelativeUrl) {
        const url = new URL(mpdUrl);
        url.pathname =
            url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1) + subtitleRelativeUrl;
        return url.toString();
    }
}
