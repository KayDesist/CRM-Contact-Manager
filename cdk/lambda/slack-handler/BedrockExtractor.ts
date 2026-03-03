import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { ContactInfo, EditRequest } from "./types";

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "us-east-2",
});

// Prompt that tells Claude AI how to extract contact info from text
const CONTACT_EXTRACTION_PROMPT = `You are a contact information extraction assistant. Extract contact details from messages and return them in JSON format.

Return ONLY a JSON object with these fields (use null if not found):
{
  "firstName": "First name",
  "lastName": "Last name",
  "email": "Email address",
  "phone": "Primary phone number (mobile or direct line preferred)",
  "additionalPhones": "Other phone numbers if multiple are present (comma-separated)",
  "company": "Company name",
  "title": "Job title/role",
  "priority": "Priority level (High, Medium, or Low)",
  "linkedin": "LinkedIn URL",
  "notes": "Any other relevant information"
}

Rules:
- Be accurate - only extract information that is clearly stated
- If no contact info found, return {"firstName": null}
- Do not include any markdown formatting or code blocks
- For priority, look for keywords like urgent, important, high priority, asap (High), normal, standard (Medium), or low priority, not urgent (Low)

Examples:
Input: "Met John Smith from Acme Corp, email john@acme.com"
Output: {"firstName": "John", "lastName": "Smith", "email": "john@acme.com", "phone": null, "additionalPhones": null, "company": "Acme Corp", "title": null, "priority": null, "linkedin": null, "notes": null}

Input: "Just chatted about the weather"
Output: {"firstName": null}

Input: "Sarah Johnson, VP of Sales at TechCorp, urgent callback needed - sarah.j@techcorp.com, phones: 555-1234, 555-5678"
Output: {"firstName": "Sarah", "lastName": "Johnson", "email": "sarah.j@techcorp.com", "phone": "555-1234", "additionalPhones": "555-5678", "company": "TechCorp", "title": "VP of Sales", "priority": "High", "linkedin": null, "notes": "urgent callback needed"}`;

// Prompt that tells Claude AI how to understand edit commands
const EDIT_EXTRACTION_PROMPT = `You are a field update assistant. Extract which field to update and its new value.

IMPORTANT: If the user says "name" (without specifying first/last), you should split it into firstName and lastName.

For single field updates, return:
{
  "field": "firstName|lastName|email|phone|company|title|priority|linkedin|notes",
  "value": "new value"
}

For "name" updates (which should update BOTH firstName and lastName), return:
{
  "fields": [
    {"field": "firstName", "value": "first part"},
    {"field": "lastName", "value": "last part"}
  ]
}

Examples:
Input: "Edit email to john@newdomain.com"
Output: {"field": "email", "value": "john@newdomain.com"}

Input: "Change company to TechCorp"
Output: {"field": "company", "value": "TechCorp"}

Input: "Set priority to High"
Output: {"field": "priority", "value": "High"}

Input: "Update first name to Michael"
Output: {"field": "firstName", "value": "Michael"}

Input: "Edit name to Jane Dah"
Output: {"fields": [{"field": "firstName", "value": "Jane"}, {"field": "lastName", "value": "Dah"}]}

Input: "Change name to Michael Jordan"
Output: {"fields": [{"field": "firstName", "value": "Michael"}, {"field": "lastName", "value": "Jordan"}]}

Input: "Update the name to Sarah Smith"
Output: {"fields": [{"field": "firstName", "value": "Sarah"}, {"field": "lastName", "value": "Smith"}]}`;

