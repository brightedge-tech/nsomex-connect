# NSOMEX Connect database

The PostgreSQL/Supabase schema is managed by the ordered migrations in
`supabase/migrations/`. `database/migrations/` is a symlink to that directory
so the preferred project path and the Supabase CLI use the same migration
files. There was no existing database migration history when this foundation
was added. The migrations have not been applied to a Supabase project.

## Migration order

1. `20261005130000_reference_and_provider_core.sql` creates configurable
   geography and currency references, profiles, categories, professions,
   services, and provider setup tables.
2. `20261005131000_marketplace_activity.sql` creates requests, bookings,
   provider request responses, conversations, messages, reviews, notifications,
   reports, and favorites.
3. `20261005132000_security_and_integrity.sql` adds authorization helpers,
   Row Level Security, booking/review integrity, and participant-safe RPCs.
4. `20261005132500_reference_seed_data.sql` adds editable reference examples;
   it does not create user or provider accounts.
5. `20261005133000_storage_buckets_and_policies.sql` creates storage buckets
   and scoped object policies.
6. `20261005134000_optional_postgis.sql` adds stored geography points and GiST
   indexes when PostGIS is available. Without PostGIS, coordinate checks and
   city/location indexes remain in place for a later spatial migration.
7. `20261102113000_admin_provider_verification.sql` adds the
   `requires_documents` application state, admin-only application reads,
   paginated admin listing and review RPCs, review reasons, indexed
   keyset-pagination, and transactional audit/notification recording. It
   reuses the existing admin identity helper and private-document access rules.
8. `20261102120000_service_request_contact_details.sql` adds optional
   request-level contact name and E.164 phone columns to existing service
   requests. The mobile request form requires both values for new submissions;
   nullable columns preserve existing requests.
9. `20261102140000_cameroon_location_reference_data.sql` seeds Cameroon’s
   ten regions and representative major cities/towns into the existing
   country/region/city reference tables. It is idempotent and reactivates
   matching records without creating duplicates.
10. `20261102150000_provider_dashboard_request_inbox.sql` adds the approved
    provider setup, eligible-request and job RPCs, area-scoped request access,
    one accepted provider response per request, status notifications, and
    supporting indexes. It reuses existing marketplace tables.
11. `20261102160000_public_provider_discovery.sql` adds private provider
    portfolio storage and metadata, verified-only provider search, privacy-safe
    public service-area/review views, and public review aggregates. It preserves
    private provider documents and the existing database-enforced review
    eligibility checks.
12. `20261102170000_customer_provider_messaging.sql` adds a paginated
    participant-only conversation inbox, enables Realtime message events, and
    enforces participant-only reads and authenticated participant sends. It
    reuses the existing conversations/messages tables and `start_conversation()`,
    and adds a participant-scoped batch read-receipt RPC.
13. `20261103100000_booking_lifecycle_completion.sql` adds an explicit
    provider-completed/customer-confirmed booking state, transactional booking
    creation, customer confirmation and review RPCs, server-enforced lifecycle
    transitions, RPC-only booking creation/status/review submission, and
    notifications to the other booking participant plus a provider dashboard
    count for work awaiting customer confirmation.
14. `20261103120000_phone_otp_auth.sql` adds the private profile email field,
    backfills account contact details where available, populates new customer
    profiles from Auth metadata, and prevents users from changing their own
    marketplace role.
15. `20261103160000_provider_management.sql` adds provider-specific service
    titles and images, date-specific availability overrides, protection against
    overlapping weekly hours, and request matching against the provider's
    published availability. It reuses existing provider, service, and storage
    structures.
16. `20261104100000_expo_push_notifications.sql` adds private per-user Android
    push-device registration, notification preferences, an idempotent push
    outbox and delivery ledger, and database-generated notifications for new
    matching service requests and messages. Device-token and dispatcher access
    is restricted to authenticated RPCs and the service role.
