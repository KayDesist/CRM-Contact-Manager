import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import crypto from "crypto";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  extractContactInfo,
  extractContactFromVision,
  extractEditRequest,
} from "./BedrockExtractor";
import {
  saveContact,
  getPendingContactForUser,
  updateContact,
  deleteContact,
  saveFinalStatus,
} from "./ContactStorage";
import {
  sendSlackMessage,
  createContactPreviewBlocks,
  createSuccessBlocks,
  createErrorBlocks,
} from "./SlackClient";
import { sendToMonday } from "./MondayClient";
import { SlackEvent, ContactInfo } from "./types";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN!;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET!;

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "us-east-2",
});

// ============================================================================
// AI ASSISTANT HELPER
// ============================================================================

async function askClaudeForHelp(
  userMessage: string,
  systemPrompt: string,
): Promise<string> {
  try {
    const response = await bedrockClient.send(
      new ConverseCommand({
        modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        system: [{ text: systemPrompt }],
        messages: [
          {
            role: "user",
            content: [{ text: userMessage }],
          },
        ],
        inferenceConfig: {
          maxTokens: 2000,
          temperature: 0.7,
        },
      }),
    );

    const assistantMessage = response.output?.message;
    const textContent = assistantMessage?.content
      ?.filter((c: any) => c.text)
      .map((c: any) => c.text)
      .join("");

    return textContent || "Sorry, I couldn't generate a response.";
  } catch (error: any) {
    console.error("Claude error:", error);
    return `Sorry, I encountered an error: ${error.message}`;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function ok(body: object): APIGatewayProxyResult {
  return { statusCode: 200, body: JSON.stringify(body) };
}

function unauthorized(): APIGatewayProxyResult {
  return {
    statusCode: 401,
    body: JSON.stringify({ error: "Invalid signature" }),
  };
}

function verifySlackRequest(event: APIGatewayProxyEvent): boolean {
  const signature =
    event.headers["x-slack-signature"] || event.headers["X-Slack-Signature"];
  const timestamp =
    event.headers["x-slack-request-timestamp"] ||
    event.headers["X-Slack-Request-Timestamp"];
  const body = event.body || "";

  if (!signature || !timestamp) {
    console.log("Missing signature or timestamp");
    return false;
  }

  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp)) > 60 * 5) {
    console.log("Request too old");
    return false;
  }

  const sigBasestring = "v0:" + timestamp + ":" + body;
  const mySignature =
    "v0=" +
    crypto
      .createHmac("sha256", SLACK_SIGNING_SECRET)
      .update(sigBasestring)
      .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(mySignature),
    Buffer.from(signature),
  );
}

// ============================================================================
// MAIN MESSAGE HANDLER
// ============================================================================

