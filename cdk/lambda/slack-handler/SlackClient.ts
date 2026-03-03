import { ContactInfo } from "./types";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN!;

// Simple function to send a message to Slack
export async function sendSlackMessage(
  channel: string,
  blocks: any[],
  text: string = "",
): Promise<any> {
  console.log("Sending message to Slack channel:", channel);

  try {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: channel,
        blocks: blocks,
        text: text || "Message",
      }),
    });

    const data: any = await response.json();

    if (!data.ok) {
      console.error("Slack API error:", data.error);
      throw new Error(`Slack API error: ${data.error}`);
    }

    console.log("Message sent successfully");
    return data;
  } catch (error: any) {
    console.error("Error sending Slack message:", error);
    throw error;
  }
}

// Create a preview of the contact info for the user to review
export function createContactPreviewBlocks(contact: ContactInfo): any[] {
  const fields: any[] = [];

  // Build the contact info fields
  if (contact.firstName) {
    fields.push({
      type: "mrkdwn",
      text: `*First Name:*\n${contact.firstName}`,
    });
  }
  if (contact.lastName) {
    fields.push({ type: "mrkdwn", text: `*Last Name:*\n${contact.lastName}` });
  }
  if (contact.email) {
    fields.push({ type: "mrkdwn", text: `*Email:*\n${contact.email}` });
  }
  if (contact.phone) {
    fields.push({ type: "mrkdwn", text: `*Phone:*\n${contact.phone}` });
  }
  if (contact.company) {
    fields.push({ type: "mrkdwn", text: `*Company:*\n${contact.company}` });
  }
  if (contact.title) {
    fields.push({ type: "mrkdwn", text: `*Type:*\n${contact.title}` });
  }
  if (contact.priority) {
    fields.push({ type: "mrkdwn", text: `*Priority:*\n${contact.priority}` });
  }
  if (contact.linkedin) {
    fields.push({ type: "mrkdwn", text: `*LinkedIn:*\n${contact.linkedin}` });
  }
  if (contact.notes) {
    fields.push({ type: "mrkdwn", text: `*Notes:*\n${contact.notes}` });
  }

  // Show contact and ask user to type their response
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Contact Information Found",
      },
    },
    {
      type: "section",
      fields: fields,
    },
    {
      type: "divider",
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Should I add this to Monday.com?*\n\nType your response:\n• `yes` to approve\n• `no` to reject\n• `edit` to make changes",
      },
    },
  ];
}

// Success message
export function createSuccessBlocks(contactName: string): any[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Success!*\n\n*${contactName}* has been added to Monday.com!`,
      },
    },
  ];
}

// Error message with helpful debugging info
export function createErrorBlocks(errorMessage: string): any[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Error*\n\n${errorMessage}`,
      },
    },
  ];
}
