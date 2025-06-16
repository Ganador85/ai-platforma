import fs from 'fs';
import pdf from 'pdf-parse';

export async function extractTextFromPDF(filePath) {
  const buffer = await fs.promises.readFile(filePath);
  const data = await pdf(buffer);
  return data.text;
}