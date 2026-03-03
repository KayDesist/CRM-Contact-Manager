import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { StoredContact, FinalStatusRecord, ContactInfo } from "./types";
import { randomUUID } from "crypto";

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-2",
});
const dynamodb = DynamoDBDocumentClient.from(client);

const CONTACTS_TABLE = process.env.CONTACTS_TABLE || "SlackContacts";
const FINAL_STATUS_TABLE =
  process.env.FINAL_STATUS_TABLE || "ContactsFinalStatus";

// Save a Contact (Temporarily)
// Auto-deletes after 24 hours if the user doesn't respond
export async function saveContact(
  messageId: string,
  contactData: ContactInfo & {
    channel: string;
    original_message: string;
    user_id: string;
  },
): Promise<void> {
  try {
    const ttl = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

    await dynamodb.send(
      new PutCommand({
        TableName: CONTACTS_TABLE,
        Item: {
          message_id: messageId,
          ...contactData,
          status: "pending",
          ttl: ttl,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }),
    );

    console.log("Saved contact to database");
  } catch (error: any) {
    console.error("Error saving contact:", error);
    throw error;
  }
}

// Get a Specific Contact by its primary key (returns ALL fields)
export async function getContact(
  messageId: string,
): Promise<StoredContact | null> {
  try {
    const result = await dynamodb.send(
      new GetCommand({
        TableName: CONTACTS_TABLE,
        Key: { message_id: messageId },
      }),
    );

    if (!result.Item) {
      return null;
    }

    return result.Item as StoredContact;
  } catch (error: any) {
    console.error("Error getting contact:", error);
    throw error;
  }
}

// Get Pending Contact for User
// Query the GSI to find the message_id
// Use the message_id to do a full GetItem lookup (returns ALL fields)
// This avoids the GSI projection limitation where only certain fields were returned
export async function getPendingContactForUser(
  userId: string,
  channel: string,
): Promise<StoredContact | null> {
  try {
    // Query the GSI to find the matching message_id
    const result = await dynamodb.send(
      new QueryCommand({
        TableName: CONTACTS_TABLE,
        IndexName: "UserChannelIndex",
        KeyConditionExpression: "user_id = :userId AND channel = :channel",
        FilterExpression: "#status = :pending OR #status = :editing",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":userId": userId,
          ":channel": channel,
          ":pending": "pending",
          ":editing": "editing",
        },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    // The GSI only returns projected fields, but GetItem always returns everything
    const messageId = result.Items[0].message_id;
    console.log("Found pending contact, fetching full record for:", messageId);

    return await getContact(messageId);
  } catch (error: any) {
    console.error("Error finding pending contact:", error);
    return null;
  }
}

// Update Contact Fields
export async function updateContact(
  messageId: string,
  updates: Partial<ContactInfo>,
): Promise<void> {
  try {
    const updateParts: string[] = [];
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, any> = {};

    Object.entries(updates).forEach(([key, value], index) => {
      const nameKey = `#field${index}`;
      const valueKey = `:val${index}`;

      updateParts.push(`${nameKey} = ${valueKey}`);
      expressionNames[nameKey] = key;
      expressionValues[valueKey] = value;
    });

    updateParts.push("#updated_at = :updated_at");
    expressionNames["#updated_at"] = "updated_at";
    expressionValues[":updated_at"] = new Date().toISOString();

    await dynamodb.send(
      new UpdateCommand({
        TableName: CONTACTS_TABLE,
        Key: { message_id: messageId },
        UpdateExpression: `SET ${updateParts.join(", ")}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
      }),
    );

    console.log("Updated contact");
  } catch (error: any) {
    console.error("Error updating contact:", error);
    throw error;
  }
}

// Delete Contact (after yes/no response)
export async function deleteContact(messageId: string): Promise<void> {
  try {
    await dynamodb.send(
      new DeleteCommand({
        TableName: CONTACTS_TABLE,
        Key: { message_id: messageId },
      }),
    );

    console.log("Deleted contact from pending table");
  } catch (error: any) {
    console.error("Error deleting contact:", error);
    throw error;
  }
}

// Save Final Status (permanent record for reporting/debugging)
export async function saveFinalStatus(
  contact: StoredContact,
  mondayItemId: string,
  slackUserId: string,
  status: "SUCCESS" | "FAILED" = "SUCCESS",
  errorMessage?: string,
): Promise<void> {
  try {
    const record: FinalStatusRecord = {
      contactId: randomUUID(),
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      company: contact.company,
      title: contact.title,
      priority: contact.priority,
      linkedin: contact.linkedin,
      notes: contact.notes,
      mondayItemId: mondayItemId,
      status: status,
      processedAt: new Date().toISOString(),
      slackUserId: slackUserId,
      slackChannelId: contact.channel,
      originalMessageId: contact.message_id,
      errorMessage: errorMessage,
    };

    await dynamodb.send(
      new PutCommand({
        TableName: FINAL_STATUS_TABLE,
        Item: record,
      }),
    );

    console.log("Saved final status to permanent table");
  } catch (error: any) {
    console.error("Error saving final status:", error);
  }
}