// Use Claude AI to extract contact info from a message
export async function extractContactInfo(
  text: string,
): Promise<ContactInfo | null> {
  try {
    console.log("Asking AI to extract contact info...");

    // Send the text to Claude AI
    const response = await bedrockClient.send(
      new ConverseCommand({
        modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        messages: [
          {
            role: "user",
            content: [
              {
                text: `${CONTACT_EXTRACTION_PROMPT}\n\nNow extract contact information from this message:\n\n${text}`,
              },
            ],
          },
        ],
        inferenceConfig: {
          maxTokens: 500,
          temperature: 0.1,
        },
      }),
    );

    // Get the AI's response
    const assistantMessage = response.output?.message;
    const textContent = assistantMessage?.content
      ?.filter((c: any) => c.text)
      .map((c: any) => c.text)
      .join("");

    if (!textContent) {
      return null;
    }

    // Clean up response (remove code blocks if present)
    let cleanJson = textContent.trim();
    if (cleanJson.includes("```json")) {
      cleanJson = cleanJson.split("```json")[1];
    }
    if (cleanJson.includes("```")) {
      cleanJson = cleanJson.split("```")[0];
    }
    cleanJson = cleanJson.trim();

    const contact = JSON.parse(cleanJson);

    // If no firstName, not a valid contact
    if (!contact.firstName) {
      console.log("No firstName found, returning null");
      return null;
    }

    // Remove null values
    const cleanedContact: ContactInfo = {};
    for (const key in contact) {
      if (
        contact[key] !== null &&
        contact[key] !== "null" &&
        contact[key] !== ""
      ) {
        cleanedContact[key as keyof ContactInfo] = contact[key];
      }
    }

    return cleanedContact;
  } catch (error: any) {
    console.error("AI extraction error:", error.message);
    return null;
  }
}

// Use Claude AI to understand which field the user wants to edit
export async function extractEditRequest(
  text: string,
): Promise<EditRequest | null> {
  try {
    console.log("Asking AI to understand edit command...");

    // Send the edit command to Claude AI
    const response = await bedrockClient.send(
      new ConverseCommand({
        modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        messages: [
          {
            role: "user",
            content: [
              {
                text: `${EDIT_EXTRACTION_PROMPT}\n\nExtract the field and value from:\n\n${text}`,
              },
            ],
          },
        ],
        inferenceConfig: {
          maxTokens: 200,
          temperature: 0.1,
        },
      }),
    );

    // Get the AI's response
    const assistantMessage = response.output?.message;
    const textContent = assistantMessage?.content
      ?.filter((c: any) => c.text)
      .map((c: any) => c.text)
      .join("");

    if (!textContent) {
      return null;
    }

    // Clean up response
    let cleanJson = textContent.trim();
    if (cleanJson.includes("```json")) {
      cleanJson = cleanJson.split("```json")[1];
    }
    if (cleanJson.includes("```")) {
      cleanJson = cleanJson.split("```")[0];
    }
    cleanJson = cleanJson.trim();

    const editRequest = JSON.parse(cleanJson);

    // Validate: must have either (field + value) OR (fields array)
    const hasSingleField = editRequest.field && editRequest.value;
    const hasMultipleFields =
      editRequest.fields &&
      Array.isArray(editRequest.fields) &&
      editRequest.fields.length > 0;

    if (!hasSingleField && !hasMultipleFields) {
      return null;
    }

    return editRequest;
  } catch (error: any) {
    console.error("Error extracting edit request:", error);
    return null;
  }
}

// Prompt for Claude Vision to analyze business cards and images
const VISION_EXTRACTION_PROMPT = `You are an expert at analyzing business cards and contact information documents.

Carefully examine this image and extract ALL contact information you can find. Pay special attention to:
- Visual layout and card design (logos, icons, positioning)
- Names and titles
- Email addresses and phone numbers
- Company names and addresses
- Social media handles (LinkedIn, Twitter, etc.)
- Websites and URLs
- Any other contact details

Return ONLY a JSON object with these fields (use null if not found):
{
  "firstName": "First name",
  "lastName": "Last name",
  "email": "Email address",
  "phone": "Primary phone number (usually mobile or direct line)",
  "additionalPhones": "Secondary phone numbers if multiple exist (comma-separated, e.g., 'Office: 555-1234, Fax: 555-5678')",
  "company": "Company name",
  "title": "Job title/role",
  "priority": "Priority level (High, Medium, or Low)",
  "linkedin": "LinkedIn URL",
  "notes": "Any other relevant information like address, website, etc."
}

Rules:
- Be accurate - only extract information that is clearly visible
- For business cards, infer the priority based on the person's title (C-level/VP = High, Director/Manager = Medium, Others = Low)
- If you see a website but no email, note the website in the notes field
- If no contact info is found, return {"firstName": null}
- Do not include any markdown formatting or code blocks in your response`;

