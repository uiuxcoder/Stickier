import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
	email: text("email").primaryKey(),
	stripeCustomerId: text("stripe_customer_id"),
	regenerationsRemaining: integer("regenerations_remaining").notNull().default(0),
	createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const subscriptions = sqliteTable("subscriptions", {
	stripeSubscriptionId: text("stripe_subscription_id").primaryKey(),
	email: text("email").notNull(),
	status: text("status").notNull(),
	currentPeriodEnd: integer("current_period_end"),
	createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const orders = sqliteTable("orders", {
	id: text("id").primaryKey(),
	email: text("email").notNull(),
	stripeSessionId: text("stripe_session_id").notNull().unique(),
	kind: text("kind").notNull(),
	subject: text("subject").notNull(),
	imageKey: text("image_key").notNull(),
	amount: integer("amount").notNull(),
	createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
