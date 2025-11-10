export default class LanguageHelper {
    static getLanguageLabel(code) {
        const languageMap = {
            en: 'English',
            es: 'Spanish',
            fr: 'French',
            de: 'German',
            it: 'Italian',
            pt: 'Portuguese',
            zh: 'Chinese',
            ja: 'Japanese',
            ko: 'Korean',
            ru: 'Russian',
            ar: 'Arabic',
            hi: 'Hindi',
            nl: 'Dutch',
            sv: 'Swedish',
            no: 'Norwegian',
            da: 'Danish',
            fi: 'Finnish',
            pl: 'Polish',
            tr: 'Turkish',
            cs: 'Czech',
            el: 'Greek',
            ro: 'Romanian',
            th: 'Thai',
            vi: 'Vietnamese',
        };

        return languageMap[code.toLowerCase()] || code.toUpperCase();
    }
}