// Downloads file from Slack
async function downloadFileFromSlack(
  fileUrl: string,
  slackToken: string,
): Promise<Buffer> {
  console.log("Vision: Downloading file from Slack");

  const response = await fetch(fileUrl, {
    headers: {
      Authorization: `Bearer ${slackToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Use Claude Vision to extract contact info from an image or PDF
export async function extractContactFromVision(
  fileUrl: string,
  contentType: string,
  slackToken: string,
): Promise<ContactInfo | null> {
  console.log("=== START Claude Vision Processing ===");
  console.log("File URL:", fileUrl);
  console.log("Content Type:", contentType);

  try {
    // Download the file
    const fileBuffer = await downloadFileFromSlack(fileUrl, slackToken);
    console.log("File downloaded, size:", fileBuffer.length, "bytes");

    // Determine media type for Claude
    let mediaType = "image/jpeg";
    if (contentType.includes("png")) {
      mediaType = "image/png";
    } else if (contentType.includes("webp")) {
      mediaType = "image/webp";
    } else if (contentType.includes("pdf")) {
      mediaType = "application/pdf";
    }

    console.log("Sending to Claude Vision with media type:", mediaType);

    // Send to Claude with vision
    const response = await bedrockClient.send(
      new ConverseCommand({
        modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        messages: [
          {
            role: "user",
            content: [
              {
                image: {
                  format: mediaType.split("/")[1] as any,
                  source: {
                    bytes: fileBuffer,
                  },
                },
              },
              {
                text: VISION_EXTRACTION_PROMPT,
              },
            ],
          },
        ],
        inferenceConfig: {
          maxTokens: 1000,
          temperature: 0.1,
        },
      }),
    );

    // Get the AI's response
    const assistantMessage = response.output?.message;
    const textContent = assistantMessage?.content
      ?.filter((c: any) => c.text)
      .map((c: any) => c.text)
      .join("");

    if (!textContent) {
      console.log("Vision: No response from Claude");
      return null;
    }

    // Clean up response (remove code blocks if present)
    let cleanJson = textContent.trim();
    if (cleanJson.includes("```json")) {
      cleanJson = cleanJson.split("```json")[1];
    }
    if (cleanJson.includes("```")) {
      cleanJson = cleanJson.split("```")[0];
    }
    cleanJson = cleanJson.trim();

    console.log("Vision: Parsing Claude response");
    const contact = JSON.parse(cleanJson);

    // If no firstName, not a valid contact
    if (!contact.firstName) {
      console.log("Vision: No firstName found, returning null");
      return null;
    }

    // Remove null values
    const cleanedContact: ContactInfo = {};
    for (const key in contact) {
      if (
        contact[key] !== null &&
        contact[key] !== "null" &&
        contact[key] !== ""
      ) {
        cleanedContact[key as keyof ContactInfo] = contact[key];
      }
    }

    console.log(
      "Vision: Successfully extracted contact:",
      cleanedContact.firstName,
    );
    console.log("=== END Claude Vision Processing (SUCCESS) ===");
    return cleanedContact;
  } catch (error: any) {
    console.error("=== ERROR in Vision Processing ===");
    console.error("Error:", error);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    return null; // Don't throw, just return null so we can fall back to Textract
  }
}