17. `20261104110000_customer_request_booking_cancellation.sql` adds an
    ownership-checked customer cancellation RPC for pending requests and
    cancellable bookings, plus deduplicated provider notifications when a
    pending request is cancelled. It reuses existing status values, booking
    transition guards, notification preferences, and the notification outbox.
18. `20261104120000_admin_dashboard.sql` adds admin-only account status
    management, audited provider/customer actions, summary and paginated
    account-list RPCs, and an audited catalog-save RPC. It reuses the existing
    admin role, audit table, and RLS policies.

## Access and trust boundaries

- `auth.users` is the identity source. A database trigger creates a customer
  profile on signup and never trusts user metadata for roles.
- `profiles.role = 'admin'` is not self-assignable. Grant the first admin role
  only from a trusted Supabase SQL session after verifying the account.
- Table RLS and database constraints are authoritative; mobile visibility is
  not authorization. The `private` schema contains narrowly scoped,
  `SECURITY DEFINER` helpers with a pinned empty search path.
- Public provider and review views deliberately omit phone numbers, customer
  identifiers, and verification document data. Base verification documents
  are private and their storage bucket is not public.
- Storage object paths use the uploader's auth user UUID as the first path
  segment for avatars. Provider documents use
  `<auth-user-uuid>/<provider-profile-uuid>/<file-uuid>`. Service images use
  `<provider-profile-uuid>/<service-uuid>/...`; request attachments use
  `<request-uuid>/...`; chat attachments use
  `<conversation-uuid>/<uploader-auth-user-uuid>/...`.
- Bookings store an immutable agreed price and currency. No payment state,
  transaction, or gateway is part of this schema.
- Providers respond independently to open requests in
  `service_request_responses`; this avoids treating a multi-provider request
  as a single provider's response. The customer creates the booking after
  selecting a provider response. A request can produce at most one booking,
  and its lifecycle status is synchronized from that booking.

## Apply after the project exists

The project owner must first create the actual Supabase project and confirm
its database region and PostgreSQL major version. Update `supabase/config.toml`
if the remote major version differs from the local CLI default. Then, from the
repository root, authenticate the Supabase CLI, link the real project, inspect
the pending migrations, and apply them through the normal reviewed migration
workflow. For example:

```sh
npx supabase login
npx supabase link --project-ref <YOUR_REAL_PROJECT_REF>
npx supabase db push --dry-run
npx supabase db push
```

The customer service-request form also requires active region and city
reference rows for the locations being served. The reference seed migration
adds countries but does not invent region or city data. Before using the form,
run the contents of
`supabase/migrations/20261102120000_service_request_contact_details.sql` and
`supabase/migrations/20261102140000_cameroon_location_reference_data.sql` in
the Supabase SQL Editor if those migrations have not already been applied.
The first adds request-level contact name and phone columns; the second adds
Cameroon location records. Neither changes RLS policies or creates tables.

The provider dashboard requires the preceding schema, provider-application
and admin-verification migrations, the request contact columns, and the new
provider dashboard migration. The provider dashboard migration intentionally
stops if any request already has multiple accepted provider responses; resolve
those records before applying it rather than silently choosing a provider.
Provider and customer status updates are recorded as in-app notifications in
the existing `notifications` table. Push notification delivery is not
configured by this migration.

Provider discovery, portfolio uploads, and public profile details require
`supabase/migrations/20261102160000_public_provider_discovery.sql`. Review
submission also relies on the existing completed-booking RLS policy and trigger.
Review the migration and apply it through the reviewed Supabase migration
workflow above; do not make the `provider-portfolio` bucket public.

Customer-provider messaging requires the preceding marketplace, security,
service-request contact-details, provider dashboard, and provider-discovery
migrations. The Supabase `supabase_realtime` publication must exist; the
messaging migration adds `public.messages` to it and enables full row identity
so clients can receive read-receipt updates. Message visibility and sending
remain restricted by participant RLS; the inbox RPC returns only conversations
for `auth.uid()`.

