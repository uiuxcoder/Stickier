import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name"),
  passwordHash: text("password_hash"),
  emailVerifiedAt: integer("email_verified_at"),
  passwordResetTokenHash: text("password_reset_token_hash"),
  passwordResetExpiresAt: integer("password_reset_expires_at"),
  stripeCustomerId: text("stripe_customer_id"),
  regenerationsRemaining: integer("regenerations_remaining").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    stripeSubscriptionId: text("stripe_subscription_id").primaryKey(),
    userId: text("user_id").references(() => users.id),
    email: text("email").notNull(),
    status: text("status").notNull(),
    currentPeriodEnd: integer("current_period_end"),
    renewalReminder3SentAt: integer("renewal_reminder_3_sent_at"),
    renewalReminder1SentAt: integer("renewal_reminder_1_sent_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("subscriptions_email_idx").on(table.email),
    index("subscriptions_user_id_idx").on(table.userId),
  ],
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id),
    email: text("email").notNull(),
    stripeSessionId: text("stripe_session_id").notNull().unique(),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    imageKey: text("image_key").notNull(),
    amount: integer("amount").notNull(),
    emailSentAt: text("email_sent_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("orders_email_idx").on(table.email),
    index("orders_user_id_idx").on(table.userId),
    index("orders_image_key_idx").on(table.imageKey),
  ],
);

export const generations = sqliteTable(
  "generations",
  {
    imageKey: text("image_key").primaryKey(),
    userId: text("user_id").references(() => users.id),
    email: text("email"),
    createdAt: integer("created_at").notNull(),
    purchasedAt: integer("purchased_at"),
  },
  (table) => [index("generations_user_id_idx").on(table.userId)],
);

export const generationJobs = sqliteTable(
  "generation_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id),
    email: text("email"),
    status: text("status").notNull().default("queued"),
    imageKey: text("image_key"),
    error: text("error"),
    inputJson: text("input_json").notNull(),
    photoKeys: text("photo_keys").notNull().default("[]"),
    reservedQuota: integer("reserved_quota").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("generation_jobs_user_id_idx").on(table.userId)],
);

export const membershipDrops = sqliteTable(
  "membership_drops",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    monthKey: text("month_key").notNull(),
    stickerIds: text("sticker_ids").notNull(),
    shippingAddress: text("shipping_address").notNull(),
    status: text("status").notNull().default("submitted"),
    submittedAt: integer("submitted_at").notNull(),
  },
  (table) => [
    uniqueIndex("membership_drops_user_month_idx").on(table.userId, table.monthKey),
    index("membership_drops_status_idx").on(table.status),
  ],
);

export const stripeEvents = sqliteTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status").notNull().default("processed"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull().default(0),
});

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: integer("reset_at").notNull(),
});
