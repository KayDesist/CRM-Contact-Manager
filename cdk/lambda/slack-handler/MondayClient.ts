import { ContactInfo } from "./types";

const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN!;
const MONDAY_BOARD_ID = process.env.MONDAY_BOARD_ID!;

// Send contact to Monday.com board
export async function sendToMonday(contact: ContactInfo): Promise<string> {
  const fullName =
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    "New Contact";
  console.log("Sending contact to Monday.com:", fullName);

  if (!MONDAY_API_TOKEN) {
    throw new Error("MONDAY_API_TOKEN environment variable is not set!");
  }
  if (!MONDAY_BOARD_ID) {
    throw new Error("MONDAY_BOARD_ID environment variable is not set!");
  }

  try {
    const columnValues: any = {};

    if (contact.firstName) {
      columnValues["first_name__1"] = contact.firstName;
    }
    if (contact.lastName) {
      columnValues["last_name__1"] = contact.lastName;
    }
    if (contact.company) {
      columnValues["company_name__1"] = contact.company;
    }

    // Map contact to appropriate Monday.com status
    // Default to "Lead" for new contacts
    let statusLabel = "Lead";

    // If title suggests senior position, mark as "Qualified Lead"
    if (contact.title) {
      const seniorTitles = [
        "ceo",
        "cto",
        "cfo",
        "coo",
        "president",
        "vp",
        "vice president",
        "director",
        "partner",
        "owner",
        "founder",
      ];
      const titleWords = contact.title.toLowerCase().split(" ");
      const isSenior = seniorTitles.some((title) =>
        title.includes(" ")
          ? contact.title.toLowerCase().includes(title)
          : titleWords.includes(title),
      );
      if (isSenior) {
        statusLabel = "Qualified Lead";
      }
    }

    columnValues["status"] = { label: statusLabel };

    // Map priority to status5 column if available
    if (contact.priority) {
      columnValues["status5"] = { label: contact.priority };
    }

    // Initialize notes array (used for phone validation and other fields)
    const notesArray: string[] = [];

    // Validate and add primary phone number
    if (contact.phone) {
      // Clean phone number - keep only digits
      const cleanPhone = contact.phone
        .split("")
        .filter((char) => char >= "0" && char <= "9")
        .join("");

      // Validate phone number length (7-15 digits is reasonable)
      if (cleanPhone.length >= 7 && cleanPhone.length <= 15) {
        columnValues["contact_phone"] = {
          phone: cleanPhone,
          countryShortName: "US",
        };
        console.log(
          `Valid primary phone: ${cleanPhone} (${cleanPhone.length} digits)`,
        );
      } else {
        console.log(
          `Skipping invalid primary phone: ${cleanPhone} (${cleanPhone.length} digits - outside 7-15 range)`,
        );
        // Add to notes instead
        if (contact.phone) {
          notesArray.push(`Phone (invalid format): ${contact.phone}`);
        }
      }
    }
    if (contact.email) {
      columnValues["contact_email"] = {
        email: contact.email,
        text: contact.email,
      };
    }

    // Add job title, additional phones, and notes to notes field
    if (contact.title) {
      notesArray.push(`Title: ${contact.title}`);
    }
    if (contact.additionalPhones) {
      notesArray.push(`Additional phones: ${contact.additionalPhones}`);
    }
    if (contact.notes) {
      notesArray.push(contact.notes);
    }
    if (notesArray.length > 0) {
      // Long text columns should be plain strings, not objects
      columnValues["long_text4"] = notesArray.join("\n\n");
    }

    const safeName = escapeString(fullName);

    // Log individual values for debugging
    console.log("=== Monday.com Payload Debug ===");
    console.log("Board ID:", MONDAY_BOARD_ID);
    console.log("Item Name:", safeName);
    console.log("Column Values Object:", JSON.stringify(columnValues, null, 2));
    console.log("Stringified Column Values:", JSON.stringify(columnValues));

    const mutation = `mutation {
      create_item (
        board_id: ${MONDAY_BOARD_ID},
        item_name: "${safeName}",
        column_values: ${JSON.stringify(JSON.stringify(columnValues))}
      ) {
        id
        name
        board {
          id
          name
        }
      }
    }`;

    console.log("Full GraphQL Mutation:", mutation);

    const response = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        Authorization: MONDAY_API_TOKEN,
        "Content-Type": "application/json",
        "API-Version": "2024-10",
      },
      body: JSON.stringify({ query: mutation }),
    });

    const data: any = await response.json();

    console.log("Monday.com raw response:", JSON.stringify(data, null, 2));

    if (data.errors) {
      const errorMsg = data.errors[0]?.message || JSON.stringify(data.errors);
      console.error("=== Monday.com API Error ===");
      console.error("Error message:", errorMsg);
      console.error("Full error object:", JSON.stringify(data.errors, null, 2));
      console.error(
        "Column values that caused error:",
        JSON.stringify(columnValues, null, 2),
      );

      if (errorMsg.includes("authentication") || errorMsg.includes("token")) {
        throw new Error(
          "Monday.com authentication failed. Check your MONDAY_API_TOKEN.",
        );
      } else if (errorMsg.includes("board")) {
        throw new Error(
          `Board not found. Check your MONDAY_BOARD_ID (${MONDAY_BOARD_ID}).`,
        );
      } else if (errorMsg.includes("column")) {
        throw new Error(`Column error: ${errorMsg}`);
      } else {
        throw new Error(`Monday.com error: ${errorMsg}`);
      }
    }

    const itemId = data.data?.create_item?.id;

    if (!itemId) {
      throw new Error("No item ID returned from Monday.com");
    }

    console.log("Successfully created Monday.com item:", itemId);
    return itemId;
  } catch (error: any) {
    console.error("Monday.com error:", error.message);
    throw error;
  }
}

// Escape special characters for GraphQL strings
function escapeString(str: string): string {
  const escapeMap: Record<string, string> = {
    "\\": "\\\\",
    '"': '\\"',
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
  };

  return str
    .split("")
    .map((char) => escapeMap[char] ?? char)
    .join("");
}
