// Raw WhatsApp Cloud API shapes (Meta Graph API). Only the adapter sees these.

export interface GraphErrorBody {
  error?: { message: string; type?: string; code?: number; fbtrace_id?: string };
}

export interface SendMessageResponse {
  messaging_product: "whatsapp";
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

/** Webhook POST body. Incoming messages sit at entry[].changes[].value.messages[]. */
export interface WebhookPayload {
  object: "whatsapp_business_account";
  entry: Array<{
    id: string;
    changes: Array<{
      field: string;
      value: {
        metadata?: { phone_number_id: string; display_phone_number: string };
        contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
        messages?: Array<{ id: string; from: string; timestamp: string; type: string; text?: { body: string } }>;
      };
    }>;
  }>;
}
