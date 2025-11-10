export default class BIFParser {
    static BIF_INDEX_OFFSET = 64;
    static FRAMEWISE_SEPARATION_OFFSET = 16;
    static NUMBER_OF_BIF_IMAGES_OFFSET = 12;
    static VERSION_OFFSET = 8;

    static BIF_INDEX_ENTRY_LENGTH = 8;

    static MAGIC_NUMBER = new Uint8Array([0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);

    static validate(magicNumber) {
        let isValid = true;

        BIFParser.MAGIC_NUMBER.forEach((byte, i) => {
            if (byte !== magicNumber[i]) {
                isValid = false;
                return;
            }
        });

        return isValid;
    }

    constructor(arrayBuffer) {
        const magicNumber = new Uint8Array(arrayBuffer).slice(0, 8);

        if (!BIFParser.validate(magicNumber)) {
            throw new Error('Invalid BIF file.');
        }

        this.arrayBuffer = arrayBuffer;
        this.data = new DataView(arrayBuffer);

        this.framewiseSeparation =
            this.data.getUint32(BIFParser.FRAMEWISE_SEPARATION_OFFSET, true) || 1000;
        this.numberOfBIFImages = this.data.getUint32(BIFParser.NUMBER_OF_BIF_IMAGES_OFFSET, true);
        this.version = this.data.getUint32(BIFParser.VERSION_OFFSET, true);

        this.bifIndex = this.generateBIFIndex();
    }

    generateBIFIndex() {
        const bifIndex = [];

        for (
            let i = 0, bifIndexEntryOffset = BIFParser.BIF_INDEX_OFFSET;
            i < this.numberOfBIFImages;
            i += 1, bifIndexEntryOffset += BIFParser.BIF_INDEX_ENTRY_LENGTH
        ) {
            const bifIndexEntryTimestampOffset = bifIndexEntryOffset;
            const bifIndexEntryAbsoluteOffset = bifIndexEntryOffset + 4;
            const nextBifIndexEntryAbsoluteOffset =
                bifIndexEntryAbsoluteOffset + BIFParser.BIF_INDEX_ENTRY_LENGTH;

            const offset = this.data.getUint32(bifIndexEntryAbsoluteOffset, true);
            const nextOffset = this.data.getUint32(nextBifIndexEntryAbsoluteOffset, true);
            const timestamp = this.data.getUint32(bifIndexEntryTimestampOffset, true);

            bifIndex.push({
                offset: offset,
                timestamp: timestamp,
                length: nextOffset - offset,
            });
        }

        return bifIndex;
    }

    getImageDataAtSecond(second) {
        const image = 'data:image/jpeg;base64,';
        const frameNumber = Math.floor(second / (this.framewiseSeparation / 1000));
        const frame = this.bifIndex[frameNumber];

        if (!frame) {
            return image;
        }

        const base64 = btoa(
            new Uint8Array(
                this.arrayBuffer.slice(frame.offset, frame.offset + frame.length)
            ).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        return base64 ? `${image}${base64}` : '';
    }
}