The booking lifecycle requires all preceding marketplace, security, provider
dashboard, and messaging migrations. Review and manually apply
`supabase/migrations/20261103100000_booking_lifecycle_completion.sql` in the
Supabase migration workflow before using the booking, customer completion
confirmation, or review-submit actions. Providers mark work complete first;
only the customer can then confirm completion. The booking lifecycle is
pending → accepted → on the way → arrived → in progress → provider-completed →
customer-confirmed completed. Reviews become available only after customer
confirmation. The mobile app does not apply migrations automatically.

Customer cancellation requires
`supabase/migrations/20261104110000_customer_request_booking_cancellation.sql`,
applied after the booking lifecycle and Expo push-notification migrations.
It reuses the existing pending/cancelled request states and booking transition
guard. Customers can cancel an unbooked pending request or a booking before
work starts; database notifications go to providers who responded to an
unbooked request, while the existing booking trigger notifies the other party
when a booking is cancelled. Apply it manually through the reviewed Supabase
migration workflow; the mobile app does not execute SQL.

## Phone OTP authentication

The mobile app collects a full name, phone number, and email at signup. Phone
numbers are normalized to E.164, using Cameroon as the default when no country
prefix is provided. Returning users sign in by SMS OTP. New accounts receive
the customer role only; provider professional applications and admin
privileges remain separate.

Review and manually apply
`supabase/migrations/20261103120000_phone_otp_auth.sql` after the profile and
security migrations. It adds `profiles.email`, backfills existing account
contact details where available, updates the trusted Auth-user profile trigger,
and prevents self-service role changes. The existing profile self-read policy
protects the email field; do not add public profile access to it.

In the Supabase Dashboard, enable **Authentication → Sign In / Providers →
Phone**, configure a production SMS provider and sender, and ensure the SMS
template contains the Supabase OTP variable. Set suitable SMS rate limits and
test delivery to Cameroon and all intended countries. Keep phone confirmation
enabled. Since the app uses phone OTP, disable unused email/password or
email-OTP sign-in providers if they are not needed by another trusted client.
Do not disable Supabase phone verification or expose service-role credentials
in the mobile app.

The root Expo Router guard keeps protected routes behind an authenticated
session with `phone_confirmed_at`; unverified legacy sessions are cleared
locally and sent through phone login. Supabase RLS remains authoritative for
data access. Direct REST/RPC clients must not be treated as protected solely
because the mobile router hides a screen.

## Provider management

Review and manually apply
`supabase/migrations/20261103160000_provider_management.sql` after the provider
setup, security, provider-discovery, and storage migrations. It adds optional
provider-specific service titles and image paths, creates
`provider_availability_exceptions` with owner/admin policies, prevents
overlapping weekly availability intervals, and updates request matching so
requests with a date respect the provider's weekly availability even when no
time is specified. A date-specific exception overrides weekly hours: an
unavailable exception rejects the date, while an available exception allows
the date and, when a time is supplied, requires that time to fall within its
exception hours. When no weekly schedule has been configured, matching retains
the existing permissive behavior. The migration is safe to rerun after partial
execution and does not delete provider, service, booking, or availability data.
It checks for overlapping existing weekly hours and stops with an error if
any must be resolved first.

The existing `service-images` public bucket, size/MIME restrictions, and
provider/service-scoped object policies are defined by
`20261005133000_storage_buckets_and_policies.sql`; no additional bucket setup
is needed. Availability exceptions replace weekly hours on their date and are
visible on verified provider profiles. Customer requests with a requested
date/time will only appear in a provider's request inbox when the provider's
weekly hours or date override permits that time. Requests without a date/time
retain the existing matching behavior.

## Administrator dashboard

The admin overview, account management, catalog editor, reports, and audit
screens require
`supabase/migrations/20261104120000_admin_dashboard.sql`. Apply it manually
after the core marketplace/security migrations,
`20261102113000_admin_provider_verification.sql`,
`20261103120000_phone_otp_auth.sql`, and
`20261103160000_provider_management.sql`. It reuses `private.is_admin()`,
`admin_actions`, the provider-application review RPCs, existing report audit
trigger, and existing RLS policies. Its new RPCs check administrator access
server-side; the mobile app does not use a service-role key.

