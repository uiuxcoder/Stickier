import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  email: text("email").primaryKey(),
  stripeCustomerId: text("stripe_customer_id"),
  regenerationsRemaining: integer("regenerations_remaining").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    stripeSubscriptionId: text("stripe_subscription_id").primaryKey(),
    email: text("email").notNull(),
    status: text("status").notNull(),
    currentPeriodEnd: integer("current_period_end"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("subscriptions_email_idx").on(table.email)],
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    stripeSessionId: text("stripe_session_id").notNull().unique(),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    imageKey: text("image_key").notNull(),
    amount: integer("amount").notNull(),
    emailSentAt: text("email_sent_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("orders_email_idx").on(table.email),
    index("orders_image_key_idx").on(table.imageKey),
  ],
);

export const generations = sqliteTable("generations", {
  imageKey: text("image_key").primaryKey(),
  email: text("email"),
  createdAt: integer("created_at").notNull(),
  purchasedAt: integer("purchased_at"),
});

export const stripeEvents = sqliteTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: integer("reset_at").notNull(),
});
