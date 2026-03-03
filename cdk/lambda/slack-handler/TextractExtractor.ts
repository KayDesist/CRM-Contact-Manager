import {
  TextractClient,
  AnalyzeDocumentCommand,
  FeatureType,
} from "@aws-sdk/client-textract";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const textractClient = new TextractClient({
  region: process.env.AWS_REGION || "us-east-2",
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-2",
});

const IMAGE_BUCKET = process.env.IMAGE_BUCKET!;

// Downloads file (image or PDF) from Slack
async function downloadFileFromSlack(
  fileUrl: string,
  slackToken: string,
): Promise<Buffer> {
  console.log("Downloading file from Slack:", fileUrl);

  const response = await fetch(fileUrl, {
    headers: {
      Authorization: `Bearer ${slackToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  console.log("File downloaded successfully, size:", buffer.length, "bytes");
  return buffer;
}

// Uploads file to S3 bucket
async function uploadFileToS3(
  fileBuffer: Buffer,
  messageId: string,
  contentType: string,
  fileName: string,
): Promise<string> {
  // Determine extension from content type or filename
  let ext = "bin";
  if (contentType.includes("png")) ext = "png";
  else if (contentType.includes("jpg") || contentType.includes("jpeg"))
    ext = "jpg";
  else if (contentType.includes("pdf")) ext = "pdf";
  else if (fileName) {
    const fileExt = fileName.split(".").pop();
    if (fileExt) ext = fileExt;
  }

  const timestamp = Date.now();
  const key = `files/${messageId}-${timestamp}.${ext}`;

  console.log("Uploading file to S3:", key);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: IMAGE_BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    }),
  );

  console.log("File uploaded successfully to S3");
  return key;
}

// Uses AWS Textract AnalyzeDocument to extract text (supports PDFs and better OCR)
async function extractTextFromS3File(s3Key: string): Promise<string> {
  console.log("Calling Textract AnalyzeDocument on:", s3Key);

  try {
    const command = new AnalyzeDocumentCommand({
      Document: {
        S3Object: {
          Bucket: IMAGE_BUCKET,
          Name: s3Key,
        },
      },
      FeatureTypes: [FeatureType.FORMS, FeatureType.TABLES],
    });

    const response = await textractClient.send(command);

    // Extract all text from LINE blocks
    const lines =
      response.Blocks?.filter((block) => block.BlockType === "LINE")
        .map((block) => block.Text)
        .filter((text) => text) || [];

    const extractedText = lines.join("\n");

    console.log("Textract extracted text length:", extractedText.length);
    console.log("Textract sample:", extractedText.substring(0, 200));

    return extractedText;
  } catch (error: any) {
    console.error("Textract AnalyzeDocument failed:", error.message);
    throw new Error(`Textract extraction failed: ${error.message}`);
  }
}

// Main function: downloads file (image/PDF), uploads to S3, and extracts text
export async function extractTextFromFile(
  fileUrl: string,
  messageId: string,
  contentType: string,
  fileName: string,
  slackToken: string,
): Promise<string> {
  console.log("=== START Textract File Processing ===");
  console.log("File URL:", fileUrl);
  console.log("Message ID:", messageId);
  console.log("Content Type:", contentType);
  console.log("File Name:", fileName);

  try {
    // Download file from Slack
    const fileBuffer = await downloadFileFromSlack(fileUrl, slackToken);

    // Upload to S3
    const s3Key = await uploadFileToS3(
      fileBuffer,
      messageId,
      contentType,
      fileName,
    );

    // Extract text using Textract
    const extractedText = await extractTextFromS3File(s3Key);

    if (!extractedText || extractedText.trim().length === 0) {
      console.warn("Textract returned no text");
      return "";
    }

    console.log("=== END Textract Processing (SUCCESS) ===");
    return extractedText;
  } catch (error: any) {
    console.error("=== ERROR in Textract Processing ===");
    console.error("Error:", error);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    throw error;
  }
}

// Legacy function name for backwards compatibility
export async function extractTextFromImage(
  imageUrl: string,
  messageId: string,
  contentType: string,
  slackToken: string,
): Promise<string> {
  return extractTextFromFile(imageUrl, messageId, contentType, "", slackToken);
}
