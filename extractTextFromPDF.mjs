import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function extractTextFromPDF(filePath) {
    const data = new Uint8Array(await fs.promises.readFile(filePath));
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    let text = '';

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(' ') + '\n';
    }

    return text;
}