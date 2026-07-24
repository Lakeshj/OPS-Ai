const path = require("path");
const fs = require("fs/promises");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");
const AppError = require("../utils/AppError");
const { toAbsolutePath } = require("./documentStorage.service");

const stripXml = (xml) =>
  xml
    .replace(/<a:t[^>]*>/g, "")
    .replace(/<\/a:t>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const normalizeMarkdown = (markdown, title) => {
  const body = String(markdown || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!body) {
    throw new AppError(
      "Converted document was empty",
      422,
      "EMPTY_CONVERSION"
    );
  }

  const heading = `# ${title}\n\n`;
  if (body.startsWith("# ")) return body;
  return `${heading}${body}`;
};

const convertPdf = async (buffer, title) => {
  const parsed = await pdfParse(buffer);
  if (!String(parsed.text || "").trim()) {
    throw new AppError(
      "PDF contains no extractable text. It appears to be scanned and requires OCR.",
      422,
      "OCR_REQUIRED"
    );
  }
  return normalizeMarkdown(parsed.text, title);
};

const convertDocx = async (buffer, title) => {
  const result = await mammoth.convertToMarkdown({ buffer });
  return normalizeMarkdown(result.value, title);
};

const formatSpreadsheetCell = (value) => {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  if ("result" in value) return formatSpreadsheetCell(value.result);
  if ("text" in value) return String(value.text);
  if ("richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text || "").join("");
  }
  return JSON.stringify(value);
};

const convertXlsx = async (buffer, title) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sections = workbook.worksheets.map((sheet) => {
    const rows = [];
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const cells = [];
      for (
        let columnNumber = 1;
        columnNumber <= sheet.columnCount;
        columnNumber += 1
      ) {
        cells.push(
          formatSpreadsheetCell(row.getCell(columnNumber).value)
            .replace(/\t/g, " ")
            .replace(/\r?\n/g, " ")
        );
      }
      rows.push(cells.join("\t").replace(/\t+$/g, ""));
    }
    return `## ${sheet.name}\n\n\`\`\`tsv\n${rows.join("\n").trim()}\n\`\`\``;
  });
  return normalizeMarkdown(sections.join("\n\n"), title);
};

const convertPptx = async (buffer, title) => {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const aNum = Number(a.match(/slide(\d+)/i)?.[1] || 0);
      const bNum = Number(b.match(/slide(\d+)/i)?.[1] || 0);
      return aNum - bNum;
    });

  const slides = [];
  for (const slideFile of slideFiles) {
    const xml = await zip.files[slideFile].async("string");
    const text = stripXml(xml);
    if (text) {
      const index = Number(slideFile.match(/slide(\d+)/i)?.[1] || slides.length + 1);
      slides.push(`## Slide ${index}\n\n${text}`);
    }
  }

  return normalizeMarkdown(slides.join("\n\n"), title);
};

const convertTextLike = async (buffer, title) => {
  const text = buffer.toString("utf8");
  return normalizeMarkdown(text, title);
};

const convertBufferToMarkdown = async ({
  buffer,
  extension,
  originalName,
}) => {
  const title = path.parse(originalName).name || "Document";
  const ext = String(extension || "").toLowerCase();

  switch (ext) {
    case "pdf":
      return convertPdf(buffer, title);
    case "docx":
      return convertDocx(buffer, title);
    case "xlsx":
      return convertXlsx(buffer, title);
    case "pptx":
      return convertPptx(buffer, title);
    case "ppt":
      throw new AppError(
        "Legacy .ppt files are not supported. Please upload .pptx",
        400,
        "UNSUPPORTED_EXTENSION"
      );
    case "txt":
    case "md":
      return convertTextLike(buffer, title);
    default:
      throw new AppError(
        `Unsupported conversion type: ${ext}`,
        400,
        "UNSUPPORTED_EXTENSION"
      );
  }
};

const convertStoredDocumentToMarkdown = async (document) => {
  const absolutePath = toAbsolutePath(document.storage_key);
  const buffer = await fs.readFile(absolutePath);
  return convertBufferToMarkdown({
    buffer,
    extension: document.file_extension,
    originalName: document.original_name,
  });
};

module.exports = {
  convertBufferToMarkdown,
  convertStoredDocumentToMarkdown,
};
