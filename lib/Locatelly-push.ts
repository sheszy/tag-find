import webpush from "web-push";
import { createHash } from "node:crypto";
import { supabaseRest } from "@/lib/Locatelly-backend";

type PushSubscriptionRow = {
  endpoint_hash: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function sendNearbyTagPush(
  latitude: number,
  longitude: number,
  itemName: string,
  url: string,
) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("Nearby push alerts are not configured on this server.");
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const recipients = await supabaseRest<PushSubscriptionRow[]>(
    "rpc/nearby_tag_push_subscriptions",
    {
      method: "POST",
      body: JSON.stringify({
        p_latitude: latitude,
        p_longitude: longitude,
        p_radius_km: 10,
      }),
    },
  );

  const sendToRecipient = async (recipient: PushSubscriptionRow) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: recipient.endpoint,
          keys: { p256dh: recipient.p256dh, auth: recipient.auth },
        },
        JSON.stringify({
          title: "Locatelly · nearby lost item",
          body: `${itemName} was reported lost nearby. If you see it, scan its QR tag.`,
          url,
        }),
      );
      return true;
    } catch (error) {
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : 0;
      if (statusCode === 404 || statusCode === 410) {
        await supabaseRest(
          `tag_push_subscriptions?endpoint_hash=eq.${createHash("sha256").update(recipient.endpoint).digest("hex")}`,
          { method: "DELETE" },
        );
        return false;
      }
      throw error;
    }
  };
  const results: PromiseSettledResult<boolean>[] = [];
  for (let index = 0; index < recipients.length; index += 25) {
    const batch = recipients.slice(index, index + 25);
    results.push(...await Promise.allSettled(batch.map(sendToRecipient)));
  }

  return {
    sent: results.filter(result => result.status === "fulfilled" && result.value).length,
    failed: results.filter(result => result.status === "rejected").length,
  };
}
