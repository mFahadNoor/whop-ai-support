import { makeWebhookValidator } from "@whop/api";
import type { NextRequest } from "next/server";

const validateWebhook = makeWebhookValidator({
	webhookSecret: process.env.WHOP_WEBHOOK_SECRET ?? "fallback",
});

export async function POST(request: NextRequest): Promise<Response> {
	// Validate the webhook to ensure it's from Whop
	const webhookData = await validateWebhook(request);

	// Handle webhook events - this is where you'd process Whop events
	// For example: payment successes, membership changes, etc.
	if (webhookData.action === "payment.succeeded") {
		const { id, final_amount, currency, user_id } = webhookData.data;

		console.log(
			`💳 Payment ${id} succeeded for user ${user_id}: ${final_amount} ${currency}`,
		);

		// Here you could update your database, send notifications, etc.
		// For this tutorial, we'll just log it
	}

	// Always return success quickly to avoid webhook retries
	return new Response("OK", { status: 200 });
}
