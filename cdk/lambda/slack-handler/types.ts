// Simple type definitions for the contact manager
export interface ContactInfo {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string; // Primary phone number
  additionalPhones?: string; // Secondary phone numbers (comma-separated or formatted)
  company?: string;
  title?: string;
  priority?: string; // High, Medium, Low
  linkedin?: string;
  notes?: string;
}

export interface StoredContact extends ContactInfo {
  message_id: string;
  channel: string;
  user_id: string; // Added to track which user created this contact
  original_message: string;
  status: "pending" | "editing" | "approved" | "rejected";
  ttl: number;
  created_at: string;
  updated_at: string;
}

export interface FinalStatusRecord extends ContactInfo {
  contactId: string;
  mondayItemId: string;
  status: "SUCCESS" | "FAILED";
  processedAt: string;
  slackUserId: string;
  slackChannelId: string;
  originalMessageId: string;
  errorMessage?: string;
}

export interface SlackEvent {
  type: string;
  channel: string;
  user: string;
  text: string;
  ts: string;
  bot_id?: string;
  files?: SlackFile[];
}

export interface SlackFile {
  id: string;
  name: string;
  mimetype: string;
  url_private: string;
  size: number;
  filetype?: string; // e.g., "pdf", "png", "jpg"
}

export interface EditRequest {
  field?: string;
  value?: string;
  fields?: Array<{ field: string; value: string }>;
}