The migration adds account suspension fields and audited admin RPCs, but does
not create duplicate tables or delete existing profiles, services, requests,
bookings, reports, or availability data. Catalog entries should be hidden by
setting `is_active` to false rather than deleted. No Storage bucket changes are
needed. Review and apply the SQL in Supabase manually; the mobile app never
executes migrations.

## Android push notifications

The push flow reuses `public.notifications` as the in-app source of truth. Its
insert trigger creates one outbox item per in-app notification. The
`dispatch-push` Edge Function checks user preferences, sends to every active
device for the user, stores Expo tickets, polls delivery receipts, and
deactivates tokens reported as `DeviceNotRegistered`. Push payloads contain
only notification and routing metadata, not request descriptions, contact
details, or message text. No push token or service-role key is readable by the
mobile client.

Before deploying, manually:

1. Apply `20261104100000_expo_push_notifications.sql` after all migrations
   listed above. Do not run it against a different or incomplete schema.
2. Link this app to its real EAS project (`npx eas-cli@latest init`), set
   `EXPO_PUBLIC_EAS_PROJECT_ID` in the mobile build environment (or add the
   actual `extra.eas.projectId` to `apps/mobile/app.json`), and configure an
   Android FCM v1 service-account credential in EAS. The project ID is public;
   FCM and Expo access credentials are not.
3. Build and install a new Android development or production binary. The
   `expo-notifications` native module and Android notification channel are
   configured by the Expo plugin and are not available in Expo Go.
4. Create an Expo access token with push security enabled and set it as the
   `EXPO_ACCESS_TOKEN` Edge Function secret. Set a separate long random
   `PUSH_DISPATCH_SECRET` using `supabase secrets set`; do not commit either.
   The mobile app contains neither secret.
5. Deploy the Edge Function from the repository root:

   ```sh
   npx supabase functions deploy dispatch-push
   ```

6. Enable `pg_cron`, `pg_net`, and Vault in the Supabase project if they are
   not already enabled. Store the project URL and the same dispatcher secret
   in Vault, then create the scheduled invocation from the Supabase SQL
   Editor. Substitute the real values only in the SQL Editor:

   ```sql
   select vault.create_secret('<SUPABASE_PROJECT_URL>', 'project_url');
   select vault.create_secret('<PUSH_DISPATCH_SECRET>', 'push_dispatch_secret');

   select cron.schedule(
     'dispatch-push-every-minute',
     '* * * * *',
     $$
     select net.http_post(
       url := (
         select decrypted_secret
         from vault.decrypted_secrets
         where name = 'project_url'
       ) || '/functions/v1/dispatch-push',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || (
           select decrypted_secret
           from vault.decrypted_secrets
           where name = 'push_dispatch_secret'
         )
       ),
       body := '{}'::jsonb
     );
     $$
   );
   ```

   Protect database access because `pg_net` temporarily stores request headers
   while sending. The function additionally checks the dispatcher secret;
   `verify_jwt` is disabled only for this function in `supabase/config.toml`.

7. Test on a physical Android device after installing the new binary: grant
   notification permission, enable push in Notification preferences, verify
   that a registered device row appears, cause a real database notification,
   inspect the Edge Function logs and Expo receipt status, and tap the push to
   verify its destination. Expo ticket acceptance is not proof of device
   delivery. Push delivery has not been tested on a device as part of this
   change.

The notification-preferences screen controls push delivery only; existing
in-app notifications remain available and continue to be recorded even when
push is disabled. Delivery of a notification is de-duplicated by its database
notification ID and device ID. Ambiguous network failures are not blindly
retried, to avoid sending duplicate pushes; inspect failed outbox rows and
function logs when investigating such cases.

Do not place database passwords, access tokens, or service-role keys in this
repository or in the mobile app. The optional PostGIS migration reports a
notice and leaves scalar coordinates intact if the server does not offer the
extension.
