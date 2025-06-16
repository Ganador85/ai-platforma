import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

export async function extractTextFromFile(filePath, mimetype) {
    if (mimetype === "application/pdf") {
        const buffer = await fs.promises.readFile(filePath);
        const data = await pdfParse(buffer);
        return data.text;
    }

    if (mimetype === "text/plain") {
        return await fs.promises.readFile(filePath, "utf-8");
    }

    throw new Error("Nepalaikomas failo tipas.");
}