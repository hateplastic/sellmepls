export type ChatMessage = {
  id: number;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};
export const MESSAGE_COLUMNS = "id,conversation_id,sender_id,body,created_at";
