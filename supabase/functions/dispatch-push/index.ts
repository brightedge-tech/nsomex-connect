import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type DbTable<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type PushDatabase = {
  public: {
    Tables: {
      notifications: DbTable<
        {
          id: string;
          user_id: string;
          type: string;
          title: string;
          message: string;
          related_entity_type: string | null;
          related_entity_id: string | null;
        },
        never,
        never
      >;
      notification_preferences: DbTable<
        {
          user_id: string;
          push_enabled: boolean;
          service_requests: boolean;
          provider_responses: boolean;
          booking_updates: boolean;
          messages: boolean;
          verification_updates: boolean;
          preferred_language: "en" | "fr";
        },
        never,
        never
      >;
      profiles: DbTable<
        { id: string; user_id: string; role: string },
        never,
        never
      >;
      push_devices: DbTable<
        {
          id: string;
          user_id: string;
          expo_push_token: string;
          is_active: boolean;
          updated_at: string;
        },
        never,
        { is_active?: boolean; updated_at?: string }
      >;
      push_outbox: DbTable<
        {
          id: number;
          notification_id: string;
          status: "pending" | "processing" | "sent" | "skipped" | "failed";
          attempt_count: number;
          available_at: string;
          locked_at: string | null;
          processed_at: string | null;
          last_error: string | null;
        },
        never,
        {
          status?: "pending" | "processing" | "sent" | "skipped" | "failed";
          available_at?: string;
          locked_at?: string | null;
          processed_at?: string | null;
          last_error?: string | null;
        }
      >;
      push_delivery_attempts: DbTable<
        {
          id: number;
          notification_id: string;
          push_device_id: string;
          status:
            | "pending"
            | "sending"
            | "ticketed"
            | "delivered"
            | "failed"
            | "invalid_token";
          attempt_count: number;
          expo_ticket_id: string | null;
          last_error: string | null;
          updated_at: string;
        },
        {
          notification_id: string;
          push_device_id: string;
          status?: "pending";
        },
        {
          status?:
            | "pending"
            | "sending"
            | "ticketed"
            | "delivered"
            | "failed"
            | "invalid_token";
          expo_ticket_id?: string | null;
          last_error?: string | null;
          updated_at?: string;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      claim_push_outbox: {
        Args: { p_limit: number };
        Returns: {
          id: number;
          notification_id: string;
          attempt_count: number;
        }[];
      };
      claim_push_delivery_attempts: {
        Args: { p_notification_id: string; p_limit: number };
        Returns: {
          id: number;
          push_device_id: string;
          expo_push_token: string;
          attempt_count: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
type PushClient = SupabaseClient<PushDatabase, "public">;

type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
};

type NotificationPreferences = {
  push_enabled: boolean;
  service_requests: boolean;
  provider_responses: boolean;
  booking_updates: boolean;
  messages: boolean;
  verification_updates: boolean;
  preferred_language: "en" | "fr";
};

type PushDevice = { id: string; user_id: string };
type ClaimedOutbox = {
  id: number;
  notification_id: string;
  attempt_count: number;
};
type ClaimedAttempt = {
  id: number;
  push_device_id: string;
  expo_push_token: string;
  attempt_count: number;
};
type ExpoTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};
type ExpoReceipt = {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
};

const expoSendUrl = "https://exp.host/--/api/v2/push/send";
const expoReceiptsUrl = "https://exp.host/--/api/v2/push/getReceipts";
const batchSize = 100;
const externalRequestTimeoutMs = 15_000;
const preferenceForType: Record<string, keyof NotificationPreferences> = {
  service_request: "service_requests",
  provider_response: "provider_responses",
  booking_request: "booking_updates",
  booking_accepted: "booking_updates",
  booking_declined: "booking_updates",
  provider_on_way: "booking_updates",
  provider_arrived: "booking_updates",
  booking_completed: "booking_updates",
  booking_status_update: "booking_updates",
  new_message: "messages",
  verification_update: "verification_updates",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const dispatcherSecret = Deno.env.get("PUSH_DISPATCH_SECRET");
const expoAccessToken = Deno.env.get("EXPO_ACCESS_TOKEN");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function localized(value: string, language: "en" | "fr") {
  const separator = " / ";
  const separatorIndex = value.indexOf(separator);
  if (separatorIndex < 0) return value;
  return language === "fr"
    ? value.slice(separatorIndex + separator.length).trim()
    : value.slice(0, separatorIndex).trim();
}

function notificationRoute(
  notification: NotificationRow,
  role: string | undefined,
  language: "en" | "fr",
) {
  if (
    notification.related_entity_type === "conversation" &&
    notification.related_entity_id
  ) {
    return {
      route: "conversation",
      conversationId: notification.related_entity_id,
      language,
    };
  }
  if (
    notification.related_entity_type === "provider_application" &&
    notification.related_entity_id
  ) {
    return {
      route: "provider_verification",
      applicationId: notification.related_entity_id,
      language,
    };
  }
  if (notification.type === "service_request") {
    return {
      route: "provider_requests",
      requestId: notification.related_entity_id,
      language,
    };
  }
  if (
    notification.type === "booking_request" ||
    notification.type === "booking_status_update" ||
    notification.type === "booking_accepted" ||
    notification.type === "booking_declined" ||
    notification.type === "provider_on_way" ||
    notification.type === "provider_arrived" ||
    notification.type === "booking_completed"
  ) {
    return {
      route: role === "provider" ? "provider_jobs" : "booking",
      bookingId: notification.related_entity_id,
      language,
    };
  }
  if (notification.type === "provider_response") {
    return {
      route: "booking_confirmation",
      requestId: notification.related_entity_id,
      language,
    };
  }
  return { route: "home", language };
}

function preferenceAllows(
  notification: NotificationRow,
  preferences: NotificationPreferences | undefined,
) {
  if (!preferences?.push_enabled) return false;
  const category = preferenceForType[notification.type];
  return category ? preferences[category] : false;
}

async function updateOutbox(
  supabase: PushClient,
  id: number,
  status: "sent" | "skipped" | "failed" | "pending",
  error?: string,
  retryAt?: string,
) {
  const { error: updateError } = await supabase
    .from("push_outbox")
    .update({
      status,
      locked_at: null,
      processed_at: status === "pending" ? null : new Date().toISOString(),
      available_at: retryAt ?? new Date().toISOString(),
      last_error: error ?? null,
    })
    .eq("id", id)
    .eq("status", "processing");
  if (updateError) throw updateError;
}

async function processReceipts(supabase: PushClient) {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const expiry = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { error: expiryError } = await supabase
    .from("push_delivery_attempts")
    .update({
      status: "failed",
      last_error: "ReceiptExpired",
      updated_at: new Date().toISOString(),
    })
    .eq("status", "ticketed")
    .lt("created_at", expiry);
  if (expiryError) throw expiryError;

  const { data: attempts, error } = await supabase
    .from("push_delivery_attempts")
    .select("id, expo_ticket_id, push_device_id")
    .eq("status", "ticketed")
    .lt("created_at", cutoff)
    .order("created_at")
    .limit(1000);
  if (error) throw error;

  for (let offset = 0; offset < (attempts ?? []).length; offset += 300) {
    const batch = (attempts ?? []).slice(offset, offset + 300);
    const ticketIds = batch
      .map((attempt) => attempt.expo_ticket_id)
      .filter((ticketId): ticketId is string => !!ticketId);
    if (!ticketIds.length) continue;

    const response = await fetch(expoReceiptsUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "accept-encoding": "gzip, deflate",
        authorization: `Bearer ${expoAccessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ids: ticketIds }),
      signal: AbortSignal.timeout(externalRequestTimeoutMs),
    });
    if (!response.ok) {
      console.error("Expo receipt request failed", response.status);
      continue;
    }

    const result = (await response.json()) as {
      data?: Record<string, ExpoReceipt>;
    };
    for (const attempt of batch) {
      const ticketId = attempt.expo_ticket_id;
      const receipt = ticketId ? result.data?.[ticketId] : undefined;
      if (!receipt) continue;

      const invalid = receipt.details?.error === "DeviceNotRegistered";
      const { error: attemptError } = await supabase
        .from("push_delivery_attempts")
        .update({
          status:
            receipt.status === "ok"
              ? "delivered"
              : invalid
                ? "invalid_token"
                : "failed",
          last_error:
            receipt.status === "ok"
              ? null
              : (receipt.details?.error ?? "ExpoReceiptError"),
          updated_at: new Date().toISOString(),
        })
        .eq("id", attempt.id)
        .eq("status", "ticketed");
      if (attemptError) throw attemptError;

      if (invalid) {
        const { error: deviceError } = await supabase
          .from("push_devices")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("id", attempt.push_device_id);
        if (deviceError) throw deviceError;
      }
    }
  }
}

async function failPendingAttempts(
  supabase: PushClient,
  notificationId: string,
  reason: string,
  includeSending = false,
) {
  const query = supabase
    .from("push_delivery_attempts")
    .update({
      status: "failed",
      last_error: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("notification_id", notificationId);
  const { error } = includeSending
    ? await query.in("status", ["pending", "sending"])
    : await query.eq("status", "pending");
  if (error) throw error;
}

async function processOutboxEntry(
  supabase: PushClient,
  expoToken: string,
  entry: ClaimedOutbox,
  notification: NotificationRow,
  preferences: NotificationPreferences | undefined,
  devices: PushDevice[],
) {
  if (!preferenceAllows(notification, preferences)) {
    await failPendingAttempts(
      supabase,
      notification.id,
      "NotificationPreferenceDisabled",
    );
    await updateOutbox(
      supabase,
      entry.id,
      "skipped",
      "NotificationPreferenceDisabled",
    );
    return;
  }
  if (!devices.length) {
    await failPendingAttempts(supabase, notification.id, "NoActivePushDevices");
    await updateOutbox(supabase, entry.id, "skipped", "NoActivePushDevices");
    return;
  }

  const { error: insertError } = await supabase
    .from("push_delivery_attempts")
    .upsert(
      devices.map((device) => ({
        notification_id: notification.id,
        push_device_id: device.id,
        status: "pending",
      })),
      { onConflict: "notification_id,push_device_id", ignoreDuplicates: true },
    );
  if (insertError) throw insertError;

  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_push_delivery_attempts",
    { p_notification_id: notification.id, p_limit: 1000 },
  );
  if (claimError) throw claimError;
  const attempts = (claimed ?? []) as ClaimedAttempt[];
  if (!attempts.length) {
    await updateOutbox(supabase, entry.id, "sent", "NoNewDeviceAttempts");
    return;
  }

  const language = preferences?.preferred_language ?? "en";
  const title = localized(notification.title, language);
  const body = localized(notification.message, language);
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", notification.user_id)
    .maybeSingle();
  if (profileError) throw profileError;
  const data = notificationRoute(notification, profile?.role, language);
  let retryAt: string | undefined;

  for (let offset = 0; offset < attempts.length; offset += batchSize) {
    const batch = attempts.slice(offset, offset + batchSize);
    const payload = batch.map((attempt) => ({
      to: attempt.expo_push_token,
      title,
      body,
      sound: "default",
      priority: "high",
      channelId: "default",
      data: { ...data, notificationId: notification.id },
    }));

    let response: Response;
    try {
      response = await fetch(expoSendUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "accept-encoding": "gzip, deflate",
          authorization: `Bearer ${expoToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(externalRequestTimeoutMs),
      });
    } catch {
      await supabase
        .from("push_delivery_attempts")
        .update({
          status: "failed",
          last_error: "ExpoNetworkError",
          updated_at: new Date().toISOString(),
        })
        .in(
          "id",
          attempts.slice(offset).map((attempt) => attempt.id),
        );
      await updateOutbox(supabase, entry.id, "failed", "ExpoNetworkError");
      return;
    }

    if (!response.ok) {
      const retryable = response.status === 429;
      const canRetry = retryable && entry.attempt_count < 8;
      const delaySeconds = Math.min(
        60 * 2 ** (entry.attempt_count - 1),
        60 * 60,
      );
      const retryAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
      const { error: attemptError } = await supabase
        .from("push_delivery_attempts")
        .update({
          status: canRetry ? "pending" : "failed",
          last_error: `ExpoHttp${response.status}`,
          updated_at: new Date().toISOString(),
        })
        .in(
          "id",
          attempts.slice(offset).map((attempt) => attempt.id),
        );
      if (attemptError) throw attemptError;
      await updateOutbox(
        supabase,
        entry.id,
        canRetry ? "pending" : "failed",
        `ExpoHttp${response.status}`,
        canRetry ? retryAt : undefined,
      );
      return;
    }

    const result = (await response.json()) as { data?: ExpoTicket[] };
    const tickets = Array.isArray(result.data) ? result.data : [];
    for (let index = 0; index < batch.length; index += 1) {
      const attempt = batch[index];
      const ticket = tickets[index];
      if (!ticket) {
        const { error: attemptError } = await supabase
          .from("push_delivery_attempts")
          .update({
            status: "failed",
            last_error: "MissingExpoTicket",
            updated_at: new Date().toISOString(),
          })
          .eq("id", attempt.id);
        if (attemptError) throw attemptError;
        continue;
      }

      const invalid = ticket.details?.error === "DeviceNotRegistered";
      const retryable = ticket.details?.error === "MessageRateExceeded";
      const ticketRetryAt = new Date(
        Date.now() +
          Math.min(60 * 2 ** (entry.attempt_count - 1), 60 * 60) * 1000,
      ).toISOString();
      const { error: attemptError } = await supabase
        .from("push_delivery_attempts")
        .update({
          status:
            ticket.status === "ok"
              ? "ticketed"
              : invalid
                ? "invalid_token"
                : retryable && entry.attempt_count < 8
                  ? "pending"
                  : "failed",
          expo_ticket_id: ticket.status === "ok" ? (ticket.id ?? null) : null,
          last_error:
            ticket.status === "ok"
              ? null
              : (ticket.details?.error ?? "ExpoTicketError"),
          updated_at: new Date().toISOString(),
        })
        .eq("id", attempt.id);
      if (attemptError) throw attemptError;

      if (invalid) {
        const { error: deviceError } = await supabase
          .from("push_devices")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("id", attempt.push_device_id);
        if (deviceError) throw deviceError;
      }
      if (retryable && entry.attempt_count < 8) {
        retryAt = retryAt ?? ticketRetryAt;
        continue;
      }
    }
  }

  const { data: remaining, error: remainingError } = await supabase
    .from("push_delivery_attempts")
    .select("id")
    .eq("notification_id", notification.id)
    .eq("status", "pending")
    .limit(1);
  if (remainingError) throw remainingError;
  await updateOutbox(
    supabase,
    entry.id,
    remaining?.length ? "pending" : "sent",
    remaining?.length ? "MessageRateExceeded" : undefined,
    retryAt,
  );
}

function retryAtFor(attemptCount: number) {
  const delaySeconds = Math.min(60 * 2 ** (attemptCount - 1), 60 * 60);
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, 405);

  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !dispatcherSecret ||
    !expoAccessToken
  ) {
    console.error("Push dispatcher server configuration is incomplete");
    return jsonResponse({ error: "Push dispatcher is not configured" }, 500);
  }

  if (request.headers.get("authorization") !== `Bearer ${dispatcherSecret}`) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient<PushDatabase>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const staleBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: staleOutbox, error: staleReadError } = await supabase
      .from("push_outbox")
      .select("id, notification_id")
      .eq("status", "processing")
      .lt("locked_at", staleBefore)
      .limit(100);
    if (staleReadError) throw staleReadError;
    if (staleOutbox?.length) {
      const { error: staleAttemptError } = await supabase
        .from("push_delivery_attempts")
        .update({
          status: "failed",
          last_error: "DispatcherLeaseExpired",
          updated_at: new Date().toISOString(),
        })
        .in(
          "notification_id",
          staleOutbox.map((entry) => entry.notification_id),
        )
        .in("status", ["pending", "sending"]);
      if (staleAttemptError) throw staleAttemptError;
      const { error: staleUpdateError } = await supabase
        .from("push_outbox")
        .update({
          status: "failed",
          locked_at: null,
          processed_at: new Date().toISOString(),
          last_error: "DispatcherLeaseExpired",
        })
        .in(
          "id",
          staleOutbox.map((entry) => entry.id),
        )
        .eq("status", "processing");
      if (staleUpdateError) throw staleUpdateError;
    }

    await processReceipts(supabase);

    const { data: claimedRows, error: claimError } = await supabase.rpc(
      "claim_push_outbox",
      {
        p_limit: 25,
      },
    );
    if (claimError) throw claimError;

    const entries = (claimedRows ?? []) as ClaimedOutbox[];
    if (!entries.length) return jsonResponse({ processed: 0 });

    const notificationIds = entries.map((entry) => entry.notification_id);
    const { data: notificationRows, error: notificationError } = await supabase
      .from("notifications")
      .select(
        "id, user_id, type, title, message, related_entity_type, related_entity_id",
      )
      .in("id", notificationIds);
    if (notificationError) throw notificationError;

    const notifications = new Map(
      ((notificationRows ?? []) as NotificationRow[]).map((notification) => [
        notification.id,
        notification,
      ]),
    );
    const userIds = [
      ...new Set([...notifications.values()].map((item) => item.user_id)),
    ];
    const [preferenceResult, deviceResult] = await Promise.all([
      userIds.length
        ? supabase
            .from("notification_preferences")
            .select(
              "user_id, push_enabled, service_requests, provider_responses, booking_updates, messages, verification_updates, preferred_language",
            )
            .in("user_id", userIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? supabase
            .from("push_devices")
            .select("id, user_id")
            .eq("is_active", true)
            .in("user_id", userIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (preferenceResult.error) throw preferenceResult.error;
    if (deviceResult.error) throw deviceResult.error;

    const preferences = new Map(
      (preferenceResult.data ?? []).map((preference) => [
        preference.user_id,
        preference as NotificationPreferences,
      ]),
    );
    const devicesByUser = new Map<string, PushDevice[]>();
    for (const device of deviceResult.data ?? []) {
      devicesByUser.set(device.user_id, [
        ...(devicesByUser.get(device.user_id) ?? []),
        device,
      ]);
    }

    let processed = 0;
    for (let offset = 0; offset < entries.length; offset += 5) {
      await Promise.all(
        entries.slice(offset, offset + 5).map(async (entry) => {
          const notification = notifications.get(entry.notification_id);
          if (!notification) {
            await updateOutbox(
              supabase,
              entry.id,
              "failed",
              "NotificationNotFound",
            );
            return;
          }

          try {
            await processOutboxEntry(
              supabase,
              expoAccessToken,
              entry,
              notification,
              preferences.get(notification.user_id),
              devicesByUser.get(notification.user_id) ?? [],
            );
            processed += 1;
          } catch {
            console.error("Push outbox entry failed", entry.id);
            await failPendingAttempts(
              supabase,
              entry.notification_id,
              "PushProcessingError",
              true,
            );
            await updateOutbox(
              supabase,
              entry.id,
              "failed",
              "PushProcessingError",
            );
          }
        }),
      );
    }

    return jsonResponse({ processed });
  } catch {
    console.error("Push dispatcher batch failed");
    return jsonResponse({ error: "Push dispatch failed" }, 500);
  }
});
