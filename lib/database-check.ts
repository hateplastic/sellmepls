import type { SupabaseClient } from "@supabase/supabase-js";

const columns: Record<string, string> = {
  users: "id,display_name,bio,evm_wallet,solana_wallet,tron_wallet",
  products:
    "id,affiliate_enabled,affiliate_bps,prices,preview_key,revision,category,gallery_keys,youtube_id,is_hidden,delivery_mode",
  sales:
    "id,fixed_fee,fee_bps,commission_version,affiliate_amount,quote_signature,chain_environment,quantity,unit_amount,reservation_released_at,solana_blockhashes,solana_first_slot",
  inventory_units: "id,product_id,sale_id,ciphertext,fingerprint",
  product_files: "product_id,object_key,sha256",
  uploads: "id,checksum,used",
  rate_limits: "key,hits,expires_at",
  affiliate_links: "id,code,user_id,seller_id,product_id,campaign",
  affiliate_clicks: "link_id,visitor_hash,day",
  reviews: "id,sale_id,rating,seller_reply",
  comments: "id,product_id,author_id,body",
  conversations: "id,product_id,buyer_id,seller_id",
  messages: "id,conversation_id,sender_id,client_id,body",
  payment_routers: "network,chain_environment,address,tx_hash",
  tron_identities: "address,user_id,login_email",
  wallet_challenges: "id,address,message,expires_at,used",
  product_reports: "id,product_id,reporter_id,reason,status",
  moderation_events: "id,product_id,admin_id,hidden,reason",
};

export async function checkDatabaseSchema(db: SupabaseClient) {
  const unavailable: string[] = [];
  for (const [table, fields] of Object.entries(columns)) {
    // GET limit=0 validates relations/columns without reading records. A HEAD
    // 404 has an empty body that PostgREST JS can normalize to a successful 204.
    const { error } = await db.from(table).select(fields).limit(0);
    if (error) unavailable.push(`${table} (${error.code || "request failed"})`);
  }
  if (unavailable.length)
    throw new Error(`Database schema unavailable: ${unavailable.join(", ")}`);
}