async function handleSlackMessage(event: SlackEvent): Promise<void> {
  console.log("=== Processing Slack Message ===");
  console.log("User:", event.user, "Channel:", event.channel);

  const messageText = (event.text || "").toLowerCase().trim();
  const channel = event.channel;
  const messageId = event.ts;
  const userId = event.user;
  const files = event.files || [];

  try {
    //Check if user has a pending contact
    const pendingContact = await getPendingContactForUser(userId, channel);

    //Handle response to pending contact
    if (pendingContact) {
      console.log("User has pending contact, handling response");

      // User approves
      if (messageText.match(/^(yes|y|approve|approved|send|ok|looks good)$/i)) {
        console.log("User approved contact");

        try {
          const mondayItemId = await sendToMonday(pendingContact);
          await deleteContact(pendingContact.message_id);

          const fullName =
            `${pendingContact.firstName || ""} ${pendingContact.lastName || ""}`.trim();
          await sendSlackMessage(
            channel,
            createSuccessBlocks(fullName),
            "Success!",
          );

          await saveFinalStatus(
            pendingContact,
            mondayItemId,
            userId,
            "SUCCESS",
          );
        } catch (error: any) {
          console.error("Error sending to Monday:", error);
          await sendSlackMessage(
            channel,
            createErrorBlocks(`Failed to send to Monday.com: ${error.message}`),
            "Error",
          );
          await saveFinalStatus(
            pendingContact,
            "",
            userId,
            "FAILED",
            error.message,
          );
        }
        return;
      }

      // User rejects
      if (messageText.match(/^(no|n|reject|cancel|delete|discard)$/i)) {
        console.log("User rejected contact");
        await deleteContact(pendingContact.message_id);
        await sendSlackMessage(
          channel,
          [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "Contact discarded. Send me new contact information anytime!",
              },
            },
          ],
          "Contact discarded",
        );
        return;
      }

      // User wants to edit: check if they provided field and value
      if (messageText.match(/^(edit|change|update|modify)/i)) {
        console.log("User wants to edit contact");

        // Try to extract what they want to edit
        const editRequest = await extractEditRequest(event.text);

        if (editRequest) {
          // Handle single field update
          if (editRequest.field && editRequest.value) {
            console.log(
              `Editing ${editRequest.field} to: ${editRequest.value}`,
            );

            // Update the contact in database
            await updateContact(pendingContact.message_id, {
              [editRequest.field]: editRequest.value,
            });

            // Fetch the updated contact and show new preview
            const updatedContact = await getPendingContactForUser(
              userId,
              channel,
            );

            if (updatedContact) {
              await sendSlackMessage(
                channel,
                [
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text: `Updated *${editRequest.field}* to: ${editRequest.value}`,
                    },
                  },
                  {
                    type: "divider",
                  },
                  ...createContactPreviewBlocks(updatedContact),
                ],
                "Contact Updated",
              );
            }
            return;
          }

          // Handle multiple field updates (e.g., full name split into firstName and lastName)
          if (editRequest.fields && editRequest.fields.length > 0) {
            console.log(`Editing multiple fields:`, editRequest.fields);

            // Build update object with all fields
            const updates: Record<string, string> = {};
            for (const fieldUpdate of editRequest.fields) {
              updates[fieldUpdate.field] = fieldUpdate.value;
            }

            // Update the contact in database
            await updateContact(pendingContact.message_id, updates);

            // Fetch the updated contact and show new preview
            const updatedContact = await getPendingContactForUser(
              userId,
              channel,
            );

            if (updatedContact) {
              // Build update message
              const updateSummary = editRequest.fields
                .map((f) => `*${f.field}* to: ${f.value}`)
                .join("\n• ");

              await sendSlackMessage(
                channel,
                [
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text: `Updated:\n• ${updateSummary}`,
                    },
                  },
                  {
                    type: "divider",
                  },
                  ...createContactPreviewBlocks(updatedContact),
                ],
                "Contact Updated",
              );
            }
            return;
          }
        }

        // They just said "edit" without specifying what to change
        await sendSlackMessage(
          channel,
          [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "To edit, please specify the field and new value:\n\n*Examples:*\n• `edit name to Jane Smith`\n• `edit email to john@example.com`\n• `change company to TechCorp`\n• `update phone to 555-1234`\n\nOr type:\n• `no` to discard this contact\n• `yes` to approve as-is",
              },
            },
          ],
          "Edit Instructions",
        );
        return;
      }

      // Unknown response to pending contact
      const aiResponse = await askClaudeForHelp(
        `The user has a pending contact waiting for approval. They said: "${event.text}"\n\nPlease remind them to respond with 'yes' to approve, 'no' to reject, or 'edit' to make changes.`,
        "You are a helpful CRM assistant. Be friendly and guide the user to respond appropriately.",
      );
      await sendSlackMessage(
        channel,
        [
          {
            type: "section",
            text: { type: "mrkdwn", text: aiResponse },
          },
        ],
        "Reminder",
      );
      return;
    }

    // Step 3: No pending contact - extract new contact info
    console.log("No pending contact, attempting to extract new contact");

    let extractedContact: ContactInfo | null = null;

    // Try extracting from text
    if (event.text && event.text.length > 5) {
      console.log("Extracting from text");
      extractedContact = await extractContactInfo(event.text);
    }

    // Try extracting from images/PDFs
    if (!extractedContact && files && files.length > 0) {
      console.log("Extracting from files");
      for (const file of files) {
        if (
          file.mimetype.startsWith("image/") ||
          file.mimetype === "application/pdf"
        ) {
          try {
            extractedContact = await extractContactFromVision(
              file.url_private,
              file.mimetype,
              SLACK_BOT_TOKEN,
            );
            if (extractedContact) break;
          } catch (error: any) {
            console.error("Error extracting from file:", error);
          }
        }
      }
    }

    // Step 4: If contact found, save and show preview
    if (extractedContact && extractedContact.firstName) {
      console.log(
        "Contact extracted successfully:",
        extractedContact.firstName,
      );

      await saveContact(messageId, {
        ...extractedContact,
        channel,
        user_id: userId,
        original_message: event.text || "",
      });

      await sendSlackMessage(
        channel,
        createContactPreviewBlocks(extractedContact),
        "Contact Information Found",
      );
      return;
    }

    // Step 5: No contact found - use AI to respond conversationally
    console.log("No contact info found, asking Claude for help");
    const aiResponse = await askClaudeForHelp(
      `User message: "${event.text}"\n\nI couldn't find any contact information in this message. Please respond helpfully.`,
      "You are a CRM Contact Manager assistant. Help users understand that you extract contact information from messages and images. If they didn't provide contact info, politely explain what you do and ask them to share contact details (name, email, phone, company, etc.) or upload a business card image.",
    );

    await sendSlackMessage(
      channel,
      [
        {
          type: "section",
          text: { type: "mrkdwn", text: aiResponse },
        },
      ],
      "Response",
    );
  } catch (error: any) {
    console.error("=== Handler Error ===");
    console.error("Error:", error.message);

    try {
      await sendSlackMessage(
        channel,
        createErrorBlocks(`Sorry, I encountered an error: ${error.message}`),
        "Error",
      );
    } catch (slackError) {
      console.error("Failed to send error to Slack:", slackError);
    }
  }
}

// ============================================================================
// LAMBDA HANDLER
// ============================================================================

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || "{}");

    // Handle Slack URL verification
    if (body.type === "url_verification") {
      console.log("URL verification request");
      return {
        statusCode: 200,
        headers: { "Content-Type": "text/plain" },
        body: body.challenge,
      };
    }

    // Ignore Slack retries
    const retryNum =
      event.headers["x-slack-retry-num"] || event.headers["X-Slack-Retry-Num"];
    if (retryNum) {
      console.log("Ignoring Slack retry attempt:", retryNum);
      return ok({ message: "Ignoring retry" });
    }

    // Verify request is from Slack
    if (!verifySlackRequest(event)) {
      console.error("Invalid signature - request not from Slack");
      return unauthorized();
    }

    // Handle message events
    if (body.type === "event_callback") {
      const slackEvent = body.event;

      if (slackEvent.bot_id) {
        console.log("Ignoring bot message");
        return ok({ message: "Ignored bot message" });
      }

      if (
        slackEvent.type === "message" &&
        (slackEvent.text || slackEvent.files)
      ) {
        console.log("Processing user message");
        await handleSlackMessage(slackEvent);
        return ok({ message: "Processed" });
      }

      console.log("Event type not handled:", slackEvent.type);
      return ok({ message: "Event received" });
    }

    console.log("Unknown request type:", body.type);
    return ok({ message: "Event received" });
  } catch (error: any) {
    console.error("Handler error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
